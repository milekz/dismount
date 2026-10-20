/* Small, versioned replay recipes: exact inputs, not rounded display values. */
(function (root) {
  'use strict';
  const KEY = 'dismount-scoreboard-v4', PREVIOUS_KEY='dismount-scoreboard-v3',
    PREVIOUS_KEYS=[PREVIOUS_KEY,'dismount-scoreboard-v2'], LIMIT = 10;
  const CHARACTERS=['human','robot','knight','skeleton','inflatable'];
  const PARTS = ['head','chest','hip','leftKnee','rightKnee','leftHand','rightHand','leftFoot','rightFoot'];
  const normalizeNick = value => String(value).toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);
  function validEntry(entry) {
    return entry && typeof entry.id === 'string' && /^[a-z0-9-]{1,80}$/.test(entry.id)
      && typeof entry.nick === 'string' && /^[A-Z]{3}$/.test(entry.nick)
      && Number.isSafeInteger(entry.score) && entry.score >= 0 && entry.score < 1e9
      && Number.isSafeInteger(entry.hits) && entry.hits >= 0 && entry.hits < 1e6
      && Number.isFinite(entry.time) && entry.time > 0 && entry.time <= (entry.layout==='endless'?120.1:18.1)
      && Number.isSafeInteger(entry.steps) && entry.steps > 0 && entry.steps <= (entry.layout==='endless'?14405:2165)
      && Number.isFinite(entry.savedAt) && entry.savedAt >= 0
      && (entry.layout===undefined||['classic','steep','long','landing','uneven','shaft','finalDrop','endless'].includes(entry.layout))
      && (entry.character===undefined||CHARACTERS.includes(entry.character))
      && typeof entry.engine === 'string' && entry.engine.length <= 40
      && entry.push && PARTS.includes(entry.push.part)
      // Retain historical replay angles outside the current input range.
      && Number.isFinite(entry.push.angle) && entry.push.angle >= -100 && entry.push.angle <= 105
      && Number.isFinite(entry.push.power) && entry.push.power >= 0 && entry.push.power <= 1;
  }
  class ScoreBoard {
    constructor(storage, engine, layout='classic', character='human') {
      this.layout=layout;this.character=CHARACTERS.includes(character)?character:'human';
      const suffix=(layout==='classic'?'':'-'+layout)+(this.character==='human'?'':'-character-'+this.character);
      this.key=KEY+suffix;
      this.storage = storage; this.engine = engine; this.entries = []; this.persistent = true;
      const seen=new Set();
      this.previousEntries=PREVIOUS_KEYS.flatMap(key=>this.read(key+suffix)).filter(entry=>{
        if(seen.has(entry.id))return false;seen.add(entry.id);return true;
      }).sort((a,b)=>b.score-a.score||a.savedAt-b.savedAt);
      this.entries=this.read(this.key);
    }
    read(key) {
      try {
        const raw = this.storage.getItem(key);
        if (raw && raw.length <= 100000) {
          const parsed = JSON.parse(raw);
          if (parsed.version === 1 && Array.isArray(parsed.entries)) {
            const seen = new Set();
            return parsed.entries.filter(entry => {
              if (!validEntry(entry) || (entry.layout||'classic')!==this.layout || (entry.character||'human')!==this.character || seen.has(entry.id)) return false;
              seen.add(entry.id); return true;
            }).sort((a,b)=>b.score-a.score || a.savedAt-b.savedAt).slice(0,LIMIT);
          }
        }
      } catch (_) { this.persistent = false; }
      return [];
    }
    qualifies(score) {
      return Number.isSafeInteger(score) && score >= 0
        && (this.entries.length < LIMIT || score > this.entries[this.entries.length-1].score);
    }
    save(nick, run) {
      if (!run.push || run.push.angle < -100 || run.push.angle > 100) return {ok:false,message:'Push angle must be between −100° and 100°.'};
      if (!/^[A-Z]{3}$/.test(nick)) return {ok:false,message:'Enter exactly three letters (A–Z).'};
      if (!this.qualifies(run.score)) return {ok:false,message:'This score does not reach the top 10.'};
      const entry = {
        id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12),
        nick,score:run.score,hits:run.hits,time:run.time,steps:run.steps,
        layout:this.layout,character:this.character,push:{...run.push},engine:this.engine,savedAt:Date.now()
      };
      if (!validEntry(entry)) return {ok:false,message:'This run cannot be saved.'};
      this.entries.push(entry);
      this.entries.sort((a,b)=>b.score-a.score || a.savedAt-b.savedAt);
      this.entries=this.entries.slice(0,LIMIT);
      try {
        this.storage.setItem(this.key,JSON.stringify({version:1,entries:this.entries}));
        this.persistent=true;
      } catch (_) { this.persistent=false; }
      return {ok:true,persistent:this.persistent,entry};
    }
    get(id) { return this.entries.find(entry=>entry.id===id)||this.previousEntries.find(entry=>entry.id===id); }
  }
  const api = {ScoreBoard,normalizeNick,validEntry,KEY,PREVIOUS_KEY,PREVIOUS_KEYS,LIMIT};
  root.DismountScores=api;
  if (typeof module!=='undefined') module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
