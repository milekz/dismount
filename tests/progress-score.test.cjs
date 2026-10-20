const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Vec2}=require('../vendor/planck-1.5.0.js');
const {Simulation,PPM,CHARACTERS,supportsReplay}=require('../src/physics.js');
const {Recording}=require('../src/replay.js');

function damage(s,points) {
  s.impactScore=points;s.damage.Torso=points;s.bodyByName.torso.damage=points;s.updateScore();
}
function moveCenter(s,x,y) {
  const c=s.massCenter(),dx=x/PPM-c.x,dy=y/PPM-c.y;
  for(const {body} of s.bodies){const p=body.getPosition();body.setPosition(Vec2(p.x+dx,p.y+dy));}
  if(s.layout==='endless')s.extendEndlessStairs();
  s.updateStats();
}

test('progress pays for new steps once, with a whole-point cap of 20% of impact points',()=>{
  const s=new Simulation();damage(s,1000);
  moveCenter(s,221,237);assert.equal(s.progressScore,10);assert.equal(s.score,1010);
  const distance=s.stats.distance;
  for(let i=0;i<5;i++){moveCenter(s,240,240);moveCenter(s,221,237);}
  assert.ok(s.stats.distance>distance);assert.equal(s.progressScore,10);
  moveCenter(s,200,140);moveCenter(s,221,237);assert.equal(s.progressScore,10);
  moveCenter(s,365,330);assert.equal(s.stats.steps,4);assert.equal(s.progressScore,40);
  damage(s,49);assert.equal(s.progressScore,9);assert.equal(s.score,58);
  damage(s,0);assert.equal(s.progressScore,0);assert.equal(s.score,0);
  damage(s,500);assert.equal(s.progressScore,40,'Later impacts can unlock already earned progress');
  s.reset();assert.equal(s.score,0);assert.equal(s.impactScore,0);assert.equal(s.progressScore,0);
});

test('endless stairs award skipped steps, while shaft progress counts ledges',()=>{
  const s=new Simulation('endless');damage(s,12000);
  moveCenter(s,220+150*48,205+150*31+.1);
  assert.equal(s.stats.steps,150);assert.equal(s.progressScore,1500);assert.equal(s.score,13500);
  moveCenter(s,220+1000*48,205+1000*31+.1);
  assert.equal(s.progressScore,2400);assert.equal(s.score,14400);
  const shaft=new Simulation('shaft');damage(shaft,1000);
  moveCenter(shaft,435,600);assert.equal(shaft.stats.steps,3);assert.equal(shaft.progressScore,30);
  moveCenter(shaft,435,850);assert.equal(shaft.progressScore,50);
});

test('progress never changes injuries, and compact replay retains the breakdown while seeking',()=>{
  const s=new Simulation(),recording=new Recording();damage(s,1000);
  const injuries=JSON.stringify(s.snapshot().damage),bodyDamage=s.bodies.map(b=>b.damage);
  recording.push(s.snapshot());moveCenter(s,365,330);recording.push(s.snapshot());
  assert.equal(JSON.stringify(s.snapshot().damage),injuries);
  assert.deepEqual(s.bodies.map(b=>b.damage),bodyDamage);
  const copied=Recording.from(structuredClone(recording.packet()));
  for(const index of [1,0,1]) {
    const frame=copied.at(index),impact=Object.values(frame.damage).reduce((a,b)=>a+b,0);
    assert.equal(impact,1000);assert.equal(frame.score-impact,index?40:0);
  }
});

test('all published 3.0 recipes retain their output and current scoring leaves trajectories unchanged',()=>{
  const hashes={
    human:'0f65ee72440efa1187a87e0670d3b6ed7d6b7d7439bd16b0db75761570e85926',
    robot:'d2a3f13e37c53703b7c64afe30360d5c60cdd87ef19b754daea05fa402d935f7',
    knight:'7df6445c5d30794ad0a4c55043964f09915aaf2ac696acffc8f8907836d20eee',
    skeleton:'24c70d6d25c69ea88b0626c53145f7cad23899e864ccfd7502b5a917541793a8',
    inflatable:'f219d42506f2df0626f7d0d2595eab7988cadc893397ff7b3429dcf2cae49e17'
  };
  for(const character of Object.keys(CHARACTERS)) {
    const old=new Simulation('classic',character,'rigid-3.0.0'),current=new Simulation('classic',character);
    old.push('chest',6,1);current.push('chest',6,1);
    for(let i=0;i<240;i++) {
      old.step();current.step();
      assert.equal(current.impactScore,old.score);
      assert.ok(current.score>=old.score);
    }
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(old.snapshot())).digest('hex'),hashes[character]);
    const frame=current.snapshot();frame.score=old.score;
    frame.points=frame.points.filter(p=>p.name!=='neck');assert.deepEqual(frame,old.snapshot());
    assert.equal(supportsReplay({engine:'rigid-3.0.0',character}),true);
    old.reset();old.stats.steps=50;damage(old,1000);assert.equal(old.progressScore,0);
  }
});
