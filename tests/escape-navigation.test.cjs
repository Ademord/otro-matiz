'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const router=require('../escape-navigation.js');
class KeyboardEvent extends Event {constructor(type,options={}){super(type,options);this.key=options.key;this.repeat=!!options.repeat;}}
class Observer {constructor(callback){this.callback=callback;this.records=[];}observe(doc){doc.observer=this;}takeRecords(){return this.records.splice(0);}disconnect(){this.records=[];}}
class Document extends EventTarget {
  constructor(){super();this.dialogs=[];this.frames=[];this.ids=new Map();this.classes=new Set();this.body={classList:{contains:name=>this.classes.has(name)}};}
  querySelectorAll(selector){return selector==='dialog[open]'?this.dialogs.filter(dialog=>dialog.open):selector==='iframe'?this.frames:[];}
  getElementById(id){return this.ids.get(id)||null;}
  change(target){this.observer?.records.push({type:'attributes',target});}
}
class Dialog extends EventTarget {
  constructor(doc,id){super();this.ownerDocument=doc;this.tagName='DIALOG';this.id=id;this.open=false;this.requests=0;this.closes=0;doc.dialogs.push(this);}
  showModal(){this.open=true;this.ownerDocument.change(this);}
  close(){this.open=false;this.closes++;this.ownerDocument.change(this);this.dispatchEvent(new Event('close'));}
  requestClose(){this.requests++;const cancel=new Event('cancel',{cancelable:true});if(this.dispatchEvent(cancel)&&this.open)this.close();}
}
class Frame extends EventTarget {constructor(doc){super();this.contentDocument=doc;}}
function window(parent=null){const doc=new Document(),win={document:doc,Event,KeyboardEvent,MutationObserver:Observer};doc.defaultView=win;win.parent=parent||win;return win;}
function key(doc,repeat=false){const event=new KeyboardEvent('keydown',{key:'Escape',repeat,cancelable:true,bubbles:true});doc.dispatchEvent(event);return event;}
function fixture(){const parent=window(),core=window(parent);core.MATRIX_APP={};parent.document.frames.push(new Frame(core.document));const controller=router.install(parent);return {parent,core,controller};}

test('Escape on Premium chrome closes child Compare and consumes precisely one key',()=>{
  const h=fixture(),viewer=new Dialog(h.core.document,'viewer');viewer.showModal();
  let later=0;h.parent.document.addEventListener('keydown',()=>later++);
  const event=key(h.parent.document);assert.equal(viewer.open,false);assert.equal(viewer.requests,1);assert.equal(event.defaultPrevented,true);assert.equal(later,0);
});

test('parent modal then mobile drawer then child modal follow explicit priority',()=>{
  const h=fixture(),brief=new Dialog(h.parent.document,'brief'),viewer=new Dialog(h.core.document,'viewer');
  viewer.showModal();brief.showModal();h.parent.document.classes.add('nav-open');
  const menu={click(){h.parent.document.classes.delete('nav-open');},focus(){this.focused=true;}};h.parent.document.ids.set('shell-menu',menu);
  key(h.core.document);assert.equal(brief.open,false);assert.equal(viewer.open,true);assert.equal(h.parent.document.classes.has('nav-open'),true);
  key(h.parent.document);assert.equal(menu.focused,true);assert.equal(viewer.open,true);
  key(h.parent.document);assert.equal(viewer.open,false);
});

test('mutation open order chooses latest dialog even when DOM order is reversed',()=>{
  const h=fixture(),earlierDOM=new Dialog(h.core.document,'evaluation'),laterDOM=new Dialog(h.core.document,'viewer');
  laterDOM.showModal();earlierDOM.showModal();key(h.parent.document);
  assert.equal(earlierDOM.open,false);assert.equal(laterDOM.open,true);
  earlierDOM.showModal();key(h.parent.document);assert.equal(earlierDOM.closes,2);assert.equal(laterDOM.open,true);
});

test('native and fallback cancellation respect pending-save guards and never close background dialogs',()=>{
  const h=fixture(),background=new Dialog(h.core.document,'viewer'),saving=new Dialog(h.core.document,'evaluation');background.showModal();saving.showModal();
  saving.addEventListener('cancel',event=>event.preventDefault());key(h.parent.document);
  assert.equal(saving.open,true);assert.equal(background.open,true);assert.equal(saving.requests,1);
  saving.requestClose=undefined;key(h.parent.document);assert.equal(saving.open,true);assert.equal(background.open,true);
  const normal=new Dialog(h.core.document,'plain');normal.requestClose=undefined;normal.showModal();key(h.core.document);assert.equal(normal.open,false);assert.equal(saving.open,true);
});

test('a cancel handler that closes itself is not closed a second time',()=>{
  const h=fixture(),dialog=new Dialog(h.parent.document,'history');dialog.requestClose=undefined;dialog.showModal();
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});key(h.parent.document);assert.equal(dialog.closes,1);
});

test('preview iframe Escape closes its outer parent modal before its local key handler',()=>{
  const h=fixture(),preview=window(h.parent),frame=new Frame(preview.document);h.parent.document.frames.push(frame);h.controller.refresh();frame.dispatchEvent(new Event('load'));
  const outer=new Dialog(h.parent.document,'saved-brief');outer.showModal();let local=0;preview.document.addEventListener('keydown',()=>local++);
  assert.equal(key(preview.document).defaultPrevented,true);assert.equal(outer.open,false);assert.equal(local,0);
});

test('one controller binds loaded documents once, drops replaced documents and ignores inaccessible frames',()=>{
  const h=fixture();assert.equal(router.install(h.core),h.controller);
  const inaccessible=new Frame(null);Object.defineProperty(inaccessible,'contentDocument',{get(){throw new Error('blocked');}});h.parent.document.frames.push(inaccessible);
  const old=h.core.document,next=window(h.parent),frame=h.parent.document.frames[0];frame.contentDocument=next.document;frame.dispatchEvent(new Event('load'));
  const dialog=new Dialog(next.document,'new');dialog.showModal();key(old);assert.equal(dialog.open,true);
  key(h.parent.document);assert.equal(dialog.open,false);assert.equal(dialog.requests,1);
});

test('parent and preview keys delegate one step to existing View picking Focus handlers without recursion',()=>{
  const h=fixture(),state={view:true,picking:true,focus:true},steps=[];
  h.core.document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented)return;for(const layer of ['view','picking','focus'])if(state[layer]){state[layer]=false;steps.push(layer);event.preventDefault();return;}});
  key(h.parent.document);assert.deepEqual(steps,['view']);assert.equal(state.picking,true);
  key(h.parent.document);assert.deepEqual(steps,['view','picking']);assert.equal(state.focus,true);
  key(h.parent.document);assert.deepEqual(steps,['view','picking','focus']);
  assert.equal(key(h.parent.document).defaultPrevented,false,'unhandled Escape remains native');
});

test('held Escape cannot cascade through more than one layer until keyup',()=>{
  const h=fixture(),viewer=new Dialog(h.core.document,'viewer'),evaluation=new Dialog(h.core.document,'evaluation');viewer.showModal();evaluation.showModal();
  key(h.parent.document);assert.equal(evaluation.open,false);assert.equal(viewer.open,true);
  assert.equal(key(h.parent.document,true).defaultPrevented,true);assert.equal(viewer.open,true);
  h.parent.document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape'}));key(h.parent.document);assert.equal(viewer.open,false);
});
