/* Optional goals score existing telemetry; they never affect physics or rankings. */
(function(root){
  'use strict';
  const goals={
    none:{name:'Free experiment',description:'No objective. Find your own perfect disaster.'},
    flight:{name:'Five-step flight',description:'Pass five steps in a single airborne stretch. Not available in The Shaft.'},
    gentle:{name:'Gentle push, big trouble',description:'Score 5,000 points with no more than 30% push power.'},
    airtime:{name:'Frequent flyer',description:'Accumulate one second in the air.'}
  };
  function evaluate(id,frame,push) {
    if(id==='none'||!goals[id])return {complete:false,text:goals.none.description};
    if(!push)return {complete:false,text:goals[id].description};
    if(id==='flight') {
      if(frame.layout==='shaft')return {complete:false,text:'Choose a stair chamber for this challenge.'};
      const steps=frame.stats.maxFlightSteps||0;
      return {complete:steps>=5,text:Math.min(steps,5)+' / 5 steps in one flight'};
    }
    if(id==='gentle')return {complete:push.power<=.3&&frame.score>=5000,text:push.power>.3?'Power exceeded 30% — retry with a gentler push.':Math.min(frame.score,5000).toLocaleString()+' / 5,000 points'};
    return {complete:frame.stats.airtime>=1,text:Math.min(frame.stats.airtime,1).toFixed(2)+' / 1.00 s airborne'};
  }
  root.DismountChallenges={goals,evaluate};
  if(typeof module!=='undefined')module.exports=root.DismountChallenges;
})(typeof window!=='undefined'?window:globalThis);
