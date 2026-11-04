# Contributing

Keep this a small, single-owner, self-hosted project. Inspect the existing flow before adding a new one. Prefer shared parsing and transport schemas over copies. Never include real codes, messages, credentials, account addresses or private deployment receipts in issues, fixtures or screenshots.

Run Bun tests, Python setup tests and `python3 scripts/audit.py` before a PR. Changes to capture/expiry/claim behavior need meaningful tests using synthetic messages. Update the relevant guide when setup changes. A recipe is not a device test: include OS/client version and what was actually observed when reporting compatibility.

Device tests are especially useful for Android/Tasker and newer iOS Shortcuts. Instinct/Muse setup reports should name the supported credential mechanism without revealing keys. Don't weaken authentication to fix a compatibility issue.
