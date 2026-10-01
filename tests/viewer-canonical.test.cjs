'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class Node {
  constructor(tag = 'div', className = '') {
    this.tagName = tag;
    this.className = className;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim(); }
    };
  }
  append(...nodes) { for (const node of nodes) { this.children.push(node); if (node instanceof Node) node.parentElement = this; } }
  before(node) { const list = this.parentElement.children; list.splice(list.indexOf(this), 0, node); node.parentElement = this.parentElement; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || ''; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  fire(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
  querySelectorAll(selector) {
    const result = [];
    const matches = node => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector;
    for (const child of this.children) if (child instanceof Node) {
      if (matches(child)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function text(node) { return node.textContent || node.children.map(child => child instanceof Node ? text(child) : child).join(''); }
function harness() {
  const viewer = new Node('dialog');
  viewer.open = true;
  const content = new Node();
  viewer.append(content);
  const byId = new Map([['viewer', viewer], ['viewer-content', content]]);
  const events = new Node();
  const document = {
    activeElement: null,
    getElementById: id => byId.get(id) || viewer.querySelectorAll('button').find(node => node.id === id) || viewer.querySelectorAll('p').find(node => node.id === id),
    createElement: tag => new Node(tag),
    addEventListener: (...args) => events.addEventListener(...args)
  };
  const rows = [{ id: 'oak', name: 'Oak' }, { id: 'steel', name: 'Steel' }];
  const columns = [{ id: 'matte', name: 'Matte' }, { id: 'gloss', name: 'Gloss' }];
  const cells = [
    { id: 'steel-gloss', row: 'steel', column: 'gloss', status: 'ready', src: 'assets/steel-gloss.png' },
    { id: 'oak-gloss', row: 'oak', column: 'gloss', status: 'ready', src: 'assets/oak-gloss.png' },
    { id: 'oak-matte', row: 'oak', column: 'matte', status: 'ready', src: 'assets/oak-matte.png' }
  ];
  let shown = [];
  const app = {
    data: { rows, columns, cells },
    rows: new Map(rows.map(row => [row.id, row])), columns: new Map(columns.map(column => [column.id, column])),
    getViewerCells: () => shown,
    openViewer(chosen) {
      shown = chosen;
      content.replaceChildren(...chosen.map(cell => {
        const figure = new Node('figure', 'viewer-figure');
        const img = new Node('img');
        img.setAttribute('src', cell.src);
        figure.append(img);
        return figure;
      }));
    }
  };
  const window = { MATRIX_APP: app, location: { protocol: 'http:' }, ProjectStore: { get: () => ({ rowsLabel: 'Materials', columnsLabel: 'Finishes' }) } };
  new Function('window', 'document', 'Element', 'HTMLElement', fs.readFileSync(path.join(__dirname, '../viewer-enhancements.js'), 'utf8'))(window, document, Node, Node);
  function open(ids) { app.openViewer(ids.map(id => cells.find(cell => cell.id === id))); events.fire('matrix:vieweropen', { detail: { ids } }); }
  return { viewer, content, document, open, get shown() { return shown; } };
}

test('canonical viewer compares shared axes and uses custom names for saved images', () => {
  const h = harness();
  h.open(['oak-matte', 'oak-gloss']);
  assert.equal(text(h.document.getElementById('vex-relation')), 'Same materials · compare finishesOak: Matte on the left, Gloss on the right');
  assert.deepEqual(h.content.querySelectorAll('.vex-save').map(node => node.download), ['oak--matte.png', 'oak--gloss.png']);
  h.open(['oak-gloss', 'steel-gloss']);
  assert.match(text(h.document.getElementById('vex-relation')), /Gloss: Oak on the left, Steel on the right/);
  h.open(['oak-matte', 'steel-gloss']);
  assert.match(text(h.document.getElementById('vex-relation')), /Both variables differ/);
});

test('canonical viewer browses matrix order rather than incoming cell order', () => {
  const h = harness();
  h.open(['oak-matte']);
  h.document.getElementById('vex-next').fire('click');
  assert.deepEqual(h.shown.map(cell => cell.id), ['oak-gloss']);
  h.document.getElementById('vex-next').fire('click');
  assert.deepEqual(h.shown.map(cell => cell.id), ['steel-gloss']);
  h.document.getElementById('vex-next').fire('click');
  assert.deepEqual(h.shown.map(cell => cell.id), ['oak-matte']);
  assert.match(text(h.document.getElementById('vex-position')), /1 of 3All ready options/);
});
