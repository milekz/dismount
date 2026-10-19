/* Rebuild off the UI thread; terminate() cancels all work immediately. */
importScripts('../vendor/planck-1.5.0.js','physics.js','replay.js');
self.onmessage=({data:entry})=>{
  try {
    const sim=new DismountPhysics.Simulation(entry.layout||'classic',entry.character||'human',entry.engine);
    const frames=new DismountReplay.Recording();frames.push(sim.snapshot());
    sim.push(entry.push.part,entry.push.angle,entry.push.power);
    let lastUpdate=performance.now();
    for(let i=0;i<entry.steps;i++) {
      sim.step();const frame=sim.snapshot();frame.impacts=sim.impacts;frames.push(frame);
      if(performance.now()-lastUpdate>100){postMessage({progress:(i+1)/entry.steps});lastUpdate=performance.now();}
    }
    if(!DismountReplay.validEnd(frames,entry))throw new Error('Replay mismatch');
    postMessage({recording:frames.packet()},frames.chunks.map(chunk=>chunk.buffer));
  } catch(error){postMessage({error:String(error.message)});}
};
