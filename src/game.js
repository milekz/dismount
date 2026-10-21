/* Canvas renderer and game state. Runs directly from index.html, including file://. */
(() => {
  'use strict';
  const {Simulation, LAYOUTS, CHARACTERS, buildStair, DT, REPLAY_VERSION, supportsReplay} = window.DismountPhysics;
  const {Recording,validEnd}=window.DismountReplay;
  const physicsView=window.DismountPhysicsView;
  const appearance=window.DismountTheme.current;
  const {ScoreBoard, normalizeNick} = window.DismountScores;
  const badgeTools=window.DismountBadges,sharedLink=badgeTools.readLink(window.location?.href);
  let storage;
  try { storage = localStorage; } catch (_) {}
  const endlessFx=window.DismountEndless,depthRecords=endlessFx.createRecords(storage);
  window.addEventListener('pagehide',()=>depthRecords.save());
  let linkedChamber=null, linkedCharacter=null;
  try {
    const params=new URL(window.location.href).searchParams;
    const requested=params.get('chamber'),requestedCharacter=params.get('character');
    if(Object.hasOwn(CHARACTERS,requestedCharacter))linkedCharacter=requestedCharacter;
    const selected=/^\d+$/.test(requested)
      ? document.getElementById('layout').options[Number(requested)-1]?.value
      : requested;
    if(Object.hasOwn(LAYOUTS,selected))linkedChamber=selected;
  } catch (_) { /* Keep the default when URL access is unavailable. */ }
  if(sharedLink.entry){linkedChamber=sharedLink.entry.layout;linkedCharacter=sharedLink.entry.character;}
  let layout=linkedChamber||'endless', character=linkedCharacter||'human';
  const selectionKey=()=>layout+':'+character;
  let board=new ScoreBoard(storage,REPLAY_VERSION,layout,character);
  const boards=new Map([[selectionKey(),board]]), bests=new Map();
  let sim = new Simulation(layout,character);
  let selectedBody='torso', motion=false, injuryRings=false, injuryLabels=true,showPhysics=false;
  try { injuryRings=storage?.getItem('dismount-injury-rings')==='on'; } catch (_) { /* Optional preference. */ }
  try { injuryLabels=storage?.getItem('dismount-injury-labels')!=='off'; } catch (_) { /* Optional preference. */ }
  const motionEnabled=()=>motion&&layout!=='endless';
  let camera=null, renderDelta=0, impactSlow=0, impactCooldown=0, shake=0;
  const bestKey=()=>(layout==='classic'?'dismount-anatomy-best-v4':'dismount-anatomy-best-v4-'+layout)+(character==='human'?'':'-character-'+character);
  let replayCache=null,ghostFrames=null,ghostEnabled=false,attemptCompleted=false,challenge='none';
  const {themes}=window.DismountSubjects;
  const {goals,evaluate}=window.DismountChallenges;
  const theme=()=>themes[current.character||'human'];
  const replayKey=entry=>JSON.stringify([entry.id,entry.engine,entry.layout,entry.character,entry.push,entry.score,entry.hits,entry.time,entry.steps]);
  let runPush = null, pendingScore = null, playbackFrames = new Recording(), replayJob = null, replayLabel = '';
  const dom=new Map();
  const $ = id => {if(!dom.has(id))dom.set(id,document.getElementById(id));return dom.get(id);};
  const badgeView=badgeTools.createView({host:window,document});let badgeEntry=null;
  function setBadgeEntry(entry) {badgeEntry=entry;badgeView.decorate($('run-badge'),entry);}
  setBadgeEntry(null);
  $('run-badge').addEventListener('click',()=>{if(badgeEntry)badgeView.show(badgeEntry);});
  const chambers=Object.fromEntries(Object.keys(LAYOUTS).map(id=>[id,buildStair(id)]));
  let replayPaused=false,replaySpeed=1,peakFrame=0,retryRecipe=null,presetPower=0,reportClock=0;
  let noticeLife=0,milestoneLife=0;
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const groups = ['Head', 'Torso', 'Arms', 'Legs'];
  let mode = 'ready', power = 0, meterTime = 0, accumulator = 0, last = 0;
  let frames = new Recording(), replayIndex = 0, slow = false, perspective = true, best = 0;
  let particles = [], current = physicsView.snapshot(sim);
  const audioFx=window.DismountAudio.createAudio({host:window,storage,getSubject:()=>current.character,onChange:label=>updateSoundControls(label)});
  const tone=(...args)=>audioFx.tone(...args),unlockAudio=()=>audioFx.unlock();
  let launchPress = null, suppressLaunchClick = false;
  let drag = null, chargeBeat = 0;
  let width = 0, height = 0, scale = 1, offsetX = 0, offsetY = 0,backgroundGradient=null,backgroundKey='',lastDraw=-Infinity;
  const reportValues=new Map();
  function reportText(id,value){if(reportValues.get(id)!==value){$(id).textContent=value;reportValues.set(id,value);}}
  function reportAttr(id,key,value){const cache=id+':'+key;if(reportValues.get(cache)!==value){$(id).setAttribute(key,value);reportValues.set(cache,value);}}
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
    width = rect.width; height = rect.height;backgroundGradient=null;lastDraw=-Infinity;
    $('control-home').style.setProperty?.('--stage-height',$('stage').getBoundingClientRect().height+'px');
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
    const night=appearance.dark,scene=appearance.scene;
    const endless=(current.layout||layout)==='endless';
    const atmosphere=endless?endlessFx.palette(endlessFx.steps(current),night):null;
    const backgroundTop=atmosphere?.backgroundTop||scene.backgroundTop,backgroundBottom=atmosphere?.backgroundBottom||scene.backgroundBottom;
    const key=backgroundTop+backgroundBottom;
    if(!backgroundGradient||backgroundKey!==key) {
      backgroundGradient=ctx.createLinearGradient(0,0,width,height);
      backgroundGradient.addColorStop(0,backgroundTop);backgroundGradient.addColorStop(1,backgroundBottom);backgroundKey=key;
    }
    ctx.fillStyle=backgroundGradient;ctx.fillRect(0,0,width,height);
    let stair=chambers[current.layout||layout];
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
    const depthX=perspective?115:0,depthY=perspective?-68:0;
    if(endless) {
      // Keep both projected faces until they leave the actual camera, including its tracking lag.
      const margin=80,stepWidth=stair.width,rise=stair.rise;
      const first=Math.max(0,Math.floor(((-offsetX-margin)/scale-depthX-stair.start)/stepWidth));
      const end=Math.max(first+1,Math.ceil(((width-offsetX+margin)/scale-stair.start)/stepWidth));
      const treads=Array.from({length:end-first},(_,i)=>{
        const index=first+i;
        return {x:stair.start+index*stepWidth,y:stair.top+(index+1)*rise,width:stepWidth,rise,index};
      });
      stair={...stair,treads,end:stair.start+end*stepWidth,
        floor:Math.max(treads[treads.length-1].y,(height-offsetY+margin)/scale)};
    }
    const jitter=motionEnabled()?Math.min(3,shake*12):0;
    ctx.save();ctx.translate(offsetX+Math.sin(last*.071)*jitter,offsetY+Math.cos(last*.093)*jitter);ctx.scale(scale,scale);
    if(!endless) {
      ctx.strokeStyle=scene.grid;ctx.lineWidth=1;
      for(let x=-200;x<1700;x+=80){ctx.beginPath();ctx.moveTo(x,stair.floor+61);ctx.lineTo(x+450,stair.floor-199);ctx.stroke();}
      for(let y=stair.floor+11;y<stair.floor+211;y+=35){ctx.beginPath();ctx.moveTo(-150,y);ctx.lineTo(1700,y);ctx.stroke();}
    }
    if(stair.kind==='shaft') {
      const block=(x,y,w,h,color)=>{
        polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],color,scene.stroke);
        polygon([[x,y],[x+w,y],[x+w+depthX,y+depthY],[x+depthX,y+depthY]],scene.even,scene.treadStroke);
        line({x,y},{x:x+w,y},scene.edge,2);
      };
      block(40,205,180,stair.floor-205+71,scene.side);
      const w=stair.wall;block(w.x,w.y,w.width,w.height,scene.riser);
      stair.ledges.forEach((t,i)=>{
        block(t.x,t.y,t.width,t.height,scene.side);
        ctx.fillStyle=scene.ledgeInk;ctx.font='10px monospace';ctx.fillText('LEDGE '+(i+1),t.x+8,t.y+14);
      });
      block(stair.start,stair.floor,stair.end+208-stair.start,71,scene.side);
    } else {
      // Staircase side silhouette, with separate tread and riser faces.
      const first=stair.treads[0],clipped=endless&&first.index>0;
      const side=clipped?[[first.x,first.y-first.rise]]:[[40,stair.top],[stair.start,stair.top]];
      for(const t of stair.treads)side.push([t.x,t.y],[t.x+t.width,t.y]);
      if(endless)side.push([stair.end,stair.floor],[clipped?first.x:40,stair.floor]);
      else side.push([stair.end,stair.floor],[stair.end+118,stair.floor],[stair.end+118,stair.floor+71],[40,stair.floor+71]);
      polygon(side,atmosphere?.side||scene.side,atmosphere?.stroke||scene.outline);
      polygon([[40,205],[220,205],[220+depthX,205+depthY],[40+depthX,205+depthY]],scene.platform,scene.platformStroke);
      stair.treads.forEach(t=>{
        const {x,y,width:w,rise}=t;
        // World-indexed colors stay fixed while the camera or replay moves past a step.
        const tint=endless?endlessFx.palette(t.index+1,night):null;
        polygon([[x,y-rise],[x+depthX,y-rise+depthY],[x+depthX,y+depthY],[x,y]],tint?.riser||scene.riser,tint?.stroke||scene.stroke);
        polygon([[x,y],[x+w,y],[x+w+depthX,y+depthY],[x+depthX,y+depthY]],t.index%2?(tint?.odd||scene.odd):(tint?.even||scene.even),tint?.stroke||scene.treadStroke);
        line({x,y},{x:x+w,y},scene.edge,2);
        ctx.fillStyle=tint?.ink||scene.ink;ctx.font='10px monospace';ctx.fillText(String(t.index+1).padStart(2,'0'),x+16,y+21);
      });
      if(endless)for(const t of stair.treads) {
        if((t.index+1)%endlessFx.INTERVAL)continue;
        const tint=endlessFx.palette(t.index+1,night);
        line({x:t.x,y:t.y},{x:t.x+t.width,y:t.y},tint.accent,4);
        ctx.fillStyle=scene.panel;ctx.fillRect(t.x+5,t.y+9,134,29);
        ctx.fillStyle=tint.accent;ctx.font='bold 15px monospace';ctx.fillText((t.index+1)+' STEPS ↓',t.x+12,t.y+29);
      }
      if(!endless)polygon([[stair.end,stair.floor],[stair.end+208,stair.floor],[stair.end+208+depthX,stair.floor+depthY],[stair.end+depthX,stair.floor+depthY]],scene.floor,scene.floorStroke);
      if(stair.drop) {
        const y=stair.treads[stair.treads.length-1].y,x=stair.end;
        polygon([[x,y],[x+depthX,y+depthY],[x+depthX,stair.floor+depthY],[x,stair.floor]],scene.riser,scene.stroke);
        ctx.fillStyle=scene.label;ctx.font='12px monospace';ctx.fillText('FINAL DROP ↓',x-120,y+25);
      }
    }
    // Warning stripe on the starting ledge.
    for(let x=65;x<205;x+=18)polygon([[x,205],[x+9,205],[x+9,213],[x,213]],scene.stripe);
    ctx.fillStyle=scene.startInk;ctx.font='12px monospace';ctx.fillText('START /',64,245);
    if(ghostEnabled&&ghostFrames&&(mode==='running'||mode==='ready'||mode==='charging'||mode==='aiming')) {
      const ghost=ghostFrames.at(Math.min(Math.round(current.time/DT),ghostFrames.length-1));
      ctx.save();ctx.globalAlpha=.22;
      for(const part of ghost.segments) {
        if(part.name==='head')circle(part.ax,part.ay,part.radius,scene.ghost);
        else line({x:part.ax,y:part.ay},{x:part.bx,y:part.by},scene.ghost,part.radius*2);
      }
      ctx.restore();
    }
    const characterId=current.character||'human';
    const pts=current.points;
    window.DismountShadow.draw(ctx,stair,pts[2],depthX,depthY,night);
    // Clothing and tapered silhouettes follow each rigid body's endpoints.
    // Render directly from the skeleton so proportions and collision shapes agree.
    const drawOrder = ['neckLink','leftUpperArm','leftForearm','leftHand','leftThigh','leftShin','leftFoot',
      'torso','abdomen','pelvis','rightThigh','rightShin','rightFoot','rightUpperArm','rightForearm','rightHand'];
    for (const name of drawOrder) {
      const segment = current.segments.find(s => s.name === name);
      if(characterId!=='human'){window.DismountCharacterArt.drawSegment(ctx,segment,characterId);continue;}
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
    if(characterId!=='human')window.DismountCharacterArt.drawHead(ctx,characterId,head.flash);
    else {
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
    }
    ctx.restore();
    // Target indicator and push direction.
    if(mode==='ready'||mode==='charging'||mode==='aiming'){
      const selected=sim.points.findIndex(p=>p.name===$('part').value),p=pts[selected],angle=Number($('angle').value)*Math.PI/180;
      ctx.strokeStyle='#e75b32';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(p.x,p.y,23,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      const arrowColor=`hsl(${120*(1-Math.max(0,Math.min(1,power)))} 80% 42%)`;
      const arrowLength=40+power*160;
      const start={x:p.x-arrowLength*Math.cos(angle),y:p.y+arrowLength*Math.sin(angle)},end={x:p.x-28*Math.cos(angle),y:p.y+28*Math.sin(angle)};
      line(start,end,arrowColor,3);
      polygon([[end.x,end.y],[end.x-13*Math.cos(angle-.45),end.y+13*Math.sin(angle-.45)],[end.x-13*Math.cos(angle+.45),end.y+13*Math.sin(angle+.45)]],arrowColor);
      ctx.fillStyle=scene.label;ctx.font='11px monospace';ctx.fillText(CHARACTERS[current.character||'human'].name.toUpperCase()+' / 01',Math.max(30,p.x-70),35);
    }
    for(const p of particles){
      const color=night?(p.kind==='joint'?'#ff7765':p.edge?'#ffac86':'#b8e1a4'):(p.kind==='joint'?'#b72f29':p.edge?'#d9562e':'#527b42');
      ctx.globalAlpha=Math.max(0,p.life);ctx.strokeStyle=color;ctx.lineWidth=2;
      if(injuryRings) { ctx.beginPath();ctx.arc(p.x,p.y,6+(1-p.life)*10,0,Math.PI*2);ctx.stroke(); }
      ctx.fillStyle=color;ctx.font='bold 12px monospace';
      if(injuryLabels) ctx.fillText(p.label,p.x+10,p.y-10-(1-p.life)*24);
    }
    if(showPhysics)physicsView.draw(ctx,current.physics,scale,night);
    ctx.globalAlpha=1;ctx.restore();
  }
  const damagePoints=()=>groups.reduce((sum,group)=>sum+current.damage[group],0);
  function updateReport() {
    const stats=current.stats||{steps:0,distance:0,maxSpeed:0,airtime:0};
    $('stat-steps-label').textContent=(current.layout||layout)==='shaft'?'Ledges passed':'Steps passed';
    reportText('stat-steps',String(stats.steps));
    reportText('stat-distance',stats.distance.toFixed(2)+' m');
    reportText('stat-speed',stats.maxSpeed.toFixed(2)+' m/s');
    reportText('stat-airtime',stats.airtime.toFixed(2)+' s');
    updateInjuryMap();updateChallenge();updateEndlessProgress();
    reportText('score',String(current.score).padStart(6,'0'));
    const damage=damagePoints(),progress=current.score-damage;
    reportText('score-breakdown','DAMAGE '+damage.toLocaleString()+' + PROGRESS '+progress.toLocaleString());
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
      const color=segment.damage ? `hsl(${Math.round(42-42*intensity)} 75% ${Math.round(65-23*intensity)}%)` : appearance.scene.intact;
      reportAttr('map-'+segment.name,'stroke',color);
      reportAttr('map-'+segment.name,'fill',color);
      const text=partLabels[segment.name]+': '+segment.damage.toLocaleString()+' points, '+segment.hits+' hits';
      reportAttr('map-'+segment.name,'aria-label',text);reportText('map-title-'+segment.name,text);
    }
    for(const joint of current.joints) {
      const node=$('map-joint-'+joint.name);
      reportAttr('map-joint-'+joint.name,'fill',joint.broken?appearance.scene.broken:joint.damage>0?'#e8a23e':appearance.scene.joint);
      reportAttr('map-joint-'+joint.name,'stroke',joint.broken&&!appearance.dark?'#6e1714':appearance.scene.jointStroke);
      reportAttr('map-joint-'+joint.name,'r',joint.broken?'4':'2.5');
      $('map-joint-title-'+joint.name).textContent=joint.name.replace(/([A-Z])/g,' $1')+': '+(joint.broken?theme().broken:joint.damage>0?theme().strained:'intact');
    }
    const broken=current.joints.filter(j=>j.broken).map(j=>j.name.replace(/([A-Z])/g,' $1').toLowerCase());
    $('injury-list').textContent=broken.length?theme().event+': '+broken.join(', ')+'.':theme().none;
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
    reportAttr(prefix+'-meter','aria-valuetext',value+'% — fictional game estimate');
    reportText(prefix+'-value',value+'%');
  }
  function updateBodyDetails() {
    const body=current.segments.find(s=>s.name===selectedBody);
    if(!body)return;
    const joints=current.joints.filter(j=>j.parent===selectedBody||j.child===selectedBody);
    setRecoveryMeter('recovery-overall',recoveryChance(damagePoints(),current.joints,true));
    setRecoveryMeter('recovery-part',recoveryChance(body.damage,joints));
    const label=j=>j.name.replace(/([A-Z])/g,' $1').toLowerCase();
    $('body-detail-title').textContent=partLabels[selectedBody];
    $('body-detail-score').textContent=body.damage.toLocaleString()+' points · '+body.hits+' hits';
    $('body-detail-joints').textContent=joints.map(j=>label(j)+': '+(j.broken?theme().broken:j.damage>0?theme().strained+' '+Math.round(j.damage*100)+'%':'intact')).join(' · ')||'No articulated joints.';
    for(const name of Object.keys(partLabels))reportAttr('map-'+name,'aria-pressed',String(name===selectedBody));
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
  function updatePhysicsToggle() {
    $('physics-view').textContent=showPhysics?'PHYSICS ON':'PHYSICS OFF';
    $('physics-view').setAttribute('aria-pressed',String(showPhysics));
    $('physics-legend').hidden=!showPhysics;
  }
  updatePhysicsToggle();
  $('physics-view').addEventListener('click',()=>{
    showPhysics=!showPhysics;updatePhysicsToggle();lastDraw=-Infinity;
  });
  appearance.bind($('theme-toggle'));
  appearance.subscribe(()=>{backgroundGradient=null;lastDraw=-Infinity;updateReport();});
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
  const originalMapPaths=Object.fromEntries(['head','torso'].map(name=>[name,$('map-'+name).getAttribute('d')]));
  function applyReportTheme() {
    const t=themes[character];
    $('damage-map-heading').textContent=t.title;
    $('summary-joint-caption').textContent=character==='robot'?'FAILED JOINTS':character==='inflatable'?'FAILED SEAMS':character==='skeleton'?'SEPARATED JOINTS':'DISLOCATED JOINTS';
    $('recovery-overall-caption').textContent=t.overall;$('recovery-part-caption').textContent=t.part;
    $('recovery-help').textContent=t.help;
    $('map-legend').textContent='Gray: no impact · Yellow → red: damage. Red joint dots: '+t.broken+'.';
    $('body-map-details').setAttribute('visibility',character==='human'?'visible':'hidden');
    for(const name of ['head','torso'])$('map-'+name).setAttribute('d',t[name]||originalMapPaths[name]);
  }
  function updateGhost() {
    $('ghost').disabled=!ghostFrames;
    $('ghost').textContent=ghostEnabled?'GHOST ON':'GHOST OFF';$('ghost').setAttribute('aria-pressed',String(ghostEnabled));
  }
  $('ghost').addEventListener('click',()=>{ghostEnabled=!ghostEnabled;updateGhost();lastDraw=-Infinity;});
  $('challenge').value=challenge;
  $('challenge-description').textContent=goals[challenge].description;
  $('challenge').addEventListener('change',()=>{
    if(!['ready','finished'].includes(mode)){$('challenge').value=challenge;return;}
    challenge=Object.hasOwn(goals,$('challenge').value)?$('challenge').value:'none';
    $('challenge-description').textContent=goals[challenge].description;updateChallenge();
  });
  function updateChallenge() {
    const result=evaluate(challenge,current,mode==='ready'?null:runPush);
    $('challenge-status').hidden=challenge==='none'||mode==='replay'||mode==='loadingReplay'||!!replayLabel;
    reportText('challenge-status',(result.complete?'✓ Complete · ':'')+result.text);
    reportAttr('challenge-status','data-complete',String(result.complete));
  }
  function updateEndlessProgress() {
    const visible=(current.layout||layout)==='endless';
    $('endless-progress').hidden=!visible;
    if(!visible){clearMilestone();return;}
    const depth=endlessFx.steps(current),zone=endlessFx.palette(depth);
    reportText('endless-zone','SUBLEVEL '+String(zone.zone).padStart(2,'0')+' · '+zone.name.toUpperCase());
    reportText('endless-depth',depth+' STEPS ↓');
    reportText('endless-next','NEXT '+((Math.floor(depth/endlessFx.INTERVAL)+1)*endlessFx.INTERVAL)+' · BEST '+depthRecords.best(current.character));
  }
  function clearMilestone() {milestoneLife=0;$('endless-milestone').hidden=true;}
  function updateChamberNumber() {
    const number=Array.from($('layout').options).findIndex(option=>option.value===layout)+1;
    $('chamber-number').textContent='TEST CHAMBER / '+String(number).padStart(2,'0');
    $('layout-caption').textContent=layout==='endless'?'ENDLESS STAIRS · 120 s MAX':LAYOUTS[layout].count+(LAYOUTS[layout].kind==='shaft'?' LEDGES · ':' STEPS · ')+LAYOUTS[layout].name.toUpperCase();
    $('highscores-title').textContent='High scores · '+LAYOUTS[layout].name+(character==='human'?'':' · '+CHARACTERS[character].name);
    $('character-description').textContent=CHARACTERS[character].description;
    applyReportTheme();
  }
  $('layout').value=layout;
  $('character').value=character;
  updateChamberNumber();
  function updateChamberUrl() {
    try {
      const url=new URL(window.location.href);
      if(url.hash.startsWith('#replay='))url.hash='';
      url.searchParams.set('chamber',layout);
      if(character==='human')url.searchParams.delete('character');
      else url.searchParams.set('character',character);
      window.history.replaceState(window.history.state,'',url.href);
    } catch (_) { /* Selection still works for restricted embeds and local files. */ }
  }
  function changeChamber() {
    if(!['ready','finished'].includes(mode)||!Object.hasOwn(LAYOUTS,$('layout').value)||!Object.hasOwn(CHARACTERS,$('character').value)) {
      $('layout').value=layout;$('character').value=character;return;
    }
    bests.set(selectionKey(),best);layout=$('layout').value;character=$('character').value;setBadgeEntry(null);
    updateChamberNumber();updateChamberUrl();sim=new Simulation(layout,character);frames=new Recording();ghostFrames=null;attemptCompleted=false;updateGhost();retryRecipe=null;
    const key=selectionKey();
    if(!boards.has(key))boards.set(key,new ScoreBoard(storage,REPLAY_VERSION,layout,character));
    board=boards.get(key);best=0;
    try{best=Math.max(0,Number(storage.getItem(bestKey()))||0);}catch(_){}
    best=Math.max(best,bests.get(key)||0,...board.entries.map(e=>e.score));$('best').textContent=best.toLocaleString();
    reset();
  }
  $('character').addEventListener('change',changeChamber);
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
    $('welcome-chamber-description').textContent=chamberDescriptions[$('welcome-layout').value]||chamberDescriptions.endless;
  }
  $('welcome-layout').value=layout;describeWelcomeChamber();
  $('welcome-character').value=character;
  function describeWelcomeCharacter() {
    $('welcome-character-description').textContent=CHARACTERS[$('welcome-character').value]?.description||CHARACTERS.human.description;
  }
  describeWelcomeCharacter();
  $('welcome-character').addEventListener('change',describeWelcomeCharacter);
  $('welcome-layout').addEventListener('change',describeWelcomeChamber);
  let welcomeClosing=false;
  function enterWelcomeChamber() {
    if(welcomeClosing)return;
    const selected=$('welcome-layout').value,selectedCharacter=$('welcome-character').value;
    if(!Object.hasOwn(LAYOUTS,selected)||!Object.hasOwn(CHARACTERS,selectedCharacter))return;
    unlockAudio();
    $('layout').value=selected;$('character').value=selectedCharacter;changeChamber();
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
    const historicalPhysics=retryRecipe?.engine&&retryRecipe.engine!==REPLAY_VERSION;
    $('retry-edit').disabled=unavailable;$('retry').disabled=unavailable||historicalAngle||historicalPhysics;
    $('retry').title=historicalPhysics?'This replay uses older physics. Use Tweak last push.':historicalAngle?'This historical angle is outside the current range. Use Tweak last push.':'';
    $('slow').disabled=mode==='replay'||mode==='loadingReplay';
    $('part').disabled=value;$('angle').disabled=value;$('layout').disabled=!['ready','finished'].includes(mode);$('character').disabled=$('layout').disabled;$('challenge').disabled=$('layout').disabled;renderBoard();
  }
  function reset() {
    depthRecords.save();clearMilestone();
    audioFx.clear();
    replayJob?.worker?.terminate();
    playbackFrames=new Recording();
    replayIndex=0;
    peakFrame=0;
    replayPaused=false;
    $('replay-controls').hidden=true;
    $('retry-settings').hidden=true;
    noticeLife=0;
    $('impact-notice').hidden=true;
    camera=null;
    impactSlow=0;
    impactCooldown=0;
    shake=0;
    replayJob=null;
    pendingScore=null;
    replayLabel='';
    $('score-entry').hidden=true;
    $('save-message').textContent='';
    cancelLaunchPress();
    $('stage').setAttribute('data-finished','false');
    cancelDrag();
    mode='ready';
    sim.reset();
    current=physicsView.snapshot(sim);
    particles=[];
    accumulator=0;
    power=0;
    $('drop').disabled=false;
    $('result').hidden=true;
    $('launch').disabled=false;
    $('launch').innerHTML='Hold to charge <span>↗</span>';
    $('status').textContent='READY TO DISMOUNT';
    $('hint').textContent='HOLD OR DRAG ANYWHERE. RELEASE TO PUSH.';
    $('power-value').textContent='—';
    $('power-fill').style.width='0%';
    $('power-help').textContent='Hold and release to push, or use two short clicks.';
    $('replay').disabled=!frames.length;
    lock(false);
    updateReport();
  }
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
    setBadgeEntry(null);updateChamberUrl();
    if(attemptCompleted&&frames.length){ghostFrames=frames;attemptCompleted=false;updateGhost();}
    $('settings-drawer').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');
    pendingScore=null;mode='running';lock(true);frames=new Recording();frames.push(physicsView.snapshot(sim));sim.push(runPush.part,runPush.angle,runPush.power);accumulator=0;
    $('status').textContent='DISMOUNT IN PROGRESS';$('launch').textContent='Experiment in progress…';$('launch').disabled=true;$('hint').textContent='GRAVITY HAS TAKEN OVER.';$('power-help').textContent='Push locked. Watch the impacts accumulate.';
  }
  // Presentation-only randomness: never used by the simulation or replay recipes.
  const resultJokes={
    record:[
      'A personal best. A personnel problem.',
      'Employee of the descent.',
      'The stairs would like your autograph.',
      'A standing ovation. From everyone else.',
      'Promoted to senior crash consultant.',
      'Your résumé now includes every step.'
    ],
    gentle:[
      'Gravity sent a polite reminder.',
      'A minor disagreement with standing.',
      'The floor accepted your friend request.',
      'A nap with unnecessary paperwork.',
      'Technically, that was a delivery.',
      'The stairs expected more commitment.'
    ],
    medium:[
      'One small step. Several poor choices.',
      'You have reached your dismountination.',
      'A practical introduction to downstairs.',
      'The floor has entered the chat.',
      'That meeting could have been an elevator.',
      'Gravity: 1. Dignity: buffering.'
    ],
    huge:[
      'You took the scenic route to horizontal.',
      'The stairs have filed a noise complaint.',
      'A masterclass in downward mobility.',
      'Gravity has renewed your subscription.',
      'An ambitious merger with the architecture.',
      'You are now on a first-name basis with concrete.'
    ],
    airborne:[
      'Briefly an aircraft. Permanently unlicensed.',
      'Your landing gear was mostly optimism.',
      'Flight mode did not include landing mode.',
      'The floor declined your request to stay airborne.'
    ],
    endless:[
      'An unpaid internship in gravity.',
      'Still no elevator in the budget.',
      'Your downstairs subscription auto-renewed.',
      'The stairs have more sequels than a movie franchise.'
    ],
    observations:[
      'The handrail declined to comment.',
      'The safety briefing has been moved to yesterday.',
      'The lab coat makes this science.',
      'All steps were taken. None were sensible.',
      'The incident report now has chapters.',
      'Our expert panel said “oof” in three languages.',
      'No stairs were emotionally prepared for this.',
      'The control group has requested a chair.'
    ],
    verdicts:[
      'Peer review: please use the elevator.',
      'Recommendation: fewer stairs, more sofa.',
      'Funding approved. Supervision increased.',
      'Conclusion: the floor remains undefeated.',
      'Next experiment: reading the warning sign.',
      'Research status: impressively horizontal.'
    ]
  };
  const jokeBags=new Map();
  function nextJoke(category) {
    let bag=jokeBags.get(category);
    if(!bag||!bag.remaining.length) {
      const previous=bag?.previous;
      const remaining=[...resultJokes[category]];
      for(let i=remaining.length-1;i>0;i--) {
        const j=Math.floor(Math.random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];
      }
      if(remaining.at(-1)===previous)[remaining[0],remaining[remaining.length-1]]=[remaining.at(-1),remaining[0]];
      bag={remaining,previous};jokeBags.set(category,bag);
    }
    bag.previous=bag.remaining.pop();return bag.previous;
  }
  function resultDescription(record) {
    const category=record?'record':current.score<=1000?'gentle':
      layout==='endless'?'endless':current.stats?.airtime>2?'airborne':current.score>5000?'huge':'medium';
    return {title:nextJoke(category),quip:nextJoke('observations')+' '+nextJoke('verdicts')};
  }
  function finish(replaying=false){
    if(!replaying)depthRecords.save();
    clearMilestone();
    if(!replaying){retryRecipe={...runPush,layout,character};attemptCompleted=true;ghostFrames=frames;updateGhost();}
    else {replayPaused=true;updateReplayControls();}
    mode='finished';lock(true);$('launch').disabled=false;$('launch').innerHTML='New experiment <span>↗</span>';$('status').textContent='EXPERIMENT COMPLETE';$('replay').disabled=!frames.length;
    pendingScore=replaying?null:{push:{...runPush},score:current.score,hits:current.hits,time:current.time,steps:frames.length-1};
    if(!replaying)setBadgeEntry({...pendingScore,id:'last-run',nick:'RUN',savedAt:0,layout,character,engine:REPLAY_VERSION});
    $('score-entry').hidden=replaying||!board.qualifies(current.score);
    $('save-message').textContent='';
    const record=!replaying&&current.score>best;
    if(record){best=current.score;try{localStorage.setItem(bestKey(),String(best));}catch(_){}$('best').textContent=best.toLocaleString();}
    const description=replaying?null:resultDescription(record);
    $('result-outcome').textContent=replaying?'REPLAY COMPLETE':record?'NEW PERSONAL BEST':'EXPERIMENT COMPLETE';
    $('result-title').textContent=replaying?(replayLabel?'Replay · '+replayLabel:'Replay complete.'):description.title;
    $('result-quip').textContent=replaying?'Same stairs. Same decisions. Still somehow surprising.':description.quip;
    $('result-detail').textContent=`${current.score.toLocaleString()} points · ${current.hits} impacts · ${current.time.toFixed(2)} seconds`;
    const damage=damagePoints(),progress=current.score-damage;
    $('result-score-breakdown').textContent=`Damage ${damage.toLocaleString()} + Progress ${progress.toLocaleString()} = ${current.score.toLocaleString()}`;
    tone(440,880,.25,.06);
    $('stage').setAttribute('data-finished','true');
    updateReport();
    $('result').hidden=false;$('hint').textContent='CLICK ANYWHERE ON THE STAGE TO TRY AGAIN.';
  }
  function renderBoard() {
    const rows=(entries,target)=>{
      target.replaceChildren();
      entries.forEach((entry, index) => {
        const row = document.createElement('tr');
        for (const value of [String(index+1).padStart(2,'0'), entry.nick, entry.score.toLocaleString()]) {
          const cell = document.createElement('td'); cell.textContent=value; row.appendChild(cell);
        }
        const cell=document.createElement('td'), button=document.createElement('button');
        button.type='button'; button.setAttribute('data-score-id',entry.id);
        button.textContent=supportsReplay(entry)?'▷ Replay':'Unavailable';
        button.disabled=!['ready','finished'].includes(mode)||!supportsReplay(entry);
        button.setAttribute('aria-label','Replay '+entry.nick+' — '+entry.score+' points');
        if(!supportsReplay(entry))button.title='Recorded with a different physics version.';
        cell.appendChild(button);
        if(supportsReplay(entry)) {
          const badge=document.createElement('button');badgeView.decorate(badge,entry);
          badge.setAttribute('data-badge-id',entry.id);cell.appendChild(badge);
        }
        row.appendChild(cell);target.appendChild(row);
      });
    };
    rows(board.entries,$('score-rows'));rows(board.previousEntries,$('previous-score-rows'));
    $('previous-scores').hidden=!board.previousEntries.length;
    $('board-empty').hidden=board.entries.length>0;
    $('board-message').textContent=board.persistent?'Saved in this browser. Replay any recorded run.':'Browser storage unavailable. Scores last for this session only.';
  }
  function revealStage() {
    if(document.fullscreenElement||document.webkitFullscreenElement||$('game-panel').getAttribute('data-expanded')==='true')return;
    $('game-panel').scrollIntoView?.({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function startReplay(recording, label='', recipe=runPush,engine=REPLAY_VERSION) {
    clearMilestone();
    if(recipe) {
      const end=recording.at(-1);
      const sameBadge=badgeEntry&&badgeEntry.layout===layout&&badgeEntry.character===character&&badgeEntry.engine===engine
        &&badgeEntry.score===end.score&&badgeEntry.steps===recording.length-1
        &&['part','angle','power'].every(key=>badgeEntry.push[key]===recipe[key]);
      setBadgeEntry({id:'replayed-run',savedAt:0,nick:/^[A-Z]{3}$/.test(label)?label:sameBadge?badgeEntry.nick:'RUN',layout,character,engine,
        push:{...recipe},score:end.score,hits:end.hits,time:end.time,steps:recording.length-1});
    }
    revealStage();
    unlockAudio();noticeLife=0;$('impact-notice').hidden=true;replayPaused=false;peakFrame=0;let peakPoints=-1;
    peakFrame=recording.peakIndex;peakPoints=recording.peakPoints;
    $('replay-peak').disabled=peakPoints<0;
    if(recipe)retryRecipe={...recipe,layout,character,engine};
    $('replay-controls').hidden=false;$('retry-settings').hidden=true;
    playbackFrames=recording;replayLabel=label;pendingScore=null;replayJob=null;
    camera=null;impactSlow=0;shake=0;impactCooldown=0;mode='replay';$('stage').setAttribute('data-finished','false');$('drop').disabled=true;
    replayIndex=0;accumulator=0;particles=[];current=recording.at(0);lock(true);
    $('result').hidden=true;$('score-entry').hidden=true;$('status').textContent='REPLAYING EXPERIMENT';
    $('launch').disabled=true;$('replay').disabled=true;updateReplayControls();updateReport();$('hint').textContent=label?'REPLAY / '+label:'REPLAY / RECORDED PHYSICS';
  }
  function updateReplayControls() {
    $('replay-timeline').max=Math.max(0,playbackFrames.length-1);
    $('replay-timeline').value=replayIndex;
    $('replay-time').textContent=(playbackFrames.at(replayIndex)?.time||0).toFixed(2)+' / '+(playbackFrames.at(-1)?.time||0).toFixed(2)+' s · frame '+replayIndex;
    $('replay-toggle').textContent=replayPaused?'▶ Play':'Ⅱ Pause';
    $('replay-toggle').setAttribute('aria-pressed',String(!replayPaused));
    $('replay-back').disabled=replayIndex===0;
    $('replay-forward').disabled=replayIndex>=playbackFrames.length-1;
  }
  function seekReplay(index) {
    if(!playbackFrames.length||$('replay-controls').hidden)return;
    clearMilestone();
    mode='replay';replayPaused=true;camera=null;accumulator=0;impactSlow=0;shake=0;particles=[];noticeLife=0;$('impact-notice').hidden=true;
    replayIndex=Math.max(0,Math.min(playbackFrames.length-1,Math.round(Number(index)||0)));
    current=playbackFrames.at(replayIndex);pendingScore=null;
    $('result').hidden=true;$('stage').setAttribute('data-finished','false');
    $('launch').disabled=true;$('status').textContent='REPLAY PAUSED';lock(true);
    showFrameEvents(current,(replayIndex?playbackFrames.at(replayIndex-1):undefined),false);
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
    if(!edit&&(recipe.angle < -100 || recipe.angle > 100 || recipe.engine&&recipe.engine!==REPLAY_VERSION))return;
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
    const milestone=endlessFx.milestone(frame,previous);
    const record=mode==='running'&&milestone&&milestone.steps>depthRecords.best(frame.character);
    if(mode==='running')depthRecords.record(frame);
    if(milestone&&audible) {
      reportText('endless-milestone-title',(record?'NEW DEPTH RECORD · ':'MILESTONE · ')+milestone.steps+' STEPS');
      reportText('endless-milestone-joke',milestone.joke);
      $('endless-milestone').hidden=false;milestoneLife=4;
      if(mode==='running')depthRecords.save();
    }
    for(const hit of frame.impacts||[]) {
      const kind=hit.edge?'EDGE':hit.self?'BODY CONTACT':'LANDING';
      particles.push({...hit,life:1,label:kind+' +'+hit.points});
      $('impact-notice').textContent=(partLabels[hit.segment]||hit.group)+' · '+kind+' +'+hit.points;
      noticeLife=1.1;$('impact-notice').hidden=!injuryLabels;
      if(audible)impactFeedback(hit);
    }
    const broken=new Set((previous?.joints||[]).filter(j=>j.broken).map(j=>j.name));
    for(const j of frame.joints||[])if(j.broken&&!broken.has(j.name)) {
      particles.push({x:j.x,y:j.y,life:1,kind:'joint',label:theme().event});
      $('impact-notice').textContent=j.name.replace(/([A-Z])/g,' $1')+' · '+theme().event;
      noticeLife=1.1;$('impact-notice').hidden=!injuryLabels;
    }
    if(audible)audioFx.queue(frame);
    particles=particles.slice(-32);
  }
  function buildReplayChunk() {
    const job=replayJob;
    if(!job||job.worker)return;
    const started=window.performance?.now();
    for(let i=0;i<30&&job.steps<job.entry.steps;i++) {
      if(i>0&&started!==undefined&&window.performance.now()-started>=8)break;
      physicsView.step(job.sim);const frame=physicsView.snapshot(job.sim);frame.impacts=job.sim.impacts.map(hit=>({...hit}));
      job.frames.push(frame);job.steps++;
    }
    $('status').textContent='PREPARING REPLAY · '+Math.round(job.steps/job.entry.steps*100)+'%';
    if(job.steps===job.entry.steps) {
      if(!validEnd(job.frames,job.entry)) {
        reset();$('board-message').textContent='This replay cannot be reproduced in this browser.';return;
      }
      replayCache={key:replayKey(job.entry),frames:job.frames};
      startReplay(job.frames,job.entry.nick,job.entry.push,job.entry.engine);
    }
  }
  function replayScore(event) {
    const button=event.target.closest('button[data-score-id],button[data-badge-id]');
    if(!button)return;
    const scoreId=button.getAttribute('data-score-id');
    if(!scoreId) {
      const entry=board.get(button.getAttribute('data-badge-id'));
      if(entry&&supportsReplay(entry))badgeView.show(entry);return;
    }
    if(!['ready','finished'].includes(mode))return;
    const entry=board.get(scoreId);
    loadReplay(entry);
  }
  function loadReplay(entry) {
    if(!entry||!supportsReplay(entry))return;
    revealStage();unlockAudio();
    if(replayCache?.key===replayKey(entry)){startReplay(replayCache.frames,entry.nick,entry.push,entry.engine);return;}
    replayJob={entry,worker:null};
    const job=replayJob;
    const fallback=()=>{
      job.worker?.terminate();job.worker=null;
      if(replayJob!==job)return;
      job.sim=new Simulation(entry.layout||'classic',entry.character||'human',entry.engine);
      job.frames=new Recording();job.frames.push(physicsView.snapshot(job.sim));job.steps=0;
      job.sim.push(entry.push.part,entry.push.angle,entry.push.power);
    };
    try {
      if(!window.Worker||window.location?.protocol==='file:')fallback();
      else {
        job.worker=new window.Worker('src/replay-worker.js');
        job.worker.onmessage=({data})=>{
          if(replayJob!==job)return;
          if(data.error){fallback();return;}
          if(data.recording) {
            const recording=Recording.from(data.recording);job.worker.terminate();
            if(!validEnd(recording,entry)){reset();$('board-message').textContent='This replay cannot be reproduced in this browser.';return;}
            replayCache={key:replayKey(entry),frames:recording};startReplay(recording,entry.nick,entry.push,entry.engine);
          }else $('status').textContent='PREPARING REPLAY · '+Math.round(data.progress*100)+'%';
        };
        job.worker.onerror=event=>{event.preventDefault?.();fallback();};
        job.worker.postMessage(entry);
      }
    }catch(_){fallback();}
    mode='loadingReplay';$('replay-controls').hidden=true;pendingScore=null;lock(true);$('result').hidden=true;
    $('stage').setAttribute('data-finished','false');$('drop').disabled=true;
    $('launch').disabled=true;$('replay').disabled=true;
    $('status').textContent='PREPARING REPLAY';$('hint').textContent='REBUILDING RECORDED PHYSICS…';
  }
  for(const id of ['score-rows','previous-score-rows'])$(id).addEventListener('click',replayScore);
  $('initials').addEventListener('input',()=>{$('initials').value=normalizeNick($('initials').value);});
  $('score-entry').addEventListener('submit',event=>{
    event.preventDefault();
    if(mode!=='finished'||!pendingScore)return;
    const nick=normalizeNick($('initials').value);$('initials').value=nick;
    const result=board.save(nick,pendingScore);
    if(!result.ok){$('save-message').textContent=result.message;return;}
    setBadgeEntry(result.entry);
    pendingScore=null;$('score-entry').hidden=true;renderBoard();
    $('save-message').textContent=result.persistent?'Saved as '+nick+'.':'Saved for this session only; browser storage is unavailable.';
  });
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
  let fpsLast=null,fpsElapsed=0,fpsFrames=0;
  document.addEventListener('visibilitychange',()=>{
    fpsLast=null;fpsElapsed=0;fpsFrames=0;$('fps').textContent='— FPS';
  });
  function updateFps(now) {
    if(document.hidden)return;
    if(fpsLast!==null) {
      fpsElapsed+=now-fpsLast;fpsFrames++;
      if(fpsElapsed>=500) {
        $('fps').textContent=Math.round(fpsFrames*1000/fpsElapsed)+' FPS';
        fpsElapsed=0;fpsFrames=0;
      }
    }
    fpsLast=now;
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
          physicsView.step(sim);current=physicsView.snapshot(sim);current.impacts=sim.impacts.map(hit=>({...hit}));frames.push(current);
          showFrameEvents(current,previous);
          if(!sim.active)finish();
        }else{
          replayIndex=Math.min(replayIndex+1,playbackFrames.length-1);current=playbackFrames.at(replayIndex);
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
      milestoneLife=Math.max(0,milestoneLife-delta);if(!milestoneLife)$('endless-milestone').hidden=true;
    }
    audioFx.flush();
    const moving=['running','charging','aiming'].includes(mode)||(mode==='replay'&&!replayPaused)||particles.length||shake>0;
    if(!document.hidden&&(moving||now-lastDraw>=100)){render();updateFps(now);lastDraw=now;}
    requestAnimationFrame(tick);
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
  window.DismountFullscreen.attach({host:window,document,$,resize:()=>{camera=null;resize();},cancelGesture:()=>{if(drag||launchPress)reset();}});
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
  function updateSoundControls(label=audioFx.label) {
    for(const id of ['sound','stage-sound']) {
      $(id).textContent=label;$(id).setAttribute('aria-pressed',String(audioFx.enabled));
    }
  }
  $('sound').addEventListener('click',()=>audioFx.toggle());
  $('stage-sound').addEventListener('click',()=>audioFx.toggle());
  $('volume').value=String(Math.round(audioFx.volume*100));
  $('volume-value').textContent=$('volume').value+'%';
  $('volume').addEventListener('input',()=>{audioFx.setVolume(Number($('volume').value)/100);$('volume-value').textContent=$('volume').value+'%';});
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
    const angle = Math.round(Math.max(-100, Math.min(100, Math.atan2(dy, dx) * 180 / Math.PI)) * 4) / 4;
    power = Math.min(1, drag.distance / drag.powerDistance);
    $('angle').value = String(angle); $('angle-value').textContent = angle + '°';
    $('power-fill').style.width = power * 100 + '%';
    $('power-value').textContent = Math.round(power * 100) + '%';
  }
  canvas.addEventListener('pointermove', updateMouseAim);
  function releaseMouseAim(event) {
    // Touch release is an activation gesture on Safari, unlike some pointer-down events.
    if(audioFx.needsResume)unlockAudio();
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
  reset();resize();
  if(sharedLink.entry) {
    $('part').value=sharedLink.entry.push.part;$('angle').value=String(sharedLink.entry.push.angle);
    $('angle-value').textContent=sharedLink.entry.push.angle+'°';loadReplay(sharedLink.entry);
  } else {
    if(sharedLink.error)$('board-message').textContent=sharedLink.error;
    if(!linkedChamber&&!linkedCharacter)$('welcome').showModal?.();
  }
  requestAnimationFrame(tick);
})();
