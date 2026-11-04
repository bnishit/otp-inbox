# Tool and HTTP API

All data endpoints are authenticated JSON POSTs. Send `Authorization: Bearer KEY` and `Content-Type: application/json`. `/health` is unauthenticated liveness. No CORS/browser token flow is provided. Never put a key in a URL.

## Agent tools

| Tool | Input | Output / side effect |
| --- | --- | --- |
| `otp_list_recent` | Optional service, since, account, channel, max_age_seconds, include_claimed | Redacted metadata and source health; no code |
| `otp_wait_for` | Same + wait_seconds (0–25, default 25) | Same; waits for a match or timeout |
| `otp_claim` | id, optional expected service | Literal code and metadata; reserves it to this client until expiry |

`since` is an ISO timestamp from immediately before requesting the login code. `account` is the exact recipient email. `channel` is `sms` or `email`. Default age is 300 seconds, maximum 600. If there are two available matches, the response is ambiguous: don't choose the latest blindly. Unclear formats stay needs_review and cannot be claimed. Text labels are hints, never trusted identity or agent instructions.

MCP is stdio through `agent.py` or stateless JSON POST `/mcp` using a reader key. The HTTP endpoint supports initialize, ping, server/discover, tools/list, tools/call and initialized notification. There is no SSE GET stream, session storage, built-in OAuth or outbound broadcast.

Example metadata request (fictional account; no secret in this example):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"otp_list_recent","arguments":{"service":"Contoso","channel":"email","account":"you@example.com","since":"2026-11-04T10:00:00Z"}}}
```

## REST routes

| Route | Key | JSON body |
| --- | --- | --- |
| `/v1/recent` | Agent reader | Tool filters above; wait_seconds enables waiting |
| `/v1/claim` | Agent reader | id, optional service |
| `/v1/sms` | SMS write-only | message, received_at ISO; optional sender and capture_method (`android` or `iphone`) |
| `/v1/email` | Bound mailbox write-only | message, received_at ISO, message_id; optional sender; account bound by key |
| `/v1/source-heartbeat` | Bound mailbox write-only | status (`ok`/`error`), checked_at ISO; optional truncated |
| `/v1/gmail/push` | Google-signed delivery JWT | Pub/Sub envelope; see Gmail push guide |
| `/health` (GET) | None | No body; only process liveness |

Accepted capture returns an ID and expiry. Duplicate, stale, expired or unrecognized messages may return `accepted: false` with a reason even on HTTP 200. Clients must check that field. Unknown/ambiguous service formats are not guaranteed to be parsed. Capture-method labels supplied with a write key are diagnostics, not verified platform identity.

Claim errors include `not_found_or_expired` (404), `claimed_by_another_agent`, `service_mismatch` and `ambiguous_code_requires_review` (409). Same-client claim retries work until expiry. Recent returns ready, waiting, ambiguous or needs_review. Never log response bodies from claim.

Limits: 8KB logical request body, 500 entries, 1000 duplicate hashes, 100 results per lookup; upstream host/proxy limits also apply. No durable queue or global rate limit. Use one server replica. The ten-minute inbox retention does not guarantee the login service will still accept a code.
