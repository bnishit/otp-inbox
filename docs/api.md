# Tool and HTTP API

All data endpoints are authenticated JSON POSTs. Send `Authorization: Bearer KEY` and `Content-Type: application/json`. `/health` is unauthenticated liveness. No CORS/browser token flow is provided. Never put a key in a URL.

## Agent tools

| Tool | Input | Output / side effect |
| --- | --- | --- |
| `otp_list_recent` | Optional service, since, account, channel, max_age_seconds, include_claimed | Redacted code/link metadata and source health; no secret |
| `otp_wait_for` | Same + wait_seconds (0–25, default 25) | Same; waits for a match or timeout |
| `otp_claim` | id, optional expected service | Typed code or approved link and metadata; reserves it to this client until expiry |
| `otp_history` | Optional service, account, channel, since, before, limit (1–100) | Durable receipt/retrieval metadata; no secrets |

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
| `/v1/history` | Agent reader | History filters above |
| `/v1/sms` | SMS write-only | message, received_at ISO; optional sender and capture_method (`android` or `iphone`) |
| `/v1/email` | Bound mailbox write-only | message, received_at ISO, message_id; optional sender, recipient, recipient_conflict, authenticated_domain; recipient must be approved for source key |
| `/v1/source-heartbeat` | Bound mailbox write-only | status (`ok`/`error`), checked_at ISO; optional truncated |
| `/v1/gmail/push` | Google-signed delivery JWT | Pub/Sub envelope; see Gmail push guide |
| `/health` (GET) | None | No body; only process liveness |

Accepted capture returns an ID and expiry. Duplicate, stale, expired or unrecognized messages may return `accepted: false` with a reason even on HTTP 200. Clients must check that field. Unknown/ambiguous service formats are not guaranteed to be parsed. Capture-method labels supplied with a write key are diagnostics, not verified platform identity.

Claim errors include `not_found_or_expired` (404), `claimed_by_another_agent`, `service_mismatch` and `ambiguous_code_requires_review` (409). Same-client claim retries work until expiry. Recent returns ready, waiting, ambiguous or needs_review. Link-specific review errors include unsupported_login_link, unverified_sender, multiple_login_links and multiple_secret_types. Never log response bodies from claim.

Limits: 8KB logical request body, 500 entries, 1000 duplicate hashes, 100 results per lookup; upstream host/proxy limits also apply. No durable queue or global rate limit. Use one server replica. The ten-minute inbox retention does not guarantee the login service will still accept a code.

## Sign-in links and recipient identity

Entries identify `secret_type: code` or `link`. List/wait return metadata only, including source `mailbox`, exact recipient `account`, safe `link_origin` and any `review_reason`. Match the authorized account, service, channel and request time before claim. Claim returns `code` for numeric/mixed codes or `link` for an approved sign-in link. Do not print, save, prefetch or forward either secret. Open a link only in its authorized sign-in flow. Multiple or unsupported links remain review-only. See [link configuration](login-links.md) and [browser helper](browser-helper.md).

## Durable history

Configure `OTP_AUDIT_DATABASE_URL` with a private Postgres database. Receipt, review, rejection, successful claim, same-client retry and denied claim events persist across expiry and restart. Claims are recorded before secret release; unavailable audit writes return `audit_unavailable` (503) without releasing the secret. A configured database must be ready at startup. Without one, history returns `history_not_configured` (503); capture and claim keep their existing transient behavior.

History defaults to 50 newest events, has no ten-minute age limit, and returns `next_cursor`; send it as `before` for the next page. `since` is an ISO time for the audit event. Service matching uses the recognized service label, not message contents; unknown brands may have a null service. Email recipient accounts are stored; SMS accounts are null. Invalid/unauthorized requests are not a full security access log. There is no automatic history deletion; database owners control deletion and backups.

Stored columns are event ID, event type/time, inbox entry ID, configured client name, service label, channel, recipient email, capture method, receipt/expiry times and outcome. Message text, preview, raw sender, OTP, sign-in URL, credentials and code hashes are excluded. Rejected captures may have no entry ID or service. Capture labels are supplied by authenticated sources and do not prove device identity.

A claim is evidence that the bridge approved release to a reader credential. It does not prove HTTP delivery, website authentication, a human identity, browser destination or task identity. Give clients separate keys; tasks sharing one key remain indistinguishable. Inbox state and claim reservations remain transient. Yesterday's expired events cannot be reconstructed by enabling this database today.

The implementation uses [Bun's native SQL client](https://bun.sh/docs/runtime/sql) with parameterized queries. Run `OTP_TEST_DATABASE_URL=postgres://... bun test` against an isolated test database to exercise actual persistence, reconnect, restart, filters and pagination.
