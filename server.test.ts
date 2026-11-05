import { expect, test } from 'bun:test';
import { parseOtp, createBridge } from './server';

const ingest = 'i'.repeat(40), codex = 'c'.repeat(40), claude = 'a'.repeat(40);
function fixture() {
  let clock = Date.now();
  const fetch = createBridge(ingest, { codex, claude }, () => clock);
  const post = async (path: string, data: unknown, key = codex) => {
    const response = await fetch(new Request('https://bridge.test/v1/' + path, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: JSON.stringify(data) }));
    return { status: response.status, body: await response.json() as any };
  };
  const sms = (message = '123456 is your Amazon OTP.', timestamp = clock, sender = '') => post('sms', { message, sender, received_at: new Date(timestamp).toISOString() }, ingest);
  return { post, sms, now: () => clock, advance: (ms: number) => { clock += ms; } };
}

test('numeric, mixed and letter codes across known and unknown services', () => {
  for (const [body, code] of [
    ['123456 is your Amazon OTP.', '123456'], ['Cashfree OTP: 654321. Valid for 2 minutes.', '654321'],
    ['Your Contoso verification code is 246810.', '246810'], ['GitHub authentication code: AB12CD', 'AB12CD'],
    ['Microsoft security code: ABCDEF', 'ABCDEF'], ['Your login code is 7351', '7351'],
    ['Your Stripe code is 998877', '998877'], ['849203', '849203'],
  ]) expect(parseOtp(body)?.code).toBe(code);
  expect(parseOtp('Cashfree OTP: 654321')?.serviceHint).toBe('cashfree');
  expect(parseOtp('Your Contoso verification code is 246810')?.serviceHint).toBeNull();
});
test('ordinary messages and promo codes are excluded', () => {
  for (const body of ['Amazon order 123456 has shipped', 'Your appointment is at 6 PM', 'Your promo code is SALE20', 'Referral code AB12CD', 'Hello there']) expect(parseOtp(body)).toBeNull();
});
test('unclear OTP formats remain reviewable and codes are hidden from previews', () => {
  expect(parseOtp('Cashfree OTP: 123456 and 654321')?.code).toBeNull();
  expect(parseOtp('Your verification code is 12 34 56')?.candidateCount).toBe(0);
  expect(parseOtp('Microsoft security code: ABCDEF')?.preview).not.toContain('ABCDEF');
  expect(parseOtp('Amazon OTP: 123456')?.preview).not.toContain('123456');
});
test('phone key is ingest-only and unauthorized agents are rejected', async () => {
  const f = fixture();
  expect((await f.post('recent', {}, ingest)).status).toBe(401);
  expect((await f.post('claim', { id: 'missing' }, 'bad')).status).toBe(401);
  expect((await f.post('sms', { message: 'OTP: 123456' })).status).toBe(401);
});
test('stores without a waiting login; agents see metadata and then claim a literal code', async () => {
  const f = fixture(); const delivered = await f.sms('Cashfree OTP: 654321');
  expect(delivered.body.accepted).toBe(true);
  const found = (await f.post('recent', { service: 'cashfree' })).body;
  expect(found.status).toBe('ready'); expect(found.items).toHaveLength(1);
  expect(JSON.stringify(found)).not.toContain('654321');
  expect((await f.post('claim', { id: found.items[0].id, service: 'cashfree' })).body.code).toBe('654321');
});
test('unknown service can be searched by its literal message text', async () => {
  const f = fixture(); await f.sms('Contoso verification code: 246810');
  const found = (await f.post('recent', { service: 'contoso' })).body;
  expect(found.items[0].service_hint).toBeNull(); expect(found.status).toBe('ready');
});
test('claim excludes other clients while same client can recover a lost response', async () => {
  const f = fixture(); const id = (await f.sms()).body.id;
  expect((await f.post('claim', { id })).body.code).toBe('123456');
  expect((await f.post('claim', { id })).body.code).toBe('123456');
  expect((await f.post('claim', { id }, claude)).status).toBe(409);
  expect((await f.post('recent', {})).body.items).toHaveLength(0);
  expect((await f.post('recent', { include_claimed: true })).body.items[0].status).toBe('claimed_by_you');
});
test('service mismatch cannot claim a code and does not consume it', async () => {
  const f = fixture(); const id = (await f.sms()).body.id;
  expect((await f.post('claim', { id, service: 'cashfree' })).status).toBe(409);
  expect((await f.post('claim', { id, service: 'amazon' })).body.code).toBe('123456');
});
test('two matches stay ambiguous; a new request timestamp can distinguish them', async () => {
  const f = fixture(); await f.sms('Amazon OTP: 123456'); f.advance(1000); const since = new Date(f.now()).toISOString();
  await f.sms('Amazon OTP: 654321');
  expect((await f.post('recent', { service: 'amazon' })).body.status).toBe('ambiguous');
  expect((await f.post('recent', { service: 'amazon', since })).body.items).toHaveLength(1);
});
test('multiple plausible codes are retained but never returned by claim', async () => {
  const f = fixture(); const id = (await f.sms('Cashfree OTP: 123456 and 654321')).body.id;
  expect((await f.post('recent', { service: 'cashfree' })).body.status).toBe('needs_review');
  expect((await f.post('claim', { id })).body.error).toBe('ambiguous_code_requires_review');
});
test('expiry respects both ten-minute cap and shorter declared validity', async () => {
  const f = fixture(); const short = (await f.sms('Cashfree OTP: 654321. Valid for 30 seconds.')).body.id;
  f.advance(30_001); expect((await f.post('claim', { id: short })).status).toBe(404);
  const normal = (await f.sms()).body.id;
  f.advance(600_001); expect((await f.post('claim', { id: normal })).status).toBe(404);
});
test('duplicates do not create a second inbox entry or extend expiry', async () => {
  const f = fixture(); const first = (await f.sms()).body;
  f.advance(1000); expect((await f.sms()).body.reason).toBe('duplicate');
  const entries = (await f.post('recent', {})).body.items;
  expect(entries).toHaveLength(1); expect(entries[0].expires_at).toBe(first.expires_at);
});
test('missing, stale and future timestamps are rejected', async () => {
  const f = fixture();
  expect((await f.post('sms', { message: 'OTP: 123456' }, ingest)).body.accepted).toBe(false);
  expect((await f.sms('OTP: 123456', f.now() - 600_001)).body.accepted).toBe(false);
  expect((await f.sms('OTP: 123456', f.now() + 16_000)).body.accepted).toBe(false);
});
test('age and since filters restrict lookup; invalid filters fail closed', async () => {
  const f = fixture(); await f.sms(); f.advance(61_000);
  expect((await f.post('recent', { max_age_seconds: 60 })).body.items).toHaveLength(0);
  expect((await f.post('recent', { max_age_seconds: 600 })).body.items).toHaveLength(1);
  for (const data of [{ max_age_seconds: -1 }, { max_age_seconds: 601 }, { wait_seconds: 26 }, { since: 'not a date' }]) expect((await f.post('recent', data)).status).toBe(400);
});
test('long poll wakes on matching delivery without exposing its code', async () => {
  const f = fixture(); const waiting = f.post('recent', { service: 'cashfree', wait_seconds: 1 });
  await new Promise(resolve => setTimeout(resolve, 10)); await f.sms('Cashfree OTP: 654321');
  const result = await waiting;
  expect(result.body.status).toBe('ready'); expect(JSON.stringify(result.body)).not.toContain('654321');
});
test('long poll times out as waiting and obsolete login-window routes are removed', async () => {
  const f = fixture(); expect((await f.post('recent', { wait_seconds: 0.01 })).body.status).toBe('waiting');
  expect((await f.post('logins', { service: 'amazon' })).status).toBe(404);
});

test('Android SMS Retriever app hash is excluded without choosing between real codes', () => {
  const message = '<#> 123456 is the OTP for logging in to your myBillBook account. Keep the OTP safe. We will never call to ask for your OTP. A7bc+9Dk2Lm \n-myBillBook';
  expect(parseOtp(message)?.code).toBe('123456');
  expect(parseOtp(message)?.serviceHint).toBe('mybillbook');
  expect(parseOtp(message.replace('123456', '123456 and 654321'))?.code).toBeNull();
});

test('email source keys are write-only, bind the recipient, and keep accounts separate', async () => {
  const clock=Date.now(), emailKey='e'.repeat(40), otherKey='o'.repeat(40);
  const fetch=createBridge(ingest,{codex,claude},()=>clock,{personal:{email:'owner@example.test',label:'Personal',token:emailKey},work:{email:'work@example.test',label:'Work',token:otherKey}});
  const post=async(path:string,data:any,key:string)=>{const r=await fetch(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key},body:JSON.stringify(data)}));return {status:r.status,body:await r.json() as any};};
  const mail={message:'Contoso verification code: 246810',message_id:'gmail-message-id',received_at:new Date(clock).toISOString(),account:'spoof@example.test'};
  expect((await post('email',mail,codex)).status).toBe(401);
  expect((await post('recent',{},emailKey)).status).toBe(401);
  expect((await post('email',mail,emailKey)).body.accepted).toBe(true);
  expect((await post('email',mail,otherKey)).body.accepted).toBe(true);
  expect((await post('email',mail,emailKey)).body.reason).toBe('duplicate');
  const result=(await post('recent',{account:'owner@example.test',channel:'email'},codex)).body;
  expect(result.items).toHaveLength(1);expect(result.items[0].account).toBe('owner@example.test');expect(result.items[0].channel).toBe('email');
  expect(JSON.stringify(result)).not.toContain('246810');expect(JSON.stringify(result)).not.toContain(emailKey);
  expect((await post('recent',{channel:'fax'},codex)).status).toBe(400);
});
test('email heartbeat distinguishes setup, healthy, errors, and stale collectors',async()=>{
  let clock=Date.now();const key='e'.repeat(40);
  const fetch=createBridge(ingest,{codex},()=>clock,{personal:{email:'owner@example.test',label:'Personal',token:key}});
  const post=async(path:string,data:any,auth=codex)=>{const r=await fetch(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}));return {status:r.status,body:await r.json() as any};};
  expect((await post('recent',{})).body.sources[0].status).toBe('awaiting_setup');
  expect((await post('source-heartbeat',{status:'ok',checked_at:new Date(clock).toISOString()},key)).body.accepted).toBe(true);
  expect((await post('recent',{})).body.sources[0].status).toBe('ok');
  clock+=181000;expect((await post('recent',{})).body.sources[0].status).toBe('stale');
  expect((await post('source-heartbeat',{status:'error',checked_at:new Date(clock).toISOString()},key)).body.accepted).toBe(true);
  expect((await post('recent',{})).body.sources[0].status).toBe('error');
  expect((await post('source-heartbeat',{status:'ok',checked_at:'invalid'},key)).status).toBe(400);
});

test('approved alias and authenticated sign-in link survive capture, exact lookup and reserved claim',async()=>{
  let clock=Date.now(); const key='e'.repeat(40);
  const bridge=createBridge(ingest,{codex,claude},()=>clock,{personal:{email:'owner@example.test',aliases:['alias@example.test'],label:'Personal',token:key}},[
    {service:'Afterspan',sender:'signin@example.test',origin:'https://afterspan.example.test',pathname:'/app',parameter:'sign-in',location:'fragment',max_age_seconds:120}
  ]);
  const post=async(path:string,data:any,auth=codex)=>{const r=await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}));return {status:r.status,body:await r.json() as any};};
  const link='https://afterspan.example.test/app#sign-in=as_login_syntheticletters';
  const mail={message:'Sign in to Afterspan\nUse this one-time link within 15 minutes:\n'+link,sender:'Afterspan <signin@example.test>',message_id:'alias-link',recipient:'alias@example.test',authenticated_domain:'example.test',received_at:new Date(clock).toISOString()};
  const since=mail.received_at; const waiting=post('recent',{service:'Afterspan',account:'alias@example.test',channel:'email',since,wait_seconds:1});
  await new Promise(r=>setTimeout(r,5));const receipt=await post('email',mail,key);
  expect(receipt.body.status).toBe('available');
  const found=(await waiting).body;expect(found.status).toBe('ready');expect(found.items).toHaveLength(1);
  const item=found.items[0];expect(item.mailbox).toBe('owner@example.test');expect(item.account).toBe('alias@example.test');expect(item.secret_type).toBe('link');expect(item.link_origin).toBe('https://afterspan.example.test');
  expect(JSON.stringify(found)).not.toContain('as_login_syntheticletters');expect(JSON.stringify(found)).not.toContain('#sign-in');
  expect((await post('recent',{account:'owner@example.test'})).body.items).toHaveLength(0);
  expect((await post('claim',{id:item.id,service:'Other'})).status).toBe(409);
  expect((await post('claim',{id:item.id,service:'Afterspan'})).body.link).toBe(link);
  expect((await post('claim',{id:item.id},claude)).status).toBe(409);
  expect((await post('claim',{id:item.id})).body.link).toBe(link);
  clock+=1000;expect((await post('email',{...mail,capture_method:'email_poll'},key)).body.reason).toBe('duplicate');
  clock+=119001;expect((await post('claim',{id:item.id})).status).toBe(404);
});

test('unsupported recipients and conflicting headers cannot create available entries; reasons stay visible',async()=>{
  const clock=Date.now(),key='e'.repeat(40);
  const bridge=createBridge(ingest,{codex},()=>clock,{personal:{email:'owner@example.test',aliases:['alias@example.test'],label:'Personal',token:key}});
  const post=async(path:string,data:any,auth=codex)=>(await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}))).json();
  const mail={message:'Contoso verification code: 246810',message_id:'test',received_at:new Date(clock).toISOString()};
  expect((await post('email',{...mail,recipient:'stranger@example.test',account:'alias@example.test'},key)).reason).toBe('recipient_not_approved');
  expect((await post('email',{...mail,recipient:'alias@example.test',recipient_conflict:true},key)).reason).toBe('ambiguous_recipient');
  const found=await post('recent',{});expect(found.items).toHaveLength(0);expect(found.sources[0].capture_counts).toEqual({recipient_not_approved:1,ambiguous_recipient:1});
  expect(JSON.stringify(found)).not.toContain('stranger');
});

test('unconfigured links stay reviewable, never leak their secret, and URL digits never become a code',async()=>{
  const clock=Date.now(),key='e'.repeat(40);
  const bridge=createBridge(ingest,{codex},()=>clock,{personal:{email:'owner@example.test',label:'Personal',token:key}});
  const post=async(path:string,data:any,auth=codex)=>(await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}))).json();
  await post('email',{message:'Sign in to Afterspan with this one-time link:\nhttps://example.test/123456?secret=onlyletters#anothersecret',sender:'Afterspan',message_id:'unknown-link',received_at:new Date(clock).toISOString()},key);
  const found=await post('recent',{service:'Afterspan'});expect(found.status).toBe('needs_review');expect(found.items[0].review_reason).toBe('unsupported_login_link');
  for(const secret of ['123456','onlyletters','anothersecret'])expect(JSON.stringify(found)).not.toContain(secret);
  expect((await post('claim',{id:found.items[0].id})).error).toBe('unsupported_login_link');
  expect(parseOtp('Your OTP: 246810 https://example.test/123456')?.code).toBe('246810');
});

test('code plus login link stays review-only rather than choosing a secret',async()=>{
  const clock=Date.now(),key='e'.repeat(40);
  const bridge=createBridge(ingest,{codex},()=>clock,{personal:{email:'owner@example.test',label:'Personal',token:key}},[{service:'Afterspan',sender:'signin@example.test',origin:'https://afterspan.example.test',pathname:'/app',parameter:'sign-in',location:'fragment',max_age_seconds:600}]);
  const post=async(path:string,data:any,auth=codex)=>(await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}))).json();
  const delivered=await post('email',{message:'Afterspan one-time code: 246810\nhttps://afterspan.example.test/app#sign-in=as_login_syntheticletters',sender:'signin@example.test',authenticated_domain:'example.test',message_id:'mixed',received_at:new Date(clock).toISOString()},key);
  expect(delivered.status).toBe('needs_review');expect((await post('claim',{id:delivered.id})).error).toBe('multiple_secret_types');
});
