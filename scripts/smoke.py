#!/usr/bin/env python3
"""Synthetic local transport test. Never prints or stores a code."""
import argparse,json,sys,urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from setup import DEFAULT
from datetime import datetime,timezone

def post(url,path,key,data):
    with urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key}),timeout=35) as r:return json.load(r)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--settings',type=Path,default=DEFAULT);a=p.parse_args();c=json.loads(a.settings.read_text())
    stamp=datetime.now(timezone.utc).isoformat();token=next(iter(c['clients'].values()))
    try:
        receipt=post(c['url'],'/v1/sms',c['ingest_token'],{'message':'Contoso verification code: 246810. Valid for 30 seconds.','received_at':stamp})
        rpc=post(c['url'],'/mcp',token,{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'otp_list_recent','arguments':{'service':'Contoso','channel':'sms','since':stamp}}})
        listed=json.loads(rpc['result']['content'][0]['text']);assert any(i['id']==receipt['id'] for i in listed['items']);assert '246810' not in json.dumps(listed)
        claim=post(c['url'],'/v1/claim',token,{'id':receipt['id'],'service':'Contoso'});assert claim['code']=='246810'
    except Exception:raise SystemExit('Smoke check failed; no message or credentials printed.')
    print('PASS: synthetic capture → MCP lookup → exact claim. Code hidden; entry expires within 30 seconds.')
