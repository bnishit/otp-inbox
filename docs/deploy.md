# Deploy your private inbox

One deployment belongs to one person. Start with local smoke testing, then give your phone a public HTTPS endpoint. Nothing here connects to the maintainer's inbox.

## 1. Prerequisites and clone

Install [Bun](https://bun.sh/docs/installation), Python 3.10+ and Git. Hosting may cost money. No OpenAI key, AI model, database or paid SMS provider is required.

```sh
git clone https://github.com/bnishit/otp-inbox.git
cd otp-inbox
python3 scripts/setup.py --url http://127.0.0.1:8787 \
  --mailbox personal=you@example.com --mailbox work=you@company.example
```

Mailbox names are your choice; omit both `--mailbox` flags for SMS only. Setup creates `.local/settings.json`, `.local/server.env`, per-agent connection files and personalized email collectors. These contain secrets, are ignored by Git and are written with mode 600. Re-running with an existing settings file preserves keys; do not delete it to change URL.

## 2. Run and check locally

```sh
bun --env-file=.local/server.env run server.ts
```

In a second terminal, from the same repo:

```sh
python3 scripts/smoke.py
```

It creates one clearly synthetic, 30-second entry and checks capture, metadata-only MCP lookup and an exact claim. It prints no code. This proves transport, not phone delivery. `GET /health` is public liveness only; it does not prove mailbox health.

## 3. Host with HTTPS

### Railway

1. Fork this repository on GitHub, then create a Railway project from your fork. It uses the included Dockerfile and `railway.json`.
2. In the service's Variables panel, import the **contents** of your private `.local/server.env`. Never upload it to Git. Keep one replica and disable sleeping/serverless behavior for this service.
3. Generate a public domain under Networking. Keep HTTPS. `GET https://YOUR-DOMAIN/health` must return `status: ok`.
4. Update your local settings to that origin, preserving keys:

   ```sh
   python3 scripts/setup.py --url https://YOUR-DOMAIN
   ```

5. Regenerate the iPhone Shortcut if previously generated. Email collectors now contain the public URL. Run `python3 scripts/smoke.py` against the hosted service.

The app listens on the host's `PORT`, or 8787. Set an HTTP timeout above 30 seconds so a 25-second wait can finish. Set reasonable edge rate limits; don't log request/response bodies. Health checks should use `/health`.

### Docker / another always-on host

```sh
docker build -t otp-inbox .
docker run --env-file .local/server.env -p 127.0.0.1:8787:8787 --restart unless-stopped otp-inbox
```

Put an HTTPS reverse proxy in front for phone/cloud access. This loopback binding intentionally needs a proxy. Do not run multiple replicas. The Docker build excludes `.local/`, docs, tests and personalized shortcuts.

### Railway Functions (advanced)

`bun run build:function` produces `.local/function.js`, a single-file Bun bundle suitable for a Function. Set the same runtime variables. The code avoids a top-level interval: minute collector heartbeats drive daily Gmail watch-renewal checks. This is the predecessor's tested hosting path. The public Docker path is easier to reproduce; Docker execution itself may need testing on your host.

## 4. Choose capture and agents

- [iPhone Shortcut](iphone.md)
- [Android with Tasker](android.md)
- [Gmail minute polling](gmail-polling.md), then optional [Gmail push](gmail-push.md)
- [Codex, Claude Code, Dot, Instinct, Muse and other clients](agents.md)

Each agent uses its own reader key. Every reader has inbox-wide access; separate keys do not enforce per-mailbox restrictions. Never give a phone/mailbox ingest key to an agent.

## Configuration reference

| Setting | Meaning |
| --- | --- |
| `OTP_INGEST_TOKEN` | At least 32 characters; SMS write-only key |
| `OTP_CLIENT_TOKENS` | JSON object of unique client name → reader key |
| `OTP_EMAIL_SOURCES` | JSON object of source ID → `{email,label,token}`; each write-only key binds one mailbox |
| `GMAIL_PUSH_CONFIG` | Optional Gmail OAuth/Google Pub/Sub config; see push guide |
| `OTP_AUDIT_DATABASE_URL` | Optional Postgres URL for durable metadata history; use a private database with durable storage |
| `PORT` | Host port; default 8787 |

Change private settings, run setup again without `--mailbox`, and update the host's variables to apply config edits. A redeploy resets inbox memory and claims. Configured Postgres audit history survives; its tables are created on startup. On Railway, add Postgres with a volume and reference its `DATABASE_URL` in `OTP_AUDIT_DATABASE_URL`. A configured database must be reachable before the bridge starts. Receipt/claim audit writes must succeed before acceptance or secret release. Local agent config uses `credentials_file` relative to its own config; `OTP_INBOX_TOKEN` in the process environment overrides that file.

## Stop or revoke

Disable phone automation and Apps Script triggers; revoke the Google app; remove client keys and refresh tokens from hosting. Stop the deployment. Inbox copies expire within ten minutes; originals and any agent/provider history remain under those systems' policies. See [security limits](../SECURITY.md).
