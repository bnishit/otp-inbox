import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {automaticCandidate} from './auto-fill.js';
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
 let active:any={id:1,url:'https://blinkit.com/'};
 const chrome:any={permissions:{contains:async()=>options.alerts!==false},notifications:{create:async(id:any,value:any)=>{if(options.notificationFailure)throw Error('unavailable');calls.push(['notification',value]);}},runtime:{id:'extension'},tabs:{query:async()=>[active]},storage:{session:{get:async()=>session,set:async(v:any)=>Object.assign(session,v)}},scripting:{executeScript:async(value:any)=>{calls.push(['script',value.args,value.target]);return [{result:{ok:options.fields!==false}}];}}};
 const store={get:async()=>state};
 const fetcher=async(url:string,init:any)=>{calls.push(['fetch',url,JSON.parse(init.body)]);if(url.endsWith('/v1/claim')){if(options.navigate)active={id:1,url:'https://other.example.test/'};if(options.disconnect)delete state.connection;return Response.json({...item(),code:'1357',...options.claim});}return Response.json({items:options.items||[item()]});};
 const source=readFileSync(new URL('./auto-fill.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const fn=new Function('chrome','fetch','connectionStore','bridgeOrigin','fillLoginCode',source+'\nreturn automaticFill;')(chrome,fetcher,async()=>store,bridgeOrigin,fillLoginCode);
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
