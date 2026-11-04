# Gmail flow 1: one-minute polling

This is the simplest email setup. Each account runs its own private Google Apps Script collector. It reads recent OTP-like mail, sends a small excerpt and reports health. There is no Gmail send/delete permission.

## Install once per mailbox

1. Run [setup](deploy.md) with `--mailbox personal=you@example.com` (choose any source name). Deploy the generated `OTP_EMAIL_SOURCES` server setting.
2. Sign into that exact Google account, visit [script.google.com](https://script.google.com/) and create a private project named OTP Inbox Collector.
3. Paste **the generated** `.local/email/personal/Code.gs` into Code.gs. Do not paste `email/collector.gs` directly: it is an unconfigured source template.
4. In Project Settings, show `appsscript.json` in the editor. Replace it with `.local/email/personal/appsscript.json`. It declares read-only Gmail, external requests and trigger management.
5. Run `installOtpInbox`. Review Google's permission page for the exact account and scopes. For a private script Google may show an unverified-app notice; continue only after you have inspected the source and confirmed the developer/project. Company admins may block access.
6. Confirm the Apps Script Triggers screen has one `pollOtpInbox` time trigger at one-minute frequency. Running install again does not add duplicate triggers. The code checks the signed-in mailbox and refuses the wrong account.
7. Ask the connected agent to list recent metadata. `sources` should show that mailbox with `status: ok` and a recent `checked_at`.

Repeat using each account's **own generated folder** and account-bound key. Do not share the Apps Script project or deploy it as a public web app. No web-app deployment is needed.

## Real email verification

Request a login code from a service you own to that mailbox. Have the agent filter `channel: email`, exact `account`, `service`, and `since` from the request. Complete the login using a matching claim. If none arrives, check Apps Script Executions, Spam placement, trigger authorization and backend source config. Don't log raw mail or codes while debugging.

## Scope and failure behavior

Each run searches the last ten minutes, up to 50 recent matching messages, excluding Spam/Trash and sent-only copies. A self-addressed email delivered to Inbox is eligible. Only subject and nearby OTP text are sent, plus sender, message ID and original Gmail timestamp. Unrelated bodies and attachments are not forwarded, though the read-only Gmail permission is broader than the code's query.

A heartbeat becomes stale after three minutes without a successful check. Apps Script quotas and scheduling apply; one minute is a configured interval, not a delivery guarantee. Very short-lived codes may expire before collection. Shared copies expire within ten minutes or shorter detected validity; Gmail originals are untouched.

Stop by deleting the `pollOtpInbox` trigger, revoking the Google app and removing its write-only key from backend config. Revoking the separate Gmail Push app will not stop this independent collector.

Official references: [Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
