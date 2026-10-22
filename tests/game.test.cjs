// Exercise browser-facing state transitions with a minimal DOM/Canvas adapter.
// Actual layout, audio output, and browser integration require visual checking.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const physics = require('../src/physics.js');
const endlessFx = require('../src/endless.js');

// Keep shared gesture and replay fixtures on Classic; startup tests pass their own URL.
function setup(AudioContext, storage, reducedMotion=true, viewport={width:900,height:700}, url='https://example.com/?chamber=classic', physicsApi=physics) {
  const elements = new Map();
  let translations=[],scales=[];const scrollRequests=[];
  const context2d = new Proxy({}, { get: (target, key) => target[key] ?? (key === 'clearRect' ? () => {translations=[];scales=[];} : key === 'translate' ? (...args)=>translations.push(args) : key === 'scale' ? (...args)=>scales.push(args) : ['createLinearGradient','createRadialGradient'].includes(key) ? () => ({ addColorStop() {} }) : () => {}), set: (target,key,value) => {target[key]=value;return true;} });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'angle' ? '15' : id === 'part' ? 'chest' : '', style: {}, disabled: false,
      events: {}, options: (['layout','welcome-layout'].includes(id)?['classic','steep','long','landing','uneven','shaft','endless','finalDrop']:['character','welcome-character'].includes(id)?Object.keys(physics.CHARACTERS):['head', 'neck', 'chest', 'hip', 'leftKnee', 'rightKnee', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']).map(value => ({ value })), tagName: 'DIV',
      addEventListener(type, handler) { this.events[type] = handler; },
      capturedPointer: null,
      setPointerCapture(id) { this.capturedPointer = id; },
      hasPointerCapture(id) { return this.capturedPointer === id; },
      releasePointerCapture(id) {
        this.capturedPointer = null;
        this.events.lostpointercapture?.({ pointerId: id });
      },
      children: [], appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children=children; }, getAttribute(name) { return this[name]; }, setAttribute(name, value) { this[name] = value; },
      getBoundingClientRect() { return { ...viewport, left: 0, top: 0 }; },
      getContext() { return context2d; },toDataURL(){return 'data:image/png;base64,test';},scrollIntoView(options){scrollRequests.push({id,options});}
    });
    return elements.get(id);
  }
  let nextFrame, time = 0;
  const windowEvents = {}, documentEvents = {};
  let restoredScroll=null;
  let serial=0;
  const document = { documentElement:element('root'),body:{style:{position:'',top:'',width:'',overflow:''}},
    querySelectorAll:()=>[element('page-header'),element('outside-controls')],
    getElementById: element, createElement: () => element('row-'+serial++),
    addEventListener(type,handler) {
      const previous=documentEvents[type];
      documentEvents[type]=event=>{previous?.(event);handler(event);};
    } };
  const sandbox = { window: { scrollX:0,scrollY:120,scrollTo:(x,y)=>{restoredScroll=[x,y];},matchMedia:()=>({matches:reducedMotion}), AudioContext, DismountEndless:endlessFx, DismountSubjects:require('../src/subjects.js'), DismountChallenges:require('../src/challenges.js'), DismountFullscreen:require('../src/fullscreen.js'), DismountAudio:require('../src/audio.js'), DismountReplay:require('../src/replay.js'), DismountPhysics: physicsApi, DismountScores: require('../src/scores.js'), DismountCharacterArt:require('../src/character-art.js'), addEventListener(type, callback) { windowEvents[type] = callback; } }, document, devicePixelRatio: 1,
    localStorage: storage || { getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); } },
    ResizeObserver: class { observe() {} }, requestAnimationFrame(callback) { nextFrame = callback; } };
  if(url) {
    sandbox.URL=URL;
    sandbox.window.location={href:url};
    sandbox.window.history={state:null,replaceState(state,title,href){sandbox.window.location.href=href;}};
  }
  sandbox.window.DismountShadow=require('../src/shadow.js');
  sandbox.window.DismountBadges=require('../src/badges.js');
  sandbox.window.DismountPhysicsView=require('../src/physics-view.js');
  const theme=require('../src/theme.js');
  const themeHost={matchMedia:()=>({matches:false}),addEventListener(){}};
  sandbox.window.DismountTheme={...theme,current:theme.createTheme({host:themeHost,document,storage:sandbox.localStorage})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/game.js'), 'utf8'), sandbox);
  return { host:sandbox.window, scrollRequests, element, windowEvents, url:()=>sandbox.window.location?.href, document, documentEvents, restoredScroll:()=>restoredScroll, camera:()=>translations[0], zoom:()=>scales[0]?.[0], click: id => element(id).events.click(), advance(seconds) {
    for (let frame = 0; frame < seconds * 60; frame++) { time += 1000 / 60; if (AudioContext?.instance) AudioContext.instance.currentTime = time/1000; nextFrame(time); }
  } };
}

test('charge, launch, completion, replay, and reset work with storage disabled', () => {
  const game = setup();
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  game.click('launch');
  game.advance(0.6);
  assert.equal(game.element('status').textContent, 'CHARGING PUSH');
  game.click('launch');
  assert.equal(game.element('launch').disabled, true);
  game.advance(20);
  assert.equal(game.element('status').textContent, 'EXPERIMENT COMPLETE');
  const score = game.element('score').textContent;
  assert.ok(Number(score) > 0);
  game.click('replay');
  game.advance(20);
  assert.equal(game.element('score').textContent, score);
  assert.equal(game.element('status').textContent, 'EXPERIMENT COMPLETE');
  game.click('reset');
  assert.equal(game.element('score').textContent, '000000');
  assert.equal(game.element('part').disabled, false);
  assert.equal(game.element('result').hidden, true);
});

test('reset cancels charging and active replay; view and speed toggle independently', () => {
  const game = setup();
  game.click('launch'); game.advance(0.3); game.click('reset');
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  game.click('view');
  assert.equal(game.element('view').textContent, 'VIEW: SIDE');
  game.click('slow');
  assert.equal(game.element('slow')['aria-pressed'], 'true');
  game.click('launch'); game.advance(0.4); game.click('launch'); game.advance(40);
  game.click('replay'); game.advance(0.5); game.click('reset'); game.advance(1);
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  assert.equal(game.element('score').textContent, '000000');
});

test('mouse drag chooses a body part, sets power and angle, and launches on release', () => {
  const game = setup();
  game.advance(0.1);
  const canvas = game.element('game');
  // Renderer fits 1080 world units into a 900 × 700 canvas.
  const scale = 515 / 720;
  const x = (900 - 1080 * scale) / 2 + 20 + 191 * scale;
  const y = 135 + 116 * scale;
  const pointer = { button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {} };
  canvas.events.pointerdown(pointer);
  assert.equal(game.element('status').textContent, 'DRAG TO AIM');
  assert.equal(game.element('part').value, 'chest');
  canvas.events.pointermove({ ...pointer, clientX: x + 150, clientY: y - 40 });
  assert.ok(Number(game.element('angle').value) > 0);
  assert.ok(parseInt(game.element('power-value').textContent) > 80);
  canvas.events.pointerup({ ...pointer, clientX: x + 150, clientY: y - 40 });
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
  game.advance(20);
  assert.ok(Number(game.element('score').textContent) > 0);
});

test('cancelled pointer gestures and simple clicks do not launch the dummy', () => {
  const game = setup();
  game.advance(0.1);
  const canvas = game.element('game'), scale = 515 / 720;
  const pointer = { button: 0, pointerId: 2,
    clientX: (900 - 1080 * scale) / 2 + 20 + 194 * scale,
    clientY: 135 + 83 * scale, preventDefault() {} };
  canvas.events.pointerdown(pointer);
  canvas.events.pointerup(pointer);
  assert.equal(game.element('part').value, 'head');
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  canvas.events.pointerdown(pointer);
  canvas.events.pointermove({ ...pointer, clientX: pointer.clientX + 100 });
  canvas.events.pointercancel(pointer);
  game.advance(1);
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  assert.equal(game.element('score').textContent, '000000');
});

test('zero-power drop starts gravity immediately and can be replayed', () => {
  const game = setup();
  game.click('drop');
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent, '0%');
  assert.equal(game.element('drop').disabled, true);
  game.advance(20);
  assert.equal(game.element('status').textContent, 'EXPERIMENT COMPLETE');
  const score = game.element('score').textContent;
  game.click('replay'); game.advance(20);
  assert.equal(game.element('score').textContent, score);
  game.click('reset');
  assert.equal(game.element('drop').disabled, false);
});

test('full-power drags launch on the first release, including steep drags', () => {
  for (const [dx, dy] of [[180, 0], [5, -180], [0, 180], [800, 0]]) {
    const game = setup();
    game.advance(0.1);
    const canvas = game.element('game'), scale = 515/720;
    const start = { button: 0, pointerId: 8, preventDefault() {},
      clientX: (900-1080*scale)/2+20+191*scale, clientY: 135+116*scale };
    const end = {...start, clientX:start.clientX+dx, clientY:start.clientY+dy};
    canvas.events.pointerdown(start);
    canvas.events.pointermove(end);
    assert.equal(game.element('power-value').textContent, '100%');
    canvas.events.pointerup(end);
    assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
    assert.equal(game.element('power-value').textContent, '100%');
    // A repeated release / delayed capture-loss event must not reset the launch.
    canvas.events.pointerup(end);
    canvas.events.lostpointercapture?.({pointerId:8});
    assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
    game.advance(0.1);
    assert.ok(parseFloat(game.element('elapsed').textContent)>0);
  }
});

test('release uses its final position even if the final move event was skipped', () => {
  const game = setup();
  game.advance(0.1);
  const canvas = game.element('game'), scale = 515/720;
  const start = { button: 0, pointerId: 9, preventDefault() {},
    clientX: (900-1080*scale)/2+20+191*scale, clientY: 135+116*scale };
  canvas.events.pointerdown(start);
  canvas.events.pointerup({...start, clientX:start.clientX+180});
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent, '100%');
});

test('clicking the stage retries only after completion and leaves stage controls alone', () => {
  const game = setup();
  const clickStage = (button = false) => game.element('stage').events.click({
    target: { closest: () => button ? {} : null }
  });
  game.click('drop');
  clickStage();
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
  game.advance(20);
  assert.equal(game.element('stage')['data-finished'], 'true');
  clickStage(true);
  assert.equal(game.element('status').textContent, 'EXPERIMENT COMPLETE');
  clickStage();
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  assert.equal(game.element('result').hidden, true);
  assert.equal(game.element('stage')['data-finished'], 'false');
  assert.equal(game.element('score').textContent, '000000');
  assert.equal(game.element('replay').disabled, false);
});

test('holding the launch button starts charging on press and launches on first release', () => {
  const game = setup(), button = game.element('launch');
  const down = {button:0,pointerId:21,timeStamp:0,preventDefault(){}};
  button.events.pointerdown(down);
  assert.equal(game.element('status').textContent, 'CHARGING PUSH');
  game.advance(0.8);
  assert.equal(game.element('power-value').textContent, '100%');
  button.events.pointerup({...down,timeStamp:800});
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent, '100%');
  button.events.click({detail:1});
  game.advance(0.2);
  assert.ok(parseFloat(game.element('elapsed').textContent)>0);
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
});

test('two short mouse clicks still charge then launch, without duplicate actions', () => {
  const game = setup(), button = game.element('launch');
  const down = {button:0,pointerId:22,timeStamp:0,preventDefault(){}};
  button.events.pointerdown(down);
  button.events.pointerup({...down,timeStamp:70});
  button.events.click({detail:1});
  assert.equal(game.element('status').textContent, 'CHARGING PUSH');
  game.advance(0.8);
  button.events.pointerdown({...down,timeStamp:800});
  button.events.pointerup({...down,timeStamp:870});
  button.events.click({detail:1});
  assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
});

test('cancelled button hold resets charging and does not launch on its following click', () => {
  const game = setup(), button = game.element('launch');
  const down = {button:0,pointerId:23,timeStamp:0,preventDefault(){}};
  button.events.pointerdown(down);
  game.advance(0.8);
  button.events.pointercancel(down);
  button.events.click({detail:1});
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
});

test('dragging from empty stage space aims and launches the currently selected body part', () => {
  for (const start of [{clientX:400,clientY:350}, {clientX:40,clientY:40}, {clientX:800,clientY:600}]) {
    const game = setup();
    game.advance(0.1);
    game.element('part').value = 'leftKnee';
    const canvas = game.element('game');
    const down = {...start, button:0, pointerId:31, preventDefault(){}};
    canvas.events.pointerdown(down);
    assert.equal(game.element('status').textContent, 'DRAG TO AIM');
    assert.equal(game.element('part').value, 'leftKnee');
    const up = {...down,clientX:start.clientX+180,clientY:start.clientY-30};
    canvas.events.pointermove(up);
    assert.equal(game.element('power-value').textContent, '100%');
    assert.ok(Number(game.element('angle').value)>0);
    canvas.events.pointerup(up);
    assert.equal(game.element('status').textContent, 'DISMOUNT IN PROGRESS');
    assert.equal(game.element('part').value, 'leftKnee');
  }
});

test('a short click on empty stage space preserves selection without launching', () => {
  const game = setup();
  game.advance(0.1);
  game.element('part').value = 'head';
  const canvas = game.element('game');
  const event = {button:0,pointerId:32,clientX:500,clientY:400,preventDefault(){}};
  canvas.events.pointerdown(event);
  canvas.events.pointerup(event);
  assert.equal(game.element('status').textContent, 'READY TO DISMOUNT');
  assert.equal(game.element('part').value, 'head');
});

test('stage drag survives capture loss and release outside the canvas', () => {
  const game = setup(); game.advance(0.1);
  const canvas = game.element('game');
  const down = {button:0,pointerId:41,clientX:500,clientY:300,preventDefault(){}};
  const up = {...down,clientX:1000};
  canvas.events.pointerdown(down);
  game.windowEvents.pointermove(up);
  canvas.releasePointerCapture(41);
  assert.equal(game.element('status').textContent,'DRAG TO AIM');
  game.windowEvents.pointerup(up);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent,'100%');
  game.windowEvents.mouseup(up);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
});

test('mouse release fallback launches even if capture fails and pointerup is missing', () => {
  const game = setup(); game.advance(0.1);
  const canvas = game.element('game');
  canvas.setPointerCapture = () => { throw new Error('Capture unavailable'); };
  const down = {button:0,pointerId:42,clientX:500,clientY:300,preventDefault(){}};
  canvas.events.pointerdown(down);
  const up = {...down,clientX:700};
  game.windowEvents.pointermove(up);
  game.windowEvents.mouseup(up);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent,'100%');
});

test('holding anywhere on the stage charges power and release launches without movement', () => {
  const game = setup(); game.advance(0.1);
  const canvas = game.element('game');
  const down = {button:0,pointerId:43,clientX:500,clientY:300,preventDefault(){}};
  canvas.events.pointerdown(down);
  game.advance(0.8);
  assert.equal(game.element('power-value').textContent,'100%');
  game.windowEvents.pointerup(down);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
  assert.equal(game.element('power-value').textContent,'100%');
});

test('moving after holding switches to distance-based power without meter oscillation', () => {
  const game = setup(); game.advance(0.1);
  const canvas = game.element('game');
  const down = {button:0,pointerId:44,clientX:500,clientY:300,preventDefault(){}};
  canvas.events.pointerdown(down);
  game.advance(0.8);
  const moved = {...down,clientX:590};
  game.windowEvents.pointermove(moved);
  assert.equal(game.element('power-value').textContent,'50%');
  game.advance(0.8);
  assert.equal(game.element('power-value').textContent,'50%');
  game.windowEvents.pointerup(moved);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
});

test('audio-enabled falls synthesize varied impact layers, mute, and replay', () => {
  class TestAudio {
    constructor() {
      TestAudio.instance=this; this.currentTime=0; this.state='running';
      this.sampleRate=8000; this.destination={}; this.voices=0; this.filters=[]; this.buffers=0;
    }
    param() { return {value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}; }
    node() { return {connect(){},disconnect(){}}; }
    createGain() { return {...this.node(),gain:this.param()}; }
    createDynamicsCompressor() {
      return {...this.node(),threshold:this.param(),knee:this.param(),ratio:this.param(),attack:this.param(),release:this.param()};
    }
    createOscillator() {
      return {...this.node(),frequency:this.param(),start:()=>{this.voices++;},stop(){}};
    }
    createBiquadFilter() {
      const filter={...this.node(),frequency:this.param(),Q:this.param()};
      this.filters.push(filter); return filter;
    }
    createBuffer(channels,length) {
      this.buffers++; const samples=new Float32Array(length);
      return {getChannelData:()=>samples};
    }
    createBufferSource() {
      return {...this.node(),playbackRate:this.param(),start:()=>{this.voices++;},stop(){}};
    }
  }
  const game=setup(TestAudio);
  game.click('launch');game.advance(0.8);game.click('launch');game.advance(20);
  const audio=TestAudio.instance;
  assert.equal(game.element('status').textContent,'EXPERIMENT COMPLETE');
  assert.ok(audio.buffers>1,'Impacts should use multiple textures');
  assert.ok(audio.filters.some(filter=>filter.type==='lowpass'));
  assert.ok(audio.filters.some(filter=>filter.type==='highpass'));
  for(const state of ['suspended','interrupted']) {
    let resumes=0;audio.state=state;
    audio.resume=()=>{resumes++;audio.state='running';return Promise.resolve();};
    game.click('stage-sound');
    assert.equal(resumes,1,'Clicking sound resumes paused Safari audio instead of muting it');
    assert.equal(game.element('stage-sound')['aria-pressed'],'true');
  }

  game.click('sound');
  const before=audio.voices;
  game.click('replay');game.advance(20);
  assert.equal(audio.voices,before,'Muted replay must not create sound sources');
  game.click('sound');game.click('replay');game.advance(20);
  assert.ok(audio.voices>before,'Unmuted replay must play impacts');
  assert.ok(audio.buffers<=18,'Procedural textures must be cached');
  for(const id of ['robot','knight','skeleton','inflatable']) {
    const subject=setup(TestAudio,undefined,true,undefined,'https://example.com/?chamber=classic&character='+id);
    subject.click('launch');subject.advance(.8);subject.click('launch');subject.advance(20);
    const sound=TestAudio.instance;
    assert.equal(subject.element('status').textContent,'EXPERIMENT COMPLETE',id);
    assert.ok(sound.buffers>1,id+' creates impact textures');
    assert.ok(sound.filters.some(f=>f.type===(id==='inflatable'?'bandpass':'highpass')),id);
    const count=sound.voices;
    subject.click('sound');subject.click('replay');subject.advance(20);
    assert.equal(sound.voices,count,id+' muted replay');
    subject.click('sound');subject.click('replay');subject.advance(20);
    assert.ok(sound.voices>count,id+' audible replay');
  }
});

test('vertical mouse drag selects a 90-degree push', () => {
  const game = setup(); game.advance(0.1);
  const canvas = game.element('game');
  const down = {button:0,pointerId:51,clientX:500,clientY:400,preventDefault(){}};
  canvas.events.pointerdown(down);
  const up = {...down,clientY:220};
  canvas.events.pointermove(up);
  assert.equal(game.element('angle').value,'90');
  assert.equal(game.element('angle-value').textContent,'90°');
  canvas.events.pointerup(up);
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
});

test('initials save once and leaderboard replay survives reload', () => {
  const values=new Map(), storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const game=setup(undefined,storage);
  game.click('launch');game.advance(.6);game.click('launch');game.advance(20);
  const score=game.element('score').textContent;
  assert.equal(game.element('score-entry').hidden,false);
  game.element('stage').events.click({target:{closest:selector=>selector.includes('input')?{}:null}});
  assert.equal(game.element('result').hidden,false);
  game.element('initials').value='ab';
  const submit=()=>game.element('score-entry').events.submit({preventDefault(){}});
  submit();assert.match(game.element('save-message').textContent,/three letters/);
  game.element('initials').value='abc';game.element('initials').events.input();
  assert.equal(game.element('initials').value,'ABC');submit();submit();
  const key=require('../src/scores.js').KEY;
  assert.equal(JSON.parse(values.get(key)).entries.length,1);
  const reloaded=setup(undefined,storage);
  const button=reloaded.element('score-rows').children[0].children[3].children[0];
  reloaded.element('score-rows').events.click({target:{closest:()=>button}});
  assert.equal(reloaded.element('status').textContent,'PREPARING REPLAY');
  reloaded.advance(22);
  assert.equal(reloaded.element('score').textContent,score);
  assert.equal(reloaded.element('result-title').textContent,'Replay · ABC');
  assert.equal(reloaded.element('score-entry').hidden,true);
  assert.equal(JSON.parse(values.get(key)).entries.length,1);
  assert.equal(reloaded.element('replay').disabled,true);
});

test('used settings hide initials after unsaved retries and reloads, while cancelled runs remain eligible',()=>{
  class ShortSimulation extends physics.Simulation {step(){super.step();if(this.time>.8)this.active=false;}}
  const api={...physics,Simulation:ShortSimulation},values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const game=setup(undefined,storage,true,undefined,undefined,api);
  game.click('drop');game.advance(.2);game.click('reset');
  game.click('drop');game.advance(1);
  assert.equal(game.element('score-entry').hidden,false);
  game.click('retry');game.advance(1);
  assert.equal(game.element('result').hidden,false);assert.equal(game.element('result-badge-panel').hidden,false);
  assert.equal(game.element('score-entry').hidden,true);assert.match(game.element('save-message').textContent,/Settings already used/);
  game.element('initials').value='DUP';game.element('score-entry').events.submit({preventDefault(){}});
  assert.equal(values.has(require('../src/scores.js').KEY),false);
  const reload=setup(undefined,storage,true,undefined,undefined,api);
  reload.click('drop');reload.advance(1);assert.equal(reload.element('score-entry').hidden,true);
  reload.click('reset');reload.element('angle').value='15.25';reload.click('drop');reload.advance(1);
  assert.equal(reload.element('score-entry').hidden,false);
});

test('a validated QR marks its setup as used before a manual retry without adding a high score',()=>{
  class ShortSimulation extends physics.Simulation {step(){super.step();if(this.time>.8)this.active=false;}}
  const api={...physics,Simulation:ShortSimulation},values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const simulation=new ShortSimulation('classic'),push={part:'chest',angle:6.25,power:1};
  simulation.push(push.part,push.angle,push.power);let steps=0;
  while(simulation.active){simulation.step();steps++;}
  const end=simulation.snapshot(),entry={id:'used-qr',nick:'QRS',savedAt:0,engine:physics.REPLAY_VERSION,layout:'classic',character:'human',
    push,steps,score:end.score,hits:end.hits,time:end.time};
  const game=setup(undefined,storage,true,undefined,require('../src/badges.js').link(entry),api);game.advance(2);
  assert.equal(game.element('result-title').textContent,'Replay · QRS');
  assert.equal(values.has(require('../src/scores.js').KEY),false);
  game.click('retry');game.advance(1);
  assert.equal(game.element('score-entry').hidden,true);assert.match(game.element('save-message').textContent,/Settings already used/);
  assert.equal(game.element('result-badge-panel').hidden,false);
});

test('reset cancels saved replay preparation and unavailable versions cannot replay', () => {
  const {ScoreBoard,KEY}=require('../src/scores.js');
  const values=new Map(), storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const board=new ScoreBoard(storage,physics.REPLAY_VERSION);
  board.save('ABC',{score:100,hits:1,time:1,steps:120,push:{part:'chest',angle:0,power:1}});
  const game=setup(undefined,storage);
  const button=game.element('score-rows').children[0].children[3].children[0];
  game.element('score-rows').events.click({target:{closest:()=>button}});
  game.click('reset');game.advance(2);
  assert.equal(game.element('status').textContent,'READY TO DISMOUNT');
  const saved=JSON.parse(values.get(KEY));saved.entries[0].engine='old';values.set(KEY,JSON.stringify(saved));
  const old=setup(undefined,storage), unavailable=old.element('score-rows').children[0].children[3].children[0];
  assert.equal(unavailable.disabled,true);
  old.element('score-rows').events.click({target:{closest:()=>unavailable}});
  assert.equal(old.element('status').textContent,'READY TO DISMOUNT');
});

test('damage map reports body impacts and dislocations, replays them, and clears on reset',()=>{
  const game=setup();
  assert.equal(game.element('strongest-hit').textContent,'No impacts yet.');
  game.click('drop');game.advance(20);
  const strongest=game.element('strongest-hit').textContent;
  assert.match(strongest,/points/);
  const injuries=game.element('injury-list').textContent;
  assert.match(game.element('injuries').textContent,/\/ 15$/);
  const maps=['head','torso','abdomen','pelvis','leftHand','rightHand','leftFoot','rightFoot'];
  const colors=maps.map(name=>game.element('map-'+name).stroke);
  assert.ok(colors.some(color=>color!=='#cbd2c1'));
  game.click('replay');game.advance(20);
  assert.equal(game.element('strongest-hit').textContent,strongest);
  assert.equal(game.element('injury-list').textContent,injuries);
  assert.deepEqual(maps.map(name=>game.element('map-'+name).stroke),colors);
  game.click('reset');assert.equal(game.element('strongest-hit').textContent,'No impacts yet.');
  assert.equal(game.element('injury-list').textContent,'No dislocations.');
  assert.ok(maps.every(name=>game.element('map-'+name).stroke==='#cbd2c1'));
});

test('body inspector supports mouse, keyboard, and dropdown during replay',()=>{
  const game=setup();game.element('map-leftHand').events.click();
  assert.equal(game.element('body-detail-title').textContent,'Left hand');
  assert.match(game.element('body-detail-joints').textContent,/left wrist: intact/);
  game.element('map-rightFoot').events.keydown({code:'Enter',preventDefault(){},stopPropagation(){}});
  assert.equal(game.element('body-detail-title').textContent,'Right foot');
  assert.equal(game.element('map-rightFoot')['aria-pressed'],'true');
  game.element('inspect-part').value='abdomen';game.element('inspect-part').events.change();
  assert.match(game.element('body-detail-joints').textContent,/thoracic spine/);
  assert.match(game.element('body-detail-joints').textContent,/lumbar spine/);
  game.click('drop');game.advance(20);game.click('replay');
  game.element('map-head').events.click();game.advance(.1);
  assert.equal(game.element('body-detail-title').textContent,'Head');
  assert.match(game.element('body-detail-score').textContent,/points.*hits/);
});
test('motion tracks only after launch and can be disabled without changing physics',()=>{
  const animated=setup(undefined,undefined,false),still=setup();
  assert.equal(animated.element('motion')['aria-pressed'],'false');
  assert.equal(animated.element('motion').textContent,'MOTION FX OFF');
  animated.click('motion');
  animated.advance(.1);still.advance(.1);const origin=animated.camera(),zoom=animated.zoom();
  animated.click('launch');animated.advance(.7);
  assert.deepEqual(animated.camera(),origin);assert.equal(animated.zoom(),zoom);
  animated.click('launch');animated.advance(3);
  assert.ok(animated.zoom()>zoom);
  assert.notDeepEqual(animated.camera(),origin);
  still.click('launch');still.advance(.7);still.click('launch');still.advance(3);
  assert.ok(parseFloat(animated.element('elapsed').textContent)<parseFloat(still.element('elapsed').textContent),'Strong impacts should briefly slow playback');
  animated.advance(30);still.advance(30);
  assert.equal(animated.element('status').textContent,'EXPERIMENT COMPLETE');
  assert.equal(animated.element('score').textContent,still.element('score').textContent);
  animated.click('motion');assert.equal(animated.element('motion')['aria-pressed'],'false');
  assert.equal(still.element('motion')['aria-pressed'],'false');
});
test('night mode recolors every chamber and the report without moving the camera, including fullscreen',()=>{
  const game=setup(),ctx=game.element('game').getContext();let background;
  ctx.createLinearGradient=()=>({stops:[],addColorStop(offset,color){this.stops.push(color);}});
  ctx.fillRect=()=>{if(ctx.fillStyle?.stops)background=[...ctx.fillStyle.stops];};
  const appearance=game.host.DismountTheme.current;
  assert.equal(game.element('theme-toggle').textContent,'NIGHT: SYSTEM');
  for(const layout of Object.keys(physics.LAYOUTS)) {
    game.element('layout').value=layout;game.element('layout').events.change();
    appearance.setMode('light');game.advance(.12);
    const light=[...background],camera=[...game.camera()],zoom=game.zoom();
    appearance.setMode('dark');game.advance(.12);
    assert.notDeepEqual(background,light);assert.deepEqual(game.camera(),camera);assert.equal(game.zoom(),zoom);
    assert.equal(game.document.documentElement['data-theme'],'dark');
    assert.equal(game.element('map-head').fill,appearance.scene.intact);
    appearance.setMode('light');game.advance(.12);assert.deepEqual(background,light);
  }
  appearance.setMode('system');game.click('theme-toggle');game.advance(.12);
  assert.equal(game.element('theme-toggle').textContent,'NIGHT: ON');
  game.click('fullscreen');game.advance(.12);assert.equal(appearance.dark,true);
});

test('night preference survives reload and switching it during runs and paused replays preserves the result',()=>{
  class ShortSimulation extends physics.Simulation {step(){super.step();if(this.time>.8)this.active=false;}}
  const api={...physics,Simulation:ShortSimulation},data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  const game=setup(undefined,storage,true,undefined,undefined,api),plain=setup(undefined,undefined,true,undefined,undefined,api);
  game.click('drop');plain.click('drop');game.advance(.2);plain.advance(.2);
  game.click('theme-toggle');game.advance(1);plain.advance(1);
  for(const id of ['score','elapsed','hits'])assert.equal(game.element(id).textContent,plain.element(id).textContent);
  assert.equal(setup(undefined,storage).host.DismountTheme.current.dark,true);
  game.click('replay');game.element('replay-timeline').value='50';game.element('replay-timeline').events.input();game.advance(.12);
  const score=game.element('score').textContent,time=game.element('elapsed').textContent;
  game.click('theme-toggle');game.advance(.12);
  assert.equal(game.element('score').textContent,score);assert.equal(game.element('elapsed').textContent,time);
  assert.equal(Number(game.element('replay-timeline').value),50);
  game.click('reset');assert.equal(game.host.DismountTheme.current.mode,'light');
});

test('physics view defaults off, follows paused replay and never changes the run',()=>{
  class ShortSimulation extends physics.Simulation {
    step(){super.step();if(this.time>.8)this.active=false;}
  }
  const api={...physics,Simulation:ShortSimulation};
  const game=setup(undefined,undefined,true,undefined,undefined,api),plain=setup(undefined,undefined,true,undefined,undefined,api);
  const ctx=game.element('game').getContext(),clear=ctx.clearRect;let labels=[],centerStrokes=0;
  ctx.clearRect=(...args)=>{labels=[];centerStrokes=0;clear(...args);};
  ctx.fillText=text=>{labels.push(text);};
  ctx.stroke=()=>{if(ctx.strokeStyle==='#176c59')centerStrokes++;};
  const overlayLabels=()=>labels.filter(text=>/^(COM ·|v )| N$/.test(text));
  assert.equal(game.element('physics-view').textContent,'PHYSICS OFF');
  assert.equal(game.element('physics-view')['aria-pressed'],'false');
  assert.equal(game.element('physics-legend').hidden,true);
  game.advance(.1);assert.deepEqual(overlayLabels(),[]);
  game.click('physics-view');game.advance(.1);
  assert.equal(game.element('physics-view')['aria-pressed'],'true');
  assert.equal(game.element('physics-legend').hidden,false);
  assert.ok(centerStrokes>0);assert.ok(labels.includes('v 0.00 m/s'));
  assert.ok(!labels.some(text=>text.includes('COM')||text.endsWith(' kg')));
  game.click('drop');plain.click('drop');game.advance(1);plain.advance(1);
  for(const id of ['score','hits','elapsed'])assert.equal(game.element(id).textContent,plain.element(id).textContent);
  game.click('replay');
  const seek=index=>{game.element('replay-timeline').value=String(index);game.element('replay-timeline').events.input();game.advance(.12);};
  seek(55);const paused=overlayLabels();assert.ok(paused.length>=1);
  game.advance(.3);assert.deepEqual(overlayLabels(),paused);
  seek(0);assert.ok(labels.includes('v 0.00 m/s'));assert.ok(!labels.some(text=>/ N$/.test(text)));
  seek(55);assert.deepEqual(overlayLabels(),paused);
  game.click('physics-view');game.advance(.12);assert.deepEqual(overlayLabels(),[]);assert.equal(centerStrokes,0);
  game.click('reset');game.click('physics-view');game.advance(.12);
  assert.ok(labels.includes('v 0.00 m/s'));
  game.element('character').value='robot';game.element('character').events.change();game.advance(.12);
  assert.ok(centerStrokes>0);assert.ok(labels.includes('v 0.00 m/s'));
  game.click('fullscreen');game.advance(.12);assert.ok(centerStrokes>0);
  assert.equal(setup().element('physics-view')['aria-pressed'],'false','A new page always starts with physics view off');
});

test('layout boards and saved replays are isolated and survive reload',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  const game=setup(undefined,storage);
  game.element('layout').value='landing';game.element('layout').events.change();
  game.click('launch');game.advance(.6);game.click('launch');
  assert.equal(game.element('layout').disabled,true);
  game.advance(20);const score=game.element('score').textContent;
  game.element('initials').value='MAP';game.element('score-entry').events.submit({preventDefault(){}});
  assert.equal(game.element('score-rows').children.length,1);
  game.element('layout').value='classic';game.element('layout').events.change();
  assert.equal(game.element('score-rows').children.length,0);
  assert.equal(game.element('replay').disabled,true);
  const reload=setup(undefined,storage);reload.element('layout').value='landing';reload.element('layout').events.change();
  const button=reload.element('score-rows').children[0].children[3].children[0];
  reload.element('score-rows').events.click({target:{closest:()=>button}});reload.advance(23);
  assert.equal(reload.element('score').textContent,score);
  assert.equal(reload.element('result-title').textContent,'Replay · MAP');
  assert.match(reload.element('layout-caption').textContent,/SPLIT FLIGHT/);
});

test('recovery meters decrease with injury, follow selection and replay, and reset to full',()=>{
  const game=setup();
  assert.equal(game.element('recovery-overall-meter').value,100);
  assert.equal(game.element('recovery-part-meter').value,100);
  game.click('drop');let previous=100;
  for(let i=0;i<40;i++) {
    game.advance(.5);
    const value=game.element('recovery-overall-meter').value;
    assert.ok(value>=0&&value<=previous);previous=value;
  }
  assert.ok(previous<100);
  game.element('map-head').events.click();
  const part=game.element('recovery-part-meter').value;
  assert.ok(part>=0&&part<=100);
  assert.equal(game.element('recovery-part-value').textContent,part+'%');
  assert.equal(game.element('recovery-overall-meter').value,previous);
  game.click('replay');game.advance(20);
  assert.equal(game.element('recovery-overall-meter').value,previous);
  assert.equal(game.element('recovery-part-meter').value,part);
  game.click('reset');
  assert.equal(game.element('recovery-overall-meter').value,100);
  assert.equal(game.element('recovery-part-meter').value,100);
});

test('feet and neck can be selected on the dummy and their runs save and replay',()=>{
  const markup=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(markup,/<select id="part">[^]*?<option value="neck">Neck<\/option>/);
  for(const part of ['leftFoot','rightFoot','neck']) {
    const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
    const game=setup(undefined,storage);game.advance(.1);
    const p=new physics.Simulation().points.find(p=>p.name===part),[ox,oy]=game.camera(),scale=game.zoom();
    const event={button:0,pointerId:91,clientX:ox+p.x*scale,clientY:oy+p.y*scale,preventDefault(){}};
    game.element('game').events.pointerdown(event);
    assert.equal(game.element('part').value,part);
    game.element('game').events.pointerup(event);
    game.click('launch');game.advance(.4);game.click('launch');game.advance(20);
    const score=game.element('score').textContent;
    game.element('initials').value='FOO';game.element('score-entry').events.submit({preventDefault(){}});
    const saved=JSON.parse(data.get(require('../src/scores.js').KEY));assert.equal(saved.entries[0].push.part,part);
    const reloaded=setup(undefined,storage),button=reloaded.element('score-rows').children[0].children[3].children[0];
    reloaded.element('score-rows').events.click({target:{closest:()=>button}});reloaded.advance(23);
    assert.equal(reloaded.element('score').textContent,score);
    assert.equal(reloaded.element('result-title').textContent,'Replay · FOO');
    if(part==='neck') {
      reloaded.click('retry-edit');reloaded.advance(.1);
      assert.equal(reloaded.element('part').value,'neck');
      reloaded.click('preset-launch');reloaded.advance(20);
      assert.equal(reloaded.element('score').textContent,score);
    }
  }
});

test('mouse and touch aiming cover minus 100 through 100 degrees in quarter-degree steps',()=>{
  for(const [dx,dy,expected,pointerType='mouse'] of [
    [-60,-220,'100'],[-60,220,'-100'],[200,200,'-45'],
    [200,-200*Math.tan(6.18*Math.PI/180),'6.25'],
    [200,200*Math.tan(6.63*Math.PI/180),'-6.75','touch'],
    [200,-200*Math.tan(.49*Math.PI/180),'0.5','touch']
  ]) {
    const game=setup();game.advance(.1);
    const canvas=game.element('game'),down={button:0,pointerId:92,pointerType,clientX:500,clientY:400,preventDefault(){}};
    canvas.events.pointerdown(down);
    canvas.events.pointermove({...down,clientX:down.clientX+dx,clientY:down.clientY+dy});
    assert.equal(game.element('angle').value,expected);
    assert.equal(game.element('angle-value').textContent,expected+'°');
    canvas.events.pointerup({...down,clientX:down.clientX+dx,clientY:down.clientY+dy});
    assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
    assert.equal(game.element('power-value').textContent,'100%');
  }
});

test('shared badge URLs reconstruct exact current and historical runs without adding local records',()=>{
  const badges=require('../src/badges.js');
  for(const engine of [physics.REPLAY_VERSION,'rigid-3.0.0']) {
    const simulation=new physics.Simulation('classic','robot',engine),push={part:'chest',angle:6.25,power:.734567891234};
    simulation.push(push.part,push.angle,push.power);let steps=0;
    while(simulation.active&&steps<2165){simulation.step();steps++;}
    const end=simulation.snapshot(),entry={id:'share-test',savedAt:0,nick:'QRX',layout:'classic',character:'robot',engine,push,steps,score:end.score,hits:end.hits,time:end.time};
    const writes=[],storage={getItem:()=>null,setItem:(key,value)=>writes.push([key,value])};
    const url=new URL(badges.link(entry));
    if(engine==='rigid-3.0.0'){url.hash='replay='+url.searchParams.get('replay');url.searchParams.delete('replay');}
    const game=setup(undefined,storage,true,undefined,url.href);
    assert.equal(game.element('status').textContent,'PREPARING REPLAY');
    assert.equal(game.element('character').value,'robot');
    assert.equal(game.element('angle-value').textContent,'6.25°');
    for(let i=0;i<200&&game.element('status').textContent.startsWith('PREPARING');i++)game.advance(1/60);
    assert.equal(game.element('status').textContent,'REPLAYING EXPERIMENT');
    assert.equal(game.element('replay-toggle')['aria-pressed'],'true');
    game.advance(24);
    assert.equal(game.element('result-title').textContent,'Replay · QRX');
    assert.equal(Number(game.element('score').textContent),entry.score);
    assert.equal(game.element('score-entry').hidden,true);
    assert.ok(writes.length>0);assert.ok(writes.every(([key])=>key.startsWith(require('../src/scores.js').USED_PREFIX)));
    assert.equal(game.element('run-badge').disabled,false);
    game.click('retry-edit');assert.equal(game.element('angle').value,'6.25');
    game.click('preset-launch');assert.equal(new URL(game.url()).hash,'');
    assert.equal(new URL(game.url()).searchParams.has('replay'),false);
    assert.equal(game.element('run-badge').disabled,true);
  }
});

test('opening a QR in an existing tab closes dialogs, changes scenes and starts replay without another click',()=>{
  const badges=require('../src/badges.js'),{Recording}=require('../src/replay.js');
  const simulation=new physics.Simulation('shaft','skeleton'),recording=new Recording();recording.push(simulation.snapshot());
  const push={part:'head',angle:15.25,power:.723456789};simulation.push(push.part,push.angle,push.power);
  for(let i=0;i<120;i++){simulation.step();recording.push(simulation.snapshot());}
  const end=recording.at(-1),entry={id:'incoming',savedAt:0,nick:'URL',layout:'shaft',character:'skeleton',engine:physics.REPLAY_VERSION,
    push,steps:120,score:end.score,hits:end.hits,time:end.time};
  const game=setup(),workers=[];
  game.host.Worker=class {constructor(){workers.push(this);}postMessage(entry){this.entry=entry;}terminate(){this.terminated=true;}};
  game.click('launch');game.advance(.2);
  for(const id of ['welcome','badge-dialog']){const dialog=game.element(id);dialog.open=true;dialog.close=()=>{dialog.open=false;};}
  const url=new URL(badges.link(entry));url.hash='replay='+url.searchParams.get('replay');url.searchParams.delete('replay');
  game.host.location.href=url.href;game.windowEvents.hashchange();game.windowEvents.popstate();
  assert.equal(workers.length,1);assert.equal(game.element('status').textContent,'PREPARING REPLAY');
  assert.equal(game.element('layout').value,'shaft');assert.equal(game.element('character').value,'skeleton');
  assert.equal(game.element('welcome').open,false);assert.equal(game.element('badge-dialog').open,false);
  assert.equal(game.url(),url.href);assert.equal(game.element('angle-value').textContent,'15.25°');
  const next={...entry,nick:'NXT'};game.host.location.href=badges.link(next);game.windowEvents.popstate();
  assert.equal(workers.length,2);assert.equal(workers[0].terminated,true);
  workers[0].onmessage({data:{recording:recording.packet()}});
  assert.equal(game.element('status').textContent,'PREPARING REPLAY');
  workers[1].onmessage({data:{recording:recording.packet()}});
  assert.equal(game.element('status').textContent,'REPLAYING EXPERIMENT');
  game.advance(.3);assert.ok(Number(game.element('replay-timeline').value)>0);
  game.advance(1);assert.equal(game.element('result-title').textContent,'Replay · NXT');
  game.click('reset');game.element('layout').value='classic';game.element('layout').events.change();
  assert.equal(new URL(game.url()).searchParams.has('replay'),false);
});

test('shared links reject malformed recipes and mismatched results without awarding records',()=>{
  const badges=require('../src/badges.js');
  const invalid=setup(undefined,undefined,true,undefined,'https://example.com/?chamber=classic#replay=2~bad');
  assert.equal(invalid.element('status').textContent,'READY TO DISMOUNT');
  assert.match(invalid.element('board-message').textContent,/not supported/);
  const entry={id:'bad-score',savedAt:0,nick:'BAD',layout:'classic',character:'human',engine:physics.REPLAY_VERSION,
    push:{part:'chest',angle:.25,power:0},steps:1,score:999999,hits:0,time:physics.DT};
  const writes=[],storage={getItem:()=>null,setItem:(...args)=>writes.push(args)};
  const game=setup(undefined,storage,true,undefined,badges.link(entry));game.advance(.1);
  assert.equal(game.element('status').textContent,'READY TO DISMOUNT');
  assert.match(game.element('board-message').textContent,/cannot be reproduced/);
  assert.equal(game.element('run-badge').disabled,true);assert.deepEqual(writes,[]);
});

test('completed and saved runs show synchronized clickable badges in the result and next to replay',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const game=setup(undefined,storage);game.click('drop');game.advance(20);
  const badge=game.element('run-badge');assert.equal(badge.disabled,false);
  assert.equal(badge.children[0].src,'data:image/png;base64,test');
  const resultBadge=game.element('result-badge');
  assert.equal(game.element('result').hidden,false);assert.equal(game.element('result-badge-panel').hidden,false);
  assert.equal(resultBadge.disabled,false);assert.deepEqual(resultBadge.children[0].alt,badge.children[0].alt);
  let opened=0;game.element('badge-dialog').showModal=()=>opened++;
  await game.click('result-badge');
  game.element('stage').events.click({target:{closest:()=>resultBadge}});
  assert.equal(game.element('result').hidden,false);assert.equal(game.element('status').textContent,'EXPERIMENT COMPLETE');
  assert.equal(opened,1);assert.match(game.element('badge-status').textContent,/Download the PNG/);
  const badges=require('../src/badges.js'),before=badges.readLink(game.element('badge-link').value).entry;
  assert.equal(before.nick,'RUN');assert.equal(before.push.power,0);
  assert.equal(game.element('badge-download').download,'dismount-RUN-'+before.score+'.png');
  game.element('initials').value='NEW';game.element('score-entry').events.submit({preventDefault(){}});
  assert.match(resultBadge.children[0].alt,/NEW/);assert.equal(resultBadge.children[0].alt,badge.children[0].alt);
  const row=game.element('score-rows').children[0],savedBadge=row.children[3].children[1];
  assert.ok(savedBadge.getAttribute('data-badge-id'));
  game.click('replay');await game.click('run-badge');
  assert.equal(badges.readLink(game.element('badge-link').value).entry.nick,'NEW');
  assert.equal(game.element('result').hidden,true);game.advance(20);
  assert.equal(game.element('result').hidden,false);assert.equal(game.element('result-badge-panel').hidden,false);
  await game.click('result-badge');assert.equal(badges.readLink(game.element('badge-link').value).entry.nick,'NEW');
  game.click('reset');
  game.element('score-rows').events.click({target:{closest:()=>savedBadge}});await Promise.resolve();
  assert.equal(badges.readLink(game.element('badge-link').value).entry.nick,'NEW');
  game.click('reset');assert.equal(badge.disabled,false);
  game.element('layout').value='shaft';game.element('layout').events.change();assert.equal(badge.disabled,true);
  assert.equal(resultBadge.disabled,true);assert.equal(game.element('result-badge-panel').hidden,true);
});

test('additional chambers have separate boards and saved replays after reload',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  for(const layout of ['uneven','shaft','finalDrop']) {
    const game=setup(undefined,storage);game.element('layout').value=layout;game.element('layout').events.change();
    assert.equal(game.element('score-rows').children.length,0);
    if(layout==='shaft')assert.match(game.element('layout-caption').textContent,/5 LEDGES/);
    game.click('launch');game.advance(.6);game.click('launch');game.advance(20);
    const score=game.element('score').textContent;
    assert.equal(game.element('status').textContent,'EXPERIMENT COMPLETE');
    game.element('initials').value='NEW';game.element('score-entry').events.submit({preventDefault(){}});
    const reload=setup(undefined,storage);reload.element('layout').value=layout;reload.element('layout').events.change();
    const button=reload.element('score-rows').children[0].children[3].children[0];
    reload.element('score-rows').events.click({target:{closest:()=>button}});reload.advance(23);
    assert.equal(reload.element('score').textContent,score);
    assert.equal(reload.element('result-title').textContent,'Replay · NEW');
    reload.element('layout').value='classic';reload.element('layout').events.change();
    assert.equal(reload.element('score-rows').children.length,0);
  }
});

test('replay supports pause, exact frame steps, scrubbing, peak jump, speed, and restart',()=>{
  const game=setup();game.click('drop');game.advance(20);game.click('replay');
  assert.equal(game.element('replay-controls').hidden,false);
  game.advance(.2);game.click('replay-toggle');
  const paused=Number(game.element('replay-timeline').value);game.advance(.5);
  assert.equal(Number(game.element('replay-timeline').value),paused);
  game.click('replay-forward');assert.equal(Number(game.element('replay-timeline').value),paused+1);
  game.click('replay-back');assert.equal(Number(game.element('replay-timeline').value),paused);
  game.click('replay-peak');assert.ok(Number(game.element('replay-timeline').value)>0);
  assert.equal(game.element('impact-notice').hidden,false);
  assert.match(game.element('impact-notice').textContent,/EDGE|LANDING|BODY CONTACT|DISLOCATION/);
  game.element('replay-timeline').value='0';game.element('replay-timeline').events.input();
  assert.equal(game.element('score').textContent,'000000');assert.equal(game.element('impact-notice').hidden,true);
  assert.equal(game.element('replay-back').disabled,true);
  game.element('replay-speed').value='2';game.element('replay-speed').events.change();
  game.click('replay-toggle');game.advance(.25);
  assert.ok(Number(game.element('replay-timeline').value)>=58);
  game.element('replay-timeline').value=game.element('replay-timeline').max;game.element('replay-timeline').events.input();
  assert.equal(game.element('replay-forward').disabled,true);
  game.click('replay-toggle');game.advance(.1);
  assert.ok(Number(game.element('replay-timeline').value)<30);
  assert.equal(game.element('score-entry').hidden,true);
  game.click('reset');assert.equal(game.element('replay-controls').hidden,true);
});
test('retry and saved replay preserve quarter-degree angles and exact power, and tweak changes only edited settings',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const game=setup(undefined,storage);game.advance(.1);
  const down={button:0,pointerId:94,clientX:500,clientY:400,preventDefault(){}};
  game.element('game').events.pointerdown(down);
  game.element('game').events.pointerup({...down,clientX:630.3,clientY:362.3});game.advance(20);
  function save(nick){game.element('initials').value=nick;game.element('score-entry').events.submit({preventDefault(){}});return JSON.parse(values.get(require('../src/scores.js').KEY)).entries.find(e=>e.nick===nick);}
  const original=save('AAA');assert.equal(original.push.angle,16.25);game.click('retry');
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');game.advance(20);
  assert.equal(game.element('score-entry').hidden,true);assert.equal(save('BBB'),undefined);
  assert.equal(Number(game.element('score').textContent),original.score);
  assert.match(game.element('save-message').textContent,/Settings already used/);
  game.click('retry-edit');assert.equal(game.element('retry-settings').hidden,false);
  game.click('preset-launch');game.advance(20);
  assert.equal(game.element('score-entry').hidden,true);assert.equal(save('CCC'),undefined);
  assert.equal(Number(game.element('score').textContent),original.score);
  game.click('retry-edit');game.element('preset-power').value='42.5';game.element('preset-power').events.input();
  game.element('angle').value='-10.25';game.element('angle').events.input();
  assert.equal(game.element('angle-value').textContent,'-10.25°');
  game.element('part').value='leftFoot';game.click('preset-launch');game.advance(20);
  const edited=save('DDD');assert.deepEqual(edited.push,{part:'leftFoot',angle:-10.25,power:.425});
  const reloaded=setup(undefined,storage),row=reloaded.element('score-rows').children.find(row=>row.children[1].textContent==='AAA');
  const button=row.children[3].children[0];
  reloaded.element('score-rows').events.click({target:{closest:()=>button}});reloaded.advance(23);
  assert.equal(Number(reloaded.element('score').textContent),original.score);
  reloaded.click('retry-edit');assert.equal(reloaded.element('angle').value,'16.25');
  game.element('layout').value='shaft';game.element('layout').events.change();
  assert.equal(game.element('retry').disabled,true);
});
test('tweak preview restores the charged arrow and scales with the power slider',()=>{
  class FinishedSimulation extends physics.Simulation {
    step(){this.time+=physics.DT;this.active=false;}
  }
  const game=setup(undefined,undefined,true,undefined,undefined,{...physics,Simulation:FinishedSimulation});
  const ctx=game.element('game').getContext();let path=[],arrow;
  ctx.beginPath=()=>{path=[];};
  ctx.moveTo=(x,y)=>path.push([x,y]);ctx.lineTo=(x,y)=>path.push([x,y]);
  ctx.stroke=()=>{
    if(ctx.strokeStyle.startsWith('hsl(')&&path.length===2)
      arrow={length:Math.hypot(path[1][0]-path[0][0],path[1][1]-path[0][1]),color:ctx.strokeStyle};
  };
  game.click('launch');game.advance(.6);
  const charged={...arrow};
  game.click('launch');game.advance(.1);game.click('retry-edit');game.advance(.15);
  assert.equal(game.element('retry-settings').hidden,false);
  assert.deepEqual(arrow,charged,'Tweak should preview the same power as the original charge');
  const previews=[];
  for(const power of [0,25,75,100]) {
    game.element('preset-power').value=String(power);game.element('preset-power').events.input();game.advance(.15);
    previews.push({...arrow});
  }
  for(let i=1;i<previews.length;i++)assert.ok(previews[i].length>previews[i-1].length,'More power must produce a longer arrow');
  assert.equal(new Set(previews.map(p=>p.color)).size,4);
  game.element('angle').value='-100';game.element('angle').events.input();game.advance(.15);
  assert.ok(Math.abs(arrow.length-previews.at(-1).length)<1e-9,'Changing direction preserves power length');
  game.element('preset-power').value='0';game.element('preset-power').events.input();game.advance(.15);
  assert.ok(Math.abs(arrow.length-previews[0].length)<1e-9,'Reducing power shrinks the arrow again');
});

test('score breakdown includes progress but recovery depends only on injuries, including replay seeking',()=>{
  class ProgressSimulation extends physics.Simulation {
    step() {
      if(!this.active)return;
      this.time+=physics.DT;this.stats.steps++;
      this.impactScore=1000;this.damage.Torso=1000;this.bodyByName.torso.damage=1000;
      this.updateScore();if(this.stats.steps===60)this.active=false;
    }
  }
  const game=setup(undefined,undefined,true,undefined,undefined,{...physics,Simulation:ProgressSimulation});
  game.click('drop');game.advance(.1);
  const recovery=game.element('recovery-overall-meter').value;
  game.advance(1);
  assert.equal(game.element('score').textContent,'001200');
  assert.equal(game.element('score-breakdown').textContent,'DAMAGE 1,000 + PROGRESS 200');
  assert.equal(game.element('result-score-breakdown').textContent,'Damage 1,000 + Progress 200 = 1,200');
  assert.equal(game.element('recovery-overall-meter').value,recovery);
  game.click('replay');
  for(const [index,score] of [[10,1100],[60,1200],[10,1100]]) {
    game.element('replay-timeline').value=String(index);game.element('replay-timeline').events.input();
    assert.equal(Number(game.element('score').textContent),score);
    assert.equal(game.element('recovery-overall-meter').value,recovery);
  }
  game.click('reset');
  assert.equal(game.element('score-breakdown').textContent,'DAMAGE 0 + PROGRESS 0');
  assert.equal(game.element('recovery-overall-meter').value,100);
});
test('all chambers fit the initial dummy in narrow and desktop canvas viewports',()=>{
  for(const viewport of [{width:320,height:460},{width:900,height:700}]) {
    const game=setup(undefined,undefined,true,viewport);
    for(const layout of Object.keys(physics.LAYOUTS)) {
      game.element('layout').value=layout;game.element('layout').events.change();game.advance(.1);
      const [x,y]=game.camera(),scale=game.zoom();
      for(const segment of new physics.Simulation(layout).snapshot().segments) {
        for(const [px,py] of [[segment.ax,segment.ay],[segment.bx,segment.by]]) {
          assert.ok(x+(px-segment.radius)*scale>=0&&x+(px+segment.radius)*scale<=viewport.width,layout);
          assert.ok(y+(py-segment.radius)*scale>=0&&y+(py+segment.radius)*scale<viewport.height-60,layout);
        }
      }
    }
  }
});

test('impact notices classify contacts and dislocations without requiring motion effects',()=>{
  const game=setup(),notice=game.element('impact-notice'),messages=[];let text='';
  Object.defineProperty(notice,'textContent',{get:()=>text,set:value=>{text=value;messages.push(value);}});
  game.click('launch');game.advance(.6);game.click('launch');game.advance(20);
  assert.equal(game.element('motion')['aria-pressed'],'false');
  assert.ok(messages.some(m=>m.includes('EDGE')));
  assert.ok(messages.some(m=>m.includes('LANDING')));
  assert.ok(messages.some(m=>m.includes('DISLOCATION')));
  game.click('reset');assert.equal(notice.hidden,true);
});

test('endless stairs stay visible until outside the camera and retain their tread colors',()=>{
  for(const viewport of [{width:900,height:700},{width:1600,height:500},{width:390,height:844}]) {
    let offset=0;
    class PosedSimulation extends physics.Simulation {
      step() {} // Exercise camera tracking independently of collision trajectories.
      snapshot() {
        const frame=super.snapshot();
        for(const point of frame.points){point.x+=offset*48;point.y+=offset*31;}
        for(const segment of frame.segments) {
          segment.ax+=offset*48;segment.bx+=offset*48;
          segment.ay+=offset*31;segment.by+=offset*31;
        }
        return frame;
      }
    }
    const game=setup(undefined,undefined,true,viewport,'https://example.com/?chamber=endless',{...physics,Simulation:PosedSimulation});
    const ctx=game.element('game').getContext(),clear=ctx.clearRect;
    let path=[],treads=[];const labels=[];
    ctx.fillText=text=>labels.push(text);
    ctx.clearRect=(...args)=>{treads=[];clear(...args);};
    ctx.beginPath=()=>{path=[];};
    ctx.moveTo=ctx.lineTo=(x,y)=>path.push([x,y]);
    ctx.fill=()=>{
      if(path.length===4&&path[1][0]===path[0][0]+48&&path[1][1]===path[0][1])treads.push({path:[...path],color:ctx.fillStyle});
    };
    game.click('drop');
    for(const perspective of [true,false]) {
      if(!perspective)game.click('view');
      for(const position of [0,20,21,50,100,10]) {
        offset=position;game.advance(.4);
        const [ox,oy]=game.camera(),scale=game.zoom(),dx=perspective?115:0,dy=perspective?-68:0;
        const drawn=new Map(treads.map(t=>[(t.path[0][0]-220)/48,t]));
        let visible=0;
        for(let index=0;220+index*48<=(viewport.width-ox)/scale;index++) {
          const x=220+index*48,y=205+(index+1)*31;
          if((x+48+dx)*scale+ox<0||y*scale+oy<0||(y+dy)*scale+oy>viewport.height)continue;
          visible++;
          assert.ok(drawn.has(index),`Missing visible step ${index} at ${viewport.width}px, position ${position}`);
        }
        assert.ok(visible>0,'The test camera sees the staircase');
        for(const [index,tread] of drawn)assert.equal(tread.color,endlessFx.palette(index+1)[index%2?'odd':'even'],'A step retains its color as the render window shifts');
        assert.ok(treads.length<100,'Draw only a bounded window, even far down the stairs');
      }
    }
    assert.ok(labels.includes('50 STEPS ↓'),'The 50-step milestone is painted on the stairs');
  }
});

test('endless milestone HUD, records and messages reset and follow replay without saving again',()=>{
  class MilestoneSimulation extends physics.Simulation {
    step() {
      if(!this.active)return;
      this.time+=physics.DT;this.stats.steps++;
      if(this.stats.steps>=105)this.active=false;
    }
  }
  const values=new Map(),writes=[];
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>{values.set(key,value);writes.push([key,value]);}};
  const api={...physics,Simulation:MilestoneSimulation};
  const game=setup(undefined,storage,true,undefined,'https://example.com/?chamber=endless',api);
  assert.equal(game.element('endless-progress').hidden,false);
  assert.equal(game.element('endless-next').textContent,'NEXT 50 · BEST 0');
  game.click('drop');game.advance(.47);
  assert.equal(game.element('endless-milestone').hidden,false);
  assert.equal(game.element('endless-milestone-title').textContent,'NEW DEPTH RECORD · 50 STEPS');
  assert.match(game.element('endless-next').textContent,/NEXT 100/);
  const joke=game.element('endless-milestone-joke').textContent;
  game.advance(.1);assert.equal(game.element('endless-milestone-joke').textContent,joke);
  game.advance(.3);
  assert.equal(game.element('endless-milestone-title').textContent,'NEW DEPTH RECORD · 100 STEPS');
  game.advance(.2);
  assert.equal(game.element('status').textContent,'EXPERIMENT COMPLETE');
  assert.equal(values.get(endlessFx.KEY+'human'),'105');
  game.click('reset');
  assert.equal(game.element('endless-depth').textContent,'0 STEPS ↓');
  assert.equal(game.element('endless-next').textContent,'NEXT 50 · BEST 105');
  assert.equal(game.element('endless-milestone').hidden,true);
  const writesBefore=writes.length;
  game.click('replay');game.advance(.47);
  assert.equal(game.element('endless-milestone-title').textContent,'MILESTONE · 50 STEPS');
  game.element('replay-timeline').value='0';game.element('replay-timeline').events.input();
  assert.equal(game.element('endless-milestone').hidden,true);
  assert.equal(game.element('endless-depth').textContent,'0 STEPS ↓');
  game.element('replay-timeline').value='100';game.element('replay-timeline').events.input();game.advance(.1);
  assert.equal(game.element('endless-depth').textContent,'100 STEPS ↓');
  assert.match(game.element('endless-zone').textContent,/SUBLEVEL 03/);
  assert.equal(game.element('endless-milestone').hidden,true,'Seeking does not announce stale milestones');
  assert.equal(writes.length,writesBefore,'Replay never updates depth records');
  game.click('reset');game.element('layout').value='classic';game.element('layout').events.change();
  assert.equal(game.element('endless-progress').hidden,true);
  const reloaded=setup(undefined,storage,true,undefined,'https://example.com/?chamber=endless');
  assert.equal(reloaded.element('endless-next').textContent,'NEXT 50 · BEST 105');
});

test('endless announcements expire without repeating, and page exit saves intermediate depth',()=>{
  class MilestoneSimulation extends physics.Simulation {
    step(){if(this.active){this.time+=physics.DT;this.stats.steps=Math.min(51,this.stats.steps+1);}}
  }
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const game=setup(undefined,storage,true,undefined,'https://example.com/?chamber=endless',{...physics,Simulation:MilestoneSimulation});
  game.click('drop');game.advance(.5);
  assert.equal(game.element('endless-milestone').hidden,false);
  assert.equal(values.get(endlessFx.KEY+'human'),'50');
  game.advance(4.2);assert.equal(game.element('endless-milestone').hidden,true);
  game.windowEvents.pagehide();assert.equal(values.get(endlessFx.KEY+'human'),'51');
  game.click('reset');assert.equal(game.element('endless-milestone').hidden,true);
});

test('endless chamber runs, saves and replays on its own board',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const game=setup(undefined,storage);
  game.element('layout').value='endless';game.element('layout').events.change();
  assert.match(game.element('layout-caption').textContent,/ENDLESS/);
  game.click('launch');game.advance(.6);game.click('launch');game.advance(125);
  assert.equal(game.element('status').textContent,'EXPERIMENT COMPLETE');
  const score=game.element('score').textContent;
  game.element('initials').value='END';game.element('score-entry').events.submit({preventDefault(){}});
  const entries=JSON.parse(values.get(require('../src/scores.js').KEY+'-endless')).entries;
  assert.equal(entries[0].layout,'endless');
  game.click('replay');game.advance(125);
  assert.equal(game.element('score').textContent,score);
});

test('run statistics follow replay seeking and reset',()=>{
  const game=setup(),ids=['stat-steps','stat-distance','stat-speed','stat-airtime'];
  const read=()=>ids.map(id=>game.element(id).textContent);
  const initial=read();game.click('launch');game.advance(.6);game.click('launch');game.advance(20);
  const completed=read();assert.ok(parseFloat(completed[1])>0);assert.ok(parseFloat(completed[2])>0);
  game.click('replay');game.click('replay-toggle');
  game.element('replay-timeline').value='0';game.element('replay-timeline').events.input();
  assert.deepEqual(read(),initial);
  game.element('replay-timeline').value=game.element('replay-timeline').max;
  game.element('replay-timeline').events.input();assert.deepEqual(read(),completed);
  game.click('reset');assert.deepEqual(read(),initial);
});

test('fullscreen falls back to a full-window view and restores scrolling and focus access',async()=>{
  const game=setup();
  assert.equal(game.element('fullscreen').disabled,false);
  await game.click('fullscreen');
  assert.equal(game.element('game-panel')['data-expanded'],'true');
  assert.equal(game.document.body.style.position,'fixed');
  assert.equal(game.element('page-header').inert,true);
  assert.equal(game.element('fullscreen').textContent,'EXIT FULLSCREEN');
  game.documentEvents.keydown({key:'Escape',target:{tagName:'BUTTON'},preventDefault(){}});
  assert.equal(game.element('game-panel')['data-expanded'],'false');
  assert.equal(game.document.body.style.position,'');
  assert.deepEqual(game.restoredScroll(),[0,120]);
  assert.equal(game.element('page-header').inert,undefined);
  assert.equal(game.element('fullscreen')['aria-pressed'],'false');
  game.element('game-panel').requestFullscreen=()=>Promise.reject(new Error('Denied'));
  await game.click('fullscreen');assert.equal(game.element('game-panel')['data-expanded'],'true');
  await game.click('fullscreen');assert.equal(game.element('game-panel')['data-expanded'],'false');
});

test('native fullscreen toggles and browser exit updates the button',async()=>{
  const game=setup(),panel=game.element('game-panel');
  panel.requestFullscreen=async()=>{game.document.fullscreenElement=panel;game.documentEvents.fullscreenchange();};
  game.document.exitFullscreen=async()=>{game.document.fullscreenElement=null;game.documentEvents.fullscreenchange();};
  await game.click('fullscreen');assert.equal(game.element('fullscreen')['aria-pressed'],'true');
  assert.notEqual(panel['data-expanded'],'true');
  await game.click('fullscreen');assert.equal(game.element('fullscreen')['aria-pressed'],'false');
  await game.click('fullscreen');await game.document.exitFullscreen();
  assert.equal(game.element('fullscreen').textContent,'FULLSCREEN');
});

test('touch aiming reaches full power on a narrow stage and ignores secondary fingers',()=>{
  const game=setup(undefined,undefined,true,{width:320,height:460});game.advance(.1);
  const canvas=game.element('game');
  const finger={button:0,pointerType:'touch',pointerId:1,isPrimary:true,clientX:10,clientY:300,preventDefault(){}};
  canvas.events.pointerdown({...finger,isPrimary:false});
  assert.equal(game.element('status').textContent,'READY TO DISMOUNT');
  canvas.events.pointerdown(finger);
  canvas.events.pointermove({...finger,clientX:138});
  assert.equal(game.element('power-value').textContent,'100%');
  game.windowEvents.pointerup({...finger,clientX:138});
  assert.equal(game.element('launch').disabled,true);
  game.click('reset');canvas.events.pointerdown(finger);game.windowEvents.resize();
  assert.equal(game.element('status').textContent,'READY TO DISMOUNT');
  assert.equal(canvas.capturedPointer,null);
});

test('startup defaults to Endless Stairs while preserving explicit chamber and character links',()=>{
  for(const url of [null,'https://example.com/','https://example.com/?chamber=unknown','https://example.com/?character=robot']) {
    const game=setup(undefined,undefined,true,undefined,url);
    assert.equal(game.element('layout').value,'endless');
    assert.equal(game.element('welcome-layout').value,'endless');
    assert.equal(game.element('chamber-number').textContent,'TEST CHAMBER / 07');
    assert.match(game.element('welcome-chamber-description').textContent,/Continuously generated stairs/);
    assert.equal(game.element('motion').disabled,true);
    assert.equal(game.element('character').value,url?.includes('character=robot')?'robot':'human');
  }
  const classic=setup(undefined,undefined,true,undefined,'https://example.com/?chamber=classic');
  assert.equal(classic.element('layout').value,'classic');
});

test('chamber links initialize the selected layout and preserve other URL components',()=>{
  const game=setup(undefined,undefined,true,undefined,'https://milekz.github.io/dismount/?chamber=endless&source=share#game');
  assert.equal(game.element('layout').value,'endless');
  assert.equal(game.element('welcome-layout').value,'endless');
  assert.match(game.element('layout-caption').textContent,/ENDLESS/);
  assert.equal(game.element('highscores-title').textContent,'High scores · Endless Stairs');
  assert.equal(game.element('motion').disabled,true);
  game.element('layout').value='shaft';game.element('layout').events.change();
  const url=new URL(game.url());
  assert.equal(url.searchParams.get('chamber'),'shaft');
  assert.equal(url.searchParams.get('source'),'share');assert.equal(url.hash,'#game');
  const invalid=setup(undefined,undefined,true,undefined,'https://milekz.github.io/dismount/?chamber=unknown');
  assert.equal(invalid.element('layout').value,'endless');
});


test('numeric chamber links follow selector order and accept padded numbers',()=>{
  const layouts=['classic','steep','long','landing','uneven','shaft','endless','finalDrop'];
  layouts.forEach((layout,index)=>{
    const game=setup(undefined,undefined,true,undefined,'https://example.com/?chamber='+(index+1));
    assert.equal(game.element('layout').value,layout);
    assert.equal(game.element('chamber-number').textContent,'TEST CHAMBER / '+String(index+1).padStart(2,'0'));
  });
  const padded=setup(undefined,undefined,true,undefined,'https://example.com/?chamber=07');
  assert.equal(padded.element('layout').value,'endless');
  for(const invalid of ['0','9','-1','1.5','1e0']) {
    const game=setup(undefined,undefined,true,undefined,'https://example.com/?chamber='+invalid);
    assert.equal(game.element('layout').value,'endless');
  }
});

test('character selection and URL keep human as default and render all four alternatives',()=>{
  const game=setup(undefined,undefined,true,undefined,'https://example.com/?chamber=7');
  assert.equal(game.element('character').value,'human');
  assert.equal(game.element('welcome-character').value,'human');
  for(const id of ['robot','knight','skeleton','inflatable']) {
    game.element('character').value=id;game.element('character').events.change();game.advance(.1);
    assert.equal(new URL(game.url()).searchParams.get('character'),id);
    assert.match(game.element('highscores-title').textContent,new RegExp(physics.CHARACTERS[id].name));
    assert.equal(game.element('character-description').textContent,physics.CHARACTERS[id].description);
  }
  game.element('character').value='human';game.element('character').events.change();
  assert.equal(new URL(game.url()).searchParams.has('character'),false);
  const linked=setup(undefined,undefined,true,undefined,'https://example.com/?chamber=7&character=robot');
  assert.equal(linked.element('layout').value,'endless');assert.equal(linked.element('character').value,'robot');
  assert.equal(linked.element('welcome-character').value,'robot');linked.advance(.1);
  const removed=setup(undefined,undefined,true,undefined,'https://example.com/?character=teddy');
  assert.equal(removed.element('character').value,'human');
  assert.ok(!Object.hasOwn(physics.CHARACTERS,'teddy'));
  const bad=setup(undefined,undefined,true,undefined,'https://example.com/?character=unknown');
  assert.equal(bad.element('character').value,'human');
});

test('robot records, exact retry and saved replays retain their character',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const game=setup(undefined,storage,true,undefined,'https://example.com/?chamber=1&character=robot');
  game.click('launch');game.advance(.6);game.click('launch');
  assert.equal(game.element('character').disabled,true);game.advance(20);
  const score=game.element('score').textContent;
  game.element('initials').value='ROB';game.element('score-entry').events.submit({preventDefault(){}});
  const key=require('../src/scores.js').KEY+'-character-robot';
  assert.equal(JSON.parse(values.get(key)).entries[0].character,'robot');
  game.click('retry');game.advance(20);assert.equal(game.element('score').textContent,score);
  const reload=setup(undefined,storage,true,undefined,'https://example.com/?chamber=1&character=robot');
  const button=reload.element('score-rows').children[0].children[3].children[0];
  reload.element('score-rows').events.click({target:{closest:()=>button}});reload.advance(22);
  assert.equal(reload.element('score').textContent,score);
  assert.equal(reload.element('result-title').textContent,'Replay · ROB');
  reload.element('character').value='human';reload.element('character').events.change();
  assert.equal(reload.element('board-empty').hidden,false);
});

test('fullscreen settings reuse controls, and Escape closes the drawer first',async()=>{
  const g=setup();await g.click('fullscreen');
  assert.equal(g.element('settings-toggle').hidden,false);
  assert.ok(g.element('drawer-body').children.includes(g.element('push-controls')));
  g.click('settings-toggle');assert.equal(g.element('settings-drawer').hidden,false);
  g.documentEvents.keydown({key:'Escape',preventDefault(){},target:{tagName:'BUTTON'}});
  assert.equal(g.element('settings-drawer').hidden,true);
  assert.equal(g.element('game-panel')['data-expanded'],'true');
  await g.click('fullscreen');assert.ok(g.element('control-home').children.includes(g.element('push-controls')));
});

test('subject reports, volume persistence, challenge state, ghost and replay scrolling',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const g=setup(undefined,storage);
  g.element('character').value='inflatable';g.element('character').events.change();
  assert.equal(g.element('damage-map-heading').textContent,'Tube damage map');
  assert.equal(g.element('recovery-overall-caption').textContent,'Air retention');
  g.element('volume').value='25';g.element('volume').events.input();assert.equal(values.get('dismount-volume'),'0.25');
  g.element('character').value='human';g.element('character').events.change();
  g.element('challenge').value='gentle';g.element('challenge').events.change();
  g.click('drop');assert.equal(g.element('challenge').disabled,true);g.advance(20);
  assert.equal(g.element('challenge-status').hidden,false);
  assert.equal(g.element('ghost').disabled,false);g.click('ghost');
  assert.equal(g.element('ghost')['aria-pressed'],'true');
  g.click('replay');assert.equal(g.scrollRequests.at(-1).id,'game-panel');
  assert.equal(g.scrollRequests.at(-1).options.behavior,'auto');
  g.click('stage-reset');g.element('layout').value='shaft';g.element('layout').events.change();
  assert.equal(g.element('ghost').disabled,true);
});

test('saved replay worker is cancelled on reset, ignores stale replies and caches valid recordings',()=>{
  const {Recording}=require('../src/replay.js');
  const sim=new physics.Simulation(),frames=new Recording();frames.push(sim.snapshot());sim.push('chest',15,.8);
  while(sim.active){sim.step();const f=sim.snapshot();f.impacts=sim.impacts;frames.push(f);}
  const end=frames.at(-1),entry={id:'worker-test',nick:'CPU',score:end.score,hits:end.hits,time:end.time,steps:frames.length-1,layout:'classic',character:'human',engine:physics.REPLAY_VERSION,savedAt:1,push:{part:'chest',angle:15,power:.8}};
  const storage={getItem:k=>k===require('../src/scores.js').KEY?JSON.stringify({version:1,entries:[entry]}):null,setItem(){}};
  const g=setup(undefined,storage,true,undefined,'https://example.com/?chamber=1');const workers=[];
  g.host.Worker=class{constructor(){workers.push(this);}postMessage(e){this.entry=e;}terminate(){this.stopped=true;}};
  const button={getAttribute:()=>entry.id},replay=()=>g.element('score-rows').events.click({target:{closest:()=>button}});
  replay();assert.equal(workers.length,1);assert.ok(g.scrollRequests.length);
  g.click('stage-reset');assert.equal(workers[0].stopped,true);
  workers[0].onmessage({data:{recording:frames.packet()}});assert.equal(g.element('status').textContent,'READY TO DISMOUNT');
  replay();workers[1].onmessage({data:{recording:frames.packet()}});
  assert.equal(g.element('status').textContent,'REPLAYING EXPERIMENT');g.click('stage-reset');replay();
  assert.equal(workers.length,2,'second playback uses cached recording');
  assert.equal(g.element('status').textContent,'REPLAYING EXPERIMENT');
});

test('previous records remain replayable in the archive without setting new personal bests',()=>{
  const {PREVIOUS_KEY,USED_PREFIX}=require('../src/scores.js');
  for(const character of ['human','robot']) {
    const s=new physics.Simulation('classic',character,'rigid-2.3.0');s.push('chest',6,1);
    for(let i=0;i<120;i++)s.step();
    const entry={id:'archive-'+character,nick:'OLD',score:s.score,hits:s.hits,time:s.time,steps:120,
      layout:'classic',character,engine:'rigid-2.3.0',savedAt:1,push:{part:'chest',angle:6,power:1}};
    const key=PREVIOUS_KEY+(character==='human'?'':'-character-'+character);
    const values=new Map([[key,JSON.stringify({version:1,entries:[entry]})]]);
    const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
    const g=setup(undefined,storage,true,undefined,'https://example.com/?chamber=1&character='+character);
    assert.equal(g.element('previous-scores').hidden,false);
    assert.equal(g.element('score-rows').children.length,0);
    assert.equal(g.element('best').textContent,'0');
    const button=g.element('previous-score-rows').children[0].children[3].children[0];
    assert.equal(button.disabled,false);
    g.element('previous-score-rows').events.click({target:{closest:()=>button}});
    assert.equal(g.element('status').textContent,'PREPARING REPLAY');g.advance(10);
    assert.equal(g.element('status').textContent,'EXPERIMENT COMPLETE');
    assert.equal(Number(g.element('score').textContent.replace(/,/g,'')),entry.score);
    assert.equal(g.element('retry').disabled,true);
    assert.equal(g.element('best').textContent,'0');
    assert.deepEqual([...values.keys()].filter(k=>!k.startsWith(USED_PREFIX)),[key],'watching an archive must not write current records');
    assert.deepEqual(JSON.parse(values.get(key)).entries,[entry]);
    g.click('stage-reset');g.element('character').value='knight';g.element('character').events.change();
    assert.equal(g.element('previous-scores').hidden,true);
  }
});
