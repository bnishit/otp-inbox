// Tasker JavaScriptlet. %SMSRB and %SMSRF are Tasker's incoming SMS variables.
// JSON.stringify preserves quotes and line breaks in real SMS messages.
var sms = global('SMSRB') || '';
var label = /\b(?:otp|one[ -]?time|verification|security code|authentication code|login code|sign[ -]?in code|passcode|reset code)\b|验证码|सत्यापन कोड/i;
setLocal('otp_payload', label.test(sms) ? JSON.stringify({
  capture_method: 'android',
  message: sms,
  sender: global('SMSRF') || '',
  received_at: new Date().toISOString()
}) : '');
