/* Procedural character artwork: follows the same body transforms in play and replay. */
(function(root){
  'use strict';
  function line(ctx,x1,y1,x2,y2,color,width=1) {
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();
  }
  function ellipse(ctx,x,y,rx,ry,fill,stroke) {
    ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke();}
  }
  function plate(ctx,x,y,w,h,fill,stroke='#39474b') {
    ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle=stroke;ctx.lineWidth=.9;ctx.strokeRect(x,y,w,h);
  }
  function drawSegment(ctx,segment,character) {
    const {name,radius:r}=segment,l=Math.hypot(segment.bx-segment.ax,segment.by-segment.ay);
    const far=name.startsWith('left'),torso=name==='torso',core=['torso','abdomen','pelvis'].includes(name);
    const foot=name.includes('Foot'),hand=name.includes('Hand');
    ctx.save();ctx.translate(segment.ax,segment.ay);ctx.rotate(Math.atan2(segment.by-segment.ay,segment.bx-segment.ax)-Math.PI/2);
    if(character==='robot') {
      line(ctx,0,0,0,l,'#3c4c51',r*1.5);
      plate(ctx,-r*.85,-r*.3,r*1.7,l+r*.6,far?'#748a93':'#acbdc2');
      line(ctx,-r*.4,1,-r*.4,l-1,'#e2eef0',1.5);
      ellipse(ctx,0,0,r*.6,r*.6,'#3d555d','#d6e5de');
      ellipse(ctx,0,l,r*.55,r*.55,'#3d555d','#d6e5de');
      if(torso){plate(ctx,-5,3,10,8,'#263e43');line(ctx,-3,7,3,7,'#8be3ca',2);}
      if(foot||hand)line(ctx,-r*.7,l*.5,r*.7,l*.5,'#e7b356',2);
    } else if(character==='knight') {
      line(ctx,0,0,0,l,'#46505b',r*2);
      ellipse(ctx,0,l/2,r*.95,l/2+r*.7,far?'#737c88':'#abb4bd','#414b55');
      line(ctx,-r*.4,1,-r*.4,l-1,'#e4e4db',1.5);
      line(ctx,-r*.8,l*.65,r*.8,l*.65,'#59616a',1.2);
      if(torso){plate(ctx,-4,1,8,l,'#994b47');line(ctx,-4,7,4,7,'#e8cb83',2);line(ctx,0,4,0,13,'#e8cb83',2);}
      if(name==='pelvis')line(ctx,-r,0,r,0,'#bb985c',3);
      if(hand)ellipse(ctx,0,l,2.5,3,'#7b838c');
    } else if(character==='skeleton') {
      if(torso) {
        line(ctx,0,-2,0,l+2,'#a39372',3);
        for(let y=1;y<l;y+=4) {
          ctx.beginPath();ctx.moveTo(-r*.9,y);ctx.quadraticCurveTo(0,y+5,r*.9,y);
          ctx.strokeStyle=far?'#c7bda5':'#eee5cb';ctx.lineWidth=2.6;ctx.stroke();
        }
      } else if(name==='pelvis') {
        ellipse(ctx,-4,l/2,4,5,'#e8dec6','#96876a');ellipse(ctx,4,l/2,4,5,'#e8dec6','#96876a');
        line(ctx,-4,l/2,4,l/2,'#eee5cb',2);
      } else {
        line(ctx,0,0,0,l,'#93866c',r*1.4);
        line(ctx,-.5,0,-.5,l,far?'#c6bca4':'#eee5cb',r*.95);
        for(const y of [0,l]) {
          ellipse(ctx,-r*.3,y,r*.55,r*.65,'#e6dcc3');ellipse(ctx,r*.3,y,r*.55,r*.65,'#e6dcc3');
        }
        if(hand||foot)for(let x=-2;x<=2;x+=2)line(ctx,x,l*.45,x,l+1,'#a29479',.7);
      }
    } else if(character==='inflatable') {
      const color=core?'#ebbf44':name==='neckLink'?'#edc94e':foot?'#4c9fae':far?'#c85351':'#ed7770';
      line(ctx,0,0,0,l,'#775545',r*2+.8);line(ctx,0,0,0,l,color,r*2);
      line(ctx,-r*.4,0,-r*.4,l,core?'#ffe29a':'#f7b1a0',1.3);
      if(name==='pelvis')line(ctx,-r*.7,l/2,r*.7,l/2,'#579cab',3);
      if(name==='abdomen')line(ctx,-r*.7,l/2,r*.7,l/2,'#dca33c',1);
    }
    if(segment.flash>.2)line(ctx,r*.8,0,r*.8,l,'#ffdf8b',1.6);
    ctx.restore();
  }
  // Head is drawn in the head body's local coordinates.
  function drawHead(ctx,character,flash=0) {
    if(character==='robot') {
      plate(ctx,-11,-12,22,24,'#a9bcc0');plate(ctx,-8,-5,16,8,'#294b51');
      ellipse(ctx,-4,-1,2,2,'#a4f1d5');ellipse(ctx,4,-1,2,2,'#a4f1d5');
      for(let x=-5;x<=5;x+=3)line(ctx,x,7,x,9,'#4d6165',1);
      line(ctx,0,-12,0,-17,'#617d85',2);ellipse(ctx,0,-18,2,2,'#eaa765');
    } else if(character==='knight') {
      ellipse(ctx,0,0,12,14,'#a6b0ba','#46515d');
      plate(ctx,-10,-4,20,7,'#596674');line(ctx,-8,-1,8,-1,'#222f36',2);
      line(ctx,0,2,0,12,'#d6d9d9',1.5);
      for(let x=-6;x<=6;x+=3)line(ctx,x,6,x,9,'#53606b',1);
      line(ctx,0,-13,-3,-19,'#a95049',5);line(ctx,-3,-19,-9,-18,'#a95049',4);
    } else if(character==='skeleton') {
      ellipse(ctx,0,-2,12,12,'#eee5cb','#9d8d70');plate(ctx,-7,5,14,7,'#e5dac0','#9d8d70');
      ellipse(ctx,-5,-3,3.5,4,'#4f5147');ellipse(ctx,5,-3,3.5,4,'#4f5147');
      line(ctx,0,2,-1,5,'#5e5c4e',2);
      for(let x=-5;x<=5;x+=2.5)line(ctx,x,8,x,11,'#9f9175',.8);
    } else if(character==='inflatable') {
      ellipse(ctx,0,0,12,14,'#efc74b','#b08337');
      for(let x=-8;x<=8;x+=4)line(ctx,x,-12,x-3,-18,'#e7746d',2);
      ellipse(ctx,-4,-3,3,4,'#fff5d8');ellipse(ctx,5,-3,3,4,'#fff5d8');
      ellipse(ctx,-3,-2,1.3,2,'#3f5050');ellipse(ctx,6,-2,1.3,2,'#3f5050');
      ctx.beginPath();ctx.arc(1,2,6,0,Math.PI);ctx.strokeStyle='#ad5143';ctx.lineWidth=2;ctx.stroke();
    }
    if(flash>.2){ctx.strokeStyle='#ffdf8b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.stroke();}
  }
  const api={drawSegment,drawHead};root.DismountCharacterArt=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
