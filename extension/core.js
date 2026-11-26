export class UserMessage extends Error {}
export async function connectionStore() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  return chrome.storage.local;
}
export function bridgeOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new UserMessage('Use an HTTPS bridge address, without a path.');
  return url.origin;
}

export function safeLink(claim, item, targetOrigin) {
  if (claim.secret_type !== 'link' || typeof claim.link !== 'string') throw new UserMessage('This is not a sign-in link.');
  const url=new URL(claim.link);
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== item.link_origin || url.origin !== targetOrigin) throw new UserMessage('The link belongs to another website. Open that login page and start again.');
  return claim.link;
}

// This exact self-contained function runs only inside the explicitly selected tab.
export function fillLoginCode(code, expectedOrigin, automatic = false) {
  if (location.origin !== expectedOrigin) return {ok:false,reason:'The page changed. Start this login again.'};
  if (code !== null && (typeof code !== 'string' || !/^[A-Z0-9-]{4,19}$/i.test(code))) return {ok:false,reason:'Unsupported code format. Use Copy code.'};
  const paymentMode=automatic?.payments;
  // Card checks (3-D Secure) say "You are paying WISPR the amount of ...", so "paying" counts too.
  const paymentWords=/payment|paying|transaction|merchant|purchase|withdraw|bank transfer/i;
  let context=document.body.innerText;
  let payment=paymentWords.test(context);
  const visible = input => !input.disabled && !input.readOnly && ['text','tel','number',...(paymentMode&&payment?['password']:[])].includes(input.type) && input.getClientRects().length && getComputedStyle(input).visibility !== 'hidden';
  // Card issuers call the code a "One-Time Password", and the box just says "Please enter password".
  const marked = input => input.autocomplete === 'one-time-code' || new RegExp('otp|one.?time|verification|security.?code|passcode|\\bcode\\b'+(paymentMode&&payment&&/one.?time password/i.test(context)?'|password':''),'i').test([input.name,input.id,input.placeholder,input.getAttribute('aria-label')].join(' '));
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const active = document.activeElement;
  const singles = inputs.filter(i => i.maxLength !== 1 && marked(i));
  let targets=[];
  if (inputs.includes(active) && marked(active) && active.maxLength !== 1) targets=[active];
  else if (singles.length === 1) targets=singles;
  else if (!singles.length) {
    const cells = inputs.filter(i => i.maxLength === 1 && (marked(i) || i.inputMode === 'numeric'));
    if ((code === null ? cells.length >= 4 && cells.length <= 10 : cells.length === code.length) && cells.every(i => i.form === cells[0].form) && cells.some(marked)) targets=cells;
  }
  if (!targets.length) return {ok:false,reason:'Choose one clear code field on the page, or use Copy code.'};
  const challenge=/log[ -]?in|sign[ -]?in|otp verification|authenticate|(?:otp|\bcode\b)[\s\S]{0,80}\bsent\b|\benter\b[^\n]{0,80}\b(?:otp|(?:\d[ -]?digit |verification |security )?code)\b/i;
  const loginPage=/log[ -]?in|sign[ -]?in/i.test(document.title)||/(?:^|\/)(?:auth|login|signin)(?:\/|$)/i.test(location.pathname);
  const formContext=(loginPage?targets[0].closest('[role="dialog"],dialog'):null)?.innerText||targets[0].form?.innerText||'';
  if(challenge.test(formContext)||paymentWords.test(formContext))context=formContext;
  payment=paymentWords.test(context);
  if(automatic&&automatic.expectedPayment!==undefined&&automatic.expectedPayment!==payment)return {ok:false,reason:'The verification context changed.'};
  if (code === null || automatic) {
    if (/reset.*password|password.*reset|recover.*account|withdraw|bank transfer/i.test(context) || (payment ? !paymentMode : !challenge.test(context))) return {ok:false,reason:'Use manual fill for this verification.'};
    if(targets.some(input=>input.value))return {ok:false,reason:'The code field already has a value.'};
    if(code === null){
      // Which code does this box want? Read the words right around it. Pages that verify both email and phone say so here.
      let near='';for(let node=targets[0].parentElement,depth=0;node&&depth<5&&near.length<15;node=node.parentElement,depth++)near=node.innerText||'';
      const email=/e-?mail|inbox/i.test(near),phone=/phone|mobile|\bsms\b|\+\d{2}|number/i.test(near);
      return {ok:true,fields:targets.length,payment,channel:email&&!phone?'email':phone&&!email?'sms':null};
    }
  }
  if (targets.some(input => input.type === 'number' && !/^\d+$/.test(code))) return {ok:false,reason:'This field expects digits. Use Copy code.'};
  if (targets.length === 1 && targets[0].maxLength > 0 && targets[0].maxLength < code.length) return {ok:false,reason:'The code does not fit this field. Use Copy code.'};
  const usable=button=>!button.disabled&&button.getClientRects().length&&getComputedStyle(button).visibility!=='hidden';
  const label=button=>(button.innerText||button.value||button.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ');
  let submitButton;
  if(automatic&&payment&&paymentMode==='submit'){
    // Exactly one clear go-ahead button in the code's form (or the bank's own page, which often has no form).
    // It may still be greyed out: most banks turn Continue on only once the code is typed.
    const form=targets[0].form,scope=form||targets[0].closest('dialog,[role="dialog"],[aria-modal="true"]')||document;
    if(form&&!targets.every(input=>input.form===form))return {ok:false,reason:'Payment form is unclear.'};
    const shown=button=>button.getClientRects().length&&getComputedStyle(button).visibility!=='hidden';
    const buttons=[...scope.querySelectorAll('button,input[type="submit"]')].filter(button=>shown(button)&&/^(submit|verify|confirm|continue|proceed|pay(?: now)?)$/i.test(label(button)));
    if(buttons.length!==1)return {ok:false,reason:'Payment confirmation button is unclear.'};
    submitButton=buttons[0];
  }
  const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  targets.forEach((input,index) => {
    setValue.call(input,targets.length === 1 ? code : code[index]);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  targets.at(-1).focus();
  if(payment&&submitButton){
    const page=location.href,started=Date.now();
    const press=()=>{
      if(location.href!==page||!submitButton.isConnected||!targets.every(input=>input.isConnected&&input.value))return;
      if(usable(submitButton))return submitButton.click();
      if(Date.now()-started<2000)setTimeout(press,150);
    };
    if(usable(submitButton))submitButton.click();else setTimeout(press,150);
  }
  let pressing=null;
  if(automatic?.submit&&!payment){
    // Works the same on any site. Read the page top to bottom, like a person:
    // press the first go-ahead button that comes AFTER the code box, with no other field in between.
    // A Login button above the box (or behind a popup) is never in reach. Resend, send, close, back and help are skipped.
    // Decide after the code is in, and keep checking briefly: many sites keep Confirm greyed out until then.
    const go=/^(?:submit|verify|confirm|continue|next|proceed|done|authenticate|validate|log ?in|sign ?in)\b/i;
    const avoid=/resend|send|get|request|change|edit|back|cancel|close|help|forgot|google|apple|facebook/i;
    const shown=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
    const findButton=()=>{
      const box=targets[0].closest('dialog,[role="dialog"],[aria-modal="true"]')||document;
      const items=[...box.querySelectorAll('input,textarea,select,button,[role="button"]')];
      for(const el of items.slice(items.indexOf(targets.at(-1))+1)){
        if(!shown(el)||targets.includes(el))continue;
        const isButton=el.matches('button,[role="button"],input[type="submit"],input[type="button"]');
        if(!isButton){if(!['hidden','checkbox','radio'].includes(el.type))return {state:'none'};continue;}
        const text=label(el);
        if(text.length>30||avoid.test(text)||!go.test(text))continue;
        return {state:el.disabled||el.getAttribute('aria-disabled')==='true'?'waiting':'ready',button:el};
      }
      return {state:'none'};
    };
    const first=findButton();
    if(first.button){
      pressing=label(first.button);
      const page=location.href,started=Date.now();
      // Short pause first: sites that submit on the last digit get to go first.
      const attempt=()=>{
        if(location.href!==page||!targets.every(input=>input.isConnected&&input.value))return;
        const now=findButton();
        if(now.state==='ready')return now.button.click();
        if(now.state==='waiting'&&Date.now()-started<2000)setTimeout(attempt,150);
      };
      setTimeout(attempt,600);
    }
  }
  return {ok:true,fields:targets.length,submit:pressing};
}
