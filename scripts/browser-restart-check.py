#!/usr/bin/env python3
"""Restart an isolated extension profile with a synthetic local inbox. Never use real credentials."""
import argparse,json,subprocess,tempfile,shutil,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
 p=argparse.ArgumentParser();p.add_argument('--chromium',required=True);p.add_argument('--screenshot');args=p.parse_args()
 items=[];requests=[]
 class Inbox(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   requests.append(self.path);self.rfile.read(int(self.headers.get('Content-Length',0)))
   body=json.dumps({'items':items,'sources':[]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
 server=ThreadingHTTPServer(('127.0.0.1',0),Inbox);threading.Thread(target=server.serve_forever,daemon=True).start()
 cli=['npx','--yes','--package','@playwright/cli@0.1.23','playwright-cli','-s=otp-restart-regression']
 def run(*command):
  result=subprocess.run(cli+list(command),cwd=ROOT,capture_output=True,text=True,check=True)
  if '### Error' in result.stdout:raise RuntimeError(result.stdout)
  return result.stdout
 with tempfile.TemporaryDirectory() as folder:
  folder=Path(folder);extension=folder/'extension';shutil.copytree(ROOT/'extension',extension)
  manifest=json.loads((extension/'manifest.json').read_text());manifest['host_permissions']=['http://127.0.0.1/*'];(extension/'manifest.json').write_text(json.dumps(manifest))
  config=folder/'config.json';config.write_text(json.dumps({'browser':{'browserName':'chromium','launchOptions':{'executablePath':args.chromium,'headless':True,'args':['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],'ignoreDefaultArgs':['--disable-extensions']}}}))
  def open_browser():run('open','about:blank','--persistent','--profile',str(folder/'profile'),'--config',str(config))
  def execute(code):
   script=folder/'check.js';script.write_text(code);return run('run-code','--filename',str(script))
  try:
   open_browser()
   execute('''async page=>{const ctx=page.context();const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=worker.url().split('/')[2];await page.goto('chrome-extension://'+id+'/panel.html');await page.getByLabel('Bridge address').fill('ORIGIN');await page.getByLabel('Browser client key').fill('synthetic-browser-reader-key-for-restart');await page.getByRole('button',{name:'Connect and stay connected'}).click();await page.getByText('This Chrome profile will stay connected after restart.',{exact:false}).waitFor();await page.goto('about:blank');return {connected:true};}'''.replace('ORIGIN','http://127.0.0.1:'+str(server.server_port)))
   run('close')
   now=time.time();items.append({'id':'synthetic-sms','secret_type':'code','channel':'sms','account':None,'service_hint':'Example login','status':'available','received_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now)),'expires_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now+120))})
   open_browser()
   execute('''async page=>{const ctx=page.context();const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const result=await worker.evaluate(async()=>{for(let i=0;i<80;i++){const {inbox}=await chrome.storage.session.get('inbox');if(inbox?.items?.some(item=>item.id==='synthetic-sms'))return {restored:true,badge:await chrome.action.getBadgeText({}),cachedCode:JSON.stringify(inbox).includes('246810')};await new Promise(r=>setTimeout(r,250));}throw Error('Startup failed to restore polling');});if(result.badge!=='1'||result.cachedCode)throw Error('Unexpected restored state');const id=worker.url().split('/')[2];await page.goto('chrome-extension://'+id+'/panel.html');await page.getByRole('button',{name:'Copy code',exact:true}).waitFor();SCREENSHOT await page.getByRole('button',{name:'Disconnect bridge',exact:true}).click();return result;}'''.replace('SCREENSHOT',('await page.screenshot({path:'+json.dumps(args.screenshot)+'});') if args.screenshot else ''))
   run('close');open_browser()
   execute('''async page=>{const ctx=page.context();const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const result=await worker.evaluate(async()=>({connection:(await chrome.storage.local.get('connection')).connection,arrivalState:(await chrome.storage.local.get('arrivalState')).arrivalState}));if(result.connection||result.arrivalState)throw Error('Disconnect did not persist');return {disconnectSurvivesRestart:true};}''')
   if any(path!='/v1/recent' for path in requests):raise RuntimeError('Unexpected automatic claim')
   print(json.dumps({'scope':'real extension in isolated Chrome for Testing; synthetic local inbox; extra localhost host permission in test manifest','connectionSurvivesRestart':True,'smsArrivesWithPanelClosed':True,'badge':'1','copyActionAvailable':True,'disconnectSurvivesRestart':True,'noAutomaticClaims':True}))
  finally:
   subprocess.run(cli+['close'],cwd=ROOT,capture_output=True);server.shutdown()
if __name__=='__main__':main()
