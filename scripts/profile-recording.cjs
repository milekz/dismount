// Run each mode in a fresh process: node --expose-gc scripts/profile-recording.cjs [raw|compact]
const {Simulation}=require('../src/physics.js');
const {Recording}=require('../src/replay.js');
if(!global.gc)throw new Error('Run Node with --expose-gc');
const mode=process.argv[2]||'compact';
if(!['raw','compact'].includes(mode))throw new Error('Expected raw or compact');
global.gc();const before=process.memoryUsage().heapUsed+process.memoryUsage().arrayBuffers;
const sim=new Simulation('endless'),frames=mode==='raw'?[]:new Recording();
sim.push('chest',15,.8);
while(sim.active){sim.step();const frame=sim.snapshot();frame.impacts=sim.impacts.map(hit=>({...hit}));frames.push(frame);}
global.gc();const after=process.memoryUsage().heapUsed+process.memoryUsage().arrayBuffers;
console.log(JSON.stringify({mode,frames:frames.length,seconds:+sim.time.toFixed(2),retainedMiB:+((after-before)/1048576).toFixed(2),numericMiB:frames.byteLength?+(frames.byteLength/1048576).toFixed(2):null}));
