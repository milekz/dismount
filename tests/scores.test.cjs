const test=require('node:test');
const assert=require('node:assert/strict');
const {ScoreBoard,normalizeNick,KEY}=require('../src/scores.js');
const run=score=>({score,hits:5,time:2,steps:240,push:{part:'chest',angle:15,power:.73456789}});
function memory(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}

test('top ten persist in descending order with exact replay inputs',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  for(let score=0;score<12;score++)assert.equal(board.save('ABC',run(score)).ok,true);
  assert.deepEqual(board.entries.map(entry=>entry.score),[11,10,9,8,7,6,5,4,3,2]);
  assert.equal(board.qualifies(2),false);
  assert.equal(board.save('ABC',run(1)).ok,false);
  const restored=new ScoreBoard(storage,'test');
  assert.deepEqual(restored.entries,board.entries);
  assert.equal(restored.entries[0].push.power,.73456789);
});
test('nicknames require exactly three letters and malformed recipes are rejected',()=>{
  const board=new ScoreBoard(memory(),'test');
  assert.equal(normalizeNick('a1b-cdef'),'ABC');
  for(const nick of ['A','AB','ABCD','aBc','<b>'])assert.equal(board.save(nick,run(10)).ok,false);
  assert.equal(board.save('ABC',{...run(10),push:{part:'chest',angle:106,power:1}}).ok,false);
  assert.equal(board.entries.length,0);
});
test('corrupt entries and duplicate IDs are filtered without losing valid records',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');board.save('ABC',run(10));
  const valid=board.entries[0];
  storage.setItem(KEY,JSON.stringify({version:1,entries:[valid,valid,null,{...valid,id:'bad',steps:1e9}]}));
  assert.equal(new ScoreBoard(storage,'test').entries.length,1);
  storage.setItem(KEY,'broken json');assert.equal(new ScoreBoard(storage,'test').entries.length,0);
});
test('denied storage preserves scores for the session and reports non-persistence',()=>{
  const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
  const board=new ScoreBoard(storage,'test');
  assert.equal(board.persistent,false);
  assert.equal(board.save('ABC',run(10)).persistent,false);
  assert.equal(board.entries.length,1);
});

test('each layout persists separately and old classic recipes still load',()=>{
  const storage=memory(),classic=new ScoreBoard(storage,'test'),steep=new ScoreBoard(storage,'test','steep');
  classic.save('AAA',run(12));steep.save('BBB',run(34));
  assert.equal(new ScoreBoard(storage,'test').entries[0].score,12);
  assert.equal(new ScoreBoard(storage,'test','steep').entries[0].score,34);
  assert.equal(new ScoreBoard(storage,'test','long').entries.length,0);
  const saved=JSON.parse(storage.getItem(KEY));delete saved.entries[0].layout;
  storage.setItem(KEY,JSON.stringify(saved));assert.equal(new ScoreBoard(storage,'test').entries.length,1);
});

test('new angle endpoints persist while historical negative-angle replays remain readable',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  for(const angle of [-100,100])assert.equal(board.save('ABC',{...run(10),push:{...run(10).push,angle}}).ok,true);
  assert.equal(board.save('ABC',{...run(10),push:{...run(10).push,angle:-101}}).ok,false);
  const saved=JSON.parse(storage.getItem(KEY));saved.entries[0].push.angle=-45;saved.entries[1].push.angle=105;
  storage.setItem(KEY,JSON.stringify(saved));
  assert.equal(new ScoreBoard(storage,'test').entries[0].push.angle,-45);
  assert.equal(new ScoreBoard(storage,'test').entries[1].push.angle,105);
});

test('endless boards accept two-minute recordings without extending other chamber limits',()=>{
  const storage=memory(),recording={...run(123),time:120,steps:14400};
  const endless=new ScoreBoard(storage,'test','endless');
  assert.equal(endless.save('END',recording).ok,true);
  assert.equal(new ScoreBoard(storage,'test','endless').entries[0].steps,14400);
  assert.equal(new ScoreBoard(storage,'test').save('END',recording).ok,false);
  assert.equal(endless.save('END',{...recording,time:121,steps:14520}).ok,false);
});

test('characters have isolated boards and legacy human records retain their storage key',()=>{
  const storage=memory(),human=new ScoreBoard(storage,'test'),robot=new ScoreBoard(storage,'test','classic','robot');
  human.save('HUM',run(100));robot.save('ROB',run(200));
  assert.equal(human.key,KEY);assert.notEqual(human.key,robot.key);
  const legacy=JSON.parse(storage.getItem(KEY));delete legacy.entries[0].character;
  storage.setItem(KEY,JSON.stringify(legacy));
  assert.equal(new ScoreBoard(storage,'test').entries[0].nick,'HUM');
  const loaded=new ScoreBoard(storage,'test','classic','robot');
  assert.equal(loaded.entries.length,1);assert.equal(loaded.entries[0].character,'robot');
  assert.equal(new ScoreBoard(storage,'test','classic','knight').entries.length,0);
  const malformed=JSON.parse(storage.getItem(robot.key));malformed.entries[0].character='human';
  storage.setItem(robot.key,JSON.stringify(malformed));
  assert.equal(new ScoreBoard(storage,'test','classic','robot').entries.length,0);
});
