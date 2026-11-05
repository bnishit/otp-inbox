export function otpMailText(part, decode) {
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

export function otpMailExcerpt(subject, body) {
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


export function otpMailIdentity(headers) {
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
