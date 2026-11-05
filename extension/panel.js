import {bridgeOrigin,loginMatches,safeLink,fillLoginCode,UserMessage} from './core.js';
const $=id=>document.getElementById(id);
let connection=null,target=null,watch=null,controller=null,watchTimer=null;
const say=text=>{$('status').textContent=text;};
const element=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
function stop(message) {
  watch=null;clearTimeout(watchTimer);watchTimer=null;controller?.abort();controller=null;$('start').disabled=false;$('stop').hidden=true;
  if(message)say(message);
}
function showConnection() {$('setup').hidden=!!connection;$('login').hidden=!connection;}
async function request(path,data,signal) {
  if(!connection)throw new UserMessage('Connect your bridge first.');
  const response=await fetch(connection.origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify(data),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new UserMessage(response.status===401?'The bridge key was refused. Reconnect with your browser client key.':response.status===409?'This item is unavailable or needs review. Request a fresh login.':'The bridge is unavailable. Check the connection, then retry.');
  return response.json();
}
async function selectedTab(expected) {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==expected.tabId)throw new UserMessage('Return to the login tab before using this item.');
  const results=await chrome.scripting.executeScript({target:{tabId:expected.tabId},func:()=>location.origin});
  if(results[0]?.result!==expected.origin)throw new UserMessage('The login page changed. Click the bridge icon there and start again.');
}
async function useItem(item,action,context) {
  const buttons=[...$('results').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try {
    if(Date.parse(item.expires_at)<=Date.now())throw new UserMessage('This item expired. Request a new login.');
    await selectedTab(context);
    const claim=await request('/v1/claim',{id:item.id,service:context.service});
    if(Date.parse(claim.expires_at)<=Date.now() || claim.account!==item.account || claim.secret_type!==item.secret_type)throw new UserMessage('This login changed or expired. Start again.');
    if(action==='open') {
      const link=safeLink(claim,item,context.origin);
      await selectedTab(context);
      await chrome.tabs.update(context.tabId,{url:link});
      $('results').replaceChildren();say('Opened the sign-in link in your login tab. The service decides whether sign-in succeeds.');
    } else {
      if(typeof claim.code!=='string')throw new UserMessage('This item has no code to fill.');
      if(action==='copy') {await navigator.clipboard.writeText(claim.code);say('Code copied. Paste it only into this login. The clipboard keeps it until replaced.');}
      else {
        await selectedTab(context);
        const results=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:fillLoginCode,args:[claim.code,context.origin]});
        if(!results[0]?.result?.ok)throw new UserMessage(results[0]?.result?.reason||'Could not fill this field. Use Copy code.');
        say('Code filled. We did not press Submit; the website may continue on fill.');
      }
    }
  } catch(error) {say(error instanceof UserMessage ? error.message : 'Could not complete this action. Return to the login tab and try again, or copy the code.');}
  finally {buttons.forEach(b=>b.disabled=Date.parse(item.expires_at)<=Date.now());}
}
function render(result,context) {
  const ready=loginMatches(result.items,context);
  $('results').replaceChildren();
  if(ready.length>1) {
    say('More than one login matches. Request a fresh code, then restart with a new watch time. We will not pick the newest.');
    for(const item of ready){const card=element('article','', 'card');card.append(element('h3',item.secret_type==='link'?'Sign-in link':'Login code'),element('p',item.account||'Phone SMS'),element('p','Received '+new Date(item.received_at).toLocaleTimeString()));$('results').append(card);}
    return true;
  }
  if(!ready.length) {
    const review=result.items.some(i=>i.status==='needs_review');
    if(review){say('A message arrived but needs review. Check the original message; nothing will be filled or opened.');return true;}
    const unhealthy=result.sources?.some(s=>['error','stale','awaiting_setup'].includes(s.status));
    const rejected=result.sources?.some(s=>(s.capture_counts?.recipient_not_approved||s.capture_counts?.ambiguous_recipient));
    say(rejected?'This source has rejected a recipient before. If this login stays missing, ask the owner to check approved aliases.':unhealthy?'An inbox source needs attention. Phone forwarding and email sources must be connected.':'Watching for this login. Keep this panel open.');return false;
  }
  const item=ready[0],card=element('article','', 'card');
  card.append(element('p','READY FOR THIS LOGIN','eyebrow'),element('h3',item.secret_type==='link'?'Your sign-in link arrived.':'Your code arrived.'),element('p',item.account||'From phone SMS'),element('p','Received '+new Date(item.received_at).toLocaleTimeString()),element('p','Expires '+new Date(item.expires_at).toLocaleTimeString()));
  const add=(label,action,secondary=false)=>{const button=element('button',label,secondary?'secondary':'');button.onclick=()=>useItem(item,action,context);card.append(button);};
  if(item.secret_type==='link') {
    card.append(element('p','Destination: '+(item.link_origin||'Unverified')));
    if(item.link_origin===context.origin)add('Open sign-in link ↗','open');
    else card.append(element('p','This link belongs to another website. Open that site and start a new watch.'));
  } else {add('Fill code on '+new URL(context.origin).hostname,'fill');add('Copy code','copy',true);}
  $('results').append(card);card.scrollIntoView({block:'nearest'});say('One match. Choose the next step; the secret stays hidden here.');
  const expiresIn=Math.max(0,Date.parse(item.expires_at)-Date.now());
  setTimeout(()=>{if(card.isConnected){card.querySelectorAll('button').forEach(b=>b.disabled=true);say('This item expired. Request a new login.');}},expiresIn);
  return true;
}
$('connect-form').onsubmit=async event=>{
  event.preventDefault();try {
    const origin=bridgeOrigin($('bridge').value.trim()),token=$('token').value.trim();
    if(token.length<32)throw new UserMessage('Use a dedicated browser client key of at least 32 characters.');
    const granted=await chrome.permissions.request({origins:[origin+'/*']});
    if(!granted)throw new UserMessage('Connection access was not granted. Your inbox permissions are unchanged.');
    connection={origin,token};
    try{await request('/v1/recent',{max_age_seconds:1,service:'bridge-connection-check'});}catch(error){connection=null;throw error;}
    await chrome.storage.session.set({connection});$('token').value='';showConnection();say('Bridge connected. Choose the login you want to watch.');
  }catch(error){say(error instanceof UserMessage ? error.message : 'Could not connect. Check the bridge address and browser key.');}
};
$('watch-form').onsubmit=async event=>{
  event.preventDefault();stop();$('results').replaceChildren();
  if(!target?.origin){say('Click the bridge icon on your login page first.');return;}
  const channel=$('channel').value,account=$('account').value.trim().toLowerCase(),service=$('service').value.trim();
  if(!service || (channel==='email'&&!account)){say('Choose the service and exact sign-in email.');return;}
  let notify=false;
  if($('notify').checked) {try{notify=await chrome.permissions.request({permissions:['notifications']});}catch{} }
  const context={...target,service,channel,account,notify,since:new Date().toISOString(),deadline:Date.now()+120000};
  try{await selectedTab(context);}catch(error){say(error instanceof UserMessage ? error.message : 'Click the bridge icon again on the login tab.');return;}
  watch=context;controller=new AbortController();const signal=controller.signal;
  watchTimer=setTimeout(()=>{if(watch===context)stop('No match in two minutes. Check forwarding or inbox health, then request a fresh login.');},120000);
  $('start').disabled=true;$('stop').hidden=false;say('Watching for this login. Request the code or link now.');
  while(watch===context && Date.now()<context.deadline) {
    try{
      const result=await request('/v1/recent',{service,channel,...(channel==='email'?{account}:{}),since:context.since,wait_seconds:Math.min(25,Math.max(0,(context.deadline-Date.now())/1000)),max_age_seconds:600,include_claimed:true},signal);
      if(watch!==context)break;
      if(render(result,context)){
        if(context.notify && loginMatches(result.items,context).length===1)chrome.notifications.create('otp-login-ready',{type:'basic',iconUrl:'icon.png',title:'Your login is ready',message:'Return to the login helper to fill a code or open a sign-in link.'}).catch(()=>{});
        stop();break;
      }
    }catch(error){if(signal.aborted)break;stop(error instanceof UserMessage ? error.message : 'Cannot reach the bridge. Check the connection, then retry.');break;}
  }
  if(watch===context)stop('No match in two minutes. Check forwarding or inbox health, then request a fresh login.');
};
$('stop').onclick=()=>stop('Stopped. No login action was taken.');
$('channel').onchange=()=>{const email=$('channel').value==='email';$('account-label').hidden=!email;$('account').required=email;};
$('disconnect').onclick=async()=>{stop();const origin=connection?.origin;connection=null;$('results').replaceChildren();await chrome.storage.session.remove('connection');if(origin)await chrome.permissions.remove({origins:[origin+'/*']});showConnection();say('Disconnected. No secrets were saved by this helper.');};
function updateTarget(next) {stop('Login page selected. Start a new watch before requesting your code.');$('results').replaceChildren();target=next;$('target').textContent=next?.origin?new URL(next.origin).hostname:'Click the bridge icon on your login page';}
$('use-page').onclick=async()=>{
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>location.origin});
    const origin=result[0]?.result;
    if(!origin)throw Error();
    bridgeOrigin(origin);
    const next={tabId:tab.id,origin,startedAt:new Date().toISOString()};updateTarget(next);await chrome.storage.session.set({target:next});
  }catch{say('Click the bridge icon on this login page to grant access, then choose Use current page.');}
};
const saved=await chrome.storage.session.get(['connection','target']);connection=saved.connection||null;showConnection();
const [currentTab]=await chrome.tabs.query({active:true,currentWindow:true});
let initialTarget=saved.target;
try{const url=new URL(currentTab.url);initialTarget={tabId:currentTab.id,origin:bridgeOrigin(url.origin),startedAt:new Date().toISOString()};}catch{}
updateTarget(initialTarget);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.target)updateTarget(changes.target.newValue);});
