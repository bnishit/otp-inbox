# Android SMS → your inbox (Tasker recipe)

**Status: documented recipe; not tested on a physical Android phone.** The server accepts the same SMS payload from either platform. Tasker may require a paid license and SMS permissions. RCS and app notifications are not included.

## Setup

1. Deploy your [private HTTPS backend](deploy.md).
2. Install Tasker from its official source. Create Profile → Event → Phone → **Received Text**, type SMS. Leave sender/content unrestricted for the local filter below, or narrow to chosen senders. Grant required SMS access. Check the phone's background/battery settings if events stop when locked.
3. Link a new task. Add a **JavaScriptlet** action and paste [tasker-payload.js](../examples/tasker-payload.js). It checks for OTP wording on-device and builds JSON safely. `%SMSRB` is the received body; `%SMSRF` is the sender.
4. Add a **Stop** action if `%otp_payload` is empty (or not set). No ordinary message should be sent when the filter doesn't match.
5. Add **HTTP Request**:

   | Field | Value |
   | --- | --- |
   | Method | POST |
   | URL | `https://YOUR-DOMAIN/v1/sms` |
   | Headers | `Content-Type: application/json` and `Authorization: Bearer YOUR_SMS_WRITE_KEY`, one per line |
   | Body | `%otp_payload` |
   | Timeout | 30 seconds |

   Use `ingest_token` from your private `.local/settings.json`. Keep certificate checking on. The key belongs in Tasker's private configuration, not a shared task export.

6. Set the task's collision handling to queue runs if supported, rather than dropping a new run. Tasker's SMS globals represent the latest received message, so burst arrivals can still race; snapshot them into local variables at task start if customizing for heavy use. This recipe is for personal low-volume SMS, not a durable message queue.

## Test and limits

Run backend smoke first. Then receive a real worded login SMS on this phone, including a locked-screen test. Confirm the agent sees matching service/time metadata and can claim for that login. HTTP success alone is not enough: inspect `accepted` and any `reason` in the response without logging the original message or code.

The script uses task execution time, not an independently verified delivery timestamp. If your Android build doesn't deliver certain verification SMS to third-party apps, this recipe won't capture them. Do not silently expand to notification access: that is broader access with different privacy implications. This starter captures neither RCS nor WhatsApp nor bare numeric-only texts. The local filter may miss unfamiliar wording. Adapt it deliberately and test again.

For failure recovery, rerun the task only while the original timestamp/code remains valid; do not replace an old timestamp with “now” to replay expired messages. There is no persistent retry queue.

Official Tasker references: [Received Text](https://tasker.joaoapps.com/userguide/en/help/eh_received_sms.html), [HTTP Request](https://tasker.joaoapps.com/userguide/en/help/ah_http_request.html), [SMS variables](https://tasker.joaoapps.com/userguide/en/variables.html), [JavaScript support](https://tasker.joaoapps.com/userguide/en/javascript.html).
