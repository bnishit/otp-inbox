// Cache only display metadata; never cache a code or complete sign-in link.
export function inboxItems(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter(item =>
    ['available','needs_review','claimed_by_you'].includes(item.status) &&
    Number.isFinite(Date.parse(item.received_at)) && Date.parse(item.expires_at) > now
  ).slice(0,100).map(item => ({
    id:item.id,secret_type:item.secret_type,channel:item.channel,account:item.account,
    service_hint:item.service_hint,sender:typeof item.sender==='string'?item.sender.slice(0,160):null,
    purpose:/payment|transaction|merchant|purchase|withdraw|bank transfer/i.test(item.preview||'')?'payment':'verification',
    link_origin:item.link_origin,review_reason:item.review_reason,status:item.status,
    received_at:item.received_at,expires_at:item.expires_at
  }));
}
export function arrivals(items, previous, now = Date.now()) {
  const seen=new Map((previous?.seen || []).filter(([,expiry])=>expiry>now));
  const fresh=items.filter(item=>item.status==='available'&&!seen.has(item.id));
  for(const item of items)seen.set(item.id,Date.parse(item.expires_at));
  return {seen:[...seen].slice(-500),notify:previous?.initialized===true&&fresh.length>0,initialized:true};
}
export function isAmbiguous(item, items) {
  return items.filter(other=>['available','claimed_by_you'].includes(other.status) &&
    other.channel===item.channel && other.account===item.account &&
    (other.service_hint || other.sender || '')===(item.service_hint || item.sender || '')
  ).length>1;
}
