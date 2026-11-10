import {codeDecision,validateExamples} from '../otp-ai';
import {model} from '../sms-ai';
import original from '../benchmarks/sms-fixtures.json';
import common from '../benchmarks/common-formats.json';
import current from '../otp-examples.json';

// Repairs are a bounded selection of public synthetic examples, never executable code.
export function repairExamples(report:any,answers:any[]) {
 if(!report||report.total!==100||!Array.isArray(report.results)||report.results.length!==100)throw Error('incomplete_evaluation');
 if(report.results.some((r:any)=>r.unavailable))throw Error('provider_unavailable_not_a_format_bug');
 const fixtures=[...original.cases.map(c=>({id:c.id,text:c.text,expected:c.expected.code})),...common.cases];
 const failed=new Set(report.results.filter((r:any)=>!r.passed).map((r:any)=>r.id));
 const selected=answers.filter(a=>a?.type==='predicate'&&a.probability>=.9&&failed.has(a.name)).map(a=>fixtures.find(f=>f.id===a.name));
 if(!selected.length||selected.some(f=>!f))throw Error('no_reproducible_repair');
 const examples=[...current];
 for(const f of selected)if(!examples.some(e=>e.text===f!.text))examples.push({text:f!.text,code:f!.expected});
 return validateExamples(examples);
}
if(import.meta.main){
 const file=process.argv[2];if(!file)throw Error('evaluation_report_required');
 const report=await Bun.file(file).json();
 if(report.results?.some((r:any)=>r.unavailable))throw Error('provider_unavailable_not_a_format_bug');
 const failures=report.results.filter((r:any)=>!r.passed);
 if(!failures.length){console.log('No reproducible format failure; no repair.');process.exit(0);}
 const fixtures=[...original.cases.map(c=>({id:c.id,text:c.text,expected:c.expected.code})),...common.cases];
 const evidence=fixtures.filter(f=>failures.some((r:any)=>r.id===f.id));
 const response=await fetch('https://api.openai.com/v1/decisions',{method:'POST',headers:{authorization:'Bearer '+Bun.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model,input:JSON.stringify({syntheticFailures:evidence,existingExamples:current,selectionRules:codeDecision('Synthetic verification code 246810')?.body.questions}),questions:evidence.map(f=>({type:'predicate',name:f.id,instructions:'Would adding this exact synthetic example and its known correct answer teach a genuine code-selection distinction? Do not change the expected answer. Reject an intrinsically ambiguous or unsupported format as a reason to release a code.'}))}),signal:AbortSignal.timeout(10000),redirect:'error',credentials:'omit',cache:'no-store'});
 if(!response.ok)throw Error('repair_provider_unavailable');
 const data:any=await response.json(),next=repairExamples(report,data.answers||[]);
 if(JSON.stringify(next)===JSON.stringify(current))throw Error('no_new_repair');
 await Bun.write('otp-examples.json',JSON.stringify(next,null,2)+'\n');
 console.log('Updated synthetic reference data only. Must pass full tests and live format evaluation before merge.');
}
