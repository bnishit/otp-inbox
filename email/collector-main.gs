const OTP_ENDPOINT = __ENDPOINT_JSON__;
const OTP_ACCOUNT = __ACCOUNT_JSON__;
const OTP_TOKEN = __TOKEN_JSON__;

function installOtpInbox() {
  const profile = gmailRead('profile');
  if (profile.emailAddress.toLowerCase() !== OTP_ACCOUNT.toLowerCase()) throw new Error('Wrong Google account. Use the mailbox shown in setup.');
  pollOtpInbox();
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'pollOtpInbox');
  if (!exists) ScriptApp.newTrigger('pollOtpInbox').timeBased().everyMinutes(1).create();
}

function pollOtpInbox() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return;
  let step = 'mailbox profile';
  try {
    const profile = gmailRead('profile');
    if (profile.emailAddress.toLowerCase() !== OTP_ACCOUNT.toLowerCase()) throw new Error('Wrong Google account');
    const start = Date.now() - 600000;
    const labels = '{otp "one time" "one-time" "verification code" "security code" "login code" "sign-in code" "sign in" "sign-in link" "magic link" "login link" "authentication code" passcode "reset code" 验证码}';
    const query = 'after:' + Math.floor(start / 1000) + ' -in:spam -in:trash ' + labels;
    step = 'mail search';
    const found = gmailRead('messages', {q: query, maxResults: 50});
    const cache = CacheService.getUserCache();
    for (const item of found.messages || []) {
      if (cache.get(item.id)) continue;
      step = 'message read';
      const mail = gmailRead('messages/' + encodeURIComponent(item.id), {format: 'full'});
      const labels = mail.labelIds || [];
      if (labels.includes('SPAM') || labels.includes('TRASH') || (labels.includes('SENT') && !labels.includes('INBOX'))) {cache.put(item.id, 'sent', 600); continue;}
      const received = Number(mail.internalDate);
      if (!Number.isFinite(received) || received <= start || received > Date.now() + 15000) continue;
      const header = name => (mail.payload.headers || []).find(h => h.name.toLowerCase() === name)?.value || '';
      const text = otpMailText(mail.payload, data => Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8'));
      const message = otpMailExcerpt(header('subject'), text);
      if (!message) {cache.put(item.id, 'skip', 600); continue;}
      step = 'candidate delivery';
      const receipt = otpPost('/v1/email', {...otpMailIdentity(mail.payload.headers || []), message, sender: header('from'), message_id: item.id, received_at: new Date(received).toISOString()});
      if (receipt.accepted || ['duplicate', 'expired', 'not_recognized_as_otp', 'recipient_not_approved', 'ambiguous_recipient', 'stale_or_missing_timestamp'].includes(receipt.reason)) cache.put(item.id, 'seen', 600);
    }
    step = 'health report';
    otpPost('/v1/source-heartbeat', {status: 'ok', checked_at: new Date().toISOString(), truncated: !!found.nextPageToken});
  } catch (error) {
    try {otpPost('/v1/source-heartbeat', {status: 'error', checked_at: new Date().toISOString()});} catch (_) {}
    const reason = String(error.message || 'Unknown error').replace(/https?:[^\s]+/g, '[service]').replace(/[0-9]/g, '#').slice(0, 180);
    throw new Error('OTP Inbox failed at ' + step + ': ' + reason);
  } finally {lock.releaseLock();}
}

function otpPost(path, body) {
  const response = UrlFetchApp.fetch(OTP_ENDPOINT + path, {method: 'post', contentType: 'application/json', headers: {Authorization: 'Bearer ' + OTP_TOKEN}, payload: JSON.stringify(body), muteHttpExceptions: true});
  if (response.getResponseCode() >= 400) throw new Error('OTP Inbox connection failed');
  return JSON.parse(response.getContentText());
}

function gmailRead(path, query = {}) {
  const suffix = Object.keys(query).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(query[key])).join('&');
  const response = UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path + (suffix ? '?' + suffix : ''), {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
  if (response.getResponseCode() >= 400) throw new Error('Gmail read failed with HTTP ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}
