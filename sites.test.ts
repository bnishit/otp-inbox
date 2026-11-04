import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
test('Sites proxy refuses forged or absent owner access and publishes only three tools',async()=>{
  const source='const tools='+readFileSync('tools.json','utf8')+';\n'+readFileSync('adapters/sites/worker.js','utf8');
  const worker=new Function(source.replace('export default','return'))();
  const request=(method:string,extra={})=>new Request('https://site.example.test/mcp',{method:'POST',headers:extra,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{name:'otp_list_recent'}})});
  expect((await worker.fetch(request('tools/call'),{OTP_OWNER_EMAIL:'owner@example.test'})).status).toBe(401);
  expect((await worker.fetch(request('tools/call',{'oai-authenticated-user-id':'x','oai-authenticated-user-email':'other@example.test'}),{OTP_OWNER_EMAIL:'owner@example.test'})).status).toBe(401);
  const listed=await (await worker.fetch(request('tools/list'),{})).json();expect(listed.result.tools).toHaveLength(3);
});
