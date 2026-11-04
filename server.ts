import { timingSafeEqual, createHash } from 'node:crypto';
import {createMcp} from './mcp';
import {createGmailPush} from './email/gmail-push';

const RETENTION = 10 * 60_000;
const LABEL = /\b(?:otp|one[ -]?time(?: password| code| pin)?|verification(?: code)?|security code|authentication code|authorization code|auth code|login code|log[ -]?in code|sign[ -]?in code|access code|confirmation code|passcode|temporary (?:password|pin)|reset code|code|tac|mtan)\b|验证码|校验码|动态码|رمز التحقق|सत्यापन कोड/ig;
const BRAND = /\b(cashfree|amazon|google|gmail|microsoft|outlook|apple|openai|chatgpt|anthropic|claude|github|gitlab|slack|notion|razorpay|phonepe|paytm|whatsapp|telegram|instagram|facebook|linkedin|twitter|uber|ola|swiggy|zomato|airtel|jio|hdfc|icici|sbi|axis|kotak|adobe|dropbox|zoom|netflix|flipkart|mybillbook|flobiz)\b/i;
const responseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders });
const equal = (a: string, b: string) => !!b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function parseOtp(message: string, sender = '') {
  const normalized = message.normalize('NFKC');
  // Android SMS Retriever uses a trailing 11-character app hash, not another OTP.
  const text = /^<#>/.test(normalized)
    ? normalized.replace(/[ \t][A-Za-z0-9+/]{11}[ \t]*(?=\r?\n(?:-[^\r\n]+)?\s*$|$)/, ' ') : normalized;
  const labels = [...text.matchAll(new RegExp(LABEL))];
  const bare = /^[A-Z0-9-]{4,12}$/i.test(text.trim()) && /\d/.test(text);
  if (!labels.length && !bare) return null;
  if (/\b(?:promo|discount|coupon|tracking|referral|order) code\b/i.test(text) && !/\b(?:otp|one[ -]?time|verification|authentication|security code)\b/i.test(text)) return null;
  const tokens = [...text.matchAll(/\b[A-Z0-9]{4,12}(?:-[A-Z0-9]{3,6})?\b/ig)]
    .filter(m => (/\d/.test(m[0]) || (/^[A-Z]{4,12}$/.test(m[0]) && !BRAND.test(m[0]) && !/^(YOUR|THIS|THAT|VALID|NEVER|SHARE|WITH|ANYONE|PLEASE|ENTER|ONLY|MINUTES|SECONDS|PASSWORD|SECURITY|CONFIRM|REQUEST|RECEIVED|IGNORE|LOGIN|RESET|FROM)$/.test(m[0]))) &&
      (!/^\d+$/.test(m[0]) || m[0].length <= 8) && !labels.some(label => m.index! >= label.index! && m.index! < label.index! + label[0].length));
  // More than one plausible token is retained for review, never resolved by recency or guesswork.
  const codes = [...new Set(tokens.map(m => m[0]))];
  const serviceHint = (text.match(BRAND)?.[1] || sender.match(BRAND)?.[1] || null)?.toLowerCase() || null;
  const validity = text.match(/(?:valid|expires?|expiry)[^\d]{0,20}(\d{1,3})\s*(seconds?|secs?|minutes?|mins?)\b/i);
  const validFor = validity ? Number(validity[1]) * (/^s/i.test(validity[2]) ? 1000 : 60_000) : RETENTION;
  return { code: codes.length === 1 ? codes[0] : null, candidateCount: codes.length, serviceHint,
    expiresIn: Math.min(RETENTION, validFor), confidence: bare ? 'bare_code' : 'labelled',
    preview: codes.reduce((value, code) => value.split(code).join('[redacted]'), text).replace(/\b[A-Z0-9]*\d[A-Z0-9-]*\b/ig, '[redacted]').slice(0, 240) };
}

type EmailSource = { email: string; label: string; token: string };
type Entry = { capture_method: 'iphone' | 'android' | 'email_poll' | 'gmail_push'; channel: 'sms' | 'email'; account: string | null; id: string; message: string; sender: string; code: string | null; serviceHint: string | null;
  candidateCount: number; confidence: string; preview: string; received: number; expires: number; claimedBy?: string };

export function createBridge(ingestKey: string, clients: Record<string, string>, now = Date.now, emailSources: Record<string, EmailSource> = {}) {
  const entries = new Map<string, Entry>();
  const sourceHealth = new Map<string, { status: string; checked_at: string; truncated: boolean; push_status?:string; watch_expires_at?:string|null; last_push_at?:string|null }>();
  const seen = new Map<string, number>();
  const waiters = new Set<() => void>();
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const cleanup = () => {
    for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id);
    for (const [hash, expiry] of seen) if (expiry <= now()) seen.delete(hash);
  };
  const metadata = (entry: Entry, owner: string) => ({ id: entry.id, capture_method: entry.capture_method, channel: entry.channel, account: entry.account, service_hint: entry.serviceHint,
    sender: entry.sender || null, received_at: new Date(entry.received).toISOString(), expires_at: new Date(entry.expires).toISOString(),
    status: entry.claimedBy ? (entry.claimedBy === owner ? 'claimed_by_you' : 'claimed') : entry.code ? 'available' : 'needs_review',
    candidate_count: entry.candidateCount, confidence: entry.confidence, preview: entry.preview });
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/health') return reply({ status: 'ok', service: 'otp-inbox', version: 3 });
    if (req.method !== 'POST') return reply({ error: 'not_found' }, 404);
    const key = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    const owner = Object.entries(clients).find(([, value]) => equal(key, value))?.[0];
    const emailSource = Object.entries(emailSources).find(([, source]) => equal(key, source.token));
    const isEmailWrite = path === '/v1/email' || path === '/v1/source-heartbeat';
    if (path === '/v1/sms' ? !equal(key, ingestKey) : isEmailWrite ? !emailSource : !owner) return reply({ error: 'unauthorized' }, 401);
    if (Number(req.headers.get('content-length') || 0) > 8192) return reply({ error: 'too_large' }, 413);
    let data: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 8192) return reply({ error: 'too_large' }, 413);
      data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    } catch { return reply({ error: 'invalid_json' }, 400); }
    cleanup();
    if (path === '/v1/source-heartbeat') {
      const checked = Date.parse(String(data.checked_at));
      if (!Number.isFinite(checked) || Math.abs(checked - now()) > 60_000 || !['ok', 'error'].includes(String(data.status))) return reply({ error: 'invalid_heartbeat' }, 400);
      sourceHealth.set(emailSource![0], { status: String(data.status), checked_at: new Date(checked).toISOString(), truncated: data.truncated === true,
        push_status: typeof data.push_status === 'string' ? data.push_status : sourceHealth.get(emailSource![0])?.push_status,
        watch_expires_at: data.watch_expires_at === undefined ? sourceHealth.get(emailSource![0])?.watch_expires_at : data.watch_expires_at as string|null,
        last_push_at: data.last_push_at === undefined ? sourceHealth.get(emailSource![0])?.last_push_at : data.last_push_at as string|null });
      return reply({ accepted: true });
    }
    if (path === '/v1/sms' || path === '/v1/email') {
      if (typeof data.message !== 'string') return reply({ error: 'message_required' }, 400);
      const received = typeof data.received_at === 'string' ? Date.parse(data.received_at) : NaN;
      if (!Number.isFinite(received) || received > now() + 15_000 || received <= now() - RETENTION) return reply({ accepted: false, reason: 'stale_or_missing_timestamp' });
      const sender = typeof data.sender === 'string' ? data.sender.slice(0, 160) : '';
      const parsed = parseOtp(data.message, sender);
      if (!parsed) return reply({ accepted: false, reason: 'not_recognized_as_otp' });
      const channel = path === '/v1/email' ? 'email' as const : 'sms' as const;
      const account = emailSource?.[1].email || null;
      if (channel === 'email' && (typeof data.message_id !== 'string' || !data.message_id || data.message_id.length > 200)) return reply({ error: 'message_id_required' }, 400);
      const digest = createHash('sha256').update(channel + '\0' + account + '\0' + (channel === 'email' ? data.message_id : sender + '\0' + data.message)).digest('hex');
      if (seen.has(digest)) return reply({ accepted: false, reason: 'duplicate' });
      if (entries.size >= 500 || seen.size >= 1000) return reply({ accepted: false, reason: 'capacity' }, 429);
      const expires = Math.min(received + parsed.expiresIn, now() + RETENTION);
      if (expires <= now()) return reply({ accepted: false, reason: 'expired' });
      const entry: Entry = { capture_method: channel === 'sms' ? (data.capture_method === 'android' ? 'android' : 'iphone') : data.capture_method === 'gmail_push' ? 'gmail_push' : 'email_poll', channel, account, id: crypto.randomUUID(), message: data.message, sender, code: parsed.code,
        serviceHint: parsed.serviceHint, candidateCount: parsed.candidateCount, confidence: parsed.confidence,
        preview: parsed.preview, received, expires };
      entries.set(entry.id, entry); seen.set(digest, now() + RETENTION);
      const expiryTimer = setTimeout(() => { entries.delete(entry.id); wake(); }, expires - now()); expiryTimer.unref();
      const replayTimer = setTimeout(() => seen.delete(digest), RETENTION); replayTimer.unref();
      wake();
      return reply({ accepted: true, id: entry.id, status: entry.code ? 'available' : 'needs_review', expires_at: new Date(expires).toISOString() });
    }
    if (path === '/v1/recent') {
      const service = typeof data.service === 'string' ? data.service.trim().toLowerCase() : '';
      const account = typeof data.account === 'string' ? data.account.trim().toLowerCase() : '';
      const channel = data.channel;
      if (account.length > 254 || (channel !== undefined && channel !== 'sms' && channel !== 'email')) return reply({ error: 'invalid_filter' }, 400);
      const maxAge = data.max_age_seconds === undefined ? 300 : Number(data.max_age_seconds);
      const waitSeconds = data.wait_seconds === undefined ? 0 : Number(data.wait_seconds);
      if (!Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 600 || !Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 25 || service.length > 100) return reply({ error: 'invalid_filter' }, 400);
      const since = data.since === undefined ? now() - maxAge * 1000 : Date.parse(String(data.since));
      if (!Number.isFinite(since) || since > now() + 15_000) return reply({ error: 'invalid_since' }, 400);
      const cutoff = Math.max(since, now() - maxAge * 1000);
      const find = () => {
        cleanup();
        const items = [...entries.values()].filter(entry => entry.received >= cutoff &&
          (data.include_claimed === true || !entry.claimedBy) &&
          (!account || entry.account?.toLowerCase() === account) && (!channel || entry.channel === channel) &&
          (!service || (entry.sender + ' ' + entry.message).toLowerCase().includes(service)))
          .sort((a, b) => b.received - a.received).slice(0, 100).map(entry => metadata(entry, owner!));
        const ready = items.filter(item => item.status === 'available');
        return { status: ready.length === 1 ? 'ready' : ready.length > 1 ? 'ambiguous' : items.length ? 'needs_review' : 'waiting', items, sources: Object.entries(emailSources).map(([id, source]) => {
          const health = sourceHealth.get(id);
          return { id, account: source.email, label: source.label, channel: 'email', status: !health ? 'awaiting_setup' : now() - Date.parse(health.checked_at) > 180_000 ? 'stale' : health.status, checked_at: health?.checked_at || null, truncated: health?.truncated || false, push_status:health?.push_status, watch_expires_at:health?.watch_expires_at, last_push_at:health?.last_push_at };
        }) }; 
      };
      const deadline = Date.now() + waitSeconds * 1000;
      let result = find();
      while (result.status === 'waiting' && Date.now() < deadline) {
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
          const timer = setTimeout(done, Math.max(1, deadline - Date.now()));
          waiters.add(done);
        });
        result = find();
      }
      return reply(result);
    }
    if (path === '/v1/claim') {
      const entry = entries.get(String(data.id || ''));
      if (!entry) return reply({ error: 'not_found_or_expired' }, 404);
      if (entry.claimedBy && entry.claimedBy !== owner) return reply({ error: 'claimed_by_another_agent' }, 409);
      if (!entry.code) return reply({ error: 'ambiguous_code_requires_review', candidate_count: entry.candidateCount }, 409);
      const service = typeof data.service === 'string' ? data.service.trim().toLowerCase() : '';
      if (service && !(entry.sender + ' ' + entry.message).toLowerCase().includes(service)) return reply({ error: 'service_mismatch' }, 409);
      entry.claimedBy = owner;
      wake();
      // Repeating the same claim by this client recovers a lost response; other clients are excluded.
      return reply({ ...metadata(entry, owner!), code: entry.code });
    }
    return reply({ error: 'not_found' }, 404);
  };
}

if (import.meta.main) {
  const ingestKey = Bun.env.OTP_INGEST_TOKEN || '';
  const clients = JSON.parse(Bun.env.OTP_CLIENT_TOKENS || '{}');
  if (ingestKey.length < 32 || !Object.keys(clients).length || Object.values(clients).some(key => typeof key !== 'string' || key.length < 32)) throw new Error('OTP credentials are missing');
  const emailSources = JSON.parse(Bun.env.OTP_EMAIL_SOURCES || '{}');
  const bridge = createBridge(ingestKey, clients, Date.now, emailSources);
  const mcp = createMcp(bridge, clients);
  const push = Bun.env.GMAIL_PUSH_CONFIG ? createGmailPush(JSON.parse(Bun.env.GMAIL_PUSH_CONFIG),emailSources,bridge) : null;
  if (push) await push.start();
  Bun.serve({ port: Number(Bun.env.PORT || 8787), maxRequestBodySize: 16384, idleTimeout: 35,
    fetch: async req => {
      const rpc = await mcp(req);
      if (rpc) return rpc;
      const pushed = await push?.handle(req);
      if (pushed) return pushed;
      const response = await bridge(req);
      if (push && response.ok && new URL(req.url).pathname === '/v1/source-heartbeat') await push.renewDue();
      return response;
    }, error: () => reply({ error: 'internal_error' }, 500) });
}
