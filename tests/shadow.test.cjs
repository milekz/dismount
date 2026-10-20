const test=require('node:test');
const assert=require('node:assert/strict');
const {project,draw}=require('../src/shadow.js');
const {buildStair,LAYOUTS}=require('../src/physics.js');

test('one footprint spans neighboring treads continuously instead of snapping between their heights',()=>{
  const stair=buildStair('classic'),a=project(stair,{x:268-.001,y:210}),b=project(stair,{x:268+.001,y:210});
  for(const patches of [a,b]) {
    assert.ok(patches.some(p=>p.y===236));
    assert.ok(patches.some(p=>p.y===267));
  }
  assert.equal(a.length,b.length);
  a.forEach((patch,i)=>{
    assert.equal(patch.y,b[i].y);
    assert.ok(Math.abs(patch.x-b[i].x)<.003);
    assert.ok(Math.abs(patch.left-b[i].left)<.003&&Math.abs(patch.right-b[i].right)<.003);
    assert.equal(patch.alpha,b[i].alpha);
  });
});

test('shaft shadows fade between overlapping ledges and land on the floor across open gaps',()=>{
  const stair=buildStair('shaft');
  const atCenter=y=>project(stair,{x:270,y}).filter(p=>p.left<=270&&p.right>270);
  const above=atCenter(329),below=atCenter(342),farther=atCenter(355);
  assert.ok(above.some(p=>p.y===330));assert.ok(!above.some(p=>p.y===550));
  assert.ok(below.some(p=>p.y===330)&&below.some(p=>p.y===550));
  assert.ok(!farther.some(p=>p.y===330));assert.ok(farther.some(p=>p.y===550));
  const gap=project(stair,{x:430,y:400});assert.ok(gap.length);
  assert.ok(gap.every(p=>p.y===stair.floor));
});

test('endless projection uses world steps at any depth and never its artificial render floor',()=>{
  const stair=buildStair('endless');
  const point={x:220+500*48+20,y:205+500*31};
  const clipped={...stair,treads:[],floor:999999,end:100};
  const patches=project(clipped,point);
  assert.deepEqual(patches,project(stair,point));
  assert.ok(patches.length>1&&patches.length<=5);
  assert.ok(patches.every(p=>p.y!==clipped.floor&&(p.y-205)%31===0));
});

test('projection is deterministic across layout changes and brightens near a surface',()=>{
  const point={x:280,y:210},stair=buildStair('classic'),original=JSON.stringify(stair),a=project(stair,point);
  for(const id of Object.keys(LAYOUTS)) {
    const patches=project(buildStair(id),point);
    assert.ok(patches.length<15);
    assert.ok(patches.every(p=>p.left<p.right&&p.alpha>0&&p.alpha<=.16&&Number.isFinite(p.y)));
  }
  assert.deepEqual(project(stair,point),a);assert.equal(JSON.stringify(stair),original);
  const close=project(stair,{x:280,y:230}).find(p=>p.y===267);
  const distant=project(stair,{x:280,y:20}).find(p=>p.y===267);
  assert.ok(close.alpha>distant.alpha);
});

test('renderer clips a soft gradient to every projected surface in side and perspective views',()=>{
  const clips=[],transforms=[],alphas=[],gradients=[];let saves=0,restores=0;
  const ctx={save(){saves++;},restore(){restores++;},transform(...args){transforms.push(args);},
    beginPath(){},rect(...args){clips.push(args);},clip(){},translate(){},scale(){},arc(){},
    fill(){alphas.push(this.globalAlpha);},
    createRadialGradient(){const stops=[];gradients.push(stops);return {addColorStop:(...args)=>stops.push(args)};}};
  const stair=buildStair('classic'),point={x:268,y:210},patches=project(stair,point);
  for(const [dx,dy] of [[0,0],[115,-68]]) {
    draw(ctx,stair,point,dx,dy);
    assert.equal(transforms.at(-1)[2],dy?dx/dy:0);
  }
  assert.equal(saves,patches.length*2);assert.equal(saves,restores);
  assert.equal(clips.length,saves);assert.equal(gradients.length,saves);
  assert.ok(clips.every(c=>c[2]>0&&c[3]>0));
  assert.ok(gradients.every(stops=>stops.at(-1)[1]==='#3f503200'));
  assert.deepEqual(alphas,[...patches,...patches].map(p=>p.alpha));
});
