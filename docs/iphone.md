# iPhone SMS → your inbox

Uses Apple Shortcuts. Set up the [HTTPS backend](deploy.md) first. Your Shortcut contains only the SMS write-only key; don't share a personalized export.

## Generate and import on a Mac

From the repository:

```sh
python3 scripts/make_shortcut.py
shortcuts sign --mode people-who-know-me \
  --input '.local/OTP Inbox.unsigned.shortcut' \
  --output '.local/OTP Inbox.shortcut'
open '.local/OTP Inbox.shortcut'
```

Review the imported actions and add it to Shortcuts. Enable iCloud Shortcuts sync and confirm it appears on the iPhone. Signing options and import prompts can vary by macOS/iOS version; `shortcuts sign --help` shows the options available locally. Never distribute the signed file: it contains your private ingest key. The Python generator's plist is based on the tested private predecessor; a new OS version can require the manual path below.

## Add the iPhone message trigger

Personal automations live on the iPhone; Mac sync of forwarding actions does not create the SMS trigger.

1. Open Shortcuts → Automation → new personal automation → Message.
2. Select a message-text filter containing **one literal space**, if the UI requires a filter. This covers ordinary worded OTP SMS. Choose Run Immediately, or turn Confirm Before Run off, depending on your version.
3. Run the `OTP Inbox` shortcut with the **incoming message text as Shortcut Input**. On versions where Automation lives inside the shortcut editor, add the Message trigger there with the same input and run settings.
4. Save. On the first network permission prompt, allow your own backend domain. Run once with synthetic input if needed to establish that permission before testing locked-phone capture.

Do **not** add several “Message contains” rules expecting OR behavior: Apple documents that multiple communication criteria must all match. The single-space trigger misses bare codes or texts without spaces. It is not an unconditional all-SMS trigger. Choose a narrower sender filter if you only want particular accounts.

The Shortcut's Match action is a service-independent local label filter. It forwards matching text; the backend extracts the literal code. Ordinary unrelated messages should not reach the endpoint, but this is a heuristic, not perfect classification.

## Manual fallback (no Mac)

Create a shortcut named OTP Inbox:

1. **Current Date → Format Date**, custom `yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX`.
2. **Match Text** in **Shortcut Input**, pattern below.
3. **Get Contents of URL**: `https://YOUR-DOMAIN/v1/sms`, method POST.
4. Add header `Authorization: Bearer YOUR_SMS_WRITE_KEY` using `ingest_token` from your private settings.
5. JSON body: `message` = Matches, `received_at` = Formatted Date. Keep these as variables, not their names typed as strings.

```regex
(?is)^(?=.*(?:\botp\b|one[ -]?time|verification|security code|authentication code|login code|sign[ -]?in code|passcode|reset code|验证码|सत्यापन कोड)).+
```

This manual pattern is a smaller starter filter than the generated Shortcut. Add a condition that stops when there are no matches if you want to avoid rejected empty requests. No sender metadata is supplied by this starter.

## Verify on your phone

Run the synthetic backend smoke test first. Then request one real login code for an account you own while the phone is locked. Have the agent search with that service and request time, then finish that login. A Shortcut notification alone doesn't prove inbox delivery. Do not paste the code into chat. Network failure, permissions or iOS scheduling can lose a delivery; the timestamp is the shortcut-run time, not verified SMS arrival time.

Source: [Apple communication triggers](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios).
