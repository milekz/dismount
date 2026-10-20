/* Read-only solver telemetry and its optional Canvas overlay. */
(function(root) {
  'use strict';
  const probes=new WeakMap(),PPM=70,MAX_CONTACTS=4;
  function probeFor(sim) {
    let probe=probes.get(sim);
    if(!probe||probe.world!==sim.world) {
      probe={world:sim.world,contacts:new Map(),duration:0};
      probes.set(sim,probe);
      sim.world.on('post-solve',(contact,impulse)=>{
        const a=contact.getFixtureA(),b=contact.getFixtureB();
        const groundA=!!a.getUserData()?.ground,groundB=!!b.getUserData()?.ground;
        if(groundA===groundB)return;
        const body=(groundA?b:a).getBody();
        if(!body.getUserData())return;
        const manifold=contact.getWorldManifold(null);
        if(!manifold)return;
        const normal=manifold.normal,sign=groundA?1:-1;
        const normals=impulse.normalImpulses,tangents=impulse.tangentImpulses;
        let sum=probe.contacts.get(body);
        for(let i=0;i<contact.getManifold().pointCount;i++) {
          const n=normals[i]||0,t=tangents[i]||0,weight=Math.hypot(n,t);
          if(!weight)continue;
          if(!sum){sum={x:0,y:0,fx:0,fy:0,weight:0};probe.contacts.set(body,sum);}
          const p=manifold.points[i];
          sum.x+=p.x*weight;sum.y+=p.y*weight;sum.weight+=weight;
          // Planck's tangent is cross(normal, 1): (normal.y, -normal.x).
          sum.fx+=sign*(normal.x*n+normal.y*t);
          sum.fy+=sign*(normal.y*n-normal.x*t);
        }
      });
    }
    return probe;
  }
  function step(sim) {
    const probe=probeFor(sim),before=sim.time;
    probe.contacts.clear();sim.step();probe.duration=sim.time-before;
  }
  function sample(sim) {
    const probe=probeFor(sim);
    let x=0,y=0,vx=0,vy=0,mass=0;
    for(const {body} of sim.bodies) {
      const m=body.getMass(),p=body.getWorldCenter(),v=body.getLinearVelocity();
      mass+=m;x+=p.x*m;y+=p.y*m;vx+=v.x*m;vy+=v.y*m;
    }
    const contacts=probe.duration>0?[...probe.contacts.values()].map(c=>({
      x:c.x/c.weight,y:c.y/c.weight,fx:c.fx/probe.duration,fy:c.fy/probe.duration
    })).filter(c=>Math.hypot(c.fx,c.fy)>.5)
      .sort((a,b)=>Math.hypot(b.fx,b.fy)-Math.hypot(a.fx,a.fy)).slice(0,MAX_CONTACTS):[];
    return {x:x/mass,y:y/mass,vx:vx/mass,vy:vy/mass,mass,contacts};
  }
  function snapshot(sim) {return {...sim.snapshot(),physics:sample(sim)};}
  function draw(ctx,data,scale=1) {
    if(!data)return;
    const size=1/scale;
    function line(x,y,dx,dy,color,width=2) {
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx,y+dy);
      ctx.strokeStyle=color;ctx.lineWidth=width*size;ctx.stroke();
    }
    function label(text,x,y,color) {
      ctx.font=11*size+'px monospace';ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillStyle='#f7f6f1ee';ctx.fillRect(x-3*size,y-8*size,(text.length*6.7+6)*size,16*size);
      ctx.fillStyle=color;ctx.fillText(text,x,y);
    }
    function arrow(x,y,dx,dy,length,color) {
      const magnitude=Math.hypot(dx,dy);
      if(!magnitude)return;
      const ux=dx/magnitude,uy=dy/magnitude,ex=x+ux*length*size,ey=y+uy*length*size;
      line(x,y,ex-x,ey-y,color);
      ctx.beginPath();ctx.moveTo(ex,ey);
      ctx.lineTo(ex-(ux*7-uy*4)*size,ey-(uy*7+ux*4)*size);
      ctx.lineTo(ex-(ux*7+uy*4)*size,ey-(uy*7-ux*4)*size);
      ctx.closePath();ctx.fillStyle=color;ctx.fill();
      return {x:ex,y:ey};
    }
    ctx.save();ctx.globalAlpha=1;ctx.setLineDash([]);ctx.lineCap='round';
    for(const c of data.contacts) {
      const force=Math.hypot(c.fx,c.fy),x=c.x*PPM,y=c.y*PPM;
      const end=arrow(x,y,c.fx,c.fy,Math.min(70,12+Math.log1p(force/100)*14),'#bc4a2c');
      ctx.beginPath();ctx.arc(x,y,2.5*size,0,Math.PI*2);ctx.fillStyle='#bc4a2c';ctx.fill();
      label(Math.round(force)+' N',end.x+5*size,end.y-5*size,'#bc4a2c');
    }
    const x=data.x*PPM,y=data.y*PPM,speed=Math.hypot(data.vx,data.vy);
    const end=arrow(x,y,data.vx,data.vy,Math.min(90,speed*10),'#2166a5');
    ctx.beginPath();ctx.arc(x,y,6*size,0,Math.PI*2);ctx.fillStyle='#f7f6f1';ctx.fill();
    ctx.strokeStyle='#176c59';ctx.lineWidth=2*size;ctx.stroke();
    line(x-9*size,y,18*size,0,'#176c59',1.5);
    line(x,y-9*size,0,18*size,'#176c59',1.5);
    label('v '+speed.toFixed(2)+' m/s',(end?.x??x)+12*size,(end?.y??y)+16*size,'#2166a5');
    ctx.restore();
  }
  root.DismountPhysicsView={step,sample,snapshot,draw};
  if(typeof module!=='undefined')module.exports=root.DismountPhysicsView;
})(typeof window!=='undefined'?window:globalThis);
