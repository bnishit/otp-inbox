# Synthetic SMS benchmark

This is an opt-in, paid API experiment, separate from the running inbox. It never reads captured messages or writes into a browser. All fixtures are synthetic, including codes, card suffixes, amounts, account references and URLs.

Run with an explicitly authorised `OPENAI_API_KEY` in the environment or an ignored `.env.local` file:

```bash
bun run benchmarks/run.ts --out .local/sms-ai-benchmark.json
python3 benchmarks/report.py --input .local/sms-ai-benchmark.json --output .local/sms-ai-benchmark.html
```

The script uses one fixed fixture/prompt/schema hash, checkpoints results, resumes successful cases without paying again, and stops on API errors, more than 200 requests per invocation or more than $1 of recorded estimated usage. Three in-flight requests can finish after a stop. Failed or interrupted requests can have unreported charges; the cap is a guard, not a Platform billing limit. Do not tune the prompt against this set and then claim an independent evaluation.

The comparison measures the existing code extractor, one structured Responses call, and Decisions routing followed by extraction for relevant categories. Category and metadata features are not supported by the existing parser and are reported separately. API calls use GPT-6 Luna; extraction sets reasoning to none and Responses storage to false. Costs are estimates from returned token usage and documented standard rates, not a billing invoice. API abuse-monitoring policies still apply.

A space-based iPhone trigger misses messages with no spaces. This benchmark starts after message intake and does not verify the installed phone automation or change forwarding.
