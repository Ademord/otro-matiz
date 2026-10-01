'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

class Emitter {
  constructor() { this.listeners = new Map(); this.capturing = new Set(); }
  addEventListener(type, callback, options) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); if (options === true || options?.capture) this.capturing.add(callback); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); return !event.defaultPrevented; }
}

function dataset(rowCount, columnCount) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}`, name: `Form ${i + 1}` }));
  const columns = Array.from({ length: columnCount }, (_, i) => ({ id: `c${i}`, name: `Finish ${i + 1}` }));
  return { meta: { id: 'generic-gallery' }, rows, columns,
    cells: rows.flatMap(row => columns.map(column => ({ id: `${row.id}-${column.id}`, row: row.id, column: column.id,
      status: 'ready', src: `assets/${row.id}-${column.id}.png` }))) };
}

function boot(data, preferences = {}, actualFavorites = false, search = '', embedded = false) {
  const document = new Emitter(), window = new Emitter(), frames = [], created = [];
  class Node extends Emitter {
    constructor(tag = 'div') {
      super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this._text = '';
      this.hidden = false; this.disabled = false; this.open = false; this.isConnected = true; this.attributes = {};
      this.validity = {valid: true};
      this.scrollWidth = 1200; this.clientWidth = 800; this.scrollLeft = this.scrollTop = 0; this.namespaceURI = 'http://www.w3.org/2000/svg';
      this.style = { setProperty(name, value) { this[name] = String(value); }, getPropertyValue(name) { return this[name] || ''; } };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (force === undefined ? !set.has(name) : force) set.add(name); else set.delete(name); this.className = [...set].join(' '); },
        add: (...names) => names.forEach(name => this.classList.toggle(name, true)),
        remove: (...names) => names.forEach(name => this.classList.toggle(name, false))
      };
      created.push(this);
    }
    set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentElement = null; }); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(html) {
      this.replaceChildren(); const stack = [this], voidTags = new Set(['INPUT', 'IMG', 'BR', 'HR', 'META', 'LINK']);
      for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { const node = new Node('#text'); node.textContent = token; stack.at(-1).append(node); continue; }
        const match = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/); if (!match) continue;
        const node = new Node(match[1]);
        for (const attribute of match[2].matchAll(/([\w-]+)(?:\s*=\s*(["'])(.*?)\2)?/g)) node.setAttribute(attribute[1], attribute[3] ?? '');
        stack.at(-1).append(node); if (!voidTags.has(node.tagName) && !token.endsWith('/>')) stack.push(node);
      }
    }
    append(...children) { children.forEach(child => { if (typeof child === 'string') { const node = new Node('#text'); node.textContent = child; child = node; } child.remove(); this.children.push(child); child.parentElement = this; }); }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    insertBefore(node, reference) { if (node === reference) return; if (!reference) { this.append(node); return; } node.remove(); this.children.splice(this.children.indexOf(reference), 0, node); node.parentElement = this; }
    prepend(...children) { children.reverse().forEach(child => { child.remove(); this.children.unshift(child); child.parentElement = this; }); }
    remove() { const list = this.parentElement?.children; if (list) list.splice(list.indexOf(this), 1); this.parentElement = null; }
    replaceWith(node) { this.before(node); this.remove(); }
    before(node) { if (!this.parentElement) return; const parent = this.parentElement; node.remove(); parent.children.splice(parent.children.indexOf(this), 0, node); node.parentElement = parent; }
    after(node) { if (!this.parentElement) return; const parent = this.parentElement; node.remove(); parent.children.splice(parent.children.indexOf(this) + 1, 0, node); node.parentElement = parent; }
    replaceChildren(...children) { this.textContent = ''; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); else if (['id', 'src', 'type', 'value'].includes(name)) this[name] = String(value); }
    getAttribute(name) { if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null; return this.attributes[name] ?? this[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
      const not = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
      selector = selector.replace(/:not\([^)]+\)/g, '');
      if (not.some(part => this.matches(part))) return false;
      if (selector.includes(':disabled') && !this.disabled) return false;
      if (selector.includes(':first-child') && this.parentElement?.children[0] !== this) return false;
      if (selector.includes(':last-child') && this.parentElement?.children.at(-1) !== this) return false;
      selector = selector.replace(/:(disabled|first-child|last-child)/g, '');
      const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
      for (const match of selector.matchAll(/#([\w-]+)/g)) if (this.id !== match[1]) return false;
      for (const match of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
        const actual = match[1] === 'hidden' ? this.hidden : match[1] === 'open' ? this.open : this.getAttribute(match[1]);
        if (match[2] !== undefined ? String(actual) !== match[2] : !actual) return false;
      }
      return true;
    }
    querySelectorAll(selector) {
      const alternatives = selector.split(',').map(value => value.trim().split(/\s+/));
      const match = node => alternatives.some(parts => {
        if (!node.matches(parts.at(-1))) return false;
        let ancestor = node.parentElement;
        for (let i = parts.length - 2; i >= 0; i--) { while (ancestor && !ancestor.matches(parts[i])) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; }
        return true;
      });
      const result = [];
      const visit = node => node.children.forEach(child => { if (match(child)) result.push(child); visit(child); });
      visit(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (selector.split(',').some(part => node.matches(part.trim()))) return node; return null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    getClientRects() {
      const focusedIntro = this.classList.contains('intro') && document.body.classList.contains('wv-density') && document.body.classList.contains('wv-focus');
      const closedDetailsContent = this.parentElement?.tagName === 'DETAILS' && !this.parentElement.open && this.tagName !== 'SUMMARY';
      return this.hidden || focusedIntro || closedDetailsContent || this.tagName === 'DIALOG' && !this.open || this.parentElement && !this.parentElement.getClientRects().length ? [] : [{}];
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
    focus() { document.activeElement = this; }
    click() {
      if (this.disabled) return;
      const event = {type: 'click', target: this, currentTarget: document, defaultPrevented: false, stopped: false, immediate: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = this.stopped = true; }};
      for (const callback of document.listeners.get('click') || []) { if (document.capturing.has(callback)) callback(event); if (event.immediate) return; }
      if (event.stopped) return;
      for (let node = this; node; node = node.parentElement) {
        event.currentTarget = node;
        for (const callback of node.listeners.get('click') || []) { callback(event); if (event.immediate) return; }
        if (event.stopped) return;
      }
      event.currentTarget = document;
      for (const callback of document.listeners.get('click') || []) { if (!document.capturing.has(callback)) callback(event); if (event.immediate) return; }
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
  }
  document.body = new Node('body'); document.documentElement = new Node('html'); document.documentElement.append(document.body); document.activeElement = document.body;
  document.createElement = tag => new Node(tag); document.createElementNS = (_, tag) => new Node(tag);
  document.createTextNode = value => { const node = new Node('#text'); node.textContent = value; return node; };
  document.getElementById = id => document.body.querySelector(`#${id}`);
  document.querySelector = selector => document.body.querySelector(selector);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  const ids = ['empty-state', 'matrix', 'matrix-wrap', 'scroll-hint-text', 'scroll-hint', 'viewer', 'ready-count', 'progress-description', 'remaining-count', 'announcement', 'compare-button', 'compare-tray', 'selected-list', 'viewer-kicker', 'viewer-title', 'viewer-content', 'viewer-mode-description', 'face-detail-button', 'full-portrait-button', 'close-viewer', 'close-viewer-bottom', 'clear-selection', 'updated-at', 'matrix-navigation', 'fav-bar', 'decision-controls', 'studio-toolbar', 'studio-tools-disclosure'];
  const elements = Object.fromEntries(ids.map(id => { const node = new Node(id === 'viewer' ? 'dialog' : id === 'matrix' ? 'table' : id === 'studio-tools-disclosure' ? 'details' : 'div'); node.id = id; document.body.append(node); return [id, node]; }));
  elements['matrix-wrap'].append(elements.matrix);
  elements.viewer.append(...['viewer-kicker', 'viewer-title', 'viewer-content', 'viewer-mode-description', 'face-detail-button', 'full-portrait-button', 'close-viewer', 'close-viewer-bottom'].map(id => elements[id]));
  if (actualFavorites) elements['fav-bar'].remove();
  elements.matrix.append(new Node('caption'));
  const intro = new Node('header'); intro.className = 'intro'; document.body.prepend(intro);
  const title = new Node('div'); title.className = 'title-line'; intro.append(elements['studio-toolbar'], title);
  const subtitle = new Node('p'); subtitle.className = 'subtitle'; intro.append(subtitle);
  const switchForm = new Node('form'); switchForm.id = 'ws-switch-form';
  const switchSelect = new Node('select'); switchSelect.id = 'ws-switch-select'; switchForm.append(switchSelect);
  const newButton = new Node('button'); newButton.id = 'ws-new-open'; newButton.textContent = 'New project';
  elements['studio-toolbar'].append(switchForm, newButton);
  const settings = new Node('details'); settings.id = 'ws-settings';
  const settingsSummary = new Node('summary'); settingsSummary.textContent = 'Project settings'; settings.append(settingsSummary);
  elements['studio-tools-disclosure'].append(settings);
  const switcher = new Node('div'); switcher.className = 'fav-switch'; const all = new Node('button'), favoritesButton = new Node('button'); switcher.append(all, favoritesButton); elements['fav-bar'].append(switcher);
  const idsForFavorites = data.cells.filter(cell => cell.status === 'ready').map(cell => cell.id);
  const project = { id: 'generic-gallery', title: 'Material study', goal: '', rowsLabel: 'Forms', columnsLabel: 'Finishes', data,
    favorites: actualFavorites ? idsForFavorites.slice() : [], lists: actualFavorites ? [{id: 'review', name: 'Review', cellIds: idsForFavorites.slice()}] : [] };
  const storage = new Map([[`visual-matrix.${data.meta.id}.workspace.v1`, JSON.stringify(preferences)]]);
  const CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } };
  const dispatch = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));
  const calls = { favorites: [], decisions: [], viewers: [], projectUpdates: 0 }, favoriteIds = new Set(), decisionValues = new Map();
  let filtering = false, matched = null, favoritesActive = false;
  const favorites = { has: id => favoriteIds.has(id), toggle(id) { calls.favorites.push(id); favoriteIds.has(id) ? favoriteIds.delete(id) : favoriteIds.add(id); dispatch('matrix:favoriteschange'); },
    visibleIds: () => [...favoriteIds], getScope: () => ({ type: 'favorites', ids: [...favoriteIds] }), isActive: () => favoritesActive,
    openInbox() { favoritesActive = true; dispatch('matrix:filterchange'); }, openList: () => false };
  const decisions = { isFiltering: () => filtering, matches: id => matched?.has(id) ?? true, get: id => ({ status: decisionValues.get(id) || 'unreviewed' }),
    label: value => ({ unreviewed: 'Unreviewed', preferred: 'Preferred', rejected: 'Rejected' })[value] || value,
    open: id => calls.decisions.push(id), resetFilters() { filtering = false; matched = null; dispatch('studio:decisionfilter'); } };
  all.addEventListener('click', () => { favoritesActive = false; }); favoritesButton.addEventListener('click', () => { favoritesActive = true; });
  window.parent = embedded ? {} : window; window.location = {protocol: 'http:', search}; window.MATRIX_DATA = data; window.ProjectStore = { get: () => project, status: () => ({persistent: true}),
    async update(mutate) { calls.projectUpdates++; const patch = typeof mutate === 'function' ? mutate(project) : mutate; Object.assign(project, patch); return project; } };
  window.MatrixFavorites = favorites; window.StudioDecisions = decisions;
  const context = vm.createContext({ window, document, Element: Node, HTMLElement: Node, HTMLImageElement: Node, CSS: {escape: value => String(value)}, URLSearchParams, location: window.location, CustomEvent,
    ProjectStore: window.ProjectStore, MatrixFavorites: favorites, StudioDecisions: decisions,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: callback => frames.push(callback),
    addEventListener: (...args) => window.addEventListener(...args), setTimeout, clearTimeout, innerHeight: 800,
    StudioPresentation: null });
  vm.runInContext(source('workspace-view.js'), context);
  vm.runInContext(source('gallery.js'), context);
  const originalApp = window.MATRIX_APP;
  const app = window.MATRIX_APP = { ...originalApp, openViewer(cells, opener) { calls.viewers.push(Array.from(cells, cell => cell.id)); originalApp.openViewer(cells, opener); } };
  if (actualFavorites) {
    vm.runInContext(source('lists-store.js'), context);
    vm.runInContext(source('favorites.js'), context);
    context.MatrixFavorites = window.MatrixFavorites;
  }
  vm.runInContext(source('viewer-enhancements.js'), context);
  vm.runInContext(source('presentation.js'), context);
  context.StudioPresentation = window.StudioPresentation;
  const flush = () => { let count = 0; while (frames.length && ++count < 20) frames.splice(0).forEach(callback => callback()); assert.ok(count < 20); };
  const lookbook = () => document.getElementById('lookbook');
  return { window, document, elements, app, calls, storage, project, created, flush, dispatch, lookbook, intro, switchForm, switchSelect, settings, settingsSummary, newButton,
    mountDecisions() {
      Object.defineProperties(elements.matrix, {tBodies: {get: () => elements.matrix.querySelectorAll('tbody')}, tHead: {get: () => elements.matrix.querySelector('thead')}});
      for (const node of created) {
        if (['THEAD', 'TBODY'].includes(node.tagName)) Object.defineProperty(node, 'rows', {get: () => node.querySelectorAll('tr')});
        if (node.tagName === 'TR') Object.defineProperty(node, 'cells', {get: () => node.children.filter(child => ['TH', 'TD'].includes(child.tagName))});
      }
      delete window.StudioDecisions; vm.runInContext(source('decisions.js'), context); context.StudioDecisions = window.StudioDecisions;
    },
    mountControls: () => vm.runInContext(source('workspace-controls.js'), context),
    cards: () => lookbook().querySelectorAll('.look-card'), card: id => lookbook().querySelectorAll('.look-card').find(card => card.dataset.lookId === id),
    setFilter(ids) { filtering = true; matched = new Set(ids); dispatch('studio:decisionfilter'); flush(); },
    setDecision(id, status) { decisionValues.set(id, status); dispatch('studio:change', { project }); flush(); } };
}

for (const search of ['', '?dataset=product-shades', '?studio=0&dataset=color-form', '?studio=1']) {
  test(`minimalist presentation and View controls activate at ${search || 'the bare root URL'}`, () => {
    const h = boot(dataset(2, 3), {}, true, search);
    assert.ok(h.window.StudioPresentation, 'presentation does not require an opt-in query');
    assert.equal(h.document.body.classList.contains('studio-experience'), true);
    assert.equal(h.window.StudioPresentation.getView(), 'gallery');
    assert.equal(h.elements['matrix-wrap'].hidden, true);
    assert.equal(h.lookbook().hidden, false);
    assert.equal(h.lookbook().querySelectorAll('.look-grid').length, 1);
    assert.equal(h.cards().length, 6);
    h.mountControls();
    assert.ok(h.document.getElementById('wv-controls'), 'View controls do not require an opt-in query');
    const grouping = h.document.getElementById('wv-grouping');
    assert.equal(grouping.value, 'none');
    grouping.value = 'row'; grouping.dispatchEvent({type: 'change'}); h.flush();
    assert.equal(h.window.WorkspaceView.get().galleryGrouping, 'row');
    assert.equal(h.lookbook().querySelectorAll('.look-group').length, 2, 'the actual View control is wired to presentation');
  });
}

for (const embedded of [false, true]) {
  for (const layout of ['gallery', 'matrix', 'favorites']) {
    test(`Project tools remain reachable in ${embedded ? 'embedded' : 'standalone'} ${layout}, including Focus mode`, () => {
      const h = boot(dataset(2, 2), {}, true, '', embedded);
      if (layout === 'favorites') h.window.MatrixFavorites.openInbox();
      else h.window.StudioPresentation.setView(layout);
      h.flush(); h.mountControls();
      const opener = h.document.getElementById('present-tools-button'), tools = h.document.getElementById('project-tools-dialog');
      assert.ok(opener); assert.equal(opener.textContent, 'Project');
      assert.equal(h.document.querySelectorAll('.present-tools-button').length, 1, 'one shared opener replaces the introductory action');
      assert.equal(opener.parentElement, h.document.getElementById('fav-bar'));
      assert.equal(opener.closest('.intro'), null, 'the opener stays outside the header hidden by Focus');
      assert.equal(opener.getAttribute('aria-haspopup'), 'dialog'); assert.equal(opener.getAttribute('aria-controls'), tools.id);
      assert.equal(h.document.body.classList.contains('studio-embedded'), embedded);
      h.document.getElementById('wv-focus-toggle').click(); h.flush();
      assert.equal(h.window.WorkspaceView.get().focus, true); assert.equal(h.intro.getClientRects().length, 0);
      assert.ok(opener.getClientRects().length, 'hiding the introductory header does not hide the Project action');
      opener.click(); h.flush();
      assert.equal(tools.open, true); assert.equal(h.document.activeElement, h.switchSelect, 'opening Project puts the existing project chooser first');
      assert.equal(tools.contains(h.elements['studio-toolbar']), true); assert.equal(tools.contains(h.settings), true);
      assert.equal(h.document.querySelectorAll('#ws-switch-select').length, 1, 'the original project chooser is reused');
      assert.equal(h.window.WorkspaceView.get().focus, true); assert.equal(h.window.StudioPresentation.getView(), layout);
      tools.querySelector('.project-tools-head .icon-button').click();
      assert.equal(tools.open, false); assert.equal(h.document.activeElement, opener); assert.ok(opener.getClientRects().length);
    });
  }
}

test('Project action names follow the active project and keep imported titles inert', () => {
  const h = boot(dataset(1, 1)), opener = h.document.getElementById('present-tools-button');
  assert.equal(opener.title, 'Project tools · Material study'); assert.equal(opener.getAttribute('aria-label'), 'Project tools for Material study');
  h.project.title = '  Product shades <img src=x onerror=alert(1)>  ';
  h.dispatch('studio:change', {project: h.project}); h.flush();
  assert.equal(opener.title, 'Project tools · Product shades <img src=x onerror=alert(1)>');
  assert.equal(opener.getAttribute('aria-label'), 'Project tools for Product shades <img src=x onerror=alert(1)>');
  assert.equal(opener.querySelector('img'), null); assert.equal(opener.textContent, 'Project');
  assert.equal(h.document.querySelectorAll('.present-tools-button').length, 1);
  h.project.title = ''; h.dispatch('studio:change', {project: h.project}); h.flush();
  assert.equal(opener.title, 'Project tools'); assert.equal(opener.getAttribute('aria-label'), 'Project tools');
});

for (const unavailable of ['hidden form', 'hidden selector', 'disabled selector', 'aria-disabled selector']) {
  test(`Project focus skips a ${unavailable} and opens the existing settings summary`, () => {
    const h = boot(dataset(1, 1));
    if (unavailable === 'hidden form') h.switchForm.hidden = true;
    if (unavailable === 'hidden selector') h.switchSelect.hidden = true;
    if (unavailable === 'disabled selector') h.switchSelect.disabled = true;
    if (unavailable === 'aria-disabled selector') h.switchSelect.setAttribute('aria-disabled', 'true');
    h.document.getElementById('present-tools-button').click();
    assert.equal(h.settings.open, true); assert.equal(h.elements['studio-tools-disclosure'].open, true);
    assert.equal(h.document.activeElement, h.settingsSummary); assert.ok(h.settingsSummary.getClientRects().length);
  });
}

test('Project focus falls back to the existing new-project action and then dialog close', () => {
  const h = boot(dataset(1, 1)), opener = h.document.getElementById('present-tools-button'), tools = h.document.getElementById('project-tools-dialog');
  h.switchForm.hidden = true; h.settingsSummary.hidden = true;
  opener.click(); assert.equal(h.document.activeElement, h.newButton);
  tools.querySelector('.project-tools-head .icon-button').click();
  assert.equal(h.document.activeElement, opener);
  h.newButton.disabled = true; opener.click();
  assert.equal(h.document.activeElement, tools.querySelector('.project-tools-head .icon-button'));
});

test('Opening and closing Project tools preserves shared selections, presentation, project data and saved storage', () => {
  const h = boot(dataset(1, 3), {galleryFraming:'focused', galleryDescriptions:true, metadataFields:['cell.price']}, true);
  h.document.getElementById('present-compare-toggle').click(); h.card('r0-c0').querySelector('.look-open').click(); h.flush();
  const projectBefore = JSON.stringify(h.project), preferencesBefore = JSON.stringify(h.window.WorkspaceView.get()), storageBefore = JSON.stringify([...h.storage]);
  const selectionBefore = [...h.app.selected], layoutsBefore = h.window.StudioPresentation.getView(), opener = h.document.getElementById('present-tools-button');
  const tools = h.document.getElementById('project-tools-dialog');
  opener.click(); h.flush();
  assert.equal(tools.open, true); assert.equal(h.document.activeElement, h.switchSelect);
  tools.querySelector('.project-tools-head .icon-button').click(); h.flush();
  assert.equal(h.document.activeElement, opener);
  assert.equal(JSON.stringify(h.project), projectBefore); assert.equal(JSON.stringify(h.window.WorkspaceView.get()), preferencesBefore);
  assert.equal(JSON.stringify([...h.storage]), storageBefore); assert.equal(h.calls.projectUpdates, 0);
  assert.deepEqual([...h.app.selected], selectionBefore); assert.equal(h.window.StudioPresentation.getView(), layoutsBefore);
  assert.equal(h.window.StudioPresentation.isComparing(), true); assert.deepEqual(h.calls.viewers, []);
  assert.deepEqual(h.calls.favorites, []); assert.deepEqual(h.calls.decisions, []);
  assert.equal(h.document.querySelectorAll('#project-tools-dialog').length, 1);
});

for (const [rows, columns] of [[1, 10], [10, 1], [3, 4]]) {
  test(`${rows}×${columns} gallery is one continuous grid in matrix order`, () => {
    const data = dataset(rows, columns), before = JSON.stringify(data), h = boot(data, { layout: 'gallery' });
    assert.equal(h.lookbook().querySelectorAll('.look-grid').length, 1);
    assert.equal(h.lookbook().querySelectorAll('.look-group').length, 0);
    assert.deepEqual(h.cards().map(card => card.dataset.lookId), data.cells.map(cell => cell.id));
    assert.equal(h.cards().filter(card => !card.hidden).length, rows * columns);
    assert.equal(JSON.stringify(data), before, 'presentation does not rewrite imported dataset content');
  });
}

test('card titles emphasize the varying axis and identify both axes when both vary', () => {
  const singleRow = boot(dataset(1, 3));
  const rowTitle = singleRow.card('r0-c1').querySelector('.look-title').textContent;
  assert.ok(rowTitle.includes('Finish 2')); assert.ok(!rowTitle.includes('Form 1'));
  const singleColumn = boot(dataset(3, 1));
  const columnTitle = singleColumn.card('r1-c0').querySelector('.look-title').textContent;
  assert.ok(columnTitle.includes('Form 2')); assert.ok(!columnTitle.includes('Finish 1'));
  const both = boot(dataset(2, 2));
  assert.match(both.card('r1-c1').querySelector('.look-title').textContent, /Form 2/);
  assert.match(both.card('r1-c1').querySelector('.look-title').textContent, /Finish 2/);
  assert.equal(both.card('r1-c1').querySelector('.look-open').getAttribute('aria-label'), 'Open Form 2 · Finish 2');
});

test('metadata displays literal values, treats only hex colors as swatches and remains independently selectable', () => {
  const data = dataset(1, 1);
  data.rows[0].attributes = { material: 'Cotton', approved: false };
  data.columns[0].attributes = { accent: '#507DB5', colorName: 'Warm blue' };
  data.cells[0].attributes = { price: 0, payload: '<img src=x onerror=alert(1)>', missing: null };
  const h = boot(data), card = h.card('r0-c0');
  const fields = Array.from(h.window.StudioPresentation.getMetadataFields());
  assert.ok(fields.some(field => field.key === 'row.material'));
  assert.ok(fields.some(field => field.key === 'column.accent'));
  assert.ok(fields.some(field => field.key === 'cell.price'));
  h.window.WorkspaceView.update({ metadataFields: ['column.accent', 'column.colorName', 'cell.price', 'cell.payload', 'row.approved'] }); h.flush();
  const specs = card.querySelectorAll('.look-spec');
  assert.deepEqual(specs.map(spec => spec.querySelector('.look-spec-value').textContent).sort(), ['#507DB5', 'Warm blue', '0', '<img src=x onerror=alert(1)>', 'false'].sort());
  assert.equal(card.querySelectorAll('.look-swatch').length, 1);
  assert.equal(card.querySelector('.look-metadata').querySelector('img'), null, 'imported text stays inert');
  h.window.WorkspaceView.update({ metadataFields: [] }); h.flush();
  assert.equal(card.querySelectorAll('.look-spec').length, 0);
  h.window.WorkspaceView.update({ metadataFields: null }); h.flush();
  assert.ok(card.querySelectorAll('.look-spec').length > 0);
  assert.ok(card.querySelectorAll('.look-spec').length <= 4, 'automatic metadata stays concise');
});

test('Gallery descriptions are optional and expanded viewers show deduplicated literal prose', () => {
  const data = dataset(1, 1); data.rows[0].description = 'Repeated <img src=x onerror=alert(1)> descriptive text'; data.columns[0].description = data.rows[0].description; data.cells[0].detail = 'assets/detail-image.png';
  const h = boot(data), details = h.card('r0-c0').querySelector('.look-description');
  assert.equal(details.querySelector('summary').textContent, 'Description');
  assert.equal(details.hidden, true); assert.equal(details.open, false);
  h.mountControls(); const descriptions = h.document.getElementById('wv-card-descriptions');
  assert.equal(descriptions.checked, false); assert.equal(h.document.getElementById('wv-descriptions-field').hidden, false);
  descriptions.checked = true; descriptions.dispatchEvent({type: 'change'}); h.flush();
  assert.equal(h.window.WorkspaceView.get().galleryDescriptions, true);
  assert.equal(details.hidden, false);
  assert.equal(details.textContent.split(data.rows[0].description).length - 1, 1);
  assert.equal(details.querySelector('img'), null, 'prose is literal text');
  assert.ok(!details.textContent.includes('assets/detail-image.png'));
  h.card('r0-c0').querySelector('.look-open').click();
  const expanded = h.elements['viewer-content'].querySelector('.present-viewer-description');
  assert.ok(expanded); assert.equal(expanded.querySelectorAll('p').length, 1);
  assert.equal(expanded.querySelector('p').textContent, data.rows[0].description); assert.equal(expanded.querySelector('img'), null);
  assert.ok(!expanded.textContent.includes('assets/detail-image.png'));
  descriptions.checked = false; descriptions.dispatchEvent({type: 'change'}); h.flush();
  assert.equal(h.window.WorkspaceView.get().galleryDescriptions, false);
  assert.equal(details.hidden, true);
  assert.equal(expanded.querySelector('p').textContent, data.rows[0].description, 'viewer prose remains available when card descriptions are hidden');
  h.elements['close-viewer'].click(); h.window.StudioPresentation.setView('matrix'); h.flush();
  assert.equal(h.document.getElementById('wv-descriptions-field').hidden, true, 'Gallery description choice does not clutter Matrix controls');
  h.window.StudioPresentation.setView('gallery'); h.flush(); assert.equal(h.document.getElementById('wv-descriptions-field').hidden, false);
});

test('option descriptions and older imported prose stay out of card specifications and remain in expanded details', () => {
  for (const legacy of [false, true]) {
    const data = dataset(1, 2), prose = 'Proposal <script>literal text</script>\nMaterial placement';
    data.rows[0].description = 'Shared form'; data.columns[0].description = 'Shared form';
    data.cells[0].attributes = {price: 0, ...(legacy ? {Description: prose} : {})};
    if (!legacy) data.cells[0].description = prose;
    const before = JSON.stringify(data), h = boot(data), card = h.card('r0-c0');
    assert.equal(card.querySelector('.look-description').hidden, true);
    assert.deepEqual(card.querySelectorAll('.look-spec-value').map(node => node.textContent), ['0']);
    assert.ok(h.window.StudioPresentation.getMetadataFields().every(field => !/description/i.test(field.key)));
    card.querySelector('.look-open').click();
    const expanded = h.elements['viewer-content'].querySelector('.present-viewer-description');
    assert.deepEqual(expanded.querySelectorAll('p').map(node => node.textContent), ['Shared form', prose]);
    assert.equal(expanded.querySelector('script'), null);
    h.window.WorkspaceView.update({galleryDescriptions: true}); h.flush();
    assert.equal(card.querySelector('.look-description').hidden, false);
    assert.deepEqual(card.querySelector('.look-description').querySelectorAll('p').map(node => node.textContent), ['Shared form', prose]);
    assert.equal(JSON.stringify(data), before, 'legacy descriptions remain in their original saved representation');
  }
});

test('description search finds canonical and older imported option prose', () => {
  const data = dataset(1, 2); data.cells[0].description = 'Cobalt finish'; data.cells[1].attributes = {Description: 'Amber finish'};
  const h = boot(data); h.mountDecisions();
  const search = h.document.getElementById('dec-filter-search'), form = search.closest('form');
  for (const [term, expected] of [['cobalt', 'r0-c0'], ['amber', 'r0-c1']]) {
    search.value = term; form.dispatchEvent({type: 'submit', target: form, preventDefault() {}}); h.flush();
    assert.deepEqual(Array.from(h.window.StudioDecisions.visibleIds()), [expected]);
  }
});

test('default gallery has no repeated footers while viewer evaluation and favorites remain available', () => {
  const h = boot(dataset(2, 2), { layout: 'gallery' }), first = h.card('r0-c0');
  for (const card of h.cards()) {
    assert.equal(card.querySelector('.look-actions'), null); assert.equal(card.querySelector('.look-decision'), null); assert.equal(card.querySelector('.look-select'), null);
    assert.equal(card.querySelector('.look-open').getAttribute('aria-pressed'), null);
  }
  first.querySelector('.look-open').click(); assert.deepEqual(h.calls.viewers, [['r0-c0']]);
  const evaluate = h.document.getElementById('present-evaluate');
  assert.ok(evaluate); assert.equal(evaluate.hidden, false);
  evaluate.click(); assert.deepEqual(h.calls.decisions, ['r0-c0']);
  h.setDecision('r0-c0', 'preferred');
  evaluate.click(); assert.deepEqual(h.calls.decisions, ['r0-c0', 'r0-c0']);
  h.elements['close-viewer'].click();
  first.querySelector('.look-star').click(); h.flush();
  assert.deepEqual(h.calls.favorites, ['r0-c0']); assert.equal(first.querySelector('.look-star').getAttribute('aria-pressed'), 'true');
});

test('Gallery toolbar comparison uses shared selection, limits it to two and returns to visible controls', () => {
  const h = boot(dataset(1, 3)), toggle = h.document.getElementById('present-compare-toggle'), compare = h.document.getElementById('present-compare-now'), cancel = h.document.getElementById('present-compare-cancel');
  const first = h.card('r0-c0').querySelector('.look-open'), second = h.card('r0-c1').querySelector('.look-open'), third = h.card('r0-c2').querySelector('.look-open');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false'); assert.equal(compare.getClientRects().length, 0);
  toggle.focus(); toggle.click(); h.flush();
  assert.equal(toggle.getAttribute('aria-pressed'), 'true'); assert.ok(compare.getClientRects().length); assert.equal(compare.disabled, true);
  first.click(); h.flush();
  assert.equal(h.elements.viewer.open, false, 'selection mode does not open images');
  assert.equal(first.getAttribute('aria-pressed'), 'true'); assert.match(first.getAttribute('aria-label'), /Deselect.*Form 1.*Finish 1/);
  assert.match(h.document.getElementById('present-compare-status').textContent, /1.*2/);
  second.click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']);
  assert.equal(compare.disabled, false);
  third.click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']); assert.equal(third.getAttribute('aria-pressed'), 'false');
  assert.equal(h.document.activeElement, compare, 'a third choice does not focus hidden Matrix controls');
  compare.click(); h.flush();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0', 'r0-c1']);
  assert.deepEqual(h.elements['viewer-content'].querySelectorAll('img').map(img => img.src), ['assets/r0-c0.png', 'assets/r0-c1.png']);
  assert.equal(h.document.getElementById('present-evaluate').hidden, true, 'single-option evaluation is hidden during comparison');
  h.elements['close-viewer'].click(); h.flush();
  assert.equal(h.document.activeElement, compare); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  first.click(); h.flush(); assert.deepEqual([...h.app.selected], ['r0-c1']); assert.equal(compare.disabled, true);
  cancel.click(); h.flush();
  assert.equal(h.app.selected.size, 0); assert.equal(toggle.getAttribute('aria-pressed'), 'false'); assert.equal(compare.getClientRects().length, 0);
  assert.equal(h.document.activeElement, toggle); assert.equal(first.getAttribute('aria-pressed'), null);
  first.click(); assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0']);
});

test('comparison evaluation delegates each displayed option and keeps single-image actions concise', () => {
  const data = dataset(1, 2); data.rows[0].description = 'Shared form description';
  data.columns[0].description = 'First finish <img src=x onerror=alert(1)>'; data.columns[1].description = 'Second finish description';
  const h = boot(data), first = h.card('r0-c0').querySelector('.look-open');
  first.click(); assert.equal(h.elements['viewer-content'].querySelectorAll('.present-evaluate-option').length, 0);
  assert.equal(h.document.getElementById('present-evaluate').hidden, false); h.elements['close-viewer'].click();
  h.document.getElementById('present-compare-toggle').click(); first.click(); h.card('r0-c1').querySelector('.look-open').click(); h.flush();
  h.document.getElementById('present-compare-now').click();
  const figures = h.elements['viewer-content'].querySelectorAll('.viewer-figure');
  assert.equal(figures.length, 2); assert.equal(h.document.getElementById('present-evaluate').hidden, true);
  for (const [index, figure] of figures.entries()) {
    const action = figure.querySelector('.present-evaluate-option'); assert.ok(action);
    assert.equal(figure.querySelectorAll('.present-evaluate-option').length, 1);
    assert.match(action.getAttribute('aria-label'), new RegExp(`Evaluate.*Form 1.*Finish ${index + 1}`));
    const prose = figure.querySelector('.present-viewer-description');
    assert.deepEqual(prose.querySelectorAll('p').map(p => p.textContent), [data.rows[0].description, data.columns[index].description]);
    assert.equal(prose.querySelector('img'), null);
    action.click(); assert.equal(h.calls.decisions.at(-1), `r0-c${index}`); assert.equal(h.document.activeElement, action);
  }
  assert.deepEqual(h.calls.decisions, ['r0-c0', 'r0-c1']); assert.equal(h.elements.viewer.open, true);
  h.elements['close-viewer'].click(); h.document.getElementById('present-compare-cancel').click(); first.click();
  assert.equal(h.elements['viewer-content'].querySelectorAll('.present-evaluate-option').length, 0);
  assert.equal(h.document.getElementById('present-evaluate').hidden, false);
});

test('Escape cancels toolbar comparison outside dialogs without disturbing an open viewer', () => {
  const h = boot(dataset(1, 2)), toggle = h.document.getElementById('present-compare-toggle');
  toggle.click(); h.card('r0-c0').querySelector('.look-open').click(); h.card('r0-c1').querySelector('.look-open').click(); h.flush();
  h.document.getElementById('present-compare-now').click();
  const escape = target => h.document.dispatchEvent({type: 'keydown', key: 'Escape', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }});
  escape(h.elements['close-viewer']); h.flush();
  assert.equal(h.app.selected.size, 2); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  h.elements['close-viewer'].click(); escape(h.document.body); h.flush();
  assert.equal(h.app.selected.size, 0); assert.equal(toggle.getAttribute('aria-pressed'), 'false'); assert.equal(h.document.activeElement, toggle);
});

test('Escape closes an open View popover before cancelling toolbar comparison', () => {
  const h = boot(dataset(1, 2)); h.mountControls();
  h.document.getElementById('present-compare-toggle').click(); h.card('r0-c0').querySelector('.look-open').click(); h.flush();
  const viewToggle = h.document.getElementById('wv-settings-toggle'), panel = h.document.getElementById('wv-settings-panel');
  viewToggle.click(); assert.equal(panel.hidden, false);
  const escape = () => h.document.dispatchEvent({type: 'keydown', key: 'Escape', target: viewToggle, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }});
  escape(); h.flush();
  assert.equal(panel.hidden, true); assert.deepEqual([...h.app.selected], ['r0-c0']); assert.equal(h.window.StudioPresentation.isComparing(), true);
  escape(); h.flush(); assert.equal(h.app.selected.size, 0); assert.equal(h.window.StudioPresentation.isComparing(), false);
});

test('pending and unavailable options remain visible without active image or comparison actions', () => {
  const data = dataset(1, 3); data.cells[1].status = 'pending'; delete data.cells[1].src;
  const h = boot(data, { layout: 'gallery' }), pending = h.card('r0-c1');
  assert.equal(pending.hidden, false); assert.equal(pending.querySelector('.look-open').disabled, true);
  assert.equal(pending.querySelector('.look-select'), null); assert.equal(pending.querySelector('.look-star').hidden, true);
  assert.match(pending.textContent, /Awaiting image|Pending/);
  h.app.toggleSelection(h.app.cells.get('r0-c0')); h.flush();
  const unavailable = h.card('r0-c0');
  h.app.cards.get('r0-c0').querySelector('img').dispatchEvent({ type: 'error' }); h.flush();
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false); assert.equal(h.app.selected.size, 0);
  assert.equal(unavailable.hidden, false); assert.equal(unavailable.querySelector('.look-open').disabled, true);
  assert.equal(unavailable.querySelector('.look-select'), null); assert.equal(unavailable.querySelector('.look-star').hidden, true);
  assert.match(unavailable.textContent, /Image unavailable/);
  h.setFilter(['r0-c2']); assert.deepEqual(h.cards().filter(card => !card.hidden).map(card => card.dataset.lookId), ['r0-c2']);
  h.setFilter([]); assert.equal(h.lookbook().querySelector('.look-empty').hidden, false);
});

test('optional grouping returns to one grid without losing shared comparison state', () => {
  const h = boot(dataset(2, 3)), id = 'r1-c2';
  h.document.getElementById('present-compare-toggle').click(); h.card(id).querySelector('.look-open').click(); h.flush();
  h.window.WorkspaceView.update({ galleryGrouping: 'row' }); h.flush();
  assert.equal(h.lookbook().querySelectorAll('.look-group').length, 2);
  assert.equal(h.cards().length, 6); assert.ok(h.app.selected.has(id));
  h.window.WorkspaceView.update({ galleryGrouping: 'column' }); h.flush();
  assert.equal(h.lookbook().querySelectorAll('.look-group').length, 3);
  assert.equal(h.cards().length, 6); assert.ok(h.app.selected.has(id));
  h.window.WorkspaceView.update({ galleryGrouping: 'none' }); h.flush();
  assert.equal(h.lookbook().querySelectorAll('.look-group').length, 0);
  assert.equal(h.lookbook().querySelectorAll('.look-grid').length, 1);
  assert.equal(h.card(id).querySelector('.look-open').getAttribute('aria-pressed'), 'true');
});

test('focused gallery prefers supplied detail images and full framing restores originals', () => {
  const data = dataset(1, 2); data.cells[0].detail = 'assets/close-detail.png';
  const h = boot(data, { galleryFraming: 'full' });
  assert.equal(h.card('r0-c0').querySelector('img').src, 'assets/r0-c0.png');
  h.document.getElementById('present-focused').click(); h.flush();
  assert.equal(h.window.WorkspaceView.get().galleryFraming, 'focused');
  assert.equal(h.card('r0-c0').querySelector('img').src, 'assets/close-detail.png');
  assert.equal(h.card('r0-c1').querySelector('img').src, 'assets/r0-c1.png');
  h.document.getElementById('present-full').click(); h.flush();
  assert.equal(h.window.WorkspaceView.get().galleryFraming, 'full');
  assert.equal(h.card('r0-c0').querySelector('img').src, 'assets/r0-c0.png');
  assert.equal(data.cells[0].src, 'assets/r0-c0.png');
});

test('viewer detail swaps supplied sources independently for each compared option', () => {
  const data = dataset(1, 2); data.cells[0].detail = 'assets/close-detail.png';
  const h = boot(data);
  h.app.openViewer([h.app.cells.get('r0-c0'), h.app.cells.get('r0-c1')]);
  assert.deepEqual(h.elements['viewer-content'].querySelectorAll('img').map(img => img.src), ['assets/r0-c0.png', 'assets/r0-c1.png']);
  h.elements['face-detail-button'].click();
  assert.deepEqual(h.elements['viewer-content'].querySelectorAll('img').map(img => img.src), ['assets/close-detail.png', 'assets/r0-c1.png']);
  assert.equal(h.elements['viewer-content'].querySelectorAll('.has-detail-image').length, 1);
  h.elements['full-portrait-button'].click();
  assert.deepEqual(h.elements['viewer-content'].querySelectorAll('img').map(img => img.src), ['assets/r0-c0.png', 'assets/r0-c1.png']);
  h.app.openViewer([h.app.cells.get('r0-c1')]);
  assert.equal(h.elements['full-portrait-button'].getAttribute('aria-pressed'), 'true', 'new viewer opens in full-image mode');
});

test('unavailable optional details fall back to originals without removing usable options', () => {
  const data = dataset(1, 2); data.cells[0].detail = 'assets/missing-detail.png';
  const h = boot(data, {galleryFraming: 'focused'}), first = h.card('r0-c0'), preview = first.querySelector('img');
  assert.equal(preview.src, 'assets/missing-detail.png');
  preview.dispatchEvent({type: 'error'});
  assert.equal(preview.src, 'assets/r0-c0.png'); assert.equal(first.querySelector('.look-open').disabled, false);
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), true);
  h.app.openViewer([h.app.cells.get('r0-c0')]); h.elements['face-detail-button'].click();
  const img = h.elements['viewer-content'].querySelector('img'); img.dispatchEvent({type: 'error'});
  assert.equal(img.src, 'assets/r0-c0.png'); assert.equal(img.hidden, false);
  assert.equal(h.elements['viewer-content'].querySelector('.vex-broken'), null);
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), true);
  assert.match(h.document.getElementById('vex-live').textContent, /Detail image unavailable/);
  h.elements['full-portrait-button'].click(); h.elements['face-detail-button'].click();
  assert.equal(img.src, 'assets/r0-c0.png', 'failed optional detail is not retried in the same viewer');
});

test('failed gallery originals update shared readiness, counts and comparison', () => {
  const h = boot(dataset(1, 2)), first = h.card('r0-c0');
  h.document.getElementById('present-compare-toggle').click(); first.querySelector('.look-open').click(); h.flush();
  first.querySelector('img').dispatchEvent({type: 'error'}); h.flush();
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false);
  assert.equal(h.app.selected.size, 0); assert.equal(h.elements['ready-count'].textContent, '1 / 2');
  assert.equal(h.elements['compare-tray'].hidden, true);
  assert.equal(first.querySelector('.look-open').disabled, true); assert.match(first.textContent, /Image unavailable/);
});

test('failed viewer originals update shared readiness and leave other options browsable', () => {
  const h = boot(dataset(1, 2));
  h.app.toggleSelection(h.app.cells.get('r0-c0'));
  h.app.openViewer([h.app.cells.get('r0-c0')]);
  const img = h.elements['viewer-content'].querySelector('img'); img.dispatchEvent({type: 'error'}); h.flush();
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false); assert.equal(h.app.selected.size, 0);
  assert.equal(h.elements['ready-count'].textContent, '1 / 2');
  assert.ok(h.elements['viewer-content'].querySelector('.vex-broken')); assert.equal(img.hidden, true);
  h.document.getElementById('vex-next').click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c1']);
  assert.equal(h.app.isReady(h.app.cells.get('r0-c1')), true);
});

test('saved presentation defaults travel with a project while explicit device choices take precedence', async () => {
  const data = dataset(1, 1);
  data.meta.presentation = { galleryFraming: 'focused', galleryGrouping: 'row', galleryDescriptions: true, metadataFields: ['column.accent'], galleryZoom: 1.5, galleryFocalX: 0.3, galleryFocalY: 0.7 };
  data.columns[0].attributes = { accent: '#507DB5' };
  const h = boot(data, { galleryFraming: 'full', galleryGrouping: 'none' });
  assert.equal(h.window.WorkspaceView.get().galleryFraming, 'full');
  assert.equal(h.window.WorkspaceView.get().galleryGrouping, 'none');
  assert.equal(h.window.WorkspaceView.get().galleryZoom, 1.5);
  assert.equal(h.window.WorkspaceView.get().galleryDescriptions, true);
  h.window.WorkspaceView.update({galleryFraming: 'focused', galleryGrouping: 'column', metadataFields: ['column.accent'], galleryZoom: 2, galleryFocalX: 0.1, galleryFocalY: 0.9, zoom: 1.38, matrixLeft: 400});
  const before = JSON.parse(JSON.stringify(h.project));
  h.window.ProjectStore.update = async mutate => {
    const patch = mutate(h.project);
    h.project.data = require('../project-store.js').validateData(patch.data);
    return h.project;
  };
  const saved = await h.window.WorkspaceView.savePresentation();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), {galleryFraming: 'focused', galleryGrouping: 'column', galleryDescriptions: true, metadataFields: ['column.accent'], galleryZoom: 2, galleryFocalX: 0.1, galleryFocalY: 0.9});
  assert.deepEqual(h.project.data.meta.presentation, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(h.project.data.cells, before.data.cells);
  assert.equal(h.project.title, before.title);
  assert.equal(Object.hasOwn(h.project.data.meta.presentation, 'matrixLeft'), false);
  assert.equal(Object.hasOwn(h.project.data.meta.presentation, 'zoom'), false);
  const imported = boot(JSON.parse(JSON.stringify(h.project.data)));
  assert.equal(imported.window.WorkspaceView.get().galleryFraming, 'focused');
  assert.equal(imported.window.WorkspaceView.get().galleryZoom, 2);
  assert.equal(imported.window.WorkspaceView.get().galleryDescriptions, true);
  assert.equal(imported.window.WorkspaceView.get().matrixLeft, 0, 'device pan is not saved into project defaults');
});

test('View controls switch between automatic, custom and hidden metadata without changing content', () => {
  const data = dataset(1, 1); data.rows[0].attributes = {material: 'Cotton'}; data.columns[0].attributes = {hex: '#507DB5'}; data.cells[0].attributes = {price: 0};
  const before = JSON.stringify(data), h = boot(data); h.mountControls();
  const automatic = h.document.getElementById('wv-metadata-auto');
  const choices = h.document.getElementById('wv-metadata-fields').querySelectorAll('input');
  assert.equal(automatic.checked, true); assert.ok(choices.every(choice => choice.disabled));
  automatic.checked = false; automatic.dispatchEvent({type: 'change'}); h.flush();
  assert.ok(choices.every(choice => !choice.disabled));
  for (const choice of choices) { choice.checked = choice.value === 'cell.price'; choice.dispatchEvent({type: 'change'}); }
  h.flush();
  assert.deepEqual(Array.from(h.window.WorkspaceView.get().metadataFields), ['cell.price']);
  assert.deepEqual(h.card('r0-c0').querySelectorAll('.look-spec-value').map(node => node.textContent), ['0']);
  const price = choices.find(choice => choice.value === 'cell.price'); price.checked = false; price.dispatchEvent({type: 'change'}); h.flush();
  assert.deepEqual(Array.from(h.window.WorkspaceView.get().metadataFields), []);
  assert.equal(h.card('r0-c0').querySelector('.look-metadata').hidden, true);
  automatic.checked = true; automatic.dispatchEvent({type: 'change'}); h.flush();
  assert.equal(h.window.WorkspaceView.get().metadataFields, null); assert.ok(choices.every(choice => choice.disabled));
  assert.equal(h.card('r0-c0').querySelectorAll('.look-spec').length, 3);
  assert.equal(JSON.stringify(data), before);
});

test('View save action prevents duplicate saves and reports success or failure while retaining choices', async () => {
  const h = boot(dataset(1, 1), {galleryFraming: 'focused'}); h.mountControls();
  let finish, saves = 0;
  h.window.ProjectStore.update = () => { saves++; return new Promise(resolve => { finish = resolve; }); };
  const save = h.document.getElementById('wv-save-presentation'), status = h.document.getElementById('wv-presentation-status');
  save.click(); save.click();
  assert.equal(saves, 1); assert.equal(save.disabled, true); assert.match(status.textContent, /Saving presentation/);
  finish(); await new Promise(setImmediate);
  assert.equal(save.disabled, false); assert.match(status.textContent, /Presentation saved/);
  h.window.ProjectStore.update = async () => { throw new Error('Disk unavailable'); };
  save.click(); await new Promise(setImmediate);
  assert.equal(save.disabled, false); assert.match(status.textContent, /Could not save presentation: Disk unavailable/);
  assert.equal(h.window.WorkspaceView.get().galleryFraming, 'focused');
});

test('Favorites framing uses supplied details and retains fallback across preference flips and list rebuilds', () => {
  const data = dataset(1, 2); data.cells[0].detail = 'assets/close-detail.png';
  const h = boot(data, {galleryFraming: 'focused'}, true), api = h.window.MatrixFavorites;
  api.openInbox(); h.flush();
  const item = id => h.document.getElementById('fav-panel').querySelectorAll('.fav-item').find(node => node.dataset.favId === id);
  let first = item('r0-c0');
  assert.equal(first.querySelector('img').src, 'assets/close-detail.png');
  assert.equal(first.querySelector('.fav-open').classList.contains('has-detail-image'), true);
  assert.equal(item('r0-c1').querySelector('img').src, 'assets/r0-c1.png');
  h.window.WorkspaceView.update({galleryFraming: 'full'}); h.flush();
  assert.equal(first.querySelector('img').src, 'assets/r0-c0.png');
  assert.equal(first.querySelector('.fav-open').classList.contains('has-detail-image'), false);
  h.window.WorkspaceView.update({galleryFraming: 'focused'}); h.flush();
  first.querySelector('img').dispatchEvent({type: 'error'});
  assert.equal(first.querySelector('img').src, 'assets/r0-c0.png');
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), true); assert.equal(h.elements['ready-count'].textContent, '2 / 2');
  assert.match(h.elements.announcement.textContent, /Detail image unavailable/);
  h.window.WorkspaceView.update({galleryFraming: 'full'}); h.window.WorkspaceView.update({galleryFraming: 'focused'}); h.flush();
  assert.equal(first.querySelector('img').src, 'assets/r0-c0.png');
  h.setFilter(['r0-c1']); assert.equal(item('r0-c0'), undefined);
  h.setFilter(['r0-c0', 'r0-c1']); first = item('r0-c0');
  assert.equal(first.querySelector('img').src, 'assets/r0-c0.png', 'new card retains failed-detail memory');
  h.window.StudioPresentation.setView('gallery'); api.openList('review'); h.flush();
  assert.equal(item('r0-c0').querySelector('img').src, 'assets/r0-c0.png');
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1']); assert.deepEqual(h.project.lists[0].cellIds, ['r0-c0', 'r0-c1']);
});

test('Favorites main-image failures update shared state without removing saved membership', () => {
  const data = dataset(1, 2); data.cells[0].detail = data.cells[0].src;
  const h = boot(data, {galleryFraming: 'focused'}, true), api = h.window.MatrixFavorites;
  api.openList('review'); h.flush();
  const item = id => h.document.getElementById('fav-panel').querySelectorAll('.fav-item').find(node => node.dataset.favId === id);
  assert.equal(item('r0-c0').querySelector('.fav-open').classList.contains('has-detail-image'), false, 'identical detail and original paths are not optional detail');
  item('r0-c0').querySelector('.fav-select').click(); h.flush();
  item('r0-c0').querySelector('img').dispatchEvent({type: 'error'}); h.flush();
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false); assert.equal(h.app.selected.size, 0);
  assert.equal(h.elements['ready-count'].textContent, '1 / 2'); assert.equal(item('r0-c0'), undefined);
  assert.deepEqual(Array.from(api.visibleIds()), ['r0-c1']);
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1']); assert.deepEqual(h.project.lists[0].cellIds, ['r0-c0', 'r0-c1']);
  h.app.markImageFailed('r0-c1'); h.flush();
  assert.equal(item('r0-c1'), undefined); assert.equal(h.elements['ready-count'].textContent, '0 / 2');
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1']); assert.deepEqual(h.project.lists[0].cellIds, ['r0-c0', 'r0-c1']);
});

test('Favorites toolbar comparison intercepts image opens while saved-list bulk selection remains independent', () => {
  const h = boot(dataset(1, 3), {}, true), api = h.window.MatrixFavorites;
  api.openList('review'); h.flush();
  const item = id => h.document.getElementById('fav-panel').querySelectorAll('.fav-item').find(node => node.dataset.favId === id);
  const toggle = h.document.getElementById('present-compare-toggle'), compare = h.document.getElementById('present-compare-now');
  item('r0-c0').querySelector('.fav-open').click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0']); h.elements['close-viewer'].click();
  toggle.click(); item('r0-c0').querySelector('.fav-open').click(); h.flush();
  assert.equal(h.elements.viewer.open, false); assert.deepEqual([...h.app.selected], ['r0-c0']);
  const box = item('r0-c2').querySelector('input'); box.checked = true; box.dispatchEvent({type: 'change'});
  assert.deepEqual(Array.from(api.getSelection()), ['r0-c2']); assert.deepEqual([...h.app.selected], ['r0-c0']);
  item('r0-c1').querySelector('.fav-open').click(); item('r0-c2').querySelector('.fav-open').click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']); assert.equal(h.document.activeElement, compare);
  compare.click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0', 'r0-c1']);
  h.elements['close-viewer'].click(); h.document.getElementById('present-compare-cancel').click(); h.flush();
  assert.equal(h.app.selected.size, 0); assert.deepEqual(Array.from(api.getSelection()), ['r0-c2']);
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1', 'r0-c2']); assert.deepEqual(h.project.lists[0].cellIds, ['r0-c0', 'r0-c1', 'r0-c2']);
});

test('Matrix selection handlers stay intact and returning to Gallery adopts shared selections', () => {
  const h = boot(dataset(1, 3));
  h.window.StudioPresentation.setView('matrix'); h.flush();
  h.app.selectButtons.get('r0-c0').click(); h.app.selectButtons.get('r0-c1').click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']);
  h.elements['compare-button'].click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0', 'r0-c1']);
  h.elements['close-viewer'].click(); h.window.StudioPresentation.setView('gallery'); h.flush();
  assert.equal(h.document.getElementById('present-compare-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(h.card('r0-c0').querySelector('.look-open').getAttribute('aria-pressed'), 'true');
  h.window.StudioPresentation.setView('matrix'); h.flush();
  assert.ok(h.document.getElementById('present-compare-toggle').getClientRects().length); assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']);
});

test('Matrix images use the same explicit toolbar comparison mode as Gallery', () => {
  const h = boot(dataset(1, 3)), presentation = h.window.StudioPresentation;
  presentation.setView('matrix'); h.flush();
  const image = id => h.app.cards.get(id).querySelector('.option-button');
  const toggle = h.document.getElementById('present-compare-toggle'), compare = h.document.getElementById('present-compare-now');
  assert.ok(toggle.getClientRects().length, 'the comparison toolbar remains reachable');
  assert.equal(toggle.getAttribute('aria-controls'), 'lookbook matrix-wrap fav-panel');
  assert.equal(image('r0-c0').getAttribute('aria-label'), 'Open Form 1 · Finish 1');
  assert.equal(image('r0-c0').getAttribute('aria-pressed'), null);
  image('r0-c0').click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0']);
  assert.deepEqual([...h.app.selected], []);
  h.elements['close-viewer'].click(); toggle.click();
  image('r0-c0').querySelector('img').click(); h.flush();
  assert.equal(h.elements.viewer.open, false, 'a nested image click selects while Compare is active');
  assert.deepEqual([...h.app.selected], ['r0-c0']);
  assert.equal(image('r0-c0').getAttribute('aria-pressed'), 'true');
  assert.match(image('r0-c0').getAttribute('aria-label'), /^Deselect .+ for comparison$/);
  assert.match(image('r0-c1').getAttribute('aria-label'), /^Select .+ for comparison$/);
  assert.equal(compare.disabled, true);
  image('r0-c1').click(); image('r0-c2').click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']);
  assert.equal(h.document.activeElement, compare, 'the third choice returns to a visible toolbar control');
  compare.click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0', 'r0-c1']);
  h.elements['close-viewer'].click();
  image('r0-c0').click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c1']); assert.equal(compare.disabled, true);
});

test('Matrix Cancel clears shared selection and restores image opening and toolbar focus', () => {
  const h = boot(dataset(1, 2)), presentation = h.window.StudioPresentation;
  presentation.setView('matrix'); h.flush();
  h.document.getElementById('present-compare-toggle').click();
  const first = h.app.cards.get('r0-c0').querySelector('.option-button'); first.click(); h.flush();
  h.document.getElementById('present-compare-cancel').click(); h.flush();
  assert.equal(h.app.selected.size, 0); assert.equal(presentation.isComparing(), false);
  assert.equal(h.document.activeElement, h.document.getElementById('present-compare-toggle'));
  assert.equal(first.getAttribute('aria-pressed'), null);
  assert.equal(first.getAttribute('aria-label'), 'Open Form 1 · Finish 1');
  first.click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0']);
  const evaluate = h.document.getElementById('present-evaluate');
  assert.equal(evaluate.hidden, false); evaluate.click();
  assert.deepEqual(h.calls.decisions, ['r0-c0'], 'evaluation remains available in the expanded viewer');
});

test('Compare mode persists through Gallery Matrix and Favorites with one shared selection', () => {
  const h = boot(dataset(1, 2), {}, true), presentation = h.window.StudioPresentation;
  h.document.getElementById('present-compare-toggle').click();
  h.card('r0-c0').querySelector('.look-open').click(); h.flush();
  presentation.setView('matrix'); h.flush();
  assert.equal(presentation.isComparing(), true);
  const matrixOpen = h.app.cards.get('r0-c1').querySelector('.option-button'); matrixOpen.click(); h.flush();
  assert.deepEqual([...h.app.selected], ['r0-c0', 'r0-c1']);
  assert.equal(matrixOpen.getAttribute('aria-pressed'), 'true');
  h.window.MatrixFavorites.openInbox(); h.flush();
  assert.equal(presentation.getView(), 'favorites'); assert.equal(presentation.isComparing(), true);
  const savedOpen = h.document.getElementById('fav-panel').querySelectorAll('.fav-item').find(node => node.dataset.favId === 'r0-c0').querySelector('.fav-open');
  assert.equal(savedOpen.getAttribute('aria-pressed'), 'true');
  savedOpen.click(); h.flush(); assert.deepEqual([...h.app.selected], ['r0-c1']);
  presentation.setView('gallery'); h.flush();
  assert.equal(h.card('r0-c1').querySelector('.look-open').getAttribute('aria-pressed'), 'true');
  h.document.getElementById('present-compare-cancel').click(); h.flush();
  assert.equal(h.app.selected.size, 0); assert.equal(matrixOpen.getAttribute('aria-pressed'), null);
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1']);
});

test('Matrix pending and failed options cannot become comparison choices', () => {
  const data = dataset(1, 3); data.cells[2].status = 'pending'; delete data.cells[2].src;
  const h = boot(data, {layout: 'matrix'});
  h.document.getElementById('present-compare-toggle').click();
  assert.equal(h.app.cards.has('r0-c2'), false);
  const first = h.app.cards.get('r0-c0').querySelector('.option-button'); first.click(); h.flush();
  first.querySelector('img').dispatchEvent({type: 'error'}); h.flush();
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false); assert.equal(h.app.selected.size, 0);
  assert.equal(h.app.cards.has('r0-c0'), false);
  assert.equal(h.document.getElementById('present-compare-now').disabled, true);
});

test('Matrix comparison footers and decision footers are hidden while image selection is visible', () => {
  const h = boot(dataset(1, 2), {layout: 'matrix'});
  for (const select of h.app.selectButtons.values()) assert.equal(select.hidden, true, 'duplicate Matrix comparison controls are hidden semantically');
  const css = source('presentation.css');
  assert.match(css, /\.studio-experience #matrix \.select-button,\.studio-experience #matrix \.dec-action \{ display:none!important; \}/);
  assert.match(css, /body\.studio-experience \.compare-tray \{ display:none!important; \}/);
  assert.match(css, /#matrix \.option-button\[aria-pressed=true\]::after \{ content:"✓"; background:#dce7ed; \}/);
});
