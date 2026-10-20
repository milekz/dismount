/* Rebuild off the UI thread; terminate() cancels all work immediately. */
importScripts('../vendor/planck-1.5.0.js','physics-legacy.js','body-profiles.js','physics.js','physics-view.js','replay.js');
self.onmessage=({data:entry})=>{
  try {
    const sim=new DismountPhysics.Simulation(entry.layout||'classic',entry.character||'human',entry.engine);
    const frames=new DismountReplay.Recording();frames.push(DismountPhysicsView.snapshot(sim));
    sim.push(entry.push.part,entry.push.angle,entry.push.power);
    let lastUpdate=performance.now();
    for(let i=0;i<entry.steps;i++) {
      DismountPhysicsView.step(sim);const frame=DismountPhysicsView.snapshot(sim);frame.impacts=sim.impacts;frames.push(frame);
      if(performance.now()-lastUpdate>100){postMessage({progress:(i+1)/entry.steps});lastUpdate=performance.now();}
    }
    if(!DismountReplay.validEnd(frames,entry))throw new Error('Replay mismatch');
    postMessage({recording:frames.packet()},frames.chunks.map(chunk=>chunk.buffer));
  } catch(error){postMessage({error:String(error.message)});}
};
