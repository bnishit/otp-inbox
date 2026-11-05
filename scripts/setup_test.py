import importlib.util,json,os,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('setup',Path(__file__).with_name('setup.py'));setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)

class SetupTest(unittest.TestCase):
    def test_account_binding_and_private_files(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'settings.json';c=setup.create('https://inbox.example.test',['personal=owner@example.test'],['codex','claude']);setup.render(c,path)
            self.assertNotEqual(c['clients']['codex'],c['clients']['claude'])
            for p in Path(d).rglob('*'):
                if p.is_file():self.assertEqual(p.stat().st_mode&0o777,0o600)
            self.assertIn('owner@example.test',(Path(d)/'email/personal/Code.gs').read_text())
            self.assertNotIn(c['clients']['claude'],(Path(d)/'agents/codex.env').read_text())
            env={line.partition('=')[0]:line.partition('=')[2] for line in (Path(d)/'server.env').read_text().splitlines()}
            self.assertEqual(json.loads(env['OTP_EMAIL_SOURCES'])['personal']['token'],c['mailboxes']['personal']['token'])
    def test_alias_and_link_config_preserve_credentials_and_emit_rules(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'settings.json';c=setup.create('https://inbox.example.test',['personal=owner@example.test'],['browser','codex'])
            before=json.dumps(c['clients'],sort_keys=True);source_key=c['mailboxes']['personal']['token']
            c['mailboxes']['personal']['aliases']=['alias@example.test']
            c['login_link_rules']=[{'service':'Afterspan','sender':'signin@example.test','origin':'https://afterspan.example.test','pathname':'/app','parameter':'sign-in','location':'fragment','max_age_seconds':600}]
            setup.render(c,path)
            env={line.partition('=')[0]:line.partition('=')[2] for line in (Path(d)/'server.env').read_text().splitlines()}
            self.assertEqual(json.loads(env['OTP_LOGIN_LINK_RULES']),c['login_link_rules'])
            self.assertEqual(json.dumps(c['clients'],sort_keys=True),before)
            self.assertEqual(json.loads(env['OTP_EMAIL_SOURCES'])['personal']['token'],source_key)
            self.assertEqual(json.loads(env['OTP_EMAIL_SOURCES'])['personal']['aliases'],['alias@example.test'])
            scopes=json.loads((Path(d)/'email/personal/appsscript.json').read_text())['oauthScopes']
            self.assertIn('https://www.googleapis.com/auth/gmail.readonly',scopes)
            self.assertNotIn('https://mail.google.com/',scopes)
    def test_rejects_unsafe_urls_and_duplicate_accounts(self):
        for u in ['http://public.example.test','https://user:password@example.test','https://example.test/path','https://example.test/?key=x']:
            with self.assertRaises(ValueError):setup.validate_url(u)
        with self.assertRaises(ValueError):setup.create('https://example.test',['a=x@example.test','b=x@example.test'],['codex'])

if __name__=='__main__':unittest.main()
