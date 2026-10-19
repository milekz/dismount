/* Real-browser integration checks through ChromeDriver or SafariDriver (no npm dependencies).
   Start a driver on port 4444; then BROWSER=safari node scripts/browser-check.cjs.
   MOBILE=1 BROWSER=chrome exercises native touch input with mobile emulation. */
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),driver=process.env.WEBDRIVER_URL||'http://127.0.0.1:4444';
const browser=process.env.BROWSER||'chrome',mobile=process.env.MOBILE==='1';
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(await fs.readFile(file));
  }catch(_){res.writeHead(404);res.end();}
});
let session;
async function request(method,url,body) {
  const response=await fetch(driver+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok||result.value?.error)throw new Error(result.value?.message||JSON.stringify(result));
  return result.value;
}
const command=(name,body)=>request('POST','/session/'+session+'/'+name,body);
const evaluate=script=>command('execute/sync',{script,args:[]});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(script,timeout=30000) {
  const start=Date.now();
  while(Date.now()-start<timeout){if(await evaluate('return '+script))return;await sleep(100);}
  throw new Error('Timed out: '+script);
}
async function element(selector) {
  const result=await command('element',{using:'css selector',value:selector});
  return result['element-6066-11e4-a52e-4f735466cecf'];
}
async function click(selector){const id=await element(selector);await command('element/'+id+'/click',{});}
async function run() {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const caps={browserName:browser};
  if(browser==='chrome')caps['goog:chromeOptions']={args:['--headless=new','--no-sandbox','--disable-dev-shm-usage'],...(mobile?{mobileEmulation:{deviceMetrics:{width:390,height:844,pixelRatio:2,mobile:true,touch:true}}}:{})};
  session=(await request('POST','/session',{capabilities:{alwaysMatch:caps}})).sessionId;
  await command('url',{url:'http://127.0.0.1:'+server.address().port+'/?chamber=1&character=robot'});
  await waitFor("document.querySelector('#status').textContent==='READY TO DISMOUNT'");
  // Instrument errors and audio without changing the game or autoplay policy.
  await evaluate("window.qaErrors=[];window.addEventListener('error',e=>qaErrors.push(e.message));const Original=window.AudioContext||window.webkitAudioContext;window.AudioContext=class extends Original{constructor(){super();window.qaAudio=this;}};");
  if(!mobile) {
    assert.equal(await evaluate("const a=document.querySelector('#control-home').getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect(),p=document.querySelector('#power-value').getBoundingClientRect(),l=document.querySelector('#launch').getBoundingClientRect();return Math.abs(a.height-s.height)<3&&p.bottom<a.bottom&&l.bottom<a.bottom"),true,'power and launch fit the stage-height sidebar');
  }
  await click('#fullscreen');
  await waitFor("!document.querySelector('#settings-toggle').hidden");
  await click('#settings-toggle');
  assert.equal(await evaluate("return document.querySelector('#game-panel').contains(document.querySelector('#layout'))"),true);
  await evaluate("document.querySelector('#character').value='inflatable';document.querySelector('#character').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("return document.querySelector('#damage-map-heading').textContent"),'Tube damage map');
  await click('#settings-close');
  const canvas=await element('#game');
  await command('actions',{actions:[{type:'pointer',id:'push',parameters:{pointerType:mobile?'touch':'mouse'},actions:[
    {type:'pointerMove',origin:{'element-6066-11e4-a52e-4f735466cecf':canvas},x:0,y:0},
    {type:'pointerDown',button:0},{type:'pause',duration:600},{type:'pointerUp',button:0}
  ]}]});
  await waitFor("document.querySelector('#status').textContent==='DISMOUNT IN PROGRESS'");
  await waitFor("window.qaAudio?.state==='running'");
  await click('#stage-reset');await click('#fullscreen');
  await click('#drop');await waitFor("document.querySelector('#status').textContent==='EXPERIMENT COMPLETE'");
  const score=await evaluate("return document.querySelector('#score').textContent");
  // Save and replay through the worker; verify the result and automatic scrolling.
  await evaluate("document.querySelector('#initials').value='QAQ';document.querySelector('#score-entry').requestSubmit();");
  await click('#score-rows button');
  await waitFor("document.querySelector('#status').textContent==='REPLAYING EXPERIMENT'",60000);
  await waitFor("document.querySelector('#game-panel').getBoundingClientRect().top>=-2 && document.querySelector('#game-panel').getBoundingClientRect().top<50");
  await waitFor("document.querySelector('#status').textContent==='EXPERIMENT COMPLETE'");
  assert.equal(await evaluate("return document.querySelector('#score').textContent"),score);
  assert.deepEqual(await evaluate('return window.qaErrors'),[]);
  console.log(browser+(mobile?' mobile':'')+': fullscreen, settings, gesture release, audio unlock, worker replay and scroll passed');
}
run().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(session)await request('DELETE','/session/'+session).catch(()=>{});
  server.close();
});
