import {bridgeOrigin,safeLink,fillLoginCode,UserMessage,connectionStore} from './core.js';
import {automaticRule} from './auto-fill.js';
import {inboxItems,isAmbiguous} from './inbox.js';
const $=id=>document.getElementById(id);
const store=await connectionStore();
let connection=null,target=null,since=0,busy=false;
const say=text=>{$('status').textContent=text;};
const element=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
function showConnection() {document.body.classList.toggle('connected',!!connection);$('setup').hidden=!!connection;$('login').hidden=!connection;}
async function request(path,data) {
  if(!connection)throw new UserMessage('Connect your bridge first.');
  const response=await fetch(connection.origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify(data),signal:AbortSignal.timeout(30000),redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new UserMessage(response.status===401?'The bridge key was refused. Reconnect with your browser client key.':response.status===409?'This item is unavailable or needs review. Request a fresh login.':'The bridge is unavailable. Check the connection, then retry.');
  return response.json();
}
async function selectedTab(expected) {
  if(!expected?.origin)throw new UserMessage('Open the helper on your login page to fill, or use Copy code.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==expected.tabId)throw new UserMessage('Return to the login tab before filling this code.');
  const results=await chrome.scripting.executeScript({target:{tabId:expected.tabId},func:()=>location.origin});
  if(results[0]?.result!==expected.origin)throw new UserMessage('The login page changed. Open the helper there again, or copy the code.');
}
async function useItem(item,action) {
  if(busy)return;
  busy=true;const context=target?{...target}:null,usedConnection=connection;
  $('results').querySelectorAll('button').forEach(b=>b.disabled=true);
  try {
    if(Date.parse(item.expires_at)<=Date.now())throw new UserMessage('This item expired. Request a new login.');
    if(action==='fill')await selectedTab(context);
    const claim=await request('/v1/claim',{id:item.id,...(item.service_hint?{service:item.service_hint}:{})});
    if(connection!==usedConnection)throw new UserMessage('The connection changed. Choose the item again.');
    if(Date.parse(claim.expires_at)<=Date.now() || claim.account!==item.account || claim.secret_type!==item.secret_type)throw new UserMessage('This login changed or expired. Start again.');
    if(action==='open') {
      const link=safeLink(claim,item,item.link_origin);
      await chrome.tabs.create({url:link});
      say('Opened the sign-in link in a new tab. The service decides whether sign-in succeeds.');
    } else {
      if(typeof claim.code!=='string')throw new UserMessage('This item has no code to use.');
      if(action==='copy') {await navigator.clipboard.writeText(claim.code);say('Code copied. Paste it only into the login you requested. The clipboard keeps it until replaced.');}
      else {
        await selectedTab(context);
        const results=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:fillLoginCode,args:[claim.code,context.origin]});
        if(!results[0]?.result?.ok)throw new UserMessage(results[0]?.result?.reason||'Could not fill this field. Use Copy code.');
        say('Code filled. We did not press Submit; the website may continue on fill.');
      }
    }
  } catch(error) {say(error instanceof UserMessage ? error.message : 'Could not complete this action. Try again or check the original message.');}
  finally {busy=false;await refresh();}
}
async function renderInbox() {
  const {inbox,automaticFillStatus}=await chrome.storage.session.get(['inbox','automaticFillStatus']);
  const settings=await store.get(['autoFillSites','autoFillEverywhere']);
  const autoRule=target?.origin?automaticRule(target.origin,settings):null;
  $('enable-everywhere').textContent=settings.autoFillEverywhere?'Turn off automatic login filling everywhere':'Turn on automatic login filling everywhere';
  $('everywhere-state').textContent=settings.autoFillEverywhere?'On for supported HTTPS login pages. No per-site setup. Unclear codes, payments, recovery and embedded frames stay manual.':'One Chrome permission lets login filling work across websites. Your email and SMS inbox permissions stay the same.';
  $('auto-state').textContent=autoRule?'Automatic login filling is on here for '+autoRule.service+'.'+(automaticFillStatus?.origin===target?.origin&&automaticFillStatus.status==='filled'?' Last code filled automatically at '+new Date(automaticFillStatus.at).toLocaleTimeString()+'.':''):'Automatic fill is off on this site.';
  const all=inboxItems(inbox?.items),service=$('service').value.trim().toLowerCase(),account=$('account').value.trim().toLowerCase();
  const items=all.filter(item=>Date.parse(item.received_at)>=since && (!account||item.account?.toLowerCase()===account) &&
    (!service||[item.service_hint,item.sender].filter(Boolean).join(' ').toLowerCase().includes(service)));
  $('results').replaceChildren();
  for(const item of items) {
    const card=element('article','', 'card');
    card.append(element('p',item.status==='needs_review'?'NEEDS REVIEW':'READY WHEN YOU ARE','eyebrow'),element('h3',item.service_hint||item.sender||(item.channel==='sms'?'Phone login':'Email login')),element('p',item.secret_type==='link'?'Sign-in link':item.purpose==='payment'?'Payment verification — manual':'Verification code'),element('p',item.account||'Phone SMS'),element('p','Received '+new Date(item.received_at).toLocaleTimeString()),element('p','Expires '+new Date(item.expires_at).toLocaleTimeString()));
    const add=(label,action,secondary=false)=>{const button=element('button',label,secondary?'secondary':'');button.disabled=busy;button.onclick=()=>useItem(item,action);card.append(button);};
    if(item.status==='needs_review')card.append(element('p',item.purpose==='payment'?'This payment message has no single clear code. Check the bank message; payment approval stays manual.':'No single clear code was found. Check the original message.'));
    else if(isAmbiguous(item,all.filter(other=>Date.parse(other.received_at)>=since)))card.append(element('p','More than one login matches this service and account. Show only arrivals from now, then request a fresh login. We will not pick the newest.'));
    else if(item.secret_type==='link') {card.append(element('p','Destination: '+(item.link_origin||'Unverified')));if(item.link_origin)add('Open sign-in link ↗','open');}
    else {if(target?.origin)add('Fill code on '+new URL(target.origin).hostname,'fill');add('Copy code','copy',!!target?.origin);}
    $('results').append(card);
  }
  $('inbox-state').textContent=inbox?.status==='reauth'?'Your saved connection was refused. Disconnect and reconnect with an active browser key.':inbox?.status==='error'?'Cannot reach the bridge. Retrying automatically.':inbox?.sourceIssues?.length?'An inbox source needs attention. Other arrivals still appear here.':items.length?items.length+' recent login item'+(items.length===1?'':'s')+'. Automatic fill uses your saved website settings.':'Connected. New arrivals appear automatically; no watch needed.';
}
async function refresh() {
  if(!connection)return;
  try{await chrome.runtime.sendMessage({type:'refresh-inbox'});}catch{}
  await renderInbox();
}
$('connect-form').onsubmit=async event=>{
  event.preventDefault();try {
    const origin=bridgeOrigin($('bridge').value.trim()),token=$('token').value.trim();
    if(token.length<32)throw new UserMessage('Use a dedicated browser client key of at least 32 characters.');
    if(!await chrome.permissions.request({origins:[origin+'/*']}))throw new UserMessage('Bridge-host access was not granted.');
    connection={origin,token};
    try{await request('/v1/recent',{max_age_seconds:1,service:'bridge-connection-check'});}catch(error){connection=null;throw error;}
    await store.set({connection});$('token').value='';showConnection();say('Connected. This Chrome profile will stay connected after restart.');await refresh();
  }catch(error){say(error instanceof UserMessage?error.message:'Could not connect. Check the bridge address and browser key.');}
};
$('enable-everywhere').onclick=async()=>{try{
  const {autoFillEverywhere}=await store.get('autoFillEverywhere');
  if(!autoFillEverywhere&&!await chrome.permissions.request({origins:['https://*/*']}))throw new UserMessage('Website access was not granted. Existing site settings still work.');
  await store.set({autoFillEverywhere:!autoFillEverywhere});
  if(!autoFillEverywhere&&target?.tabId)await chrome.scripting.executeScript({target:{tabId:target.tabId},files:['automatic-page.js']});
  await renderInbox();say(autoFillEverywhere?'Automatic login filling everywhere is off. Explicit site settings still apply.':'Automatic login filling is on across HTTPS websites. No watch or per-site setup.');
}catch(error){say(error instanceof UserMessage?error.message:'Could not change automatic login filling.');}};
$('enable-auto').onclick=async()=>{try{
  if(!target?.origin)throw new UserMessage('Open the helper on your login page first.');
  const service=$('auto-service').value.trim(),channel=$('auto-channel').value,account=$('auto-account').value.trim().toLowerCase();
  if(!service||channel==='email'&&!account)throw new UserMessage('Set the service and exact email for email codes.');
  if(!await chrome.permissions.request({origins:[target.origin+'/*']}))throw new UserMessage('Site access was not granted.');
  const {autoFillSites={}}=await store.get('autoFillSites');autoFillSites[target.origin]={service,channel,account:channel==='email'?account:null};
  await store.set({autoFillSites});
  await chrome.scripting.executeScript({target:{tabId:target.tabId},files:['automatic-page.js']});
  $('auto-state').textContent='Automatic login filling is on for '+new URL(target.origin).hostname+'. No watch or Fill click needed.';
}catch(error){say(error instanceof UserMessage?error.message:'Could not enable automatic fill.');}};
$('disable-auto').onclick=async()=>{if(!target?.origin)return;const {autoFillSites={}}=await store.get('autoFillSites');autoFillSites[target.origin]=false;await store.set({autoFillSites});if(target.origin!==connection?.origin)await chrome.permissions.remove({origins:[target.origin+'/*']});$('auto-state').textContent='Automatic fill is off on this site.';};
$('refresh').onclick=()=>refresh();
$('notify').onclick=async()=>{try{say(await chrome.permissions.request({permissions:['notifications']})?'Desktop alerts enabled. Codes and links stay out of notifications.':'Alerts remain off. New arrivals still appear in the inbox and badge.');}catch{say('Desktop alerts are unavailable. The inbox still works.');}};
$('service').oninput=()=>renderInbox();$('account').oninput=()=>renderInbox();
$('new-only').onclick=()=>{since=Date.now();say('Showing only new arrivals. Request a fresh login now.');renderInbox();};
$('all-recent').onclick=()=>{since=0;renderInbox();};
$('disconnect').onclick=async()=>{const origin=connection?.origin,{autoFillSites={}}=await store.get('autoFillSites');connection=null;$('results').replaceChildren();await store.remove(['connection','arrivalState','autoFillSites','autoFillEverywhere']);const origins=[...new Set([...Object.keys(autoFillSites),...(origin?[origin]:[]),'https://*'])].map(value=>value+'/*');if(origins.length)await chrome.permissions.remove({origins});showConnection();say('Disconnected. Automatic checks have stopped.');};
function updateTarget(next){target=next;if(next?.origin&&new URL(next.origin).hostname==='blinkit.com')$('auto-service').value='Blinkit';$('target').textContent=next?.origin?new URL(next.origin).hostname:'Open on a login page to fill, or copy a code from here';if(connection)renderInbox();}
$('use-page').onclick=async()=>{try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>location.origin});const origin=bridgeOrigin(result[0]?.result);const next={tabId:tab.id,origin};updateTarget(next);await chrome.storage.session.set({target:next});}catch{say('Open the bridge icon on the login page to grant access. Copy and Open still work here.');}};
const saved=await chrome.storage.session.get('target');const remembered=await store.get('connection');connection=remembered.connection||null;showConnection();updateTarget(saved.target);if(connection)await refresh();
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='session')return;if(changes.target)updateTarget(changes.target.newValue);if((changes.inbox||changes.automaticFillStatus)&&connection)renderInbox();});
setInterval(()=>{if(connection)refresh();},5000);
