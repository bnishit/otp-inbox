# Gmail flow 2: push, with polling backup

Gmail → Google Pub/Sub → authenticated webhook → recent OTP scan. Keep [minute polling](gmail-polling.md) active: it is the fallback **and the heartbeat that drives daily watch renewal**. Push-only without a renewal scheduler is not supported by this starter.

## 1. Google Cloud setup

Create your own Google Cloud project. Enable Gmail API and Cloud Pub/Sub API. In Google Auth Platform configure your own application name, support contact, audience and **only** `https://www.googleapis.com/auth/gmail.readonly` for mailbox access. Add your own accounts as test users while Testing.

Create a **Desktop app** OAuth client. Download its client JSON to `.local/google-client.json`, mode 600. Do not commit it. This starter's local PKCE callback listens at `http://127.0.0.1:8765/callback`; the token exchange happens on your own machine. You do not need an OAuth redirect to the public inbox for this flow.

Testing grants with Gmail access expire after seven days. Production publishing removes that Testing-only limit for new grants, but is **not** Google verification. Google can still revoke/expire tokens for other reasons. Production configuration can require a public app homepage, privacy page and authorized domain. Use your own pages reflecting your deployment; don't reuse the maintainer's personal privacy policy. A personal-use exception may apply; public distribution of an app asking other people's Gmail access can require restricted-scope verification and security assessment. Read Google's rules before doing that. Each self-hoster uses their own project and data; this repository does not provide a shared OAuth app.

## 2. Topic, delivery identity and subscription

Use these example names in your project:

1. Create topic `gmail-changes`.
2. On that topic grant **Pub/Sub Publisher** to `gmail-api-push@system.gserviceaccount.com`.
3. Create service account `otp-push` for authenticated notification delivery. It needs no Gmail roles, project-owner access or downloaded key.
4. Ensure the Google Pub/Sub service agent can mint tokens for that delivery account. Per Google's authenticated-push guide, grant the required Service Account Token Creator permission to `service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com` on the delivery account if not already granted. The principal configuring the subscription also needs permission to act as that service account.
5. Create push subscription `otp-inbox-push` on `gmail-changes`:
   - URL: `https://YOUR-DOMAIN/v1/gmail/push`
   - Authentication: on, using `otp-push@PROJECT_ID.iam.gserviceaccount.com`
   - Audience: exactly that webhook URL
   - Ack deadline: 60 seconds; exponential retries, e.g. 10–600 seconds.

The backend checks Google's signature, issuer, audience, verified service-account identity and token lifetime, then the exact subscription and configured mailbox. Unsigned requests return 401. Don't replace this with a secret URL.

## 3. Private config and account consent

Edit `.local/settings.json` and add `gmail_push` (replace every capital placeholder):

```json
{
  "clientId": "YOUR_DESKTOP_CLIENT_ID",
  "clientSecret": "YOUR_DESKTOP_CLIENT_SECRET",
  "topic": "projects/PROJECT_ID/topics/gmail-changes",
  "subscription": "projects/PROJECT_ID/subscriptions/otp-inbox-push",
  "audience": "https://YOUR-DOMAIN/v1/gmail/push",
  "serviceAccount": "otp-push@PROJECT_ID.iam.gserviceaccount.com",
  "refreshTokens": {}
}
```

This is the value of the new `gmail_push` property, not a replacement for the whole settings file. Use the client ID/secret from `.local/google-client.json`. Source IDs must match your existing configured mailboxes.

Run locally for each source:

```sh
python3 email/connect-push.py personal
# Open the printed authorization URL in a browser on this machine.
# Confirm the exact account and read-only scope; finish consent.
```

Keep the process running until it prints `connected: true`. It verifies the Gmail profile equals the configured mailbox, saves its refresh token privately and regenerates `.local/server.env`. It never prints the token. The printed authorization URL contains temporary PKCE/state values; don't share it. An unsuccessful callback saves no credential for that account. Never authorize accounts you don't control or have permission to access.

Import the new `GMAIL_PUSH_CONFIG` value from `.local/server.env` into the host and redeploy once after all accounts connect. Don't replace unrelated runtime settings. If you move from Testing to Production later, obtain fresh grants for each account and update hosting again.

## 4. Verify, renew and stop

Ask your agent to list recent metadata. Every configured account should show `push_status: watching`, a future `watch_expires_at` and healthy checks. A watch lease commonly expires within seven days; the backend renews daily **when authenticated collector heartbeats arrive**. This watch expiry is different from OAuth grant expiry.

Request a real sign-in email to your account. Match and claim it for that login. `capture_method: gmail_push` proves the entry arrived via push; `email_poll` proves fallback. `last_push_at` alone proves a notification, not delivery of a particular OTP. Push returns success only after scan/delivery finishes; transient failure returns 503 so Pub/Sub retries. Duplicate message IDs are suppressed during the current runtime.

No immediate push? Check Gmail publisher permissions, Pub/Sub metrics/retry logs, delivery audience, account config and Google token access. Keep the minute fallback running. Do not log body data.

To stop, revoke OAuth access, remove refresh tokens from config, disable the push subscription and stop polling separately. A backend restart clears claim reservations and can reload still-valid recent email. See [security](../SECURITY.md).

Official references: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push), [authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions), [OAuth token expiry](https://developers.google.com/identity/protocols/oauth2), [verification exceptions](https://support.google.com/cloud/answer/13464323).
