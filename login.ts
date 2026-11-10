export type LoginLinkRule = {
  service: string; sender: string; origin: string; pathname: string;
  parameter: string; location: 'query' | 'fragment'; max_age_seconds: number;
};

const URL_TEXT = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/gi;
export const withoutUrls = (text: string) => text.replace(URL_TEXT, '[link hidden]');
export const linksIn = (text: string) => [...new Set(text.match(URL_TEXT) || [])];
export const emailAddress = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 320) return null;
  const match = value.trim().match(/^(?:[^<>\r\n]*<)?([^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+)>?$/);
  return match ? match[1].toLowerCase() : null;
};

export function validateLinkRules(value: unknown): LoginLinkRule[] {
  if (!Array.isArray(value) || value.length > 30) throw Error('Invalid login link rules');
  for (const r of value) {
    try {
      const url = new URL(r.origin);
      if (!r.service || typeof r.service !== 'string' || r.service.length > 100 ||
          emailAddress(r.sender) !== r.sender || url.protocol !== 'https:' || url.origin !== r.origin ||
          !/^\/[a-zA-Z0-9/_-]*$/.test(r.pathname) || !/^[a-zA-Z0-9_-]{1,40}$/.test(r.parameter) ||
          !['query','fragment'].includes(r.location) || !Number.isInteger(r.max_age_seconds) ||
          r.max_age_seconds < 1 || r.max_age_seconds > 600) throw Error();
    } catch { throw Error('Invalid login link rules'); }
  }
  return value;
}

export function parseLoginLink(message: string, sender: string, authenticatedDomain: unknown, rules: LoginLinkRule[]) {
  const urls = linksIn(message);
  if (!urls.length || !/\b(?:one[ -]?time|magic|sign[ -]?in|log[ -]?in|verify|verification|reset)\b/i.test(withoutUrls(message))) return null;
  const codeNotice=/\b(?:otp|code|passcode)\b/i.test(withoutUrls(message));
  const linkAction=/\b(?:magic|one[ -]?time|sign[ -]?in|log[ -]?in|verification)\s+link\b|\b(?:click|open|follow|use)\b[^\n]{0,80}\b(?:link|button)\b|\b(?:sign[ -]?in|log[ -]?in|verify(?: your)?(?: email| account)?|reset(?: your)? password)\s*:?\s*https?:/i.test(message);
  const configuredTarget=urls.some(value=>{try{const u=new URL(value);return rules.some(r=>r.origin===u.origin&&r.pathname===u.pathname);}catch{return false;}});
  // Footer URLs in a code notice are not sign-in links. Known targets still keep mixed mail under review.
  if(codeNotice&&!linkAction&&!configuredTarget)return null;
  const address = emailAddress(sender);
  const review = (reason: string) => ({url: null as string|null, origin: null as string|null, service: null as string|null,
    candidateCount: urls.length, expiresIn: 600000, reason});
  if (urls.length !== 1) return review('multiple_login_links');
  let url: URL;
  try { url = new URL(urls[0]); } catch { return review('unsupported_login_link'); }
  if (url.protocol !== 'https:' || url.username || url.password) return review('unsupported_login_link');
  const rule = rules.find(r => r.sender === address && r.origin === url.origin && r.pathname === url.pathname);
  if (!rule) return review('unsupported_login_link');
  if (authenticatedDomain !== address?.split('@')[1]) return review('unverified_sender');
  const params = rule.location === 'fragment' ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
  const token = params.get(rule.parameter);
  if ((rule.location === 'fragment' ? url.search !== '' : url.hash !== '') ||
      [...params.keys()].some(k => k !== rule.parameter) || params.getAll(rule.parameter).length !== 1 ||
      !token || !/^[A-Za-z0-9_-]{16,2048}$/.test(token)) return review('unsupported_login_link');
  return {url: urls[0], origin: url.origin, service: rule.service, candidateCount: 1,
    expiresIn: rule.max_age_seconds * 1000, reason: null};
}
