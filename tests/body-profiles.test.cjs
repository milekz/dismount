const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pl=require('../vendor/planck-1.5.0.js');
const {Simulation,PPM,DT,GRAVITY,CHARACTERS,REPLAY_VERSION,supportsReplay}=require('../src/physics.js');
const {shapeInertia,combine}=require('../src/body-profiles.js');
const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const total=s=>s.bodies.reduce((sum,b)=>sum+b.mass,0);
function freeSpace(s) {
  for(const segment of s.bodies) {
    const b=segment.body,p=b.getPosition();
    b.setPosition(pl.Vec2(p.x+20,p.y-20));
    b.setLinearDamping(0);b.setAngularDamping(0);
    for(let f=b.getFixtureList();f;f=f.getNext())f.setFilterData({categoryBits:1,maskBits:0,groupIndex:0});
  }
  s.syncPoints();s.world.setGravity(pl.Vec2(0,0));
}

test('five materials have calibrated mass totals and positive COM-based inertia',()=>{
  const masses={human:73,robot:110,knight:96,skeleton:10,inflatable:3};
  for(const [id,mass] of Object.entries(masses)) {
    const s=new Simulation('classic',id);near(total(s),mass);
    for(const b of s.bodies) {
      const c=b.body.getLocalCenter();
      near(b.body.getMass(),b.mass);
      near(b.body.getInertia()-b.mass*c.lengthSquared(),b.inertia);
      assert.ok(b.inertia>0,id+'/'+b.name);
    }
    const original=s.snapshot();s.reset();assert.deepEqual(s.snapshot(),original);
  }
  const human=new Simulation(),b=human.bodyByName;
  near((b.head.mass+b.neckLink.mass)/73,.0694);
  near((b.torso.mass+b.abdomen.mass+b.pelvis.mass)/73,.4346);
  near(b.leftThigh.mass/73,.1416);near(b.leftShin.mass/73,.0433);
  near(b.leftThigh.body.getLocalCenter().x/(b.leftThigh.length/PPM)+.5,.4095);
  near(b.leftHand.body.getLocalCenter().x+b.leftHand.length/PPM/2,
    .3624*(b.leftHand.length+b.leftHand.radius)/PPM);
  near((199+4.5-(95-14))/PPM,1.75);
});

test('materials change weight distribution, armor moves the COM and inertia composes correctly',()=>{
  const sims=Object.keys(CHARACTERS).map(id=>new Simulation('classic',id));
  assert.equal(new Set(sims.map(s=>s.bodyByName.torso.mass/total(s))).size,5);
  assert.equal(new Set(sims.map(s=>s.massCenter().y)).size,5);
  const [human,,knight]=sims;
  near(knight.bodyByName.head.mass-human.bodyByName.head.mass,3);
  near(knight.bodyByName.torso.mass-human.bodyByName.torso.mass,7);
  assert.ok(knight.massCenter().y<human.massCenter().y,'helmet and breastplate raise the COM');
  const composed=combine({mass:2,center:{x:-1,y:0},inertia:3},{mass:2,center:{x:1,y:0},inertia:3});
  near(composed.center.x,0);near(composed.inertia,10);
  near(shapeInertia(0,2),2);near(shapeInertia(0,2,true),4);
});

test('all model segments obey impulse/mass and torque/COM-inertia relationships',()=>{
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id);
    for(const {body,mass,inertia} of s.bodies) {
      const center=body.getWorldCenter().clone(),impulse=pl.Vec2(.4,-.2);
      body.applyLinearImpulse(impulse,center,true);
      near(body.getLinearVelocity().x,.4/mass);
      near(body.getLinearVelocity().y,-.2/mass);
      near(body.getAngularVelocity(),0);
      body.applyLinearImpulse(impulse,pl.Vec2(center.x+.1,center.y+.2),true);
      near(body.getAngularVelocity(),(-.02-.08)/inertia,1e-8);
    }
  }
});

test('offset centers transform with the body and total momentum survives internal joint forces',()=>{
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id),before=s.massCenter(),angle=.8,c=Math.cos(angle),sn=Math.sin(angle);
    for(const {body} of s.bodies) {
      const p=body.getPosition();
      body.setTransform(pl.Vec2(c*p.x-sn*p.y+3,sn*p.x+c*p.y-4),body.getAngle()+angle);
    }
    near(s.massCenter().x,c*before.x-sn*before.y+3);near(s.massCenter().y,sn*before.x+c*before.y-4);
    freeSpace(s);
    const momentum=()=>s.bodies.reduce((sum,{body,mass,inertia})=>{
      const v=body.getLinearVelocity(),p=body.getWorldCenter();
      return {x:sum.x+mass*v.x,y:sum.y+mass*v.y,
        angular:sum.angular+inertia*body.getAngularVelocity()+mass*(p.x*v.y-p.y*v.x)};
    },{x:0,y:0,angular:0});
    const body=s.bodyByName.torso.body,p=body.getWorldCenter();
    body.applyLinearImpulse(pl.Vec2(1,.2),pl.Vec2(p.x+.03,p.y+.02),true);
    const initial=momentum();
    for(let tick=0;tick<120;tick++){s.applyJointForces(DT/12);s.world.step(DT/12,24,32);}
    const after=momentum();
    near(after.x,initial.x,1e-7);near(after.y,initial.y,1e-7);
    // Iterative positional corrections can introduce small angular-momentum error.
    near(after.angular,initial.angular,.02);
  }
});

test('all models fall at the same acceleration without drag or support, including zero-power release',()=>{
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id);freeSpace(s);s.world.setGravity(pl.Vec2(0,GRAVITY));
    const y=s.massCenter().y;s.push('head',100,0);assert.equal(s.pendingPush,null);
    for(let i=0;i<20;i++)s.step();
    const vy=s.bodies.reduce((sum,b)=>sum+b.mass*b.body.getLinearVelocity().y,0)/total(s);
    near(vy,GRAVITY*20*DT,1e-8);assert.ok(s.massCenter().y>y);
  }
});

test('every neck has material-specific travel, spring recovery and bounded injury extension',()=>{
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id);freeSpace(s);
    const neck=s.joints.find(j=>j.name==='neck'),settings=s.profile.neck;
    near(neck.slider.getUpperLimit(),settings.extension);
    const axis=neck.slider.getBodyA().getWorldVector(neck.slider.getLocalAxisA());
    const shift=settings.extension*.8;
    for(const name of ['head','neckLink']) {
      const body=s.bodyByName[name].body,p=body.getPosition();
      body.setPosition(pl.Vec2(p.x+axis.x*shift,p.y+axis.y*shift));
    }
    near(neck.slider.getJointTranslation(),shift);
    for(let i=0;i<2880;i++) {
      s.applyJointForces(DT/12);s.world.step(DT/12,24,32);
      assert.ok(neck.slider.getJointTranslation()<=settings.extension+.005,id);
    }
    assert.ok(Math.abs(neck.slider.getJointTranslation())<shift*.2,id+' spring recovery');
    s.breakJoint(neck);near(neck.slider.getUpperLimit(),settings.injured);
    assert.ok(neck.slider.isLimitEnabled());s.reset();
    near(s.joints.find(j=>j.name==='neck').slider.getUpperLimit(),settings.extension);
  }
});

test('the resting pose does not fight its own neck constraint or create motion in zero gravity',()=>{
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id);
    // Keep self-collision enabled, but move away from the stairs.
    for(const {body} of s.bodies) {
      const p=body.getPosition();body.setPosition(pl.Vec2(p.x+20,p.y-20));
    }
    s.world.setGravity(pl.Vec2(0,0));s.syncPoints();s.push('chest',0,0);
    for(let i=0;i<120;i++)s.step();
    assert.equal(s.score,0,id+' must not injure itself at rest');
    const neck=s.joints.find(j=>j.name==='neck');
    near(neck.slider.getJointTranslation(),0,1e-7);
    for(const {body} of s.bodies) {
      near(body.getLinearVelocity().length(),0,1e-7);
      near(body.getAngularVelocity(),0,1e-7);
    }
  }
});

test('published 2.3 trajectories for every model retain their exact historical output',()=>{
  const hashes={
    human:'3af9907033cc5afad0c78ba32cb6578f2b75a8b1360545d51e31a6883ad58840',
    robot:'d69f6fa60452376da3bd8531b2963e97a0cb93cb9247af88404e1f6d24e96a21',
    knight:'d891c176ce65beed5dd25eb57f6d98966f4e0ddaee110d61d9c4c3f957794669',
    skeleton:'1a87e7ec222736e787189d3ae30c95ce4dad9622ffe8b3fbaf0dedf8e0a6867b',
    inflatable:'9dd18a09026cee5e7fabfdf5e48d6cc987b8941f2daba87a1f040d7e66a11d4a'
  };
  for(const [character,hash] of Object.entries(hashes)) {
    const s=new Simulation('classic',character,'rigid-2.3.0');s.push('chest',6,1);
    for(let i=0;i<240;i++)s.step();
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(s.snapshot())).digest('hex'),hash);
    assert.equal(supportsReplay({engine:REPLAY_VERSION,character}),true);
  }
  assert.throws(()=>new Simulation('classic','human','unknown'),/Unsupported/);
});
