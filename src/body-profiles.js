/* Mass properties in SI units. Empirical human ratios; designed fictional materials.
   Endpoint mappings, assumptions and sources: docs/physics.md. */
(function(root) {
  'use strict';
  const HUMAN_MASS=73;
  // [body mass fraction, proximal COM fraction, transverse radius of gyration / length].
  // de Leva (1996), Table 4, male reference; hands use wrist–fingertip,
  // shins use knee–ankle, upper trunk uses cervicale–xyphion.
  const human={
    torso:[.1596,.5066,.320],abdomen:[.1633,.4502,.383],pelvis:[.1117,.6115,.551],
    UpperArm:[.0271,.5772,.269],Forearm:[.0162,.4574,.265],
    Hand:[.0061,.3624,.235],Thigh:[.1416,.4095,.329],
    Shin:[.0433,.4395,.246],Foot:[.0137,.4415,.245]
  };
  const CHARACTERS={
    human:{name:'Human',description:'73 kg with anatomical segment masses and offset centers of mass.',
      decay:.04,torque:1,strength:1,flex:0,friction:.48,bounce:.1,air:.04,spin:.06,
      neck:{extension:.012,compression:.004,injured:.045,frequency:10,damping:.85}},
    robot:{name:'Robot',description:'110 kg, concentrated in the chassis and pelvis, with stiff mechanical joints.',
      decay:.015,torque:2,strength:1.8,flex:0,friction:.55,bounce:.04,air:.025,spin:.04,
      neck:{extension:.003,compression:.002,injured:.012,frequency:16,damping:1}},
    knight:{name:'Knight',description:'A 73 kg body carrying 23 kg of armor, including a heavy helmet and breastplate.',
      decay:.025,torque:1.5,strength:1.2,flex:0,friction:.6,bounce:.06,air:.035,spin:.05,
      neck:{extension:.012,compression:.004,injured:.045,frequency:10,damping:.85}},
    skeleton:{name:'Skeleton',description:'10 kg of bone-like segments, with light limbs and loose joints.',
      decay:.08,torque:.25,strength:.28,flex:0,friction:.4,bounce:.2,air:.08,spin:.08,
      neck:{extension:.006,compression:.003,injured:.025,frequency:10,damping:.7}},
    inflatable:{name:'Inflatable dancer',description:'3 kg distributed over a light shell, with soft seams and strong drag.',
      decay:.12,torque:.05,strength:.08,flex:15,friction:.5,bounce:.24,air:.65,spin:.12,
      neck:{extension:.06,compression:.015,injured:.18,frequency:3,damping:.8}}
  };
  const robot={head:5,neckLink:.7,torso:28,abdomen:12,pelvis:16,
    UpperArm:5,Forearm:3,Hand:1,Thigh:9,Shin:6,Foot:2};
  const skeleton={head:1.2,neckLink:.1,torso:2.8,abdomen:.35,pelvis:1.3,
    UpperArm:.35,Forearm:.25,Hand:.15,Thigh:.65,Shin:.4,Foot:.25};
  const armor={head:3,neckLink:.5,torso:7,abdomen:2,pelvis:2,
    UpperArm:1,Forearm:.75,Hand:.25,Thigh:1,Shin:.8,Foot:.45};
  const part=name=>name.replace(/^(left|right)/,'');
  // Non-overlapping capsule lamina / thin outline, about its geometric center.
  // Collision fixtures overlap; their density-derived inertia must not be reused.
  function shapeInertia(length,radius,shell=false) {
    const l=length,r=radius;
    if(shell)return (2*l*(l*l/12+r*r)+2*Math.PI*r*(r*r+l*l/4)+4*l*r*r)/(2*l+2*Math.PI*r);
    return (2*r*l*(l*l+4*r*r)/12+Math.PI*r*r*(r*r/2+l*l/4)+4*l*r*r*r/3)/(2*r*l+Math.PI*r*r);
  }
  function humanProperties(segment,ppm) {
    const name=part(segment.name),l=segment.length/ppm,r=segment.radius/ppm;
    if(name==='head') {
      // Split the published head fraction into head + a small cervical link.
      const mass=HUMAN_MASS*.0614,length=2*r;
      return {mass,center:{x:0,y:(.5976-.5)*length},inertia:mass*(.376*length)**2};
    }
    if(name==='neckLink')return {mass:HUMAN_MASS*.008,center:{x:0,y:0},inertia:HUMAN_MASS*.008*shapeInertia(l,r)};
    const [fraction,com,k]=human[name],mass=HUMAN_MASS*fraction;
    // Feet: heel-to-toe envelope. Hands: wrist anchor to fingertip cap.
    const length=name==='Foot'?l+2*r:name==='Hand'?l+r:l;
    const start=name==='Foot'?-l/2-r:-l/2;
    return {mass,center:{x:start+com*length,y:0},inertia:mass*(k*length)**2};
  }
  function combine(a,b) {
    const mass=a.mass+b.mass;
    const center={x:(a.center.x*a.mass+b.center.x*b.mass)/mass,y:(a.center.y*a.mass+b.center.y*b.mass)/mass};
    const shift=p=>p.mass*((p.center.x-center.x)**2+(p.center.y-center.y)**2);
    return {mass,center,inertia:a.inertia+b.inertia+shift(a)+shift(b)};
  }
  function properties(character,segments,ppm) {
    const shellArea=s=>{const l=s.length/ppm,r=s.radius/ppm;return 2*Math.PI*r*l+4*Math.PI*r*r;};
    const skinArea=segments.reduce((sum,s)=>sum+shellArea(s),0);
    return segments.map(segment=>{
      const name=part(segment.name),l=segment.length/ppm,r=segment.radius/ppm;
      const shell=(mass,offset=0)=>({mass,center:{x:offset*l,y:0},inertia:mass*shapeInertia(l,r,true)});
      if(character==='human')return humanProperties(segment,ppm);
      if(character==='knight')return combine(humanProperties(segment,ppm),shell(armor[name]));
      if(character==='robot') {
        const mass=robot[name]*110/113.7;
        return {mass,center:{x:l*(/Arm|Forearm|Thigh|Shin/.test(name)?-.08:0),y:0},
          inertia:mass*shapeInertia(l,r)};
      }
      if(character==='skeleton')return shell(skeleton[name]*10/9.85);
      return shell(3*shellArea(segment)/skinArea);
    });
  }
  root.DismountBodyProfiles={CHARACTERS,HUMAN_MASS,properties,shapeInertia,combine};
  if(typeof module!=='undefined')module.exports=root.DismountBodyProfiles;
})(typeof window!=='undefined'?window:globalThis);
