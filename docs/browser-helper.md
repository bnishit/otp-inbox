# Your codes and sign-in links arrive automatically

Connect the Chrome helper once per browser session. It then checks the existing inbox automatically, even with its panel closed. There is no per-login watch, timer, service form or account form to start.

## Everyday use

- A new captured OTP or approved email sign-in link appears in the recent inbox. The toolbar badge shows available items. Optional desktop alerts say only that a login item arrived; they never include the code, full URL, account or sender.
- Click the bridge icon to open the inbox. Each card shows its service/sender, account, received time and expiry. Codes and complete links stay hidden until an explicit action.
- **Copy code** works without selecting a browser page. Paste it only into the login you requested. Clipboard contents remain until replaced; the helper does not read the clipboard or clear something you copied later.
- **Fill code** is available after opening the helper on your login page. It checks the selected tab and website again, then fills a clear code field or split-digit group. It never presses Submit, though a website may submit on input.
- **Open sign-in link** opens an approved link in a new tab. It checks the exact HTTPS destination against the server's safe metadata. It does not overwrite the current tab or require you to open the service first. Some providers bind sign-in to the original browser context and may still reject a token.
- Nothing is claimed, copied, filled or opened on arrival. If multiple items match the same account/service, actions stay off. The optional **Narrow the inbox** controls help; **Show only arrivals from now** lets you request a fresh login without choosing the newest blindly.

## Delivery and connection limits

Background checks run about every 30 seconds while Chrome is awake; an open panel refreshes about every five seconds. These are polling intervals, not instant-delivery guarantees. Laptop sleep, Chrome throttling, forwarding delays, network failure and operating-system notification settings can delay or suppress an alert. Existing capture still has its own source limits.

The dedicated browser reader key stays in Chrome session memory, not synced or written to local storage. Closing the panel does not disconnect it. Restarting Chrome or reloading the extension clears that session; reconnect then. Persistent secure sign-in is not included in this source build. **Disconnect bridge** clears the cached inbox, badge, polling alarm and bridge host grant.

Every configured reader can access captured items across that deployment. Separate client keys isolate claims, not mailbox permissions. Background code calls metadata lookup only; it never calls claim. Cached metadata is allowlisted, bounded and removed on expiry. Seen IDs prevent repeated alerts across worker restarts during the session. First connection shows recent items silently rather than alerting about old mail.

## Install or update

Chrome 124 or newer is required. This is an unpacked source build, not a store release. Load the `extension` folder through Chrome's **Load unpacked** flow. Version 0.3 adds the `alarms` browser permission for background checks; Gmail scopes and phone/mailbox access do not change. For an existing installation, replace its files with the new build, reload it in Chrome and reconnect once. Do not use a source or phone ingest key as the browser reader key.

The helper requests network access only to the configured bridge host and uses `activeTab` for explicit page filling. Its key never enters the login page. The background worker does not read browsing history or inspect all tabs. Notifications are separately opt-in. The normal REST API is used; browser-origin `/mcp` remains blocked, with no broad CORS exception.

## Supported cases

| Case | Behavior |
|---|---|
| SMS/email codes captured by current sources | Automatic inbox, badge, explicit copy/fill |
| Approved alias inside a connected mailbox | Exact recipient kept separately from mailbox |
| Approved authenticated email sign-in link | Explicit open in a new tab |
| Unknown email link, mixed code/link mail, multiple matching items | Review-only; no guessing |
| SMS-only link or custom deep link | Unsupported; source filters may not capture it |
| Password/search/hidden fields, unclear fields, cross-origin frames | No guessed fill; use copy/paste |
| TOTP, passkeys, hardware keys, QR/device flows, push approval, CAPTCHA | Continue with the provider's own flow |
| Payments, recovery or security changes | OTP access is not authorization for those actions |

## Verification

Run `bun test`, the Python suite, public-file audit and `python3 scripts/browser-check.py`. Background tests cover arrivals without any panel/watch, badge updates, optional alerts, deduplication across worker restarts, expiry, network failures, disconnect races and rejection of web-page messages. Actual Chromium field regressions cover the fill function. A full extension pilot and fresh real sign-in are separate from local/simulated browser checks.

Primary platform references: [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [session storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [network access](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
