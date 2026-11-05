import {createPublicKey, verify} from 'node:crypto';
import {otpMailText, otpMailExcerpt, otpMailIdentity} from './mail.js';

type Source = {email: string; label: string; token: string; aliases?: string[]};
type Config = {clientId: string; clientSecret: string; topic: string; subscription: string;
  audience: string; serviceAccount: string; refreshTokens: Record<string,string>};
type Fetch = typeof fetch;
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'cache-control':'no-store'}});
const labels = '{otp "one time" "one-time" "verification code" "security code" "login code" "sign-in code" "sign in" "sign-in link" "magic link" "login link" "authentication code" passcode "reset code" 验证码}';

export function googlePushVerifier(audience: string, serviceAccount: string, network: Fetch = fetch, now = Date.now) {
  let keys: any[] = [], loaded = 0;
  return async (authorization: string) => {
    try {
      if (!authorization.startsWith('Bearer ') || authorization.length > 12000) return false;
      const parts = authorization.slice(7).split('.');
      if (parts.length !== 3) return false;
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
          !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) ||
          claims.aud !== audience || claims.email !== serviceAccount || claims.email_verified !== true ||
          !Number.isFinite(claims.exp) || claims.exp <= now()/1000 ||
          !Number.isFinite(claims.iat) || claims.iat > now()/1000+60) return false;
      if (!loaded || now()-loaded > 3600000 || (!keys.some(k=>k.kid===header.kid) && now()-loaded>60000)) {
        const response = await network('https://www.googleapis.com/oauth2/v3/certs', {signal:AbortSignal.timeout(10000)});
        if (!response.ok) return false;
        keys = (await response.json()).keys; loaded = now();
      }
      const key = keys.find(k=>k.kid===header.kid && k.kty==='RSA');
      return !!key && verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]),
        createPublicKey({key,format:'jwk'}), Buffer.from(parts[2],'base64url'));
    } catch { return false; }
  };
}

export function createGmailPush(config: Config, sources: Record<string,Source>, bridge: (req:Request)=>Promise<Response>, network: Fetch=fetch, now=Date.now) {
  const verifyPush = googlePushVerifier(config.audience,config.serviceAccount,network,now);
  const tokens = new Map<string,{value:string; expires:number}>();
  const seen = new Map<string,number>();
  const queues = new Map<string,Promise<void>>();
  const watches = new Map<string,{expires:number; renewed:number; lastPush:string|null; status:string}>();
  const authorized = new Set<string>();
  const active = Object.keys(config.refreshTokens).filter(id=>sources[id]);
  const post = async (id:string,path:string,data:unknown) => {
    const response = await bridge(new Request('https://otp.internal'+path,{method:'POST',headers:{authorization:'Bearer '+sources[id].token},body:JSON.stringify(data)}));
    const receipt = await response.json();
    if (!response.ok) throw Error('Inbox delivery failed');
    return receipt;
  };
  const token = async (id:string) => {
    const cached = tokens.get(id);
    if (cached && cached.expires>now()+60000) return cached.value;
    const response = await network('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshTokens[id],grant_type:'refresh_token'})});
    const data = await response.json();
    if (!response.ok || typeof data.access_token!=='string') throw Error('Gmail authorization failed');
    tokens.set(id,{value:data.access_token,expires:now()+Number(data.expires_in||3600)*1000});
    return data.access_token;
  };
  const gmail = async (id:string,path:string,body?:unknown) => {
    const response = await network('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method:body?'POST':'GET',
      signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+await token(id),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    if (!response.ok) {if(response.status===401)tokens.delete(id);throw Error('Gmail request failed');}
    return response.json();
  };
  const heartbeat = (id:string,status:string) => post(id,'/v1/source-heartbeat',{status,checked_at:new Date(now()).toISOString(),
    push_status:watches.get(id)?.status||'awaiting_watch',watch_expires_at:watches.get(id)?.expires?new Date(watches.get(id)!.expires).toISOString():null,last_push_at:watches.get(id)?.lastPush||null});
  const scan = async (id:string) => {
    const cutoff=now()-600000;
    for(const [key,expiry]of seen)if(expiry<=now())seen.delete(key);
    const q=encodeURIComponent('after:'+Math.floor(cutoff/1000)+' -in:spam -in:trash '+labels);
    const found=await gmail(id,'messages?maxResults=50&q='+q);
    for(const item of found.messages||[]) {
      const key=id+':'+item.id;
      if(seen.has(key))continue;
      const mail=await gmail(id,'messages/'+encodeURIComponent(item.id)+'?format=full');
      const tags=mail.labelIds||[],received=Number(mail.internalDate);
      if(tags.includes('SPAM')||tags.includes('TRASH')||(tags.includes('SENT')&&!tags.includes('INBOX'))||!Number.isFinite(received)||received<=cutoff||received>now()+15000)continue;
      const header=(name:string)=>(mail.payload?.headers||[]).find((h:any)=>h.name.toLowerCase()===name)?.value||'';
      const message=otpMailExcerpt(header('subject'),otpMailText(mail.payload,data=>Buffer.from(data,'base64url').toString('utf8')));
      if(!message){seen.set(key,now()+600000);continue;}
      const receipt=await post(id,'/v1/email',{...otpMailIdentity(mail.payload?.headers || []),capture_method:'gmail_push',message,message_id:item.id,sender:header('from'),received_at:new Date(received).toISOString()});
      if(receipt.accepted||['duplicate','expired','not_recognized_as_otp','recipient_not_approved','ambiguous_recipient','stale_or_missing_timestamp'].includes(receipt.reason))seen.set(key,now()+600000);
      else throw Error('Inbox did not accept delivery');
    }
    await heartbeat(id,'ok');
  };
  const enqueue = (id:string,action:()=>Promise<void>) => {
    const task=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(action);
    queues.set(id,task);
    return task.finally(()=>{if(queues.get(id)===task)queues.delete(id);});
  };
  const renew = async (id:string) => {
    try {
      const profile=await gmail(id,'profile');
      if(profile.emailAddress?.toLowerCase()!==sources[id].email.toLowerCase())throw Error('Wrong mailbox');
      const result=await gmail(id,'watch',{topicName:config.topic,labelIds:['SPAM','TRASH'],labelFilterBehavior:'EXCLUDE'});
      const expires=Number(result.expiration);
      if(!Number.isFinite(expires)||expires<=now())throw Error('Invalid watch expiry');
      authorized.add(id);
      watches.set(id,{expires,renewed:now(),lastPush:watches.get(id)?.lastPush||null,status:'watching'});
      await scan(id);
    } catch {
      authorized.delete(id);
      watches.set(id,{expires:0,renewed:0,lastPush:watches.get(id)?.lastPush||null,status:'error'});
      await heartbeat(id,'error').catch(()=>{});
    }
  };
  return {
    async start() {await Promise.all(active.map(id=>enqueue(id,()=>renew(id))));},
    async renewDue() {await Promise.all(active.filter(id=>(watches.get(id)?.expires||0)<now()+86400000 || (watches.get(id)?.renewed||0)<=now()-86400000).map(id=>enqueue(id,()=>renew(id))));},
    async handle(req:Request):Promise<Response|null> {
      if(new URL(req.url).pathname!=='/v1/gmail/push')return null;
      if(req.method!=='POST')return json({error:'not_found'},404);
      if(!await verifyPush(req.headers.get('authorization')||''))return json({error:'unauthorized'},401);
      try {
        const raw=await req.text();if(raw.length>8192)return json({error:'too_large'},413);
        const envelope=JSON.parse(raw);
        if(envelope.subscription!==config.subscription||typeof envelope.message?.data!=='string')return json({error:'invalid_notification'},400);
        const notice=JSON.parse(Buffer.from(envelope.message.data,'base64url').toString());
        const id=active.find(id=>sources[id].email.toLowerCase()===String(notice.emailAddress).toLowerCase());
        if(!id||!authorized.has(id)||!/^\d+$/.test(String(notice.historyId)))return json({error:'unknown_mailbox'},400);
        const watch=watches.get(id);
        if(watch)watch.lastPush=new Date(now()).toISOString();
        await enqueue(id,()=>scan(id));
        return json({accepted:true});
      } catch {return json({error:'retry_delivery'},503);}
    }
  };
}
