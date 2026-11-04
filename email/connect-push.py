#!/usr/bin/env python3
"""Local PKCE consent. Saves credentials to ignored private settings, never stdout."""
import argparse,base64,hashlib,json,os,secrets,time,urllib.parse,urllib.request
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path

import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from setup import DEFAULT,render
SETTINGS=DEFAULT
CLIENT=DEFAULT.parent/'google-client.json'

def connect(source):
 config=json.loads(SETTINGS.read_text())
 if source not in config['mailboxes']:raise ValueError('Unknown configured mailbox')
 expected=config['mailboxes'][source]['email']
 client=json.loads(CLIENT.read_text())['installed']
 saved={'client_id':client['client_id'],'client_secret':client['client_secret']}
 if config['gmail_push']['clientId']!=saved['client_id'] or config['gmail_push']['clientSecret']!=saved['client_secret']:raise ValueError('OAuth client mismatch')
 state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
 challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
 redirect='http://127.0.0.1:8765/callback';outcome=[]
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   if self.path=='/health':
    self.send_response(200);self.end_headers();self.wfile.write(b'Local OTP consent listener ready');return
   params=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
   if urllib.parse.urlsplit(self.path).path!='/callback' or params.get('state')!=[state]:self.send_error(400);return
   try:
    if 'error' in params or not params.get('code'):raise ValueError()
    form=urllib.parse.urlencode({'code':params['code'][0],'client_id':saved['client_id'],'client_secret':saved['client_secret'],'redirect_uri':redirect,'grant_type':'authorization_code','code_verifier':verifier}).encode()
    with urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token',data=form),timeout=20) as r:token=json.load(r)
    with urllib.request.urlopen(urllib.request.Request('https://gmail.googleapis.com/gmail/v1/users/me/profile',headers={'Authorization':'Bearer '+token['access_token']}),timeout=20) as r:profile=json.load(r)
    if profile.get('emailAddress','').lower()!=expected or not token.get('refresh_token'):raise ValueError()
    config['gmail_push']['refreshTokens'][source]=token['refresh_token']
    render(config,SETTINGS)
    outcome.append(True);message='OTP Inbox Push connected. You can close this tab.'
   except Exception:
    outcome.append(False);message='Connection did not complete. No mailbox credential was saved.'
   body=('<!doctype html><meta charset="utf-8"><title>OTP Inbox Push</title><p>'+message+'</p>').encode()
   self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 with HTTPServer(('127.0.0.1',8765),Handler) as server:
  query=urllib.parse.urlencode({'client_id':saved['client_id'],'redirect_uri':redirect,'response_type':'code','scope':'https://www.googleapis.com/auth/gmail.readonly','access_type':'offline','prompt':'consent','login_hint':expected,'state':state,'code_challenge':challenge,'code_challenge_method':'S256'})
  print(json.dumps({'source':source,'authorization_url':'https://accounts.google.com/o/oauth2/v2/auth?'+query}),flush=True)
  server.timeout=1;deadline=time.time()+900
  while not outcome and time.time()<deadline:server.handle_request()
  print(json.dumps({'source':source,'connected':bool(outcome and outcome[0]),'tokens_printed':False}),flush=True)
  return bool(outcome and outcome[0])
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--settings',type=Path,default=DEFAULT);parser.add_argument('--client',type=Path,default=CLIENT);args=parser.parse_args();SETTINGS=args.settings;CLIENT=args.client
 try:raise SystemExit(0 if connect(args.source) else 1)
 except (ValueError,KeyError,OSError):raise SystemExit('Check private settings, desktop OAuth client and mailbox name; credential values hidden.')
