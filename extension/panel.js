import {bridgeOrigin,safeLink,fillLoginCode,UserMessage,connectionStore} from './core.js';
import {automaticRule,formatSaved,SECONDS_SAVED_PER_CODE} from './auto-fill.js';
import {isAmbiguous} from './inbox.js';
const $=id=>document.getElementById(id);
const store=await connectionStore();
let connection=null,target=null,busy=false;
const say=text=>{$('status').textContent=text;};
const fail=(error,fallback)=>say(error instanceof UserMessage?error.message:fallback);
const element=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
const ago=iso=>{const s=Math.max(0,Math.round((Date.now()-Date.parse(iso))/1000));return s<60?'just now':Math.round(s/60)+' min ago';};
const host=origin=>new URL(origin).hostname.replace(/^www\./,'');

async function request(path,data) {
  if(!connection)throw new UserMessage('Connect your bridge first.');
  const response=await fetch(connection.origin+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify(data),signal:AbortSignal.timeout(30000),redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new UserMessage(response.status===401?'The bridge key was refused. Reconnect.':response.status===409?'This code is gone or needs review. Ask the site for a new one.':'Cannot reach the bridge. Try again.');
  return response.json();
}

async function useItem(item,action) {
  if(busy)return;busy=true;render();
  try {
    if(Date.parse(item.expires_at)<=Date.now())throw new UserMessage('This code expired. Ask the site for a new one.');
    const claim=await request('/v1/claim',{id:item.id,...(item.service_hint?{service:item.service_hint}:{})});
    if(Date.parse(claim.expires_at)<=Date.now()||claim.account!==item.account||claim.secret_type!==item.secret_type)throw new UserMessage('This code changed or expired.');
    if(action==='open'){await chrome.tabs.create({url:safeLink(claim,item,item.link_origin)});return window.close();}
    if(typeof claim.code!=='string')throw new UserMessage('This message has no code.');
    if(action==='copy'){await navigator.clipboard.writeText(claim.code);say('Copied.');return;}
    const [result]=await chrome.scripting.executeScript({target:{tabId:target.tabId},func:fillLoginCode,args:[claim.code,target.origin]});
    if(!result?.result?.ok)throw new UserMessage(result?.result?.reason||'Could not find the code box. Use Copy.');
    window.close();
  } catch(error){fail(error,'That did not work. Try again.');}
  finally{busy=false;render();}
}

async function render() {
  $('setup').hidden=!!connection;$('home').hidden=!connection;
  const {inbox,automaticFillStatus}=await chrome.storage.session.get(['inbox','automaticFillStatus']);
  const settings=await store.get(['autoFillSites','autoFillEverywhere','paymentAutomation','autoSubmitLogin','fillSound','savings']);
  const chip=$('state');
  const problem=inbox?.status==='reauth'?'Key refused':inbox?.status==='error'?'Bridge offline':null;
  chip.textContent=!connection?'Not connected':problem||'Connected';chip.className='state '+(!connection||problem?'bad':'on');
  if(!connection)return;

  const savings=settings.savings||{fills:0,seconds:0};
  $('saved-total').textContent=savings.fills?formatSaved(savings.seconds):'0s';
  $('saved-note').textContent=savings.fills?savings.fills+' code'+(savings.fills===1?'':'s')+' filled for you · ~'+SECONDS_SAVED_PER_CODE+'s each':'Each code it fills for you adds ~'+SECONDS_SAVED_PER_CODE+'s here.';

  const rule=target?automaticRule(target.origin,settings):null;
  $('site-dot').className='dot'+(rule?' on':'');
  $('site').textContent=!target?'Open a website to fill codes on it':host(target.origin)+(rule?' · auto-fill on':' · auto-fill off')+
    (automaticFillStatus?.origin===target.origin&&automaticFillStatus.status==='filled'?' · last filled '+ago(automaticFillStatus.at):'');

  $('everywhere').checked=!!settings.autoFillEverywhere;
  $('auto-submit').checked=settings.autoSubmitLogin!==false;
  $('sound').checked=settings.fillSound!==false;
  $('alerts').checked=await chrome.permissions.contains({permissions:['notifications']});
  if(document.activeElement!==$('payment-mode'))$('payment-mode').value=settings.paymentAutomation||'';

  // Already trimmed by the background; mapping again would drop the payment label.
  const items=(inbox?.items||[]).filter(item=>Date.parse(item.expires_at)>Date.now());
  $('results').replaceChildren();$('empty').hidden=items.length>0;
  for(const item of items){
    const row=element('div','','code'),text=element('div','');
    text.append(element('b',item.service_hint||item.sender||(item.channel==='sms'?'SMS code':'Email code')),
      element('span',(item.secret_type==='link'?'Sign-in link':item.purpose==='payment'?'Payment code':item.channel==='sms'?'SMS':item.account||'Email')+' · '+ago(item.received_at)+(item.status==='claimed_by_you'?' · used':''),'fine'));
    row.append(text);
    const add=(label,action,ghost)=>{const b=element('button',label,ghost?'ghost':'');b.disabled=busy;b.onclick=()=>useItem(item,action);row.append(b);};
    if(item.status==='needs_review')text.append(element('span','No clear code. Check the message.','fine warn'));
    else if(isAmbiguous(item,items))text.append(element('span','Two codes match. Ask for a new one.','fine warn'));
    else if(item.secret_type==='link'){if(item.link_origin)add('Open','open');}
    else{if(target&&item.status==='available')add('Fill','fill');add('Copy','copy',true);}
    $('results').append(row);
  }
}

async function refresh(){if(!connection)return;try{await chrome.runtime.sendMessage({type:'refresh-inbox'});}catch{}await render();}

$('connect-form').onsubmit=async event=>{
  event.preventDefault();
  try{
    const origin=bridgeOrigin($('bridge').value.trim()),token=$('token').value.trim();
    if(token.length<32)throw new UserMessage('The browser key needs at least 32 characters.');
    if(!await chrome.permissions.request({origins:[origin+'/*']}))throw new UserMessage('Chrome did not allow access to the bridge.');
    connection={origin,token};
    try{await request('/v1/recent',{max_age_seconds:1,service:'bridge-connection-check'});}catch(error){connection=null;throw error;}
    await store.set({connection});$('token').value='';say('Connected.');await refresh();
  }catch(error){fail(error,'Could not connect. Check the address and key.');}
};
$('everywhere').onchange=async event=>{
  const on=event.target.checked;
  try{
    if(on&&!await chrome.permissions.request({origins:['https://*/*']}))throw new UserMessage('Chrome did not allow website access.');
    await store.set({autoFillEverywhere:on});
    if(on&&target)await chrome.scripting.executeScript({target:{tabId:target.tabId},files:['automatic-page.js']}).catch(()=>{});
  }catch(error){fail(error,'Could not change this.');}
  render();
};
$('auto-submit').onchange=async event=>{await store.set({autoSubmitLogin:event.target.checked});render();};
$('sound').onchange=async event=>{await store.set({fillSound:event.target.checked});render();};
$('alerts').onchange=async event=>{
  try{event.target.checked?await chrome.permissions.request({permissions:['notifications']}):await chrome.permissions.remove({permissions:['notifications']});}catch{}
  render();
};
$('payment-mode').onchange=async event=>{await store.set({paymentAutomation:event.target.value||null});say('Saved.');};
$('enable-auto').onclick=async()=>{try{
  if(!target)throw new UserMessage('Open the website first.');
  const service=$('auto-service').value.trim(),channel=$('auto-channel').value,account=$('auto-account').value.trim().toLowerCase();
  if(!service||channel==='email'&&!account)throw new UserMessage('Add the name, and the email for email codes.');
  if(!await chrome.permissions.request({origins:[target.origin+'/*']}))throw new UserMessage('Chrome did not allow access to this site.');
  const {autoFillSites={}}=await store.get('autoFillSites');autoFillSites[target.origin]={service,channel,account:channel==='email'?account:null};
  await store.set({autoFillSites});
  await chrome.scripting.executeScript({target:{tabId:target.tabId},files:['automatic-page.js']});
  say('Saved for '+host(target.origin)+'.');render();
}catch(error){fail(error,'Could not save this site.');}};
$('disable-auto').onclick=async()=>{if(!target)return;const {autoFillSites={}}=await store.get('autoFillSites');autoFillSites[target.origin]=false;await store.set({autoFillSites});say('Off for '+host(target.origin)+'.');render();};
$('disconnect').onclick=async()=>{
  const origin=connection?.origin,{autoFillSites={}}=await store.get('autoFillSites');connection=null;
  await store.remove(['connection','arrivalState','autoFillSites','autoFillEverywhere','paymentAutomation','autoSubmitLogin','fillSound']);
  const origins=[...new Set([...Object.keys(autoFillSites),...(origin?[origin]:[]),'https://*'])].map(value=>value+'/*');
  await chrome.permissions.remove({origins});say('Disconnected.');render();
};

// The popup always acts on the tab it was opened from.
try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});target={tabId:tab.id,origin:bridgeOrigin(new URL(tab.url).origin)};}catch{}
connection=(await store.get('connection')).connection||null;
await refresh();
chrome.storage.onChanged.addListener(()=>render());
setInterval(render,5000);
