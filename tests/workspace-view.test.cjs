const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
class Emitter {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); return true; }
}
class Element extends Emitter {
  constructor() {
    super(); this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] || ''; },
      removeProperty(name) { delete this[name]; }
    };
    this.hidden = false; this.children = []; this.classList = {add(){}, remove(){}, contains: name => (this.className || '').split(/\s+/).includes(name)};
    this.clientWidth = 900; this.clientHeight = 500; this.clientLeft = this.clientTop = 0; this.isContentEditable = false;
  }
  setAttribute(name, value) { this[name] = value; }
  append(...children) { this.children.push(...children); }
  before() {}
  closest(selector) { return selector.includes('[hidden]') && this.hidden ? this : null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  getBoundingClientRect() { return {left: 0, top: 0}; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() {}
  contains() { return true; }
  hasPointerCapture() { return false; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
function boot({id = 'one', storage = new Map(), broken = false, navigation = false, columnCount = 9} = {}) {
  const document = new Emitter(), window = new Emitter();
  const created = [];
  const elements = Object.fromEntries(['matrix-wrap', 'matrix', 'matrix-navigation', 'matrix-zoom', 'zoom-out', 'zoom-in', 'zoom-reset', 'zoom-fit', 'scroll-hint'].map(id => [id, new Element()]));
  const wrap = elements['matrix-wrap'], table = elements.matrix;
  const headerWidth = 200, headerHeight = 64, cellGutter = 16, rowControls = 96;
  const imageWidth = () => parseFloat(table.style['--image-width']) || 300 * Number(table.style.zoom || 1);
  const cardWidth = () => parseFloat(table.style['--card-width']) || Math.max(124, imageWidth());
  const cellWidth = () => parseFloat(table.style['--cell-width']) || cardWidth() + cellGutter;
  const rowHeight = () => imageWidth() + rowControls;
  const headers = Array.from({ length: columnCount }, () => new Element());
  const corner = new Element(); corner.getBoundingClientRect = () => ({ left: 0, top: 0, width: headerWidth, height: headerHeight });
  table.tHead = { rows: [{ cells: [corner, ...headers] }] };
  table.style.setProperty('--column-count', columnCount);
  table.querySelectorAll = selector => selector.includes('thead') ? headers : [];
  table.querySelector = selector => selector.includes('corner') ? corner : null;
  let left = 0, top = 0, time = 1000, resize;
  Object.defineProperties(wrap, {
    scrollWidth: {get: () => wrap.hidden ? 0 : Math.max(wrap.clientWidth, headerWidth + headers.filter(header => !header.hidden).length * cellWidth())},
    scrollHeight: {get: () => wrap.hidden ? 0 : Math.max(wrap.clientHeight, headerHeight + 15 * rowHeight())},
    scrollLeft: {get: () => left, set: value => { left = Math.max(0, Math.min(value, wrap.scrollWidth - wrap.clientWidth)); }},
    scrollTop: {get: () => top, set: value => { top = Math.max(0, Math.min(value, wrap.scrollHeight - wrap.clientHeight)); }}
  });
  document.getElementById = id => elements[id] || created.find(node => node.id === id);
  document.createElement = () => { const node = new Element(); created.push(node); return node; };
  document.createTextNode = value => value;
  document.querySelector = () => null; document.activeElement = wrap;
  window.MATRIX_DATA = {meta: {id}, columns: headers.map((header, index) => ({ id: `column-${index}` }))};
  const frames = [];
  class ResizeObserver { constructor(callback) { resize = callback; } observe() {} }
  window.ResizeObserver = ResizeObserver;
  const context = vm.createContext({window, document, Element, ResizeObserver, CustomEvent: class {constructor(type, config) { this.type = type; this.detail = config.detail; }},
    localStorage: {getItem(key) { if (broken) throw Error('denied'); return storage.get(key) ?? null; }, setItem(key, value) { if (broken) throw Error('denied'); storage.set(key, value); }},
    performance: {now: () => time}, requestAnimationFrame: callback => frames.push(callback),
    getComputedStyle: node => ({
      minWidth: `${headerWidth + headers.filter(header => !header.hidden).length * cellWidth()}px`,
      width: node === corner ? `${headerWidth}px` : `${cellWidth()}px`,
      display: node.hidden ? 'none' : 'block',
      getPropertyValue: name => name === '--row-width' ? `${headerWidth}px` : node.style.getPropertyValue(name)
    })});
  vm.runInContext(source('workspace-view.js'), context);
  if (navigation) vm.runInContext(source('navigation.js'), context);
  const flush = () => { let rounds = 0; while (frames.length && ++rounds < 20) { const batch = frames.splice(0); batch.forEach(callback => callback()); } assert.ok(rounds < 20, 'bounded frame scheduling'); };
  const event = (target, type, extra = {}) => {
    const e = {type, target, currentTarget: target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, cancelable: true,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra}; target.dispatchEvent(e); return e;
  };
  const createImageAnchor = ({ row, column }) => {
    const anchor = new Element(); anchor.isConnected = true;
    anchor.closest = selector => selector.includes('.option-button') ? anchor : null;
    anchor.getBoundingClientRect = () => ({
      left: headerWidth + column * cellWidth() + 8 - wrap.scrollLeft,
      top: headerHeight + row * rowHeight() + 8 - wrap.scrollTop,
      width: imageWidth(), height: imageWidth()
    });
    document.elementFromPoint = () => anchor;
    return anchor;
  };
  return {window, document, storage, view: window.WorkspaceView, wrap, table, elements, headers, imageWidth, cardWidth, headerWidth, headerHeight, createImageAnchor, flush, event, resize: () => resize(), advance: value => {time += value;}};
}
test('new workspace defaults and legacy zoom adoption do not write during startup', () => {
  const storage = new Map([['visual-matrix.one.zoom.v1', '1.67']]);
  const app = boot({storage});
  assert.equal(app.view.get().zoom, 1.67); assert.equal(app.view.get().layout, 'gallery'); assert.equal(app.view.get().margin, null);
  assert.equal(storage.size, 1);
  const copy = app.view.get(); copy.margin = 91; assert.equal(app.view.get().margin, null);
});
test('fresh workspaces start with 58% images and no startup persistence', () => {
  const app = boot();
  assert.equal(app.view.get().zoom, 0.58);
  assert.equal(app.view.get().layout, 'gallery');
  assert.equal(app.storage.size, 0);
});
test('fresh gallery preferences use full images, automatic spacing and concise metadata', () => {
  const app = boot(), prefs = app.view.get();
  assert.equal(prefs.layout, 'gallery'); assert.equal(prefs.exploration, 'gallery');
  assert.equal(prefs.margin, null); assert.equal(prefs.galleryFraming, 'full');
  assert.equal(prefs.galleryGrouping, 'none'); assert.equal(prefs.galleryDescriptions, false); assert.equal(prefs.metadataFields, null);
  assert.equal(prefs.galleryZoom, 1); assert.equal(prefs.galleryFocalX, 0.5); assert.equal(prefs.galleryFocalY, 0.5);
  assert.equal(app.storage.size, 0);
});
test('gallery framing, grouping, metadata and crop preferences round-trip without replacing old explicit settings', () => {
  const storage = new Map([['visual-matrix.one.workspace.v1', JSON.stringify({layout: 'matrix', exploration: 'matrix', margin: 12, zoom: 1.38})]]);
  const app = boot({storage});
  assert.equal(app.view.get().layout, 'matrix'); assert.equal(app.view.get().margin, 12); assert.equal(app.view.get().zoom, 1.38);
  app.view.update({galleryFraming: 'focused', galleryGrouping: 'column', galleryDescriptions: true, metadataFields: ['row.material', 'column.accent', 'cell.price'], galleryZoom: 2, galleryFocalX: 0.2, galleryFocalY: 0.8});
  const reload = boot({storage}), prefs = reload.view.get();
  assert.equal(prefs.galleryFraming, 'focused'); assert.equal(prefs.galleryGrouping, 'column'); assert.equal(prefs.galleryDescriptions, true);
  assert.deepEqual(Array.from(prefs.metadataFields), ['row.material', 'column.accent', 'cell.price']);
  assert.equal(prefs.galleryZoom, 2); assert.equal(prefs.galleryFocalX, 0.2); assert.equal(prefs.galleryFocalY, 0.8);
  assert.equal(prefs.layout, 'matrix'); assert.equal(prefs.margin, 12); assert.equal(prefs.zoom, 1.38);
  reload.view.update({margin: null, metadataFields: []});
  assert.equal(boot({storage}).view.get().margin, null); assert.deepEqual(Array.from(boot({storage}).view.get().metadataFields), []);
  reload.view.reset();
  assert.equal(reload.view.get().galleryFraming, 'full'); assert.equal(reload.view.get().galleryGrouping, 'none'); assert.equal(reload.view.get().galleryDescriptions, false);
  assert.equal(reload.view.get().metadataFields, null); assert.equal(reload.view.get().margin, null);
});
test('metadata preference arrays are isolated from callers and equal arrays do not produce duplicate changes', () => {
  const app = boot(), events = [], fields = ['row.material', 'cell.price'];
  app.document.addEventListener('workspace:preferenceschange', event => events.push(event.detail));
  const result = app.view.update({metadataFields: fields});
  fields.push('column.accent'); result.metadataFields.push('cell.extra');
  const copy = app.view.get(); copy.metadataFields.push('row.extra');
  events[0].preferences.metadataFields.push('column.extra');
  assert.deepEqual(Array.from(app.view.get().metadataFields), ['row.material', 'cell.price']);
  app.view.update({metadataFields: ['row.material', 'cell.price']});
  assert.equal(events.length, 1);
});
test('invalid gallery preferences leave valid persisted choices intact', () => {
  const app = boot();
  app.view.update({galleryFraming: 'focused', galleryGrouping: 'row', galleryDescriptions: true, metadataFields: ['cell.price'], galleryZoom: 2, galleryFocalX: 0.2, galleryFocalY: 0.8});
  app.view.update({galleryFraming: 'portrait', galleryGrouping: 'all', galleryDescriptions: 'yes', metadataFields: ['unknown.price'], galleryZoom: 4, galleryFocalX: -1, galleryFocalY: NaN});
  assert.equal(app.view.get().galleryFraming, 'focused'); assert.equal(app.view.get().galleryGrouping, 'row'); assert.equal(app.view.get().galleryDescriptions, true);
  assert.deepEqual(Array.from(app.view.get().metadataFields), ['cell.price']);
  assert.equal(app.view.get().galleryZoom, 2); assert.equal(app.view.get().galleryFocalX, 0.2); assert.equal(app.view.get().galleryFocalY, 0.8);
  app.view.update({metadataFields: Array.from({length: 33}, (_, i) => `cell.field${i}`)});
  assert.deepEqual(Array.from(app.view.get().metadataFields), ['cell.price']);
  app.view.update({metadataFields: [`row.${'x'.repeat(101)}`]});
  assert.deepEqual(Array.from(app.view.get().metadataFields), ['cell.price']);
});
test('explicit workspace image size takes precedence over legacy zoom and reset uses 58%', () => {
  const storage = new Map([
    ['visual-matrix.one.zoom.v1', '0.74'],
    ['visual-matrix.one.workspace.v1', JSON.stringify({ zoom: 1.38, matrixLeft: 123, matrixTop: 456 })]
  ]);
  const app = boot({ storage });
  assert.equal(app.view.get().zoom, 1.38);
  assert.equal(app.view.get().matrixLeft, 123);
  assert.equal(app.view.get().matrixTop, 456);
  app.view.reset();
  assert.equal(app.view.get().zoom, 0.58);
  assert.equal(app.view.get().matrixLeft, 0);
  const reload = boot({ storage });
  assert.equal(reload.view.get().zoom, 0.58);
});
test('corrupt and partially invalid storage are safe; update accepts only bounded fields', () => {
  const app = boot({storage: new Map([['visual-matrix.one.workspace.v1', '{bad']])});
  app.view.update({margin: 120, zoom: NaN, layout: 'oops', focus: 'yes', matrixTop: -2, unknown: 'ignored'});
  assert.equal(app.view.get().zoom, 0.58); assert.equal(app.view.get().matrixTop, 0); assert.equal(app.view.get().focus, false);
  app.view.update({margin: 0, zoom: 2.5, focus: true});
  assert.equal(app.view.get().margin, 0); assert.equal(app.view.get().focus, true);
});
test('blocked storage retains an in-memory session and events report effective changes only', () => {
  const app = boot({broken: true}); const events = [];
  app.document.addEventListener('workspace:preferenceschange', e => events.push(e.detail));
  app.view.update({layout: 'favorites', exploration: 'matrix'}); app.view.update({layout: 'favorites'});
  assert.equal(events.length, 1); assert.deepEqual(Array.from(events[0].changed), ['layout', 'exploration']);
  assert.equal(app.view.get().layout, 'favorites');
});
test('project isolation and reset preserve unrelated content and other project preferences', () => {
  const storage = new Map([['project-content', 'private notes'], ['visual-matrix.two.workspace.v1', JSON.stringify({margin: 61})]]);
  const first = boot({storage}), second = boot({storage, id: 'two'});
  first.view.update({margin: 71, layout: 'gallery', matrixTop: 800});
  assert.equal(second.view.get().margin, 61); first.view.reset();
  assert.equal(storage.get('project-content'), 'private notes'); assert.equal(JSON.parse(storage.get('visual-matrix.two.workspace.v1')).margin, 61);
  assert.equal(first.view.get().matrixTop, 0); assert.equal(first.view.get().layout, 'gallery');
});
test('view, named list scope, zoom and point round-trip across a new document', () => {
  const storage = new Map(); const app = boot({storage});
  app.view.update({layout: 'favorites', exploration: 'gallery', favoriteListId: 'client-choice', zoom: 1.62, matrixLeft: 640, matrixTop: 840});
  const reload = boot({storage, navigation: true}); reload.flush();
  assert.equal(reload.view.get().layout, 'favorites'); assert.equal(reload.view.get().exploration, 'gallery'); assert.equal(reload.view.get().favoriteListId, 'client-choice');
  assert.equal(reload.wrap.scrollLeft, 640); assert.equal(reload.wrap.scrollTop, 840); assert.equal(reload.window.MatrixNavigation.getState().zoom, 1.62);
});
test('hidden resize and delayed programmatic scroll never replace the intended point', () => {
  const app = boot({navigation: true}); app.view.update({matrixLeft: 1000, matrixTop: 1500}); app.flush();
  app.wrap.hidden = true; app.wrap.scrollLeft = 0; app.wrap.scrollTop = 0; app.resize(); app.event(app.wrap, 'scroll'); app.flush();
  assert.equal(app.view.get().matrixLeft, 1000); assert.equal(app.view.get().matrixTop, 1500);
  app.wrap.hidden = false; app.event(app.document, 'presentation:viewchange'); app.flush();
  assert.equal(app.wrap.scrollLeft, 1000); assert.equal(app.wrap.scrollTop, 1500);
});
test('resize clamps displayed point but preserves intent and restores it when room returns', () => {
  const app = boot({navigation: true}); app.view.update({zoom: 1.38, matrixLeft: 1800}); app.flush();
  app.event(app.wrap, 'wheel', {deltaY: 3}); // A prior gesture must not make the following layout scroll look user-driven.
  app.wrap.clientWidth = 2700; app.resize(); app.flush(); app.event(app.wrap, 'scroll'); app.flush();
  assert.ok(Math.abs(app.wrap.scrollLeft - Math.max(0, app.wrap.scrollWidth - app.wrap.clientWidth)) < 0.01); assert.equal(app.view.get().matrixLeft, 1800);
  app.wrap.clientWidth = 900; app.resize(); app.flush(); assert.equal(app.wrap.scrollLeft, 1800);
});
test('fresh input cancels an outstanding restore and saves the actual user point', () => {
  const app = boot({navigation: true}); app.view.update({matrixLeft: 700}); // restore frame still pending
  app.event(app.wrap, 'wheel', {deltaY: 20}); app.wrap.scrollLeft = 850; app.event(app.wrap, 'scroll'); app.flush();
  assert.equal(app.wrap.scrollLeft, 850); assert.equal(app.view.get().matrixLeft, 850);
});
test('immediate reload after viewport clamping preserves the intended point', () => {
  const app = boot({navigation: true}); app.view.update({zoom: 1.38, matrixLeft: 1800}); app.flush();
  app.event(app.wrap, 'wheel', {deltaY: 3}); app.wrap.clientWidth = 2700; app.resize(); app.flush();
  app.event(app.window, 'pagehide');
  assert.equal(app.view.get().matrixLeft, 1800);
  const reload = boot({storage: app.storage, navigation: true}); reload.flush();
  assert.equal(reload.wrap.scrollLeft, 1800);
});
test('touch momentum longer than the input window keeps saving; later resize clamps do not renew it', () => {
  const app = boot({navigation: true}); app.view.update({zoom: 1.38}); app.flush();
  app.event(app.wrap, 'pointerdown', {button: 0, pointerType: 'touch', pointerId: 5, clientX: 400, clientY: 200});
  app.event(app.window, 'pointercancel', {pointerId: 5}); // native panning takes over
  for (let step = 1; step <= 5; step++) { // 2000ms total, each scroll 400ms apart
    app.advance(400); app.wrap.scrollLeft = 360 * step; app.wrap.scrollTop = 200 * step; app.event(app.wrap, 'scroll'); app.flush();
  }
  assert.equal(app.view.get().matrixLeft, 1800); assert.equal(app.view.get().matrixTop, 1000);
  app.event(app.window, 'pagehide');
  assert.equal(app.view.get().matrixLeft, 1800); assert.equal(app.view.get().matrixTop, 1000);
  app.advance(300); app.wrap.clientWidth = 2700; app.resize(); app.flush(); app.event(app.wrap, 'scroll'); app.flush();
  assert.ok(Math.abs(app.wrap.scrollLeft - Math.max(0, app.wrap.scrollWidth - app.wrap.clientWidth)) < 0.01); assert.equal(app.view.get().matrixLeft, 1800);
  app.event(app.window, 'pagehide'); assert.equal(app.view.get().matrixLeft, 1800);
  // The ignored resize scroll must not have renewed the window past the last user save.
  app.advance(400); app.wrap.scrollLeft = 100; app.event(app.wrap, 'scroll'); app.flush(); app.event(app.window, 'pagehide');
  assert.equal(app.view.get().matrixLeft, 1800); assert.equal(app.view.get().matrixTop, 1000);
  const reload = boot({storage: app.storage, navigation: true}); reload.flush();
  assert.equal(reload.wrap.scrollLeft, 1800); assert.equal(reload.wrap.scrollTop, 1000);
});
test('Ctrl and Meta wheel are untouched; Alt wheel changes and persists matrix scale', () => {
  const app = boot({navigation: true}); app.flush(); const before = app.view.get().zoom;
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = app.event(app.wrap, 'wheel', {[modifier]: true, altKey: true, deltaY: -120, clientX: 400, clientY: 200});
    assert.equal(event.defaultPrevented, false); assert.equal(app.view.get().zoom, before);
  }
  const event = app.event(app.wrap, 'wheel', {altKey: true, deltaY: -120, clientX: 400, clientY: 200});
  assert.equal(event.defaultPrevented, true); assert.ok(app.view.get().zoom > before);
  assert.equal(Number(app.storage.get('visual-matrix.one.zoom.v1')), app.view.get().zoom);
});
test('matrix size changes the image dimensions without scaling the table or readable card controls', () => {
  const app = boot({navigation: true}); app.flush();
  assert.equal(app.imageWidth(), 174);
  assert.equal(app.cardWidth(), 174);
  assert.equal(app.document.getElementById('matrix-size').value, '58');
  assert.ok(!app.table.style.zoom || app.table.style.zoom === '1');
  assert.ok(!app.table.style.transform || app.table.style.transform === 'none');
  app.window.MatrixNavigation.setZoom(1);
  assert.equal(app.imageWidth(), 300);
  assert.equal(app.headerWidth, 200);
  app.window.MatrixNavigation.setZoom(0.1);
  assert.equal(app.imageWidth(), 30, 'requested 10% remains an honest image size');
  assert.equal(app.cardWidth(), 124, 'small images keep readable controls');
  assert.ok(!app.table.style.zoom || app.table.style.zoom === '1');
  assert.ok(!app.table.style.transform || app.table.style.transform === 'none');
  const reload = boot({storage: app.storage, navigation: true}); reload.flush();
  assert.equal(reload.view.get().zoom, 0.1);
  assert.equal(reload.imageWidth(), 30);
});
test('reset button and local zero shortcut restore 58% while browser zero shortcuts pass through', () => {
  const app = boot({navigation: true}); app.flush();
  app.window.MatrixNavigation.setZoom(1.4);
  app.event(app.elements['zoom-reset'], 'click');
  assert.equal(app.view.get().zoom, 0.58);
  app.window.MatrixNavigation.setZoom(1.2);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = app.event(app.wrap, 'keydown', { key: '0', [modifier]: true });
    assert.equal(event.defaultPrevented, false);
    assert.equal(app.view.get().zoom, 1.2);
  }
  const event = app.event(app.wrap, 'keydown', { key: '0' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.view.get().zoom, 0.58);
});
test('short matrices retain requested image size without stretching a few columns to fill the viewport', () => {
  const app = boot({navigation: true, columnCount: 2}); app.flush();
  assert.equal(app.imageWidth(), 174);
  assert.equal(parseFloat(app.table.style.width), 200 + 2 * (174 + 16));
  assert.ok(parseFloat(app.table.style.width) < app.wrap.clientWidth);
  assert.equal(app.wrap.scrollLeft, 0);
});
test('fit accounts for fixed labels and cell gutters and is stable across repeated clicks', () => {
  const app = boot({navigation: true, columnCount: 5}); app.wrap.clientWidth = 1400;
  app.window.MatrixNavigation.setZoom(1); app.flush();
  assert.ok(app.wrap.scrollWidth > app.wrap.clientWidth);
  app.event(app.elements['zoom-fit'], 'click');
  assert.ok(app.wrap.scrollWidth <= app.wrap.clientWidth + 1, 'all columns fit when the readable minimum allows it');
  const fitted = app.view.get().zoom;
  assert.ok(fitted > 0.7 && fitted < 0.8, 'fixed header and gutters are excluded from image space');
  app.event(app.elements['zoom-fit'], 'click');
  assert.equal(app.view.get().zoom, fitted);
  app.headers[0].hidden = true; app.headers[1].hidden = true;
  app.event(app.document, 'matrix:filterchange'); app.flush();
  app.event(app.elements['zoom-fit'], 'click');
  assert.equal(app.view.get().zoom, 1, 'fit counts only visible columns');
});
test('blank pointer resize preserves the existing pixel pan rather than scaling scroll extents', () => {
  const app = boot({navigation: true}); app.flush();
  app.view.update({matrixLeft: 500, matrixTop: 800}); app.flush();
  const point = {x: 300, y: 200};
  app.window.MatrixNavigation.setZoom(1, point);
  assert.equal(app.wrap.scrollLeft, 500);
  assert.equal(app.wrap.scrollTop, 800);
  assert.equal(app.view.get().matrixLeft, app.wrap.scrollLeft);
  assert.equal(app.view.get().matrixTop, app.wrap.scrollTop);
});
test('short-grid toolbar and numeric image increases keep the first row below the sticky header', () => {
  const app = boot({navigation: true, columnCount: 1}); app.flush();
  assert.equal(app.view.get().zoom, 0.58);
  app.event(app.elements['zoom-in'], 'click');
  assert.equal(app.view.get().zoom, 0.68);
  assert.equal(app.wrap.scrollTop, 0, '58% to 68% must not scroll the first row under the header');
  assert.equal(app.view.get().matrixTop, 0);
  const size = app.document.getElementById('matrix-size');
  size.valueAsNumber = 100;
  app.event(size, 'change');
  assert.equal(app.view.get().zoom, 1);
  const firstImage = app.createImageAnchor({row: 0, column: 0});
  assert.ok(firstImage.getBoundingClientRect().top >= app.headerHeight);
  app.window.MatrixNavigation.setZoom(0.1);
  for (const scale of [0.58, 1, 1.38, 0.3, 0.58]) {
    app.window.MatrixNavigation.setZoom(scale); app.flush();
    assert.equal(app.wrap.scrollLeft, 0);
    assert.equal(app.wrap.scrollTop, 0);
    assert.ok(firstImage.getBoundingClientRect().top >= app.headerHeight);
  }
  app.wrap.clientHeight = 300; app.resize(); app.flush();
  assert.equal(app.wrap.scrollTop, 0);
  assert.ok(firstImage.getBoundingClientRect().top >= app.headerHeight);
  app.event(app.wrap, 'scroll'); app.flush(); app.event(app.window, 'pagehide');
  const reload = boot({storage: app.storage, navigation: true, columnCount: 1}); reload.flush();
  assert.equal(reload.wrap.scrollTop, 0);
  assert.equal(reload.view.get().matrixTop, 0);
});
test('pointless toolbar changes preserve a nonzero saved pan and persist it across reload', () => {
  const app = boot({navigation: true}); app.flush();
  app.view.update({matrixLeft: 500, matrixTop: 800}); app.flush();
  for (const scale of [0.68, 1, 1.38, 0.58]) {
    app.window.MatrixNavigation.setZoom(scale); app.flush();
    assert.equal(app.wrap.scrollLeft, 500);
    assert.equal(app.wrap.scrollTop, 800);
  }
  const reload = boot({storage: app.storage, navigation: true}); reload.flush();
  assert.equal(reload.wrap.scrollLeft, 500);
  assert.equal(reload.wrap.scrollTop, 800);
});
test('a toolbar shrink clamps pixel pan only when the smaller matrix cannot retain it', () => {
  const app = boot({navigation: true}); app.flush();
  app.view.update({zoom: 1.38, matrixLeft: 2900, matrixTop: 5400}); app.flush();
  assert.equal(app.wrap.scrollLeft, 2900);
  assert.equal(app.wrap.scrollTop, 5400);
  app.window.MatrixNavigation.setZoom(0.1);
  assert.equal(app.wrap.scrollLeft, app.wrap.scrollWidth - app.wrap.clientWidth);
  assert.equal(app.wrap.scrollTop, app.wrap.scrollHeight - app.wrap.clientHeight);
  assert.equal(app.view.get().matrixLeft, app.wrap.scrollLeft);
  assert.equal(app.view.get().matrixTop, app.wrap.scrollTop);
});
test('explicit image anchoring pins an existing top or left edge while preserving the other axis', () => {
  const top = boot({navigation: true}); top.flush();
  top.view.update({matrixLeft: 400}); top.flush();
  const firstRowImage = top.createImageAnchor({row: 0, column: 3});
  const beforeTop = firstRowImage.getBoundingClientRect();
  const topPoint = {x: beforeTop.left + beforeTop.width / 2, y: beforeTop.top + beforeTop.height / 2};
  top.window.MatrixNavigation.setZoom(1, topPoint);
  assert.equal(top.wrap.scrollTop, 0);
  assert.equal(top.view.get().matrixTop, 0);
  assert.ok(firstRowImage.getBoundingClientRect().top >= top.headerHeight);
  const afterTop = firstRowImage.getBoundingClientRect();
  assert.ok(Math.abs((topPoint.x - afterTop.left) / afterTop.width - 0.5) < 0.00001, 'nonzero horizontal pan still anchors');

  const left = boot({navigation: true}); left.flush();
  left.view.update({matrixTop: 800}); left.flush();
  const firstColumnImage = left.createImageAnchor({row: 4, column: 0});
  const beforeLeft = firstColumnImage.getBoundingClientRect();
  const leftPoint = {x: beforeLeft.left + beforeLeft.width / 2, y: beforeLeft.top + beforeLeft.height / 2};
  left.window.MatrixNavigation.setZoom(1, leftPoint);
  assert.equal(left.wrap.scrollLeft, 0);
  assert.equal(left.view.get().matrixLeft, 0);
  const afterLeft = firstColumnImage.getBoundingClientRect();
  assert.ok(Math.abs((leftPoint.y - afterLeft.top) / afterLeft.height - 0.5) < 0.00001, 'nonzero vertical pan still anchors');
});
test('explicit pointer over the sticky header preserves the current pixel pan', () => {
  const app = boot({navigation: true}); app.flush();
  app.view.update({matrixLeft: 500, matrixTop: 800}); app.flush();
  app.document.elementFromPoint = () => app.table.tHead.rows[0].cells[0];
  app.window.MatrixNavigation.setZoom(1, {x: 300, y: 20});
  assert.equal(app.wrap.scrollLeft, 500);
  assert.equal(app.wrap.scrollTop, 800);
  assert.equal(app.view.get().matrixLeft, 500);
  assert.equal(app.view.get().matrixTop, 800);
});
test('image resizing preserves the fraction under the pointer within its row and column', () => {
  const app = boot({navigation: true}); app.flush();
  const anchor = app.createImageAnchor({row: 4, column: 3});
  const pointer = { x: 350, y: 200 }, wanted = { x: 0.3, y: 0.4 };
  const initial = anchor.getBoundingClientRect();
  app.view.update({matrixLeft: initial.left + initial.width * wanted.x - pointer.x, matrixTop: initial.top + initial.height * wanted.y - pointer.y}); app.flush();
  app.window.MatrixNavigation.setZoom(1, pointer);
  const resized = anchor.getBoundingClientRect();
  assert.ok(Math.abs((pointer.x - resized.left) / resized.width - wanted.x) < 0.00001);
  assert.ok(Math.abs((pointer.y - resized.top) / resized.height - wanted.y) < 0.00001);
  assert.equal(app.view.get().matrixLeft, app.wrap.scrollLeft);
  assert.equal(app.view.get().matrixTop, app.wrap.scrollTop);
});
test('right drag persists the point; stationary context click remains available', () => {
  const app = boot({navigation: true}); app.flush();
  app.event(app.wrap, 'pointerdown', {button: 2, pointerType: 'mouse', pointerId: 1, clientX: 500, clientY: 200});
  app.event(app.window, 'pointermove', {buttons: 2, pointerId: 1, clientX: 300, clientY: 140});
  app.event(app.window, 'pointerup', {button: 2, pointerId: 1}); app.flush();
  assert.equal(app.view.get().matrixLeft, 200); assert.equal(app.view.get().matrixTop, 60);
  assert.equal(app.event(app.wrap, 'contextmenu').defaultPrevented, true);
  app.advance(700); app.event(app.wrap, 'pointerdown', {button: 2, pointerType: 'mouse', pointerId: 2, clientX: 100, clientY: 100});
  app.event(app.window, 'pointerup', {button: 2, pointerId: 2});
  assert.equal(app.event(app.wrap, 'contextmenu').defaultPrevented, false);
});

// Exercise the actual gallery with a different domain so schema or wording
// regressions cannot hide behind the original styling demo.
function bootGallery() {
  const created = [];
  class GalleryElement extends Emitter {
    constructor(tag = 'div') {
      super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.hidden = false;
      this.style = {setProperty(name, value) { this[name] = value; }};
      this.scrollWidth = 1200; this.clientWidth = 800; this.open = false; this.isConnected = true;
      this._text = ''; this.className = ''; created.push(this);
      this.classList = {
        toggle: (name, on) => {
          const classes = new Set(this.className.split(/\s+/).filter(Boolean));
          if (on === undefined ? !classes.has(name) : on) classes.add(name); else classes.delete(name);
          this.className = [...classes].join(' ');
        },
        contains: name => this.className.split(/\s+/).includes(name),
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
      };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { this.children.push(...children); children.forEach(child => { child.parentNode = this; }); }
    prepend(...children) { this.children.unshift(...children); }
    before() {} after() {}
    click() { this.dispatchEvent({type: 'click', target: this, currentTarget: this}); }
    replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
    setAttribute(name, value) { this[name] = String(value); }
    querySelector(selector) {
      for (const child of this.children) {
        const match = selector.startsWith('.') ? child.className?.split(/\s+/).includes(selector.slice(1)) : child.tagName === selector.toUpperCase();
        if (match) return child;
        const found = child.querySelector?.(selector); if (found) return found;
      }
      return null;
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        const match = selector.startsWith('.') ? child.className?.split(/\s+/).includes(selector.slice(1)) : child.tagName === selector.toUpperCase();
        if (match) result.push(child);
        result.push(...(child.querySelectorAll?.(selector) || []));
      }
      return result;
    }
    getAttribute(name) { return this[name] ?? null; }
    removeAttribute(name) { delete this[name]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent({type: 'close'}); }
    focus() { document.activeElement = this; }
  }
  const document = new Emitter(), window = new Emitter();
  const ids = ['empty-state', 'matrix', 'matrix-wrap', 'scroll-hint-text', 'scroll-hint', 'viewer', 'ready-count', 'progress-description', 'remaining-count', 'announcement', 'compare-button', 'compare-tray', 'selected-list', 'viewer-kicker', 'viewer-title', 'viewer-content', 'viewer-mode-description', 'face-detail-button', 'full-portrait-button', 'close-viewer', 'close-viewer-bottom', 'clear-selection', 'updated-at'];
  const elements = Object.fromEntries(ids.map(id => [id, new GalleryElement()]));
  elements.matrix.tagName = 'TABLE'; elements.viewer.tagName = 'DIALOG'; elements.matrix.append(new GalleryElement('caption'));
  document.body = new GalleryElement('body'); document.documentElement = new GalleryElement('html'); document.activeElement = document.body;
  document.getElementById = id => elements[id]; document.createElement = tag => new GalleryElement(tag);
  document.createTextNode = value => { const text = new GalleryElement('#text'); text.textContent = value; return text; };
  const data = {
    meta: {id: 'color-form'}, rows: [{id: 'circle', name: 'Circle', source: 'guides/circle.png'}, {id: 'square', name: 'Square'}],
    columns: [{id: 'red', name: 'Red'}, {id: 'blue', name: 'Blue'}],
    cells: [
      {id: 'one', row: 'circle', column: 'red', status: 'ready', src: 'assets/circle-red.png'},
      {id: 'two', row: 'circle', column: 'blue', status: 'ready', src: 'assets/circle-blue.png'},
      {id: 'three', row: 'square', column: 'red', status: 'pending'},
      {id: 'four', row: 'square', column: 'blue', status: 'pending'}
    ]
  };
  let project = {rowsLabel: 'Shape', columnsLabel: 'Color'};
  window.MATRIX_DATA = data; window.ProjectStore = {get: () => project};
  const CustomEvent = class { constructor(type, config = {}) { this.type = type; this.detail = config.detail; } };
  const context = vm.createContext({window, document, CustomEvent});
  vm.runInContext(source('gallery.js'), context);
  return {app: window.MATRIX_APP, elements, document, context, window, created, GalleryElement, event: (target, type) => target.dispatchEvent({type}),
    relabel: next => { project = next; document.dispatchEvent(new CustomEvent('studio:change', {detail: {project}})); }};
}
test('gallery renders canonical option axes and updates project labels during the session', () => {
  const {app, elements, relabel} = bootGallery();
  assert.equal(app.rows.get('circle').name, 'Circle'); assert.equal(app.columns.get('blue').name, 'Blue');
  assert.deepEqual({...app.names(app.cells.get('one'))}, {row: 'Circle', column: 'Red'});
  assert.equal(app.describe(app.cells.get('two')), 'Circle · Blue');
  assert.equal(elements.matrix.style['--column-count'], 2); assert.equal(elements['ready-count'].textContent, '2 / 4');
  assert.match(elements.matrix.querySelector('caption').textContent, /Shape in rows, Color in columns/);
  assert.equal(elements.matrix.querySelector('.reference').alt, 'Circle — Reference image');
  relabel({rowsLabel: 'Product', columnsLabel: 'Finish'});
  assert.equal(elements.matrix.querySelector('.corner').textContent, 'Product ↓Finish →');
  assert.equal(elements['matrix-wrap']['aria-label'], 'Product and Finish comparison table');
  assert.equal(elements['scroll-hint-text'].textContent, 'Scroll sideways to explore all 2 columns (Finish)');
  assert.match(elements.matrix.querySelector('caption').textContent, /Product in rows, Finish in columns/);
});
test('rows with no optional reference show their label without a missing-reference placeholder', () => {
  const { elements, created } = bootGallery();
  const row = created.find(node => node.dataset.rowId === 'square');
  assert.equal(row.children[0].textContent, 'Square');
  assert.equal(row.children[0].querySelector('.reference'), null);
  assert.equal(elements.matrix.querySelector('.guide-pending'), null);
  assert.equal(elements.matrix.querySelector('.reference').alt, 'Circle — Reference image');
});
test('any dataset can open full images, inspect details and compare its options', () => {
  const {app, elements, event} = bootGallery();
  app.openViewer([app.cells.get('one')]);
  assert.equal(elements.viewer.open, true); assert.equal(elements['viewer-kicker'].textContent, 'IMAGE VIEW');
  assert.equal(elements['full-portrait-button']['aria-pressed'], 'true');
  assert.equal(elements['viewer-content'].querySelector('img').alt, 'Circle · Red full image');
  event(elements['face-detail-button'], 'click');
  assert.equal(elements['face-detail-button']['aria-pressed'], 'true');
  assert.equal(elements['viewer-mode-description'].textContent, 'Closer view of the image');
  app.toggleSelection(app.cells.get('one')); app.toggleSelection(app.cells.get('two'));
  assert.equal(elements['compare-button'].disabled, false); assert.equal(elements['compare-tray'].hidden, false);
  event(elements['compare-button'], 'click');
  assert.equal(app.getViewerCells().length, 2); assert.equal(elements['viewer-kicker'].textContent, 'SIDE BY SIDE');
  assert.match(elements['announcement'].textContent, /2 of 2 options selected/);
});
test('unavailable option images leave counts, comparison and readiness consistent', () => {
  const {app, elements, event} = bootGallery();
  const cell = app.cells.get('one'); app.toggleSelection(cell);
  event(app.cards.get(cell.id).querySelector('img'), 'error');
  assert.equal(app.isReady(cell), false); assert.equal(app.cards.has(cell.id), false);
  assert.equal(app.selected.size, 0); assert.equal(elements['compare-tray'].hidden, true);
  assert.equal(elements['ready-count'].textContent, '1 / 4');
  assert.match(elements.matrix.textContent, /Image unavailable/);
});
test('unfiltered gallery shows pending options with image and compare actions disabled', () => {
  const gallery = bootGallery(), {app, elements, context, window, document, created, GalleryElement} = gallery;
  const anchors = Object.fromEntries(['.title-line', '.subtitle', '.fav-switch button:first-child', '.fav-switch button:last-child'].map(selector => [selector, new GalleryElement()]));
  for (const id of ['matrix-navigation', 'fav-bar', 'decision-controls', 'studio-toolbar', 'studio-tools-disclosure']) elements[id] = new GalleryElement();
  document.querySelector = selector => anchors[selector] || null;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.createElementNS = (ns, tag) => new GalleryElement(tag);
  let filtering = false;
  context.StudioDecisions = window.StudioDecisions = {matches: id => app.isReady(app.cells.get(id)), isFiltering: () => filtering,
    get: () => ({status: 'unreviewed'}), label: () => 'Unreviewed'};
  context.MatrixFavorites = window.MatrixFavorites = {has: () => false, visibleIds: () => [], getScope: () => ({type: 'favorites'})};
  context.ProjectStore = window.ProjectStore;
  context.location = {search: ''}; context.URLSearchParams = URLSearchParams;
  context.matchMedia = () => ({matches: false, addEventListener() {}}); context.requestAnimationFrame = callback => callback();
  vm.runInContext(source('presentation.js'), context);
  const cards = created.filter(node => node.className === 'look-card');
  assert.equal(cards.length, 4); assert.equal(cards.filter(card => !card.hidden).length, 4);
  for (const card of cards.filter(node => ['three', 'four'].includes(node.dataset.lookId))) {
    assert.equal(card.querySelector('.look-open').disabled, true); assert.equal(card.querySelector('.look-select'), null);
    assert.equal(card.querySelector('.look-star').hidden, true); assert.match(card.textContent, /Awaiting image/);
  }
  assert.equal(created.find(node => node.className === 'look-empty').hidden, true);
  filtering = true; window.StudioPresentation.setView('gallery');
  assert.equal(cards.filter(card => !card.hidden).length, 2, 'active review filters still narrow the ready options');
});
