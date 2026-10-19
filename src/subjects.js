/* Presentation vocabulary and damage-map silhouettes; no simulation state. */
(function(root){
  'use strict';
  const themes={
    human:{title:'Body damage map',overall:'Overall recovery chance',part:'Selected part recovery',broken:'dislocated',strained:'strained',none:'No dislocations.',event:'DISLOCATION',help:'Fictional game estimate. Damage and dislocations reduce recovery chances.'},
    robot:{title:'System damage map',overall:'System repair chance',part:'Component repair chance',broken:'joint failure',strained:'overloaded',none:'All mechanical joints operational.',event:'JOINT FAILURE',help:'Fictional repair estimate. Impacts and mechanical failures reduce repairability.',head:'M89 9 H111 V34 H89 Z',torso:'M84 44 H116 L113 74 H87 Z'},
    knight:{title:'Armor & body damage',overall:'Recovery under armor',part:'Selected part recovery',broken:'dislocated',strained:'strained',none:'No dislocations.',event:'DISLOCATION',help:'Armor adds weight and joint strength. The recovery estimate is fictional.',head:'M89 15 Q100 0 111 15 L110 33 L100 38 L90 33 Z',torso:'M82 48 L94 42 L106 42 L118 48 L112 73 L100 79 L88 73 Z'},
    skeleton:{title:'Bone integrity map',overall:'Reassembly chance',part:'Bone repair chance',broken:'separated',strained:'cracked',none:'All bone connections intact.',event:'BONE SEPARATION',help:'Fictional reassembly estimate. Cracked bones and separated joints reduce it.',head:'M89 16 Q89 5 100 6 Q112 5 112 17 L109 28 L106 28 V35 H94 V28 L91 28 Z',torso:'M97 44 H103 V48 H113 V51 H103 V55 H113 V58 H103 V62 H111 V65 H103 V74 H97 V65 H89 V62 H97 V58 H87 V55 H97 V51 H87 V48 H97 Z'},
    inflatable:{title:'Tube damage map',overall:'Air retention',part:'Tube integrity',broken:'seam failure',strained:'stretched',none:'All seams intact.',event:'SEAM FAILURE',help:'Fictional integrity estimate. Impacts and failed seams reduce air retention.',head:'M88 21 C88 2 112 2 112 21 C112 41 88 41 88 21 Z',torso:'M88 46 Q100 40 112 46 L112 72 Q100 80 88 72 Z'}
  };
  root.DismountSubjects={themes};
  if(typeof module!=='undefined')module.exports=root.DismountSubjects;
})(typeof window!=='undefined'?window:globalThis);
