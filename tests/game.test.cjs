// Exercise browser-facing state transitions with a minimal DOM/Canvas adapter.
// Actual layout, audio output, and browser integration require visual checking.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const physics = require('../src/physics.js');

function setup(AudioContext, storage, reducedMotion=true, viewport={width:900,height:700}) {
  const elements = new Map();
  let translations=[],scales=[];
  const context2d = new Proxy({}, { get: (_, key) => key === 'clearRect' ? () => {translations=[];scales=[];} : key === 'translate' ? (...args)=>translations.push(args) : key === 'scale' ? (...args)=>scales.push(args) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'angle' ? '15' : id === 'part' ? 'chest' : '', style: {}, disabled: false,
      events: {}, options: ['head', 'chest', 'hip', 'leftKnee', 'rightKnee', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'].map(value => ({ value })), tagName: 'DIV',
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
      getContext() { return context2d; }
    });
    return elements.get(id);
  }
  let nextFrame, time = 0;
  const windowEvents = {}, documentEvents = {};
  let restoredScroll=null;
  let serial=0;
  const document = { body:{style:{position:'',top:'',width:'',overflow:''}},
    querySelectorAll:()=>[element('page-header'),element('outside-controls')],
    getElementById: element, createElement: () => element('row-'+serial++),
    addEventListener(type,handler) {
      const previous=documentEvents[type];
      documentEvents[type]=event=>{previous?.(event);handler(event);};
    } };
  const sandbox = { window: { scrollX:0,scrollY:120,scrollTo:(x,y)=>{restoredScroll=[x,y];},matchMedia:()=>({matches:reducedMotion}), AudioContext, DismountPhysics: physics, DismountScores: require('../src/scores.js'), addEventListener(type, callback) { windowEvents[type] = callback; } }, document, devicePixelRatio: 1,
    localStorage: storage || { getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); } },
    ResizeObserver: class { observe() {} }, requestAnimationFrame(callback) { nextFrame = callback; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/game.js'), 'utf8'), sandbox);
  return { element, windowEvents, document, documentEvents, restoredScroll:()=>restoredScroll, camera:()=>translations[0], zoom:()=>scales[0]?.[0], click: id => element(id).events.click(), advance(seconds) {
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
  animated.click('launch');animated.advance(.3);
  assert.deepEqual(animated.camera(),origin);assert.equal(animated.zoom(),zoom);
  animated.click('launch');animated.advance(3);
  assert.ok(animated.zoom()>zoom);
  assert.notDeepEqual(animated.camera(),origin);
  still.click('launch');still.advance(.3);still.click('launch');still.advance(3);
  assert.ok(parseFloat(animated.element('elapsed').textContent)<parseFloat(still.element('elapsed').textContent),'Strong impacts should briefly slow playback');
  animated.advance(30);still.advance(30);
  assert.equal(animated.element('status').textContent,'EXPERIMENT COMPLETE');
  assert.equal(animated.element('score').textContent,still.element('score').textContent);
  animated.click('motion');assert.equal(animated.element('motion')['aria-pressed'],'false');
  assert.equal(still.element('motion')['aria-pressed'],'false');
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

test('both feet can be selected on the dummy and foot runs save and replay',()=>{
  for(const part of ['leftFoot','rightFoot']) {
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
  }
});

test('mouse aiming covers minus 100 through 100 degrees',()=>{
  for(const [dx,dy,expected] of [[-60,-220,'100'],[-60,220,'-100'],[200,200,'-45']]) {
    const game=setup();game.advance(.1);
    const canvas=game.element('game'),down={button:0,pointerId:92,clientX:500,clientY:400,preventDefault(){}};
    canvas.events.pointerdown(down);
    canvas.events.pointermove({...down,clientX:down.clientX+dx,clientY:down.clientY+dy});
    assert.equal(game.element('angle').value,expected);
    canvas.events.pointerup({...down,clientX:down.clientX+dx,clientY:down.clientY+dy});
    assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');
    assert.equal(game.element('power-value').textContent,'100%');
  }
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
test('retry preserves exact push power, and tweak changes only edited settings',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const game=setup(undefined,storage);game.advance(.1);
  const down={button:0,pointerId:94,clientX:500,clientY:400,preventDefault(){}};
  game.element('game').events.pointerdown(down);
  game.element('game').events.pointerup({...down,clientX:630.3,clientY:362.3});game.advance(20);
  function save(nick){game.element('initials').value=nick;game.element('score-entry').events.submit({preventDefault(){}});return JSON.parse(values.get(require('../src/scores.js').KEY)).entries.find(e=>e.nick===nick);}
  const original=save('AAA');game.click('retry');
  assert.equal(game.element('status').textContent,'DISMOUNT IN PROGRESS');game.advance(20);
  const exact=save('BBB');assert.deepEqual(exact.push,original.push);assert.equal(exact.score,original.score);
  game.click('retry-edit');assert.equal(game.element('retry-settings').hidden,false);
  game.click('preset-launch');game.advance(20);
  const unedited=save('CCC');assert.deepEqual(unedited.push,original.push);assert.equal(unedited.score,original.score);
  game.click('retry-edit');game.element('preset-power').value='42.5';game.element('preset-power').events.input();
  game.element('angle').value='-10';game.element('part').value='leftFoot';game.click('preset-launch');game.advance(20);
  const edited=save('DDD');assert.deepEqual(edited.push,{part:'leftFoot',angle:-10,power:.425});
  game.element('layout').value='shaft';game.element('layout').events.change();
  assert.equal(game.element('retry').disabled,true);
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
