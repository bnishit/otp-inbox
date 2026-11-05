import {test,expect} from 'bun:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createGmailPush,googlePushVerifier} from './gmail-push';
import {createBridge} from '../server';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key'};
const audience='https://inbox.test/v1/gmail/push',serviceAccount='delivery@example.test';
function bearer(extra:any={}){
 const enc=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const body=enc({alg:'RS256',kid:'test-key'})+'.'+enc({iss:'https://accounts.google.com',aud:audience,email:serviceAccount,email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...extra});
 return 'Bearer '+body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
const config={clientId:'test',clientSecret:'synthetic-secret',topic:'projects/test/topics/gmail',subscription:'projects/test/subscriptions/otp',audience,serviceAccount,refreshTokens:{personal:'synthetic-refresh'}};
const sources={personal:{email:'owner@example.test',label:'Personal',token:'write-key'}};
function fixture(profile='owner@example.test'){
 let delivered=false,fail=false;let reads=0,watches=0;let clock=Date.now();
 const bridge=createBridge('sms-key',{agent:'read-key'},()=>clock,sources);
 const network:any=async(url:any,options:any={})=>{
  if(String(url).endsWith('/certs'))return Response.json({keys:[jwk]});
  if(String(url).endsWith('/token'))return Response.json({access_token:'synthetic-access',expires_in:3600});
  if(String(url).endsWith('/profile'))return Response.json({emailAddress:profile});
  if(String(url).endsWith('/watch')){watches++;return Response.json({historyId:'100',expiration:String(clock+7*86400000)});}
  if(String(url).includes('/messages?'))return fail?new Response('',{status:503}):Response.json({messages:delivered?[{id:'mail-a'}]:[]});
  if(String(url).includes('/messages/mail-a')){reads++;return Response.json({id:'mail-a',internalDate:String(clock),labelIds:['INBOX'],payload:{headers:[{name:'Subject',value:'Contoso verification code'},{name:'From',value:'Contoso'}],mimeType:'text/plain',body:{data:Buffer.from('Contoso verification code: 246810. Valid for 2 minutes.').toString('base64url')}}});}
  throw Error('Unexpected destination');
 };
 const push=createGmailPush(config,sources,bridge,network,()=>clock);
 const event=(email='owner@example.test',subscription=config.subscription,auth=bearer())=>push.handle(new Request(audience,{method:'POST',headers:{authorization:auth},body:JSON.stringify({subscription,message:{data:Buffer.from(JSON.stringify({emailAddress:email,historyId:'101'})).toString('base64url')}})}));
 const recent=async()=> (await bridge(new Request('https://inbox.test/v1/recent',{method:'POST',headers:{authorization:'Bearer read-key'},body:'{}'}))).json();
 return {push,event,recent,advance:(ms:number)=>{clock+=ms;},deliver:()=>{delivered=true;},fail:()=>{fail=true;},counts:()=>({reads,watches})};
}
test('Google signatures and expected audience, issuer, identity and lifetime are all required',async()=>{
 const verify=googlePushVerifier(audience,serviceAccount,(async()=>Response.json({keys:[jwk]})) as any);
 expect(await verify(bearer())).toBe(true);
 for(const changed of [{aud:'other'},{iss:'other'},{email:'other@example.test'},{email_verified:false},{exp:0},{iat:Math.floor(Date.now()/1000)+600}])expect(await verify(bearer(changed))).toBe(false);
 expect(await verify(bearer().slice(0,-8)+'tampered')).toBe(false);expect(await verify('Bearer bad')).toBe(false);
});
test('signed mailbox change triggers exact email capture and redacted metadata; retries do not duplicate',async()=>{
 const f=fixture();await f.push.start();f.deliver();expect((await f.event())!.status).toBe(200);
 const result=await f.recent();expect(result.items).toHaveLength(1);expect(result.items[0].capture_method).toBe('gmail_push');expect(result.items[0].account).toBe('owner@example.test');expect(result.items[0].preview).not.toContain('246810');expect(result.sources[0].push_status).toBe('watching');expect(result.sources[0].last_push_at).toBeTruthy();
 expect((await f.event())!.status).toBe(200);expect((await f.recent()).items).toHaveLength(1);expect(f.counts().reads).toBe(1);
});
test('unknown mailbox, subscription and unsigned notices cannot trigger scans',async()=>{
 const f=fixture();await f.push.start();f.deliver();expect((await f.event('other@example.test'))!.status).toBe(400);expect((await f.event(undefined,'wrong'))!.status).toBe(400);expect((await f.event(undefined,undefined,'Bearer forged'))!.status).toBe(401);expect(f.counts().reads).toBe(0);
});
test('a token for the wrong account never starts a watch or captures mail',async()=>{
 const f=fixture('wrong@example.test');await f.push.start();f.deliver();expect((await f.event())!.status).toBe(400);expect(f.counts()).toEqual({reads:0,watches:0});expect((await f.recent()).sources[0].push_status).toBe('error');
});
test('failed mail reads are not acknowledged as delivered and expose no provider secrets',async()=>{
 const f=fixture();await f.push.start();f.fail();const r=await f.event();expect(r!.status).toBe(503);expect(await r!.text()).toBe('{"error":"retry_delivery"}');
});
test('healthy watches are not renewed on every timer tick',async()=>{
 const f=fixture();await f.push.start();await f.push.renewDue();expect(f.counts().watches).toBe(1);
});

test('mailbox watches renew after one day using the existing backup heartbeat cadence',async()=>{
 const f=fixture();await f.push.start();f.advance(86400001);await f.push.renewDue();expect(f.counts().watches).toBe(2);expect((await f.recent()).sources[0].push_status).toBe('watching');
});

test('push captures approved alias link once and fallback delivery stays a duplicate',async()=>{
 const clock=Date.now(),aliasSources={personal:{...sources.personal,aliases:['alias@example.test']}};
 const rule={service:'Afterspan',sender:'signin@example.test',origin:'https://afterspan.example.test',pathname:'/app',parameter:'sign-in',location:'fragment' as const,max_age_seconds:600};
 const bridge=createBridge('phone',{agent:'reader'},()=>clock,aliasSources,[rule]);
 const link='https://afterspan.example.test/app#sign-in=as_login_syntheticletters';
 const payload={headers:[{name:'From',value:'Afterspan <signin@example.test>'},{name:'Subject',value:'Sign in to Afterspan'},{name:'To',value:'alias@example.test'},{name:'Delivered-To',value:'alias@example.test'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=example.test'}],mimeType:'text/plain',body:{data:Buffer.from('Use this one-time link within 15 minutes:\n'+link).toString('base64url')}};
 let reads=0;
 const network:any=async(url:any)=>{
  if(url.endsWith('/token'))return Response.json({access_token:'synthetic-access'});
  if(url.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test'});
  if(url.endsWith('/watch'))return Response.json({expiration:String(clock+604800000)});
  if(url.includes('/messages?'))return Response.json({messages:[{id:'alias-link'}]});
  if(url.includes('/messages/alias-link')){reads++;return Response.json({internalDate:String(clock),labelIds:['INBOX'],payload});}
  throw Error('Unexpected destination');
 };
 const push=createGmailPush(config,aliasSources,bridge,network,()=>clock);await push.start();await push.renewDue();
 const post=async(path:string,data:any,key='reader')=>(await bridge(new Request('https://test/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key},body:JSON.stringify(data)}))).json();
 const recent=await post('recent',{account:'alias@example.test',service:'Afterspan',channel:'email'});
 expect(recent.items).toHaveLength(1);expect(recent.items[0].capture_method).toBe('gmail_push');expect(recent.items[0].status).toBe('available');expect(reads).toBe(1);expect(JSON.stringify(recent)).not.toContain('syntheticletters');
 expect((await post('email',{message:'Use this one-time link within 15 minutes:\n'+link,sender:'signin@example.test',recipient:'alias@example.test',authenticated_domain:'example.test',message_id:'alias-link',received_at:new Date(clock).toISOString()},sources.personal.token)).reason).toBe('duplicate');
 expect((await post('claim',{id:recent.items[0].id,service:'Afterspan'})).link).toBe(link);
});
