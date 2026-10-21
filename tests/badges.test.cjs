const test=require('node:test'),assert=require('node:assert/strict');
const badges=require('../src/badges.js'),physics=require('../src/physics.js');
const entry=(overrides={})=>({id:'test-run',savedAt:0,nick:'QRX',layout:'classic',character:'human',engine:physics.REPLAY_VERSION,
  score:17622,hits:35,steps:2160,time:17.99999999999962,push:{part:'neck',angle:-10.25,power:.7536487123954876},...overrides});

test('badge links round-trip exact recipes for every chamber and subject without local storage',()=>{
  for(const layout of Object.keys(physics.LAYOUTS))for(const character of Object.keys(physics.CHARACTERS)) {
    const source=entry({layout,character}),url=badges.link(source,'https://example.com/play/?obsolete=1#old');
    const restored=badges.readLink(url).entry;
    assert.ok(restored);assert.deepEqual(restored.push,source.push);
    for(const key of ['nick','layout','character','engine','score','hits','time','steps'])assert.equal(restored[key],source[key]);
    assert.equal(new URL(url).searchParams.has('obsolete'),false);
    assert.ok(url.length<300);
  }
});

test('zero power, fine angles and historical replay versions stay exact',()=>{
  for(const [engine,character,part,angle,power] of [
    ['rigid-3.1.0','inflatable','neck',.25,0],['rigid-3.0.0','robot','leftFoot',-100,1],
    ['rigid-2.3.0','knight','head',105,.1],['rigid-2.2.0','human','chest',6,1e-9]
  ]) {
    const source=entry({engine,character,push:{part,angle,power}}),restored=badges.readLink(badges.link(source)).entry;
    assert.ok(restored);assert.deepEqual(restored.push,source.push);assert.equal(restored.engine,engine);
  }
  const url=new URL(badges.link(entry()));url.searchParams.set('chamber','1');
  assert.equal(badges.readLink(url.href).entry.layout,'classic');
  assert.equal(new URL(badges.link(entry(),'file:///some/index.html')).origin,'https://milekz.github.io');
});

test('malformed, oversized and unsupported links cannot start replay work',()=>{
  const good=badges.link(entry());
  for(const transform of [
    u=>u.replace('replay=1~','replay=2~'),u=>u.replace('rigid-3.1.0','rigid-99.0.0'),
    u=>u.replace('~neck~','~unknown~'),u=>u.replace('~-10.25~','~NaN~'),
    u=>u.replace('~-10.25~','~~'),u=>u.replace('~2160~','~999999~'),
    u=>u.replace('~2160~','~1.5~'),u=>u.replace('~QRX','~<b>'),
    u=>u.replace('chamber=classic','chamber=constructor'),u=>u+'&extra',
    u=>u.replace('~0.7536487123954876~','~1.01~'),u=>u+'x'.repeat(600)
  ]) {const result=badges.readLink(transform(good));assert.ok(result.error);assert.equal(result.entry,undefined);}
  assert.deepEqual(badges.readLink('https://example.com/?chamber=1'),{});
  assert.deepEqual(badges.readLink(undefined),{});
  assert.throws(()=>badges.link(entry({score:-1})));
});

test('QR matrices are sized for the exact URL and have intact finder patterns',()=>{
  const cells=badges.matrix(badges.link(entry()));
  assert.equal((cells.length-17)%4,0);assert.ok(cells.length<=69);
  for(const [x,y] of [[0,0],[cells.length-7,0],[0,cells.length-7]]) {
    for(let r=0;r<7;r++)for(let c=0;c<7;c++)
      assert.equal(cells[y+r][x+c],r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4));
  }
});

test('badge export is a full-size PNG with whole QR modules and no retained canvas',()=>{
  const rectangles=[],text=[];let canvas;
  const ctx={fillRect(...args){rectangles.push(args);},strokeRect(){},fillText(value){text.push(value);}};
  const document={createElement:()=>canvas={getContext:()=>ctx,toDataURL:type=>{assert.equal(type,'image/png');return 'data:image/png;base64,cG5n';}}};
  const source=entry(),asset=badges.render(source,document,badges.PUBLIC_URL);
  assert.equal(canvas.width,960);assert.equal(canvas.height,480);assert.equal(asset.canvas,undefined);
  assert.ok(text.includes('-10.25°  /  75.36% POWER'));assert.ok(text.includes('SCAN TO REPLAY'));
  assert.deepEqual(badges.readLink(asset.url).entry.push,source.push);
  const modules=rectangles.slice(3);
  assert.ok(modules.length>100);
  for(const rect of modules)assert.ok(rect.every(Number.isInteger));
});

test('PNG and URL are copied together synchronously from the click, and failure stays observable',async()=>{
  let written;
  const asset={url:badges.link(entry()),dataURL:'data:image/png;base64,cG5n'};
  class Item {constructor(types){this.types=types;}}
  const host={ClipboardItem:Item,navigator:{clipboard:{write:items=>{written=items;return Promise.resolve();}}}};
  const copied=badges.copyImage(asset,host);
  assert.equal(written.length,1,'write must occur before yielding user activation');
  assert.equal(written[0].types['image/png'].type,'image/png');
  assert.equal(await written[0].types['text/plain'].text(),asset.url);await copied;
  await assert.rejects(badges.copyImage(asset,{}),/unavailable/);
  host.navigator.clipboard.write=()=>Promise.reject(Error('denied'));
  await assert.rejects(badges.copyImage(asset,host),/denied/);
});
