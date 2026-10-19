/* Native fullscreen and an accessible full-window fallback, with shared settings. */
(function(root){
  'use strict';
  function attach({host=root,document,$,resize,cancelGesture}) {
    let controlsMoved=false;
    function closeSettings(){
      $('settings-drawer').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');
      if(controlsMoved)$('settings-toggle').focus?.();
    }
    $('settings-drawer').hidden=true;
    $('settings-toggle').addEventListener('click',()=>{
      const open=$('settings-drawer').hidden;
      $('settings-drawer').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));
      if(open)$('settings-close').focus?.();
    });
    $('settings-close').addEventListener('click',closeSettings);
    let expandedView=false, fullscreenPending=false, expandedRestore=null;
    const nativeFullscreenElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
    function updateFullscreenButton() {
      const active=expandedView||nativeFullscreenElement()===$('game-panel');
      $('fullscreen').textContent=active?'EXIT FULLSCREEN':'FULLSCREEN';
      $('fullscreen').setAttribute('aria-pressed',String(active));
      $('fullscreen').disabled=fullscreenPending;
      $('settings-toggle').hidden=!active;
      if(active!==controlsMoved) {
        controlsMoved=active;
        if(active)$('drawer-body').appendChild($('push-controls'));
        else {
          const home=$('control-home');
          if(home.insertBefore)home.insertBefore($('push-controls'),home.firstChild);
          else home.appendChild($('push-controls'));
          closeSettings();
        }
      }
    }
    function setExpandedView(active) {
      if(expandedView===active)return;
      expandedView=active;
      $('game-panel').setAttribute('data-expanded',String(active));
      if(active) {
        const body=document.body;
        expandedRestore={x:host.scrollX||0,y:host.scrollY||0,
          style:{position:body.style.position,top:body.style.top,width:body.style.width,overflow:body.style.overflow},
          siblings:Array.from(document.querySelectorAll('header, .workspace > aside, .workspace > .injury-report, .highscores, main > footer')).map(node=>[node,node.inert])};
        body.style.position='fixed';body.style.top=-expandedRestore.y+'px';body.style.width='100%';body.style.overflow='hidden';
        for(const [node] of expandedRestore.siblings)node.inert=true;
      } else {
        Object.assign(document.body.style,expandedRestore.style);
        for(const [node,inert] of expandedRestore.siblings)node.inert=inert;
        host.scrollTo?.(expandedRestore.x,expandedRestore.y);expandedRestore=null;
      }
      updateFullscreenButton();resize();$('fullscreen').focus?.();
    }
    $('fullscreen').disabled=false;
    $('fullscreen').addEventListener('click',async()=>{
      if(fullscreenPending)return;
      if(expandedView){setExpandedView(false);return;}
      fullscreenPending=true;updateFullscreenButton();
      const panel=$('game-panel'),active=nativeFullscreenElement()===panel;
      try {
        if(active) {
          const leave=document.exitFullscreen||document.webkitExitFullscreen;
          if(leave)await leave.call(document);
        } else {
          const enter=panel.requestFullscreen||panel.webkitRequestFullscreen;
          if(!enter||document.fullscreenEnabled===false) setExpandedView(true);
          else await enter.call(panel);
        }
        $('fullscreen').title=expandedView?'Full-window view; browser controls may remain visible.':'';
      } catch (_) {
        if(!active) {
          setExpandedView(true);
          $('fullscreen').title='Full-window view; browser controls may remain visible.';
        } else $('fullscreen').title='Use the browser fullscreen exit control to leave.';
      } finally { fullscreenPending=false;updateFullscreenButton();resize(); }
    });
    const fullscreenChanged=()=>{updateFullscreenButton();resize();};
    document.addEventListener('fullscreenchange',fullscreenChanged);
    document.addEventListener('webkitfullscreenchange',fullscreenChanged);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!$('settings-drawer').hidden){event.preventDefault();closeSettings();return;}
      if(event.key==='Escape'&&expandedView){event.preventDefault();setExpandedView(false);}
    });
    host.addEventListener('resize',()=>{
      cancelGesture();
      resize();
    });
    host.visualViewport?.addEventListener('resize',()=>{resize();});

    updateFullscreenButton();
  }
  root.DismountFullscreen={attach};
  if(typeof module!=='undefined')module.exports=root.DismountFullscreen;
})(typeof window!=='undefined'?window:globalThis);
