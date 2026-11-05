# Bring a requested login to the page you are using

The Chrome helper watches one service and account for up to two minutes. A code can fill a clear verification field or be copied. An approved email sign-in link can open in the selected login tab. Nothing fills, copies or opens just because a message arrived.

## Install and connect

This is a source build for review, not a Chrome Web Store release. Chrome 124 or newer is required. In an isolated browser profile first:

1. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension` folder. Pin the helper.
2. Use a dedicated browser client entry in the existing private `clients` configuration. Preserve all other client keys; do not reuse an ingest/source key. Provisioning and deployment of that new client are separate release steps. Keep the permanent key in your private credential store. Do not put it in repository files or a distributable extension package.
3. On the login page, click the bridge icon, check the website in the launcher, then choose **Open login helper**.
4. Connect using the private bridge origin and browser client key. Chrome requests network access to the bridge host only. This does not add Gmail or phone inbox permissions. Chrome host patterns apply to the host, while the helper restricts requests to the exact configured origin.
5. The connection key is kept in `chrome.storage.session`, not synced or written to local storage. Reconnect after Chrome restarts or the extension reloads. Disconnect also removes that bridge host grant.

The bridge's normal REST endpoints are used; browser-origin access to `/mcp` stays blocked. No broad CORS header is added. The bearer key never enters the login page, page scripts or a notification.

## One login, one next step

Choose the service, Email or Phone SMS, and the exact recipient email when relevant. Start watching **before** asking the service for a new code or link. Keep the panel open; a closed panel does not watch in the background. Existing phone forwarding and mail collectors must already be working.

- **One code:** the card names the account and received/expiry times. **Fill code** checks that you are still on the selected tab and website. It fills one marked field or a clear group of digit fields. **Copy code** is the fallback for unsupported fields. The clipboard retains the code until replaced; the helper never reads the existing clipboard or clears something you may have copied later.
- **One approved link:** the card shows the destination origin, never the token. It opens only when the link belongs to the exact selected website and the server's service rule accepted it. The original link is never preview-fetched, shortened, rewritten or automatically opened.
- **Two possible matches:** no action buttons. Request a fresh login and start a new watch before requesting it; narrow the service/account when possible. Time alone is not a reason to pick the newest.
- **Unsupported or unclear item:** review-only. Use the original message. Sender text is not an instruction or permission to run an action.
- **Optional alert:** opt in with **Notify me**. Chrome asks for notification access separately. The message only says the login is ready. The panel must remain open; operating-system settings and Focus modes may suppress banners. Notification creation is not proof the user saw one.
- **Change login tabs:** invoke the launcher on the new tab, or use **Use current page** after giving that tab the toolbar gesture. The previous watch stops and its cards clear.

Filling emits normal input/change events but does not press Submit. Some websites submit automatically on input. Payment, password reset and security-setting codes still require authorization for that specific action.

## Coverage and limits

| Login case | Behavior in this version |
|---|---|
| SMS code forwarded by existing iPhone/Android setup | Supported; literal service text and fresh request time |
| Email code to primary address | Supported |
| Email code or link to approved alias in existing mailbox | Supported; separate source mailbox and recipient |
| Authenticated email sign-in link, exact configured destination | Supported; one link and one token only |
| Unknown email link service, custom app deep link, tracking redirect | Review-only when captured; no arbitrary navigation |
| SMS-only sign-in link | Unsupported in this version; phone filters may not capture it |
| Email with both a code and a sign-in link | Review-only; no secret chosen for you |
| One marked code field or clear split-digit fields | Supported in the top frame |
| Unmarked inputs, cross-origin iframes, closed shadow DOM, canvas, browser-owned screens | Copy/paste fallback; never guess a password/search field |
| Expired or already-consumed service token | Ask for a fresh login; bridge cannot prove service validity |
| Passkeys, hardware security keys, authenticator-app TOTP, push approval, QR/device login, recovery codes | Continue with that provider's flow; this helper does not generate, intercept or bypass it |
| OAuth/SSO redirect or CAPTCHA | Continue with the provider; only a separately delivered supported login item is eligible |
| Bank/payment, account recovery or changing security settings | Access to an OTP is not authorization for that action |
| Phone app killed, network offline, delayed email, no sender/service context | Explain missing source/context; request fresh login after recovery |

The iPhone starter supplies no sender metadata and may miss bare codes/no-space texts. Android background limits and event races still apply. This release does not silently replace phone forwarding or collect all SMS.

## Recheck

Run `bun test`, the Python suite and the public-file audit. For actual DOM regression checks, run `python3 scripts/browser-check.py` with Node/npm and Chrome installed. It starts an isolated browser through the official Playwright CLI, runs the exact field-filling function on synthetic forms, and closes only that test session. `--config` can select another installed test Chromium; use a separate profile.

Manual release checks: launcher grants only the chosen tab; connect refuses a bad key; stop cancels a pending wait; wrong account/time is excluded; code fill and copy work; ambiguous results have no actions; link destination matches before open; navigation/tab changes prevent use; optional notifications contain no secret; disconnect removes session key and host permission. Use invented messages for screenshots. Then perform a separately authorized fresh real login for production readback.

Primary platform references: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [session storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
