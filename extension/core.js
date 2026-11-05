export class UserMessage extends Error {}
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
export function fillLoginCode(code, expectedOrigin) {
  if (location.origin !== expectedOrigin) return {ok:false,reason:'The page changed. Start this login again.'};
  if (typeof code !== 'string' || !/^[A-Z0-9-]{4,19}$/i.test(code)) return {ok:false,reason:'Unsupported code format. Use Copy code.'};
  const visible = input => !input.disabled && !input.readOnly && ['text','tel','number'].includes(input.type) && input.getClientRects().length && getComputedStyle(input).visibility !== 'hidden';
  const marked = input => input.autocomplete === 'one-time-code' || /otp|one.?time|verification|security.?code|passcode|\bcode\b/i.test([input.name,input.id,input.placeholder,input.getAttribute('aria-label')].join(' '));
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const active = document.activeElement;
  const singles = inputs.filter(i => i.maxLength !== 1 && marked(i));
  let targets=[];
  if (inputs.includes(active) && marked(active) && active.maxLength !== 1) targets=[active];
  else if (singles.length === 1) targets=singles;
  else if (!singles.length) {
    const cells = inputs.filter(i => i.maxLength === 1 && (marked(i) || i.inputMode === 'numeric'));
    if (cells.length === code.length && cells.every(i => i.form === cells[0].form) && cells.some(marked)) targets=cells;
  }
  if (!targets.length) return {ok:false,reason:'Choose one clear code field on the page, or use Copy code.'};
  if (targets.some(input => input.type === 'number' && !/^\d+$/.test(code))) return {ok:false,reason:'This field expects digits. Use Copy code.'};
  if (targets.length === 1 && targets[0].maxLength > 0 && targets[0].maxLength < code.length) return {ok:false,reason:'The code does not fit this field. Use Copy code.'};
  const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  targets.forEach((input,index) => {
    setValue.call(input,targets.length === 1 ? code : code[index]);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  targets.at(-1).focus();
  return {ok:true,fields:targets.length};
}
