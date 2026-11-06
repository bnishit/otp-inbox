import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {parse} from './domain.js';
import {automaticCandidate,automaticRule} from './auto-fill.js';
import {bridgeOrigin,fillLoginCode} from './core.js';
const now=Date.now(),since=now-1000,rule={service:'Blinkit',channel:'sms',account:null};
const item=(id='sms')=>({id,secret_type:'code',channel:'sms',account:null,status:'available',received_at:new Date(now).toISOString(),expires_at:new Date(now+60000).toISOString()});
test('automatic fill needs one fresh code; review-only, duplicate, expired and wrong-account entries cannot be guessed',()=>{
 expect(automaticCandidate([item()],rule,since)?.id).toBe('sms');
 for(const items of [[item(),item('two')],[{...item(),status:'needs_review'}],[{...item(),preview:'Code to confirm payment'}],[item(),{...item('review'),status:'needs_review'}],[{...item(),expires_at:new Date(now-1).toISOString()}]])expect(automaticCandidate(items,rule,since)).toBeNull();
 expect(automaticCandidate([item()],rule,now+1)).toBeNull();
 expect(automaticCandidate([{...item(),channel:'email',account:'other@example.test'}],{...rule,channel:'email',account:'owner@example.test'},since)).toBeNull();
});
function fixture(options:any={}) {
 const state:any={connection:{origin:'https://bridge.example.test',token:'synthetic-browser-reader'},autoFillSites:{'https://blinkit.com':rule}},session:any={},calls:any[]=[];
 const sender:any={id:'extension',frameId:0,documentId:'document-one',url:'https://blinkit.com/',tab:{id:1},...options.sender};
 Object.assign(state,options.settings||{});
 let active:any={id:1,url:'https://blinkit.com/'};
 const chrome:any={permissions:{contains:async(value:any)=>value.origins?options.sitePermission!==false:options.alerts!==false},notifications:{create:async(id:any,value:any)=>{if(options.notificationFailure)throw Error('unavailable');calls.push(['notification',value]);}},runtime:{id:'extension'},tabs:{query:async()=>[active]},storage:{session:{get:async()=>session,set:async(v:any)=>Object.assign(session,v)}},scripting:{executeScript:async(value:any)=>{calls.push(['script',value.args,value.target]);return [{result:{ok:options.fields!==false}}];}}};
 const store={get:async()=>state};
 const fetcher=async(url:string,init:any)=>{calls.push(['fetch',url,JSON.parse(init.body)]);if(url.endsWith('/v1/claim')){if(options.navigate)active={id:1,url:'https://other.example.test/'};if(options.disconnect)delete state.connection;return Response.json({...item(),code:'1357',...options.claim});}return Response.json({items:options.items||[item()]});};
 const source=readFileSync(new URL('./auto-fill.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const fn=new Function('chrome','fetch','connectionStore','bridgeOrigin','fillLoginCode','automaticRule','parse',source+'\nreturn automaticFill;')(chrome,fetcher,async()=>store,bridgeOrigin,fillLoginCode,automaticRule,parse);
 return {state,session,calls,run:()=>fn({requestAt:since},sender)};
}
test('opted-in active login fills the exact document once without a watch or manual fill click',async()=>{
 const f=fixture();await f.run();await f.run();
 expect(f.calls.filter(c=>c[0]==='fetch'&&c[1].endsWith('/v1/claim'))).toHaveLength(1);
 expect(f.calls.filter(c=>c[0]==='script').at(-1)[2]).toEqual({tabId:1,documentIds:['document-one']});
 expect(f.session.automaticFillStatus.status).toBe('filled');expect(JSON.stringify(f.session)).not.toContain('1357');
 expect(f.calls.find(c=>c[0]==='fetch')[2]).toMatchObject({service:'Blinkit',channel:'sms',since:new Date(since).toISOString()});
});
test('untrusted pages, subframes, missing document IDs, unenabled sites and unclear fields never claim',async()=>{
 for(const options of [{sender:{id:'webpage'}},{sender:{frameId:2}},{sender:{documentId:undefined}},{sender:{url:'https://evil.example.test/'}},{fields:false}]){
  const f=fixture(options);await f.run();expect(f.calls.filter(c=>c[0]==='fetch')).toHaveLength(0);
 }
});
test('ambiguous SMS never triggers a claim',async()=>{const f=fixture({items:[item(),item('two')]});await f.run();expect(f.calls.filter(c=>c[0]==='fetch')).toHaveLength(1);});
test('navigation, disconnect or an expired claim prevents the code write',async()=>{
 for(const options of [{navigate:true},{disconnect:true},{claim:{expires_at:'not-a-date'}},{claim:{expires_at:new Date(now-1).toISOString()}}]){
  const f=fixture(options);await f.run();expect(f.calls.filter(c=>c[0]==='script')).toHaveLength(1);expect(f.session.automaticFillStatus?.status).not.toBe('filled');
 }
});

test('automatic fill confirms with a generic popup; notification failure never undoes a successful fill receipt',async()=>{
 const f=fixture();await f.run();const alerts=f.calls.filter(c=>c[0]==='notification');expect(alerts).toHaveLength(1);expect(alerts[0][1].title).toBe('Login code filled');expect(JSON.stringify(alerts)).not.toContain('1357');
 for(const options of [{notificationFailure:true},{alerts:false}]){const f=fixture(options);await f.run();expect(f.session.automaticFillStatus.status).toBe('filled');expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(0);}
});

test('one global setting derives the real website brand, including private suffixes and country domains',()=>{
 const settings={autoFillEverywhere:true};
 for(const [origin,service] of [['https://accounts.google.com','google'],['https://amazon.co.in','amazon'],['https://auth.team.github.io','team'],['https://login.blinkit.com','blinkit']])expect(automaticRule(origin,settings)?.service).toBe(service);
 expect(automaticRule('https://google.com.evil.net',settings)?.service).toBe('evil');
 expect(automaticRule('https://127.0.0.1',settings)).toBeNull();
 expect(automaticRule('https://blinkit.com',{...settings,autoFillSites:{'https://blinkit.com':false}})).toBeNull();
});
test('global matching handles SMS and email without per-site setup, refusing other brands and multiple accounts',async()=>{
 for(const channel of ['sms','email']){
  const f=fixture({settings:{autoFillEverywhere:true,autoFillSites:{}},items:[{...item(),channel,account:channel==='email'?'owner@example.test':null,service_hint:'blinkit'}],claim:{account:channel==='email'?'owner@example.test':null}});await f.run();expect(f.session.automaticFillStatus.status).toBe('filled');
 }
 const rule=automaticRule('https://blinkit.com',{autoFillEverywhere:true});
 expect(automaticCandidate([{...item(),service_hint:'notblinkit'}],rule,since)).toBeNull();
 expect(automaticCandidate([{...item(),preview:'Blinkit login code [redacted]'}],rule,since)?.id).toBe('sms');
 expect(automaticCandidate([{...item(),preview:'notblinkit login code [redacted]'}],rule,since)).toBeNull();
 expect(automaticCandidate(['one','two'].map(account=>({...item(account),channel:'email',account,service_hint:'blinkit'})),rule,since)).toBeNull();
});
test('global mode cannot claim on a disabled site or a page without clear login fields',async()=>{
 for(const options of [{settings:{autoFillEverywhere:true,autoFillSites:{'https://blinkit.com':false}}},{settings:{autoFillEverywhere:true,autoFillSites:{}},fields:false},{settings:{autoFillEverywhere:true,autoFillSites:{}},sitePermission:false}]){const f=fixture(options);await f.run();expect(f.calls.filter(c=>c[0]==='fetch')).toHaveLength(0);}
});
