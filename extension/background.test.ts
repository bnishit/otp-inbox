import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {bridgeOrigin} from './core.js';
import {inboxItems,arrivals} from './inbox.js';
function fixture(initial:any={}) {
 const state:any={connection:{origin:'https://bridge.example.test',token:'synthetic-reader-key'},...initial},events:any={},calls:any[]=[];
 const listener=(name:string)=>({addListener:(fn:any)=>events[name]=fn});
 const chrome:any={runtime:{id:'test-extension',getURL:(p:string)=>'chrome-extension://test-extension/'+p,onInstalled:listener('installed'),onStartup:listener('startup'),onMessage:listener('message')},storage:{session:{get:async(keys:any)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async(v:any)=>Object.assign(state,v),remove:async(key:string)=>{delete state[key];}},onChanged:listener('storage')},alarms:{create:async(...v:any[])=>calls.push(['alarm',...v]),clear:async(...v:any[])=>calls.push(['clear',...v]),onAlarm:listener('alarm')},action:{setBadgeText:async(v:any)=>calls.push(['badge',v.text]),setBadgeBackgroundColor:async()=>{}},permissions:{contains:async()=>state.alerts!==false},notifications:{create:async(...v:any[])=>{if(state.notificationFailure)throw Error('notifications unavailable');calls.push(['notification',...v]);},clear:async()=>{},onClicked:listener('notification-click')},sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},windows:{getCurrent:async()=>({id:1})}};
 let items:any[]=[],fail=false,networkHook:any;
 const network=async(url:any,options:any)=>{calls.push(['fetch',url,JSON.parse(options.body)]);if(networkHook)await networkHook();if(fail)throw Error('provider may include secret');return Response.json({items});};
 const code=readFileSync(new URL('./background.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const worker=new Function('chrome','fetch','bridgeOrigin','inboxItems','arrivals',code+'\nreturn {updateInbox,startInbox};')(chrome,network,bridgeOrigin,inboxItems,arrivals);
 return {worker,state,events,calls,setItems:(v:any[])=>items=v,fail:()=>fail=true,hook:(fn:any)=>networkHook=fn};
}
const item=(id:string)=>({id,status:'available',secret_type:'link',channel:'email',account:'owner@example.test',service_hint:'Afterspan',received_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),link:'https://example.test/#privatevalueforsyntheticcheck',code:'privatevalueforsyntheticcheck',preview:'privatevalueforsyntheticcheck'});
test('background detects new arrivals without a panel or watch and never claims a secret',async()=>{
 const f=fixture();f.setItems([item('old')]);await f.worker.startInbox();
 expect(f.calls.some(c=>c[0]==='alarm'&&c[2].periodInMinutes===0.5)).toBe(true);
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(0);
 f.setItems([item('old'),item('new')]);await f.worker.updateInbox();await f.worker.updateInbox();
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(1);
 expect(f.calls.filter(c=>c[0]==='fetch').every(c=>c[1]==='https://bridge.example.test/v1/recent')).toBe(true);
 expect(JSON.stringify(f.state.inbox)).not.toContain('privatevalueforsyntheticcheck');
 expect(f.calls.filter(c=>c[0]==='badge').at(-1)[1]).toBe('2');
});
test('turning alerts off keeps automatic capture and badge working',async()=>{
 const f=fixture({alerts:false});await f.worker.startInbox();f.setItems([item('new')]);await f.worker.updateInbox();
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(0);expect(f.state.inbox.items).toHaveLength(1);
});
test('disconnect clears the alarm, metadata and badge; stale in-flight responses cannot restore them',async()=>{
 const f=fixture();let release:any;f.hook(()=>new Promise(r=>release=r));
 const pending=f.worker.updateInbox();await new Promise(r=>setTimeout(r,0));delete f.state.connection;
 await f.worker.startInbox();release();await pending;
 expect(f.state.inbox).toEqual({items:[],status:'disconnected'});expect(f.calls.some(c=>c[0]==='clear')).toBe(true);
});
test('network failure clears actionable cached cards and does not surface provider text',async()=>{
 const f=fixture();f.fail();await f.worker.updateInbox();expect(f.state.inbox.status).toBe('error');expect(f.state.inbox.items).toHaveLength(0);expect(JSON.stringify(f.state.inbox)).not.toContain('privatevalueforsyntheticcheck');
});
test('web pages cannot invoke the extension refresh handler',()=>{
 const f=fixture();expect(f.events.message({type:'refresh-inbox'},{id:'test-extension',url:'https://evil.example.test'},()=>{})).toBeUndefined();expect(f.calls).toHaveLength(0);
});

test('notification failures do not turn a healthy inbox into a connection error',async()=>{
 const f=fixture({notificationFailure:true});await f.worker.startInbox();f.setItems([item('new')]);await f.worker.updateInbox();expect(f.state.inbox.status).toBe('ok');expect(f.state.inbox.items).toHaveLength(1);
});

test('worker restarts restore polling without duplicate alerts; a cleared browser session does not fetch',async()=>{
 const first=fixture();first.setItems([item('one')]);await first.worker.startInbox();
 const resumed=fixture(JSON.parse(JSON.stringify(first.state)));resumed.setItems([item('one')]);await resumed.worker.startInbox();
 expect(resumed.calls.filter(c=>c[0]==='notification')).toHaveLength(0);expect(resumed.calls.some(c=>c[0]==='alarm')).toBe(true);
 const restarted=fixture({connection:undefined});await restarted.worker.startInbox();expect(restarted.calls.filter(c=>c[0]==='fetch')).toHaveLength(0);expect(restarted.state.inbox.status).toBe('disconnected');
});
