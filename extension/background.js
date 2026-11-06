import {automaticFill,registerAutomaticSites} from './auto-fill.js';
import {bridgeOrigin,connectionStore} from './core.js';
import {inboxItems,arrivals} from './inbox.js';
const alarm='otp-inbox-refresh';
let running=null;
async function updateInbox() {
  if(running)return running;
  running=(async()=>{
    const store=await connectionStore();
    const {connection,arrivalState}=await store.get(['connection','arrivalState']);
    if(!connection){
      await chrome.alarms.clear(alarm);
      await chrome.storage.session.set({inbox:{items:[],status:'disconnected'}});
      await chrome.action.setBadgeText({text:''});return;
    }
    try {
      const origin=bridgeOrigin(connection.origin);
      const response=await fetch(origin+'/v1/recent',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+connection.token},body:JSON.stringify({max_age_seconds:600,include_claimed:true}),signal:AbortSignal.timeout(30000),credentials:'omit',redirect:'error',cache:'no-store'});
      if(!response.ok)throw Error(response.status===401?'reauth':'unavailable');
      const result=await response.json(),items=inboxItems(result.items),state=arrivals(items,arrivalState);
      const current=await (await connectionStore()).get('connection');
      if(current.connection?.token!==connection.token||current.connection?.origin!==connection.origin)return;
      await store.set({arrivalState:state});
      await chrome.storage.session.set({inbox:{items,sourceIssues:(result.sources||[]).filter(source=>source.status!=='ok').map(source=>({id:source.id,status:source.status})),status:'ok',updatedAt:new Date().toISOString()}});
      const count=items.filter(item=>item.status==='available').length;
      await chrome.action.setBadgeText({text:count?String(count):''});
      await chrome.action.setBadgeBackgroundColor({color:'#395b23'});
      if(state.notify && await chrome.permissions.contains({permissions:['notifications']})) {
        await chrome.notifications.create('otp-login-ready',{type:'basic',iconUrl:'icon.png',title:'A login item arrived',message:'Open OTP Bridge to copy a code or open a sign-in link.'}).catch(()=>{});
      }
    } catch(error) {
      const current=await (await connectionStore()).get('connection');
      if(current.connection?.token!==connection.token||current.connection?.origin!==connection.origin)return;
      await chrome.storage.session.set({inbox:{items:[],status:error.message==='reauth'?'reauth':'error',updatedAt:new Date().toISOString()}});
      await chrome.action.setBadgeText({text:'!'});
    }
  })().finally(()=>running=null);
  return running;
}
async function startInbox() {
  const {connection}=await (await connectionStore()).get('connection');
  if(!connection){await chrome.alarms.clear(alarm);await chrome.storage.session.set({inbox:{items:[],status:'disconnected'}});await chrome.action.setBadgeText({text:''});return;}
  await chrome.alarms.create(alarm,{periodInMinutes:0.5});
  if(running)await running;
  return updateInbox();
}
chrome.runtime.onInstalled.addListener(()=>{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false});startInbox();registerAutomaticSites().catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{startInbox();registerAutomaticSites().catch(()=>{});});
chrome.alarms.onAlarm.addListener(event=>{if(event.name===alarm)updateInbox();});
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if(area==='local'&&(changes.autoFillSites||changes.autoFillEverywhere||changes.connection))registerAutomaticSites().catch(()=>{});
  if(area!=='local'||!changes.connection)return;
  await (await connectionStore()).remove('arrivalState');
  await startInbox();
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='automatic-fill'){automaticFill(message,sender).then(()=>respond({ok:true})).catch(()=>respond({ok:false}));return true;}
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html')) || message?.type!=='refresh-inbox')return;
  updateInbox().then(()=>respond({ok:true})).catch(()=>respond({ok:false}));return true;
});
let notificationClickRegistered=false;
function registerNotificationClick() {
  if(notificationClickRegistered || !chrome.notifications?.onClicked)return;
  chrome.notifications.onClicked.addListener(async id=>{
    if(id!=='otp-login-ready')return;
    try{const window=await chrome.windows.getCurrent();await chrome.sidePanel.open({windowId:window.id});}
    catch{await chrome.windows.create({url:chrome.runtime.getURL('panel.html'),type:'popup',width:420,height:760});}
    chrome.notifications.clear(id);
  });
  notificationClickRegistered=true;
}
registerNotificationClick();
chrome.permissions.onAdded.addListener(registerNotificationClick);
