#!/usr/bin/env python3
"""Restart an isolated extension profile with a synthetic local inbox. Never use real credentials."""
import argparse,json,subprocess,tempfile,shutil,threading,time
from datetime import datetime,timezone,timedelta
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
 p=argparse.ArgumentParser();p.add_argument('--chromium',required=True);p.add_argument('--screenshot');p.add_argument('--auto-screenshot');p.add_argument('--global-screenshot');p.add_argument('--payment-screenshot');args=p.parse_args()
 items=[];requests=[]
 class Inbox(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(('<h1>OTP Verification</h1><p>Synthetic login test</p><form>'+''.join('<input name="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="1">' for _ in range(4))+'</form>').encode())
  def do_POST(self):
   requests.append(self.path);self.rfile.read(int(self.headers.get('Content-Length',0)))
   body=json.dumps(({**items[0],'code':'2468'} if self.path=='/v1/claim' else {'items':items,'sources':[]})).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
 server=ThreadingHTTPServer(('127.0.0.1',0),Inbox);threading.Thread(target=server.serve_forever,daemon=True).start()
 cli=['npx','--yes','--package','@playwright/cli@0.1.23','playwright-cli','-s=otp-restart-regression']
 def run(*command):
  result=subprocess.run(cli+list(command),cwd=ROOT,capture_output=True,text=True,check=True)
  if '### Error' in result.stdout:raise RuntimeError(result.stdout)
  return result.stdout
 with tempfile.TemporaryDirectory() as folder:
  folder=Path(folder);extension=folder/'extension';shutil.copytree(ROOT/'extension',extension)
  manifest=json.loads((extension/'manifest.json').read_text());manifest['host_permissions']=['http://127.0.0.1/*','https://*/*'];(extension/'manifest.json').write_text(json.dumps(manifest))
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
   if any(path!='/v1/recent' for path in requests):raise RuntimeError('Claim occurred before automatic fill was enabled')
   origin='http://127.0.0.1:'+str(server.server_port)
   execute("""async page=>{const worker=page.context().serviceWorkers()[0];await worker.evaluate(async(origin)=>{await chrome.storage.local.set({connection:{origin,token:'synthetic-browser-reader-key-for-restart'},autoFillSites:{[origin]:{service:'Example login',channel:'sms',account:null}}});for(let i=0;i<40;i++){if((await chrome.scripting.getRegisteredContentScripts()).length)return;await new Promise(r=>setTimeout(r,100));}throw Error('Content script was not registered');},'ORIGIN');await page.goto('ORIGIN/test-login');if(await page.locator('input').first().inputValue()!=='')throw Error('Unexpected early fill');return {loginReady:true};}""".replace('ORIGIN',origin))
   fresh=datetime.now(timezone.utc);items[:]=[{'id':'fresh-auto-sms','secret_type':'code','channel':'sms','account':None,'service_hint':'Example login','status':'available','received_at':fresh.isoformat(),'expires_at':(fresh+timedelta(seconds=120)).isoformat()}]
   execute("""async page=>{await page.waitForFunction(()=>[...document.querySelectorAll('input')].map(input=>input.value).join('')==='2468',{timeout:15000});const worker=page.context().serviceWorkers()[0];const status=await worker.evaluate(async()=>(await chrome.storage.session.get('automaticFillStatus')).automaticFillStatus);if(status?.status!=='filled')throw Error('Fill receipt missing');AUTO_SCREENSHOT return {automaticallyFilled:true};}""".replace('AUTO_SCREENSHOT',('await page.screenshot({path:'+json.dumps(args.auto_screenshot)+'});') if args.auto_screenshot else ''))
   if requests.count('/v1/claim')!=1:raise RuntimeError('Automatic fill did not make exactly one claim')
   execute('''async page=>{const worker=page.context().serviceWorkers()[0];const id=worker.url().split('/')[2];await page.goto('chrome-extension://'+id+'/panel.html');await page.getByRole('button',{name:'Turn on automatic login filling everywhere',exact:true}).click();await page.getByRole('button',{name:'Turn off automatic login filling everywhere',exact:true}).waitFor();for(let i=0;i<40;i++){if(await worker.evaluate(async()=>(await chrome.scripting.getRegisteredContentScripts()).some(s=>s.id==='otp-auto-all')))return {globalEnabled:true};await new Promise(r=>setTimeout(r,100));}throw Error('Global registration missing');}''')
   run('close');open_browser()
   execute('''async page=>{await page.route('https://login.example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Sign in</h1><input autocomplete="one-time-code">'}));await page.goto('https://login.example.com/');return {newSiteReady:true};}''')
   fresh=datetime.now(timezone.utc);items[:]=[{'id':'global-sms','secret_type':'code','channel':'sms','account':None,'service_hint':'example','status':'available','received_at':fresh.isoformat(),'expires_at':(fresh+timedelta(seconds=120)).isoformat()}]
   execute('''async page=>{await page.waitForFunction(()=>document.querySelector('input').value==='2468',{timeout:15000});const worker=page.context().serviceWorkers()[0];GLOBAL_SCREENSHOT const settings=await worker.evaluate(async()=>chrome.storage.local.get(['autoFillEverywhere','autoFillSites']));if(!settings.autoFillEverywhere||settings.autoFillSites['https://login.example.com'])throw Error('Global mode required a site rule');return {newSiteFilledAfterRestartWithoutSetup:true};}'''.replace('GLOBAL_SCREENSHOT',('await page.screenshot({path:'+json.dumps(args.global_screenshot)+'});') if args.global_screenshot else ''))
   if requests.count('/v1/claim')!=2:raise RuntimeError('Global fill did not make exactly one additional claim')
   execute('''async page=>{const worker=page.context().serviceWorkers()[0],id=worker.url().split('/')[2];await page.goto('chrome-extension://'+id+'/panel.html');await page.getByText('Payment codes',{exact:true}).click();await page.getByLabel('Payment behavior').selectOption('submit');await page.getByRole('button',{name:'Save payment behavior',exact:true}).click();await page.getByText('Payment behavior saved. It survives restarts.',{exact:true}).waitFor();await page.route('https://login.example.com/payment',route=>route.fulfill({contentType:'text/html',body:'<p>Synthetic payment test. No real charge.</p><form onsubmit="event.preventDefault();document.body.dataset.confirmed=String(Number(document.body.dataset.confirmed||0)+1);document.querySelector(&quot;h1&quot;).textContent=&quot;Synthetic payment submitted — no real charge&quot;"><h1>Authenticate transaction</h1><input type="password" name="otp"><button>Submit</button></form>'}));await page.goto('https://login.example.com/payment');return {syntheticPaymentReady:true};}''')
   fresh=datetime.now(timezone.utc);items[:]=[{'id':'global-payment','secret_type':'code','channel':'sms','account':None,'service_hint':'example','preview':'Example payment verification OTP [redacted]','status':'available','received_at':fresh.isoformat(),'expires_at':(fresh+timedelta(seconds=120)).isoformat()}]
   execute('''async page=>{await page.waitForFunction(()=>document.body.dataset.confirmed==='1',{timeout:15000});await page.waitForTimeout(3500);if(await page.locator('body').getAttribute('data-confirmed')!=='1')throw Error('Repeated payment submission');PAYMENT_SCREENSHOT const worker=page.context().serviceWorkers()[0],id=worker.url().split('/')[2];await page.goto('chrome-extension://'+id+'/panel.html');await page.getByRole('button',{name:'Disconnect bridge',exact:true}).click();return {syntheticPaymentFilledAndSubmittedExactlyOnce:true};}'''.replace('PAYMENT_SCREENSHOT',('await page.screenshot({path:'+json.dumps(args.payment_screenshot)+'});') if args.payment_screenshot else ''))
   if requests.count('/v1/claim')!=3:raise RuntimeError('Synthetic payment did not make exactly one additional claim')
   run('close');open_browser()
   execute('''async page=>{const ctx=page.context();const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const result=await worker.evaluate(async()=>({connection:(await chrome.storage.local.get('connection')).connection,arrivalState:(await chrome.storage.local.get('arrivalState')).arrivalState}));if(result.connection||result.arrivalState)throw Error('Disconnect did not persist');return {disconnectSurvivesRestart:true};}''')
   print(json.dumps({'scope':'real extension in isolated Chrome for Testing; synthetic local inbox; test-only localhost and HTTPS host permissions','connectionSurvivesRestart':True,'smsArrivesWithPanelClosed':True,'badge':'1','copyActionAvailable':True,'disconnectSurvivesRestart':True,'noClaimsBeforeSiteEnabled':True,'automaticFillWithoutWatchOrClick':True,'exactlyOneClaimPerLogin':True,'globalModeSurvivesRestart':True,'newSiteFillsWithoutSiteSetup':True,'syntheticPaymentFillAndSubmitExactlyOnce':True}))
  finally:
   subprocess.run(cli+['close'],cwd=ROOT,capture_output=True);server.shutdown()
if __name__=='__main__':main()
