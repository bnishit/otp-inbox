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

test('MCP list and wait hide approved link secrets and claim returns typed link',async()=>{
 const key='e'.repeat(40),clock=Date.now();
 const bridge=createBridge(phone,{codex},()=>clock,{personal:{email:'owner@example.test',label:'Personal',token:key}},[{service:'Afterspan',sender:'signin@example.test',origin:'https://afterspan.example.test',pathname:'/app',parameter:'sign-in',location:'fragment',max_age_seconds:600}]);
 const mcp=createMcp(bridge,{codex});
 const call=async(name:string,args:any)=>{const r=(await mcp(new Request('https://test/mcp',{method:'POST',headers:{authorization:'Bearer '+codex},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})))!;return JSON.parse((await r.json()).result.content[0].text);};
 const link='https://afterspan.example.test/app#sign-in=as_login_syntheticletters';
 const receipt=await bridge(new Request('https://test/v1/email',{method:'POST',headers:{authorization:'Bearer '+key},body:JSON.stringify({message:'Sign in to Afterspan with this one-time link:\n'+link,sender:'signin@example.test',authenticated_domain:'example.test',message_id:'mcp-link',received_at:new Date(clock).toISOString()})}));
 const id=(await receipt.json()).id;
 for(const name of ['otp_list_recent','otp_wait_for']) {const found=await call(name,{service:'Afterspan',account:'owner@example.test',wait_seconds:0});expect(found.items[0].secret_type).toBe('link');expect(JSON.stringify(found)).not.toContain('syntheticletters');}
 expect((await call('otp_claim',{id,service:'Afterspan'})).link).toBe(link);
});
