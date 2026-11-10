# AI code extraction and guarded repair

The default bridge remains deterministic. `OTP_AI_SHADOW=true` keeps the older SMS-only observation mode: it compares a Responses prediction without changing a code. `OTP_AI_MODE=resolve` instead enables one Decisions request for captured SMS and email. Do not enable resolve mode until the actual API evaluation passes with the intended project key.

## How selection works

The application enumerates literal code-shaped tokens from one message. Decisions selects one supplied candidate and a verification purpose, or selects no code / ambiguity. It cannot generate a new code. Both answers require confidence of at least 0.9. This is a conservative operating threshold, not a calibrated guarantee. There are at most 64 candidates and four active requests. Messages beyond the size/candidate limit remain with the rules path.

The selected literal is checked locally, redacted in metadata and retained only for the existing short-lived inbox. Account binding, service matching, expiry, claims, link authentication and browser action settings still apply. Approved code-plus-link messages remain review-only. Code notices with ordinary footer URLs are not mistaken for sign-in links.

The AI request receives the captured SMS or minimized email excerpt. It has no tools, cannot follow URLs, and cannot edit source, send messages or approve a payment. Decisions API data controls apply. Do not describe it as zero retention unless that account has eligible Zero Data Retention enabled.

One retry handles transient failures within a shared ten-second deadline. Exhausted API credits open a five-minute circuit and are reported as a funding problem. Known single-code rule results remain usable during an outage; ambiguous rule results are not released. The default limit is 1,000 requests per UTC day per process, not an account billing cap. Restarting or adding replicas can increase total calls.

## Guarded self-healing

The repair workflow checks aggregate production counters every six hours, or can run manually. Its separate diagnostic token can read only `/v1/observation`; it cannot list or claim messages. Exhausted credits stop repair instead of generating a code change.

A reproducible failure must appear in the public synthetic corpus. Decisions can select known failed synthetic examples to add to `otp-examples.json`. It cannot write arbitrary source. Only this data file may change. The repaired version must pass all offline tests, the full 100-case actual API evaluation and 100 related synthetic mutation checks before a PR can auto-merge. Repository branch rules still apply. A changed main branch aborts the merge job.

If no synthetic case reproduces an incident, there is no automatic source change. Genuine ambiguity, new unsupported encodings, capture failures, expired codes and site permissions are not automatically declared parser bugs. The mutation set is related synthetic coverage, not an independent estimate of real-inbox accuracy.

With `OTP_POLICY_URL` set to the trusted repository's raw `otp-examples.json`, the server checks for merged example updates at most once every five minutes when a message arrives. Invalid/unavailable updates retain the last known valid examples. This updates code-selection guidance only; it cannot change authentication, expiry or browser permissions.

Required workflow configuration: secret `OTP_FORMAT_OPENAI_KEY`, read-only secret `OTP_DIAGNOSTICS_TOKEN`, and secret `OTP_BRIDGE_ORIGIN`. The same diagnostics token must be configured on the server. Auto-merge and Actions PR creation must be allowed by the repository. Scheduled runs also require repository variable `OTP_SELF_HEAL_ENABLED=true`; leave it off until actual API evaluation passes. Deploy and activate only after evaluating the intended API project.

## Evidence and verification

Run `bun test`, the Python suite and `python3 scripts/browser-check.py`. `bun run benchmarks/verify.ts --out .local/format-evaluation.json` evaluates 60 existing SMS fixtures plus 40 additional SMS/email cases through the actual Decisions API. Add `--holdout` for the related mutation set. Provider failures are never counted as correct no-code answers. The corpus contains no real messages, identifiers or live OTPs.

`POST /v1/observation` returns only aggregate counters, mode, model, limits and latency. No source text, codes, account identifiers or per-message results are exposed. The diagnostic credential is intentionally unable to access other inbox endpoints.

Official API reference: [Decisions](https://developers.openai.com/api/docs/guides/decisions).
