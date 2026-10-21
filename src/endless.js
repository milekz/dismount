/* Presentation and local depth records; independent of physics and replay recipes. */
(function(root) {
  'use strict';
  const INTERVAL=50,KEY='dismount-endless-depth-v2-';
  const colors=['backgroundTop','backgroundBottom','side','riser','even','odd','stroke','ink','accent'];
  const zones=[
    ['Atrium',0xe7e9e0,0xdce0d2,0xb6beaa,0xacb79d,0xe3e7d9,0xd9dece,0xa2af93,0x61734e,0x8c6635],
    ['Maintenance',0xe2eaf0,0xcbdce5,0xa9bdc9,0x9db5c3,0xdce8ee,0xd2e0e8,0x8ba5b5,0x456c83,0x366f8f],
    ['Forgotten basement',0xebe4f0,0xd8cfe3,0xbcaec9,0xb0a1bf,0xe7dfee,0xddd3e7,0xa494b5,0x705680,0x815a95],
    ['Geology department',0xf1e7db,0xe4d2bb,0xccb596,0xc2aa88,0xeee0ca,0xe5d4b9,0xb49a74,0x7b603e,0x9b5c32]
  ];
  const nightZones=[
    ['Atrium',0x171e22,0x11181c,0x34423e,0x293732,0x4e6053,0x45564b,0x637566,0xb7c8ab,0xe2b376],
    ['Maintenance',0x17222c,0x111a22,0x30485a,0x293d4e,0x4e697d,0x435d71,0x69879a,0xc1d9e7,0x85c5ec],
    ['Forgotten basement',0x231d2c,0x191520,0x483951,0x392e43,0x62526f,0x554562,0x877395,0xdbc6e7,0xd7a9ec],
    ['Geology department',0x2c231c,0x201912,0x594736,0x48382a,0x756047,0x68533d,0x9b835f,0xead7b6,0xefb17e]
  ];
  const jokes=[
    'Gravity has renewed your subscription.',
    'The elevator would like a word.',
    'Your knees have opened a support ticket.',
    'You are now somebody else’s upstairs problem.',
    'The basement has a basement. Naturally.',
    'Please keep all limbs inside the experiment.',
    'Your fitness tracker has filed a complaint.',
    'Geology called. You are getting closer.',
    'Your return trip has been cancelled.',
    'Employee of the descent. Again.',
    'The stairs are running out of excuses.',
    'At this point, falling is your commute.'
  ];
  const steps=frame=>Math.max(0,Math.floor(frame.stats?.steps||0));
  const paletteCache=new Map();
  function palette(depth,dark=false) {
    const key=(dark?'dark:':'light:')+depth;
    if(paletteCache.has(key))return paletteCache.get(key);
    const position=Math.max(0,depth)/INTERVAL,zone=Math.floor(position),fraction=position-zone;
    const paletteZones=dark?nightZones:zones;
    const blend=fraction*fraction*(3-2*fraction),a=paletteZones[zone%zones.length],b=paletteZones[(zone+1)%zones.length];
    const result={zone:zone+1,name:a[0]};
    colors.forEach((name,i)=>{
      const rgb=[16,8,0].map(shift=>Math.round(((a[i+1]>>shift)&255)*(1-blend)+((b[i+1]>>shift)&255)*blend));
      result[name]='#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
    });
    paletteCache.set(key,result);
    if(paletteCache.size>256)paletteCache.delete(paletteCache.keys().next().value);
    return result;
  }
  function milestone(frame,previous) {
    if(frame.layout!=='endless'||!previous)return null;
    const reached=Math.floor(steps(frame)/INTERVAL);
    if(!reached||reached<=Math.floor(steps(previous)/INTERVAL))return null;
    return {steps:reached*INTERVAL,joke:jokes[(reached-1)%jokes.length]};
  }
  function createRecords(storage) {
    const bests=new Map(),dirty=new Set();
    function best(character='human') {
      if(!bests.has(character)) {
        let value=0;
        try {const stored=Number(storage?.getItem(KEY+character));if(Number.isSafeInteger(stored)&&stored>=0)value=stored;}catch(_){}
        bests.set(character,value);
      }
      return bests.get(character);
    }
    return {best,record(frame) {
      if(frame.layout!=='endless')return;
      const character=frame.character||'human',depth=steps(frame);
      if(depth>best(character)){bests.set(character,depth);dirty.add(character);}
    },save() {
      for(const character of dirty)try {storage?.setItem(KEY+character,String(bests.get(character)));dirty.delete(character);}catch(_){}
    }};
  }
  root.DismountEndless={INTERVAL,KEY,steps,palette,milestone,createRecords};
  if(typeof module!=='undefined')module.exports=root.DismountEndless;
})(typeof window!=='undefined'?window:globalThis);
