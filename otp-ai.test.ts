import {test,expect} from 'bun:test';
import {codeCandidates,codeDecision,readCodeDecision,createOtpResolver,createExampleLoader,validateExamples} from './otp-ai';
import {createBridge} from './server';
import original from './benchmarks/sms-fixtures.json';
import common from './benchmarks/common-formats.json';
import {otpMailText,otpMailExcerpt} from './email/mail.js';

const fixtures=[...original.cases.map(c=>({id:c.id,text:c.text,expected:c.expected.code,channel:'sms'})),...common.cases];
const key='synthetic-provider-key';
function answer(text:string,code:string|null,extra:any={}) {
 const request=codeDecision(text)!;
 return {answers:[{name:'code',type:'choice',choice:code===null?'none':'c'+request.candidates.indexOf(code),confidence:0.99,...extra},{name:'purpose',type:'choice',choice:code===null?'none':'login',confidence:0.99}]};
}
test('all 100 synthetic formats preserve the literal expected code as an option; this is candidate coverage, not model accuracy',()=>{
 for(const f of fixtures)if(f.expected!==null){expect(codeCandidates(f.text),f.id).toContain(f.expected);expect(codeDecision(f.text),f.id).not.toBeNull();}
});
test('plain-text, HTML and multipart email capture preserve the code through the actual excerpt function',()=>{
 for(const f of common.cases.filter(f=>f.channel==='email'&&f.expected!==null)){
  const plain={mimeType:'text/plain',body:{data:Buffer.from(f.text).toString('base64url')}};
  const html={mimeType:'text/html',body:{data:Buffer.from('<div>'+f.text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\n','</div><div>')+'</div>').toString('base64url')}};
  for(const part of [plain,html,{mimeType:'multipart/alternative',parts:[plain,html]}]){
   const excerpt=otpMailExcerpt('Verification code',otpMailText(part,(encoded:string)=>Buffer.from(encoded,'base64url').toString('utf8')));
   expect(codeCandidates(excerpt),f.id).toContain(f.expected!);
  }
 }
});
test('model output only selects a supplied literal; invalid, refused, ambiguous and uncertain answers cannot create a code',()=>{
 const text='OTP 246810. Reference 135790.',request=codeDecision(text)!;
 expect(readCodeDecision(answer(text,'246810'),request).code).toBe('246810');
 for(const extra of [{choice:'c999'},{choice:'invented'},{type:'refusal'},{confidence:NaN},{confidence:2},{confidence:-1}])expect(()=>readCodeDecision(answer(text,'246810',extra),request)).toThrow();
 expect(readCodeDecision(answer(text,'246810',{confidence:.6}),request).code).toBeNull();
 expect(readCodeDecision(answer(text,null,{choice:'ambiguous'}),request).reason).toBe('multiple_codes');
});
test('fresh SMS and email use the same decision path and redact the selected code from metadata',async()=>{
 for(const channel of ['sms','email']){
  const text='Your verification code is abczxy. © 2026 UNKNOWN FOOTER';
  const resolver=createOtpResolver({key,network:async()=>Response.json(answer(text,'abczxy'))});
  const ingest='i'.repeat(40),mail='m'.repeat(40),reader='r'.repeat(40);
  const bridge=createBridge(ingest,{reader},Date.now,{personal:{email:'owner@example.test',label:'Personal',token:mail}},[],undefined,resolver);
  const post=async(path:string,data:any,token=reader)=>{const response=await bridge(new Request('https://bridge.test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(data)}));return {status:response.status,data:await response.json() as any};};
  const receipt=await post(channel==='sms'?'sms':'email',{message:text,message_id:'synthetic',received_at:new Date().toISOString()},channel==='sms'?ingest:mail);
  expect(receipt.data.status).toBe('available');
  const listed=await post('recent',{});expect(JSON.stringify(listed.data)).not.toContain('abczxy');expect(listed.data.items[0].confidence).toBe('ai_decision');
  expect((await post('claim',{id:receipt.data.id})).data.code).toBe('abczxy');
 }
});
test('transient errors retry once; exhausted credits open a circuit instead of being mistaken for a parser bug',async()=>{
 let calls=0;const text='OTP 246810';
 const retry=createOtpResolver({key,network:async()=>++calls===1?new Response('{}',{status:503}):Response.json(answer(text,'246810'))});
 expect((await retry.resolve(text)).code).toBe('246810');expect(calls).toBe(2);expect(retry.snapshot().counts.retried).toBe(1);
 calls=0;let clock=Date.now();
 const empty=createOtpResolver({key,now:()=>clock,network:async()=>{calls++;return Response.json({error:{code:'credit_balance_exhausted'}},{status:429});}});
 expect((await empty.resolve(text)).reason).toBe('ai_credits_exhausted');
 await empty.resolve('OTP 135790');expect(calls).toBe(1);clock+=300001;await empty.resolve(text);expect(calls).toBe(2);
});
test('provider failure preserves known rule codes but never releases an ambiguous rule result',async()=>{
 const resolver=createOtpResolver({key,network:async()=>{throw Error('private provider payload');}});
 const token='i'.repeat(40),reader='r'.repeat(40),bridge=createBridge(token,{reader},Date.now,{},[],undefined,resolver);
 for(const [message,status] of [['OTP 246810','available'],['OTP 246810 and 135790','needs_review']]){
  const r=await bridge(new Request('https://test/v1/sms',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({message,received_at:new Date().toISOString()})}));
  expect((await r.json()).status).toBe(status);
 }
 const diagnostics=JSON.stringify(resolver.snapshot());for(const secret of [key,'246810','135790','private provider payload'])expect(diagnostics).not.toContain(secret);
});
test('duplicate provider work is shared and concurrency/daily limits remain bounded',async()=>{
 let calls=0,release:any;const gate=new Promise<void>(r=>release=r);
 const resolver=createOtpResolver({key,maxPerDay:1,network:async()=>{calls++;await gate;return Response.json(answer('OTP 246810','246810'));}});
 const one=resolver.resolve('OTP 246810'),two=resolver.resolve('OTP 246810');
 expect((await resolver.resolve('OTP 135790')).reason).toBe('ai_limited');release();await Promise.all([one,two]);expect(calls).toBe(1);
});
test('repair examples are data only; invalid remote policy falls back to the last known set',async()=>{
 expect(()=>validateExamples([{text:'Synthetic code',code:'246810'}])).toThrow();
 expect(()=>validateExamples([{text:'Synthetic code',code:'$(bad)'}])).toThrow();
 let calls=0,clock=Date.now();
 const load=createExampleLoader('https://example.test/policy',async()=>{calls++;return calls===1?Response.json([{text:'OTP 246810',code:'246810'}]):Response.json({executable:'not allowed'});},()=>clock);
 expect(await load()).toHaveLength(1);await load();expect(calls).toBe(1);clock+=300001;expect(await load()).toHaveLength(1);expect(calls).toBe(2);
});
test('watchdog credential can read counters but cannot read or claim OTPs',async()=>{
 const bridge=createBridge('i'.repeat(40),{reader:'r'.repeat(40)},Date.now,{},[],undefined,undefined,'d'.repeat(40));
 for(const [path,status] of [['observation',200],['recent',401],['claim',401],['sms',401],['email',401]]){
  const response=await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+'d'.repeat(40)},body:'{}'}));expect(response.status).toBe(status);
 }
});
