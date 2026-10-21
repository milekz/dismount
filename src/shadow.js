/* Stateless soft-shadow projection. Adjacent surfaces share one moving footprint. */
(function(root) {
  'use strict';
  const RADIUS_X=54,RADIUS_Y=7,FADE_HEIGHT=24;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function project(stair,center) {
    const left=center.x-RADIUS_X,right=center.x+RADIUS_X;
    const surfaces=[{left:40,right:stair.start,y:stair.top}];
    if(stair.kind==='endless') {
      // Use world indices, independently of the camera's visible tread window.
      const first=Math.max(0,Math.floor((left-stair.start)/stair.width));
      const last=Math.max(first,Math.ceil((right-stair.start)/stair.width));
      for(let i=first;i<last;i++)surfaces.push({left:stair.start+i*stair.width,
        right:stair.start+(i+1)*stair.width,y:stair.top+(i+1)*stair.rise});
    } else {
      for(const t of stair.kind==='shaft'?stair.ledges:stair.treads)
        surfaces.push({left:t.x,right:t.x+t.width,y:t.y});
      if(stair.wall)surfaces.push({left:stair.wall.x,right:stair.wall.x+stair.wall.width,y:stair.wall.y});
      surfaces.push({left:stair.kind==='shaft'?stair.start:stair.end,right:Infinity,y:stair.floor});
    }
    const visible=surfaces.filter(s=>s.right>left&&s.left<right&&s.y>center.y-FADE_HEIGHT).sort((a,b)=>a.y-b.y);
    const edges=[...new Set([left,right,...visible.flatMap(s=>[clamp(s.left,left,right),clamp(s.right,left,right)])])].sort((a,b)=>a-b);
    const patches=[];
    for(let i=0;i<edges.length-1;i++) {
      const a=edges[i],b=edges[i+1],mid=(a+b)/2;
      let remaining=1;
      for(const surface of visible) {
        if(mid<surface.left||mid>=surface.right)continue;
        // Fade off an upper ledge as the body passes it, revealing the lower one.
        const visibility=clamp((surface.y-center.y+FADE_HEIGHT)/FADE_HEIGHT,0,1);
        const weight=remaining*visibility;
        const alpha=weight*.16/(1+Math.max(0,surface.y-center.y)/250);
        if(alpha>0)patches.push({left:a,right:b,y:surface.y,x:center.x,alpha});
        remaining*=1-visibility;if(remaining===0)break;
      }
    }
    return patches;
  }
  function draw(ctx,stair,center,depthX=0,depthY=0,dark=false) {
    const y=depthY?-RADIUS_Y:0;
    for(const patch of project(stair,center)) {
      ctx.save();
      ctx.transform(1,0,depthY?depthX/depthY:0,1,0,patch.y);
      ctx.beginPath();ctx.rect(patch.left,y-RADIUS_Y,patch.right-patch.left,RADIUS_Y*2);ctx.clip();
      ctx.translate(patch.x,y);ctx.scale(RADIUS_X,RADIUS_Y);
      const gradient=ctx.createRadialGradient(0,0,0,0,0,1);
      const color=dark?'#000000':'#3f5032';
      gradient.addColorStop(0,color);gradient.addColorStop(.55,color+'8c');gradient.addColorStop(1,color+'00');
      ctx.globalAlpha=patch.alpha*(dark?1.5:1);ctx.fillStyle=gradient;
      ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  root.DismountShadow={project,draw};
  if(typeof module!=='undefined')module.exports=root.DismountShadow;
})(typeof window!=='undefined'?window:globalThis);
