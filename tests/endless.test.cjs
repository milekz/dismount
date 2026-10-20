const test=require('node:test');
const assert=require('node:assert/strict');
const {palette,milestone,createRecords,KEY}=require('../src/endless.js');
const frame=(steps,character='human',layout='endless')=>({layout,character,stats:{steps}});

test('milestones fire only on crossing a 50-step boundary and handle replay jumps',()=>{
  assert.equal(milestone(frame(49),frame(48)),null);
  assert.equal(milestone(frame(50),frame(49)).steps,50);
  assert.equal(milestone(frame(51),frame(50)),null);
  assert.equal(milestone(frame(150),frame(49)).steps,150);
  assert.equal(milestone(frame(50),frame(150)),null);
  assert.equal(milestone(frame(100),undefined),null);
  assert.equal(milestone(frame(50,'human','classic'),frame(49)),null);
  assert.notEqual(milestone(frame(50),frame(49)).joke,milestone(frame(100),frame(99)).joke);
});

test('depth palettes are continuous across milestones and deterministic when seeking backwards',()=>{
  const initial=palette(0),deep=palette(100);
  assert.equal(initial.backgroundTop,'#e7e9e0');
  assert.notEqual(initial.backgroundTop,deep.backgroundTop);
  for(const boundary of [50,100,150,200]) {
    const a=palette(boundary-.01),b=palette(boundary+.01);
    for(const key of ['backgroundTop','backgroundBottom','even','odd','side'])assert.equal(a[key],b[key]);
  }
  palette(5000);assert.deepEqual(palette(100),deep);
  assert.deepEqual(palette(0),initial);
});

test('depth records persist per character and batch writes without lowering existing records',()=>{
  const values=new Map(),writes=[],storage={getItem:key=>values.get(key),setItem:(key,value)=>{values.set(key,value);writes.push(key);}};
  const records=createRecords(storage);
  records.record(frame(49));records.record(frame(50));records.record(frame(51));
  assert.equal(records.best('human'),51);assert.equal(writes.length,0);
  records.save();records.save();assert.equal(writes.length,1);
  records.record(frame(40));records.record(frame(70,'robot'));records.save();
  const reload=createRecords(storage);
  assert.equal(reload.best('human'),51);assert.equal(reload.best('robot'),70);
  records.record(frame(999,'human','classic'));assert.equal(records.best('human'),51);
  values.set(KEY+'skeleton','invalid');values.set(KEY+'knight','-10');
  assert.equal(reload.best('skeleton'),0);assert.equal(reload.best('knight'),0);
});

test('depth records remain available when local storage is unavailable',()=>{
  const records=createRecords({getItem(){throw Error('blocked');},setItem(){throw Error('full');}});
  records.record(frame(100));records.save();
  assert.equal(records.best('human'),100);
});
