import {createOtpResolver} from '../otp-ai';
import original from './sms-fixtures.json';
import common from './common-formats.json';
import {createHash} from 'node:crypto';

let fixtures=[...original.cases.map(c=>({id:c.id,channel:'sms',text:c.text,expected:c.expected.code})),...common.cases];
if(process.argv.includes('--holdout'))fixtures=fixtures.map(f=>{
 const next=f.expected?.replace(/[0-9a-z]/gi,c=>/\d/.test(c)?String((Number(c)+3)%10):String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='w'?3:-23)));
 return {...f,id:'holdout-'+f.id,expected:next??null,text:(f.expected?f.text.split(f.expected).join(next!):'Notification:\n'+f.text)+'\nSupport note: do not forward this message.'};
});
const outIndex=process.argv.indexOf('--out'),out=outIndex>=0?process.argv[outIndex+1]:'.local/format-evaluation.json';
const key=Bun.env.OPENAI_API_KEY||'';
if(!key)throw Error('API key missing; no fixture data printed');
const resolver=createOtpResolver({key}),results:any[]=[];
const start=Date.now();
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{
 while(cursor<fixtures.length){
  const f=fixtures[cursor++],at=Date.now(),result=await resolver.resolve(f.text);
  const unavailable=['ai_unavailable','ai_credits_exhausted','ai_limited'].includes(result.reason||'');
  results.push({id:f.id,channel:f.channel,expected:f.expected,selected:result.code,reason:result.reason,passed:!unavailable&&result.code===f.expected,unavailable,ms:Date.now()-at});
 }
}));
const report={scope:'Actual Decisions API; synthetic fixtures only. Not live-inbox accuracy.',evaluationStatus:results.some(r=>r.unavailable)?'blocked':'complete',fixtureHash:createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,total:results.length,passed:results.filter(r=>r.passed).length,falsePositives:results.filter(r=>r.expected===null&&r.selected!==null).length,wrongCodes:results.filter(r=>r.expected!==null&&r.selected!==null&&r.selected!==r.expected).length,results:results.sort((a,b)=>a.id.localeCompare(b.id)),diagnostics:resolver.snapshot()};
await Bun.write(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.evaluationStatus,total:report.total,passed:report.evaluationStatus==='complete'?report.passed:null,falsePositives:report.evaluationStatus==='complete'?report.falsePositives:null,wrongCodes:report.evaluationStatus==='complete'?report.wrongCodes:null,failureReasons:[...new Set(results.filter(r=>!r.passed).map(r=>r.reason))],elapsedMs:report.elapsedMs}));
if(report.passed!==report.total)process.exitCode=1;
