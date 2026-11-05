# Recipient aliases and approved sign-in links

A connected mailbox and the address used for a login can differ. Preserve the source-bound `mailbox` and the delivered `account` separately. Existing source keys cannot create available entries for arbitrary accounts.

## Private configuration

Add an `aliases` array to an existing `mailboxes` entry in private settings. These are recipient mappings inside an already connected mailbox, not additional Gmail accounts. Only map an address after checking its delivery headers in that mailbox. Do not replace the source token, primary email or unrelated fields.

Add a top-level `login_link_rules` list to the same private settings:

```json
{
  "login_link_rules": [{
    "service": "Afterspan",
    "sender": "signin@example.test",
    "origin": "https://afterspan.example.test",
    "pathname": "/app",
    "parameter": "sign-in",
    "location": "fragment",
    "max_age_seconds": 600
  }]
}
```

Replace the example with the reviewed service's exact sender and origin. Afterspan's owning source constructs `/app#sign-in=...` and gives login links 15 minutes. Keep the bridge's ten-minute maximum; never use a real token as a rule or example. Query-token services can use `location: query` with their exact parameter. Unknown rules are disabled by default.

The existing setup renderer emits `OTP_LOGIN_LINK_RULES` alongside the other settings. Regenerate without resetting existing client or source credentials. Review runtime deltas before deploying. This implementation does not change the deployed settings, collector, sources or Google scopes by itself.

## Capture and validation

Push and polling share `email/mail.js`. Both preserve relevant HTML anchor targets and send minimal recipient evidence plus a sender domain only when Gmail's `mx.google.com` Authentication-Results reports DMARC pass. Other authentication headers are not forwarded. Gmail-authenticated domain must match the exact configured sender's domain. This is a delivery-domain check, not proof that a sender's account can never be compromised.

A single delivered recipient must match the source's primary address or approved alias. Conflicting To/delivery addresses or multiple To addresses are rejected rather than guessed, so some forwarding, BCC and mailing-list cases need manual review. Old collectors without recipient evidence retain primary-mailbox behavior for compatibility; they cannot fix alias capture until updated.

Available links require HTTPS, exact sender, exact origin and path, authenticated sender domain, one token parameter, no credentials in URL, and an explicitly bounded lifetime. Extra invitation/plan/redirect parameters are review-only. Multiple links, unsupported formats or mixed code/link mail stay review-only. No URL is fetched during capture or listing.

Numeric code responses keep `code`. Link claims return `link`, with `secret_type: link`; both use the existing reservation/expiry rules. List and wait add `mailbox`, `secret_type`, `link_origin` and `review_reason`, but never return a secret URL. URL contents are removed before code extraction and preview generation. URLs cannot supply numeric OTP candidates.

## Diagnostics and rollout

Each source exposes bounded reason counters in `capture_counts`: accepted, duplicate, recipient_not_approved, ambiguous_recipient, unsupported_login_link, unverified_sender and other review/rejection reasons as encountered. Counts contain no message text or identifiers and reset on runtime restart. They are cumulative, not evidence about a specific login or a durable audit trail. Search truncation/source health still need separate inspection. Historical failures remain unrecoverable after entry expiry.

Deploy the reviewed backend and update the generated Apps Script collector together. Keep push and minute polling; no new OAuth scopes or mailbox grants. Verify a synthetic alias link through push and fallback, then a separately authorized fresh real sign-in using exact account/service/request time. Compare capture, claim and caller-visible sign-in separately. Restore the prior backend, collector and only the new mapping/rules if readback fails. Restarts reset claims and can reload still-valid mail; use a fresh login for the next attempt.
