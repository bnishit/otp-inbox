import {test,expect} from 'bun:test';
import {bridgeOrigin,safeLink} from './core.js';
test('extension connects only to an explicit origin and limits HTTP to loopback',()=>{
  expect(bridgeOrigin('https://bridge.example.test')).toBe('https://bridge.example.test');
  expect(bridgeOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  for(const value of ['http://example.test','https://user:secret@example.test','https://example.test/path','https://example.test/?token=secret','javascript:alert(1)'])expect(()=>bridgeOrigin(value)).toThrow();
});
test('a claimed link can open only on the exact selected website',()=>{
  const link='https://afterspan.example.test/app#sign-in=syntheticloginsecret';
  const claim={secret_type:'link',link},item={link_origin:'https://afterspan.example.test'};
  expect(safeLink(claim,item,item.link_origin)).toBe(link);
  for(const bad of ['https://afterspan.example.test.evil.test/app#secret','javascript:alert(1)','http://afterspan.example.test/app','https://user:secret@afterspan.example.test/app'])expect(()=>safeLink({...claim,link:bad},item,item.link_origin)).toThrow();
  expect(()=>safeLink(claim,item,'https://other.example.test')).toThrow();
});
