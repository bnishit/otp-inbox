# OTP Inbox

**Your agents can finish the login. Your phone can stay in your pocket.**

A small, self-hosted inbox for short-lived SMS and email verification codes. Capture on your device or Gmail account. Let a trusted agent find the right code, wait if needed, and claim it for a login you've authorized.

[Project page](https://nishitbhatt.com/otp-inbox/) · [Start setup](docs/deploy.md) · [Agent connections](docs/agents.md) · [Security and limits](SECURITY.md)

```text
iPhone Shortcut / Android Tasker / Gmail polling + push
                         ↓
              Your private HTTPS inbox
                         ↓
         Match service + time + recipient account
                         ↓
            List → wait if needed → claim
                         ↓
       Codex · Claude Code · Dot · your own agent
```

No hosted account. No AI API key. No permanent code database. You run the server and choose which agents get reader keys. MIT licensed.

## Why it exists

An agent reaches a login screen, then stops to ask you to open your phone and paste a code. This tool gives it a narrow, reusable retrieval path. Codes arrive even when no agent is waiting. Access to a code still does not authorize payments, security changes or forwarding it to another person.

## Start here

Requires Bun, Python 3.10+ and Git.

```sh
git clone https://github.com/bnishit/otp-inbox.git
cd otp-inbox
python3 scripts/setup.py --url http://127.0.0.1:8787 \
  --mailbox personal=you@example.com
bun --env-file=.local/server.env run server.ts
# In another terminal:
python3 scripts/smoke.py
```

Setup generates private random keys and account-bound config under ignored `.local/`. It never prints credentials. The smoke test uses one synthetic entry and never prints its code. For phone/cloud use, follow [deployment](docs/deploy.md) to obtain your own HTTPS endpoint before installing capture. Don't point clients at the maintainer's private server.

## Pick your capture flow

| Source | Setup | Status |
| --- | --- | --- |
| iPhone SMS | [Generated Shortcut + personal Message automation](docs/iphone.md) | Predecessor tested with real SMS; portable generator included |
| Android SMS | [Tasker event + local filter + HTTP POST](docs/android.md) | Documented recipe; physical Android test still needed |
| Gmail, simple | [One-minute private Apps Script collector per account](docs/gmail-polling.md) | Predecessor tested across three accounts; shared parser/tests included |
| Gmail, faster | [Authenticated Google Pub/Sub push + polling backup](docs/gmail-push.md) | Predecessor delivery/expiry tested across three accounts; Google setup required |

The iPhone's broad space trigger covers worded SMS, not every possible text. Email search also has wording/volume limits. No “captures every OTP” guarantee.

## Connect the agents

[Full guide: Codex, Claude Code, ChatGPT Dot, Instinct, Meta Muse, generic MCP and REST](docs/agents.md).

- **Local:** dependency-free Python MCP adapter over stdio, with a separate private config for each client.
- **Remote:** authenticated JSON POST MCP at `/mcp`, or three REST operations. Clients must accept bearer authentication; no built-in OAuth server.
- **ChatGPT Dot:** owner-private Sites adapter included. Requires Sites access and its supported publish/plugin flow; not a turnkey OAuth endpoint for arbitrary ChatGPT connectors.
- **Instinct / Muse:** secure connection recipes with limits stated. No claim that their native clients have been tested.

Give your agent the [standing retrieval rule](examples/agent-instructions.md) once, so it uses the inbox for already-authorized login tasks. Platform approvals still apply. It should match service, request time and recipient account before claiming; never blindly take the newest entry.

## What is deliberately small

- Codes live in server memory for at most ten minutes, shortened by recognized validity. Originals remain in Gmail/Messages.
- Metadata lookup hides codes; claim returns the literal value only after selection. Unclear multiple tokens are held for review.
- One client reserves an entry until expiry; same-client retry can recover a lost response.
- Phone and mailbox keys are write-only; agents have separate reader keys. Every reader can access the whole deployment, not just one account.
- No AI extraction, billing, public signup, multi-tenancy or outbound broadcast. Inbox waiting is long polling; Gmail push is an inbound notification.

## Limits you should know before connecting accounts

**This is a personal prototype, not an audited authentication vault.** Run one replica. A restart resets claims and may reload still-valid Gmail messages. No persistent retry queue. Phone delivery and Gmail push may fail; keep polling as fallback and watch-renewal driver. Gmail read-only permission is broader than the OTP query. HTTPS and trusted agent storage are required. See [SECURITY.md](SECURITY.md) for revocation, retention, provider exposure and abuse limits.

The public repo contains no live endpoint, personalized Shortcut, mailbox identity, OAuth client or deployment credentials. Use your own Google app; Production publishing is not Google verification. Public SaaS distribution would need separate work.

## Develop and verify

```sh
bun test
python3 -m unittest discover -s scripts -p '*_test.py'
python3 scripts/audit.py
```

Bun tests cover extraction, redaction, expiry, account binding, client claims, long polling, signed Gmail notifications, renewal, collectors and remote/Sites adapters. Python tests cover private setup and unsafe configuration. Synthetic tests are separate from predecessor's real iPhone/Gmail/login results; the public fork is not a claim that every device/client has been tested.

```text
server.ts          transient inbox, parsing, expiry and claims
mcp.ts / tools.json remote MCP transport and shared schema
agent.py           local stdio MCP adapter and CLI
email/             Gmail push, shared parsing and polling template
scripts/           private setup, Shortcut generator, consent and checks
adapters/sites/    owner-private ChatGPT Dot tool proxy
examples/          Android payload and standing agent rule
site/              public landing page; no inbox connection
```

Issues and contributions are welcome. Use invented codes in tests. Never attach real SMS, mailbox bodies, private setup folders or personalized Shortcut exports. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) first.
