const test=require('node:test');
const assert=require('node:assert/strict');
const pl=require('../vendor/planck-1.5.0.js');
const {Simulation,CHARACTERS,DT}=require('../src/physics.js');
const view=require('../src/physics-view.js');
const {Recording}=require('../src/replay.js');
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('overlay samples actual mass-weighted COM and velocity for all five subjects',()=>{
  for(const character of Object.keys(CHARACTERS)) {
    const sim=new Simulation('classic',character);
    for(const {body} of sim.bodies)body.setLinearVelocity(pl.Vec2(3,-4));
    const data=view.sample(sim),center=sim.massCenter();
    near(data.x,center.x);near(data.y,center.y);
    near(data.mass,{human:73,robot:110,knight:96,skeleton:10,inflatable:3}[character]);near(data.vx,3);near(data.vy,-4);
    near(Math.hypot(data.vx,data.vy),5);assert.deepEqual(data.contacts,[]);
  }
});

test('contact arrows include friction with correct signs and average impulses over the entire tick',()=>{
  for(const groundFirst of [false,true]) {
    const world=new pl.World(pl.Vec2(0,0));
    const ground=()=>world.createBody({position:pl.Vec2(0,2)}).createFixture(pl.Box(4,.2),{friction:.5,userData:{ground:true}});
    if(groundFirst)ground();
    const body=world.createDynamicBody({position:pl.Vec2(0,1.4),linearVelocity:pl.Vec2(3,4),userData:{name:'test'}});
    body.createFixture(pl.Circle(.3),{density:2,friction:.5});
    if(!groundFirst)ground();
    const sim={world,bodies:[{body}],time:0,step(){
      for(let i=0;i<12;i++){world.step(DT/12,24,32);this.time+=DT/12;}
    }};
    let observed=false;
    for(let i=0;i<20;i++) {
      const before=body.getLinearVelocity().clone(),time=sim.time;view.step(sim);
      const data=view.sample(sim),after=body.getLinearVelocity(),elapsed=sim.time-time;
      if(!data.contacts.length)continue;
      const c=data.contacts[0],mass=body.getMass();
      near(c.fx*elapsed,mass*(after.x-before.x));
      near(c.fy*elapsed,mass*(after.y-before.y));
      assert.ok(c.fx<0&&c.fy<0,'The floor must oppose downward motion and horizontal slip');
      assert.ok(c.y>1.7&&c.y<1.9);observed=true;break;
    }
    assert.ok(observed);
  }
});

test('telemetry leaves current and historical physics exactly unchanged and clears on reset',()=>{
  for(const engine of [undefined,'rigid-3.0.0','rigid-2.3.0','rigid-2.2.0']) {
    const observed=new Simulation('classic','human',engine),plain=new Simulation('classic','human',engine);
    view.snapshot(observed);observed.push('chest',6,1);plain.push('chest',6,1);
    let contactSeen=false;
    for(let i=0;i<240;i++) {
      view.step(observed);plain.step();contactSeen||=view.sample(observed).contacts.length>0;
    }
    assert.ok(contactSeen);assert.deepEqual(observed.snapshot(),plain.snapshot());
    observed.reset();const reset=view.sample(observed);
    assert.deepEqual(reset.contacts,[]);near(reset.vx,0);near(reset.vy,0);
  }
});

test('compact recordings retain physics data exactly through transfer, pause and random seeking',()=>{
  const sim=new Simulation(),frames=new Recording(),expected=[];
  sim.push('neck',6,1);
  for(let i=0;i<180;i++){view.step(sim);const frame=view.snapshot(sim);expected.push(frame);frames.push(frame);}
  const clone=Recording.from(structuredClone(frames.packet()));
  assert.ok(expected.some(f=>f.physics.contacts.length));
  assert.ok(expected.every(f=>f.physics.contacts.length<=4));
  for(const index of [179,0,127,128,30,179,30])assert.deepEqual(clone.at(index).physics,expected[index].physics);
  const old=new Recording();old.push(sim.snapshot());
  assert.equal(Recording.from(structuredClone(old.packet())).at(0).physics,undefined);
});

test('overlay draws labeled vectors at a constant readable screen size in both camera scales',()=>{
  const labels=[],arcs=[];let saves=0,restores=0;
  const ctx=new Proxy({save(){saves++;},restore(){restores++;},fillText(text){labels.push(text);},arc(...args){arcs.push(args);}},
    {get:(target,key)=>target[key]??(()=>{})});
  const data={x:2,y:3,vx:3,vy:4,mass:73,contacts:[{x:2,y:4,fx:0,fy:-1000}]};
  view.draw(ctx,undefined);assert.equal(saves,0);
  for(const scale of [.5,1]) {
    view.draw(ctx,data,scale);
    near(arcs.at(-1)[0],140);near(arcs.at(-1)[1],210);near(arcs.at(-1)[2]*scale,6);
  }
  assert.equal(saves,2);assert.equal(restores,2);
  assert.deepEqual(labels,['1000 N','v 5.00 m/s','1000 N','v 5.00 m/s']);
});
