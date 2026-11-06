import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {bridgeOrigin} from './core.js';
import {inboxItems,arrivals} from './inbox.js';
function fixture(initial:any={}) {
 const session:any={},state:any={connection:{origin:'https://bridge.example.test',token:'synthetic-reader-key'},...initial},events:any={},calls:any[]=[];
 const listener=(name:string)=>({addListener:(fn:any)=>events[name]=fn});
 const local:any={get:async(keys:any)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async(v:any)=>Object.assign(state,v),remove:async(keys:any)=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];},setAccessLevel:async(v:any)=>calls.push(['access',v.accessLevel])};
 const chrome:any={runtime:{id:'test-extension',getURL:(p:string)=>'chrome-extension://test-extension/'+p,onInstalled:listener('installed'),onStartup:listener('startup'),onMessage:listener('message')},storage:{local,session:{get:async(keys:any)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,session[k]])),set:async(v:any)=>Object.assign(session,v),remove:async(key:string)=>{delete session[key];}},onChanged:listener('storage')},alarms:{create:async(...v:any[])=>calls.push(['alarm',...v]),clear:async(...v:any[])=>calls.push(['clear',...v]),onAlarm:listener('alarm')},action:{setBadgeText:async(v:any)=>calls.push(['badge',v.text]),setBadgeBackgroundColor:async()=>{}},permissions:{onAdded:listener('permission-added'),contains:async()=>state.alerts!==false},notifications:{create:async(...v:any[])=>{if(state.notificationFailure)throw Error('notifications unavailable');calls.push(['notification',...v]);},clear:async()=>{},onClicked:listener('notification-click')},sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},windows:{getCurrent:async()=>({id:1})}};
 if(state.notificationsUnavailable)delete chrome.notifications;
 let items:any[]=[],fail=false,networkHook:any;
 const network=async(url:any,options:any)=>{calls.push(['fetch',url,JSON.parse(options.body)]);if(networkHook)await networkHook();if(fail)throw Error('provider may include secret');return Response.json({items});};
 const code=readFileSync(new URL('./background.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const connectionSource=readFileSync(new URL('./core.js',import.meta.url),'utf8').split('export async function connectionStore',2)[1].split('export function bridgeOrigin',1)[0];
 const connectionStore=new Function('chrome','return async function connectionStore'+connectionSource)(chrome);
 const worker=new Function('chrome','fetch','bridgeOrigin','inboxItems','arrivals','connectionStore','automaticFill','registerAutomaticSites',code+'\nreturn {updateInbox,startInbox};')(chrome,network,bridgeOrigin,inboxItems,arrivals,connectionStore,async()=>{},async()=>{});
 return {worker,state,session,events,calls,chrome,setItems:(v:any[])=>items=v,fail:()=>fail=true,hook:(fn:any)=>networkHook=fn};
}
const item=(id:string)=>({id,status:'available',secret_type:'link',channel:'email',account:'owner@example.test',service_hint:'Afterspan',received_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),link:'https://example.test/#privatevalueforsyntheticcheck',code:'privatevalueforsyntheticcheck',preview:'privatevalueforsyntheticcheck'});
test('background detects new arrivals without a panel or watch and never claims a secret',async()=>{
 const f=fixture();f.setItems([item('old')]);await f.worker.startInbox();
 expect(f.calls.some(c=>c[0]==='alarm'&&c[2].periodInMinutes===0.5)).toBe(true);
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(0);
 f.setItems([item('old'),item('new')]);await f.worker.updateInbox();await f.worker.updateInbox();
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(1);
 expect(f.calls.filter(c=>c[0]==='fetch').every(c=>c[1]==='https://bridge.example.test/v1/recent')).toBe(true);
 expect(JSON.stringify(f.session.inbox)).not.toContain('privatevalueforsyntheticcheck');
 expect(f.calls.filter(c=>c[0]==='badge').at(-1)[1]).toBe('2');
});
test('turning alerts off keeps automatic capture and badge working',async()=>{
 const f=fixture({alerts:false});await f.worker.startInbox();f.setItems([item('new')]);await f.worker.updateInbox();
 expect(f.calls.filter(c=>c[0]==='notification')).toHaveLength(0);expect(f.session.inbox.items).toHaveLength(1);
});
test('disconnect clears the alarm, metadata and badge; stale in-flight responses cannot restore them',async()=>{
 const f=fixture();let release:any;f.hook(()=>new Promise(r=>release=r));
 const pending=f.worker.updateInbox();await new Promise(r=>setTimeout(r,0));delete f.state.connection;
 await f.worker.startInbox();release();await pending;
 expect(f.session.inbox).toEqual({items:[],status:'disconnected'});expect(f.calls.some(c=>c[0]==='clear')).toBe(true);
});
test('network failure clears actionable cached cards and does not surface provider text',async()=>{
 const f=fixture();f.fail();await f.worker.updateInbox();expect(f.session.inbox.status).toBe('error');expect(f.session.inbox.items).toHaveLength(0);expect(JSON.stringify(f.session.inbox)).not.toContain('privatevalueforsyntheticcheck');
});
test('web pages cannot invoke the extension refresh handler',()=>{
 const f=fixture();expect(f.events.message({type:'refresh-inbox'},{id:'test-extension',url:'https://evil.example.test'},()=>{})).toBeUndefined();expect(f.calls).toHaveLength(0);
});

test('notification failures do not turn a healthy inbox into a connection error',async()=>{
 const f=fixture({notificationFailure:true});await f.worker.startInbox();f.setItems([item('new')]);await f.worker.updateInbox();expect(f.session.inbox.status).toBe('ok');expect(f.session.inbox.items).toHaveLength(1);
});

test('Chrome restarts restore the saved connection and deduplicate alerts; disconnect remains disconnected',async()=>{
 const first=fixture();first.setItems([item('one')]);await first.worker.startInbox();
 const resumed=fixture(JSON.parse(JSON.stringify(first.state)));resumed.setItems([item('one')]);await resumed.worker.startInbox();
 expect(resumed.calls.filter(c=>c[0]==='notification')).toHaveLength(0);expect(resumed.calls.some(c=>c[0]==='alarm')).toBe(true);
 const restarted=fixture({connection:undefined});await restarted.worker.startInbox();expect(restarted.calls.filter(c=>c[0]==='fetch')).toHaveLength(0);expect(restarted.session.inbox.status).toBe('disconnected');
});

test('missing optional notification API cannot prevent startup; granting it registers clicks once',async()=>{
 const f=fixture({alerts:false,notificationsUnavailable:true});
 await f.worker.startInbox();f.setItems([item('new')]);await f.worker.updateInbox();
 expect(f.session.inbox.items).toHaveLength(1);expect(f.calls.filter(c=>c[0]==='badge').at(-1)[1]).toBe('1');
 expect(f.events['notification-click']).toBeUndefined();
 let listeners=0;f.chrome.notifications={onClicked:{addListener:()=>listeners++}};
 f.events['permission-added']();f.events['permission-added']();expect(listeners).toBe(1);
});

test('restart catches a new SMS while skipping previously seen mail and protects persistent credentials from content scripts',async()=>{
 const first=fixture();first.setItems([item('mail')]);await first.worker.startInbox();
 const restarted=fixture(JSON.parse(JSON.stringify(first.state)));
 restarted.setItems([item('mail'),{...item('phone'),channel:'sms',account:null,secret_type:'code',service_hint:'Google'}]);
 await restarted.worker.startInbox();
 expect(restarted.session.inbox.items).toHaveLength(2);
 expect(restarted.calls.filter(c=>c[0]==='notification')).toHaveLength(1);
 expect(restarted.calls.some(c=>c[0]==='fetch')).toBe(true);
 expect(restarted.calls.filter(c=>c[0]==='access').every(c=>c[1]==='TRUSTED_CONTEXTS')).toBe(true);
 expect(restarted.session.connection).toBeUndefined();
 expect(JSON.stringify(restarted.state.arrivalState)).not.toContain('synthetic-reader-key');
 expect(restarted.calls.filter(c=>c[0]==='fetch').every(c=>c[1].endsWith('/v1/recent'))).toBe(true);
});

test('an arrival click opens a helper popup when Chrome refuses to open the side panel',async()=>{
 const f=fixture();f.chrome.sidePanel.open=async()=>{throw Error('gesture unavailable');};
 let popup:any;f.chrome.windows.create=async(value:any)=>popup=value;
 await f.events['notification-click']('otp-login-ready');
 expect(popup).toEqual({url:'chrome-extension://test-extension/panel.html',type:'popup',width:420,height:760});
 expect(f.calls.filter(c=>c[0]==='fetch')).toHaveLength(0);
});
