import {test, expect} from 'bun:test';
import {parseLoginLink, validateLinkRules, withoutUrls, type LoginLinkRule} from './login';
const rule:LoginLinkRule={service:'Afterspan',sender:'signin@example.test',origin:'https://afterspan.example.test',pathname:'/app',parameter:'sign-in',location:'fragment',max_age_seconds:600};
const link='https://afterspan.example.test/app#sign-in=as_login_syntheticletters';
test('exact sender, authenticated domain, origin, path and token shape are required for links',()=>{
  expect(parseLoginLink('Use this one-time link:\n'+link,rule.sender,'example.test',[rule])?.url).toBe(link);
  for(const [candidate,sender,domain] of [
    [link,'impostor@example.test','example.test'],[link,rule.sender,'other.test'],
    [link.replace('https:','http:'),rule.sender,'example.test'],
    [link.replace('afterspan.example.test','afterspan.example.test.evil.test'),rule.sender,'example.test'],
    [link.replace('/app','/pay'),rule.sender,'example.test'],
    [link.replace('https://','https://user:password@'),rule.sender,'example.test'],
    [link+'&sign-in=as_login_anothersecret',rule.sender,'example.test'],
    [link+'&invite=unrelatedinvite',rule.sender,'example.test'],
    [link.replace('as_login_syntheticletters','short'),rule.sender,'example.test'],
    [link.replace('/app#','/app?next=elsewhere#'),rule.sender,'example.test'],
  ]) expect(parseLoginLink('Sign in: '+candidate,sender,domain,[rule])?.url).toBeNull();
  expect(parseLoginLink('Your receipt '+link,rule.sender,'example.test',[rule])).toBeNull();
  expect(parseLoginLink('Sign in '+link+' https://other.example.test/app#token=anothersecret',rule.sender,'example.test',[rule])?.reason).toBe('multiple_login_links');
});
test('query login links are supported only by their explicit rule',()=>{
  const query={...rule,parameter:'token',location:'query' as const};
  const url='https://afterspan.example.test/app?token=syntheticloginsecret';
  expect(parseLoginLink('Magic link: '+url,rule.sender,'example.test',[query])?.url).toBe(url);
  expect(parseLoginLink('Magic link: '+url+'#other',rule.sender,'example.test',[query])?.url).toBeNull();
});
test('URL redaction hides path, query, fragment and all-letter secrets as whole units',()=>{
  for(const url of [link,'https://example.test/onlyletters?token=letters#secret','http://example.test/123456','www.example.test/alphabetic'])expect(withoutUrls('Sign in '+url)).toBe('Sign in [link hidden]');
});
test('invalid rules fail closed without echoing their input',()=>{
  for(const value of [{},[{}],[{...rule,origin:'https://user:password@example.test'}],[{...rule,max_age_seconds:601}],[{...rule,origin:'http://example.test'}]])expect(()=>validateLinkRules(value)).toThrow('Invalid login link rules');
});
