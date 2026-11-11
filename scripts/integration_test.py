import json,os,plistlib,socket,subprocess,tempfile,time,unittest,urllib.request
from pathlib import Path
from setup import ROOT,create,render

class IntegrationTest(unittest.TestCase):
    def test_fresh_setup_server_python_mcp_and_shortcut(self):
        with tempfile.TemporaryDirectory() as folder:
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            path=Path(folder)/'settings.json';c=create('http://127.0.0.1:'+str(port),['personal=owner@example.test'],['codex','claude']);render(c,path)
            envfile=Path(folder)/'server.env';envfile.write_text(envfile.read_text().replace('PORT=8787','PORT='+str(port)))
            with subprocess.Popen(['bun','--env-file='+str(envfile),'run','server.ts'],cwd=ROOT,env={k:v for k,v in os.environ.items() if not k.startswith('OTP_') and k not in ('GMAIL_PUSH_CONFIG','PORT')},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) as server:
                try:
                    for _ in range(80):
                        try:
                            with urllib.request.urlopen(c['url']+'/health',timeout=.2) as r:ready=json.load(r)
                            if ready['status']=='ok':break
                        except OSError:time.sleep(.05)
                    else:self.fail('Fresh server did not start')
                    smoke=subprocess.run(['python3','scripts/smoke.py','--settings',str(path)],cwd=ROOT,capture_output=True,text=True,timeout=10)
                    self.assertEqual(smoke.returncode,0,smoke.stdout+smoke.stderr)
                    messages=[{'jsonrpc':'2.0','id':1,'method':'initialize'},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'otp_list_recent','arguments':{'service':'Contoso','channel':'sms','include_claimed':True}}}]
                    run=subprocess.run(['python3','agent.py','--config',str(Path(folder)/'agents/codex.json'),'mcp'],cwd=ROOT,input='\n'.join(json.dumps(m) for m in messages)+'\n',capture_output=True,text=True,timeout=10)
                    results=[json.loads(l) for l in run.stdout.splitlines()];self.assertEqual(len(results[1]['result']['tools']),4);self.assertNotIn('246810',run.stdout)
                    self.assertEqual(json.loads(results[2]['result']['content'][0]['text'])['items'][0]['status'],'claimed_by_you')
                    made=subprocess.run(['python3','scripts/make_shortcut.py','--settings',str(path)],cwd=ROOT,capture_output=True,text=True,timeout=10);self.assertEqual(made.returncode,0,made.stderr)
                    short=plistlib.loads((Path(folder)/'OTP Inbox.unsigned.shortcut').read_bytes());last=short['WFWorkflowActions'][-1]['WFWorkflowActionParameters'];self.assertEqual(last['WFURL'],c['url']+'/v1/sms');self.assertNotIn(c['ingest_token'],made.stdout)
                finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':unittest.main()
