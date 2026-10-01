'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const nav = require('../viewer-navigation.js');

test('normalized focal positions clamp to image viewport edges', () => {
  assert.deepEqual(nav.point({left:100,top:200,width:400,height:200},300,250), {x:.5,y:.25});
  assert.deepEqual(nav.point({left:100,top:200,width:400,height:200},-100,999), {x:0,y:1});
});

test('linked normalized pan respects different aspect ratios and letterboxing', () => {
  const viewport={width:200,height:200}, tall=nav.imageSize(400,800,200,200), wide=nav.imageSize(800,400,200,200);
  assert.deepEqual(tall,{width:100,height:200}); assert.deepEqual(wide,{width:200,height:100});
  assert.deepEqual(nav.pan(viewport,tall,2,{x:1,y:1}),{x:-0,y:-100});
  assert.deepEqual(nav.pan(viewport,wide,2,{x:1,y:1}),{x:-100,y:-0});
  assert.deepEqual(nav.pan(viewport,tall,2,{x:0,y:0}),{x:0,y:100});
  assert.deepEqual(nav.pan(viewport,tall,1,{x:0,y:0}),{x:0,y:0});
  assert.deepEqual(nav.imageSize(400,800,340,340,'cover'),{width:340,height:340});
});

test('wheel scale accepts pixel line and page input within fit and maximum bounds', () => {
  assert.equal(nav.wheelZoom(1,100000),1); assert.equal(nav.wheelZoom(6,-100000),6);
  assert.ok(nav.wheelZoom(2,1,1)<2); assert.ok(nav.wheelZoom(2,-1,2,600)>2);
  assert.equal(nav.wheelZoom(2,16),nav.wheelZoom(2,1,1));
});

class Node {
  constructor(tag='div',className='') {
    this.tagName=tag;this.className=className;this.children=[];this.attrs={};this.listeners=new Map();this.hidden=false;this.disabled=false;this.open=false;
    this.clientWidth=this.offsetWidth=200;this.clientHeight=this.offsetHeight=200;
    this.style={transform:'',removeProperty(name){this[name]='';}};
    this.classList={contains:name=>this.className.split(' ').includes(name),toggle:(name,force)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(force)set.add(name);else set.delete(name);this.className=[...set].join(' ');},remove:name=>this.classList.toggle(name,false)};
  }
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  after(node){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this)+1,0,node);node.parentElement=parent;}
  setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  removeAttribute(name){delete this.attrs[name];}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(callback=>callback!==fn));}
  emit(type,options={}){const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...options};for(const fn of this.listeners.get(type)||[])fn(event);return event;}
  click(){if(!this.disabled)this.emit('click');}
  matches(selector){return selector[0]==='.'?this.classList.contains(selector.slice(1)):this.tagName===selector;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getBoundingClientRect(){return {left:100,top:200,width:this.clientWidth,height:this.clientHeight};}
  setPointerCapture(id){this.captured=id;}
}
function harness() {
  const body=new Node(),viewer=new Node('dialog'),tools=new Node('div','viewer-tools'),content=new Node();viewer.id='viewer';content.id='viewer-content';viewer.append(tools,content);body.append(viewer);
  const detail=new Node('button'),full=new Node('button');detail.id='face-detail-button';full.id='full-portrait-button';tools.append(detail,full);
  detail.addEventListener('click',()=>viewer.classList.toggle('face-detail',true));full.addEventListener('click',()=>viewer.classList.remove('face-detail'));
  const document=new Node();document.createElement=tag=>new Node(tag);document.getElementById=id=>[body,...allNodes(body)].find(node=>node.id===id)||null;
  const window=new Node();window.getComputedStyle=image=>({transform:image.baseTransform||'none',objectFit:image.objectFit||'contain'});window.requestAnimationFrame=fn=>fn();
  let chosen=[];window.MATRIX_APP={getViewerCells:()=>chosen,describe:cell=>cell.id};
  const controller=nav.mount(window,document);
  function open(ids=['left','right']) {
    chosen=ids.map(id=>({id}));viewer.open=true;viewer.classList.remove('face-detail');content.children=[];
    for(let i=0;i<ids.length;i++){const figure=new Node('figure','viewer-figure'),frame=new Node('div','viewer-image-frame'),image=new Node('img');image.naturalWidth=i?800:400;image.naturalHeight=i?400:800;frame.append(image);figure.append(frame);content.append(figure);}
    document.emit('matrix:vieweropen');return content.querySelectorAll('img');
  }
  const event=(type,index=0,options={})=>content.emit(type,{target:content.querySelectorAll('img')[index],pointerType:'mouse',clientX:200,clientY:300,...options});
  return {body,viewer,content,document,window,controller,open,event,detail,full,node:id=>document.getElementById(id)};
}
function allNodes(node){return node.children.flatMap(child=>[child,...allNodes(child)]);}

test('actual Compare controls zoom both images while mouse motion pans shared positions', () => {
  const h=harness(),images=h.open();
  assert.equal(h.node('vcn-controls').hidden,false);assert.equal(h.node('vcn-out').disabled,true);
  h.node('vcn-in').click();assert.equal(h.controller.getState().zoom,1.25);assert.equal(h.node('vcn-value').textContent,'125%');
  h.event('pointermove',0,{clientX:300,clientY:400});
  assert.deepEqual(h.controller.getState().focal,{x:1,y:1});
  assert.match(images[0].style.transform,/translate3d\(0px,-25px,0\) scale\(1.25\)/);
  assert.match(images[1].style.transform,/translate3d\(-25px,0px,0\) scale\(1.25\)/);
  h.event('pointermove',1,{clientX:100,clientY:200});
  assert.deepEqual(h.controller.getState().focal,{x:0,y:0});assert.match(images[0].style.transform,/25px/);
  h.node('vcn-fit').click();assert.equal(h.controller.getState().zoom,1);assert.ok(images.every(image=>image.style.transform===''));
});

test('wheel consumes only changing image zoom and leaves fit scrolling and browser shortcuts intact', () => {
  const h=harness();h.open();
  assert.equal(h.event('wheel',0,{deltaY:100}).defaultPrevented,false);
  assert.equal(h.event('wheel',0,{deltaY:-100,ctrlKey:true}).defaultPrevented,false);
  assert.equal(h.event('wheel',0,{deltaY:-100}).defaultPrevented,true);assert.ok(h.controller.getState().zoom>1);
  assert.equal(h.event('wheel',0,{deltaY:10000}).defaultPrevented,true);assert.equal(h.controller.getState().zoom,1);
  assert.equal(h.content.emit('wheel',{target:h.node('vcn-help'),deltaY:-100}).defaultPrevented,false);
});

test('keyboard inspection and touch drag move both images with bounded reset', () => {
  const h=harness();h.open();const frames=h.content.querySelectorAll('.viewer-image-frame');
  assert.equal(frames[0].tabIndex,0);assert.match(frames[0].getAttribute('aria-describedby'),/vcn-keyhelp/);
  assert.equal(h.event('keydown',0,{key:'+'}).defaultPrevented,true);
  assert.equal(h.event('keydown',1,{key:'ArrowRight'}).defaultPrevented,true);assert.ok(h.controller.getState().focal.x>.5);
  assert.equal(h.event('pointerdown',0,{pointerType:'touch',pointerId:7}).defaultPrevented,true);assert.equal(frames[0].captured,7);
  assert.equal(h.event('pointermove',0,{pointerType:'touch',pointerId:7,clientX:-1000,clientY:-1000}).defaultPrevented,true);
  assert.deepEqual(h.controller.getState().focal,{x:1,y:1});
  h.event('pointerup',0,{pointerType:'touch',pointerId:7});
  h.event('keydown',0,{key:'0'});assert.deepEqual(h.controller.getState(),{zoom:1,focal:{x:.5,y:.5}});
});

test('swapping keeps linked view; new selections framing changes and closing restore defaults', () => {
  const h=harness();h.open();h.node('vcn-in').click();h.event('pointermove',0,{clientX:300,clientY:400});
  h.open(['right','left']);assert.equal(h.controller.getState().zoom,1.25);assert.deepEqual(h.controller.getState().focal,{x:1,y:1});
  h.full.click();assert.deepEqual(h.controller.getState(),{zoom:1,focal:{x:.5,y:.5}});
  h.node('vcn-in').click();h.open(['another','left']);assert.equal(h.controller.getState().zoom,1);
  h.open(['left']);assert.equal(h.node('vcn-controls').hidden,true);assert.equal(h.content.querySelector('.viewer-image-frame').getAttribute('role'),null);
  h.open();h.node('vcn-in').click();const images=h.content.querySelectorAll('img');h.viewer.open=false;h.viewer.emit('close');
  assert.equal(h.node('vcn-controls').hidden,true);assert.ok(images.every(image=>image.style.transform===''));
});

test('existing detail translation is preserved during zoom and hidden images are ignored', () => {
  const h=harness(),images=h.open(),frames=h.content.querySelectorAll('.viewer-image-frame');
  images[0].baseTransform='matrix(1, 0, 0, 1, -170, -170)';images[0].objectFit='cover';images[0].offsetWidth=images[0].offsetHeight=340;
  h.detail.click();h.node('vcn-in').click();assert.match(images[0].style.transform,/^matrix\(1, 0, 0, 1, -170, -170\) translate3d/);
  images[0].hidden=true;images[0].emit('error');assert.equal(images[0].style.transform,'');assert.equal(frames[0].classList.contains('vcn-zoomed'),false);
  images[1].hidden=true;images[1].emit('error');assert.equal(h.node('vcn-in').disabled,true);
});

test('existing 170 percent Detail crop pans at baseline and wheel or minus returns Full framing', () => {
  const h=harness(),images=h.open();
  for(const image of images){image.baseTransform='matrix(1, 0, 0, 1, -170, -170)';image.objectFit='cover';image.offsetWidth=image.offsetHeight=340;}
  h.detail.click();assert.equal(h.controller.getState().zoom,1);assert.equal(h.node('vcn-out').disabled,false);
  assert.equal(h.node('vcn-out').getAttribute('aria-label'),'Show full images');
  h.event('pointermove',0,{clientX:300,clientY:400});assert.deepEqual(h.controller.getState().focal,{x:1,y:1});
  assert.ok(images.every(image=>image.style.transform.includes('translate3d(-70px,-70px,0)')));
  h.node('vcn-fit').click();assert.deepEqual(h.controller.getState().focal,{x:.5,y:.5});
  assert.equal(h.event('wheel',0,{deltaY:100}).defaultPrevented,true);assert.equal(h.viewer.classList.contains('face-detail'),false);
  h.detail.click();h.event('keydown',0,{key:'-'});assert.equal(h.viewer.classList.contains('face-detail'),false);
  h.detail.click();h.node('vcn-out').click();assert.equal(h.viewer.classList.contains('face-detail'),false);
});

test('same-pair Detail swap restores framing without resetting linked pan and zoom', () => {
  const h=harness();h.open();h.detail.click();h.node('vcn-in').click();h.event('pointermove',0,{clientX:300,clientY:400});
  const before=h.controller.getState();h.open(['right','left']);
  assert.equal(h.viewer.classList.contains('face-detail'),true,'vieweropen Full reset is repaired before enhancement synthetic restoration');
  assert.deepEqual(h.controller.getState(),before);
  h.detail.click();assert.equal(h.controller.getState().zoom,1,'explicit framing choices still reset linked zoom');
});
