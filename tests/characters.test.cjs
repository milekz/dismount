const test=require('node:test');
const assert=require('node:assert/strict');
const {Simulation,CHARACTERS,PPM}=require('../src/physics.js');
const subjects=Object.keys(CHARACTERS).filter(id=>id!=='human');

function fall(character,layout='classic',part='chest',angle=15,power=.8) {
  const s=new Simulation(layout,character);s.push(part,angle,power);
  for(let tick=0;s.active&&tick<2200;tick++) {
    s.step();
    for(const b of s.bodies) {
      const p=b.body.getPosition();
      assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(b.body.getAngle()),character+' finite body');
      assert.ok(p.y*PPM<s.stair.floor+2,character+' floor collision');
    }
    for(const j of s.joints) {
      const angle=s.jointAngle(j),tolerance=6*Math.PI/180;
      assert.equal(j.hinge.isLimitEnabled(),true);
      assert.ok(angle>=j.hinge.getLowerLimit()-tolerance&&angle<=j.hinge.getUpperLimit()+tolerance,`${character}/${layout}/${j.name}: angle ${angle}`);
      if(j.slider) {
        const travel=j.slider.getJointTranslation();
        assert.ok(travel>=j.slider.getLowerLimit()-.01&&travel<=j.slider.getUpperLimit()+.01,
          `${character}/${layout}: neck translation ${travel}`);
      }
    }
  }
  assert.equal(s.active,false,character+' completes');
  assert.equal(s.snapshot().character,character);
  return s.snapshot();
}

test('human remains default and profiles have distinct mass, materials and bounded joints',()=>{
  const human=new Simulation();assert.equal(human.character,'human');
  assert.equal(new Simulation('classic','unknown').character,'human');
  const masses=new Set();
  for(const id of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',id);
    masses.add(s.bodies.reduce((sum,b)=>sum+b.mass,0));
    for(const b of s.bodies)assert.ok(Math.abs(b.body.getMass()-b.mass)<1e-8);
    for(const j of s.joints) {
      assert.ok(s.jointAngle(j)>=j.min&&s.jointAngle(j)<=j.max,id+'/'+j.name);
      s.breakJoint(j);assert.ok(j.hinge.getUpperLimit()-j.hinge.getLowerLimit()<2*Math.PI);
    }
    s.reset();assert.equal(s.character,id);assert.ok(s.joints.every(j=>!j.broken));
  }
  assert.equal(masses.size,Object.keys(CHARACTERS).length);
});
for(const id of subjects) {
  test(id+' falls and replays deterministically',()=>{
    assert.deepEqual(fall(id),fall(id));
  });
  test(id+' stays bounded for zero force and extreme head and foot pushes',()=>{
    fall(id,'classic','chest',0,0);
    fall(id,'shaft','head',100,1);
    fall(id,'finalDrop','leftFoot',-100,1);
  });
}

test('flat contacts preserve subject materials and edges add their bonus',()=>{
  for(const id of ['human','robot','knight','skeleton','inflatable']) {
    const s=new Simulation('classic',id),observed=[];
    s.world.on('pre-solve',c=>{
      if(!c.isEnabled())return;
      const a=c.getFixtureA(),b=c.getFixtureB();
      if(!(a.getUserData()?.ground||b.getUserData()?.ground))return;
      const info=s.contactData.get(c);if(!info)return;
      const baseFriction=id==='human'?.48:Math.sqrt(a.getFriction()*b.getFriction());
      const baseBounce=id==='human'?.1:Math.max(a.getRestitution(),b.getRestitution());
      assert.ok(Math.abs(c.getFriction()-(baseFriction+.2*info.edgeFactor))<1e-12,id+' friction');
      assert.ok(Math.abs(c.getRestitution()-(baseBounce+.15*info.edgeFactor))<1e-12,id+' bounce');
      observed.push(info.edgeFactor);
    });
    s.push('chest',15,.8);for(let i=0;i<60;i++)s.step();
    assert.ok(observed.some(edge=>edge===0),id+' flat contact');
    assert.ok(observed.some(edge=>edge>0),id+' edge contact');
  }
});
