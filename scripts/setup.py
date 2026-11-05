#!/usr/bin/env python3
"""Generate a private, single-owner deployment without printing credentials."""
import argparse,json,os,re,secrets
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
DEFAULT=ROOT/'.local/settings.json'

def private_write(path, text):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:f.write(text);f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path)

def validate_url(url):
    u=urlsplit(url)
    if u.username or u.password or u.query or u.fragment or u.path not in ('','/') or not u.hostname:
        raise ValueError('Use an origin URL without path, credentials, query or fragment')
    if u.scheme!='https' and not (u.scheme=='http' and u.hostname in ('localhost','127.0.0.1')):
        raise ValueError('Use HTTPS except for local development')
    return url.rstrip('/')

def render(config,path=DEFAULT):
    path=Path(path);folder=path.parent
    env={'PORT':'8787','OTP_INGEST_TOKEN':config['ingest_token'],'OTP_CLIENT_TOKENS':json.dumps(config['clients'],separators=(',',':')),'OTP_EMAIL_SOURCES':json.dumps(config['mailboxes'],separators=(',',':'))}
    if config.get('login_link_rules'):env['OTP_LOGIN_LINK_RULES']=json.dumps(config['login_link_rules'],separators=(',',':'))
    if config.get('gmail_push'):env['GMAIL_PUSH_CONFIG']=json.dumps(config['gmail_push'],separators=(',',':'))
    private_write(path,json.dumps(config,indent=2)+'\n')
    private_write(folder/'server.env',''.join(k+'='+v+'\n' for k,v in env.items()))
    for name,token in config['clients'].items():
        private_write(folder/'agents'/f'{name}.env','OTP_INBOX_TOKEN='+json.dumps(token)+'\n')
        private_write(folder/'agents'/f'{name}.json',json.dumps({'url':config['url'],'token_env':'OTP_INBOX_TOKEN','credentials_file':f'{name}.env'},indent=2)+'\n')
    main=(ROOT/'email/collector-main.gs').read_text();mail=(ROOT/'email/mail.js').read_text().replace('export function','function')
    for name,source in config['mailboxes'].items():
        script=main.replace('__ENDPOINT_JSON__',json.dumps(config['url'])).replace('__ACCOUNT_JSON__',json.dumps(source['email'])).replace('__TOKEN_JSON__',json.dumps(source['token']))+'\n'+mail
        private_write(folder/'email'/name/'Code.gs',script)
        private_write(folder/'email'/name/'appsscript.json',(ROOT/'email/appsscript.json').read_text())

def create(url,mailboxes,agents):
    sources={}
    for item in mailboxes:
        name,sep,email=item.partition('=')
        if not sep or not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}',name) or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email):raise ValueError('Mailbox must be name=email@example.com')
        if name in sources or any(s['email'].lower()==email.lower() for s in sources.values()):raise ValueError('Duplicate mailbox')
        sources[name]={'email':email.lower(),'label':name,'token':secrets.token_urlsafe(32)}
    if not agents or len(set(agents))!=len(agents) or any(not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}',a) for a in agents):raise ValueError('Use unique lowercase agent names')
    return {'url':validate_url(url),'ingest_token':secrets.token_urlsafe(32),'clients':{a:secrets.token_urlsafe(32) for a in agents},'mailboxes':sources}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',required=True);p.add_argument('--mailbox',action='append',default=[]);p.add_argument('--agents',default='codex,claude,dot,instinct,muse');p.add_argument('--settings',type=Path,default=DEFAULT)
    args=p.parse_args()
    try:
        if args.settings.exists():
            c=json.loads(args.settings.read_text());c['url']=validate_url(args.url)
            if args.mailbox:raise ValueError('Existing settings preserved. Edit mailbox config privately; rerun without --mailbox to update URL')
        else:c=create(args.url,args.mailbox,args.agents.split(','))
        render(c,args.settings)
    except (ValueError,OSError,KeyError):p.exit(1,'Setup stopped. Check URL/mailbox syntax and existing private settings; no credential values were printed.\n')
    print('Private config, per-agent files and email collectors generated. Values hidden. See docs/deploy.md.')
