/* Gesture-unlocked Web Audio, deterministic timbres and a bounded impact mixer. */
(function(root){
  'use strict';
  function createAudio({host=root,storage,getSubject=()=> 'human',onChange=()=>{}}={}) {
    let sound=true,audio=null,master=null,volume=.65,lastThud=-1,lastCrack=-1;
    const noiseBuffers=new Map();let voices=[],pendingHit=null,pendingCrack=null;
    try{const saved=storage?.getItem('dismount-volume');if(saved!==null&&saved!==undefined&&Number.isFinite(Number(saved)))volume=Math.max(0,Math.min(1,Number(saved)));}catch(_){}
    const updateSoundControls=label=>onChange(label);
    function reserveVoice(duration) {
      voices=voices.filter(end=>end>audio.currentTime);
      if(voices.length>=24||volume===0)return false;
      voices.push(audio.currentTime+duration+.01);return true;
    }
    // Audio is created inside a user gesture to satisfy browser autoplay rules.
    function unlockAudio() {
      if (!sound) return;
      try {
        if (!audio || audio.state==='closed') {
          audio = new (host.AudioContext || host.webkitAudioContext)();
          master = audio.createGain();
          master.gain.value = volume;
          const compressor = audio.createDynamicsCompressor();
          compressor.threshold.value = -14;
          compressor.knee.value = 18;
          compressor.ratio.value = 5;
          compressor.attack.value = 0.003;
          compressor.release.value = 0.18;
          master.connect(compressor);
          compressor.connect(audio.destination);
          audio.addEventListener?.('statechange',()=>updateSoundControls());
          // Start a silent source inside the gesture, including Safari's first unlock.
          const silent=audio.createBufferSource();
          silent.buffer=audio.createBuffer(1,1,audio.sampleRate);
          silent.connect(master);silent.onended=()=>silent.disconnect();silent.start();
        }
        if (audio.state==='suspended'||audio.state==='interrupted') {
          audio.resume().then(()=>updateSoundControls()).catch(()=>{
            if(sound)updateSoundControls('SOUND: TAP TO ENABLE');
          });
        }
      } catch (_) { sound = false; updateSoundControls('SOUND UNAVAILABLE'); }
    }
    function tone(start, end, duration, volume, type = 'sine') {
      if (!sound || !audio || !master || !reserveVoice(duration)) return;
      const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(start, now);
      osc.frequency.exponentialRampToValueAtTime(end, now + duration);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001,volume), now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain); gain.connect(master);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(); osc.stop(now + duration + 0.01);
    }
    function noise(kind, variant, duration, volume, frequency, filterType = 'lowpass', rate = 1) {
      if (!sound || !audio || !master || !reserveVoice(duration)) return;
      const key = kind + variant;
      if (!noiseBuffers.has(key)) {
        const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.4), audio.sampleRate);
        const samples = buffer.getChannelData(0);
        // Seeded textures: each recorded impact keeps its timbre on replay.
        let seed = 7919 + variant * 104729, low = 0;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const white = seed / 2147483648 - 1, t = i / audio.sampleRate;
          low = low * 0.82 + white * 0.18;
          let envelope = Math.exp(-t * (kind === 'air' ? 9 : 26));
          if (kind === 'snap') {
            envelope = Math.exp(-t * 190);
            for (let burst = 1; burst <= 2 + variant % 3; burst++) {
              const start = burst * (0.014 + variant * 0.002);
              if (t > start) envelope += (0.7 / burst) * Math.exp(-(t-start)*210);
            }
          }
          samples[i] = (kind === 'body' ? low * 2 : white) * envelope;
        }
        noiseBuffers.set(key, buffer);
      }
      const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
      source.buffer = noiseBuffers.get(key);
      source.playbackRate.value = rate;
      filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = 0.7;
      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      source.connect(filter); filter.connect(gain); gain.connect(master);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(); source.stop(audio.currentTime + duration);
    }
    function thud(hit) {
      if (!sound || !audio || audio.currentTime - lastThud < 0.045) return;
      lastThud = audio.currentTime;
      const {force, edge, group = 'Torso', variant = 0} = hit;
      const weight = Math.min(1, force / 850), pitch = 0.86 + variant * 0.055;
      const subject=getSubject()||'human';
      if(subject==='robot'||subject==='knight') {
        // Inharmonic, nearly stationary resonances sound like struck metal, not a laser sweep.
        const base=(subject==='robot'?175:310)*pitch*(group==='Torso'?.75:group==='Head'?1.15:1.4);
        const decay=(subject==='robot'?.13:.24)+weight*.12;
        for(const [ratio,level] of [[1,1],[2.76,.5],[5.4,.22]])
          tone(base*ratio,base*ratio*.99,decay/Math.sqrt(ratio),(.025+weight*.09)*level);
        noise('body',variant,.07,.06+weight*.15,700,'lowpass',pitch);
        noise('grit',variant,edge?.12:.06,.03+weight*.1,edge?3200:1600,'highpass',pitch);
        return;
      }
      if(subject==='inflatable') {
        tone(105*pitch,48,.1,.045+weight*.1);
        noise('body',variant,.08,.07+weight*.12,500,'lowpass',pitch);
        if(edge||weight>.3)tone(420*pitch,650*pitch,.055+weight*.06,.018+weight*.035);
        noise('air',variant,.16,.018+weight*.045,2300,'bandpass',pitch);return;
      }
      if(subject==='skeleton') {
        noise('snap',variant,.055+weight*.05,.09+weight*.2,edge?3000:1700,'highpass',pitch);
        noise('body',variant,.06,.04+weight*.1,1100,'bandpass',pitch);
        tone((group==='Head'?390:720)*pitch,280*pitch,.025,.02+weight*.045);
        return;
      }
      const base = {Head:190, Torso:85, Arms:240, Legs:125}[group] || 125;
      // Torso: low thump; head: hollow knock; limbs: shorter, harder taps.
      tone(base*pitch, (group==='Torso'?28:55)*pitch,
        0.075 + weight*0.14, 0.035 + weight*0.16, group==='Head'?'sine':'triangle');
      noise('body', variant, 0.09+weight*0.13, 0.09+weight*0.25,
        group==='Torso'?650:group==='Head'?1700:2600, 'lowpass', pitch);
      if (edge) {
        noise('snap', variant, 0.07, 0.12+weight*0.2, 1800, 'highpass', pitch*1.25);
        tone(750*pitch, 170, 0.035, 0.035+weight*0.04, 'triangle');
      } else if (force > 350) {
        // Short gritty tail on heavier flat landings.
        noise('grit', variant, 0.16, weight*0.09, 2400, 'bandpass', 0.8);
      }
    }
    function crack(strength, fracture = false, variant = 0) {
      if (!sound || !audio || !master || (!fracture && audio.currentTime - lastCrack < 0.09)) return;
      lastCrack = audio.currentTime;
      const subject=getSubject()||'human';
      if(subject==='inflatable') {
        // Rubbery strain and escaping air, rather than bone-cracking sounds.
        tone(620+variant*35,290,.16,.025+strength*.035);
        noise('air',variant,fracture?.32:.15,.07+strength*.12,2800,'bandpass');return;
      }
      if(subject==='robot'||subject==='knight') {
        const base=(subject==='robot'?240:460)*(1+variant*.035);
        tone(base,base*.96,.17,.04+strength*.06);
        tone(base*3.17,base*3.1,.09,.02+strength*.035);
        noise('snap',variant,.1,.07+strength*.12,1900,'highpass');
        noise('grit',variant,.18,.05+strength*.08,3200,'bandpass');return;
      }
      if(subject==='skeleton') {
        noise('snap',variant,fracture?.2:.09,.12+strength*.2,2400,'highpass',1.15);
        noise('grit',variant,.12,.04+strength*.07,3400,'bandpass');return;
      }
      noise('snap', variant, fracture?0.23:0.12, 0.12+strength*0.22,
        fracture?850:1600, 'highpass', 0.85+variant*0.07);
      if (fracture) {
        tone(140+variant*17, 32, 0.18, 0.1, 'triangle');
        noise('body', variant, 0.2, 0.16, 900);
      }
    }

    function queue(frame) {
      for(const hit of frame.impacts||[])if(!pendingHit||hit.force>pendingHit.force)pendingHit=hit;
      for(const event of frame.cracks||[])if(!pendingCrack||Number(!!event.fracture)>Number(!!pendingCrack.fracture)||!!event.fracture===!!pendingCrack.fracture&&event.strength>pendingCrack.strength)pendingCrack=event;
    }
    function flush(){if(pendingHit)thud(pendingHit);if(pendingCrack)crack(pendingCrack.strength,pendingCrack.fracture,pendingCrack.variant||0);clear();}
    function clear(){pendingHit=null;pendingCrack=null;}
    function toggle(){
      if(!(sound&&audio&&audio.state!=='running'))sound=!sound;
      if(sound)unlockAudio();
      if(master)master.gain.value=sound?volume:0;
      updateSoundControls();tone(600,900,.1,.04);
    }
    function setVolume(value){
      if(!Number.isFinite(value))return;
      volume=Math.max(0,Math.min(1,value));
      if(master)master.gain.value=sound?volume:0;
      try{storage?.setItem('dismount-volume',String(volume));}catch(_){}
    }
    return {unlock:unlockAudio,tone,queue,flush,clear,toggle,setVolume,get volume(){return volume;},
      get enabled(){return sound;},get needsResume(){return sound&&audio&&audio.state!=='running';},
      get label(){return !sound?'SOUND OFF':audio&&audio.state!=='running'?'SOUND: TAP TO ENABLE':'SOUND ON';}};
  }
  root.DismountAudio={createAudio};
  if(typeof module!=='undefined')module.exports=root.DismountAudio;
})(typeof window!=='undefined'?window:globalThis);
