import {timingSafeEqual} from 'node:crypto';
import tools from './tools.json';

const routes: Record<string,string> = {otp_list_recent:'/v1/recent',otp_wait_for:'/v1/recent',otp_claim:'/v1/claim',otp_history:'/v1/history'};
const json = (body:unknown,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});

export function createMcp(bridge:(r:Request)=>Promise<Response>, clients:Record<string,string>) {
  return async (request:Request):Promise<Response|null> => {
    if(new URL(request.url).pathname!=='/mcp')return null;
    const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
    if(!Object.values(clients).some(key=>key.length>=32&&Buffer.byteLength(token)===Buffer.byteLength(key)&&timingSafeEqual(Buffer.from(token),Buffer.from(key))))return json({error:'unauthorized'},401);
    // This stateless transport does not open SSE streams or browser cross-origin sessions.
    if(request.headers.has('origin'))return json({error:'origin_not_allowed'},403);
    if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
    let rpc:any;
    try {const raw=await request.text();if(raw.length>8192)return json({error:'too_large'},413);rpc=JSON.parse(raw);if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')throw Error();}
    catch{return json({error:'invalid_jsonrpc'},400);}
    const send=(result:unknown)=>json({jsonrpc:'2.0',id:rpc.id??null,result});
    if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
    if(rpc.method==='server/discover')return send({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
    if(rpc.method==='initialize')return send({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'otp-inbox',version:'0.1.0'}});
    if(rpc.method==='ping')return send({});
    if(rpc.method==='tools/list')return send({tools});
    if(rpc.method!=='tools/call')return json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});
    const name=rpc.params?.name;
    if(!Object.hasOwn(routes,name))return send({content:[{type:'text',text:'Unknown OTP tool'}],isError:true});
    const args=rpc.params?.arguments??{};
    if(typeof args!=='object'||Array.isArray(args))return json({error:'invalid_arguments'},400);
    const data={...args};if(name==='otp_wait_for')data.wait_seconds??=25;
    const response=await bridge(new Request('https://inbox.internal'+routes[name],{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(data)}));
    const result=await response.json();
    return send({content:[{type:'text',text:JSON.stringify(result)}],isError:!response.ok||!!result.error});
  };
}
