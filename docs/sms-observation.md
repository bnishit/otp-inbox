# SMS AI observation mode

Observation mode compares one AI prediction with the existing parser. The existing parser alone controls inbox entries, review status, claims and browser filling. Predictions cannot create an inbox item, replace its code, release a secret or trigger an action. Email capture is unchanged.

## Data flow and retention

Enable with `OTP_AI_SHADOW=true` and an authorised `OTP_AI_OPENAI_KEY` on the server. Both are required; observation is otherwise off. Only authenticated, fresh SMS requests with a valid message are observed. This includes SMS rejected by the current parser as non-OTP, so classification coverage can be compared. The installed phone forwarding setup determines which SMS reach this endpoint; observation does not widen that capture.

The whole incoming SMS text is sent to OpenAI's Responses API. The benchmarked GPT-6 Luna prompt/schema is shared with the experiment and uses `store:false`, no tools, no URL following, and a ten-second timeout. OpenAI's API data policies still apply; `store:false` is not a promise of zero abuse-monitoring retention. The key is sent only in the API authentication header and never returned in diagnostics.

Comparisons keep only aggregate counts, category counts, token totals and elapsed time. They do not keep SMS text, extracted codes, sender/service/account values, per-message IDs, code hashes or per-message model responses. A private in-memory hash of each message suppresses duplicate API requests for ten minutes; it is never exposed. At most two requests are active. Incoming capture never waits for AI. Busy, duplicate and skipped requests are counted.

## Limits and diagnostics

The default is at most 100 API requests per UTC day per process. The deduplication map and aggregates reset on restart, or with the next SMS of a new UTC day after outstanding requests finish. Multiple replicas or restarts can increase total daily calls; this is not a hard account billing cap. Provider failures and invalid predictions remain counters and cannot affect inbox behavior. A failed comparison is not proof that either parser was correct.

POST an empty JSON object to `/v1/observation` with an existing reader key to read the current snapshot. Phone/email ingest keys cannot read it. The response contains mode, model, window, configured limit, in-flight count, aggregate comparison/category counts, token totals and total elapsed milliseconds. There is no public dashboard or new MCP tool.

Comparison buckets are `same_code`, `both_none`, `ai_only_code`, `parser_only_code`, and `different_codes`. An agreement measures agreement, not ground-truth accuracy. Requests and failures, invalid codes, duplicate inputs and skips are separate counters. Observed data is not used to tune or alter the current parser automatically.

Turn observation off by setting `OTP_AI_SHADOW=false` and deploying. Do not broaden the existing inbox or Google OAuth scopes. No Chrome extension reload is needed for a server-only rollout. Test deployments and source equality separately from observing actual production SMS; never call synthetic checks a real phone-delivery test.

## Verification

Run `bun test`. Observer tests cover flag/key gating, bounded concurrency, deduplication and request limits, time-window resets, literal code checks, failures, secret-free snapshots, reader-only diagnostics, non-blocking capture and unchanged claim results.

The synthetic benchmark lives in [benchmarks](../benchmarks/README.md). Its observed results do not establish accuracy on arbitrary live SMS. Begin with observation and review aggregate disagreements before proposing any use of AI-selected codes for filling.
