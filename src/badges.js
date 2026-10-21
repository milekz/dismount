/* Shareable replay recipes and locally rendered PNG badges. No upload or QR service. */
(function(root){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  const scores=node?require('./scores.js'):root.DismountScores;
  const physics=node?require('./physics.js'):root.DismountPhysics;
  const qr=node?require('../vendor/qrcode-2.0.4.js'):root.qrcode;
  const PUBLIC_URL='https://milekz.github.io/dismount/';
  const CHAMBER_ORDER=['classic','steep','long','landing','uneven','shaft','endless','finalDrop'];
  function valid(entry) {return scores.validEntry(entry)&&physics.supportsReplay(entry);}
  function link(entry,base=PUBLIC_URL) {
    if(!valid(entry))throw Error('This replay cannot be shared.');
    let url;try {url=new URL(base);}catch(_){url=new URL(PUBLIC_URL);}
    if(!['https:','http:'].includes(url.protocol))url=new URL(PUBLIC_URL);
    url.search='';url.hash='';url.username='';url.password='';
    url.searchParams.set('chamber',entry.layout||'classic');
    if(entry.character&&entry.character!=='human')url.searchParams.set('character',entry.character);
    // Number.toString round-trips doubles, including unrounded mouse power.
    url.hash='replay='+[1,entry.engine,entry.push.part,entry.push.angle,entry.push.power,
      entry.steps,entry.score,entry.hits,entry.time,entry.nick].join('~');
    return url.href;
  }
  function readLink(href) {
    if(!href)return {};
    try {
      const url=new URL(href);
      if(!url.hash.startsWith('#replay='))return {};
      if(url.hash.length>512)throw Error('Invalid replay link.');
      const fields=url.hash.slice(8).split('~');
      if(fields.length!==10||fields[0]!=='1')throw Error('This replay link format is not supported.');
      const [,engine,part,angle,power,steps,score,hits,time,nick]=fields;
      for(const value of [angle,power,steps,score,hits,time])
        if(!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))throw Error('Invalid replay settings.');
      const chamber=url.searchParams.get('chamber');
      const layout=/^\d+$/.test(chamber)?CHAMBER_ORDER[Number(chamber)-1]:chamber;
      const entry={id:'shared-run',savedAt:0,layout,character:url.searchParams.get('character')||'human',
        engine,nick,steps:Number(steps),score:Number(score),hits:Number(hits),time:Number(time),
        push:{part,angle:Number(angle),power:Number(power)}};
      if(!Object.hasOwn(physics.LAYOUTS,layout)||!scores.validEntry(entry))throw Error('Invalid replay settings.');
      if(!physics.supportsReplay(entry))throw Error('This replay needs a different physics version.');
      return {entry};
    } catch(error) {return {error:error.message||'Invalid replay link.'};}
  }
  function matrix(url) {
    const code=qr(0,'H');code.addData(url,'Byte');code.make();
    return Array.from({length:code.getModuleCount()},(_,y)=>Array.from({length:code.getModuleCount()},(_,x)=>code.isDark(y,x)));
  }
  function title(entry) {
    return entry.score>=25000?'CERTIFIED DISASTER':entry.score>=10000?'IMPACT PROFESSOR':
      entry.score>=3000?'STAIR SPECIALIST':'GRAVITY INTERN';
  }
  function render(entry,document,base) {
    const url=link(entry,base),cells=matrix(url),canvas=document.createElement('canvas');
    canvas.width=960;canvas.height=480;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#15221f';ctx.fillRect(0,0,960,480);
    ctx.fillStyle='#eb9b66';ctx.fillRect(0,0,12,480);
    ctx.strokeStyle='#52665a';ctx.lineWidth=2;ctx.strokeRect(28,28,904,424);
    // A descending stair edge ties the badge to the chamber artwork.
    ctx.fillStyle='#52665a';
    for(let i=0;i<5;i++){ctx.fillRect(440+i*24,384+i*12,24,3);ctx.fillRect(461+i*24,384+i*12,3,15);}
    const text=(value,x,y,size,color='#edf1e4',font='monospace')=>{
      ctx.fillStyle=color;ctx.font=size+'px '+font;ctx.fillText(value,x,y,510);
    };
    text('DISMOUNT / IMPACT LABORATORY',54,69,17,'#b7c6ad');
    text(title(entry),54,116,23,'#f6b17b');
    text(entry.score.toLocaleString('en-US'),50,208,72);
    text('POINTS  /  '+entry.nick,54,242,17,'#b7c6ad');
    text(physics.LAYOUTS[entry.layout||'classic'].name,54,291,23);
    const character=physics.CHARACTERS[entry.character||'human'].name;
    text(character+' · '+entry.push.part.replace(/([A-Z])/g,' $1').toLowerCase(),54,322,18,'#b7c6ad');
    text(entry.push.angle+'°  /  '+Number((entry.push.power*100).toFixed(2))+'% POWER',54,355,20,'#f6b17b');
    text(entry.hits+' IMPACTS  ·  '+entry.time.toFixed(2)+' s',54,399,17,'#b7c6ad');
    // Whole-pixel modules and four clear modules on all sides keep the exported QR scannable.
    const unit=Math.max(1,2*Math.floor(352/(2*(cells.length+8)))),size=(cells.length+8)*unit;
    // Even module sizes and origins also survive the common 50% image resize cleanly.
    const x=576+2*Math.floor((352-size)/4),y=48+2*Math.floor((352-size)/4);
    ctx.fillStyle='#fff';ctx.fillRect(x,y,size,size);ctx.fillStyle='#15221f';
    cells.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)ctx.fillRect(x+(c+4)*unit,y+(r+4)*unit,unit,unit);}));
    // A small nine-module island (under 4% of this QR) carries the stairs emblem.
    // High error correction protects the covered data; the outer quiet zone stays untouched.
    const logoX=x+(4+Math.floor(cells.length/2)-4)*unit,logoY=y+(4+Math.floor(cells.length/2)-4)*unit;
    ctx.fillStyle='#fff';ctx.fillRect(logoX,logoY,9*unit,9*unit);
    ctx.fillStyle='#15221f';
    for(let i=0;i<3;i++)ctx.fillRect(logoX+(1+i*2)*unit,logoY+(1+i*2)*unit,2*unit,(6-i*2)*unit);
    ctx.textAlign='center';text('SCAN TO REPLAY',752,410,17,'#edf1e4');ctx.textAlign='left';
    return {url,dataURL:canvas.toDataURL('image/png'),filename:'dismount-'+entry.nick+'-'+entry.score+'.png',title:title(entry)};
  }
  function copyImage(asset,host=root) {
    if(!host.navigator?.clipboard?.write||!host.ClipboardItem)return Promise.reject(Error('Image copying is unavailable.'));
    try {
      const bytes=Uint8Array.from(atob(asset.dataURL.split(',')[1]),c=>c.charCodeAt(0));
      const png=new Blob([bytes],{type:'image/png'});
      // The cached PNG avoids retaining large canvases or awaiting export before Safari's user gesture expires.
      const item=new host.ClipboardItem({'image/png':png,'text/plain':new Blob([asset.url],{type:'text/plain'})});
      return host.navigator.clipboard.write([item]);
    } catch(error){return Promise.reject(error);}
  }
  function createView({host=root,document=host.document}={}) {
    const $=id=>document.getElementById(id),cache=new Map();let selected=null,request=0;
    const asset=entry=>{
      const url=link(entry,host.location?.href);
      if(!cache.has(url)) {
        if(cache.size>=32)cache.delete(cache.keys().next().value);
        cache.set(url,render(entry,document,host.location?.href));
      }
      return cache.get(url);
    };
    function decorate(button,entry) {
      button.className='run-badge';button.type='button';button.disabled=!entry;
      button.replaceChildren();
      if(!entry){button.textContent='▧ Badge';button.title='Finish a run to earn a replay badge.';button.setAttribute('aria-label','Replay badge — finish a run first');return;}
      const image=document.createElement('img');image.src=asset(entry).dataURL;
      image.alt=title(entry)+' · '+entry.nick+' · '+entry.score+' points';image.width=160;image.height=80;
      button.appendChild(image);button.title='Copy this badge with its replay QR code';
      button.setAttribute('aria-label','Copy replay badge for '+entry.nick+', '+entry.score+' points');
    }
    function copy() {
      if(!selected)return;
      const current=++request;
      $('badge-status').textContent='Copying badge…';
      return copyImage(selected,host).then(()=>{
        if(current===request)$('badge-status').textContent='Badge copied. Paste it into a chat or document.';
      },()=>{
        if(current===request)$('badge-status').textContent='Image could not be copied. Download the PNG or copy the replay link below.';
      });
    }
    function show(entry) {
      selected=asset(entry);
      $('badge-preview').src=selected.dataURL;$('badge-preview').alt=selected.title+' · '+entry.score+' points · replay QR code';
      $('badge-link').value=selected.url;
      $('badge-download').href=selected.dataURL;$('badge-download').download=selected.filename;
      if(!$('badge-dialog').open)$('badge-dialog').showModal?.();
      return copy();
    }
    $('badge-copy').addEventListener('click',copy);
    $('badge-preview-copy').addEventListener('click',copy);
    $('badge-close').addEventListener('click',()=>$('badge-dialog').close());
    $('badge-copy-link').addEventListener('click',()=>{
      if(!selected)return;
      const current=++request;
      const manual=()=>{$('badge-link').focus();$('badge-link').select();$('badge-status').textContent='Select and copy the replay link.';};
      if(!host.navigator?.clipboard?.writeText){manual();return;}
      host.navigator.clipboard.writeText(selected.url).then(()=>{
        if(current===request)$('badge-status').textContent='Replay link copied.';
      },()=>{if(current===request)manual();});
    });
    return {decorate,show};
  }
  const api={link,readLink,matrix,title,render,copyImage,createView,PUBLIC_URL};
  root.DismountBadges=api;if(node)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
