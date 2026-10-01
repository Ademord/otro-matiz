(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if ($('fav-bar')) return;
  const app = window.MATRIX_APP;
  const wrap = $('matrix-wrap');
  if (!app || !(app.cells instanceof Map) || !(app.cards instanceof Map) || !(app.selected instanceof Set) || !wrap) {
    if (!window.MatrixFavorites) window.MatrixFavorites = Object.freeze({ has: () => false, ids: () => [], toggle: () => false, isActive: () => false, getScope: () => ({ type: 'favorites', id: null, name: 'All favorites', ids: [] }), visibleIds: () => [], getSelection: () => [], openList: () => false, openInbox: () => false });
    return;
  }

  const nav = $('matrix-navigation');
  const hint = $('scroll-hint');
  const viewer = $('viewer');
  const STORAGE_KEY = 'visual-matrix.' + (window.MATRIX_DATA?.meta?.id || 'default') + '.favorites.v1';
  const MAX_STORED = 1000;
  const NAME_MAX = 120;
  const STORAGE_WARNING = 'This browser isn’t saving favorites, so they’ll reset when the page closes.';
  const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sourceCells = Array.isArray(app.data?.cells) ? app.data.cells : [...app.cells.values()];
  const order = [...new Set(sourceCells.map(cell => cell?.id))].filter(id => app.cells.has(id));
  const failedDetails = new Set();
  const starButtons = new Map();
  const entries = new Map();
  const bulk = new Set();
  let storageOk = true;
  let warned = false;
  let store = readStored() || new Set();
  let active = false;
  let saved = null;
  let rendered = [];
  let currentIds = [];
  let recoveryId = null;
  let undo = null; // {text, label, run}
  let lastSignature = null;
  let previousSelection = new Set(app.selected);
  let saveVersion = 0;
  let pendingSaves = 0;
  let projectId = window.ProjectStore?.get().id || null;
  let scopeId = null; // null = All favorites inbox
  let rendering = false;
  let renderAgain = false;

  const lists = () => window.StudioLists || null;
  function allLists() { try { return lists()?.all() || []; } catch { return []; } }
  function getList(id) { try { return id == null ? null : lists()?.get(id) || null; } catch { return null; } }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text) {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  }
  function starIcon(className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', STAR_PATH);
    svg.append(path);
    return svg;
  }
  function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }
  function usable(id) {
    const cell = app.cells.get(id);
    return Boolean(cell) && app.isReady(cell);
  }
  function has(id) { return store.has(id) && usable(id); }
  function readyIds() { return order.filter(has); }
  function matches(id) {
    try { return typeof window.StudioDecisions?.matches === 'function' ? window.StudioDecisions.matches(id) !== false : true; } catch { return true; }
  }
  function scopeBase() {
    const list = getList(scopeId);
    if (!list) return readyIds();
    const members = new Set(list.cellIds);
    return order.filter(id => members.has(id) && usable(id));
  }

  function validId(value) {
    return (typeof value === 'string' && value.length > 0 && value.length <= 200) || (typeof value === 'number' && Number.isFinite(value));
  }
  function readStored() {
    if (window.ProjectStore) {
      storageOk = ProjectStore.status().persistent;
      return new Set(ProjectStore.get().favorites || []);
    }
    let raw;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch { storageOk = false; return null; }
    if (raw === null) return new Set();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter(validId).slice(0, MAX_STORED));
    } catch { /* Corrupt value: start empty; the next change replaces it. */ }
    return new Set();
  }
  function persist() {
    if (window.ProjectStore) {
      const ids = [...store];
      const originId = ProjectStore.get().id;
      const version = ++saveVersion;
      pendingSaves++;
      // Enqueue immediately, so a project switch cannot overtake this star edit.
      ProjectStore.update(project => {
        if (project.id !== originId) throw new Error('The active project changed before favorites could be saved.');
        return {favorites: ids};
      }).then(() => {
        if (ProjectStore.get().id !== originId) return;
        storageOk = ProjectStore.status().persistent;
        storageNote.hidden = storageOk;
        if (version === saveVersion) store = new Set(ProjectStore.get().favorites || []);
      }).catch(error => {
        if (ProjectStore.get().id !== originId) return;
        if (version === saveVersion) store = new Set(ProjectStore.get().favorites || []);
        storageOk = false;
        storageNote.hidden = false;
        app.announce(`Favorites could not be saved: ${error.message}`);
      }).finally(() => { pendingSaves--; render(); });
      storageOk = ProjectStore.status().persistent;
      storageNote.hidden = storageOk;
      return storageOk;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...store].slice(-MAX_STORED)));
      storageOk = true;
    } catch { storageOk = false; } // Quota, security or disabled storage: keep favorites for this session.
    storageNote.hidden = storageOk;
    return storageOk;
  }

  const bar = element('div', 'fav-bar');
  bar.id = 'fav-bar';
  const switcher = element('div', 'fav-switch');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Gallery view');
  const allButton = button('', 'All options');
  const favButton = button('');
  const count = element('span', 'fav-count', '0');
  favButton.append(starIcon('fav-switch-icon'), document.createTextNode('Favorites '), count);
  switcher.append(allButton, favButton);
  const tip = element('p', 'fav-bar-note', 'Tap the star on any option to save it to Favorites.');
  const storageNote = element('p', 'fav-bar-note fav-warning', STORAGE_WARNING);
  storageNote.hidden = true;
  bar.append(switcher, tip, storageNote);

  const panel = element('section', 'fav-panel');
  panel.id = 'fav-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'fav-title');

  // Saved lists picker: "All favorites" is always first and always reachable.
  const listNav = element('nav', 'fav-lists');
  listNav.setAttribute('aria-label', 'Favorites and saved lists');
  const listNavTitle = element('p', 'fav-lists-title', 'Saved lists');
  const listRow = element('ul', 'fav-lists-row');
  listRow.setAttribute('role', 'list');
  const listStatus = element('p', 'fav-lists-status');
  listStatus.hidden = true;
  listNav.append(listNavTitle, listRow, listStatus);

  const head = element('div', 'fav-head');
  const headText = element('div', 'fav-head-text');
  const kicker = element('p', 'fav-kicker');
  kicker.hidden = true;
  const title = element('h2', 'fav-title', 'Your favorites');
  title.id = 'fav-title';
  const guide = element('p', 'fav-guide');
  headText.append(kicker, title, guide);
  const headActions = element('div', 'fav-head-actions');
  const compare = button('fav-compare', 'Compare favorites');
  compare.hidden = true;
  const listTools = element('div', 'fav-list-tools');
  listTools.setAttribute('role', 'group');
  listTools.setAttribute('aria-label', 'List actions');
  listTools.hidden = true;
  const renameBtn = button('fav-tool', 'Rename');
  const duplicateBtn = button('fav-tool', 'Duplicate');
  const briefBtn = button('fav-tool', 'Create brief');
  const deleteBtn = button('fav-tool fav-tool-danger', 'Delete list');
  listTools.append(renameBtn, duplicateBtn, briefBtn, deleteBtn);
  headActions.append(compare, listTools);
  head.append(headText, headActions);

  // Bulk selection toolbar, separate from the two-image comparison selection.
  const bulkBar = element('div', 'fav-bulk');
  bulkBar.setAttribute('role', 'group');
  bulkBar.setAttribute('aria-label', 'Select options for a saved list');
  const allLabel = element('label', 'fav-bulk-all');
  const allBox = element('input');
  allBox.type = 'checkbox';
  const allText = element('span', '', 'Select all shown');
  allLabel.append(allBox, allText);
  const bulkCount = element('span', 'fav-bulk-count');
  bulkCount.setAttribute('aria-live', 'polite');
  const clearBtn = button('fav-tool', 'Clear selection');
  const saveBtn = button('fav-tool fav-tool-primary', 'Save as list…');
  const addBtn = button('fav-tool', 'Add to list…');
  const removeBtn = button('fav-tool fav-tool-danger', 'Remove from this list');
  bulkBar.append(allLabel, bulkCount, clearBtn, saveBtn, addBtn, removeBtn);

  const notice = element('div', 'fav-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  const noticeText = element('span', 'fav-notice-text');
  const undoButton = button('fav-undo', 'Undo');
  notice.append(noticeText, undoButton);
  const grid = element('ul', 'fav-grid');
  grid.setAttribute('role', 'list');
  const empty = element('div', 'fav-empty');
  empty.hidden = true;
  const emptyTitle = element('h3', 'fav-empty-title');
  const emptyText = element('p', 'fav-empty-text');
  const emptyAction = button('fav-empty-action', 'Browse all options');
  empty.append(starIcon('fav-empty-icon'), emptyTitle, emptyText, emptyAction);
  panel.append(listNav, head, bulkBar, notice, grid, empty);
  (hint || nav || wrap).before(bar);
  wrap.after(panel);

  // Accessible native dialog for create / rename / duplicate / add-to.
  const dialog = element('dialog', 'fav-dialog');
  dialog.setAttribute('aria-labelledby', 'fav-dialog-title');
  const form = element('form', 'fav-dialog-form');
  form.method = 'dialog';
  form.noValidate = true;
  const dTitle = element('h2', 'fav-dialog-title');
  dTitle.id = 'fav-dialog-title';
  const dText = element('p', 'fav-dialog-text');
  const nameField = element('div', 'fav-field');
  const nameLabel = element('label', '', 'List name');
  nameLabel.htmlFor = 'fav-list-name';
  const nameInput = element('input');
  nameInput.id = 'fav-list-name';
  nameInput.maxLength = NAME_MAX;
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('aria-describedby', 'fav-dialog-error');
  nameField.append(nameLabel, nameInput);
  const pickField = element('div', 'fav-field');
  const pickLabel = element('label', '', 'Existing list');
  pickLabel.htmlFor = 'fav-list-pick';
  const pickSelect = element('select');
  pickSelect.id = 'fav-list-pick';
  pickSelect.setAttribute('aria-describedby', 'fav-dialog-error');
  pickField.append(pickLabel, pickSelect);
  const dError = element('p', 'fav-dialog-error');
  dError.id = 'fav-dialog-error';
  dError.setAttribute('role', 'alert');
  const dActions = element('div', 'fav-dialog-actions');
  const dCancel = button('fav-tool', 'Cancel');
  const dSubmit = element('button', 'fav-tool fav-tool-primary', 'Save');
  dSubmit.type = 'submit';
  dActions.append(dCancel, dSubmit);
  form.append(dTitle, dText, nameField, pickField, dError, dActions);
  dialog.append(form);
  document.body.append(dialog);
  let dialogState = null; // {mode, listId, ids, opener, pending}

  function setStar(star, on) {
    star.setAttribute('aria-pressed', String(on));
    star.title = on ? 'Remove from favorites' : 'Add to favorites';
  }
  function makeStar(id) {
    const star = button('fav-star');
    star.dataset.favRole = 'star';
    star.setAttribute('aria-label', `Favorite ${app.describe(app.cells.get(id))}`);
    const disc = element('span', 'fav-star-disc');
    disc.append(starIcon('fav-star-icon'));
    star.append(disc);
    star.addEventListener('click', event => {
      event.stopPropagation(); // A star never opens or selects a option.
      toggle(id);
    });
    setStar(star, has(id));
    return star;
  }
  for (const [id, card] of app.cards) {
    if (!card?.isConnected || !app.cells.has(id)) continue;
    const star = makeStar(id);
    const open = card.querySelector('.option-button');
    card.insertBefore(star, open ? open.nextSibling : card.firstChild);
    starButtons.set(id, star);
  }

  function syncFraming(entry, id) {
    const cell = app.cells.get(id);
    let focused = false;
    try { focused = window.WorkspaceView?.get?.().galleryFraming === 'focused'; } catch { /* Full image is a safe fallback. */ }
    const detail = focused && cell.detail && cell.detail !== cell.src && !failedDetails.has(id);
    entry.open.classList.toggle('has-detail-image', Boolean(detail));
    const source = detail ? cell.detail : cell.src;
    if (entry.image.getAttribute('src') !== source) entry.image.src = source;
  }

  function buildCard(id) {
    const cell = app.cells.get(id);
    const n = app.names(cell);
    const label = app.describe(cell);
    const li = element('li', 'fav-item');
    li.dataset.favId = String(id);
    const card = element('div', 'fav-card');
    const pick = element('label', 'fav-pick');
    const box = element('input');
    box.type = 'checkbox';
    box.dataset.favRole = 'pick';
    box.setAttribute('aria-label', `Include ${label} in list selection`);
    box.addEventListener('change', () => {
      if (box.checked) bulk.add(id); else bulk.delete(id);
      syncBulk();
    });
    pick.append(box);
    const open = button('fav-open');
    open.dataset.favRole = 'open';
    open.setAttribute('aria-label', `Open ${label}`);
    const img = element('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (open.classList.contains('has-detail-image') && img.getAttribute('src') === cell.detail) {
        failedDetails.add(id);
        syncFraming(entry, id);
        app.announce(`Detail image unavailable for ${label}. Showing the full image.`);
        return;
      }
      app.markImageFailed(id);
      render();
    });
    const icon = element('span', 'fav-open-icon', '⤢');
    icon.setAttribute('aria-hidden', 'true');
    open.append(img, icon);
    open.addEventListener('click', () => app.openViewer([cell], open));
    const star = makeStar(id);
    const caption = element('p', 'fav-caption');
    caption.append(element('strong', '', n.row), element('span', '', n.column));
    const select = button('fav-select');
    select.dataset.favRole = 'select';
    select.setAttribute('aria-label', `Select ${label} for comparison`);
    const mark = element('span', 'fav-mark');
    mark.setAttribute('aria-hidden', 'true');
    const selectLabel = element('span', 'fav-select-label');
    select.append(mark, selectLabel);
    select.addEventListener('click', () => app.toggleSelection(cell));
    card.append(open, pick, star, caption, select);
    li.append(card);
    const entry = { li, card, open, star, select, mark, selectLabel, box, image: img };
    syncFraming(entry, id);
    return entry;
  }

  function syncSelection() {
    for (const [id, entry] of entries) {
      const on = app.selected.has(id);
      entry.select.setAttribute('aria-pressed', String(on));
      entry.mark.textContent = on ? '✓' : '';
      entry.selectLabel.textContent = on ? 'Comparing' : 'Compare';
      entry.card.classList.toggle('fav-is-selected', on);
    }
    const picked = [...app.selected];
    compare.hidden = !(picked.length === 2 || (picked.length === 0 && rendered.length === 2));
    compare.textContent = picked.length === 2 ? 'Compare selected' : 'Compare these two';
  }
  function syncBulk() {
    const shown = rendered.length;
    for (const [id, entry] of entries) {
      const on = bulk.has(id);
      entry.box.checked = on;
      entry.card.classList.toggle('fav-is-picked', on);
    }
    const n = bulk.size;
    bulkBar.hidden = !active || shown === 0;
    allBox.checked = shown > 0 && n === shown;
    allBox.indeterminate = n > 0 && n < shown;
    allBox.disabled = shown === 0;
    allText.textContent = `Select all ${shown} shown`;
    bulkCount.textContent = n ? `${n} selected for a list` : 'None selected';
    const service = Boolean(lists());
    clearBtn.disabled = !n;
    saveBtn.disabled = !n || !service;
    addBtn.disabled = !n || !service || allLists().filter(l => l.id !== scopeId).length === 0;
    removeBtn.hidden = !getList(scopeId);
    removeBtn.disabled = !n || !service;
  }
  function nearestKept(index, wanted) {
    for (let i = index + 1; i < rendered.length; i++) if (wanted.has(rendered[i])) return rendered[i];
    for (let i = index - 1; i >= 0; i--) if (wanted.has(rendered[i])) return rendered[i];
    return null;
  }
  function focusEntry(id, role) {
    const entry = entries.get(id);
    if (entry) return (entry[role] || entry.star).focus();
    if (active && !empty.hidden) return emptyAction.focus();
    const first = entries.get(rendered[0]);
    (first ? first.star : favButton).focus();
  }
  function focusLost() {
    const current = document.activeElement;
    if (!current || current === document.body || current === document.documentElement) return true;
    if (viewer?.open || dialog.open) return false;
    return !current.isConnected || current.getClientRects().length === 0;
  }

  function renderLists() {
    const service = lists();
    const saved = allLists();
    const focusedKey = document.activeElement?.closest?.('.fav-lists-row') ? document.activeElement.dataset.listKey : null;
    const rows = [{ key: '', name: 'All favorites', n: readyIds().length, unit: 'favorite' }]
      .concat(saved.map(l => ({ key: l.id, name: l.name, n: l.cellIds.length, unit: 'item' })));
    listRow.replaceChildren(...rows.map(row => {
      const li = element('li');
      const b = button('fav-list-chip');
      b.dataset.listKey = row.key;
      const current = (row.key || null) === (scopeId || null);
      b.setAttribute('aria-current', current ? 'true' : 'false');
      b.title = row.name;
      b.setAttribute('aria-label', `${row.name}, ${plural(row.n, row.unit)}`);
      b.append(element('span', 'fav-list-name', row.name), element('span', 'fav-list-n', String(row.n)));
      b.addEventListener('click', () => (row.key ? openList(row.key, true) : openInbox(true)));
      li.append(b);
      return li;
    }));
    listNavTitle.textContent = saved.length ? `Saved lists · ${saved.length}` : 'Saved lists';
    listStatus.hidden = Boolean(service) && saved.length > 0;
    listStatus.textContent = !service
      ? 'Saved lists are unavailable right now; stars and comparison still work.'
      : 'No saved lists yet. Select favorites below, then Save as list.';
    if (focusedKey !== null) listRow.querySelector(`[data-list-key="${CSS.escape(focusedKey)}"]`)?.focus();
  }

  function renderPanel(list, base) {
    const wanted = new Set(list);
    const focused = document.activeElement;
    let refocus = null;
    rendered.forEach((id, index) => {
      if (wanted.has(id)) return;
      const entry = entries.get(id);
      const neighbor = nearestKept(index, wanted);
      recoveryId = neighbor;
      if (entry?.li.contains(focused)) refocus = { id: neighbor, role: focused.dataset?.favRole || 'star' };
      entry?.li.remove();
      entries.delete(id);
    });
    list.forEach((id, index) => {
      let entry = entries.get(id);
      if (!entry) {
        entry = buildCard(id);
        entries.set(id, entry);
      }
      syncFraming(entry, id);
      const current = grid.children[index];
      if (current !== entry.li) grid.insertBefore(entry.li, current || null);
    });
    rendered = list;
    renderLists();

    const listObj = getList(scopeId);
    const total = list.length;
    const hidden = base.length - total;
    kicker.hidden = !listObj;
    kicker.textContent = 'Saved list';
    title.textContent = listObj ? listObj.name : 'All favorites';
    title.title = listObj ? listObj.name : '';
    listTools.hidden = !listObj;
    briefBtn.disabled = !listObj;
    let text;
    if (listObj) {
      const members = listObj.cellIds.length;
      const unstarred = listObj.cellIds.filter(id => !store.has(id)).length;
      const notReady = members - base.length;
      text = `${plural(members, 'item')} in this list`;
      if (unstarred) text += `, ${unstarred} no longer starred (still kept here)`;
      if (notReady) text += `, ${notReady} not ready`;
      text += '.';
    } else {
      const unavailable = [...store].filter(id => app.cells.has(id) && !usable(id)).length;
      text = `${plural(base.length, 'favorite')} in your inbox.${unavailable ? ` ${plural(unavailable, 'saved option')} not ready yet.` : ''}`;
    }
    if (hidden > 0) text += ` Showing ${total} that match your filters (${hidden} hidden).`;
    else if (total) text += ' Tick items to build a list, or use Compare on any two.';
    guide.textContent = text;
    grid.hidden = total === 0;
    empty.hidden = total > 0;
    if (!total) {
      emptyAction.hidden = false;
      if (base.length && hidden) {
        emptyTitle.textContent = 'Nothing matches your filters';
        emptyText.textContent = `${plural(base.length, 'item')} ${listObj ? 'in this list' : 'in Favorites'} ${base.length === 1 ? 'is' : 'are'} hidden by the current filters. Clear filters to see ${base.length === 1 ? 'it' : 'them'}.`;
        emptyAction.hidden = true;
      } else if (listObj) {
        emptyTitle.textContent = listObj.cellIds.length ? 'These list items aren’t ready right now' : 'This list is empty';
        emptyText.textContent = listObj.cellIds.length
          ? 'They will show here once their images load.'
          : 'Open All favorites, tick options, then use Add to list to fill it. You can still rename, duplicate or delete it above.';
        emptyAction.textContent = 'Open All favorites';
      } else {
        const unavailable = [...store].filter(id => app.cells.has(id) && !usable(id)).length;
        emptyTitle.textContent = unavailable ? 'Your saved favorites aren’t ready right now' : 'No favorites yet';
        emptyText.textContent = unavailable
          ? `${plural(unavailable, 'saved option')} ${unavailable === 1 ? 'is' : 'are'} still pending or couldn’t load.`
          : 'Tap the star on any option to keep it here. Then tick favorites to save them as a named list, or compare any two side by side.';
        emptyAction.textContent = 'Browse all options';
      }
    }
    notice.hidden = !undo;
    if (undo) {
      noticeText.textContent = undo.text;
      undoButton.setAttribute('aria-label', undo.label);
    }
    syncSelection();
    syncBulk();
    if (refocus) focusEntry(refocus.id, refocus.role);
  }

  function render() {
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      do {
        renderAgain = false;
        if (scopeId !== null && !getList(scopeId)) {
          // Deleted, imported away or project switched: fall back safely to the inbox.
          scopeId = null;
          bulk.clear();
        }
        const base = scopeBase();
        const list = base.filter(matches);
        const allowed = new Set(list);
        for (const id of bulk) if (!allowed.has(id)) bulk.delete(id); // No invisible accidental saves.
        currentIds = list;
        for (const [id, star] of starButtons) {
          if (!star.isConnected) { starButtons.delete(id); continue; }
          star.hidden = !usable(id);
          setStar(star, has(id));
        }
        const all = readyIds();
        count.textContent = String(all.length);
        tip.hidden = active || all.length > 0;
        if (active) renderPanel(list, base);
        const signature = JSON.stringify(all);
        if (signature !== lastSignature) {
          lastSignature = signature;
          document.dispatchEvent(new CustomEvent('matrix:favoriteschange', { detail: { ids: all.slice() } }));
        }
      } while (renderAgain);
    } finally { rendering = false; }
  }

  function setFavorite(id, on) {
    const cell = app.cells.get(id);
    if (on) store.add(id);
    else store.delete(id);
    undo = !on && active ? {
      text: `Removed ${app.describe(cell)} from favorites${scopeId ? ' (it stays in saved lists)' : ''}.`,
      label: `Undo removing ${app.describe(cell)}`,
      run: () => {
        if (!usable(id)) return;
        store.add(id);
        persist();
        render();
        focusEntry(id, 'star');
        app.announce(`Restored ${app.describe(cell)} to favorites.`);
      },
    } : undo;
    const persisted = persist();
    render();
    let message = `${on ? 'Added' : 'Removed'} ${app.describe(cell)} ${on ? 'to' : 'from'} favorites. ${plural(readyIds().length, 'favorite')} in this project.`;
    if (!on && active) message += ' Saved lists keep it. Use Undo above the grid to restore the star.';
    if (!persisted && !warned) {
      warned = true;
      message += ` ${STORAGE_WARNING}`;
    }
    app.announce(message);
    return on;
  }
  function toggle(id) {
    if (has(id)) return setFavorite(id, false);
    if (!usable(id)) return false;
    return setFavorite(id, true);
  }

  function restoreScroll() {
    if (active || !saved) return;
    wrap.scrollLeft = saved.left;
    wrap.scrollTop = saved.top;
  }
  function emitScope() {
    const scope = getScope();
    document.dispatchEvent(new CustomEvent('matrix:filterchange', { detail: { filter: active ? 'favorites' : 'all', active, ids: currentIds.slice(), scope } }));
  }
  function setActive(next) {
    if (next === active) return;
    active = next;
    if (active) {
      saved = { left: wrap.scrollLeft, top: wrap.scrollTop, wrapHidden: wrap.hidden, navHidden: nav ? nav.hidden : false };
      wrap.hidden = true;
      if (nav) nav.hidden = true;
      if (hint) hint.hidden = true;
      panel.hidden = false;
    } else {
      panel.hidden = true;
      grid.replaceChildren();
      entries.clear();
      rendered = [];
      recoveryId = null;
      undo = null;
      bulk.clear();
      wrap.hidden = saved ? saved.wrapHidden : false;
      if (nav) nav.hidden = saved ? saved.navHidden : false;
      restoreScroll();
      if (hint) hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
      // Layout observers may resize the table after unhiding; re-apply once unless something else scrolled meanwhile.
      const settled = { left: wrap.scrollLeft, top: wrap.scrollTop };
      requestAnimationFrame(() => {
        if (wrap.scrollLeft === settled.left && wrap.scrollTop === settled.top) restoreScroll();
      });
    }
    document.body.classList.toggle('fav-mode', active);
    allButton.setAttribute('aria-pressed', String(!active));
    favButton.setAttribute('aria-pressed', String(active));
    render();
    emitScope();
    app.announce(active ? `Showing ${plural(currentIds.length, scopeId ? 'item' : 'favorite')}.` : 'Showing all options.');
  }
  function setScope(id, announce) {
    const changed = (id || null) !== scopeId;
    if (changed) { scopeId = id || null; bulk.clear(); undo = null; }
    if (!active) { setActive(true); return true; }
    render();
    if (changed) {
      emitScope();
      if (announce) app.announce(`Showing ${scopeId ? `list ${title.textContent}` : 'All favorites'}: ${plural(currentIds.length, 'item')} shown. Compare selection is kept.`);
    }
    return true;
  }
  function openList(id, announce = true) {
    if (!getList(id)) return false;
    return setScope(id, announce);
  }
  function openInbox(announce = true) { return setScope(null, announce); }
  function getScope() {
    const list = getList(scopeId);
    return list
      ? { type: 'list', id: list.id, name: list.name, ids: list.cellIds.slice() }
      : { type: 'favorites', id: null, name: 'All favorites', ids: readyIds() };
  }

  function showUndo(next) { undo = next; render(); undoButton.focus(); }
  function fail(action, error) {
    app.announce(`${action} failed: ${error?.message || 'storage error'}. Nothing was changed.`);
    undo = null;
    render();
    listStatus.hidden = false;
    listStatus.textContent = `${action} failed: ${error?.message || 'storage error'}. Try again.`;
  }

  function openDialog(mode, opener) {
    delete dSubmit.dataset.label;
    const listObj = getList(scopeId);
    const ids = [...bulk];
    dialogState = { mode, opener, ids, listId: listObj?.id || null, pending: false };
    const others = allLists().filter(l => l.id !== scopeId);
    nameField.hidden = mode === 'add';
    pickField.hidden = mode !== 'add';
    dError.textContent = '';
    nameInput.removeAttribute('aria-invalid');
    if (mode === 'create') {
      dTitle.textContent = 'Save as a named list';
      dText.textContent = `${plural(ids.length, 'selected item')} will be saved. Favorites stay unchanged.`;
      nameInput.value = '';
      dSubmit.textContent = 'Save list';
    } else if (mode === 'rename') {
      dTitle.textContent = 'Rename list';
      dText.textContent = 'Only the name changes; members stay the same.';
      nameInput.value = listObj.name;
      dSubmit.textContent = 'Rename';
    } else if (mode === 'duplicate') {
      dTitle.textContent = 'Duplicate list';
      dText.textContent = `The copy gets the same ${plural(listObj.cellIds.length, 'item')} and can be edited independently.`;
      nameInput.value = `${listObj.name} copy`.slice(0, NAME_MAX);
      dSubmit.textContent = 'Duplicate';
    } else {
      dTitle.textContent = 'Add to an existing list';
      dText.textContent = `${plural(ids.length, 'selected item')} will be added. Items already in the list are kept once.`;
      pickSelect.replaceChildren(...others.map(l => {
        const o = element('option', '', `${l.name} (${plural(l.cellIds.length, 'item')})`);
        o.value = l.id;
        return o;
      }));
      dSubmit.textContent = 'Add';
    }
    setPending(false);
    dialog.showModal();
    (mode === 'add' ? pickSelect : nameInput).focus();
    if (mode !== 'add') nameInput.select();
  }
  function setPending(on) {
    if (dialogState) dialogState.pending = on;
    dSubmit.disabled = on;
    nameInput.disabled = on;
    pickSelect.disabled = on;
    form.setAttribute('aria-busy', String(on));
    if (on) dSubmit.dataset.label = dSubmit.textContent, dSubmit.textContent = 'Saving…';
    else if (dSubmit.dataset.label) dSubmit.textContent = dSubmit.dataset.label, delete dSubmit.dataset.label;
  }
  function closeDialog(focusTarget) {
    const opener = dialogState?.opener;
    dialogState = null;
    if (dialog.open) dialog.close();
    const target = focusTarget || opener;
    if (target?.isConnected && !target.disabled && target.getClientRects().length) target.focus();
    else if (active) (listRow.querySelector('[aria-current="true"]') || favButton).focus();
  }
  dCancel.addEventListener('click', () => { if (!dialogState?.pending) closeDialog(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!dialogState?.pending) closeDialog(); });
  nameInput.addEventListener('input', () => { dError.textContent = ''; nameInput.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = dialogState;
    if (!state || state.pending) return;
    const service = lists();
    if (!service) { dError.textContent = 'Saved lists are unavailable right now.'; return; }
    const name = nameInput.value.trim();
    if (state.mode !== 'add') {
      const problem = !name ? 'Enter a name for the list.' : name.length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.` : '';
      if (problem) { dError.textContent = problem; nameInput.setAttribute('aria-invalid', 'true'); nameInput.focus(); return; }
    } else if (!pickSelect.value) { dError.textContent = 'Choose a list.'; return; }
    setPending(true);
    try {
      let result, message;
      if (state.mode === 'create') {
        result = await service.create(name, state.ids);
        message = `Saved list “${result.name}” with ${plural(result.cellIds.length, 'item')}.`;
        bulk.clear();
      } else if (state.mode === 'rename') {
        result = await service.rename(state.listId, name);
        message = `Renamed list to “${result.name}”.`;
      } else if (state.mode === 'duplicate') {
        result = await service.duplicate(state.listId, name);
        message = `Created “${result.name}”, an independent copy. Showing it now.`;
        scopeId = result.id;
        bulk.clear();
      } else {
        const before = getList(pickSelect.value);
        const beforeIds = new Set(before?.cellIds || []);
        result = await service.add(pickSelect.value, state.ids);
        const added = state.ids.filter(id => !beforeIds.has(id)).length;
        message = `Added ${plural(added, 'new item')} to “${result.name}” (${plural(result.cellIds.length, 'item')} total).`;
        bulk.clear();
      }
      closeDialog(state.mode === 'duplicate' || state.mode === 'rename' ? title : null);
      render();
      if (state.mode === 'duplicate') emitScope();
      app.announce(message);
      if (state.mode === 'duplicate' || state.mode === 'rename') title.setAttribute('tabindex', '-1'), title.focus();
    } catch (error) {
      setPending(false);
      dError.textContent = `Couldn’t save: ${error?.message || 'storage error'}. Nothing was changed; try again.`;
      (state.mode === 'add' ? pickSelect : nameInput).focus();
    }
  });

  allBox.addEventListener('change', () => {
    if (allBox.checked) rendered.forEach(id => bulk.add(id)); else bulk.clear();
    syncBulk();
    app.announce(allBox.checked ? `Selected all ${plural(bulk.size, 'item')} shown.` : 'Cleared list selection.');
  });
  clearBtn.addEventListener('click', () => { bulk.clear(); syncBulk(); allBox.focus(); app.announce('Cleared list selection.'); });
  saveBtn.addEventListener('click', () => bulk.size && openDialog('create', saveBtn));
  addBtn.addEventListener('click', () => bulk.size && openDialog('add', addBtn));
  renameBtn.addEventListener('click', () => getList(scopeId) && openDialog('rename', renameBtn));
  duplicateBtn.addEventListener('click', () => getList(scopeId) && openDialog('duplicate', duplicateBtn));
  removeBtn.addEventListener('click', async () => {
    const service = lists();
    const listObj = getList(scopeId);
    if (!service || !listObj || !bulk.size) return;
    const ids = [...bulk];
    removeBtn.disabled = true;
    try {
      const result = await service.removeMembers(listObj.id, ids);
      bulk.clear();
      app.announce(`Removed ${plural(ids.length, 'item')} from “${result.name}”. Favorites and other lists are unchanged.`);
      showUndo({
        text: `Removed ${plural(ids.length, 'item')} from “${result.name}”.`,
        label: `Undo removing ${plural(ids.length, 'item')} from ${result.name}`,
        run: async () => {
          await service.add(listObj.id, ids);
          app.announce(`Restored ${plural(ids.length, 'item')} to “${result.name}”.`);
          render();
        },
      });
    } catch (error) { fail('Removing from list', error); }
  });
  deleteBtn.addEventListener('click', async () => {
    const service = lists();
    const listObj = getList(scopeId);
    if (!service || !listObj) return;
    deleteBtn.disabled = true;
    try {
      const snapshot = await service.remove(listObj.id);
      scopeId = null;
      bulk.clear();
      app.announce(`Deleted list “${listObj.name}”. Favorites are unchanged. Use Undo to bring it back.`);
      showUndo({
        text: `Deleted list “${listObj.name}” (${plural(listObj.cellIds.length, 'item')}).`,
        label: `Undo deleting list ${listObj.name}`,
        run: async () => {
          const back = await service.restore(snapshot);
          app.announce(`Restored list “${back?.name || listObj.name}”.`);
          openList(back?.id || snapshot.id, false);
        },
      });
      emitScope();
    } catch (error) { fail('Deleting the list', error); }
    finally { deleteBtn.disabled = false; }
  });
  briefBtn.addEventListener('click', () => {
    const listObj = getList(scopeId);
    if (!listObj) return;
    // Only the ID travels; receivers must resolve membership fresh from StudioLists.
    const event = new CustomEvent('studio:briefrequest', { detail: { listId: listObj.id }, cancelable: true });
    document.dispatchEvent(event);
    app.announce(event.defaultPrevented ? `Opening a brief for “${listObj.name}”.` : `Brief tools for “${listObj.name}” are opening in the files panel.`);
  });

  allButton.addEventListener('click', () => setActive(false));
  favButton.addEventListener('click', () => openInbox(true)); // Explicit Favorites always lands on the inbox.
  emptyAction.addEventListener('click', () => {
    if (scopeId && !(currentIds.length === 0 && scopeBase().length)) { openInbox(true); listRow.querySelector('[aria-current="true"]')?.focus(); return; }
    setActive(false);
    allButton.focus();
  });
  compare.addEventListener('click', () => {
    const picked = [...app.selected].filter(id => app.cells.has(id));
    const list = picked.length === 2 ? picked : rendered.length === 2 ? rendered : [];
    if (list.length === 2) app.openViewer(list.map(id => app.cells.get(id)), compare);
  });
  undoButton.addEventListener('click', async () => {
    const current = undo;
    if (undoButton.disabled) return;
    undoButton.disabled = true;
    undo = null;
    render();
    try {
      if (current) await current.run();
      if (focusLost() || document.activeElement === undoButton) {
        const target = entries.get(rendered[0])?.box || listRow.querySelector('[aria-current="true"]');
        target?.focus();
      }
    } catch (error) {
      fail('Undo', error);
      if (current) { undo = current; notice.hidden = false; undoButton.disabled = false; undoButton.focus(); }
    } finally { undoButton.disabled = false; }
  });

  document.addEventListener('matrix:selectionchange', () => {
    const before = previousSelection;
    previousSelection = new Set(app.selected);
    if (!rendering) syncSelection();
    if (!active) return;
    // Tray "Clear" / "×" can remove the focused control; land on the matching favorite instead of <body>.
    setTimeout(() => {
      if (!active || !focusLost()) return;
      const dropped = [...before].find(id => !app.selected.has(id) && entries.has(id));
      (dropped !== undefined ? entries.get(dropped).select : favButton).focus();
    });
  });
  document.addEventListener('studio:listschange', () => render());
  document.addEventListener('studio:change', () => {
    // Committed project changes (import, project switch): refresh stars unless our own writes are in flight.
    if (window.ProjectStore) {
      const project = ProjectStore.get();
      if (project.id !== projectId) {
        projectId = project.id;
        saveVersion++;
        scopeId = null; bulk.clear(); undo = null;
        if (dialog.open) closeDialog();
        store = new Set(project.favorites || []);
      } else if (pendingSaves === 0) store = new Set(project.favorites || []);
    }
    render();
  });
  document.addEventListener('studio:decisionfilter', () => render());
  document.addEventListener('matrix:imagefailed', () => render());
  document.addEventListener('workspace:preferenceschange', event => {
    if (event.detail?.changed?.includes('galleryFraming')) {
      for (const [id, entry] of entries) syncFraming(entry, id);
    }
  });
  viewer?.addEventListener('close', () => setTimeout(() => {
    if (active && focusLost()) focusEntry(recoveryId, 'open');
  }));
  $('matrix')?.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) setTimeout(render);
  }, true);
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = readStored();
    if (!next) return;
    store = next;
    render();
  });

  allButton.setAttribute('aria-pressed', 'true');
  favButton.setAttribute('aria-pressed', 'false');
  window.MatrixFavorites = Object.freeze({
    has: id => has(id),
    ids: () => readyIds(),
    toggle: id => toggle(id),
    isActive: () => active,
    getScope,
    visibleIds: () => currentIds.slice(),
    getSelection: () => [...bulk],
    openList: id => openList(id),
    openInbox: () => openInbox(),
    refresh: () => render(),
  });
  render();
})();
