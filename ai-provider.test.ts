import {test, expect} from 'bun:test';
import {createAiProvider} from './ai-provider';
import {createOtpResolver, codeDecision} from './otp-ai';
import {createSmsShadow} from './sms-shadow';

const key='synthetic-primary-secret',openrouterKey='synthetic-fallback-secret';
const quota=()=>Response.json({error:{code:'insufficient_quota'}},{status:429});
const output=(value:any)=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('primary success never calls or discloses the fallback credential',async()=>{
 const calls:any[]=[];
 const provider=createAiProvider({key,openrouterKey,network:async(url,options)=>{calls.push({url,options});return Response.json({status:'completed'});}});
 await provider.request('responses',{model:'gpt-6-luna'});
 expect(calls).toHaveLength(1);expect(calls[0].url).toContain('api.openai.com');
 expect(JSON.stringify(calls)).not.toContain(openrouterKey);expect(provider.snapshot().last_provider).toBe('openai');
});

test('funding error uses fallback, cools down primary for five minutes, then automatically returns to primary',async()=>{
 let clock=Date.now(),restored=false;const hosts:string[]=[],counts:Record<string,number>={};
 const provider=createAiProvider({key,openrouterKey,now:()=>clock,count:n=>counts[n]=(counts[n]||0)+1,
  network:async(url,options)=>{
   const host=new URL(String(url)).hostname;hosts.push(host);
   expect(options?.headers).toMatchObject({authorization:'Bearer '+(host==='api.openai.com'?key:openrouterKey)});
   if(host==='api.openai.com')return restored?Response.json({status:'completed'}):quota();
   const body=JSON.parse(String(options?.body));
   expect(body.store).toBe(false);expect(body.model).toBe('openai/gpt-6-luna');
   expect(body.provider).toEqual({require_parameters:true,data_collection:'deny',zdr:true});
   return output({category:'login_otp',code:'246810',ambiguous:false});
  }});
 const body={model:'gpt-6-luna'};
 await provider.request('responses',body);await provider.request('responses',body);
 expect(hosts).toEqual(['api.openai.com','openrouter.ai','openrouter.ai']);
 clock+=300001;restored=true;await provider.request('responses',body);
 expect(hosts.at(-1)).toBe('api.openai.com');expect(provider.snapshot().last_provider).toBe('openai');
 expect(provider.snapshot().blocked_until).toBeNull();expect(counts.openrouter_succeeded).toBe(2);
 for(const secret of [key,openrouterKey,'246810'])expect(JSON.stringify(provider.snapshot())).not.toContain(secret);
});

test('auth, transient outages and rate limits cannot spend through another provider',async()=>{
 for(const status of [401,403,429,503]){
  const hosts:string[]=[];
  const provider=createAiProvider({key,openrouterKey,network:async url=>{hosts.push(String(url));return Response.json({error:{code:'other'}},{status});}});
  await expect(provider.request('responses',{})).rejects.toThrow('provider_unavailable');
  expect(hosts.every(url=>url.includes('api.openai.com'))).toBe(true);
 }
});

test('missing fallback preserves funding error; failed fallback is bounded and sanitized',async()=>{
 await expect(createAiProvider({key,network:async()=>quota()}).request('responses',{})).rejects.toThrow('credits_exhausted');
 for(const response of [()=>new Response('private payload',{status:402}),()=>Response.json({status:'incomplete'})]){
  let calls=0;
  const provider=createAiProvider({key,openrouterKey,network:async()=>++calls===1?quota():response()});
  await expect(provider.request('responses',{})).rejects.toThrow('provider_unavailable');expect(calls).toBe(2);
 }
});

test('fallback choice output passes existing literal/confidence/ambiguity checks',async()=>{
 const text='OTP 246810 and reference 135790',request=codeDecision(text)!;
 const choice='c'+request.candidates.indexOf('246810');
 for(const [value,expected] of [[choice,'246810'],['c999',null],['ambiguous',null]] as const){
  const resolver=createOtpResolver({key,openrouterKey,network:async url=>String(url).includes('api.openai.com')?quota():output({code:{choice:value,confidence:.99},purpose:{choice:'login',confidence:.99}})});
  expect((await resolver.resolve(text)).code).toBe(expected);
 }
});

test('active observation uses fallback while keeping diagnostics free of messages, codes and keys',async()=>{
 const observer=createSmsShadow({enabled:true,key,openrouterKey,network:async url=>String(url).includes('api.openai.com')?quota():output({category:'login_otp',code:'246810',ambiguous:false})});
 observer.observe('Synthetic Amazon OTP 246810','246810');
 for(let i=0;i<20&&observer.snapshot().in_flight;i++)await Bun.sleep(1);
 expect(observer.snapshot().counts.same_code).toBe(1);expect(observer.snapshot().counts.openrouter_succeeded).toBe(1);
 expect(observer.snapshot().mode).toBe('observe_only');
 for(const secret of [key,openrouterKey,'246810','Synthetic Amazon'])expect(JSON.stringify(observer.snapshot())).not.toContain(secret);
});
