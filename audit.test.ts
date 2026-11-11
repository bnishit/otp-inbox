import {test, expect} from 'bun:test';
import {createBridge} from './server';
import {createAuditStore, type AuditStore, type AuditEvent} from './audit';
import {createMcp} from './mcp';

const phone = 'p'.repeat(40), codex = 'c'.repeat(40), other = 'o'.repeat(40);
function fixture(audit: AuditStore) {
  let clock = Date.now();
  const fetch = createBridge(phone, {codex, other}, () => clock, {}, [], undefined, undefined, '', audit);
  const post = async (path: string, data: unknown, token = codex) => {
    const response = await fetch(new Request('https://test/v1/' + path, {method: 'POST',
      headers: {authorization: 'Bearer ' + token}, body: JSON.stringify(data)}));
    return {status: response.status, body: await response.json()};
  };
  return {fetch, post, advance: () => {clock += 600001;},
    sms: (message = 'Amazon OTP: 246810') => post('sms', {message, received_at: new Date(clock).toISOString()}, phone)};
}
const filter = {service: '', account: '', channel: '', since: new Date(0).toISOString(), before: '9223372036854775807', limit: 100};

test('audit contains receipt, named client, retry and denial; never message or secret', async () => {
  const events: AuditEvent[] = [];
  const f = fixture({append: async e => {events.push(e);}, history: async () => events});
  const id = (await f.sms()).body.id;
  await f.post('claim', {id, service: 'cashfree'});
  await f.post('claim', {id});
  await f.post('claim', {id});
  await f.post('claim', {id}, other);
  expect(events.map(e => e.event)).toEqual(['received', 'claim_denied', 'claimed', 'claimed', 'claim_denied']);
  expect(events[2].client).toBe('codex');
  expect(events[3].reason).toBe('same_client_retry');
  expect(events[4].client).toBe('other');
  expect(JSON.stringify(events)).not.toContain('246810');
  expect(JSON.stringify(events)).not.toContain('Amazon OTP');
  f.advance();
  expect((await f.post('recent', {})).body.items).toHaveLength(0);
  expect((await f.post('history', {})).body.items).toHaveLength(5);
  expect((await f.post('history', {}, phone)).status).toBe(401);
  for (const data of [{limit: 101}, {before: '9999999999999999999'}, {since: 'yesterday'}, {channel: 'web'}])
    expect((await f.post('history', data)).status).toBe(400);
});

test('audit failure prevents acceptance and secret release, and concurrent clients stay excluded', async () => {
  let fail = true, release: (() => void) | undefined;
  const f = fixture({append: async e => {
    if (fail) throw Error('private connection detail');
    if (e.event === 'claimed') await new Promise<void>(resolve => {release = resolve;});
  }, history: async () => []});
  expect((await f.sms()).status).toBe(503);
  fail = false;
  const id = (await f.sms()).body.id;
  const first = f.post('claim', {id});
  await Bun.sleep(1);
  expect((await f.post('claim', {id}, other)).status).toBe(409);
  release!();
  expect((await first).status).toBe(200);
  fail = true;
  const response = await f.post('claim', {id});
  expect(response.status).toBe(503);
  expect(JSON.stringify(response)).not.toContain('246810');
  expect(JSON.stringify(response)).not.toContain('private connection');
});

test('review and rejected messages have no message text; remote MCP can read history', async () => {
  const events: AuditEvent[] = [];
  const f = fixture({append: async e => {events.push(e);}, history: async () => events});
  const id = (await f.sms('Amazon OTP: 246810 and 135790')).body.id;
  expect((await f.post('claim', {id})).status).toBe(409);
  await f.sms('Amazon order shipped');
  expect(events.at(-1)?.event).toBe('rejected');
  expect(events.at(-1)?.reason).toBe('not_recognized_as_otp');
  const mcp = createMcp(f.fetch, {codex});
  const response = await mcp(new Request('https://test/mcp', {method: 'POST', headers: {authorization: 'Bearer '+codex},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'otp_history', arguments: {}}})}));
  const body = await response!.json();
  expect(body.result.isError).toBe(false);
  expect(JSON.stringify(body)).not.toContain('246810');
});

test('email link history keeps account and time but excludes link, sender and preview', async () => {
  const events: AuditEvent[] = [], email = 'e'.repeat(40), clock = Date.now();
  const bridge = createBridge(phone, {codex}, () => clock,
    {personal: {email: 'owner@example.test', label: 'Personal', token: email}},
    [{service: 'Afterspan', sender: 'signin@example.test', origin: 'https://afterspan.example.test', pathname: '/app',
      parameter: 'sign-in', location: 'fragment', max_age_seconds: 600}], undefined, undefined, '',
    {append: async e => {events.push(e);}, history: async () => events});
  const post = (path: string, data: unknown, token: string) => bridge(new Request('https://test/v1/'+path,
    {method: 'POST', headers: {authorization: 'Bearer '+token}, body: JSON.stringify(data)}));
  const receipt = await (await post('email', {message: 'Sign in to Afterspan with this one-time link: https://afterspan.example.test/app#sign-in=as_login_syntheticletters',
    sender: 'signin@example.test', authenticated_domain: 'example.test', message_id: 'audit-link', received_at: new Date(clock).toISOString()}, email)).json();
  expect((await post('claim', {id: receipt.id}, codex)).status).toBe(200);
  expect(events[1].account).toBe('owner@example.test');
  expect(events[1].service).toBe('Afterspan');
  for (const excluded of ['syntheticletters', 'signin@example.test', 'https://', 'preview', phone, email, codex])
    expect(JSON.stringify(events)).not.toContain(excluded);
});

test.skipIf(!Bun.env.OTP_TEST_DATABASE_URL)('Postgres history survives connections and bridge restart, supports filters and pagination', async () => {
  const url = Bun.env.OTP_TEST_DATABASE_URL!;
  let store = await createAuditStore(url);
  const f = fixture(store);
  const id = (await f.sms()).body.id;
  await f.post('claim', {id});
  await store.close();
  store = await createAuditStore(url);
  try {
    const restarted = fixture(store);
    const found = await restarted.post('history', {service: 'amazon', channel: 'sms', limit: 1});
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].client).toBe('codex');
    expect(found.body.next_cursor).not.toBeNull();
    const next = await restarted.post('history', {service: 'amazon', before: found.body.next_cursor, limit: 1});
    expect(next.body.items[0].id).not.toBe(found.body.items[0].id);
    expect((await restarted.post('history', {account: 'absent@example.test'})).body.items).toHaveLength(0);
    expect(JSON.stringify(await store.history(filter))).not.toContain('246810');
    expect((await restarted.post('claim', {id})).status).toBe(404);
  } finally {await store.close();}
});
