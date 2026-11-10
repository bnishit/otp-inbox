#!/usr/bin/env python3
"""Run the actual field-filling function against real Chromium DOMs. Synthetic data only."""
import argparse,json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--session',default='otp-field-regressions');p.add_argument('--config');args=p.parse_args()
    cli=['npx','--yes','--package','@playwright/cli@0.1.23','playwright-cli','-s='+args.session]
    source=(ROOT/'extension/core.js').read_text().split('export function fillLoginCode',1)[1]
    function='function fillLoginCode'+source
    cases=[
      ('one marked field','<input autocomplete="one-time-code">',True,1),
      ('split digits',''.join('<input maxlength="1" inputmode="numeric" autocomplete="one-time-code">' for _ in range(6)),True,6),
      ('two possible fields','<input autocomplete="one-time-code"><input autocomplete="one-time-code">',False,0),
      ('search field','<input type="search" name="code">',False,0),
      ('password field','<input type="password" name="otp">',False,0),
      ('hidden field','<input style="display:none" autocomplete="one-time-code">',False,0),
      ('disabled field','<input disabled autocomplete="one-time-code">',False,0),
      ('readonly field','<input readonly autocomplete="one-time-code">',False,0),
      ('wrong length','<input maxlength="4" autocomplete="one-time-code">',False,0),
      ('unmarked field','<input name="search">',False,0),
      ('unrelated digit boxes',''.join('<input maxlength="1" inputmode="numeric">' for _ in range(6)),False,0),
    ]
    code='''async page => {
      const fill=FUNCTION, cases=CASES, results=[];
      for(const [name,html,ok,fields] of cases){
        await page.setContent('<form>'+html+'<button>Continue</button></form>');
        await page.evaluate(()=>{document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.dataset.submitted='true'};globalThis.inputEvents=0;document.addEventListener('input',()=>globalThis.inputEvents++);});
        const result=await page.evaluate(({source})=>(0,eval)('('+source+')')('246810',location.origin),{source:fill.toString()});
        if(result.ok!==ok || (ok && result.fields!==fields))throw Error('Field regression: '+name);
        const state=await page.evaluate(()=>({value:[...document.querySelectorAll('input')].map(i=>i.value).join(''),submitted:document.body.dataset.submitted==='true',events:globalThis.inputEvents}));
        if(state.submitted || (ok && (state.value!=='246810'||state.events!==fields)) || (!ok && state.value!==''))throw Error('Unexpected write or submit: '+name);
        results.push({name,passed:true});
      }
      await page.setContent('<input autocomplete="one-time-code">');
      const changed=await page.evaluate(({source})=>(0,eval)('('+source+')')('246810','https://other.example.test'),{source:fill.toString()});
      if(changed.ok || await page.locator('input').inputValue()!=='')throw Error('Navigation guard failed');
      results.push({name:'changed website',passed:true});
      await page.setContent('<input type="number" autocomplete="one-time-code">');
      const mixed=await page.evaluate(({source})=>(0,eval)('('+source+')')('AB12CD',location.origin),{source:fill.toString()});
      if(mixed.ok || await page.locator('input').inputValue()!=='')throw Error('Mixed code was written into a numeric field');
      results.push({name:'mixed code in numeric field',passed:true});
      for(const [name,title,ok] of [['ready login probe','OTP Verification',true],['unmarked context probe','Search',false],['payment probe','OTP Verification - Confirm payment',false],['card authentication probe','OTP Authentication - Authenticate the transaction - Merchant Name',false]]){
        await page.setContent('<h1>'+title+'</h1><input autocomplete="one-time-code">');
        const result=await page.evaluate(({source})=>(0,eval)('('+source+')')(null,location.origin),{source:fill.toString()});
        if(result.ok!==ok || await page.locator('input').inputValue()!=='')throw Error('Probe regression: '+name);
        results.push({name,passed:true});
      }
      for(const [name,html,ok] of [
        ['GoDaddy account checkup', '<h1>Account checkup</h1><p>A text message with your code has been sent to the number you gave us. Please enter the 6 digit code in that message.</p><label>6-digit code<input id="verification-code-input"></label>', true],
        ['Cashfree authentication popup', '<h1>Accept payments</h1><div role="dialog"><h2>Authenticate</h2><p>Enter the 6-digit OTP sent to your email</p>'+Array.from({length:6},(_,i)=>'<input maxlength="1" aria-label="Please enter OTP character '+(i+1)+'">').join('')+'</div>', true],
        ['Cashfree payment popup stays manual', '<h1>Login</h1><div role="dialog"><h2>Authenticate payment</h2><p>Enter the 6-digit OTP sent to your email</p><input name="otp"></div>', false],
        ['recovery code stays manual', '<h1>Reset your password</h1><p>Enter the verification code sent to your email</p><input name="otp">', false]
      ]){
        await page.setContent('<title>Email Login</title>'+html);
        const probe=await page.evaluate(({source})=>(0,eval)('('+source+')')(null,location.origin),{source:fill.toString()});
        const result=await page.evaluate(({source})=>(0,eval)('('+source+')')('246810',location.origin,{payments:null,expectedPayment:false}),{source:fill.toString()});
        const value=await page.locator('input').evaluateAll(es=>es.map(e=>e.value).join(''));
        if(probe.ok!==ok||result.ok!==ok||value!==(ok?'246810':''))throw Error('Challenge regression: '+name);
        results.push({name,passed:true});
      }
      await page.setContent('<title>Checkout</title><h1>Confirm payment</h1><div role="dialog"><h2>Authenticate</h2><p>Enter the OTP sent to your phone</p><input name="otp"></div>');
      const checkout=await page.evaluate(({source})=>(0,eval)('('+source+')')(null,location.origin),{source:fill.toString()});
      if(checkout.ok)throw Error('A payment popup hid the checkout context');
      results.push({name:'payment popup cannot hide checkout context',passed:true});
      await page.setContent('<h1>Login</h1><input autocomplete="one-time-code" value="123">');
      const existing=await page.evaluate(({source})=>(0,eval)('('+source+')')(null,location.origin),{source:fill.toString()});
      if(existing.ok || await page.locator('input').inputValue()!=='123')throw Error('Existing value was overwritten');
      await page.setContent('<h1>Login - Confirm transaction</h1><input autocomplete="one-time-code">');
      const latePayment=await page.evaluate(({source})=>(0,eval)('('+source+')')('246810',location.origin,true),{source:fill.toString()});
      if(latePayment.ok || await page.locator('input').inputValue()!=='')throw Error('Payment context was not rechecked before write');
      results.push({name:'existing value preserved and payment context rechecked at write',passed:true});
      for(const [name,mode,buttons,expectedPayment,ok,submitted] of [
        ['payment disabled',null,'<button>Submit</button>',true,false,false],
        ['payment prefill','fill','<button>Submit</button>',true,true,false],
        ['payment fill and submit','submit','<button>Submit</button>',true,true,true],
        ['two confirmation buttons','submit','<button>Submit</button><button>Confirm</button>',true,false,false],
        ['verification purpose changed','submit','<button>Submit</button>',false,false,false]
      ]){
        await page.setContent('<form><h1>Authenticate transaction</h1><input type="password" name="otp">'+buttons+'</form>');
        await page.evaluate(()=>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.dataset.confirmed='yes'});
        const result=await page.evaluate(({source,mode,expectedPayment})=>(0,eval)('('+source+')')('246810',location.origin,{payments:mode,expectedPayment}),{source:fill.toString(),mode,expectedPayment});
        const state=await page.evaluate(()=>({value:document.querySelector('input').value,submitted:document.body.dataset.confirmed==='yes'}));
        if(result.ok!==ok||state.submitted!==submitted||state.value!==(ok?'246810':''))throw Error('Payment fixture failed: '+name);
        results.push({name,passed:true});
      }
      return {scope:'actual function in real Chromium; synthetic DOMs; not live login',results};
    }'''.replace('FUNCTION',function).replace('CASES',json.dumps(cases))
    try:
        with tempfile.TemporaryDirectory() as folder:
            config=Path(folder)/'cli.json'
            config.write_text(json.dumps({'browser':{'browserName':'chromium','launchOptions':{'channel':'chrome','headless':True}}}))
            subprocess.run(cli+['open','about:blank','--config',args.config or str(config)],cwd=ROOT,check=True,capture_output=True,text=True)
        with tempfile.NamedTemporaryFile('w',suffix='.js') as f:
            f.write(code);f.flush();result=subprocess.run(cli+['run-code','--filename',f.name],cwd=ROOT,check=True,capture_output=True,text=True)
        # CLI prints source as well. Retain the result only, which contains no secrets.
        output=result.stdout.split('### Result\n',1)[-1].split('### Ran Playwright code',1)[0].strip()
        parsed=json.loads(output)
        if len(parsed.get('results',[])) != len(cases)+17 or not all(result.get('passed') for result in parsed['results']):raise RuntimeError('Browser regressions failed')
        print(output)
    finally:subprocess.run(cli+['close'],cwd=ROOT,capture_output=True)
