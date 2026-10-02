'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', '..', name), 'utf8');

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
  const context = vm.createContext({ window, document, Element: Node, HTMLElement: Node, HTMLImageElement: Node, CSS: {escape: value => String(value)}, URL, URLSearchParams, location: window.location, CustomEvent,
    ProjectStore: window.ProjectStore, MatrixFavorites: favorites, StudioDecisions: decisions,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }), requestAnimationFrame: callback => frames.push(callback),
    addEventListener: (...args) => window.addEventListener(...args), setTimeout, clearTimeout, innerHeight: 800,
    StudioPresentation: null });
  vm.runInContext(source('source-links.js'), context);
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

module.exports = { dataset, boot };
