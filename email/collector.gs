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

function otpMailText(part, decode) {
  const parts = part.parts || [];
  const plain = parts.filter(p => p.mimeType === 'text/plain');
  const selected = plain.length ? plain : parts;
  if (selected.length) {
    const text = selected.map(part => otpMailText(part, decode)).join('\n');
    if (plain.length && !/https?:\/\//i.test(text)) {
      const html = parts.filter(p => p.mimeType === 'text/html').map(part => otpMailText(part, decode)).join('\n');
      if (/https?:\/\//i.test(html)) return text + '\n' + html;
    }
    return text;
  }
  if (!/^text\/(plain|html)$/.test(part.mimeType) || !part.body?.data) return '';
  const encoded = part.body.data;
  const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
  let text = decode(padded);
  if (part.mimeType === 'text/html') text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => label + ' ' + href).replace(/<\/?(?:p|div|br|tr|td|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return text.slice(0, 60000);
}

function otpMailExcerpt(subject, body) {
  if (/^security alert$/i.test(subject.trim()) && /you allowed\b/i.test(body)) return '';
  const label = /\b(?:otp|one[ -]?time|verification|security code|authentication code|auth code|login code|log[ -]?in code|sign[ -]?in(?: code| link)?|magic link|login link|passcode|reset code)\b|验证码/i;
  const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const indexes = new Set();
  for (let i = 0; i < lines.length; i++) if (label.test(lines[i])) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) indexes.add(j);
  if (!indexes.size && !label.test(subject)) return '';
  const selected = [...indexes].sort((a,b) => a-b).map(i => lines[i]);
  if (!selected.length) {
    const standalone = lines.filter(line => /^(?:[0-9]{4,8}|[A-Z0-9]{4,12}(?:-[A-Z0-9]{3,6})?)$/.test(line));
    selected.push(...(standalone.length ? standalone : lines.slice(0, 4)));
  }
  return (subject.slice(0, 200) + '\n' + selected.join('\n')).slice(0, 6000);
}


function otpMailIdentity(headers) {
  const values = name => headers.filter(h => h.name.toLowerCase() === name).map(h => h.value);
  const address = value => {
    const match = String(value || '').trim().match(/^(?:[^<>\r\n]*<)?([^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+)>?$/);
    return match ? match[1].toLowerCase() : null;
  };
  const delivered = values('delivered-to');
  const to = values('to');
  const recipient = address(delivered[0] || to[0]);
  const conflict = !recipient || to.length > 1 || (to.length && (!address(to[0]) || address(to[0]) !== recipient));
  const auth = values('authentication-results').find(value => /^mx\.google\.com;/i.test(value.trim()));
  const dmarc = auth?.match(/(?:^|;)\s*dmarc=pass\b[^;]*\bheader\.from=([a-z0-9.-]+)(?:\s|;|$)/i);
  return {...(delivered.length || to.length ? {recipient, recipient_conflict:!!conflict} : {}),
    ...(dmarc ? {authenticated_domain:dmarc[1].toLowerCase()} : {})};
}
