#!/usr/bin/env python3
"""Check tracked/public files for accidental private configuration and broken local links."""
import re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FORBIDDEN=[r'/Users/[^/]+/',r'otp-bridge-production\.up\.railway\.app',r'personal-otp-inbox\.',r'rich-charmer-',r'@flobiz\.in',r'GOCSPX-[A-Za-z0-9_-]{10,}',r'gh[pousr]_[A-Za-z0-9]{20,}',r'ya29\.[A-Za-z0-9_-]{15,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']

def audit():
    result=subprocess.run(['git','ls-files'],cwd=ROOT,capture_output=True,text=True)
    paths=[ROOT/p for p in result.stdout.splitlines()] if result.returncode==0 and result.stdout else [p for p in ROOT.rglob('*') if p.is_file() and not any(x in p.parts for x in ('.git','.local','__pycache__','node_modules'))]
    errors=[]
    for p in paths:
        rel=p.relative_to(ROOT)
        if '.local' in rel.parts or p.suffix=='.shortcut' or p.name.startswith('.env') and p.name!='.env.example':errors.append(str(rel)+': private path')
        try:s=p.read_text()
        except (UnicodeError,OSError):continue
        if p.name!='audit.py' and any(re.search(pattern,s) for pattern in FORBIDDEN):errors.append(str(rel)+': private-data pattern')
        if p.suffix=='.md':
            for target in re.findall(r'\]\(([^\s)]+)\)',s):
                if not re.match(r'[a-z]+:|#|/',target) and not (p.parent/target.split('#')[0]).exists():errors.append(str(rel)+': broken link '+target)
    if errors:raise SystemExit('\n'.join(errors))
    print('PASS: public-file patterns, private-path exclusions and local Markdown links')
if __name__=='__main__':audit()
