import {parse} from './domain.js';
import {bridgeOrigin,connectionStore,fillLoginCode} from './core.js';
const running=new Set();
export function automaticRule(origin,settings) {
  if(Object.hasOwn(settings.autoFillSites||{},origin))return settings.autoFillSites[origin]||null;
  if(!settings.autoFillEverywhere)return null;
  const domain=parse(new URL(origin).hostname,{allowPrivateDomains:true});
  if((!domain.isIcann&&!domain.isPrivate)||!domain.domainWithoutSuffix)return null;
  return {service:domain.domainWithoutSuffix,channel:null,account:null,automatic:true};
}
export function automaticCandidate(items,rule,since,now=Date.now()) {
  const matches=(items||[]).filter(item=>
    (!rule.channel?['sms','email'].includes(item.channel):item.channel===rule.channel) && item.secret_type==='code' &&
    (!rule.automatic || (item.channel!=='email'||!!item.account) &&
      (item.service_hint?item.service_hint.toLowerCase()===rule.service:new RegExp('(?:^|[^a-z0-9-])'+rule.service+'(?:$|[^a-z0-9-])','i').test(item.preview||''))) &&
    Date.parse(item.received_at)>=since && Date.parse(item.expires_at)>now && !/payment|transaction|withdraw|reset.*password|password.*reset|recover.*account/i.test(item.preview||'') &&
    (!rule.account || item.account?.toLowerCase()===rule.account.toLowerCase()));
  return matches.length===1&&['available','claimed_by_you'].includes(matches[0].status)?matches[0]:null;
}
export async function automaticFill(message,sender) {
  if(sender.id!==chrome.runtime.id || sender.frameId!==0 || typeof sender.documentId!=='string' || !sender.tab?.id || running.has(sender.tab.id))return;
  const requestAt=Number(message.requestAt),now=Date.now();
  if(!Number.isFinite(requestAt)||requestAt>now||now-requestAt>120000)return;
  const origin=bridgeOrigin(new URL(sender.url).origin),store=await connectionStore();
  const settings=await store.get(['connection','autoFillSites','autoFillEverywhere']);
  const {connection}=settings,rule=automaticRule(origin,settings);if(!connection||!rule||rule.automatic&&!await chrome.permissions.contains({origins:['https://*/*']}))return;
  running.add(sender.tab.id);
  try {
    const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(active?.id!==sender.tab.id||new URL(active.url).origin!==origin)return;
    const key=sender.documentId+':'+requestAt;
    const {automaticFills={}}=await chrome.storage.session.get('automaticFills');
    if(automaticFills[sender.tab.id]===key)return;
    const probe=await chrome.scripting.executeScript({target:{tabId:active.id},func:fillLoginCode,args:[null,origin]});
    if(!probe[0]?.result?.ok)return;
    const request=async(path,body)=>{
      const response=await fetch(connection.origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('unavailable');return response.json();
    };
    const data=await request('/v1/recent',{service:rule.service,...(rule.channel?{channel:rule.channel}:{}),...(rule.account?{account:rule.account}:{}),since:new Date(requestAt).toISOString(),max_age_seconds:120,include_claimed:true});
    const item=automaticCandidate(data.items,rule,requestAt);if(!item)return;
    const current=await store.get(['connection','autoFillSites','autoFillEverywhere']);
    if(current.connection?.token!==connection.token||current.connection?.origin!==connection.origin||JSON.stringify(automaticRule(origin,current))!==JSON.stringify(rule))return;
    const claim=await request('/v1/claim',{id:item.id,service:rule.service});
    if(claim.secret_type!=='code'||claim.account!==item.account||!Number.isFinite(Date.parse(claim.expires_at))||Date.parse(claim.expires_at)<=Date.now()||typeof claim.code!=='string')return;
    const [selected]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(selected?.id!==active.id||new URL(selected.url).origin!==origin)return;
    const latest=await store.get(['connection','autoFillSites','autoFillEverywhere']);
    if(latest.connection?.token!==connection.token||latest.connection?.origin!==connection.origin||JSON.stringify(automaticRule(origin,latest))!==JSON.stringify(rule))return;
    if(rule.automatic&&!await chrome.permissions.contains({origins:['https://*/*']}))return;
    // Bind the write to the exact document that requested it, not a tab that has navigated.
    const result=await chrome.scripting.executeScript({target:{tabId:active.id,documentIds:[sender.documentId]},func:fillLoginCode,args:[claim.code,origin,true]});
    if(!result[0]?.result?.ok)return;
    automaticFills[active.id]=key;
    await chrome.storage.session.set({automaticFills:Object.fromEntries(Object.entries(automaticFills).slice(-100)),automaticFillStatus:{origin,status:'filled',at:new Date().toISOString()}});
    try{if(chrome.notifications && await chrome.permissions.contains({permissions:['notifications']}))await chrome.notifications.create('otp-login-ready',{type:'basic',iconUrl:'icon.png',title:'Login code filled',message:'A fresh code was filled on your selected login page. No action needed.'});}catch{}
  } catch {
    await chrome.storage.session.set({automaticFillStatus:{origin,status:'manual',at:new Date().toISOString()}});
  } finally {running.delete(sender.tab.id);}
}
export async function registerAutomaticSites() {
  const {connection,autoFillSites={},autoFillEverywhere}=await (await connectionStore()).get(['connection','autoFillSites','autoFillEverywhere']);
  const registered=await chrome.scripting.getRegisteredContentScripts();
  const own=registered.filter(script=>script.id.startsWith('otp-auto-'));
  if(own.length)await chrome.scripting.unregisterContentScripts({ids:own.map(script=>script.id)});
  if(!connection)return;
  if(autoFillEverywhere && await chrome.permissions.contains({origins:['https://*/*']})){
    await chrome.scripting.registerContentScripts([{id:'otp-auto-all',matches:['https://*/*'],js:['automatic-page.js'],runAt:'document_start',persistAcrossSessions:true}]);return;
  }
  const origins=[];
  for(const origin of Object.keys(autoFillSites).filter(origin=>autoFillSites[origin]))if(await chrome.permissions.contains({origins:[origin+'/*']}))origins.push(origin);
  if(origins.length)await chrome.scripting.registerContentScripts(origins.map((origin,index)=>({id:'otp-auto-'+index,matches:[origin+'/*'],js:['automatic-page.js'],runAt:'document_start',persistAcrossSessions:true})));
}
