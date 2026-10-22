const test=require('node:test');
const assert=require('node:assert/strict');
const {ScoreBoard,normalizeNick,KEY,USED_PREFIX}=require('../src/scores.js');
const run=score=>({score,hits:5,time:2,steps:240,push:{part:'chest',angle:15,power:.73456789}});
function memory(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}

test('top ten persist in descending order with exact replay inputs',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  for(let score=0;score<12;score++)assert.equal(board.save('ABC',{...run(score),push:{...run(score).push,angle:score}}).ok,true);
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
  assert.equal(board.complete(run(10)),false);
});

test('a completed setup can be saved once, and unsaved attempts stay used after reload',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test'),first=run(10);
  assert.equal(board.complete(first),true);
  assert.equal(board.save('AB',first).ok,false);
  assert.equal(board.complete(run(10)),false);
  assert.equal(board.save('ABC',first).ok,true);
  assert.equal(board.save('DEF',first).ok,false);
  const unsaved={...run(20),push:{part:'neck',angle:6.25,power:1}};
  assert.equal(board.complete(unsaved),true);
  const reload=new ScoreBoard(storage,'test');
  assert.equal(reload.complete({...unsaved}),false);
  assert.equal(reload.save('XYZ',run(10)).ok,false);
  assert.equal(reload.entries.length,1);
});

test('duplicate settings match badge precision and remain independent across scenes and physics',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  assert.equal(board.complete(run(10)),true);
  assert.equal(board.complete({...run(11),push:{...run(10).push,power:.7346}}),false);
  for(const change of [{power:.7347},{angle:15.25},{part:'neck'}])
    assert.equal(board.complete({...run(10),push:{...run(10).push,...change}}),true);
  assert.equal(new ScoreBoard(storage,'test','steep').complete(run(10)),true);
  assert.equal(new ScoreBoard(storage,'test','classic','robot').complete(run(10)),true);
  assert.equal(new ScoreBoard(storage,'updated-physics').complete(run(10)),true);
  assert.equal(board.entries.length,0);
});

test('used setups survive top-ten eviction and non-qualifying completions',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  for(let angle=0;angle<12;angle++)board.save('ABC',{...run(angle),push:{...run(angle).push,angle}});
  const low=run(0);assert.equal(board.qualifies(low.score),false);assert.equal(board.complete(low),true);
  const reload=new ScoreBoard(storage,'test');
  assert.equal(reload.complete({...run(0),push:{...run(0).push,angle:0}}),false);
  assert.equal(reload.complete(low),false);
});

test('existing records seed history and already open boards see other tabs completed setups',()=>{
  const storage=memory(),source=new ScoreBoard(storage,'test');source.save('OLD',run(10));
  const legacy=memory();legacy.setItem(KEY,storage.getItem(KEY));
  const migrated=new ScoreBoard(legacy,'test');assert.equal(migrated.complete(run(10)),false);
  legacy.setItem(KEY,'');assert.equal(new ScoreBoard(legacy,'test').complete(run(10)),false);
  const tabA=new ScoreBoard(storage,'test'),tabB=new ScoreBoard(storage,'test');
  const fresh={...run(20),push:{part:'head',angle:0,power:1}};
  assert.equal(tabA.complete(fresh),true);assert.equal(tabB.complete({...fresh}),false);
});

test('invalid attempts do not consume settings and seen replay recipes do',()=>{
  const storage=memory(),board=new ScoreBoard(storage,'test');
  assert.equal(board.complete({...run(10),steps:0}),false);
  assert.equal(storage.getItem(board.pushKey(run(10).push)),null);
  assert.equal(board.rememberPush({part:'fake',angle:0,power:1}),false);
  assert.equal(board.rememberPush(run(10).push),true);
  assert.equal(board.complete(run(10)),false);
  assert.ok(board.pushKey(run(10).push).startsWith(USED_PREFIX));
  assert.equal(board.entries.length,0);
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

test('historical rankings stay available without competing with or being overwritten by new scores',()=>{
  const {PREVIOUS_KEY}=require('../src/scores.js');
  for(const layout of ['classic','endless'])for(const character of ['human','robot','knight','skeleton','inflatable']) {
    const storage=memory(),source=new ScoreBoard(storage,'rigid-2.3.0',layout,character);
    source.save('OLD',run(999999));
    const previousKey=source.key.replace(KEY,PREVIOUS_KEY),original=storage.getItem(source.key);
    storage.setItem(previousKey,original);storage.setItem(source.key,'');
    const current=new ScoreBoard(storage,'rigid-3.0.0',layout,character);
    assert.equal(current.entries.length,0);assert.equal(current.previousEntries.length,1);
    assert.equal(current.get(current.previousEntries[0].id).nick,'OLD');
    assert.equal(current.save('NEW',run(1)).ok,true);
    assert.equal(current.entries[0].nick,'NEW');assert.equal(storage.getItem(previousKey),original);
    const restored=new ScoreBoard(storage,'rigid-3.0.0',layout,character);
    assert.equal(restored.entries[0].nick,'NEW');assert.equal(restored.previousEntries[0].nick,'OLD');
  }
});

test('both earlier ranking generations survive a new scoring board',()=>{
  const {PREVIOUS_KEYS}=require('../src/scores.js'),storage=memory(),source=new ScoreBoard(storage,'test');
  source.save('OLD',run(500));const base=source.entries[0];
  for(const [i,key] of PREVIOUS_KEYS.entries())
    storage.setItem(key,JSON.stringify({version:1,entries:[{...base,id:'archive-'+i,engine:i?'rigid-2.3.0':'rigid-3.0.0'}]}));
  storage.setItem(KEY,'');
  const originals=PREVIOUS_KEYS.map(key=>storage.getItem(key)),board=new ScoreBoard(storage,'rigid-3.1.0');
  assert.equal(board.previousEntries.length,2);assert.equal(board.entries.length,0);
  board.save('NEW',run(600));
  assert.deepEqual(PREVIOUS_KEYS.map(key=>storage.getItem(key)),originals);
  assert.equal(new ScoreBoard(storage,'rigid-3.1.0').previousEntries.length,2);
});
