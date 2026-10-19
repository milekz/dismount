const test=require('node:test'),assert=require('node:assert/strict');
const {createAudio}=require('../src/audio.js');
function setup() {
  const trace=[];
  class Context {
    constructor(){this.currentTime=0;this.state='running';this.sampleRate=8000;this.destination={};Context.instance=this;}
    param(){return {value:0,setValueAtTime:(n)=>{assert.ok(Number.isFinite(n));trace.push(n);},exponentialRampToValueAtTime:(n)=>{assert.ok(n>0&&Number.isFinite(n));trace.push(n);}};}
    node(){return {connect(){},disconnect(){},start(){},stop(){}};}
    createGain(){return {...this.node(),gain:this.param()};}
    createDynamicsCompressor(){return {...this.node(),threshold:{},knee:{},ratio:{},attack:{},release:{}};}
    createOscillator(){return {...this.node(),frequency:this.param()};}
    createBuffer(c,l){return {getChannelData:()=>new Float32Array(l)};}
    createBufferSource(){return {...this.node(),playbackRate:{}};}
    createBiquadFilter(){return {...this.node(),frequency:{},Q:{}};}
  }
  const audio=createAudio({host:{AudioContext:Context},getSubject:()=> 'robot'});audio.unlock();
  return {audio,trace,context:Context.instance};
}
test('mixer prioritizes strongest impact independent of contact order, with repeatable crack variants',()=>{
  const weak={force:80,variant:1,group:'Arms'},strong={force:800,variant:4,group:'Torso',edge:true};
  const a=setup(),b=setup();
  a.audio.queue({impacts:[weak,strong],cracks:[{strength:1,fracture:true,variant:3}]});
  b.audio.queue({impacts:[strong],cracks:[{strength:1,fracture:true,variant:3}]});
  a.audio.flush();b.audio.flush();assert.deepEqual(a.trace,b.trace);
  const length=a.trace.length;a.audio.flush();assert.equal(a.trace.length,length,'empty queue stays silent');
  a.audio.setVolume(0);a.context.currentTime+=1;a.audio.queue({impacts:[strong]});a.audio.flush();assert.equal(a.trace.length,length,'zero volume stays silent');
});
test('voice budget bounds overlapping sources',()=>{
  const {audio,trace}=setup();for(let i=0;i<100;i++)audio.tone(100,60,.1,.1);
  // Each oscillator writes two frequencies and three envelope values.
  assert.equal(trace.length,24*5);
});
