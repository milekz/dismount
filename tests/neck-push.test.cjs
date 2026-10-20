const test=require('node:test');
const assert=require('node:assert/strict');
const {Simulation,CHARACTERS,PPM,DT}=require('../src/physics.js');

test('neck pushes target the cervical segment at its center of mass for every subject',()=>{
  for(const character of Object.keys(CHARACTERS)) {
    const s=new Simulation('classic',character),point=s.points.find(p=>p.name==='neck');
    const neck=s.bodyByName.neckLink.body,center=neck.getWorldCenter();
    assert.equal(point.bodyName,'neckLink');
    assert.equal(point.x,center.x*PPM);assert.equal(point.y,center.y*PPM);
    s.push('neck',6,1);
    assert.equal(s.pendingPush.body,neck);assert.equal(s.pendingPush.fineSteps,true);
    const appliedAt=neck.getWorldPoint(s.pendingPush.local);
    assert.ok(Math.hypot(appliedAt.x-center.x,appliedAt.y-center.y)<1e-12);
    assert.equal(s.points[2].name,'hip','Existing camera and joint-marker indices must stay stable');
  }
});

test('zero-power neck release adds no impulse and matches other gravity-only drops',()=>{
  for(const character of Object.keys(CHARACTERS)) {
    const neck=new Simulation('classic',character),chest=new Simulation('classic',character);
    neck.push('neck',100,0);chest.push('chest',0,0);
    assert.equal(neck.pendingPush,null);
    for(let i=0;i<60;i++){neck.step();chest.step();}
    assert.deepEqual(neck.snapshot(),chest.snapshot());
  }
});

test('full-power neck pushes keep every joint bounded across all subjects and extreme angles',()=>{
  for(const character of Object.keys(CHARACTERS))for(const angle of [-100,6,90,100]) {
    const s=new Simulation('classic',character);s.push('neck',angle,1);
    // Follow a complete ordinary fall; extreme-angle cases include launch and first impacts.
    const duration=angle===6?18.1:3;
    for(let tick=0;s.active&&tick<Math.ceil(duration/DT);tick++) {
      s.step();
      for(const segment of s.bodies) {
        const position=segment.body.getPosition();
        assert.ok(Number.isFinite(position.x)&&Number.isFinite(position.y)&&Number.isFinite(segment.body.getAngle()));
      }
      for(const joint of s.joints) {
        const actual=s.jointAngle(joint),tolerance=6*Math.PI/180;
        const label=`${character}/${angle}: ${joint.name} at ${s.time.toFixed(3)} s`;
        assert.ok(actual>=joint.hinge.getLowerLimit()-tolerance&&actual<=joint.hinge.getUpperLimit()+tolerance,label);
        if(joint.slider) {
          const travel=joint.slider.getJointTranslation();
          assert.ok(travel>=joint.slider.getLowerLimit()-.01&&travel<=joint.slider.getUpperLimit()+.01,label+' neck travel');
        }
      }
    }
    if(angle===6)assert.equal(s.active,false);
  }
});
