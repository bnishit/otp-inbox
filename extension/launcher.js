import {bridgeOrigin} from './core.js';
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
let origin=null;
try{const url=new URL(tab.url);origin=bridgeOrigin(url.origin);}catch{}
const button=document.getElementById('open');
if(origin){document.getElementById('page').textContent=new URL(origin).hostname;button.disabled=false;}
button.onclick=()=>{
  if(!origin||!tab.id)return;
  // This second, explicit gesture opens the persistent panel on the selected login tab.
  const opened=chrome.sidePanel.open({windowId:tab.windowId});
  const saved=chrome.storage.session.set({target:{tabId:tab.id,origin,startedAt:new Date().toISOString()}});
  Promise.all([opened,saved]).then(()=>window.close()).catch(()=>{document.getElementById('note').textContent='Could not open the helper. Close this popup and try again.';});
};
