const test=require('node:test');
const assert=require('node:assert/strict');
const {Simulation,supportsReplay}=require('../src/physics.js');
const {Recording,validEnd}=require('../src/replay.js');
const {evaluate}=require('../src/challenges.js');

test('compact recording retains exact frames, events and random access after transfer',()=>{
  const sim=new Simulation(),recording=new Recording(),expected=[];
  sim.push('head',45,1);
  for(let i=0;i<300;i++) {
    sim.step();const frame=sim.snapshot();frame.impacts=sim.impacts.map(h=>({...h}));
    expected.push(frame);recording.push(frame);
  }
  const clone=Recording.from(structuredClone(recording.packet()));
  for(const index of [0,1,127,128,256,299,45,0])assert.deepEqual(clone.at(index),expected[index]);
  assert.deepEqual(clone.at(-1),expected.at(-1));assert.equal(clone.at(300),undefined);
  assert.ok(recording.byteLength<Buffer.byteLength(JSON.stringify(expected))*.5,'numeric storage should at least halve the JSON footprint');
  assert.equal(validEnd(clone,expected.at(-1)),true);
  assert.equal(validEnd(clone,{...expected.at(-1),score:-1}),false);
});

test('legacy human replays remain compatible but obsolete character materials do not',()=>{
  assert.equal(supportsReplay({engine:'rigid-2.2.0'}),true);
  assert.equal(supportsReplay({engine:'rigid-2.2.0',character:'robot'}),false);
  assert.equal(supportsReplay({engine:'rigid-2.3.0',character:'robot'}),true);
});

test('challenges enforce power, flight and chamber requirements',()=>{
  const frame={layout:'classic',score:5100,stats:{maxFlightSteps:5,airtime:1.2}};
  assert.equal(evaluate('gentle',frame,{power:.3}).complete,true);
  assert.equal(evaluate('gentle',frame,{power:.301}).complete,false);
  assert.equal(evaluate('flight',frame,{power:1}).complete,true);
  assert.equal(evaluate('flight',{...frame,layout:'shaft'},{power:1}).complete,false);
  assert.equal(evaluate('airtime',frame,{power:1}).complete,true);
  assert.equal(evaluate('airtime',frame,null).complete,false);
});

test('browser worker script reconstructs a transferable recording with a matching result',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const sim=new Simulation();sim.push('chest',15,.8);let steps=0;
  while(sim.active){sim.step();steps++;}
  const entry={...sim.snapshot(),steps,push:{part:'chest',angle:15,power:.8}};
  const messages=[],sandbox={performance:require('node:perf_hooks').performance,postMessage:message=>messages.push(message)};
  sandbox.self=sandbox;const context=vm.createContext(sandbox);
  sandbox.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name),'utf8'),context);};
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/replay-worker.js'),'utf8'),context);
  sandbox.onmessage({data:entry});const result=messages.at(-1);
  assert.ok(!result.error,result.error);assert.equal(validEnd(Recording.from(result.recording),entry),true);
});

test('worker selects the frozen solver for historical recipes of every subject',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const messages=[],sandbox={performance:require('node:perf_hooks').performance,postMessage:message=>messages.push(message)};
  sandbox.self=sandbox;const context=vm.createContext(sandbox);
  sandbox.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name),'utf8'),context);};
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/replay-worker.js'),'utf8'),context);
  for(const character of ['human','robot','knight','skeleton','inflatable']) {
    const sim=new Simulation('classic',character,'rigid-2.3.0');sim.push('chest',6,1);
    for(let i=0;i<120;i++)sim.step();
    const entry={...sim.snapshot(),engine:'rigid-2.3.0',steps:120,push:{part:'chest',angle:6,power:1}};
    sandbox.onmessage({data:entry});const result=messages.at(-1);
    assert.ok(!result.error,result.error);assert.equal(validEnd(Recording.from(result.recording),entry),true);
  }
});
