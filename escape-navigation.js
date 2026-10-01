/* One Escape owner across the workspace, Premium chrome and inert previews. */
(function(root) {
  'use strict';
  const KEY = '__MATIZ_ESCAPE_NAVIGATION__';
  function ownerOf(win) {
    let owner = win;
    try { while (owner.parent && owner.parent !== owner && owner.parent.document) owner = owner.parent; } catch { /* inaccessible parent */ }
    return owner;
  }
  function create(owner) {
    const documents = new Map(), watchedFrames = new WeakSet(), opened = new WeakMap(), forwarded = new WeakSet();
    let sequence = 0, stopped = false, held = false;
    const isDialog = node => node?.tagName?.toLowerCase() === 'dialog';
    function mutations(records) {
      for (const record of records) {
        if (record.type === 'attributes' && isDialog(record.target)) {
          if (record.target.open) opened.set(record.target, ++sequence); else opened.delete(record.target);
        } else for (const node of record.addedNodes || []) {
          const dialogs = [...(isDialog(node) ? [node] : []), ...(node.querySelectorAll?.('dialog[open]') || [])];
          for (const dialog of dialogs) if (dialog.open && !opened.has(dialog)) opened.set(dialog, ++sequence);
        }
      }
    }
    function bind(doc, depth) {
      if (documents.has(doc)) { documents.get(doc).depth = depth; return; }
      const listener = event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || forwarded.has(event)) return;
        if (!event.repeat) held = false;
        if (!event.repeat || !held) {
          if (!route(doc)) { Promise.resolve().then(() => { if (event.defaultPrevented) held = true; }); return; }
          held = true;
        }
        event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
      };
      const released = event => { if (event.key === 'Escape') held = false; };
      doc.addEventListener('keydown', listener, {capture:true});
      doc.addEventListener('keyup', released, {capture:true});
      const Observer = doc.defaultView?.MutationObserver;
      const observer = Observer ? new Observer(records => { mutations(records); scan(); }) : null;
      observer?.observe(doc, {subtree:true, childList:true, attributes:true, attributeFilter:['open'], attributeOldValue:true});
      documents.set(doc, {listener, released, observer, depth});
      for (const dialog of doc.querySelectorAll('dialog[open]')) if (!opened.has(dialog)) opened.set(dialog, ++sequence);
    }
    function scan() {
      if (stopped) return;
      const visited = new Set();
      function visit(doc, depth) {
        if (!doc || visited.has(doc)) return;
        visited.add(doc); bind(doc, depth);
        for (const frame of doc.querySelectorAll('iframe')) {
          if (!watchedFrames.has(frame)) { watchedFrames.add(frame); frame.addEventListener('load', scan); }
          try { visit(frame.contentDocument, depth + 1); } catch { /* cross-origin and opaque sandboxes stay isolated */ }
        }
      }
      visit(owner.document, 0);
      for (const [doc, binding] of documents) if (!visited.has(doc)) {
        doc.removeEventListener('keydown', binding.listener, {capture:true}); doc.removeEventListener('keyup', binding.released, {capture:true}); binding.observer?.disconnect(); documents.delete(doc);
      }
    }
    function topDialog(parent) {
      const candidates = [];
      for (const [doc, binding] of documents) {
        mutations(binding.observer?.takeRecords() || []);
        if ((binding.depth === 0) !== parent) continue;
        for (const dialog of doc.querySelectorAll('dialog[open]')) {
          if (!opened.has(dialog)) opened.set(dialog, ++sequence);
          candidates.push(dialog);
        }
      }
      return candidates.sort((a, b) => opened.get(b) - opened.get(a))[0] || null;
    }
    function cancel(dialog) {
      // Native requestClose and the fallback both preserve saving/draft guards.
      if (typeof dialog.requestClose === 'function') { dialog.requestClose(); return true; }
      const Event = dialog.ownerDocument.defaultView.Event;
      const event = new Event('cancel', {cancelable:true});
      const allowed = dialog.dispatchEvent(event);
      if (allowed && dialog.open) dialog.close();
      return true;
    }
    function route(source) {
      scan();
      const parent = topDialog(true); if (parent) return cancel(parent);
      const doc = owner.document, menu = doc.getElementById('shell-menu');
      if (doc.body?.classList.contains('nav-open') && menu) { menu.click(); menu.focus(); return true; }
      const child = topDialog(false); if (child) return cancel(child);
      // Reuse the core's View → picking → Focus precedence. A cloned key is
      // marked before dispatch so this capture listener cannot forward itself.
      const core = [...documents.keys()].find(candidate => candidate.defaultView?.MATRIX_APP);
      if (!core || core === source) return false;
      const event = new core.defaultView.KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true, cancelable:true});
      forwarded.add(event); core.dispatchEvent(event);
      return event.defaultPrevented;
    }
    scan();
    return Object.freeze({refresh:scan, route, destroy() { stopped = true; for (const [doc, binding] of documents) { doc.removeEventListener('keydown', binding.listener, {capture:true}); doc.removeEventListener('keyup', binding.released, {capture:true}); binding.observer?.disconnect(); } documents.clear(); }});
  }
  function install(win) {
    const owner = ownerOf(win);
    if (!owner[KEY]) Object.defineProperty(owner, KEY, {value:create(owner), configurable:true});
    else owner[KEY].refresh();
    return owner[KEY];
  }
  const api = Object.freeze({create, install});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EscapeNavigation = api; install(root); }
})(typeof window === 'object' ? window : globalThis);
