(() => {
  if(window.__otpBridgeAutomatic)return;
  window.__otpBridgeAutomatic=true;
  let requestAt=Date.now();
  // Keep only the time of the user's page interaction; do not read phone numbers or credentials.
  document.addEventListener('click',event=>{if(event.isTrusted)requestAt=Date.now();},true);
  document.addEventListener('keydown',event=>{if(event.isTrusted&&event.key==='Enter')requestAt=Date.now();},true);
  const check=()=>{if(document.visibilityState==='visible')chrome.runtime.sendMessage({type:'automatic-fill',requestAt}).catch(()=>{});};
  setInterval(check,3000);
})();
