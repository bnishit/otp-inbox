#!/usr/bin/env python3
"""Build an owner-private Sites adapter from the shared tool schema."""
import argparse,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--project-id',required=True);a=p.parse_args()
    dest=ROOT/'.local/sites';(dest/'server').mkdir(parents=True,exist_ok=True);(dest/'.openai').mkdir(exist_ok=True)
    tools=json.loads((ROOT/'tools.json').read_text())
    for t in tools:t['annotations']={'readOnlyHint':t['name']!='otp_claim','destructiveHint':False,'openWorldHint':False}
    (dest/'server/index.js').write_text('const tools='+json.dumps(tools)+';\n'+(ROOT/'adapters/sites/worker.js').read_text())
    (dest/'.openai/hosting.json').write_text(json.dumps({'project_id':a.project_id,'capabilities':['mcp'],'d1':None,'r2':None},indent=2)+'\n')
    print('Built .local/sites. Publish owner-private using your own Sites source/deploy workflow. No credentials embedded.')
