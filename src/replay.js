/* Lossless numeric recordings. Static anatomy is stored once per attempt. */
(function(root){
  'use strict';
  const pointFields=['x','y','flash'];
  const segmentFields=['ax','ay','bx','by','angle','flash','damage','hits'];
  const jointFields=['x','y','broken','damage'];
  const statFields=['steps','distance','maxSpeed','airtime','maxFlightSteps'];
  const groups=['Head','Torso','Arms','Legs'], CHUNK=128;
  const metadata=(items,fields)=>items.map(item=>Object.fromEntries(Object.entries(item).filter(([key])=>!fields.includes(key))));
  class Recording {
    constructor(){this.length=0;this.chunks=[];this.events=new Map();this.strongest=[];this.peakIndex=0;this.peakPoints=-1;}
    push(frame) {
      if(!this.meta) {
        this.meta={layout:frame.layout,character:frame.character,points:metadata(frame.points,pointFields),segments:metadata(frame.segments,segmentFields),joints:metadata(frame.joints,jointFields)};
        this.stride=4+groups.length+statFields.length+frame.points.length*pointFields.length+frame.segments.length*segmentFields.length+frame.joints.length*jointFields.length;
      }
      const chunk=Math.floor(this.length/CHUNK);
      if(!this.chunks[chunk])this.chunks[chunk]=new Float64Array(CHUNK*this.stride);
      const data=this.chunks[chunk];let i=(this.length%CHUNK)*this.stride;
      data[i++]=frame.score;data[i++]=frame.hits;data[i++]=frame.time;
      if(frame.strongestImpact&&(!this.strongest.length||frame.strongestImpact.points>this.strongest.at(-1).points))this.strongest.push({...frame.strongestImpact});
      data[i++]=this.strongest.length-1;
      for(const group of groups)data[i++]=frame.damage[group];
      for(const field of statFields)data[i++]=frame.stats?.[field]||0;
      for(const [items,fields] of [[frame.points,pointFields],[frame.segments,segmentFields],[frame.joints,jointFields]])
        for(const item of items)for(const field of fields)data[i++]=Number(item[field]);
      if(frame.impacts?.length||frame.cracks?.length)this.events.set(this.length,{impacts:frame.impacts||[],cracks:frame.cracks||[]});
      for(const hit of frame.impacts||[])if(hit.points>this.peakPoints){this.peakPoints=hit.points;this.peakIndex=this.length;}
      this.length++;
    }
    at(index) {
      if(index<0)index+=this.length;
      if(index<0||index>=this.length)return undefined;
      if(this.readIndex===index)return this.readFrame;
      const data=this.chunks[Math.floor(index/CHUNK)];let i=(index%CHUNK)*this.stride;
      const frame={layout:this.meta.layout,character:this.meta.character,score:data[i++],hits:data[i++],time:data[i++]};
      frame.strongestImpact=this.strongest[data[i++]]||null;
      frame.damage={};for(const group of groups)frame.damage[group]=data[i++];
      frame.stats={};for(const field of statFields)frame.stats[field]=data[i++];
      for(const [key,fields] of [['points',pointFields],['segments',segmentFields],['joints',jointFields]])
        frame[key]=this.meta[key].map(item=>{const result={...item};for(const field of fields){const value=data[i++];result[field]=field==='broken'?!!value:value;}return result;});
      const events=this.events.get(index);frame.impacts=events?.impacts||[];frame.cracks=events?.cracks||[];
      this.readIndex=index;this.readFrame=frame;return frame;
    }
    get byteLength(){return this.chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0);}
    packet(){return {length:this.length,chunks:this.chunks,events:this.events,strongest:this.strongest,meta:this.meta,stride:this.stride,peakIndex:this.peakIndex,peakPoints:this.peakPoints};}
    static from(packet){return Object.assign(new Recording(),packet);}
  }
  const validEnd=(recording,entry)=>{
    const end=recording.at(-1);
    return !!end&&end.score===entry.score&&end.hits===entry.hits&&Math.abs(end.time-entry.time)<1e-8;
  };
  root.DismountReplay={Recording,validEnd};
  if(typeof module!=='undefined')module.exports=root.DismountReplay;
})(typeof window!=='undefined'?window:globalThis);
