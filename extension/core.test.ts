import {test,expect} from 'bun:test';
import {bridgeOrigin,loginMatches,safeLink} from './core.js';
test('extension connects only to an explicit origin and limits HTTP to loopback',()=>{
  expect(bridgeOrigin('https://bridge.example.test')).toBe('https://bridge.example.test');
  expect(bridgeOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  for(const value of ['http://example.test','https://user:secret@example.test','https://example.test/path','https://example.test/?token=secret','javascript:alert(1)'])expect(()=>bridgeOrigin(value)).toThrow();
});
test('expired, other-account, old and other-client items cannot become ready actions',()=>{
  const now=Date.now(),watch={channel:'email',account:'owner@example.test',since:new Date(now-1000).toISOString()};
  const item={status:'available',channel:'email',account:'owner@example.test',received_at:new Date(now).toISOString(),expires_at:new Date(now+1000).toISOString()};
  expect(loginMatches([item],watch,now)).toHaveLength(1);
  for(const changed of [{expires_at:new Date(now-1).toISOString()},{received_at:new Date(now-2000).toISOString()},{account:'other@example.test'},{channel:'sms'},{status:'claimed'},{status:'needs_review'},{expires_at:'invalid'}])expect(loginMatches([{...item,...changed}],watch,now)).toHaveLength(0);
  expect(loginMatches([{...item,status:'claimed_by_you'}],watch,now)).toHaveLength(1);
});
test('a claimed link can open only on the exact selected website',()=>{
  const link='https://afterspan.example.test/app#sign-in=syntheticloginsecret';
  const claim={secret_type:'link',link},item={link_origin:'https://afterspan.example.test'};
  expect(safeLink(claim,item,item.link_origin)).toBe(link);
  for(const bad of ['https://afterspan.example.test.evil.test/app#secret','javascript:alert(1)','http://afterspan.example.test/app','https://user:secret@afterspan.example.test/app'])expect(()=>safeLink({...claim,link:bad},item,item.link_origin)).toThrow();
  expect(()=>safeLink(claim,item,'https://other.example.test')).toThrow();
});
