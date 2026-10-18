/* Canvas renderer and game state. Runs directly from index.html, including file://. */
(() => {
  'use strict';
  const {Simulation, LAYOUTS, buildStair, DT, REPLAY_VERSION} = window.DismountPhysics;
  const {ScoreBoard, normalizeNick} = window.DismountScores;
  let storage;
  try { storage = localStorage; } catch (_) {}
  let layout='classic', board=new ScoreBoard(storage,REPLAY_VERSION,layout);
  const boards=new Map([[layout,board]]), bests=new Map();
  let sim = new Simulation(layout);
  let selectedBody='torso', motion=false, injuryRings=false, injuryLabels=true;
  try { injuryRings=storage?.getItem('dismount-injury-rings')==='on'; } catch (_) { /* Optional preference. */ }
  try { injuryLabels=storage?.getItem('dismount-injury-labels')!=='off'; } catch (_) { /* Optional preference. */ }
  const motionEnabled=()=>motion&&layout!=='endless';
  let camera=null, renderDelta=0, impactSlow=0, impactCooldown=0, shake=0;
  const bestKey=()=>layout==='classic'?'dismount-anatomy-best-v2':'dismount-anatomy-best-v2-'+layout;
  let runPush = null, pendingScore = null, playbackFrames = [], replayJob = null, replayLabel = '';
  const dom=new Map();
  const $ = id => {if(!dom.has(id))dom.set(id,document.getElementById(id));return dom.get(id);};
  const chambers=Object.fromEntries(Object.keys(LAYOUTS).map(id=>[id,buildStair(id)]));
  let replayPaused=false,replaySpeed=1,peakFrame=0,retryRecipe=null,presetPower=0,reportClock=0;
  let noticeLife=0;
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const groups = ['Head', 'Torso', 'Arms', 'Legs'];
  let mode = 'ready', power = 0, meterTime = 0, accumulator = 0, last = 0;
  let frames = [], replayIndex = 0, slow = false, perspective = true, best = 0;
  let sound = true, audio = null, particles = [], current = sim.snapshot();
  let launchPress = null, suppressLaunchClick = false;
  let drag = null, master = null, lastThud = -1, lastCrack = -1, noiseBuffers = new Map(), soundVariant = 0, chargeBeat = 0;
  let width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0;
  try { best = Math.max(0, Number(localStorage.getItem(bestKey())) || 0); } catch (_) { /* Storage may be disabled. */ }
  $('best').textContent = best.toLocaleString();
  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'damage-row';
    row.innerHTML = `<span>${group}</span><div><i id="bar-${group}"></i></div><b id="value-${group}">0</b>`;
    $('damage').appendChild(row);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    width = rect.width; height = rect.height;
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  function polygon(points, fill, stroke) {
    ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function line(a, b, color, thickness) {
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.lineCap='round';ctx.stroke();
  }
  function circle(x,y,r,color) { ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill(); }
  function render() {
    ctx.clearRect(0,0,width,height);
    const gradient=ctx.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#e7e9e0');gradient.addColorStop(1,'#dce0d2');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
    const endless=(current.layout||layout)==='endless';
    const firstStep=endless?Math.max(0,Math.floor((Math.min(...current.points.map(p=>p.x))-220)/48)-8):0;
    const stair=endless?buildStair('endless',firstStep):chambers[current.layout||layout];
    const farthest=Math.max(stair.end+158,...current.points.map(p=>p.x+80));
    const left=Math.min(0,...current.segments.map(s=>Math.min(s.ax,s.bx)-s.radius-40));
    const top=Math.min(0,...current.segments.map(s=>Math.min(s.ay,s.by)-s.radius-25));
    const span=farthest-left+30;
    const baseScale=Math.min((width-45)/span,(height-185)/(stair.floor+81-top));
    const target={scale:baseScale,x:(width-span*baseScale)/2+20-left*baseScale,y:135-top*baseScale};
    if(motionEnabled()&&(mode==='running'||mode==='replay')) {
      const xs=current.segments.flatMap(s=>[s.ax-s.radius,s.bx+s.radius]);
      const ys=current.segments.flatMap(s=>[s.ay-s.radius,s.by+s.radius]);
      const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      target.scale=Math.min(baseScale*1.65,(width-90)/(maxX-minX+150),(height-230)/(maxY-minY+110));
      target.x=width*.46-(minX+maxX)/2*target.scale;
      target.y=height*.53-(minY+maxY)/2*target.scale;
    }
    if(endless) {
      const p=current.points[2];
      // Match the classic overview zoom while following an unbounded staircase.
      const reference=chambers.classic;
      target.scale=Math.min((width-45)/(reference.end+188),(height-185)/(reference.floor+81));
      target.x=width*.42-p.x*target.scale;target.y=height*.48-p.y*target.scale;
    }
    if(width<600||height<420) {
      const p=current.points[2];
      target.scale=Math.min((width-40)/540,Math.max(100,height-150)/250);
      target.x=width*.38-p.x*target.scale;
      target.y=height*.48-p.y*target.scale;
    }
    if(!camera||mode==='ready'||mode==='charging'||mode==='aiming')camera={...target};
    const blend=1-Math.exp(-renderDelta*5);
    for(const key of ['scale','x','y'])camera[key]+=(target[key]-camera[key])*blend;
    scale=camera.scale;offsetX=camera.x;offsetY=camera.y;
    const jitter=motionEnabled()?Math.min(3,shake*12):0;
    ctx.save();ctx.translate(offsetX+Math.sin(last*.071)*jitter,offsetY+Math.cos(last*.093)*jitter);ctx.scale(scale,scale);
    const depthX=perspective?115:0,depthY=perspective?-68:0;
    ctx.strokeStyle='#cbd1c1';ctx.lineWidth=1;
    for(let x=-200;x<1700;x+=80){ctx.beginPath();ctx.moveTo(x,stair.floor+61);ctx.lineTo(x+450,stair.floor-199);ctx.stroke();}
    for(let y=stair.floor+11;y<stair.floor+211;y+=35){ctx.beginPath();ctx.moveTo(-150,y);ctx.lineTo(1700,y);ctx.stroke();}
    if(stair.kind==='shaft') {
      const block=(x,y,w,h,color)=>{
        polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],color,'#a2af93');
        polygon([[x,y],[x+w,y],[x+w+depthX,y+depthY],[x+depthX,y+depthY]],'#e3e7d9','#b8c2aa');
        line({x,y},{x:x+w,y},'#f5f5ed',2);
      };
      block(40,205,180,stair.floor-205+71,'#b6beaa');
      const w=stair.wall;block(w.x,w.y,w.width,w.height,'#acb79d');
      stair.ledges.forEach((t,i)=>{
        block(t.x,t.y,t.width,t.height,'#b6beaa');
        ctx.fillStyle='#718260';ctx.font='10px monospace';ctx.fillText('LEDGE '+(i+1),t.x+8,t.y+14);
      });
      block(stair.start,stair.floor,stair.end+208-stair.start,71,'#b6beaa');
    } else {
      // Staircase side silhouette, with separate tread and riser faces.
      const side=[[40,stair.top],[stair.start,stair.top]];
      for(const t of stair.treads)side.push([t.x,t.y],[t.x+t.width,t.y]);
      side.push([stair.end,stair.floor],[stair.end+118,stair.floor],[stair.end+118,stair.floor+71],[40,stair.floor+71]);
      polygon(side,'#b6beaa','#a5b098');
      polygon([[40,205],[220,205],[220+depthX,205+depthY],[40+depthX,205+depthY]],'#eff0e6','#bdc6b0');
      stair.treads.forEach((t,i)=>{
        const {x,y,width:w,rise}=t;
        polygon([[x,y-rise],[x+depthX,y-rise+depthY],[x+depthX,y+depthY],[x,y]],'#acb79d','#a2af93');
        polygon([[x,y],[x+w,y],[x+w+depthX,y+depthY],[x+depthX,y+depthY]],i%2?'#d9dece':'#e3e7d9','#b8c2aa');
        line({x,y},{x:x+w,y},'#f5f5ed',2);
        ctx.fillStyle='#8b997b';ctx.font='10px monospace';ctx.fillText(String(t.index+1).padStart(2,'0'),x+16,y+21);
      });
      if(!endless)polygon([[stair.end,stair.floor],[stair.end+208,stair.floor],[stair.end+208+depthX,stair.floor+depthY],[stair.end+depthX,stair.floor+depthY]],'#d4dbc7','#b8c2aa');
      if(stair.drop) {
        const y=stair.treads[stair.treads.length-1].y,x=stair.end;
        polygon([[x,y],[x+depthX,y+depthY],[x+depthX,stair.floor+depthY],[x,stair.floor]],'#acb79d','#a2af93');
        ctx.fillStyle='#a16243';ctx.font='12px monospace';ctx.fillText('FINAL DROP ↓',x-120,y+25);
      }
    }
    // Warning stripe on the starting ledge.
    for(let x=65;x<205;x+=18)polygon([[x,205],[x+9,205],[x+9,213],[x,213]],'#8e9a7d');
    ctx.fillStyle='#8b967e';ctx.font='12px monospace';ctx.fillText('START /',64,245);
    const pts=current.points;
    const center=pts[2],ground=center.x<220?205:stair.kind==='shaft'?(stair.ledges.find(t=>center.x>=t.x&&center.x<=t.x+t.width&&t.y>=center.y)?.y||stair.floor):(stair.treads.find(t=>center.x<t.x+t.width)?.y||stair.floor);
    ctx.save();ctx.globalAlpha=.13;ctx.fillStyle='#3f5032';ctx.beginPath();ctx.ellipse(center.x,ground,50,7,0,0,Math.PI*2);ctx.fill();ctx.restore();
    // Clothing and tapered silhouettes follow each rigid body's endpoints.
    // Render directly from the skeleton so proportions and collision shapes agree.
    const drawOrder = ['neckLink','leftUpperArm','leftForearm','leftHand','leftThigh','leftShin','leftFoot',
      'torso','abdomen','pelvis','rightThigh','rightShin','rightFoot','rightUpperArm','rightForearm','rightHand'];
    for (const name of drawOrder) {
      const segment = current.segments.find(s => s.name === name);
      const far = name.startsWith('left'), r = segment.radius;
      const length = Math.hypot(segment.bx-segment.ax,segment.by-segment.ay);
      const upper = name.includes('UpperArm'), leg = /Thigh|Shin/.test(name);
      const shoe = name.includes('Foot'), hand = name.includes('Hand');
      const shirt = name==='torso'||name==='abdomen';
      const trousers = leg||name==='pelvis';
      const skin = far?'#bd8869':'#e4b18b';
      const fabric = shirt||upper ? (far?'#456b6c':'#618c89') : (far?'#364756':'#4b6071');
      const color = shoe?'#303b40':shirt||trousers?fabric:skin;
      const startRadius = r*(name==='torso' ? 1.12 : hand ? .85 : 1);
      const endRadius = r*(name==='torso' ? .82 : /Forearm|Shin/.test(name) ? .72 : hand ? .9 : 1);
      ctx.save();ctx.translate(segment.ax,segment.ay);
      ctx.rotate(Math.atan2(segment.by-segment.ay,segment.bx-segment.ax)-Math.PI/2);
      ctx.beginPath();ctx.moveTo(-startRadius,0);
      ctx.quadraticCurveTo(0,-startRadius*1.6,startRadius,0);
      ctx.quadraticCurveTo(r*1.12,length*.45,endRadius,length);
      ctx.quadraticCurveTo(0,length+endRadius*1.6,-endRadius,length);
      ctx.quadraticCurveTo(-r*1.12,length*.45,-startRadius,0);
      ctx.closePath();ctx.fillStyle=color;ctx.fill();
      // Impact flashes outline the body without replacing clothing with skin tones.
      ctx.strokeStyle=segment.flash>.2?'#ffcf86':'#37433c';
      ctx.lineWidth=segment.flash>.2?1.8:.8;ctx.stroke();
      if (upper) {
        // Short sleeves leave the elbow and forearm visibly bare.
        line({x:0,y:0},{x:0,y:length*.38},fabric,r*2);
        line({x:-r*.8,y:length*.42},{x:r*.8,y:length*.42},'#345b5c',1);
      }
      if (shirt) {
        line({x:-r*.55,y:2},{x:-endRadius*.55,y:length-2},'#85aaa1',1.3);
        if(name==='torso') {
          line({x:-4,y:-2},{x:4,y:-2},'#2f5658',2);
          line({x:2,y:5},{x:5,y:5},'#dce3cd',1.5);
        }
      }
      if (name==='pelvis') line({x:-6,y:0},{x:6,y:0},'#2c373d',2.5);
      if (leg) line({x:-r*.5,y:3},{x:-endRadius*.5,y:length-2},'#738392',.9);
      if (shoe) {
        line({x:-r*.7,y:0},{x:-r*.7,y:length},'#bdc4bb',1.5);
        line({x:-2,y:length*.4},{x:2,y:length*.4},'#c6d0c6',1);
      }
      if (hand) {
        line({x:r*.7,y:length*.25},{x:r,y:length*.65},skin,2.5);
        line({x:-1,y:length*.5},{x:-1,y:length},'#b77f61',.7);
      }
      ctx.restore();
    }
    for (const joint of current.joints || []) {
      if (!injuryRings || !joint.broken) continue;
      const p = {x:joint.x,y:joint.y};
      ctx.strokeStyle = '#be352c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x,p.y,10,0,Math.PI*2); ctx.stroke();
      line({x:p.x-4,y:p.y-4},{x:p.x+4,y:p.y+4},'#be352c',2);
      line({x:p.x+4,y:p.y-4},{x:p.x-4,y:p.y+4},'#be352c',2);
    }
    const head=pts[0];
    ctx.save();ctx.translate(head.x,head.y);ctx.rotate(current.segments.find(s=>s.name==='head').angle);
    // Side-profile face: jaw, nose, ear and hair replace the mannequin visor.
    ctx.beginPath();ctx.moveTo(-10,7);
    ctx.bezierCurveTo(-16,-2,-12,-14,-2,-14);
    ctx.bezierCurveTo(7,-15,12,-9,10,-3);
    ctx.lineTo(14,1);ctx.quadraticCurveTo(15,3,10,3);
    ctx.quadraticCurveTo(11,11,5,13);
    ctx.quadraticCurveTo(-3,15,-10,7);ctx.closePath();
    ctx.fillStyle=head.flash>.2?'#ffd09b':'#e4b18b';ctx.fill();
    ctx.strokeStyle='#755546';ctx.lineWidth=.9;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-11,5);
    ctx.bezierCurveTo(-17,-5,-10,-16,0,-15);
    ctx.quadraticCurveTo(10,-15,11,-8);
    ctx.lineTo(5,-9);ctx.lineTo(0,-6);ctx.lineTo(-5,-7);ctx.lineTo(-7,3);
    ctx.closePath();ctx.fillStyle='#493d35';ctx.fill();
    circle(-5,2,3.2,'#d5a17e');
    line({x:-6,y:1},{x:-4,y:3},'#a37158',.8);
    line({x:5,y:-5},{x:9,y:-4},'#644a3b',1);
    circle(8,-2,1.1,'#303b36');
    line({x:6,y:7},{x:10,y:7},'#9b624f',1);
    ctx.restore();
    // Target indicator and push direction.
    if(mode==='ready'||mode==='charging'||mode==='aiming'){
      const selected=sim.points.findIndex(p=>p.name===$('part').value),p=pts[selected],angle=Number($('angle').value)*Math.PI/180;
      ctx.strokeStyle='#e75b32';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(p.x,p.y,23,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      const arrowColor=`hsl(${120*(1-Math.max(0,Math.min(1,power)))} 80% 42%)`;
      const arrowLength=drag?40+power*160:80;
      const start={x:p.x-arrowLength*Math.cos(angle),y:p.y+arrowLength*Math.sin(angle)},end={x:p.x-28*Math.cos(angle),y:p.y+28*Math.sin(angle)};
      line(start,end,arrowColor,3);
      polygon([[end.x,end.y],[end.x-13*Math.cos(angle-.45),end.y+13*Math.sin(angle-.45)],[end.x-13*Math.cos(angle+.45),end.y+13*Math.sin(angle+.45)]],arrowColor);
      ctx.fillStyle='#a16243';ctx.font='11px monospace';ctx.fillText('TEST SUBJECT 01',Math.max(30,p.x-70),35);
    }
    for(const p of particles){
      const color=p.kind==='joint'?'#b72f29':p.edge?'#d9562e':'#527b42';
      ctx.globalAlpha=Math.max(0,p.life);ctx.strokeStyle=color;ctx.lineWidth=2;
      if(injuryRings) { ctx.beginPath();ctx.arc(p.x,p.y,6+(1-p.life)*10,0,Math.PI*2);ctx.stroke(); }
      ctx.fillStyle=color;ctx.font='bold 12px monospace';
      if(injuryLabels) ctx.fillText(p.label,p.x+10,p.y-10-(1-p.life)*24);
    }
    ctx.globalAlpha=1;ctx.restore();
  }
  function updateReport() {
    const stats=current.stats||{steps:0,distance:0,maxSpeed:0,airtime:0};
    $('stat-steps-label').textContent=(current.layout||layout)==='shaft'?'Ledges passed':'Steps passed';
    $('stat-steps').textContent=String(stats.steps);
    $('stat-distance').textContent=stats.distance.toFixed(2)+' m';
    $('stat-speed').textContent=stats.maxSpeed.toFixed(2)+' m/s';
    $('stat-airtime').textContent=stats.airtime.toFixed(2)+' s';
    updateInjuryMap();
    $('score').textContent=String(current.score).padStart(6,'0');
    $('injuries').textContent=(current.joints||[]).filter(joint=>joint.broken).length+' / '+current.joints.length;
    $('hits').textContent=current.hits+' HITS';$('elapsed').textContent=current.time.toFixed(2)+' s';
    for(const group of groups){$('value-'+group).textContent=current.damage[group].toLocaleString();$('bar-'+group).style.width=Math.min(100,current.damage[group]/80)+'%';}
  }
  const partLabels = {head:'Head',neckLink:'Neck',torso:'Chest',abdomen:'Abdomen',pelvis:'Pelvis',
    leftUpperArm:'Left upper arm',rightUpperArm:'Right upper arm',leftForearm:'Left forearm',rightForearm:'Right forearm',
    leftHand:'Left hand',rightHand:'Right hand',leftThigh:'Left thigh',rightThigh:'Right thigh',
    leftShin:'Left shin',rightShin:'Right shin',leftFoot:'Left foot',rightFoot:'Right foot'};
  function updateInjuryMap() {
    for(const segment of current.segments) {
      const node=$('map-'+segment.name), intensity=Math.min(1,segment.damage/3000);
      const color=segment.damage ? `hsl(${Math.round(42-42*intensity)} 75% ${Math.round(65-23*intensity)}%)` : '#cbd2c1';
      node.setAttribute('stroke',color);
      node.setAttribute('fill',color);
      const text=partLabels[segment.name]+': '+segment.damage.toLocaleString()+' points, '+segment.hits+' hits';
      node.setAttribute('aria-label',text);$('map-title-'+segment.name).textContent=text;
    }
    for(const joint of current.joints) {
      const node=$('map-joint-'+joint.name);
      node.setAttribute('fill',joint.broken?'#b72f29':joint.damage>0?'#e8a23e':'#f7f6f1');
      node.setAttribute('stroke',joint.broken?'#6e1714':'#66715c');
      node.setAttribute('r',joint.broken?'4':'2.5');
      $('map-joint-title-'+joint.name).textContent=joint.name.replace(/([A-Z])/g,' $1')+': '+(joint.broken?'dislocated':joint.damage>0?'strained':'intact');
    }
    const broken=current.joints.filter(j=>j.broken).map(j=>j.name.replace(/([A-Z])/g,' $1').toLowerCase());
    $('injury-list').textContent=broken.length?'Dislocated: '+broken.join(', ')+'.':'No dislocations.';
    updateBodyDetails();
    const hit=current.strongestImpact;
    $('strongest-hit').textContent=hit?partLabels[hit.segment]+' · +'+hit.points.toLocaleString()+' points'+(hit.edge?' · stair edge':''):'No impacts yet.';
  }
  // Fictional arcade ratings, derived from snapshots so replay and reset agree.
  function recoveryChance(damage, joints, wholeBody=false) {
    const trauma=damage/(wholeBody?16000:2400);
    const jointPenalty=joints.reduce((sum,j)=>sum+j.damage*(wholeBody?.18:.65)+(j.broken?(wholeBody?.12:.35):0),0);
    return Math.max(0,Math.min(100,Math.round(100*Math.exp(-trauma-jointPenalty))));
  }
  function setRecoveryMeter(prefix,value) {
    $(prefix+'-meter').value=value;
    $(prefix+'-meter').setAttribute('aria-valuetext',value+'% — fictional game estimate');
    $(prefix+'-value').textContent=value+'%';
  }
  function updateBodyDetails() {
    const body=current.segments.find(s=>s.name===selectedBody);
    if(!body)return;
    const joints=current.joints.filter(j=>j.parent===selectedBody||j.child===selectedBody);
    setRecoveryMeter('recovery-overall',recoveryChance(current.score,current.joints,true));
    setRecoveryMeter('recovery-part',recoveryChance(body.damage,joints));
    const label=j=>j.name.replace(/([A-Z])/g,' $1').toLowerCase();
    $('body-detail-title').textContent=partLabels[selectedBody];
    $('body-detail-score').textContent=body.damage.toLocaleString()+' points · '+body.hits+' hits';
    $('body-detail-joints').textContent=joints.map(j=>label(j)+': '+(j.broken?'dislocated':j.damage>0?'strained '+Math.round(j.damage*100)+'%':'intact')).join(' · ')||'No articulated joints.';
    for(const name of Object.keys(partLabels))$('map-'+name).setAttribute('aria-pressed',String(name===selectedBody));
    $('inspect-part').value=selectedBody;
  }
  for(const name of Object.keys(partLabels)) {
    const node=$('map-'+name);
    node.setAttribute('role','button');node.setAttribute('tabindex','0');
    node.addEventListener('click',()=>{selectedBody=name;updateBodyDetails();});
    node.addEventListener('keydown',event=>{
      if(event.code==='Enter'||event.code==='Space'){event.preventDefault();event.stopPropagation();selectedBody=name;updateBodyDetails();}
    });
    const option=document.createElement('option');option.value=name;option.textContent=partLabels[name];$('inspect-part').appendChild(option);
  }
  $('inspect-part').addEventListener('change',()=>{selectedBody=$('inspect-part').value;updateBodyDetails();});
  function updateInjuryRingsToggle() {
    $('injury-rings').setAttribute('aria-pressed',String(injuryRings));
    $('injury-rings').textContent=injuryRings?'INJURY RINGS ON':'INJURY RINGS OFF';
  }
  updateInjuryRingsToggle();
  $('injury-rings').addEventListener('click',()=>{
    injuryRings=!injuryRings;updateInjuryRingsToggle();
    try { storage?.setItem('dismount-injury-rings',injuryRings?'on':'off'); } catch (_) { /* Works without storage. */ }
  });
  function updateInjuryLabelsToggle() {
    $('injury-labels').setAttribute('aria-pressed',String(injuryLabels));
    $('injury-labels').textContent=injuryLabels?'INJURY TEXT ON':'INJURY TEXT OFF';
    $('impact-notice').hidden=!injuryLabels||noticeLife<=0;
  }
  updateInjuryLabelsToggle();
  $('injury-labels').addEventListener('click',()=>{
    injuryLabels=!injuryLabels;updateInjuryLabelsToggle();
    try { storage?.setItem('dismount-injury-labels',injuryLabels?'on':'off'); } catch (_) { /* Works without storage. */ }
  });
  function updateMotionToggle() {
    $('motion').disabled=layout==='endless';
    $('motion').setAttribute('aria-pressed',String(motionEnabled()));
    $('motion').textContent=motionEnabled()?'MOTION FX ON':'MOTION FX OFF';
    $('motion').title=layout==='endless'?'Endless Stairs uses steady tracking without motion effects.':'';
  }
  updateMotionToggle();
  $('motion').addEventListener('click',()=>{
    if(layout==='endless')return;
    motion=!motion;impactSlow=0;shake=0;camera=null;updateMotionToggle();
  });
  function updateChamberNumber() {
    const number=Array.from($('layout').options).findIndex(option=>option.value===layout)+1;
    $('chamber-number').textContent='TEST CHAMBER / '+String(number).padStart(2,'0');
  }
  $('layout').value=layout;
  updateChamberNumber();
  function changeChamber() {
    if(!['ready','finished'].includes(mode)||!Object.hasOwn(LAYOUTS,$('layout').value)){$('layout').value=layout;return;}
    bests.set(layout,best);layout=$('layout').value;updateChamberNumber();sim=new Simulation(layout);frames=[];retryRecipe=null;
    if(!boards.has(layout))boards.set(layout,new ScoreBoard(storage,REPLAY_VERSION,layout));
    board=boards.get(layout);best=0;
    try{best=Math.max(0,Number(storage.getItem(bestKey()))||0);}catch(_){}
    best=Math.max(best,bests.get(layout)||0,...board.entries.map(e=>e.score));$('best').textContent=best.toLocaleString();
    $('layout-caption').textContent=layout==='endless'?'ENDLESS STAIRS · 120 s MAX':LAYOUTS[layout].count+(LAYOUTS[layout].kind==='shaft'?' LEDGES · ':' STEPS · ')+LAYOUTS[layout].name.toUpperCase();
    $('highscores-title').textContent='High scores · '+LAYOUTS[layout].name;
    reset();
  }
  $('layout').addEventListener('change',changeChamber);
  const chamberDescriptions={
    classic:'14 regular steps. A balanced starting point for your first experiments.',
    steep:'8 tall steps for a shorter, steeper fall and harder impacts.',
    long:'18 shallow steps for longer tumbles down a gradual staircase.',
    landing:'A wide landing interrupts the staircase and changes the rhythm of the fall.',
    uneven:'Irregular step heights and widths make each contact different.',
    shaft:'Five staggered ledges inside a vertical shaft, with open drops between them.',
    endless:'Continuously generated stairs and a tracking camera. Runs last until the dummy settles or 120 seconds pass.',
    finalDrop:'Six steps followed by a deep drop to the floor below.'
  };
  function describeWelcomeChamber() {
    $('welcome-chamber-description').textContent=chamberDescriptions[$('welcome-layout').value]||chamberDescriptions.classic;
  }
  $('welcome-layout').value=layout;describeWelcomeChamber();
  $('welcome-layout').addEventListener('change',describeWelcomeChamber);
  let welcomeClosing=false;
  function enterWelcomeChamber() {
    if(welcomeClosing)return;
    const selected=$('welcome-layout').value;
    if(!Object.hasOwn(LAYOUTS,selected))return;
    unlockAudio();
    $('layout').value=selected;changeChamber();
    welcomeClosing=true;
    $('welcome').setAttribute('data-closing','true');
    window.setTimeout(()=>{
      $('welcome').close?.();$('launch').focus?.();
    },500);
  }
  $('welcome-start').addEventListener('click',enterWelcomeChamber);
  $('welcome').addEventListener('cancel',event=>{event.preventDefault();enterWelcomeChamber();});
  $('welcome').addEventListener('click',event=>{
    if(event.target!==$('welcome'))return;
    const rect=$('welcome').getBoundingClientRect();
    const outside=event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
    if(outside)enterWelcomeChamber();
  });
  function lock(value) {
    updateMotionToggle();
    $('status').setAttribute('aria-busy',String(mode==='loadingReplay'));
    const unavailable=!retryRecipe||!['ready','finished','replay'].includes(mode);
    const historicalAngle=retryRecipe&&(retryRecipe.angle < -100 || retryRecipe.angle > 100);
    $('retry-edit').disabled=unavailable;$('retry').disabled=unavailable||historicalAngle;
    $('retry').title=historicalAngle?'This historical angle is outside the current range. Use Tweak last push.':'';
    $('slow').disabled=mode==='replay'||mode==='loadingReplay';
    $('part').disabled=value;$('angle').disabled=value;$('layout').disabled=!['ready','finished'].includes(mode);renderBoard();
  }
  function reset(){playbackFrames=[];replayIndex=0;peakFrame=0;replayPaused=false;$('replay-controls').hidden=true;$('retry-settings').hidden=true;noticeLife=0;$('impact-notice').hidden=true;camera=null;impactSlow=0;impactCooldown=0;shake=0;replayJob=null;pendingScore=null;replayLabel='';$('score-entry').hidden=true;$('save-message').textContent='';cancelLaunchPress();$('stage').setAttribute('data-finished','false');cancelDrag();mode='ready';sim.reset();current=sim.snapshot();particles=[];accumulator=0;power=0;$('drop').disabled=false;$('result').hidden=true;$('launch').disabled=false;$('launch').innerHTML='Hold to charge <span>↗</span>';$('status').textContent='READY TO DISMOUNT';$('hint').textContent='HOLD OR DRAG ANYWHERE. RELEASE TO PUSH.';$('power-value').textContent='—';$('power-fill').style.width='0%';$('power-help').textContent='Hold and release to push, or use two short clicks.';$('replay').disabled=!frames.length;lock(false);updateReport();}
  function launch(preset=null){
    unlockAudio();
    if(mode==='finished'){reset();return;}
    if(mode==='ready'){$('retry-settings').hidden=true;mode='charging';meterTime=0;power=0;$('power-value').textContent='0%';$('power-fill').style.width='0%';lock(true);$('replay').disabled=true;$('status').textContent='CHARGING PUSH';$('launch').innerHTML='Dismount now <span>↗</span>';$('power-help').textContent='Release after holding, or click again to push.';return;}
    if(mode!=='charging'&&mode!=='aiming')return;
    cancelLaunchPress();
    cancelDrag();
    if(preset)power=preset.power;
    $('retry-settings').hidden=true;$('replay-controls').hidden=true;
    if(power>0)tone(160,55,.22,.12,'sawtooth');
    $('drop').disabled=true;
    $('power-value').textContent=Math.round(power*100)+'%';
    $('power-fill').style.width=power*100+'%';
    runPush=preset?{part:preset.part,angle:preset.angle,power:preset.power}:{part:$('part').value,angle:Number($('angle').value),power};
    pendingScore=null;mode='running';lock(true);frames=[sim.snapshot()];sim.push(runPush.part,runPush.angle,runPush.power);accumulator=0;
    $('status').textContent='DISMOUNT IN PROGRESS';$('launch').textContent='Experiment in progress…';$('launch').disabled=true;$('hint').textContent='GRAVITY HAS TAKEN OVER.';$('power-help').textContent='Push locked. Watch the impacts accumulate.';
  }
  function finish(replaying=false){
    if(!replaying)retryRecipe={...runPush,layout};
    else {replayPaused=true;updateReplayControls();}
    mode='finished';lock(true);$('launch').disabled=false;$('launch').innerHTML='New experiment <span>↗</span>';$('status').textContent='EXPERIMENT COMPLETE';$('replay').disabled=!frames.length;
    pendingScore=replaying?null:{push:{...runPush},score:current.score,hits:current.hits,time:current.time,steps:frames.length-1};
    $('score-entry').hidden=replaying||!board.qualifies(current.score);
    $('save-message').textContent='';
    const record=!replaying&&current.score>best;
    if(record){best=current.score;try{localStorage.setItem(bestKey(),String(best));}catch(_){}$('best').textContent=best.toLocaleString();}
    $('result-title').textContent=replaying?(replayLabel?'Replay · '+replayLabel:'Replay complete.'):record?'A new personal best.':current.score>5000?'Beautifully ungraceful.':'A solid landing.';
    $('result-detail').textContent=`${current.score.toLocaleString()} points · ${current.hits} impacts · ${current.time.toFixed(2)} seconds`;
    tone(440,880,.25,.06);
    $('stage').setAttribute('data-finished','true');
    updateReport();
    $('result').hidden=false;$('hint').textContent='CLICK ANYWHERE ON THE STAGE TO TRY AGAIN.';
  }
  function renderBoard() {
    $('score-rows').replaceChildren();
    board.entries.forEach((entry, index) => {
      const row = document.createElement('tr');
      for (const value of [String(index+1).padStart(2,'0'), entry.nick, entry.score.toLocaleString()]) {
        const cell = document.createElement('td'); cell.textContent=value; row.appendChild(cell);
      }
      const cell=document.createElement('td'), button=document.createElement('button');
      button.type='button'; button.setAttribute('data-score-id',entry.id);
      button.textContent=entry.engine===REPLAY_VERSION?'▷ Replay':'Unavailable';
      button.disabled=!['ready','finished'].includes(mode)||entry.engine!==REPLAY_VERSION;
      button.setAttribute('aria-label','Replay '+entry.nick+' — '+entry.score+' points');
      if(entry.engine!==REPLAY_VERSION)button.title='Recorded with a different physics version.';
      cell.appendChild(button);row.appendChild(cell);$('score-rows').appendChild(row);
    });
    $('board-empty').hidden=board.entries.length>0;
    $('board-message').textContent=board.persistent?'Saved in this browser. Replay any recorded run.':'Browser storage unavailable. Scores last for this session only.';
  }
  function startReplay(recording, label='', recipe=runPush) {
    unlockAudio();noticeLife=0;$('impact-notice').hidden=true;replayPaused=false;peakFrame=0;let peakPoints=-1;
    recording.forEach((frame,index)=>{for(const hit of frame.impacts||[])if(hit.points>peakPoints){peakPoints=hit.points;peakFrame=index;}});
    $('replay-peak').disabled=peakPoints<0;
    if(recipe)retryRecipe={...recipe,layout};
    $('replay-controls').hidden=false;$('retry-settings').hidden=true;
    playbackFrames=recording;replayLabel=label;pendingScore=null;replayJob=null;
    camera=null;impactSlow=0;shake=0;impactCooldown=0;mode='replay';$('stage').setAttribute('data-finished','false');$('drop').disabled=true;
    replayIndex=0;accumulator=0;particles=[];current=recording[0];lock(true);
    $('result').hidden=true;$('score-entry').hidden=true;$('status').textContent='REPLAYING EXPERIMENT';
    $('launch').disabled=true;$('replay').disabled=true;updateReplayControls();updateReport();$('hint').textContent=label?'REPLAY / '+label:'REPLAY / RECORDED PHYSICS';
  }
  function updateReplayControls() {
    $('replay-timeline').max=Math.max(0,playbackFrames.length-1);
    $('replay-timeline').value=replayIndex;
    $('replay-time').textContent=(playbackFrames[replayIndex]?.time||0).toFixed(2)+' / '+(playbackFrames.at(-1)?.time||0).toFixed(2)+' s · frame '+replayIndex;
    $('replay-toggle').textContent=replayPaused?'▶ Play':'Ⅱ Pause';
    $('replay-toggle').setAttribute('aria-pressed',String(!replayPaused));
    $('replay-back').disabled=replayIndex===0;
    $('replay-forward').disabled=replayIndex>=playbackFrames.length-1;
  }
  function seekReplay(index) {
    if(!playbackFrames.length||$('replay-controls').hidden)return;
    mode='replay';replayPaused=true;camera=null;accumulator=0;impactSlow=0;shake=0;particles=[];noticeLife=0;$('impact-notice').hidden=true;
    replayIndex=Math.max(0,Math.min(playbackFrames.length-1,Math.round(Number(index)||0)));
    current=playbackFrames[replayIndex];pendingScore=null;
    $('result').hidden=true;$('stage').setAttribute('data-finished','false');
    $('launch').disabled=true;$('status').textContent='REPLAY PAUSED';lock(true);
    showFrameEvents(current,playbackFrames[replayIndex-1],false);
    updateReport();updateReplayControls();
  }
  $('replay-timeline').addEventListener('input',()=>seekReplay($('replay-timeline').value));
  $('replay-back').addEventListener('click',()=>seekReplay(replayIndex-1));
  $('replay-forward').addEventListener('click',()=>seekReplay(replayIndex+1));
  $('replay-peak').addEventListener('click',()=>seekReplay(peakFrame));
  $('replay-toggle').addEventListener('click',()=>{
    if(!playbackFrames.length)return;
    if(mode==='finished'||replayIndex>=playbackFrames.length-1)seekReplay(0);
    replayPaused=!replayPaused;accumulator=0;
    $('status').textContent=replayPaused?'REPLAY PAUSED':'REPLAYING EXPERIMENT';updateReplayControls();
  });
  $('replay-speed').value='1';
  $('replay-speed').addEventListener('change',()=>{
    const speed=Number($('replay-speed').value);if([.25,.5,1,2].includes(speed))replaySpeed=speed;
  });
  function prepareRetry(edit) {
    if(!retryRecipe||!['ready','finished','replay'].includes(mode))return;
    const recipe={...retryRecipe};
    if(!edit&&(recipe.angle < -100 || recipe.angle > 100))return;
    reset();
    $('part').value=recipe.part;$('angle').value=String(edit?Math.max(-100,Math.min(100,recipe.angle)):recipe.angle);
    $('angle-value').textContent=$('angle').value+'°';power=recipe.power;presetPower=recipe.power;
    $('power-value').textContent=(power*100).toFixed(1)+'%';$('power-fill').style.width=power*100+'%';
    if(edit){
      $('retry-settings').hidden=false;$('preset-power').value=String(power*100);
      $('preset-power-value').textContent=(power*100).toFixed(1)+'%';
      $('power-help').textContent='Adjust the part, angle, or power, then push with these settings.';
    }else{mode='aiming';launch(recipe);}
  }
  $('retry').addEventListener('click',()=>prepareRetry(false));
  $('retry-edit').addEventListener('click',()=>prepareRetry(true));
  $('preset-power').addEventListener('input',()=>{
    if(mode!=='ready')return;
    presetPower=Math.max(0,Math.min(1,Number($('preset-power').value)/100));power=presetPower;
    $('preset-power-value').textContent=(power*100).toFixed(1)+'%';
    $('power-value').textContent=(power*100).toFixed(1)+'%';$('power-fill').style.width=power*100+'%';
  });
  $('preset-launch').addEventListener('click',()=>{
    if(mode!=='ready')return;power=presetPower;mode='aiming';launch();
  });
  function showFrameEvents(frame,previous,audible=true) {
    for(const hit of frame.impacts||[]) {
      const kind=hit.edge?'EDGE':hit.self?'BODY CONTACT':'LANDING';
      particles.push({...hit,life:1,label:kind+' +'+hit.points});
      $('impact-notice').textContent=(partLabels[hit.segment]||hit.group)+' · '+kind+' +'+hit.points;
      noticeLife=1.1;$('impact-notice').hidden=!injuryLabels;
      if(audible){thud(hit);impactFeedback(hit);}
    }
    const broken=new Set((previous?.joints||[]).filter(j=>j.broken).map(j=>j.name));
    for(const j of frame.joints||[])if(j.broken&&!broken.has(j.name)) {
      particles.push({x:j.x,y:j.y,life:1,kind:'joint',label:'DISLOCATION'});
      $('impact-notice').textContent=j.name.replace(/([A-Z])/g,' $1')+' · DISLOCATION';
      noticeLife=1.1;$('impact-notice').hidden=!injuryLabels;
    }
    if(audible)for(const event of frame.cracks||[])crack(event.strength,event.fracture);
    particles=particles.slice(-32);
  }
  function buildReplayChunk() {
    const job=replayJob;
    const started=window.performance?.now();
    for(let i=0;i<30&&job.steps<job.entry.steps;i++) {
      if(i>0&&started!==undefined&&window.performance.now()-started>=8)break;
      job.sim.step();const frame=job.sim.snapshot();frame.impacts=job.sim.impacts.map(hit=>({...hit}));
      job.frames.push(frame);job.steps++;
    }
    $('status').textContent='PREPARING REPLAY · '+Math.round(job.steps/job.entry.steps*100)+'%';
    if(job.steps===job.entry.steps) {
      const end=job.frames[job.frames.length-1];
      if(end.score!==job.entry.score||end.hits!==job.entry.hits||Math.abs(end.time-job.entry.time)>1e-8) {
        reset();$('board-message').textContent='This replay cannot be reproduced in this browser.';return;
      }
      startReplay(job.frames,job.entry.nick,job.entry.push);
    }
  }
  $('score-rows').addEventListener('click',event=>{
    const button=event.target.closest('button[data-score-id]');
    if(!button||!['ready','finished'].includes(mode))return;
    const entry=board.get(button.getAttribute('data-score-id'));
    if(!entry||entry.engine!==REPLAY_VERSION)return;
    unlockAudio();const replaySim=new Simulation(entry.layout||'classic');
    replayJob={entry,sim:replaySim,frames:[replaySim.snapshot()],steps:0};
    replaySim.push(entry.push.part,entry.push.angle,entry.push.power);
    mode='loadingReplay';$('replay-controls').hidden=true;pendingScore=null;lock(true);$('result').hidden=true;
    $('stage').setAttribute('data-finished','false');$('drop').disabled=true;
    $('launch').disabled=true;$('replay').disabled=true;
    $('status').textContent='PREPARING REPLAY';$('hint').textContent='REBUILDING RECORDED PHYSICS…';
  });
  $('initials').addEventListener('input',()=>{$('initials').value=normalizeNick($('initials').value);});
  $('score-entry').addEventListener('submit',event=>{
    event.preventDefault();
    if(mode!=='finished'||!pendingScore)return;
    const nick=normalizeNick($('initials').value);$('initials').value=nick;
    const result=board.save(nick,pendingScore);
    if(!result.ok){$('save-message').textContent=result.message;return;}
    pendingScore=null;$('score-entry').hidden=true;renderBoard();
    $('save-message').textContent=result.persistent?'Saved as '+nick+'.':'Saved for this session only; browser storage is unavailable.';
  });
  // Audio is created inside a user gesture to satisfy browser autoplay rules.
  function unlockAudio() {
    if (!sound) return;
    try {
      if (!audio || audio.state==='closed') {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        master = audio.createGain();
        master.gain.value = 0.65;
        const compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 18;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;
        master.connect(compressor);
        compressor.connect(audio.destination);
        audio.addEventListener?.('statechange',()=>updateSoundControls());
        // Start a silent source inside the gesture, including Safari's first unlock.
        const silent=audio.createBufferSource();
        silent.buffer=audio.createBuffer(1,1,audio.sampleRate);
        silent.connect(master);silent.onended=()=>silent.disconnect();silent.start();
      }
      if (audio.state==='suspended'||audio.state==='interrupted') {
        audio.resume().then(()=>updateSoundControls()).catch(()=>{
          if(sound)updateSoundControls('SOUND: TAP TO ENABLE');
        });
      }
    } catch (_) { sound = false; updateSoundControls('SOUND UNAVAILABLE'); }
  }
  function tone(start, end, duration, volume, type = 'sine') {
    if (!sound || !audio || !master) return;
    const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain); gain.connect(master);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(); osc.stop(now + duration + 0.01);
  }
  function noise(kind, variant, duration, volume, frequency, filterType = 'lowpass', rate = 1) {
    if (!sound || !audio || !master) return;
    const key = kind + variant;
    if (!noiseBuffers.has(key)) {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.4), audio.sampleRate);
      const samples = buffer.getChannelData(0);
      // Seeded textures: each recorded impact keeps its timbre on replay.
      let seed = 7919 + variant * 104729, low = 0;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const white = seed / 2147483648 - 1, t = i / audio.sampleRate;
        low = low * 0.82 + white * 0.18;
        let envelope = Math.exp(-t * 26);
        if (kind === 'snap') {
          envelope = Math.exp(-t * 190);
          for (let burst = 1; burst <= 2 + variant % 3; burst++) {
            const start = burst * (0.014 + variant * 0.002);
            if (t > start) envelope += (0.7 / burst) * Math.exp(-(t-start)*210);
          }
        }
        samples[i] = (kind === 'body' ? low * 2 : white) * envelope;
      }
      noiseBuffers.set(key, buffer);
    }
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = noiseBuffers.get(key);
    source.playbackRate.value = rate;
    filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(); source.stop(audio.currentTime + duration);
  }
  function thud(hit) {
    if (!sound || !audio || audio.currentTime - lastThud < 0.045) return;
    lastThud = audio.currentTime;
    const {force, edge, group = 'Torso', variant = 0} = hit;
    const weight = Math.min(1, force / 850), pitch = 0.86 + variant * 0.055;
    const base = {Head:190, Torso:85, Arms:240, Legs:125}[group] || 125;
    // Torso: low thump; head: hollow knock; limbs: shorter, harder taps.
    tone(base*pitch, (group==='Torso'?28:55)*pitch,
      0.075 + weight*0.14, 0.035 + weight*0.16, group==='Head'?'sine':'triangle');
    noise('body', variant, 0.09+weight*0.13, 0.09+weight*0.25,
      group==='Torso'?650:group==='Head'?1700:2600, 'lowpass', pitch);
    if (edge) {
      noise('snap', variant, 0.07, 0.12+weight*0.2, 1800, 'highpass', pitch*1.25);
      tone(750*pitch, 170, 0.035, 0.035+weight*0.04, 'triangle');
    } else if (force > 350) {
      // Short gritty tail on heavier flat landings.
      noise('grit', variant, 0.16, weight*0.09, 2400, 'bandpass', 0.8);
    }
  }
  function crack(strength, fracture = false) {
    if (!sound || !audio || !master || (!fracture && audio.currentTime - lastCrack < 0.09)) return;
    lastCrack = audio.currentTime;
    const variant = soundVariant++ % 6;
    noise('snap', variant, fracture?0.23:0.12, 0.12+strength*0.22,
      fracture?850:1600, 'highpass', 0.85+variant*0.07);
    if (fracture) {
      tone(140+variant*17, 32, 0.18, 0.1, 'triangle');
      noise('body', variant, 0.2, 0.16, 900);
    }
  }
  function cancelDrag() {
    if (!drag) return;
    const pointerId = drag.id;
    drag = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    canvas.style.cursor = 'grab';
  }
  function impactFeedback(hit) {
    if(!motionEnabled()||hit.force<450)return;
    shake=.22;
    if(impactCooldown<=0){impactSlow=.22;impactCooldown=1.5;}
  }
  function tick(now){
    const delta=last?Math.min((now-last)/1000,.05):0;last=now;renderDelta=delta;
    impactSlow=Math.max(0,impactSlow-delta);impactCooldown=Math.max(0,impactCooldown-delta);shake=Math.max(0,shake-delta);
    if (drag) drag.held += delta;
    if(mode==='charging'||(mode==='aiming'&&drag&&!drag.moved)){chargeBeat+=delta;if(chargeBeat>.13){tone(230+power*700,200+power*600,.06,.025);chargeBeat=0;}meterTime+=delta;power=Math.round(100*(.5-.5*Math.cos(meterTime*4)))/100;$('power-fill').style.width=power*100+'%';$('power-value').textContent=Math.round(power*100)+'%';}
    if(mode==='loadingReplay')buildReplayChunk();
    if(mode==='running'||(mode==='replay'&&!replayPaused)){
      accumulator+=delta*(mode==='replay'?replaySpeed:slow?.5:1)*(motionEnabled()&&impactSlow>0?.35:1);
      while(accumulator>=DT&&(mode==='running'||(mode==='replay'&&!replayPaused))){
        accumulator-=DT;const previous=current;
        if(mode==='running'){
          sim.step();current=sim.snapshot();current.impacts=sim.impacts.map(hit=>({...hit}));frames.push(current);
          showFrameEvents(current,previous);
          if(!sim.active)finish();
        }else{
          replayIndex=Math.min(replayIndex+1,playbackFrames.length-1);current=playbackFrames[replayIndex];
          showFrameEvents(current,previous);
          if(replayIndex>=playbackFrames.length-1)finish(true);
        }
      }
      reportClock+=delta;
      if(reportClock>=.05){reportClock=0;updateReport();}
      if(mode==='replay')updateReplayControls();
    }
    if(!(mode==='replay'&&replayPaused)) {
      particles.forEach(p=>{p.life-=delta;});particles=particles.filter(p=>p.life>0);
      noticeLife=Math.max(0,noticeLife-delta);if(!noticeLife)$('impact-notice').hidden=true;
    }
    render();requestAnimationFrame(tick);
  }
  function cancelLaunchPress() {
    if (!launchPress) return;
    const id = launchPress.id;
    launchPress = null;
    if ($('launch').hasPointerCapture(id)) $('launch').releasePointerCapture(id);
  }
  $('launch').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary===false || launchPress || (mode !== 'ready' && mode !== 'charging')) return;
    event.preventDefault();
    suppressLaunchClick = false;
    const alreadyCharging = mode === 'charging';
    launchPress = { id: event.pointerId, started: event.timeStamp, alreadyCharging };
    try { $('launch').setPointerCapture(event.pointerId); } catch (_) { /* Global release fallback. */ }
    if (!alreadyCharging) launch();
  });
  function releaseLaunchButton(event) {
    if (!launchPress || event.pointerId !== launchPress.id) return;
    const { started, alreadyCharging } = launchPress;
    const held = event.timeStamp - started >= 180;
    cancelLaunchPress();
    // Browsers also emit click after pointerup: consume it to avoid a second action.
    suppressLaunchClick = true;
    if (mode === 'charging' && (held || alreadyCharging)) launch();
  }
  $('launch').addEventListener('pointerup', releaseLaunchButton);
  const abortLaunchPress = event => {
    if (launchPress && event.pointerId === launchPress.id) {
      suppressLaunchClick = true;
      reset();
    }
  };
  $('launch').addEventListener('pointercancel', abortLaunchPress);
  $('launch').addEventListener('lostpointercapture', abortLaunchPress);
  $('launch').addEventListener('click', (event = {detail:0}) => {
    const suppress = suppressLaunchClick;
    suppressLaunchClick = false;
    if (suppress && event.detail !== 0) return;
    launch();
  });
  let expandedView=false, fullscreenPending=false, expandedRestore=null;
  const nativeFullscreenElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
  function updateFullscreenButton() {
    const active=expandedView||nativeFullscreenElement()===$('game-panel');
    $('fullscreen').textContent=active?'EXIT FULLSCREEN':'FULLSCREEN';
    $('fullscreen').setAttribute('aria-pressed',String(active));
    $('fullscreen').disabled=fullscreenPending;
  }
  function setExpandedView(active) {
    if(expandedView===active)return;
    expandedView=active;
    $('game-panel').setAttribute('data-expanded',String(active));
    if(active) {
      const body=document.body;
      expandedRestore={x:window.scrollX||0,y:window.scrollY||0,
        style:{position:body.style.position,top:body.style.top,width:body.style.width,overflow:body.style.overflow},
        siblings:Array.from(document.querySelectorAll('header, .workspace > aside, .workspace > .injury-report, .highscores, main > footer')).map(node=>[node,node.inert])};
      body.style.position='fixed';body.style.top=-expandedRestore.y+'px';body.style.width='100%';body.style.overflow='hidden';
      for(const [node] of expandedRestore.siblings)node.inert=true;
    } else {
      Object.assign(document.body.style,expandedRestore.style);
      for(const [node,inert] of expandedRestore.siblings)node.inert=inert;
      window.scrollTo?.(expandedRestore.x,expandedRestore.y);expandedRestore=null;
    }
    updateFullscreenButton();camera=null;resize();$('fullscreen').focus?.();
  }
  $('fullscreen').disabled=false;
  $('fullscreen').addEventListener('click',async()=>{
    if(fullscreenPending)return;
    if(expandedView){setExpandedView(false);return;}
    fullscreenPending=true;updateFullscreenButton();
    const panel=$('game-panel'),active=nativeFullscreenElement()===panel;
    try {
      if(active) {
        const leave=document.exitFullscreen||document.webkitExitFullscreen;
        if(leave)await leave.call(document);
      } else {
        const enter=panel.requestFullscreen||panel.webkitRequestFullscreen;
        if(!enter||document.fullscreenEnabled===false) setExpandedView(true);
        else await enter.call(panel);
      }
      $('fullscreen').title=expandedView?'Full-window view; browser controls may remain visible.':'';
    } catch (_) {
      if(!active) {
        setExpandedView(true);
        $('fullscreen').title='Full-window view; browser controls may remain visible.';
      } else $('fullscreen').title='Use the browser fullscreen exit control to leave.';
    } finally { fullscreenPending=false;updateFullscreenButton();camera=null;resize(); }
  });
  const fullscreenChanged=()=>{updateFullscreenButton();camera=null;resize();};
  document.addEventListener('fullscreenchange',fullscreenChanged);
  document.addEventListener('webkitfullscreenchange',fullscreenChanged);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&expandedView){event.preventDefault();setExpandedView(false);}
  });
  window.addEventListener('resize',()=>{
    if(drag||launchPress)reset();
    camera=null;resize();
  });
  window.visualViewport?.addEventListener('resize',()=>{camera=null;resize();});
  $('stage-reset').addEventListener('click',reset);
  $('reset').addEventListener('click',reset);$('again').addEventListener('click',reset);
  $('stage').addEventListener('click', event => {
    if (mode !== 'finished') return;
    // Stage controls keep their own actions without dismissing the result.
    if (event.target.closest('button, input, form, label')) return;
    reset();
  });
  $('drop').addEventListener('click',()=>{
    if(mode!=='ready'&&mode!=='charging')return;
    power=0;mode='aiming';lock(true);launch();
  });
  $('angle').addEventListener('input',()=>{$('angle-value').textContent=$('angle').value+'°';});
  $('slow').addEventListener('click',()=>{slow=!slow;$('slow').setAttribute('aria-pressed',String(slow));});
  $('view').addEventListener('click',()=>{perspective=!perspective;$('view').textContent='VIEW: '+(perspective?'PERSPECTIVE':'SIDE');});
  $('replay').addEventListener('click',()=>{if(frames.length&&(mode==='ready'||mode==='finished'))startReplay(frames);});
  function updateSoundControls(label=!sound?'SOUND OFF':audio&&audio.state!=='running'?'SOUND: TAP TO ENABLE':'SOUND ON') {
    for(const id of ['sound','stage-sound']) {
      $(id).textContent=label;$(id).setAttribute('aria-pressed',String(sound));
    }
  }
  function toggleSound() {
    const needsResume=sound&&audio&&audio.state!=='running';
    if(!needsResume)sound=!sound;
    updateSoundControls();
    if(sound)unlockAudio();
    if(master)master.gain.value=sound?.65:0;
    tone(600,900,.1,.04);
  }
  $('sound').addEventListener('click',toggleSound);
  $('stage-sound').addEventListener('click',toggleSound);
  document.addEventListener('keydown',event=>{if($('welcome').open)return;if(event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;if(['INPUT','SELECT','BUTTON'].includes(event.target.tagName))return;if(event.code==='Space'){event.preventDefault();launch();}if(event.code==='KeyR')reset();});
  canvas.addEventListener('pointerdown', event => {
    if (mode !== 'ready' || event.button !== 0 || event.isPrimary===false || drag) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;
    const options = Array.from($('part').options).map(option => option.value);
    const nearest = sim.points.filter(point => options.includes(point.name))
      .sort((a, b) => Math.hypot(a.x-x, a.y-y) - Math.hypot(b.x-x, b.y-y))[0];
    const hitBody = nearest && Math.hypot(nearest.x-x, nearest.y-y) * scale <= 28;
    event.preventDefault();
    $('retry-settings').hidden=true;unlockAudio(); tone(520, 700, 0.07, 0.035);
    if (hitBody) $('part').value = nearest.name;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, held: 0, moved: false,
      powerDistance:event.pointerType==='touch'?Math.min(180,Math.max(90,width*.4)):180 };
    meterTime = 0;
    power = 0;
    $('power-fill').style.width = '0%';
    $('power-value').textContent = '0%';
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Window listeners handle release without capture. */ }
    canvas.style.cursor = 'grabbing';
    mode = 'aiming'; lock(true); $('replay').disabled = true;
    $('status').textContent = 'DRAG TO AIM';
    $('hint').textContent = 'DRAG RIGHT TO PUSH · DISTANCE = POWER · RELEASE TO LAUNCH';
    $('power-help').textContent = 'Hold to charge, or drag to set power and direction. Release to push.';
  });
  function updateMouseAim(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = drag.y - event.clientY;
    // Use the same distance for the displayed power and the release threshold.
    drag.distance = Math.hypot(dx, dy);
    if (drag.distance >= 10) drag.moved = true;
    if (!drag.moved) return;
    const angle = Math.round(Math.max(-100, Math.min(100, Math.atan2(dy, dx) * 180 / Math.PI)));
    power = Math.min(1, drag.distance / drag.powerDistance);
    $('angle').value = String(angle); $('angle-value').textContent = angle + '°';
    $('power-fill').style.width = power * 100 + '%';
    $('power-value').textContent = Math.round(power * 100) + '%';
  }
  canvas.addEventListener('pointermove', updateMouseAim);
  function releaseMouseAim(event) {
    // Touch release is an activation gesture on Safari, unlike some pointer-down events.
    if(sound&&audio&&audio.state!=='running')unlockAudio();
    if (!drag || event.pointerId !== drag.id) return;
    // Release may carry a newer position than the last pointermove event.
    updateMouseAim(event);
    const shouldLaunch = drag.moved || drag.held >= 0.18;
    cancelDrag();
    if (shouldLaunch) launch(); else reset();
  }
  canvas.addEventListener('pointerup', releaseMouseAim);
  // Capture phase receives releases over UI overlays and outside the canvas too.
  window.addEventListener('pointerup',event=>{releaseLaunchButton(event);releaseMouseAim(event);},true);
  window.addEventListener('pointermove', updateMouseAim, true);
  window.addEventListener('mouseup', event => {
    if (drag && event.button === 0) releaseMouseAim({
      pointerId: drag.id, clientX: event.clientX, clientY: event.clientY
    });
  }, true);
  const abortAim = event => {
    if (drag && event.pointerId === drag.id) reset();
  };
  canvas.addEventListener('pointercancel', abortAim);
  // Losing capture is not a cancellation: retain the gesture until global release.
  // Only pointercancel, reset, or leaving the window cancels an unfinished gesture.
  window.addEventListener('blur', () => { if (drag || launchPress) reset(); });
  reset();resize();$('welcome').showModal?.();requestAnimationFrame(tick);
})();
