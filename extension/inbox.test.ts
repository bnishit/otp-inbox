import {test,expect} from 'bun:test';
import {inboxItems,arrivals,isAmbiguous} from './inbox.js';
const now=Date.now();
const item=(id='one',extra={})=>({id,status:'available',secret_type:'code',channel:'email',account:'owner@example.test',service_hint:'Afterspan',received_at:new Date(now-1000).toISOString(),expires_at:new Date(now+60000).toISOString(),...extra});
test('automatic inbox stores only safe display metadata and removes expired/other-client items',()=>{
 const items=inboxItems([item('one',{code:'privatevalueforsyntheticcheck',link:'https://example.test/#privatevalueforsyntheticcheck',preview:'privatevalueforsyntheticcheck'}),item('old',{expires_at:new Date(now-1).toISOString()}),item('other',{status:'claimed'}),item('bad',{received_at:'invalid'})],now);
 expect(items).toHaveLength(1);expect(JSON.stringify(items)).not.toContain('privatevalueforsyntheticcheck');expect(items[0].account).toBe('owner@example.test');
});
test('first connection is silent; each genuinely new arrival notifies once across worker restarts',()=>{
 const first=arrivals([item()],undefined,now);expect(first.notify).toBe(false);
 const repeated=arrivals([item()],JSON.parse(JSON.stringify(first)),now+1000);expect(repeated.notify).toBe(false);
 const second=arrivals([item(),item('two')],repeated,now+1000);expect(second.notify).toBe(true);
 expect(arrivals([item('two')],second,now+2000).notify).toBe(false);
 expect(arrivals([],second,now+61000).seen).toHaveLength(0);
});
test('codes are not selected by recency; duplicate service/account requires narrowing',()=>{
 const first=item();expect(isAmbiguous(first,[first,item('two')])).toBe(true);
 expect(isAmbiguous(first,[first,item('two',{account:'other@example.test'})])).toBe(false);
 expect(isAmbiguous(first,[first,item('two',{service_hint:'Google'})])).toBe(false);
});

test('payment metadata is labelled without caching the underlying message or code',()=>{
 const result=inboxItems([item('payment',{preview:'OTP to authenticate transaction at merchant',code:'246810'})],now)[0];
 expect(result.purpose).toBe('payment');expect(result.preview).toBeUndefined();expect(result.code).toBeUndefined();
});
