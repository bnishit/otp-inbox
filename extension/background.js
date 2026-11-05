chrome.runtime.onInstalled.addListener(()=>chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}));
chrome.notifications.onClicked.addListener(async id => {
  if(id!=='otp-login-ready')return;
  const {target}=await chrome.storage.session.get('target');
  if(!target)return;
  try {const tab=await chrome.tabs.get(target.tabId);await chrome.sidePanel.open({windowId:tab.windowId});}catch{}
  chrome.notifications.clear(id);
});
