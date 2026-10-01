'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateProject } = require('../project-store.js');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const native = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA';
function project(withMetadata = true) {
  return validateProject({
    schemaVersion: 2, id: 'shades', title: 'Product shades', rowsLabel: 'Products', columnsLabel: 'Shades',
    data: {
      rows: [{ id: 'cream', name: 'Colour cream', ...(withMetadata ? { attributes: { material: 'cream', volume_ml: 60, ammoniaFree: false } } : {}) }],
      columns: [{ id: 'denim', name: 'Denim blue', ...(withMetadata ? { source: 'guides/denim.png', referenceCaption: 'My colour swatch', attributes: { hex: '#507DB5' } } : {}) }, { id: 'wine', name: 'Wine red' }],
      cells: [{ id: 'cream-denim', row: 'cream', column: 'denim', status: 'ready', src: PNG, ...(withMetadata ? { attributes: { price: 0, ingredients: 'No added fragrance', label: '<img src=x onerror=alert(1)>', unavailable: null } } : {}) }, { id: 'cream-wine', row: 'cream', column: 'wine', status: 'ready', src: PNG, ...(withMetadata ? { attributes: { hex: '#682C40' } } : {}) }]
    }
  });
}
function generation() {
  const window = {}, document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(source('generation.js'), { window, document });
  return window.StudioGeneration;
}
class Emitter {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); return true; }
}
class Node extends Emitter {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.hidden = false; this.open = false; this.isConnected = true;
    this.style = { setProperty(name, value) { this[name] = value; } }; this.scrollWidth = 1200; this.clientWidth = 800; this.className = ''; this._text = '';
    this.classList = {
      toggle: (name, on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (on === undefined ? !names.has(name) : on) names.add(name); else names.delete(name); this.className = [...names].join(' '); },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  setAttribute(name, value) { this[name] = String(value); }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className.split(/\s+/).includes(selector.slice(1)) : child.tagName === selector.toUpperCase()) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
  focus() {}
}
function gallery(input) {
  const document = new Emitter(), window = new Emitter();
  const ids = ['empty-state', 'matrix', 'matrix-wrap', 'scroll-hint-text', 'scroll-hint', 'viewer', 'ready-count', 'progress-description', 'remaining-count', 'announcement', 'compare-button', 'compare-tray', 'selected-list', 'viewer-kicker', 'viewer-title', 'viewer-content', 'viewer-mode-description', 'face-detail-button', 'full-portrait-button', 'close-viewer', 'close-viewer-bottom', 'clear-selection', 'updated-at'];
  const elements = Object.fromEntries(ids.map(id => [id, new Node()]));
  elements.matrix.append(new Node('caption')); document.body = new Node('body'); document.activeElement = document.body;
  document.getElementById = id => elements[id]; document.createElement = tag => new Node(tag);
  document.createTextNode = value => { const node = new Node('#text'); node.textContent = value; return node; };
  window.MATRIX_DATA = input.data; window.ProjectStore = { get: () => input };
  const CustomEvent = class { constructor(type, config = {}) { this.type = type; this.detail = config.detail; } };
  vm.runInNewContext(source('gallery.js'), { window, document, CustomEvent });
  return { app: window.MATRIX_APP, elements };
}

test('AI briefs include axis and option specifications as independent data and readable text', () => {
  const input = project(), before = JSON.stringify(input), api = generation();
  const brief = api.makeBriefData(input, ['cream-denim'], 'Same packaging');
  assert.deepEqual(native(brief.items[0].row.attributes), input.data.rows[0].attributes);
  assert.deepEqual(native(brief.items[0].column.attributes), input.data.columns[0].attributes);
  assert.deepEqual(native(brief.items[0].attributes), input.data.cells[0].attributes);
  assert.equal(JSON.stringify(input), before);
  brief.items[0].row.attributes.volume_ml = 100;
  brief.items[0].column.attributes.hex = '#000000';
  brief.items[0].attributes.price = 20;
  assert.equal(JSON.stringify(input), before);
  const text = api.makeBrief(input, ['cream-denim'], 'Same packaging');
  for (const expected of ['Products specifications:', 'material: cream', 'volume_ml: 60', 'ammoniaFree: false', 'Shades specifications:', 'hex: #507DB5', 'This option specifications:', 'price: 0', 'ingredients: No added fragrance', 'unavailable: Not specified']) assert.ok(text.includes(expected), expected);
});

test('viewer groups specifications under active axis labels and uses literal text for imported fields', () => {
  const input = project(), before = JSON.stringify(input), { app, elements } = gallery(input);
  app.openViewer([app.cells.get('cream-denim')]);
  const details = elements['viewer-content'].querySelector('details');
  assert.equal(details.querySelector('summary').textContent, 'Specifications');
  const groups = details.querySelectorAll('.metadata-group');
  assert.deepEqual(groups.map(group => group.querySelector('strong').textContent), ['Products', 'Shades', 'This option']);
  assert.deepEqual(groups[0].querySelectorAll('dd').map(node => node.textContent), ['cream', '60', 'false']);
  assert.deepEqual(groups[2].querySelectorAll('dd').map(node => node.textContent), ['0', 'No added fragrance', '<img src=x onerror=alert(1)>', 'Not specified']);
  assert.equal(details.querySelector('img'), null);
  assert.equal(details.querySelectorAll('dd')[0].style.overflowWrap, 'anywhere');
  assert.equal(JSON.stringify(input), before);
  input.rowsLabel = 'Materials'; input.columnsLabel = 'Finishes';
  app.openViewer([app.cells.get('cream-denim'), app.cells.get('cream-wine')]);
  const specifications = elements['viewer-content'].querySelectorAll('details');
  assert.equal(specifications.length, 2);
  assert.equal(specifications[0].querySelector('strong').textContent, 'Materials');
  assert.ok(specifications[0].textContent.includes('#507DB5'));
  assert.ok(specifications[1].textContent.includes('#682C40'));
});

test('column references render compact images with their own accessible captions', () => {
  const { elements } = gallery(project());
  const column = elements.matrix.querySelector('thead').querySelectorAll('th')[1];
  const reference = column.querySelector('img');
  assert.equal(reference.src, 'guides/denim.png');
  assert.equal(reference.alt, 'Denim blue — My colour swatch');
  assert.equal(reference.style.width, '65px'); assert.equal(reference.style.height, '65px');
  assert.equal(reference.loading, 'lazy');
  assert.equal(column.querySelector('.reference-caption').textContent, 'My colour swatch');
});

test('datasets without metadata preserve their existing viewer layout and AI output fields', () => {
  const input = project(false), { app, elements } = gallery(input), api = generation();
  app.openViewer([app.cells.get('cream-denim')]);
  const caption = elements['viewer-content'].querySelector('figcaption');
  assert.equal(caption.children.length, 2); assert.equal(caption.querySelector('details'), null);
  assert.equal(elements.matrix.querySelector('thead').querySelector('img'), null);
  const item = api.makeBriefData(input, ['cream-denim'], '').items[0];
  assert.equal(Object.hasOwn(item.row, 'attributes'), false); assert.equal(Object.hasOwn(item.column, 'attributes'), false); assert.equal(Object.hasOwn(item, 'attributes'), false);
  assert.ok(!api.makeBrief(input, ['cream-denim'], '').includes('specifications:'));
});
