/* Runs before the stylesheet so system/saved appearance applies before first paint. */
(function(root) {
  'use strict';
  const KEY='dismount-theme',modes=['system','dark','light'];
  const light={backgroundTop:'#e7e9e0',backgroundBottom:'#dce0d2',grid:'#cbd1c1',
    side:'#b6beaa',riser:'#acb79d',even:'#e3e7d9',odd:'#d9dece',stroke:'#a2af93',outline:'#a5b098',
    platform:'#eff0e6',platformStroke:'#bdc6b0',treadStroke:'#b8c2aa',edge:'#f5f5ed',
    ink:'#8b997b',ledgeInk:'#718260',label:'#a16243',floor:'#d4dbc7',floorStroke:'#b8c2aa',
    stripe:'#8e9a7d',startInk:'#8b967e',panel:'#f7f6f1',ghost:'#48788b',
    intact:'#cbd2c1',joint:'#f7f6f1',jointStroke:'#66715c',broken:'#b72f29'};
  const dark={backgroundTop:'#171e22',backgroundBottom:'#11181c',grid:'#29363b',
    side:'#34423e',riser:'#293732',even:'#4e6053',odd:'#45564b',stroke:'#637566',outline:'#53665a',
    platform:'#596d5d',platformStroke:'#718572',treadStroke:'#697d6b',edge:'#899f83',
    ink:'#b7c8ab',ledgeInk:'#b7c8ab',label:'#efb17e',floor:'#3f5045',floorStroke:'#637566',
    stripe:'#b5a578',startInk:'#b7c8ab',panel:'#202b31',ghost:'#88c8e4',
    intact:'#819584',joint:'#26333a',jointStroke:'#b2c5ab',broken:'#ff7765'};
  function createTheme({host,document,storage}) {
    let mode='system',media;
    const listeners=new Set(),buttons=new Set();
    try {const saved=storage?.getItem(KEY);if(modes.includes(saved))mode=saved;}catch(_){}
    try {media=host.matchMedia?.('(prefers-color-scheme: dark)');}catch(_){}
    const isDark=()=>mode==='dark'||(mode==='system'&&!!media?.matches);
    function nextMode() {
      if(mode==='system')return isDark()?'light':'dark';
      if(mode===(media?.matches?'dark':'light'))return 'system';
      return mode==='dark'?'light':'dark';
    }
    function apply() {
      const resolved=isDark()?'dark':'light';
      document.documentElement.setAttribute('data-theme',resolved);
      document.documentElement.style.colorScheme=resolved;
      document.getElementById('theme-color')?.setAttribute('content',isDark()?'#131a1f':'#edece6');
      for(const button of buttons) {
        button.textContent='NIGHT: '+(mode==='system'?'SYSTEM':mode==='dark'?'ON':'OFF');
        const description='Color theme: '+mode+(mode==='system'?' ('+resolved+')':'')+'. Next: '+nextMode()+'.';
        button.setAttribute('aria-label',description);button.title=description;
      }
      for(const listener of listeners)listener();
    }
    const api={get mode(){return mode;},get dark(){return isDark();},get scene(){return isDark()?dark:light;},
      setMode(value) {
        mode=modes.includes(value)?value:'system';
        try {storage?.setItem(KEY,mode);}catch(_){}
        apply();
      },
      bind(button) {buttons.add(button);button.addEventListener('click',()=>api.setMode(nextMode()));apply();},
      subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
    };
    if(media?.addEventListener)media.addEventListener('change',apply);
    else media?.addListener?.(apply);
    host.addEventListener?.('storage',event=>{
      if(event.key===KEY||event.key===null){mode=modes.includes(event.newValue)?event.newValue:'system';apply();}
    });
    apply();return api;
  }
  root.DismountTheme={createTheme,KEY,light,dark};
  if(root.document) {
    let storage;try {storage=root.localStorage;}catch(_){}
    root.DismountTheme.current=createTheme({host:root,document:root.document,storage});
  }
  if(typeof module!=='undefined')module.exports=root.DismountTheme;
})(typeof window!=='undefined'?window:globalThis);
