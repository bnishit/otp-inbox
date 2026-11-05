# A bridge for one useful next action

The starting user is at a desktop login while the proof arrives on their phone or email. The product should bring the right next action to that page: fill a code, copy it, or open a verified sign-in link. The current source build covers automatic arrival discovery and explicit next actions. It does not expand inbox permissions.

## Product choice

Use the existing short-lived inbox and claim path for all clients, including the Chrome helper. This keeps one expiry rule and one owner for each secret. The browser shows captured login items automatically, with a badge and optional alerts. Owners can enable automatic login filling per site with a matching service/channel/account. Those sites receive a fresh matching code in the selected tab without a per-login click. Other sites retain explicit filling. It does not inspect every page or open sign-in links automatically.

The main trap is treating every message as an instruction. A message may contain a link to a transaction, an amount, a phishing request, a password reset or a code that approves a payment. The same action button must not mean both “sign me in” and “approve this charge.” Sender names, page text and message content cannot grant permission.

## Next expansion: message actions with named rules

A general-purpose edition can reuse intake and source health, but needs a separate opt-in contract for non-login messages:

| Step | Example | Product boundary |
|---|---|---|
| Collect | A bank transaction SMS arrives | Choose source and message types; do not turn on all-message capture silently |
| Classify | “Transaction receipt”, “delivery”, “appointment” | Labels are suggestions with evidence; uncertainty is visible |
| Extract | Amount, currency, transaction reference | Preserve source; never invent an amount or recipient |
| Propose | “Open this transaction in your ledger” | Show exact destination and operation before use |
| Execute | Open a read-only transaction page or send structured data to a chosen tool | Per-destination authorization, private credentials, idempotency, receipt and undo where available |
| Review | Duplicate receipt or failed action | Retry without double-posting; user can disable the rule |

Do not put long-lived transaction history into the ten-minute secret inbox. Keep login secrets in the short-lived store; any opted-in record store must have its own retention/delete/export rules and redact secrets before classifying or sending to another system. No external model should receive raw login mail by default.

## Concrete first rule after login

“When a receipt from my approved source arrives, suggest its category and offer **Open transaction** at my approved read-only destination.” Start with a manual click, an exact destination and a visible extracted reference. Never execute a URL just because it appeared in SMS. A later **Send to ledger** rule must separately name the destination, allowed fields and duplicate policy. Payment or security changes always remain separate actions.

## What to measure

Use counts without message content: request-to-ready time, missing-source rate, review-only rate, wrong-page blocks, fill success by field type, link-open requests and fresh-login completion. Separate notification creation, user click, successful fill, service sign-in and a financial/business outcome. Do not infer success from a 200 response or a notification.

## Release sequence

1. Review this login implementation and its synthetic browser evidence.
2. Authorize the backend/collector rollout and the minimal recipient/link/client configuration, then verify one fresh real sign-in.
3. Pilot the unpacked helper before store submission; test closed/locked phone, native banner delivery, iframe fallbacks and supported websites with explicit users.
4. Define one non-login rule and its scope before collecting new message types or adding another destination.

The next release decision is the login pilot. General message automation remains a scoped follow-on; no new SMS categories, financial writes, external forwarding or inbox permissions are enabled by this build.
