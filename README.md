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

## Let Codex or Claude Code set it up

Copy this whole prompt into Codex or Claude Code on your computer. The agent should do the computer-side work and guide you through the phone taps. Google sign-in, consent, hosting access or paid services may still need your action; the prompt does not bypass those steps.

```text
Set up OTP Inbox end to end for me from https://github.com/bnishit/otp-inbox.
Do the work, not just explain the steps. I will handle the phone taps.

1. Clone the repo, or reuse my existing checkout. Read README.md, SECURITY.md,
   docs/deploy.md and the relevant capture/agent guides before making changes.
   Reuse existing deployment/config when present; preserve keys and unrelated
   settings. Never use the maintainer's inbox, accounts or credentials.

2. Ask in one short batch only what you cannot discover: iPhone or Android,
   which Gmail accounts I want connected, which agents I use, and hosting
   preference/budget. Explain that connected reader agents can retrieve any
   captured code in this deployment. Confirm the accounts/access I want before
   granting it. Do not buy services or accept new legal terms on my behalf.

3. Check prerequisites, generate private config with scripts/setup.py, run the
   tests and synthetic smoke check, then deploy one always-on replica behind
   HTTPS using my hosting account. Update the generated config to the public
   URL without rotating keys. Keep all secrets in ignored private files and
   runtime settings; never print them, paste them in chat or commit them.

4. For iPhone, generate and sign/import my private Shortcut on the Mac when
   available. Then give me the exact remaining Message-automation phone taps,
   one screen at a time. Mac sync does not create the iPhone trigger. For
   Android, prepare the Tasker payload and guide me through the profile,
   permissions and HTTP action. Follow the documented capture limits; don't
   claim an unconditional all-SMS trigger or a tested Android flow without proof.

5. For every Gmail account I select, install its account-bound minute collector
   using available browser/tools. Then set up my own Google Cloud project,
   OAuth consent and authenticated Pub/Sub push as described in the push guide.
   Keep polling active as backup and watch-renewal driver. Let me complete
   required sign-in/consent screens. Use read-only Gmail access only. Explain
   Testing-token expiry; don't call Production publishing Google verification.

6. Register the MCP adapter in my selected installed clients, including Codex
   and Claude Code when requested, with separate reader keys. Add the standing
   rule from examples/agent-instructions.md to the right existing instruction
   files, preserving other rules. For Dot, follow the owner-private Sites route
   if available. For Instinct/Muse, follow their documented secure integration
   recipe; don't invent native support or remove authentication to connect.

7. Verify capture -> metadata lookup -> matching claim without printing codes.
   Check each mailbox's real health and distinguish push capture from polling.
   Use synthetic tests first; don't send emails/SMS or start third-party logins
   without my instruction. Guide me through a real phone/locked-screen test.
   For an authorized login, match service, request time and exact account/channel
   before claim; never blindly take the newest code. Save the standing retrieval
   rule, never codes. OTP access does not authorize payments, security changes
   or forwarding codes to people. Respect each client's approval rules.

Keep going through all work you can do. Ask me only for missing decisions,
phone taps or required access/consent. If a tool or account blocks a step,
finish independent work, then give me the exact remaining action. End with
what is working, what was actually tested, what remains, and how to revoke it.
```

Prefer manual setup? Start below, then choose your capture and agent guides.

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
