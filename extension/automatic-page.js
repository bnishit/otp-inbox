(() => {
  if(window.__otpBridgeAutomatic)return;
  window.__otpBridgeAutomatic=true;
  // Start the clock when this page (or the bank's card-check frame) began loading: its code is sent while it loads.
  let requestAt=Math.floor(globalThis.performance?.timeOrigin)||Date.now();
  // Focusing the code field is not a new request: its code may already have arrived.
  const codeField=event=>event.target.closest('input')?.matches('[autocomplete="one-time-code"],[name*="otp" i],[id*="otp" i],[id*="code" i],[aria-label*="otp" i],[maxlength="1"]');
  document.addEventListener('click',event=>{if(event.isTrusted&&!codeField(event))requestAt=Date.now();},true);
  document.addEventListener('keydown',event=>{if(event.isTrusted&&event.key==='Enter'&&!codeField(event))requestAt=Date.now();},true);
  // Cheap check every second; the extension only does real work on visible pages with a text box.
  const check=()=>{if(document.visibilityState==='visible'&&document.querySelector('input'))chrome.runtime.sendMessage({type:'automatic-fill',requestAt}).catch(()=>{});};
  setInterval(check,1000);check();
})();
