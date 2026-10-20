/* Rigid-body ragdoll adapter. Planck.js is vendored locally; no network at runtime. */
(function (root) {
  'use strict';
  const pl = typeof module !== 'undefined' && module.exports
    ? require('../vendor/planck-1.5.0.js') : root.planck;
  const legacy = typeof module !== 'undefined' && module.exports
    ? require('./physics-legacy.js') : root.DismountPhysicsLegacy;
  const profiles = typeof module !== 'undefined' && module.exports
    ? require('./body-profiles.js') : root.DismountBodyProfiles;
  const { Vec2, World, Box, Circle, RevoluteJoint, PrismaticJoint } = pl;
  const DT = 1 / 120, SUBSTEPS = 12, H = DT / SUBSTEPS, PPM = 70;
  const GRAVITY = 9.81, RAD = Math.PI / 180;
  const REPLAY_VERSION='rigid-3.1.0';
  const stair = { start: 220, top: 205, width: 48, rise: 31, count: 14, end: 892, floor: 639 };
  const LAYOUTS = {
    endless:{name:'Endless Stairs',count:24,width:48,rise:31,kind:'endless'},
    classic:{name:'Classic',count:14,width:48,rise:31},
    steep:{name:'Short & steep',count:8,width:48,rise:48},
    long:{name:'Long & shallow',count:18,width:52,rise:24},
    landing:{name:'Split flight',count:14,width:48,rise:31,landing:6},
    uneven:{name:'Uneven Steps',count:14,width:48,rise:31},
    shaft:{name:'The Shaft',count:5,kind:'shaft'},
    finalDrop:{name:'Final Drop',count:6,width:48,rise:31,drop:320}
  };
  function buildStair(id='classic', firstStep=0) {
    const spec=LAYOUTS[id]||LAYOUTS.classic;
    if(spec.kind==='shaft') {
      const ledges=[{x:220,y:330,width:90,side:'right'},{x:560,y:440,width:90,side:'left'},
        {x:220,y:550,width:110,side:'right'},{x:530,y:660,width:120,side:'left'},
        {x:220,y:770,width:110,side:'right'}].map(t=>({...t,height:20}));
      return {...spec,start:220,top:205,end:678,floor:900,treads:[],ledges,
        wall:{x:650,y:205,width:28,height:766}};
    }
    let x=220+(id==='endless'?firstStep*48:0),y=205+(id==='endless'?firstStep*31:0);
    const treads=Array.from({length:spec.count},(_,i)=>{
      const width=id==='uneven'?[32,70,40,56][i%4]:i===spec.landing?144:spec.width;
      const rise=id==='uneven'?[18,44,25,37][i%4]:spec.rise;
      y+=rise;const tread={x,y,width,rise,index:i+(id==='endless'?firstStep:0)};x+=width;return tread;
    });
    return {...spec,start:220,top:205,end:x,floor:y+(spec.drop||0),treads};
  }
  const {CHARACTERS}=profiles;
  const excludedContacts = new Set(['head:torso','pelvis:torso','abdomen:leftThigh','abdomen:rightThigh','leftUpperArm:neckLink','neckLink:rightUpperArm']);
  const pointNames = ['head','chest','hip','leftElbow','leftHand','rightElbow','rightHand','leftKnee','leftFoot','rightKnee','rightFoot','neck'];
  const v = (x, y) => Vec2(x / PPM, y / PPM);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  class Simulation {
    constructor(layout='classic',character='human',engine=REPLAY_VERSION) {
      if(legacy.supportsReplay({engine,character}))return new legacy.Simulation(layout,character,engine);
      if(engine!==REPLAY_VERSION&&engine!=='rigid-3.0.0')throw new Error('Unsupported physics version: '+engine);
      this.engine=engine;
      this.progressScoring=engine!=='rigid-3.0.0';
      this.layout=Object.hasOwn(LAYOUTS,layout)?layout:'classic';
      this.character=Object.hasOwn(CHARACTERS,character)?character:'human';
      this.profile=CHARACTERS[this.character];this.stair=buildStair(this.layout);this.reset();
    }
    reset() {
      this.stair=buildStair(this.layout);
      this.world = new World(Vec2(0, GRAVITY));
      this.world.setContinuousPhysics(true);
      this.bodies = []; this.bodyByName = {}; this.joints = [];
      this.time = 0; this.score = 0; this.hits = 0; this.active = false; this.settled = 0;
      this.impactScore=0;this.progressScore=0;
      this.damage = {Head:0,Torso:0,Arms:0,Legs:0}; this.impacts = []; this.cracks = [];
      this.strongestImpact = null;
      this.pendingPush = null; this.contactData = new WeakMap(); this.pendingImpacts = new Map();
      this.createStairs();
      // Collision silhouettes are independent of the calibrated mass properties.
      // Short cervical link; elbows near the waist and hands at the upper thigh.
      this.addCapsule('torso', 'Torso', [191,116], [190,133], 9);
      this.addCapsule('abdomen', 'Torso', [190,133], [190,143], 7);
      this.addCapsule('pelvis', 'Torso', [190,143], [190,150], 8);
      this.addCapsule('neckLink', 'Head', [191,116], [194,108], 4);
      this.addHead();
      this.addCapsule('leftUpperArm', 'Arms', [183,119], [172,140], 5);
      this.addCapsule('leftForearm', 'Arms', [172,140], [166,158], 4.5);
      this.addCapsule('rightUpperArm', 'Arms', [199,119], [210,140], 5);
      this.addCapsule('rightForearm', 'Arms', [210,140], [222,155], 4.5);
      this.addCapsule('leftThigh', 'Legs', [183,150], [182,174], 6);
      this.addCapsule('leftShin', 'Legs', [182,174], [170,197], 5.5);
      this.addCapsule('rightThigh', 'Legs', [198,150], [210,174], 6);
      this.addCapsule('rightShin', 'Legs', [210,174], [209,197], 5.5);
      this.addCapsule('leftHand', 'Arms', [166,158], [164,164], 4);
      this.addCapsule('rightHand', 'Arms', [222,155], [226,160], 4);
      this.addCapsule('leftFoot', 'Legs', [170,197], [181,199], 4.5);
      this.addCapsule('rightFoot', 'Legs', [209,197], [219,199], 4.5);
      this.addHinge('thoracicSpine','torso','abdomen',[190,133],-20,25,1,3,6500);
      this.addHinge('lumbarSpine','abdomen','pelvis',[190,143],-25,30,2,4,7000);
      for (const side of ['left','right']) {
        const wrist = side==='left' ? [166,158] : [222,155];
        const ankle = side==='left' ? [170,197] : [209,197];
        const hand=this.bodyByName[side+'Hand'].body, forearm=this.bodyByName[side+'Forearm'].body;
        const foot=this.bodyByName[side+'Foot'].body, shin=this.bodyByName[side+'Shin'].body;
        this.addHinge(side+'Wrist',side+'Forearm',side+'Hand',wrist,-65,65,side==='left'?4:6,0.35,1600,hand.getAngle()-forearm.getAngle());
        this.addHinge(side+'Ankle',side+'Shin',side+'Foot',ankle,-35,50,side==='left'?8:10,1.2,3400,foot.getAngle()-shin.getAngle());
      }
      this.addHinge('leftShoulder', 'torso', 'leftUpperArm', [183,119], -190,60, 1, 2.5, 3200);
      this.addHinge('rightShoulder', 'torso', 'rightUpperArm', [199,119], -190,60, 1, 2.5, 3200);
      this.addHinge('leftElbow', 'leftUpperArm', 'leftForearm', [172,140], -150,0, 3, 1.2, 2400);
      this.addHinge('rightElbow', 'rightUpperArm', 'rightForearm', [210,140], -150,0, 5, 1.2, 2400);
      this.addHinge('leftHip', 'pelvis', 'leftThigh', [183,150], -120,35, 2, 4, 5200);
      this.addHinge('rightHip', 'pelvis', 'rightThigh', [198,150], -120,35, 2, 4, 5200);
      this.addHinge('leftKnee', 'leftThigh', 'leftShin', [182,174], 0,145, 7, 2.2, 3800);
      this.addHinge('rightKnee', 'rightThigh', 'rightShin', [210,174], 0,145, 9, 2.2, 3800);
      const neck = this.addHinge('neck', 'neckLink', 'head', [194,108], -65,65, 0, 0.7, 1800, Math.PI/2);
      const torso = this.bodyByName.torso.body, cervical = this.bodyByName.neckLink.body;
      const axis = Vec2(3,-8); axis.normalize();
      neck.slider = this.world.createJoint(new PrismaticJoint({
        enableLimit:true, lowerTranslation:-this.profile.neck.compression, upperTranslation:this.profile.neck.extension,
        collideConnected:false
      }, torso, cervical, v(191,116), axis));
      // A body already joined to another cannot collide with it. All other segments
      // collide, including opposite limbs and forearms against the torso.
      this.world.on('pre-solve', contact => this.prepareContact(contact));
      this.world.on('post-solve', (contact, impulse) => this.recordContact(contact, impulse));
      this.applyCharacterProfile();
      this.syncPoints();
      this.stats={steps:0,distance:0,maxSpeed:0,airtime:0,maxFlightSteps:0};
      this.flightStart=null;
      this.previousCenter=this.massCenter();
    }
    applyCharacterProfile() {
      const p=this.profile,properties=profiles.properties(this.character,this.bodies,PPM);
      this.bodies.forEach((s,i)=>{
        const {mass,center,inertia}=properties[i];
        s.mass=mass;s.inertia=inertia;
        // Planck expects I about the local origin, then subtracts the COM offset.
        s.body.setMassData({mass,center:Vec2(center.x,center.y),I:inertia+mass*(center.x**2+center.y**2)});
        s.body.setLinearDamping(p.air);s.body.setAngularDamping(p.spin);
        for(let f=s.body.getFixtureList();f;f=f.getNext()){f.setFriction(p.friction);f.setRestitution(p.bounce);}
      });
      for(const j of this.joints) {
        // Effective inertia about the hinge gives a material-specific decay time,
        // rather than applying the same damping to tiny hands and a heavy torso.
        const atAnchor=(body,anchor)=>{
          const c=body.getWorldCenter(),s=body.getUserData();
          return s.inertia+s.mass*((anchor.x-c.x)**2+(anchor.y-c.y)**2);
        };
        const a=atAnchor(j.a,j.hinge.getAnchorA()),b=atAnchor(j.b,j.hinge.getAnchorB());
        j.damping=(a*b/(a+b))/p.decay;
        j.maxTorque*=p.torque;j.maxForce*=p.strength;
        j.min-=p.flex*RAD;j.max+=p.flex*RAD;j.hinge.setLimits(j.min,j.max);
        if(j.slider) {
          const head=this.bodyByName.head.mass+this.bodyByName.neckLink.mass;
          const trunk=this.bodyByName.torso.mass+this.bodyByName.abdomen.mass+this.bodyByName.pelvis.mass;
          const reducedMass=head*trunk/(head+trunk),omega=2*Math.PI*p.neck.frequency;
          j.spring={stiffness:reducedMass*omega**2,damping:2*p.neck.damping*reducedMass*omega,
            maxForce:2*reducedMass*omega**2*p.neck.extension+head*GRAVITY};
        }
      }
    }
    createStairs() {
      const stair=this.stair;
      const ground = this.world.createBody();
      const add = (x, y, width, height, edge = false) => {
        ground.createFixture(Box(width/PPM/2,height/PPM/2,v(x+width/2,y+height/2)), {
          friction:0.55,restitution:0.12,userData:{ground:true,edge:edge ? {x:edge==='left'?x:x+width,y} : null}
        });
      };
      this.addGroundStep=add;
      add(-1000,stair.top,1220,1200,true);
      if(stair.kind==='shaft') {
        for(const t of stair.ledges)add(t.x,t.y,t.width,t.height,t.side);
        const w=stair.wall;add(w.x,w.y,w.width,w.height,'left');
        add(stair.start,stair.floor,4000,1200);
      } else {
        stair.treads.forEach((t,i)=>add(t.x,t.y,t.width,1200,i<stair.count-1||!!stair.drop||stair.kind==='endless'));
        if(stair.kind!=='endless')add(stair.end,stair.floor,4000,1200);
      }
      // Out-of-camera world boundaries keep extreme dismounts contained.
      add(-1100,-2000,50,4000); if(stair.kind!=='endless')add(1800,-2000,50,4000);
    }
    extendEndlessStairs() {
      const stair=this.stair;
      const ahead=Math.max(...this.bodies.map(s=>s.body.getPosition().x*PPM))+900;
      while(stair.end<ahead) {
        const t={x:stair.end,y:stair.floor+31,width:48,rise:31,index:stair.treads.length};
        this.addGroundStep(t.x,t.y,t.width,1200,true);
        stair.treads.push(t);stair.end+=48;stair.floor=t.y;stair.count++;
      }
    }
    addCapsule(name, group, start, end, radius) {
      const length = Math.hypot(end[0]-start[0],end[1]-start[1]);
      const angle = Math.atan2(end[1]-start[1],end[0]-start[0]);
      const body = this.world.createDynamicBody({
        position:v((start[0]+end[0])/2,(start[1]+end[1])/2),angle,
        bullet:true,linearDamping:0.04,angularDamping:0.06
      });
      const half = length/PPM/2, r = radius/PPM;
      const def = {density:1,friction:0.48,restitution:0.12};
      body.createFixture(Box(half,r),def);
      body.createFixture(Circle(Vec2(-half,0),r),def);
      body.createFixture(Circle(Vec2(half,0),r),def);
      const segment = {name,group,body,length,radius,mass:body.getMass(),cooldown:0,flash:0,damage:0,hits:0};
      body.setUserData(segment); this.bodies.push(segment); this.bodyByName[name] = segment;
      return segment;
    }
    addHead() {
      const body = this.world.createDynamicBody({position:v(194,95),bullet:true,linearDamping:0.04,angularDamping:0.06});
      body.createFixture(Circle(14/PPM),{density:1,friction:0.4,restitution:0.15});
      const segment = {name:'head',group:'Head',body,length:0,radius:14,mass:body.getMass(),cooldown:0,flash:0,damage:0,hits:0};
      body.setUserData(segment); this.bodies.push(segment); this.bodyByName.head = segment;
    }
    addHinge(name, parentName, childName, anchor, min, max, marker, damping, maxForce, reference = 0) {
      const a = this.bodyByName[parentName].body, b = this.bodyByName[childName].body;
      const hinge = this.world.createJoint(new RevoluteJoint({
        referenceAngle:reference,enableLimit:true,lowerAngle:min*RAD,upperAngle:max*RAD,
        enableMotor:true,motorSpeed:0,maxMotorTorque:0,collideConnected:false
      },a,b,v(...anchor)));
      const joint = {name,a,b,hinge,min:min*RAD,max:max*RAD,marker,damage:0,broken:false,
        damping,maxTorque:damping*3,maxForce,maxReaction:0};
      this.joints.push(joint);
      return joint;
    }
    jointAngle(joint) { return joint.hinge.getJointAngle(); }
    endpoints(segment) {
      const body = segment.body, half = segment.length/PPM/2;
      return [body.getWorldPoint(Vec2(-half,0)),body.getWorldPoint(Vec2(half,0))];
    }
    syncPoints() {
      const torso = this.endpoints(this.bodyByName.torso);
      const positions = [this.bodyByName.head.body.getPosition(),torso[0],this.endpoints(this.bodyByName.pelvis)[1],
        this.endpoints(this.bodyByName.leftUpperArm)[1],this.endpoints(this.bodyByName.leftHand)[1],
        this.endpoints(this.bodyByName.rightUpperArm)[1],this.endpoints(this.bodyByName.rightHand)[1],
        this.endpoints(this.bodyByName.leftThigh)[1],this.bodyByName.leftFoot.body.getWorldCenter(),
        this.endpoints(this.bodyByName.rightThigh)[1],this.bodyByName.rightFoot.body.getWorldCenter()];
      const owners = ['head','torso','pelvis','leftUpperArm','leftHand','rightUpperArm','rightHand','leftThigh','leftFoot','rightThigh','rightFoot'];
      // Append new targets so existing joint-marker indices and historical snapshots stay intact.
      if(this.engine!=='rigid-3.0.0') {
        positions.push(this.bodyByName.neckLink.body.getWorldCenter());owners.push('neckLink');
      }
      this.points = positions.map((p,i) => ({name:pointNames[i],x:p.x*PPM,y:p.y*PPM,
        flash:this.bodyByName[owners[i]].flash,bodyName:owners[i]}));
    }
    push(name, angle, power) {
      if (this.active) return;
      const strength = Number.isFinite(power) ? clamp(power,0,1) : 0;
      const point = this.points.find(p=>p.name===name) || this.points[1];
      const segment = this.bodyByName[point.bodyName], rad = angle*RAD;
      // Deliver the impulse over 0.2 seconds: a short push, not a teleport or a
      // simultaneous velocity assignment to every limb. Off-center pushes add torque.
      const impulse = this.bodies.reduce((sum,s)=>sum+s.mass,0)*4.6*strength;
      this.pendingPush = strength ? {body:segment.body,local:segment.body.getLocalPoint(v(point.x,point.y)),
        x:Math.cos(rad)*impulse,y:-Math.sin(rad)*impulse,remaining:0.2,
        fineSteps:strength>.8&&/Hand|Foot|neckLink/.test(segment.name)} : null;
      this.active = true;
      for (const segment of this.bodies) segment.body.setAwake(true);
    }
    applyJointForces(h=H) {
      for (const joint of this.joints) {
        const speed = joint.hinge.getJointSpeed();
        // A bounded, dissipative motor approximates viscous angular damping.
        joint.hinge.setMaxMotorTorque(joint.broken ? 0.03 : Math.min(joint.maxTorque,joint.damping*Math.abs(speed)));
        if (!joint.slider) continue;
        const axis = joint.slider.getBodyA().getWorldVector(joint.slider.getLocalAxisA());
        const translation = joint.slider.getJointTranslation(), velocity = joint.slider.getJointSpeed();
        const settings = joint.spring, strength = joint.broken ? 0.25 : 1;
        const force = clamp(-(translation*settings.stiffness+velocity*settings.damping)*strength,-settings.maxForce,settings.maxForce);
        const impulse = Vec2(axis.x*force*h,axis.y*force*h);
        joint.slider.getBodyB().applyLinearImpulse(impulse,joint.slider.getAnchorB(),true);
        joint.slider.getBodyA().applyLinearImpulse(Vec2(-impulse.x,-impulse.y),joint.slider.getAnchorA(),true);
      }
    }
    prepareContact(contact) {
      const fa=contact.getFixtureA(), fb=contact.getFixtureB();
      const a=fa.getBody(), b=fb.getBody();
      // Thick capsules near the same anatomical junction overlap by construction.
      // Exclude these structural neighbors; distant limbs still self-collide.
      const aName=a.getUserData()?.name||'',bName=b.getUserData()?.name||'';
      const names=aName<bName?aName+':'+bName:bName+':'+aName;
      if (excludedContacts.has(names)) {
        contact.setEnabled(false);return;
      }
      const manifold=contact.getWorldManifold(null);
      if (!manifold || !manifold.points.length) return;
      const normal=manifold.normal;
      let speed=0, position=manifold.points[0];
      for (let i=0;i<contact.getManifold().pointCount;i++) {
        const p=manifold.points[i], va=a.getLinearVelocityFromWorldPoint(p), vb=b.getLinearVelocityFromWorldPoint(p);
        const closing=-(vb.x-va.x)*normal.x-(vb.y-va.y)*normal.y;
        if (closing>speed) { speed=closing; position=p; }
      }
      const terrain=fa.getUserData()?.ground ? fa.getUserData() : fb.getUserData();
      const edge=terrain?.edge;
      const edgeFactor=edge ? clamp(1-Math.hypot(position.x*PPM-edge.x,position.y*PPM-edge.y)/9,0,1) : 0;
      // Human skin/clothing uses a tuned mix; other subjects mix fixture materials.
      const friction=this.character==='human'?.48:Math.sqrt(fa.getFriction()*fb.getFriction());
      const bounce=this.character==='human'?.1:Math.max(fa.getRestitution(),fb.getRestitution());
      contact.setFriction(friction+0.2*edgeFactor);
      contact.setRestitution(Math.min(.8,bounce+0.15*edgeFactor));
      this.contactData.set(contact,{speed,position:{x:position.x,y:position.y},edgeFactor,
        self:!!a.getUserData()&&!!b.getUserData()});
    }
    recordContact(contact, impulse) {
      const data=this.contactData.get(contact);
      if (!data || data.speed*PPM<=65) return;
      const momentum=impulse.normalImpulses.reduce((sum,n)=>sum+n,0);
      if (momentum<0.03) return;
      for (const fixture of [contact.getFixtureA(),contact.getFixtureB()]) {
        const segment=fixture.getBody().getUserData();
        if (!segment || segment.cooldown>0) continue;
        const candidate={...data,momentum,segment};
        const previous=this.pendingImpacts.get(segment);
        if (!previous || candidate.speed*(1+candidate.edgeFactor)>previous.speed*(1+previous.edgeFactor)) this.pendingImpacts.set(segment,candidate);
      }
    }
    breakJoint(joint) {
      if (joint.broken) return;
      joint.broken=true; joint.damage=1;
      // Dislocation relaxes the joint, but attached tissue still prevents free spinning.
      // These are arcade constraints, not clinical ranges of motion.
      const extra=joint.name.includes('Shoulder')?25:joint.name.includes('Spine')?25:40;
      joint.hinge.setLimits(joint.min-extra*RAD,joint.max+extra*RAD);
      joint.hinge.enableLimit(true);
      joint.hinge.setMaxMotorTorque(0.03);
      if(joint.slider)joint.slider.setLimits(-this.profile.neck.compression*2,this.profile.neck.injured);
      this.cracks.push({strength:1,fracture:true,variant:this.joints.indexOf(joint)%6});
      joint.b.getUserData().flash=1;
    }
    damageJoints(segment, impact) {
      if (impact<=260) return;
      for (const joint of this.joints) {
        if (joint.broken || (joint.a!==segment.body && joint.b!==segment.body)) continue;
        joint.damage=clamp(joint.damage+((impact-260)/(520*this.profile.strength))**2*(joint.b===segment.body?1:0.45),0,1);
        if (joint.damage>=1) this.breakJoint(joint);
      }
    }
    processImpacts() {
      for (const hit of this.pendingImpacts.values()) {
        const s=hit.segment;
        if (s.cooldown>0) continue;
        const severity=1+hit.edgeFactor*1.25, impact=hit.speed*PPM;
        const force=impact*severity*(hit.self?0.65:1);
        const points=Math.max(0,Math.round((impact-50)*(s.group==='Head'?2.8:1.4)*severity*(hit.self?0.65:1)));
        s.damage+=points;s.hits++;
        this.impactScore+=points;this.damage[s.group]+=points;this.hits++;s.cooldown=0.18;s.flash=1;
        this.damageJoints(s,force);
        const event={self:hit.self,segment:s.name,x:hit.position.x*PPM,y:hit.position.y*PPM,points,force,
          group:s.group,variant:this.hits%6,edge:hit.edgeFactor>0.5};
        this.impacts.push(event);
        if(!this.strongestImpact||points>this.strongestImpact.points)this.strongestImpact={...event};
        if (force>280) this.cracks.push({strength:Math.min(1,force/800),variant:this.hits%6});
      }
      this.updateScore();
    }
    updateScore() {
      // Count furthest progress once. Old recipes retain impact-only scoring.
      this.progressScore=this.progressScoring?Math.min(this.stats.steps*10,Math.floor(this.impactScore/5)):0;
      this.score=this.impactScore+this.progressScore;
    }
    massCenter() {
      let x=0,y=0,vx=0,vy=0,mass=0;
      for(const s of this.bodies) {
        const p=s.body.getWorldCenter(),velocity=s.body.getLinearVelocity();
        x+=p.x*s.mass;y+=p.y*s.mass;vx+=velocity.x*s.mass;vy+=velocity.y*s.mass;mass+=s.mass;
      }
      return {x:x/mass,y:y/mass,speed:Math.hypot(vx,vy)/mass};
    }
    updateStats() {
      const center=this.massCenter(), previous=this.previousCenter;
      this.stats.distance+=Math.hypot(center.x-previous.x,center.y-previous.y);
      this.stats.maxSpeed=Math.max(this.stats.maxSpeed,center.speed);
      this.previousCenter=center;
      const x=center.x*PPM,y=center.y*PPM;
      const surfaces=this.stair.kind==='shaft'?this.stair.ledges:this.stair.treads;
      let passed=0;for(const t of surfaces)if(y>=t.y&&(this.stair.kind==='shaft'||x>=t.x))passed++;
      this.stats.steps=Math.max(this.stats.steps,passed);
      let grounded=false;
      for(let c=this.world.getContactList();c;c=c.getNext()) {
        if(c.isEnabled()&&c.isTouching()&&(c.getFixtureA().getUserData()?.ground||c.getFixtureB().getUserData()?.ground)) {
          grounded=true;break;
        }
      }
      if(!grounded) {
        this.stats.airtime+=DT;
        if(this.flightStart===null)this.flightStart=passed;
      }
      if(this.flightStart!==null) {
        this.stats.maxFlightSteps=Math.max(this.stats.maxFlightSteps,passed-this.flightStart);
        if(grounded)this.flightStart=null;
      }
      this.updateScore();
    }
    step() {
      if (!this.active) return;
      if(this.layout==='endless')this.extendEndlessStairs();
      this.impacts=[];this.cracks=[];this.pendingImpacts.clear();
      for (const s of this.bodies) { s.cooldown=Math.max(0,s.cooldown-DT);s.flash=Math.max(0,s.flash-DT*2); }
      // Small segments need finer integration during a strong localized push.
      const substeps=this.pendingPush?.fineSteps?24:SUBSTEPS,h=DT/substeps;
      for (let sub=0;sub<substeps;sub++) {
        if (this.pendingPush) {
          const p=this.pendingPush, fraction=Math.min(h,p.remaining)/0.2;
          p.body.applyLinearImpulse(Vec2(p.x*fraction,p.y*fraction),p.body.getWorldPoint(p.local),true);
          p.remaining-=h;
          if (p.remaining<1e-8) this.pendingPush=null;
        }
        this.applyJointForces(h);
        this.world.step(h,24,32);
        this.time+=h;
        // Measured reaction forces impose a strength budget in addition to collision trauma.
        for (const joint of this.joints) {
          const reaction=joint.hinge.getReactionForce(1/h), force=Math.hypot(reaction.x,reaction.y);
          joint.maxReaction=Math.max(joint.maxReaction,force);
          if (!joint.broken && this.time>0.15 && force>joint.maxForce) {
            joint.damage=clamp(joint.damage+(force/joint.maxForce-1)**2*h*3,0,1);
            if (joint.damage>=1) this.breakJoint(joint);
          }
        }
      }
      this.processImpacts();this.syncPoints();this.updateStats();
      const quiet=this.bodies.every(s=>s.body.getLinearVelocity().length()<0.08 && Math.abs(s.body.getAngularVelocity())<0.18);
      this.settled=quiet ? this.settled+DT : 0;
      if ((this.time>2 && this.settled>1.3) || this.time>=(this.layout==='endless'?120:18)) this.active=false;
    }
    snapshot() {
      return {layout:this.layout,character:this.character,stats:{...this.stats},points:this.points.map(p=>({...p})),
        segments:this.bodies.map(s=>{const [a,b]=this.endpoints(s);return {name:s.name,group:s.group,
          ax:a.x*PPM,ay:a.y*PPM,bx:b.x*PPM,by:b.y*PPM,radius:s.radius,angle:s.body.getAngle(),flash:s.flash,damage:s.damage,hits:s.hits};}),
        joints:this.joints.map(j=>({name:j.name,parent:j.a.getUserData().name,child:j.b.getUserData().name,b:j.marker,x:j.hinge.getAnchorB().x*PPM,y:j.hinge.getAnchorB().y*PPM,broken:j.broken,damage:j.damage})),
        strongestImpact:this.strongestImpact?{...this.strongestImpact}:null,
        cracks:this.cracks.map(c=>({...c})),score:this.score,hits:this.hits,damage:{...this.damage},time:this.time};
    }
  }
  root.DismountPhysics={Simulation,stair,LAYOUTS,CHARACTERS,buildStair,DT,PPM,GRAVITY,REPLAY_VERSION,
    supportsReplay:entry=>entry.engine===REPLAY_VERSION||entry.engine==='rigid-3.0.0'||legacy.supportsReplay(entry)};
  if (typeof module!=='undefined') module.exports=root.DismountPhysics;
})(typeof window!=='undefined'?window:globalThis);
