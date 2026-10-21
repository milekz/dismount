const test=require('node:test');
const assert=require('node:assert/strict');
const {createTheme,KEY,light,dark}=require('../src/theme.js');

function setup(systemDark=false,saved=null,denied=false,legacyMedia=false) {
  const elements=new Map(),events={},values=new Map(saved===null?[]:[[KEY,saved]]);
  const element=id=>{
    if(!elements.has(id))elements.set(id,{style:{},events:{},setAttribute(name,value){this[name]=value;},addEventListener(name,handler){this.events[name]=handler;}});
    return elements.get(id);
  };
  const document={documentElement:element('root'),getElementById:element};
  let changed;
  const media={matches:systemDark,[legacyMedia?'addListener':'addEventListener'](...args){changed=args.at(-1);}};
  const storage={getItem:key=>{if(denied)throw Error('denied');return values.get(key)||null;},setItem:(key,value)=>{if(denied)throw Error('denied');values.set(key,value);}};
  const host={matchMedia(query){assert.equal(query,'(prefers-color-scheme: dark)');return media;},addEventListener(name,handler){events[name]=handler;}};
  const theme=createTheme({host,document,storage}),button=element('toggle');theme.bind(button);
  return {theme,button,document,values,element,events,click:()=>button.events.click(),system(value){media.matches=value;changed();}};
}

test('first load follows system appearance and applies root, native controls and browser chrome together',()=>{
  for(const preference of [false,true]) {
    const g=setup(preference),resolved=preference?'dark':'light';
    assert.equal(g.theme.mode,'system');assert.equal(g.theme.dark,preference);
    assert.equal(g.button.textContent,'NIGHT: SYSTEM');
    assert.equal(g.document.documentElement['data-theme'],resolved);
    assert.equal(g.document.documentElement.style.colorScheme,resolved);
    assert.equal(g.element('theme-color').content,preference?'#131a1f':'#edece6');
    assert.equal(g.theme.scene,preference?dark:light);
    assert.equal(g.values.has(KEY),false,'Following system should not save an override');
  }
});

test('one click changes the effective appearance and three clicks return to system, with saved manual modes',()=>{
  for(const systemDark of [false,true]) {
    const g=setup(systemDark);g.click();
    assert.equal(g.theme.dark,!systemDark);assert.equal(g.values.get(KEY),systemDark?'light':'dark');
    assert.equal(setup(systemDark,g.values.get(KEY)).theme.dark,!systemDark);
    g.click();assert.equal(g.theme.dark,systemDark);assert.notEqual(g.theme.mode,'system');
    g.click();assert.equal(g.theme.mode,'system');assert.equal(g.values.get(KEY),'system');
    assert.match(g.button['aria-label'],/Color theme: system/);
  }
});

test('system changes update auto mode but respect manual overrides, including the older Safari listener API',()=>{
  for(const legacy of [false,true]) {
    const g=setup(false,null,false,legacy);let changes=0;g.theme.subscribe(()=>changes++);
    g.system(true);assert.equal(g.theme.dark,true);assert.equal(changes,1);
    g.theme.setMode('light');g.system(false);g.system(true);assert.equal(g.theme.dark,false);
    g.theme.setMode('system');assert.equal(g.theme.dark,true);
  }
});

test('invalid preferences and unavailable storage fall back safely and remain usable for the session',()=>{
  assert.equal(setup(true,'invalid').theme.mode,'system');
  const denied=setup(true,null,true);denied.click();assert.equal(denied.theme.dark,false);
  const g=setup(false);g.theme.setMode('invalid');assert.equal(g.theme.mode,'system');
  const basic=createTheme({host:{},document:g.document});assert.equal(basic.dark,false);
  basic.setMode('dark');assert.equal(basic.dark,true);
});

test('preference changes from another tab synchronize and clearing storage restores system mode',()=>{
  const g=setup(false);g.events.storage({key:KEY,newValue:'dark'});assert.equal(g.theme.dark,true);
  g.events.storage({key:'unrelated',newValue:'light'});assert.equal(g.theme.dark,true);
  g.events.storage({key:null,newValue:null});assert.equal(g.theme.mode,'system');assert.equal(g.theme.dark,false);
});

test('browser script initializes the system palette before controls exist and loads before the stylesheet',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const g=setup(true),host={document:g.document,matchMedia:()=>({matches:true})};
  Object.defineProperty(host,'localStorage',{get(){throw Error('blocked');}});
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/theme.js'),'utf8'),{window:host});
  assert.equal(host.DismountTheme.current.dark,true);
  assert.equal(g.document.documentElement['data-theme'],'dark');
  const markup=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const script=markup.indexOf('<script src="src/theme.js"></script>');
  assert.ok(script>=0&&script<markup.indexOf('href="style.css"'));
});
