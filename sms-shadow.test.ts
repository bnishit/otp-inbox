import {expect,test} from 'bun:test';
import {createSmsShadow} from './sms-shadow';
import {createBridge} from './server';
const key='synthetic-openai-reader-key',ingest='i'.repeat(40),reader='r'.repeat(40);
const response=(category='login_otp',code:string|null='246810',extra={})=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({category,code,ambiguous:false,...extra})}]}],usage:{input_tokens:50,output_tokens:10}});
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(options:any={}){
 const calls:any[]=[],pending:any[]=[];let clock=Date.now();
 const observer=createSmsShadow({enabled:true,key,now:()=>clock,network:async(url:any,init:any)=>{calls.push({url,init});if(options.error)throw Error('provider included private payload and key');if(options.pending)return new Promise(resolve=>pending.push(resolve));return options.response?.()||response();},...options});
 return {observer,calls,pending,advance:(ms:number)=>clock+=ms};
}
test('observer defaults off without both a flag and usable key',()=>{
 for(const options of [{enabled:false},{key:''}]){const f=fixture(options);f.observer.observe('OTP 246810','246810');expect(f.calls).toHaveLength(0);expect(f.observer.snapshot().enabled).toBe(false);}
});
test('comparisons store only counters, categories, timing and usage, never message/code/key',async()=>{
 const f=fixture();f.observer.observe('Example login OTP: 246810','246810');await tick();
 const state=f.observer.snapshot();expect(state.counts.same_code).toBe(1);expect(state.categories.login_otp).toBe(1);expect(state.tokens).toEqual({input:50,output:10});
 for(const secret of ['246810','Example login',key])expect(JSON.stringify(state)).not.toContain(secret);
 const request=JSON.parse(f.calls[0].init.body);expect(request.store).toBe(false);expect(request.model).toBe('gpt-6-luna');expect(request.tools).toBeUndefined();
});
test('deduplication, request limit and concurrency bound contain API usage',async()=>{
 const f=fixture({pending:true,maxPerDay:2});f.observer.observe('OTP one 246810',null);f.observer.observe('OTP one 246810',null);f.observer.observe('OTP two 246810',null);f.observer.observe('OTP three 246810',null);
 expect(f.calls).toHaveLength(2);expect(f.observer.snapshot().counts.duplicate).toBe(1);expect(f.observer.snapshot().counts.skipped_limit).toBe(1);
 f.pending.forEach(resolve=>resolve(response()));await tick();
 const busy=fixture({pending:true});for(let i=0;i<3;i++)busy.observer.observe('OTP '+i+' 246810',null);expect(busy.calls).toHaveLength(2);expect(busy.observer.snapshot().counts.skipped_busy).toBe(1);busy.pending.forEach(resolve=>resolve(response()));await tick();
});
test('invented codes, invalid categories, refusals and provider failure cannot enter comparison data',async()=>{
 for(const item of [{response:()=>response('login_otp','135790')},{response:()=>response('untrusted-category')},{response:()=>Response.json({status:'incomplete'})},{error:true}]){
  const f=fixture(item);f.observer.observe('OTP 246810','246810');await tick();const state=f.observer.snapshot();expect((state.counts.failed||0)+(state.counts.invalid_code||0)).toBe(1);expect(state.counts.same_code).toBeUndefined();expect(JSON.stringify(state)).not.toContain('private payload');
 }
});
test('new UTC day resets aggregates once requests finish; oversized input never leaves server',async()=>{
 const f=fixture();f.observer.observe('OTP 246810','246810');await tick();f.advance(86400000);f.observer.observe('OTP 135790','135790');await tick();expect(f.observer.snapshot().counts.requested).toBe(1);
 const large=fixture();large.observer.observe('x'.repeat(8193),null);expect(large.calls).toHaveLength(0);expect(large.observer.snapshot().counts.skipped_size).toBe(1);
});
function bridgeFixture(observer:any){
 const bridge=createBridge(ingest,{reader},Date.now,{},[],observer);
 const post=async(path:string,data:any,auth=reader)=>{const r=await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify(data)}));return {status:r.status,body:await r.json() as any};};
 return {post};
}
test('slow AI cannot delay capture, change a claim, or allow ingest keys to read diagnostics',async()=>{
 const f=fixture({pending:true}),b=bridgeFixture(f.observer);
 const delivered=await b.post('sms',{message:'OTP: 246810',received_at:new Date().toISOString()},ingest);
 expect(delivered.body.status).toBe('available');expect(f.observer.snapshot().in_flight).toBe(1);
 expect((await b.post('claim',{id:delivered.body.id})).body.code).toBe('246810');
 expect((await b.post('observation',{},ingest)).status).toBe(401);
 f.pending[0](response('login_otp','135790'));await tick();
 const stats=await b.post('observation',{});expect(stats.body.mode).toBe('observe_only');expect(stats.body.counts.invalid_code).toBe(1);expect(JSON.stringify(stats.body)).not.toContain('246810');
});
test('non-OTP SMS are compared without becoming inbox items; invalid/stale/unauthorised requests are not sent',async()=>{
 const f=fixture({response:()=>response('personal',null)}),b=bridgeFixture(f.observer),payload={message:'Lunch tomorrow?',received_at:new Date().toISOString()};
 expect((await b.post('sms',payload,ingest)).body.reason).toBe('not_recognized_as_otp');await tick();expect(f.calls).toHaveLength(1);expect(f.observer.snapshot().counts.both_none).toBe(1);
 await b.post('sms',payload,'invalid');await b.post('sms',{...payload,received_at:'invalid'},ingest);expect(f.calls).toHaveLength(1);
 expect((await b.post('recent',{})).body.items).toHaveLength(0);
});
test('a broken observer is isolated from the existing SMS parser and capture response',async()=>{
 const b=bridgeFixture({observe:()=>{throw Error('unavailable');},snapshot:()=>({enabled:true})});
 expect((await b.post('sms',{message:'OTP: 246810',received_at:new Date().toISOString()},ingest)).body.status).toBe('available');
});
test('disagreements retain only direction, not either selected code',async()=>{
 for(const [ai,parser,bucket] of [['246810',null,'ai_only_code'],[null,'246810','parser_only_code'],['135790','246810','different_codes']] as const){
  const f=fixture({response:()=>response('login_otp',ai)});f.observer.observe('Codes 246810 and 135790',parser);await tick();expect(f.observer.snapshot().counts[bucket]).toBe(1);expect(JSON.stringify(f.observer.snapshot())).not.toMatch(/246810|135790/);
 }
});
test('email capture is never sent to the SMS observer',async()=>{
 const f=fixture(),mailKey='m'.repeat(40),bridge=createBridge(ingest,{reader},Date.now,{personal:{email:'owner@example.test',label:'Personal',token:mailKey}},[],f.observer);
 const r=await bridge(new Request('https://test/v1/email',{method:'POST',headers:{authorization:'Bearer '+mailKey},body:JSON.stringify({message:'OTP: 246810',message_id:'synthetic-mail',received_at:new Date().toISOString()})}));expect((await r.json()).status).toBe('available');expect(f.calls).toHaveLength(0);
});
