import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseOtp} from '../server';
function fixture(email='owner@example.test',mails:any[]=[])  {
  const posts:any[]=[];let triggers=0;
  const context:any={ScriptApp:{getOAuthToken:()=> 'synthetic-oauth',getProjectTriggers:()=>triggers?[{getHandlerFunction:()=> 'pollOtpInbox'}]:[],newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({create:()=>triggers++})})})},LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getUserCache:()=>({get:()=>null,put:()=>{}})},UrlFetchApp:{fetch:(url:any,options:any)=>{if(url.startsWith('https://gmail.googleapis.com/'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.endsWith('/profile')?{emailAddress:email}:url.includes('/messages?')?{messages:mails.map(m=>({id:m.id}))}:mails.find(m=>new URL(url).pathname.endsWith('/'+m.id)))};posts.push({url,...options});return {getResponseCode:()=>200,getContentText:()=>'{"accepted":true}'};}},Utilities:{base64DecodeWebSafe:(data:string)=>{if(data.length%4)throw Error('padding required');return Buffer.from(data,'base64url');},newBlob:(data:any)=>({getDataAsString:()=>data.toString('utf8')})}};
  const source=readFileSync(new URL('./collector.gs',import.meta.url),'utf8').replace('__ENDPOINT_JSON__','"https://inbox.example.test"').replace('__ACCOUNT_JSON__','"owner@example.test"').replace('__TOKEN_JSON__','"synthetic-write-only-key"');
  vm.createContext(context);vm.runInContext(source,context);return {context,posts,getTriggers:()=>triggers};
}
test('email excerpts keep exact codes and omit unrelated footer text',()=>{
  const f=fixture();const excerpt=f.context.otpMailExcerpt('Your Contoso verification code','Use this code to sign in\n\n246810\n\nThe code is valid for 5 minutes.\n\nUnrelated long footer 998877 invoice');
  expect(excerpt).not.toContain('998877');expect(parseOtp(excerpt)?.code).toBe('246810');
});
test('HTML email is converted to text without scripts or URLs as executable content',()=>{
  const f=fixture();const text=f.context.otpMailText({mimeType:'text/html',body:{data:Buffer.from('<style>hidden</style><p>Your verification code</p><div>246810</div><script>evil()</script>').toString('base64url')}},data=>Buffer.from(data,'base64url').toString('utf8'));
  expect(text).not.toContain('evil');expect(text).not.toContain('hidden');expect(parseOtp(f.context.otpMailExcerpt('',text))?.code).toBe('246810');
});
test('setup only runs for the bound Google account and creates one minute trigger once',()=>{
  const wrong=fixture('wrong@example.test');expect(()=>wrong.context.installOtpInbox()).toThrow('Wrong Google account');expect(wrong.posts).toHaveLength(0);
  const f=fixture();f.context.installOtpInbox();f.context.installOtpInbox();expect(f.getTriggers()).toBe(1);expect(f.posts).toHaveLength(2);expect(f.posts[0].url).toEndWith('/v1/source-heartbeat');
});

test('OAuth permission alerts mentioning the inbox name are not OTP candidates',()=>{
  const f=fixture();expect(f.context.otpMailExcerpt('Security alert','You allowed OTP Inbox access to some Google account data.')).toBe('');
});

test('sent-only messages are skipped while a message delivered to the same inbox is captured',()=>{
  const payload={headers:[{name:'Subject',value:'Contoso verification code'},{name:'From',value:'sender@example.test'}],mimeType:'text/plain',body:{data:Buffer.from('Contoso verification code: 246810').toString('base64url')}};
  const f=fixture('owner@example.test',[{id:'sent-to-other',labelIds:['SENT'],internalDate:String(Date.now()),payload},{id:'delivered-to-self',labelIds:['SENT','INBOX'],internalDate:String(Date.now()),payload}]);
  f.context.installOtpInbox();const deliveries=f.posts.filter(p=>p.url.endsWith('/v1/email'));
  expect(deliveries).toHaveLength(1);expect(JSON.parse(deliveries[0].payload).message_id).toBe('delivered-to-self');
  expect(f.posts.some(p=>p.url.endsWith('/v1/source-heartbeat'))).toBe(true);
});
