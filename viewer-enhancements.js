(() => {
  'use strict';
  const app = window.MATRIX_APP;
  const viewer = document.getElementById('viewer');
  const content = document.getElementById('viewer-content');
  const data = app && (app.data || window.MATRIX_DATA);
  if (!app || typeof app.openViewer !== 'function' || !viewer || !content || !data
    || !Array.isArray(data.cells) || !Array.isArray(data.rows) || !Array.isArray(data.columns)) return;

  const $ = id => document.getElementById(id);
  const byId = new Map(data.cells.map(cell => [cell.id, cell]));
  const byPosition = new Map(data.cells.map(cell => [`${cell.row}|${cell.column}`, cell]));
  // Browse in the same row and column order as the matrix.
  const order = [];
  for (const row of data.rows) {
    for (const column of data.columns) {
      const cell = byPosition.get(`${row.id}|${column.id}`);
      if (cell) order.push(cell);
    }
  }
  const orderIndex = new Map(order.map((cell, index) => [cell.id, index]));
  const broken = new Set();
  let lastIds = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function glyph(text, className = 'vex-glyph') {
    const node = element('span', className, text);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function names(cell) {
    return typeof app.names === 'function' ? app.names(cell) : {
      row: app.rows?.get(cell.row)?.name || cell.row,
      column: app.columns?.get(cell.column)?.name || cell.column
    };
  }
  function describe(cell) {
    if (typeof app.describe === 'function') return app.describe(cell);
    const n = names(cell);
    return `${n.row} · ${n.column}`;
  }
  function usable(cell) {
    if (!cell || broken.has(cell.id)) return false;
    return typeof app.isReady === 'function' ? Boolean(app.isReady(cell)) : cell.status === 'ready' && Boolean(cell.src);
  }
  function favoritesApi() {
    const api = window.MatrixFavorites;
    return api && typeof api.has === 'function' && typeof api.toggle === 'function' ? api : null;
  }
  function isFavorite(id) {
    try { return Boolean(favoritesApi()?.has(id)); } catch { return false; }
  }
  function favoritesOnly() {
    const api = favoritesApi();
    try { return Boolean(api && typeof api.isActive === 'function' && api.isActive()); } catch { return false; }
  }
  function plural(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }
  function slug(text) {
    return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function fileName(cell) {
    if (typeof cell.filename === 'string' && cell.filename.trim()) return cell.filename.trim().split(/[\\/]/).pop();
    const path = String(cell.src || '').split(/[?#]/)[0];
    const extension = (path.match(/\.(?:png|jpe?g|webp|gif|avif)$/i) || [''])[0].toLowerCase();
    const n = names(cell);
    const base = [slug(n.row), slug(n.column)].filter(Boolean).join('--') || slug(cell.id) || 'option';
    return `${base}${extension}`;
  }

  function stepButton(id, symbol, text, symbolFirst) {
    const button = element('button', 'vex-step');
    button.type = 'button';
    button.id = id;
    button.dataset.vexFocus = id;
    const words = element('span', '', text);
    if (symbolFirst) button.append(glyph(symbol), words);
    else button.append(words, glyph(symbol));
    return button;
  }
  const bar = element('div', 'vex-bar');
  bar.hidden = true;
  const browse = element('div', 'vex-browse');
  browse.setAttribute('role', 'group');
  browse.setAttribute('aria-label', 'Browse options');
  const prev = stepButton('vex-prev', '‹', 'Previous', true);
  prev.setAttribute('aria-keyshortcuts', 'ArrowLeft');
  const next = stepButton('vex-next', '›', 'Next', false);
  next.setAttribute('aria-keyshortcuts', 'ArrowRight');
  const position = element('p', 'vex-position');
  position.id = 'vex-position';
  const count = element('strong');
  const scope = element('span');
  const keys = element('span', 'vex-keys');
  keys.setAttribute('aria-hidden', 'true');
  keys.append(' · ', element('kbd', '', '←'), element('kbd', '', '→'));
  position.append(count, scope, keys);
  browse.append(prev, position, next);

  const compare = element('div', 'vex-compare');
  compare.setAttribute('role', 'group');
  compare.setAttribute('aria-label', 'Comparison');
  const relation = element('p', 'vex-relation');
  relation.id = 'vex-relation';
  const swap = stepButton('vex-swap', '⇄', 'Swap sides', true);
  compare.append(relation, swap);
  bar.append(browse, compare);
  content.before(bar);

  const live = element('p', 'vex-sr');
  live.id = 'vex-live';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  viewer.append(live);
  function say(text) { live.textContent = text; }

  function toCell(item) {
    if (typeof item === 'string') return byId.get(item) || null;
    return item && typeof item === 'object' && item.id ? byId.get(item.id) || item : null;
  }
  function shownCells() {
    const figures = content.querySelectorAll('.viewer-figure').length;
    const candidates = [];
    if (typeof app.getViewerCells === 'function') {
      try { candidates.push(app.getViewerCells()); } catch { /* Fall back to the last opened ids. */ }
    }
    candidates.push(lastIds);
    for (const raw of candidates) {
      if (!Array.isArray(raw)) continue;
      const list = raw.map(toCell).filter(Boolean);
      if (list.length && list.length === figures) return list;
    }
    return [];
  }
  function rescueFocus() {
    const star = [...content.querySelectorAll('.vex-fav')].find(node => !node.hidden);
    (star || $('close-viewer'))?.focus();
  }

  function enhance() {
    const shown = shownCells();
    content.querySelectorAll('.viewer-figure').forEach((figure, index) => {
      const cell = shown[index];
      if (!cell || figure.querySelector('.vex-actions')) return;
      const actions = element('div', 'vex-actions');
      if (favoritesApi()) {
        const star = element('button', 'vex-fav');
        star.type = 'button';
        star.dataset.vexFocus = `favorite-${index}`;
        star.dataset.vexId = cell.id;
        star.setAttribute('aria-label', `Favorite ${describe(cell)}`);
        star.setAttribute('aria-pressed', 'false');
        star.append(glyph('☆', 'vex-star'), element('span', '', 'Favorite'));
        star.addEventListener('click', () => toggleFavorite(cell));
        actions.append(star);
      }
      if (cell.src) {
        const offlineFile = window.location.protocol === 'file:';
        const saveLabel = offlineFile ? 'Open image file' : 'Save image';
        const save = element('a', 'vex-save');
        save.href = cell.src;
        if (!offlineFile) save.download = fileName(cell);
        if (offlineFile) save.target = '_blank';
        save.rel = 'noopener';
        save.dataset.vexFocus = `save-${index}`;
        save.setAttribute('aria-label', `${saveLabel}: ${describe(cell)}`);
        if (offlineFile) save.title = 'Open the original PNG in a separate tab';
        save.append(glyph(offlineFile ? '↗' : '↓'), element('span', '', saveLabel));
        actions.append(save);
      }
      figure.append(actions);
      watchImage(figure, cell);
    });
  }
  function watchImage(figure, cell) {
    const img = figure.querySelector('img');
    if (!img) return;
    const src = img.getAttribute('src') || '';
    const alreadyFailed = src && img.complete && img.naturalWidth === 0 && !/\.svg(?:[?#]|$)/i.test(src);
    if (broken.has(cell.id) || alreadyFailed) markBroken(figure, cell, img);
    else img.addEventListener('error', () => {
      // A missing optional detail image does not make the original unavailable.
      if (cell.detail && img.getAttribute('src') === cell.detail && !img.dataset.detailFailed) {
        img.dataset.detailFailed = 'true';
        figure.classList.remove('has-detail-image');
        img.src = cell.src;
        img.alt = `${describe(cell)} full image`;
        say('Detail image unavailable. Showing the original image.');
        return;
      }
      markBroken(figure, cell, img); sync();
    });
  }
  function markBroken(figure, cell, img) {
    broken.add(cell.id);
    app.markImageFailed?.(cell.id);
    if (figure.classList.contains('vex-broken')) return;
    figure.classList.add('vex-broken');
    img.hidden = true;
    (img.parentElement || figure).append(element('div', 'vex-missing', 'Image unavailable. This file could not be loaded.'));
    const save = figure.querySelector('.vex-save');
    if (save) {
      const hadFocus = document.activeElement === save;
      save.replaceWith(element('span', 'vex-save-off', 'Save unavailable'));
      if (hadFocus) rescueFocus();
    }
  }

  function browseState(current) {
    const favorites = favoritesOnly();
    const savedScope = favorites ? favoritesApi()?.getScope?.() : null;
    const scopeIds = savedScope ? new Set(savedScope.ids) : null;
    const list = order.filter(cell => usable(cell) && (!favorites || (scopeIds ? scopeIds.has(cell.id) : isFavorite(cell.id))) && (!window.StudioDecisions || StudioDecisions.matches(cell.id)));
    const at = list.findIndex(cell => cell.id === current.id);
    let before = null;
    let after = null;
    if (at >= 0) {
      if (list.length > 1) {
        before = list[(at - 1 + list.length) % list.length];
        after = list[(at + 1) % list.length];
      }
    } else if (list.length) {
      // The current option left the list (unstarred or failed): step to its neighbours in matrix order.
      const here = orderIndex.has(current.id) ? orderIndex.get(current.id) : -1;
      after = list.find(cell => orderIndex.get(cell.id) > here) || list[0];
      before = [...list].reverse().find(cell => orderIndex.get(cell.id) < here) || list[list.length - 1];
    }
    return { favorites, savedScope, list, at, before, after };
  }
  function setStep(button, target, name) {
    const hadFocus = document.activeElement === button;
    button.disabled = !target;
    button.setAttribute('aria-label', name);
    if (target) button.title = describe(target);
    else button.removeAttribute('title');
    if (hadFocus && button.disabled) rescueFocus();
  }
  function syncBrowse(current) {
    const state = browseState(current);
    const namedList = state.savedScope?.type === 'list';
    const noun = state.favorites && !namedList ? 'favorite' : 'option';
    if (state.at >= 0) {
      count.textContent = `${state.at + 1} of ${state.list.length}`;
      scope.textContent = namedList ? state.savedScope.name : state.favorites ? 'Favorites only' : 'All ready options';
    } else {
      count.textContent = state.list.length ? plural(state.list.length, noun) : `No ${noun}s to browse`;
      if (broken.has(current.id)) scope.textContent = 'This image is unavailable';
      else if (state.favorites && !namedList && !isFavorite(current.id)) scope.textContent = 'This option isn’t a favorite';
      else scope.textContent = 'Not in the browse list';
    }
    setStep(prev, state.before, `Previous ${noun}`);
    setStep(next, state.after, `Next ${noun}`);
  }
  function syncCompare([left, right]) {
    const a = names(left);
    const b = names(right);
    let title;
    let detail;
    const project = window.ProjectStore?.get();
    const rows = project?.rowsLabel?.toLowerCase() || 'rows';
    const columns = project?.columnsLabel?.toLowerCase() || 'columns';
    if (left.row === right.row && left.column !== right.column) {
      title = `Same ${rows} · compare ${columns}`;
      detail = `${a.row}: ${a.column} on the left, ${b.column} on the right`;
    } else if (left.column === right.column && left.row !== right.row) {
      title = `Same ${columns} · compare ${rows}`;
      detail = `${a.column}: ${a.row} on the left, ${b.row} on the right`;
    } else if (left.row === right.row) {
      title = 'Same combination';
      detail = 'Both images use the same row and column.';
    } else {
      title = 'Both variables differ';
      detail = 'To judge one change at a time, pick two from the same row or column.';
    }
    relation.replaceChildren(element('strong', '', title), element('span', '', detail));
  }
  function syncStars() {
    const available = Boolean(favoritesApi());
    for (const star of content.querySelectorAll('.vex-fav')) {
      const active = available && isFavorite(star.dataset.vexId);
      star.hidden = !available;
      star.setAttribute('aria-pressed', String(active));
      star.querySelector('.vex-star').textContent = active ? '★' : '☆';
    }
  }
  function sync() {
    const shown = shownCells();
    bar.hidden = shown.length !== 1 && shown.length !== 2;
    browse.hidden = shown.length !== 1;
    compare.hidden = shown.length !== 2;
    if (shown.length === 1) syncBrowse(shown[0]);
    if (shown.length === 2) syncCompare(shown);
    syncStars();
  }

  function show(chosen) {
    if (!viewer.open || !chosen.length) return;
    const faceDetail = viewer.classList.contains('face-detail');
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.vexFocus : undefined;
    lastIds = chosen.map(cell => cell.id);
    // No opener while open: root keeps the original opener for close focus.
    app.openViewer(chosen);
    enhance();
    if (viewer.classList.contains('face-detail') !== faceDetail) $(faceDetail ? 'face-detail-button' : 'full-portrait-button')?.click();
    sync();
    const target = (focusKey && viewer.querySelector(`[data-vex-focus="${focusKey}"]`))
      || (active?.isConnected && viewer.contains(active) ? active : null);
    if (target && !target.disabled && !target.hidden) target.focus();
  }
  function step(direction) {
    const shown = shownCells();
    if (shown.length !== 1) return;
    const state = browseState(shown[0]);
    const target = direction < 0 ? state.before : state.after;
    if (!target) return;
    show([target]);
    say(`${describe(target)}. ${count.textContent}, ${scope.textContent}.`);
  }
  function toggleFavorite(cell) {
    const api = favoritesApi();
    if (!api) return;
    try { api.toggle(cell.id); } catch { /* The companion module owns storage errors; the star shows the real state. */ }
    sync();
    if (favoritesOnly() && !isFavorite(cell.id)) say(favoritesApi()?.getScope?.().type === 'list' ? 'Removed from favorites. This option remains in the saved list.' : 'Removed from favorites. It stays open; Previous and Next browse the remaining favorites.');
  }

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  swap.addEventListener('click', () => {
    const shown = shownCells();
    if (shown.length !== 2) return;
    show([shown[1], shown[0]]);
    say(`Sides swapped. Left: ${describe(shown[1])}. Right: ${describe(shown[0])}.`);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (!viewer.open || bar.hidden || browse.hidden || event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"])')) return;
    const dialog = target?.closest('dialog');
    if (dialog && dialog !== viewer) return;
    const button = event.key === 'ArrowLeft' ? prev : next;
    if (button.disabled) return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  });
  document.addEventListener('matrix:vieweropen', event => {
    const ids = event.detail?.ids;
    if (Array.isArray(ids)) lastIds = ids.slice();
    enhance();
    sync();
  });
  document.addEventListener('matrix:favoriteschange', () => { if (viewer.open) sync(); });
  document.addEventListener('studio:listscopechange', () => { if (viewer.open) sync(); });
  document.addEventListener('studio:listschange', () => { if (viewer.open) sync(); });
  document.addEventListener('matrix:filterchange', () => { if (viewer.open) sync(); });
  document.addEventListener('studio:decisionfilter', () => { if (viewer.open) sync(); });
  viewer.addEventListener('close', () => say(''));
})();
