import {parse} from './domain.js';
import {bridgeOrigin,connectionStore,fillLoginCode} from './core.js';
const running=new Set();
// A rough, honest estimate: unlock phone, find the message, type the digits, press Verify.
export const SECONDS_SAVED_PER_CODE=20;
export function automaticRule(origin,settings) {
  if(Object.hasOwn(settings.autoFillSites||{},origin))return settings.autoFillSites[origin]?{...settings.autoFillSites[origin],payments:settings.paymentAutomation||null}:null;
  if(!settings.autoFillEverywhere)return null;
  const domain=parse(new URL(origin).hostname,{allowPrivateDomains:true});
  if((!domain.isIcann&&!domain.isPrivate)||!domain.domainWithoutSuffix)return null;
  return {service:domain.domainWithoutSuffix,channel:null,account:null,automatic:true,payments:settings.paymentAutomation||null};
}
export function automaticCandidate(items,rule,since,now=Date.now()) {
  const matches=(items||[]).filter(item=>
    (!rule.channel?['sms','email'].includes(item.channel):item.channel===rule.channel) && item.secret_type==='code' &&
    (!rule.automatic || (item.channel!=='email'||!!item.account) &&
      (item.service_hint&&!rule.payment?item.service_hint.toLowerCase()===rule.service:new RegExp('(?:^|[^a-z0-9-])'+rule.service+'(?:$|[^a-z0-9-])','i').test(item.preview||''))) &&
    Date.parse(item.received_at)>=since && Date.parse(item.expires_at)>now && !/withdraw|bank transfer|reset.*password|password.*reset|recover.*account/i.test(item.preview||'') && (rule.payment?!!rule.payments:/payment|transaction|merchant|purchase/i.test(item.preview||'')===false) &&
    (!rule.account || item.account?.toLowerCase()===rule.account.toLowerCase()));
  return matches.length===1&&['available','claimed_by_you'].includes(matches[0].status)?matches[0]:null;
}
export async function automaticFill(message,sender) {
  if(sender.id!==chrome.runtime.id || sender.frameId!==0 || typeof sender.documentId!=='string' || !sender.tab?.id || running.has(sender.tab.id))return;
  const requestAt=Number(message.requestAt),now=Date.now();
  if(!Number.isFinite(requestAt)||requestAt>now||now-requestAt>120000)return;
  const origin=bridgeOrigin(new URL(sender.url).origin),store=await connectionStore();
  const settings=await store.get(['connection','autoFillSites','autoFillEverywhere','paymentAutomation','autoSubmitLogin','fillSound']);
  const {connection}=settings,rule=automaticRule(origin,settings);if(!connection||!rule||rule.automatic&&!await chrome.permissions.contains({origins:['https://*/*']}))return;
  running.add(sender.tab.id);
  try {
    const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(active?.id!==sender.tab.id||new URL(active.url).origin!==origin)return;
    const key=sender.documentId+':'+requestAt;
    const {automaticFills={}}=await chrome.storage.session.get('automaticFills');
    if(automaticFills[sender.tab.id]===key)return;
    const probe=await chrome.scripting.executeScript({target:{tabId:active.id},func:fillLoginCode,args:[null,origin,{payments:rule.payments}]});
    if(!probe[0]?.result?.ok)return;
    const request=async(path,body,seconds=10)=>{
      const response=await fetch(connection.origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(seconds*1000)});
      if(!response.ok)throw Error('unavailable');return response.json();
    };
    // A saved site rule wins; otherwise use what the page says next to the box (phone vs email).
    const channel=rule.channel||probe[0].result.channel||null;
    const data=await request('/v1/recent',{service:rule.service,...(channel?{channel}:{}),...(rule.account?{account:rule.account}:{}),since:new Date(requestAt).toISOString(),max_age_seconds:120,include_claimed:true,wait_seconds:20},30);
    // The bridge holds this request open and answers the moment the SMS lands, instead of us asking every few seconds.
    const item=automaticCandidate(data.items,{...rule,channel,payment:probe[0].result.payment===true},requestAt);if(!item)return;
    const current=await store.get(['connection','autoFillSites','autoFillEverywhere','paymentAutomation']);
    if(current.connection?.token!==connection.token||current.connection?.origin!==connection.origin||JSON.stringify(automaticRule(origin,current))!==JSON.stringify(rule))return;
    const claim=await request('/v1/claim',{id:item.id,service:rule.service});
    if(claim.secret_type!=='code'||claim.account!==item.account||!Number.isFinite(Date.parse(claim.expires_at))||Date.parse(claim.expires_at)<=Date.now()||typeof claim.code!=='string')return;
    const [selected]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(selected?.id!==active.id||new URL(selected.url).origin!==origin)return;
    const latest=await store.get(['connection','autoFillSites','autoFillEverywhere','paymentAutomation']);
    if(latest.connection?.token!==connection.token||latest.connection?.origin!==connection.origin||JSON.stringify(automaticRule(origin,latest))!==JSON.stringify(rule))return;
    if(rule.automatic&&!await chrome.permissions.contains({origins:['https://*/*']}))return;
    // Bind the write to the exact document that requested it, not a tab that has navigated.
    const result=await chrome.scripting.executeScript({target:{tabId:active.id,documentIds:[sender.documentId]},func:fillLoginCode,args:[claim.code,origin,{payments:rule.payments,expectedPayment:probe[0].result.payment===true,submit:settings.autoSubmitLogin!==false}]});
    if(!result[0]?.result?.ok)return;
    const pressed=result[0].result.submit;
    automaticFills[active.id]=key;
    await chrome.storage.session.set({automaticFills:Object.fromEntries(Object.entries(automaticFills).slice(-100)),automaticFillStatus:{origin,status:'filled',at:new Date().toISOString()}});
    const {savings={fills:0,seconds:0,since:new Date().toISOString()}}=await store.get('savings');
    const total={...savings,fills:savings.fills+1,seconds:savings.seconds+SECONDS_SAVED_PER_CODE};
    await store.set({savings:total});
    const host=new URL(origin).hostname.replace(/^www\./,'');
    const title=probe[0].result.payment?'Payment code filled':pressed?'Code filled · '+pressed+' pressed':'Code filled';
    try{await chrome.scripting.executeScript({target:{tabId:active.id,documentIds:[sender.documentId]},func:showSavedToast,args:[title,'OTP Bridge saved you ~'+SECONDS_SAVED_PER_CODE+'s on '+host,formatSaved(total.seconds)+' saved across '+total.fills+' code'+(total.fills===1?'':'s'),settings.fillSound!==false]});}catch{}
  } catch {
    await chrome.storage.session.set({automaticFillStatus:{origin,status:'manual',at:new Date().toISOString()}});
  } finally {running.delete(sender.tab.id);}
}
export async function registerAutomaticSites() {
  const {connection,autoFillSites={},autoFillEverywhere}=await (await connectionStore()).get(['connection','autoFillSites','autoFillEverywhere','paymentAutomation']);
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

export function formatSaved(seconds) {
  if(seconds<60)return seconds+'s';
  const minutes=Math.round(seconds/60);
  return minutes<60?minutes+' min':Math.floor(minutes/60)+'h '+(minutes%60)+'m';
}
// Runs inside the page. Shadow DOM keeps the site's CSS out and ours in.
export function showSavedToast(title,line,total,sound) {
  document.getElementById('otp-bridge-toast')?.remove();
  const host=document.createElement('div');host.id='otp-bridge-toast';
  const root=host.attachShadow({mode:'closed'});
  const sparks=Array.from({length:12},(_,i)=>`<i style="--a:${i*30}deg;--d:${38+(i%3)*10}px"></i>`).join('');
  root.innerHTML=`<style>
  .t{position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;width:max-content;max-width:calc(100vw - 32px);padding:16px 22px 16px 16px;border-radius:20px;background:#14170f;color:#f1f2e9;font:14px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.4),0 0 0 1px rgba(215,247,139,.18);animation:in .55s cubic-bezier(.2,1.4,.3,1) both,out .35s ease-in 4.6s forwards}
  .m{position:relative;flex:none;width:44px;height:44px;border-radius:14px;background:#d7f78b;display:grid;place-items:center;animation:pop .5s .15s cubic-bezier(.2,1.6,.3,1) both}
  .m svg{width:24px;height:24px}.m path{fill:none;stroke:#14170f;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:draw .35s .35s ease-out forwards}
  .m i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#d7f78b;opacity:0;animation:spark .7s .4s ease-out forwards}
  .m i:nth-child(3n){background:#fff}.m i:nth-child(3n+1){background:#9be15d}
  b{display:block;font-size:15px}span{display:block;color:#b9c2ad;font-size:13px}em{display:block;font-style:normal;color:#d7f78b;font-size:12px;margin-top:3px}
  .p{flex:none;margin-left:6px;padding:5px 10px;border-radius:99px;background:#d7f78b;color:#14170f;font-weight:800;font-size:13px;animation:pop .45s .55s cubic-bezier(.2,1.6,.3,1) both}
  @keyframes in{from{opacity:0;transform:translate(-50%,40px) scale(.9)}}@keyframes out{to{opacity:0;transform:translate(-50%,20px) scale(.96)}}
  @keyframes pop{from{transform:scale(0)}}@keyframes draw{to{stroke-dashoffset:0}}
  @keyframes spark{0%{opacity:1;transform:rotate(var(--a)) translateY(0)}100%{opacity:0;transform:rotate(var(--a)) translateY(calc(-1*var(--d))) scale(.4)}}
  @media(prefers-reduced-motion:reduce){*,.t{animation-duration:1ms!important;animation-delay:0s!important}.t{animation:out .3s ease-in 4.6s forwards}.m path{stroke-dashoffset:0}}
  </style><div class="t" role="status"><div class="m">${sparks}<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><div><b></b><span></span><em></em></div><div class="p"></div></div>`;
  root.querySelector('b').textContent=title;root.querySelector('span').textContent=line;root.querySelector('em').textContent=total;
  root.querySelector('.p').textContent='+'+(line.match(/~(\d+s)/)?.[1]||'time');
  document.documentElement.append(host);
  setTimeout(()=>host.remove(),5200);
  if(!sound)return;
  // A soft two-note chime, made on the spot: no audio file, nothing downloaded.
  try{
    const audio=new AudioContext(),start=audio.currentTime+.32;
    [[880,0],[1318.5,.11]].forEach(([freq,delay])=>{
      const tone=audio.createOscillator(),level=audio.createGain();
      tone.type='sine';tone.frequency.value=freq;tone.connect(level);level.connect(audio.destination);
      level.gain.setValueAtTime(0,start+delay);level.gain.linearRampToValueAtTime(.12,start+delay+.015);level.gain.exponentialRampToValueAtTime(.0001,start+delay+.5);
      tone.start(start+delay);tone.stop(start+delay+.55);
    });
    setTimeout(()=>audio.close(),1500);
  }catch{}
}
