import {test,expect} from 'bun:test';
import {createBridge} from './server';
import {createMcp} from './mcp';
const phone='p'.repeat(40),codex='c'.repeat(40),claude='d'.repeat(40);
test('remote MCP authenticates discovery and reserves a claim to the same client',async()=>{
  const bridge=createBridge(phone,{codex,claude});const mcp=createMcp(bridge,{codex,claude});
  const rpc=async(method:string,params:any={},token=codex)=>{const r=(await mcp(new Request('https://inbox.example.test/mcp',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})))!;return {status:r.status,body:await r.json()};};
  expect((await rpc('tools/list',{},phone)).status).toBe(401);
  expect((await rpc('tools/list')).body.result.tools).toHaveLength(3);
  expect((await rpc('initialize')).body.result.capabilities.tools).toEqual({});
  const receipt=await bridge(new Request('https://inbox.example.test/v1/sms',{method:'POST',headers:{authorization:'Bearer '+phone},body:JSON.stringify({message:'Contoso OTP: 246810',received_at:new Date().toISOString()})}));const id=(await receipt.json()).id;
  const recent=(await rpc('tools/call',{name:'otp_list_recent',arguments:{service:'Contoso'}})).body;
  expect(JSON.stringify(recent)).not.toContain('246810');
  const claim=(await rpc('tools/call',{name:'otp_claim',arguments:{id,service:'Contoso'}})).body;
  expect(JSON.parse(claim.result.content[0].text).code).toBe('246810');
  expect((await rpc('tools/call',{name:'otp_claim',arguments:{id}},claude)).body.result.isError).toBe(true);
});
test('MCP rejects browser origins, unknown tools and malformed payloads',async()=>{
  const mcp=createMcp(createBridge(phone,{codex}),{codex});
  const req=(body:string,extra={})=>new Request('https://inbox.example.test/mcp',{method:'POST',headers:{authorization:'Bearer '+codex,...extra},body});
  expect((await mcp(req('{}',{origin:'https://other.test'})))!.status).toBe(403);
  expect((await mcp(req('[]')))!.status).toBe(400);
  const r=await (await mcp(req(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'send_payment'}}))))!.json();expect(r.result.isError).toBe(true);
});
