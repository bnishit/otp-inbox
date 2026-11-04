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
    def test_rejects_unsafe_urls_and_duplicate_accounts(self):
        for u in ['http://public.example.test','https://user:password@example.test','https://example.test/path','https://example.test/?key=x']:
            with self.assertRaises(ValueError):setup.validate_url(u)
        with self.assertRaises(ValueError):setup.create('https://example.test',['a=x@example.test','b=x@example.test'],['codex'])

if __name__=='__main__':unittest.main()
