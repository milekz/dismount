const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pl = require('../vendor/planck-1.5.0.js');
const {Simulation,DT,PPM,GRAVITY} = require('../src/physics.js');
const V = (x,y) => pl.Vec2(x/PPM,y/PPM);

function run(part='chest', angle=15, power=0.7, layout='classic') {
  const simulation=new Simulation(layout);
  simulation.push(part,angle,power);
  let previousScore=0;
  for(let tick=0;simulation.active && tick<2200;tick++) {
    simulation.step();
    assert.ok(simulation.score>=previousScore);
    previousScore=simulation.score;
    for(const segment of simulation.bodies) {
      const body=segment.body;
      assert.ok(Number.isFinite(body.getPosition().x) && Number.isFinite(body.getAngle()));
      assert.ok(body.getPosition().y*PPM<simulation.stair.floor+1,'A body must not pass through the floor');
      const [a,b]=simulation.endpoints(segment);
      assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)*PPM-segment.length)<1e-8,'Rigid segments must keep their length');
    }
    for(const joint of simulation.joints) {
      assert.equal(joint.hinge.isLimitEnabled(),true);
      const angle=simulation.jointAngle(joint), tolerance=6*Math.PI/180;
      assert.ok(angle>=joint.hinge.getLowerLimit()-tolerance && angle<=joint.hinge.getUpperLimit()+tolerance, `${part}/${angle}/${power}: ${joint.name} exceeded active joint limits at ${simulation.time}: ${angle*180/Math.PI}`);
    }
  }
  assert.equal(simulation.active,false);
  assert.equal(simulation.score,Object.values(simulation.damage).reduce((a,b)=>a+b,0));
  assert.equal(simulation.score,simulation.bodies.reduce((sum,body)=>sum+body.damage,0));
  return simulation;
}
function isolate(simulation,names) {
  for(let joint=simulation.world.getJointList();joint;) {
    const next=joint.getNext();simulation.world.destroyJoint(joint);joint=next;
  }
  simulation.joints=[];
  for(const segment of simulation.bodies) if(!names.includes(segment.name)) simulation.world.destroyBody(segment.body);
  simulation.bodies=simulation.bodies.filter(segment=>names.includes(segment.name));
  simulation.world.setGravity(pl.Vec2(0,0));
  return names.map(name=>simulation.bodyByName[name]);
}
function moveWhole(simulation,dx,dy) {
  for(const s of simulation.bodies) { const p=s.body.getPosition();s.body.setPosition(pl.Vec2(p.x+dx/PPM,p.y+dy/PPM)); }
  simulation.syncPoints();
}

test('all push points remain stable across 112 combinations including zero power and vertical pushes', () => {
  for(const part of ['head','chest','hip','leftKnee','rightKnee','leftHand','rightHand'])
    for(const angle of [-45,15,65,90]) for(const power of [0,0.05,0.5,1]) run(part,angle,power);
});
test('standard push tumbles down the stairs and scores impacts', () => {
  const s=run(); assert.ok(s.score>0);assert.ok(s.hits>0);assert.ok(s.points[2].x>220);
});
test('identical inputs produce identical physics and independent replay snapshots', () => {
  const a=run(), b=run();assert.deepEqual(a.snapshot(),b.snapshot());
  assert.notEqual(run('head').score,run('hip').score);
  const recording=a.snapshot(), copy=JSON.parse(JSON.stringify(recording));a.reset();
  assert.deepEqual(recording,copy);assert.equal(a.score,0);assert.equal(a.points[0].x,194);
});
test('body fixtures have physical mass and inertia and off-center impulses produce rotation', () => {
  const s=new Simulation(); assert.equal(s.bodies.length,17);
  for(const segment of s.bodies) {
    assert.ok(Math.abs(segment.body.getMass()-segment.mass)<1e-8);
    assert.ok(segment.body.getInertia()>0);
  }
  const b=s.bodyByName.torso.body;
  b.applyLinearImpulse(pl.Vec2(5,0),b.getWorldCenter());
  assert.ok(Math.abs(b.getAngularVelocity())<1e-10);
  b.applyLinearImpulse(pl.Vec2(5,0),b.getWorldPoint(pl.Vec2(0.1,0.1)));
  assert.ok(Math.abs(b.getAngularVelocity())>0.1);
});
test('all fifteen joint angles are body-relative and initial pose is within limits', () => {
  const s=new Simulation(), angles=s.joints.map(j=>s.jointAngle(j));assert.equal(angles.length,15);
  for(const j of s.joints) assert.ok(s.jointAngle(j)>=j.min && s.jointAngle(j)<=j.max,j.name);
  for(const segment of s.bodies) {
    const p=segment.body.getPosition(), rotation=2.2;
    segment.body.setTransform(pl.Vec2(p.x*Math.cos(rotation)-p.y*Math.sin(rotation),p.x*Math.sin(rotation)+p.y*Math.cos(rotation)),segment.body.getAngle()+rotation);
  }
  s.joints.forEach((j,i)=>assert.ok(Math.abs(Math.atan2(Math.sin(s.jointAngle(j)-angles[i]),Math.cos(s.jointAngle(j)-angles[i])))<1e-10));
});
test('joint damping is dissipative and has a finite torque budget', () => {
  const s=new Simulation(), joint=s.joints.find(j=>j.name==='leftElbow');
  joint.b.setAngularVelocity(10);s.applyJointForces();
  assert.equal(joint.hinge.getMotorSpeed(),0);
  assert.ok(joint.hinge.getMaxMotorTorque()>0 && joint.hinge.getMaxMotorTorque()<=joint.maxTorque);
  const keep=new Set([joint.a,joint.b]);
  for(let j=s.world.getJointList();j;) {const next=j.getNext();if(j!==joint.hinge)s.world.destroyJoint(j);j=next;}
  for(const seg of s.bodies) if(!keep.has(seg.body))s.world.destroyBody(seg.body);
  s.bodies=s.bodies.filter(seg=>keep.has(seg.body));s.joints=[joint];s.world.setGravity(pl.Vec2(0,0));
  moveWhole(s,800,-400);
  const energy=()=>s.bodies.reduce((sum,seg)=>sum+0.5*seg.mass*seg.body.getLinearVelocity().lengthSquared()+0.5*seg.body.getInertia()*seg.body.getAngularVelocity()**2,0);
  const before=energy();
  for(let i=0;i<240;i++){s.applyJointForces();s.world.step(DT/4,24,32);}
  assert.ok(energy()<before,'Damping must remove rather than inject energy');
});
test('neck slider stretches, stays bounded and returns under a damped spring', () => {
  const s=new Simulation();s.world.setGravity(pl.Vec2(0,0));moveWhole(s,800,-400);
  const neck=s.joints.find(j=>j.name==='neck');
  for(const name of ['head','neckLink']) {const b=s.bodyByName[name].body,p=b.getPosition();b.setPosition(pl.Vec2(p.x,p.y-12/PPM));}
  const before=Math.abs(neck.slider.getJointTranslation());assert.ok(before>0.1);
  s.push('head',0,0);
  for(let i=0;i<240;i++) {
    s.step();
    assert.ok(neck.slider.getJointTranslation()<20/PPM,'Neck extension must be bounded');
  }
  assert.ok(Math.abs(neck.slider.getJointTranslation())<before*0.2);
});
test('intact joints hold limits, severe damage widens them, and reset heals', () => {
  const s=new Simulation(), knee=s.joints.find(j=>j.name==='leftKnee'), shin=s.bodyByName.leftShin;
  for(let i=0;i<100;i++)s.damageJoints(shin,200);
  assert.equal(knee.damage,0);assert.equal(knee.hinge.isLimitEnabled(),true);
  s.damageJoints(shin,1200);
  assert.equal(knee.broken,true);assert.equal(knee.hinge.isLimitEnabled(),true);
  assert.ok(knee.hinge.getLowerLimit()<knee.min&&knee.hinge.getUpperLimit()>knee.max);
  assert.ok(s.cracks.some(c=>c.fracture));
  const recording=s.snapshot();s.reset();
  assert.ok(s.joints.every(j=>!j.broken&&j.damage===0&&j.hinge.isLimitEnabled()));
  assert.equal(recording.joints.find(j=>j.name==='leftKnee').broken,true);
});
test('reaction overload can damage a joint independently of contact scoring', () => {
  const s=new Simulation(), joint=s.joints.find(j=>j.name==='leftElbow');
  // Lower this joint's strength in a controlled test; the engine must use its budget.
  joint.maxForce=0.01;s.push('leftHand',15,0.5);
  for(let i=0;i<80&&!joint.broken;i++)s.step();
  assert.ok(joint.maxReaction>joint.maxForce);assert.equal(joint.broken,true);
});
test('zero power adds no impulse and unsupported body falls under gravity', () => {
  const s=new Simulation();moveWhole(s,800,-400);s.push('head',90,0);
  assert.equal(s.pendingPush,null);
  for(const seg of s.bodies) assert.equal(seg.body.getLinearVelocity().length(),0);
  const average=()=>s.bodies.reduce((sum,seg)=>sum+seg.body.getWorldCenter().y*seg.mass,0)/s.bodies.reduce((sum,seg)=>sum+seg.mass,0);
  const before=average();for(let i=0;i<20;i++)s.step();
  assert.ok(average()>before+0.08);
  const vy=s.bodies.reduce((sum,seg)=>sum+seg.body.getLinearVelocity().y*seg.mass,0)/s.bodies.reduce((sum,seg)=>sum+seg.mass,0);
  assert.ok(Math.abs(vy-GRAVITY*20*DT)<0.05);
  assert.deepEqual(run('head',-45,0).snapshot(),run('rightKnee',90,0).snapshot());
});
test('middle of a whole forearm collides with a stair nose while endpoints clear the stairs', () => {
  const s=new Simulation(), [seg]=isolate(s,['leftForearm']);
  seg.body.setTransform(V(267,236),Math.atan2(14,23));
  const [a,b]=s.endpoints(seg);
  assert.ok(a.y*PPM+seg.radius<236);
  assert.ok(b.x*PPM>268 && b.y*PPM+seg.radius<267);
  const before=seg.body.getPosition().clone();
  for(let i=0;i<8;i++)s.world.step(DT,24,32);
  const after=seg.body.getPosition();
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)*PPM>0.2,'Full segment must respond at its midpoint');
});
test('unconnected limbs self-collide instead of overlapping', () => {
  const s=new Simulation(), [a,b]=isolate(s,['leftForearm','rightShin']);
  a.body.setTransform(V(1050,400),0);b.body.setTransform(V(1050,402),0);
  for(let i=0;i<60;i++)s.world.step(DT,24,32);
  const separation=Math.abs(a.body.getPosition().y-b.body.getPosition().y)*PPM;
  assert.ok(separation>=a.radius+b.radius-1);
  assert.ok(a.body.getContactList() || b.body.getContactList());
});
test('continuous collision detection prevents a fast limb from tunneling through the floor', () => {
  const s=new Simulation(), [seg]=isolate(s,['leftForearm']);
  seg.body.setTransform(V(1100,610),0);seg.body.setLinearVelocity(pl.Vec2(0,100));
  s.world.step(1/60,24,32);
  assert.ok(seg.body.getPosition().y*PPM+seg.radius<640);
  assert.ok(seg.body.getLinearVelocity().y<10);
});
test('edge contact intensifies damage compared with a flat tread and does not score resting contact', () => {
  function contact(edge,speed=500) {
    const s=new Simulation(), [head]=isolate(s,['head']);
    const n=edge?Math.SQRT1_2:0;
    head.body.setTransform(edge?V(268+10,236-10):V(244,220),0);
    head.body.setLinearVelocity(V(-speed*n,edge?speed*n:speed));
    for(let i=0;i<12;i++)s.world.step(DT/4,24,32);
    s.processImpacts();return s;
  }
  const edge=contact(true),flat=contact(false);
  assert.ok(edge.impacts.some(hit=>hit.edge));
  assert.ok(edge.score>flat.score*1.5);
  assert.equal(contact(true,0).score,0);
});
test('vendored engine and adapter load as local browser scripts without require or network', () => {
  const sandbox={};sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../vendor/planck-1.5.0.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/physics.js'),'utf8'),sandbox);
  const simulation=new sandbox.DismountPhysics.Simulation();simulation.push('chest',15,0.7);simulation.step();
  assert.equal(simulation.snapshot().segments.length,17);
});

test('hands, feet and spine have bounded joints and can be injured without detaching', () => {
  let s;
  for(const name of ['leftWrist','rightWrist','leftAnkle','rightAnkle','thoracicSpine','lumbarSpine']) {
    s=new Simulation();
    const joint=s.joints.find(j=>j.name===name);
    assert.ok(joint && joint.max-joint.min<Math.PI);
    assert.equal(joint.hinge.isLimitEnabled(),true);
    s.damageJoints(joint.b.getUserData(),1800);
    assert.equal(joint.broken,true);
    assert.equal(joint.hinge.isLimitEnabled(),true);
    assert.ok(joint.hinge.getUpperLimit()-joint.hinge.getLowerLimit()<Math.PI*2);
    assert.ok(joint.hinge.getBodyA() && joint.hinge.getBodyB());
  }
  s.reset();assert.equal(s.joints.filter(j=>j.broken).length,0);
});
test('per-body damage and strongest impact are recorded independently in replay snapshots', () => {
  const s=new Simulation(),segment=s.bodyByName.leftHand;
  s.pendingImpacts.set(segment,{segment,speed:5,edgeFactor:1,self:false,position:{x:2,y:2}});
  s.processImpacts();
  const frame=s.snapshot(), part=frame.segments.find(p=>p.name==='leftHand');
  assert.equal(part.hits,1);assert.equal(part.damage,s.score);
  assert.equal(frame.strongestImpact.segment,'leftHand');assert.equal(frame.strongestImpact.points,s.score);
  assert.equal(frame.strongestImpact.edge,true);
  assert.ok(frame.joints.every(j=>Number.isFinite(j.x)&&Number.isFinite(j.y)));
  const copy=JSON.parse(JSON.stringify(frame));s.reset();assert.deepEqual(frame,copy);
  assert.equal(s.snapshot().strongestImpact,null);
  assert.ok(s.snapshot().segments.every(p=>p.damage===0&&p.hits===0));
});

test('new layouts have continuous treads, stable falls, and deterministic replay recipes',()=>{
  const {buildStair,LAYOUTS}=require('../src/physics.js');
  for(const layout of ['steep','long','landing']) {
    const stair=buildStair(layout);assert.equal(stair.treads.length,LAYOUTS[layout].count);
    stair.treads.forEach((t,i)=>{if(i)assert.equal(stair.treads[i-1].x+stair.treads[i-1].width,t.x);});
    const a=run('chest',15,.7,layout), b=run('chest',15,.7,layout);
    assert.deepEqual(a.snapshot(),b.snapshot());assert.equal(a.snapshot().layout,layout);
    run('head',90,1,layout);run('leftHand',-45,1,layout);run('hip',0,0,layout);
  }
  assert.equal(buildStair('landing').treads[6].width,144);
});

test('foot pushes target actual feet and stay stable at zero and full power',()=>{
  for(const part of ['leftFoot','rightFoot']) {
    const s=new Simulation(),point=s.points.find(p=>p.name===part);
    assert.equal(point.bodyName,part);s.push(part,15,1);
    assert.equal(s.pendingPush.body,s.bodyByName[part].body);
    for(const angle of [-45,15,65,90])run(part,angle,1);
    run(part,0,0);
    for(const layout of ['steep','long','landing'])run(part,15,.7,layout);
  }
});

test('three additional chambers have distinct solid surfaces and open drops',()=>{
  const {buildStair}=require('../src/physics.js');
  const uneven=buildStair('uneven');
  assert.ok(new Set(uneven.treads.map(t=>t.width)).size>2);
  assert.ok(new Set(uneven.treads.map(t=>t.rise)).size>2);
  const surface=(layout,x,fromY)=>{
    const s=new Simulation(layout);let y=null;
    s.world.rayCast(V(x,fromY),V(x,s.stair.floor+30),(fixture,point,normal,fraction)=>{
      if(!fixture.getUserData()?.ground)return -1;
      y=point.y*PPM;return fraction;
    });return y;
  };
  assert.ok(Math.abs(surface('shaft',250,220)-330)<1e-8);
  assert.ok(Math.abs(surface('shaft',250,355)-550)<1e-8,'There must be open space below a ledge');
  assert.ok(Math.abs(surface('shaft',435,220)-900)<1e-8,'Central shaft stays open to the bottom');
  const drop=buildStair('finalDrop');
  assert.equal(drop.floor-drop.treads.at(-1).y,320);
  assert.ok(Math.abs(surface('finalDrop',drop.end+50,205)-drop.floor)<1e-8);
});
test('additional chamber falls are stable and replay deterministically',()=>{
  for(const layout of ['uneven','shaft','finalDrop']) {
    const first=run('chest',15,.8,layout),again=run('chest',15,.8,layout);
    assert.deepEqual(first.snapshot(),again.snapshot());assert.ok(first.score>0);
    run('head',100,1,layout);run('leftFoot',-100,1,layout);run('chest',0,0,layout);
  }
});


test('human proportions keep the neck short and both hands above the knees', () => {
  const s=new Simulation(), b=s.bodyByName;
  assert.ok(b.neckLink.length < b.torso.radius, 'Neck should fit between collar and jaw');
  const armLengths=['left','right'].map(side=>
    ['UpperArm','Forearm','Hand'].reduce((sum,part)=>sum+b[side+part].length,0));
  assert.ok(Math.abs(armLengths[0]-armLengths[1])<1, 'Arms have comparable overall lengths');
  for(const side of ['left','right']) {
    const hand=s.endpoints(b[side+'Hand'])[1].y*PPM;
    const hip=s.endpoints(b[side+'Thigh'])[0].y*PPM;
    const knee=s.endpoints(b[side+'Thigh'])[1].y*PPM;
    assert.ok(hand>hip && hand<knee, 'Fingertips reach the thigh, not the knee');
  }
});

test('endless stairs extend ahead of the body and reset without a terminal floor', () => {
  const s=new Simulation('endless'), original=s.stair.end;
  let ground=false;
  s.world.rayCast(V(original+300,0),V(original+300,2000),(fixture)=>{
    if(fixture.getUserData()?.ground)ground=true;return 1;
  });
  assert.equal(ground,false,'There is no artificial landing at the initial end');
  moveWhole(s,2400,1550);s.push('chest',0,0);s.step();
  assert.ok(s.stair.end>3300,'Generate stairs beyond the original right boundary');
  s.stair.treads.forEach((t,i)=>{
    assert.equal(t.x,220+i*48);assert.equal(t.y,205+(i+1)*31);
  });
  s.time=19;s.step();assert.equal(s.active,true,'The ordinary 18-second limit does not apply');
  s.time=120;s.step();assert.equal(s.active,false);
  s.reset();assert.equal(s.stair.end,original);assert.equal(s.stair.count,24);
});

test('run statistics measure airborne center-of-mass motion and reset cleanly',()=>{
  const s=new Simulation();moveWhole(s,800,-400);s.previousCenter=s.massCenter();
  s.push('head',0,0);for(let i=0;i<20;i++)s.step();
  assert.ok(Math.abs(s.stats.airtime-20*DT)<1e-8);
  assert.ok(Math.abs(s.stats.maxSpeed-GRAVITY*20*DT)<.05);
  assert.ok(s.stats.distance>.1&&s.stats.distance<.2);
  const frame=s.snapshot();s.reset();
  assert.deepEqual(s.stats,{steps:0,distance:0,maxSpeed:0,airtime:0});
  assert.ok(frame.stats.distance>.1);
});

test('every healthy and dislocated joint resists rotation in both directions',()=>{
  const names=new Simulation().joints.map(j=>j.name);
  for(const name of names)for(const broken of [false,true])for(const direction of [-1,1]) {
    const s=new Simulation(),joint=s.joints.find(j=>j.name===name);
    moveWhole(s,1000,-500);s.world.setGravity(pl.Vec2(0,0));
    for(let j=s.world.getJointList();j;) {
      const next=j.getNext();if(j!==joint.hinge)s.world.destroyJoint(j);j=next;
    }
    for(const segment of s.bodies)if(segment.body!==joint.a&&segment.body!==joint.b)s.world.destroyBody(segment.body);
    if(broken)s.breakJoint(joint);
    const low=joint.hinge.getLowerLimit(),high=joint.hinge.getUpperLimit(),tolerance=6*Math.PI/180;
    assert.ok(high-low<Math.PI*2,`${name}: no full revolution`);
    if(broken)assert.ok(low<joint.min&&high>joint.max,`${name}: injury permits extra movement`);
    for(let i=0;i<720;i++) {
      joint.b.setAngularVelocity(direction*30);s.world.step(DT/12,24,32);
      const angle=s.jointAngle(joint);
      assert.ok(angle>=low-tolerance&&angle<=high+tolerance,`${name}, injured=${broken}, direction=${direction}`);
      const a=joint.hinge.getAnchorA(),b=joint.hinge.getAnchorB();
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.03,`${name}: body remains attached`);
    }
  }
});
