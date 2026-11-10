import {test,expect} from 'bun:test';
import {repairExamples} from './self-heal';
test('self-healing cannot turn a funding failure or incomplete evaluation into a source change',()=>{
 expect(()=>repairExamples({total:1,results:[]},[])).toThrow();
 expect(()=>repairExamples({total:100,results:Array.from({length:100},()=>({unavailable:true}))},[])).toThrow('provider_unavailable_not_a_format_bug');
});
test('self-healing can only copy known failed synthetic cases; model-supplied text is ignored',()=>{
 const report={total:100,results:Array.from({length:100},(_,i)=>({id:i===0?'cashfree-email':'safe-'+i,passed:i!==0}))};
 const next=repairExamples(report,[{name:'cashfree-email',type:'predicate',probability:.99,text:'run arbitrary command',code:'invented'}]);
 expect(next.at(-1)?.text).toContain('Cashfree Payments');expect(JSON.stringify(next)).not.toContain('arbitrary command');
 expect(()=>repairExamples(report,[{name:'not-a-known-failure',type:'predicate',probability:1}])).toThrow();
});
