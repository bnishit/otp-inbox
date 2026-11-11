import {createHash} from 'node:crypto';
import {createAiProvider} from './ai-provider';
import {model,smsRequest,parseSmsResponse} from './sms-ai';

type Options={enabled:boolean;key:string;openrouterKey?:string;maxPerDay?:number;network?:typeof fetch;now?:()=>number};
export type SmsShadow=ReturnType<typeof createSmsShadow>;
export function createSmsShadow({enabled,key,openrouterKey,maxPerDay=100,network=fetch,now=Date.now}:Options) {
 const active=enabled&&key.length>=20,limit=Math.min(1000,Math.max(1,Math.floor(maxPerDay)||100));
 let day=new Date(now()).toISOString().slice(0,10),inFlight=0;
 let counts:Record<string,number>={},categories:Record<string,number>={},inputTokens=0,outputTokens=0,latencyMs=0;
 const seen=new Map<string,number>();
 const count=(name:string)=>{counts[name]=(counts[name]||0)+1;};
 const provider=createAiProvider({key,openrouterKey,network,now,count});
 function observe(message:string,parserCode:string|null) {
  if(!active)return;
  const date=new Date(now()).toISOString().slice(0,10);
  // Do not reset a window while an old request could still update its counters.
  if(date!==day){if(inFlight){count('skipped_busy');return;}day=date;counts={};categories={};inputTokens=outputTokens=latencyMs=0;seen.clear();}
  if(message.length>8192){count('skipped_size');return;}
  for(const [id,expiry] of seen)if(expiry<=now())seen.delete(id);
  const id=createHash('sha256').update(message).digest('hex');
  if(seen.has(id)){count('duplicate');return;}
  if((counts.requested||0)>=limit){count('skipped_limit');return;}
  if(inFlight>=2){count('skipped_busy');return;}
  seen.set(id,now()+600000);inFlight++;count('requested');
  void (async()=>{
   const start=now();
   try {
    const data:any=await provider.request('responses',smsRequest(message)),parsed=parseSmsResponse(data,message);
    inputTokens+=Math.max(0,Number(data.usage?.input_tokens)||0);outputTokens+=Math.max(0,Number(data.usage?.output_tokens)||0);
    if(parsed.blocked){count('invalid_code');return;}
    const aiCode=parsed.prediction.code;
    categories[parsed.prediction.category]=(categories[parsed.prediction.category]||0)+1;
    count(aiCode===parserCode?(aiCode===null?'both_none':'same_code'):aiCode===null?'parser_only_code':parserCode===null?'ai_only_code':'different_codes');
   }catch {count('failed');}
   finally{latencyMs+=Math.max(0,now()-start);inFlight--;count('completed');}
  })();
 }
 function snapshot(){return {enabled:active,mode:'observe_only',model,window:day,max_per_day:limit,in_flight:inFlight,...provider.snapshot(),counts:{...counts},categories:{...categories},tokens:{input:inputTokens,output:outputTokens},total_latency_ms:latencyMs,retention:'aggregate counters in memory; reset on restart or next UTC day'};}
 return {observe,snapshot};
}
