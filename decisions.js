(() => {
  'use strict';
  if (window.StudioDecisions) return;

  const STATUSES = ['unreviewed', 'considered', 'shortlisted', 'chosen', 'ruled-out'];
  const LABELS = { unreviewed: 'Unreviewed', considered: 'Considered', shortlisted: 'Shortlisted', chosen: 'Chosen', 'ruled-out': 'Ruled out' };
  const HINTS = {
    unreviewed: 'Not looked at closely yet',
    considered: 'Looked at, still open',
    shortlisted: 'A strong contender',
    chosen: 'Carry forward; several can be chosen',
    'ruled-out': 'Set aside',
  };
  const GLYPHS = { unreviewed: '○', considered: '◐', shortlisted: '●', chosen: '✓', 'ruled-out': '✕' };
  const NOTE_MAX = 4000;
  const $ = id => document.getElementById(id);

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
  function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }
  function store() {
    const s = window.ProjectStore;
    return s && typeof s.get === 'function' ? s : null;
  }
  function canSave() { return typeof store()?.update === 'function'; }
  function project() { try { return store()?.get() || null; } catch { return null; } }
  function persistence() {
    try {
      const s = store()?.status?.();
      if (s && typeof s === 'object') return { persistent: Boolean(s.persistent), message: String(s.message || '') };
    } catch { /* Status unavailable: report nothing rather than guess. */ }
    return null;
  }
  function readDecisions(p) {
    const map = p?.decisions;
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }
  function readLabels(p) {
    const clean = value => (typeof value === 'string' && value.trim() ? value.trim() : '');
    return { rows: clean(p?.rowsLabel) || 'Row', columns: clean(p?.columnsLabel) || 'Column' };
  }
  // Plain text only: normalise line breaks, drop control characters, cap length. Rendered via textContent/value.
  function cleanNote(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+$/gm, '')
      .trim()
      .slice(0, NOTE_MAX);
  }
  function fold(value) {
    return String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function start(app) {
    if ($('dec-dialog')) return;
    const data = app.data || window.MATRIX_DATA || {};
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const cols = Array.isArray(data.columns) ? data.columns : [];
    const positions = new Map();
    for (const cell of app.cells.values()) positions.set(`${cell.row}|${cell.column}`, cell.id);
    const order = [];
    for (const row of rows) {
      for (const col of cols) {
        const id = positions.get(`${row.id}|${col.id}`);
        if (id !== undefined) order.push(id);
      }
    }
    const drafts = new Map();
    const announce = text => { try { app.announce?.(text); } catch { /* Announcements are best effort. */ } };
    const initial = project();
    let decisionMap = readDecisions(initial);
    let labels = readLabels(initial);
    let lastVisible = [];
    let favGrid = null;
    let favObserver = null;
    let frame = 0;

    function syncProject(p) {
      decisionMap = readDecisions(p);
      labels = readLabels(p);
    }
    function decisionOf(id) {
      const raw = Object.prototype.hasOwnProperty.call(decisionMap, id) ? decisionMap[id] : null;
      return {
        status: raw && STATUSES.includes(raw.status) ? raw.status : 'unreviewed',
        note: typeof raw?.note === 'string' ? raw.note : '',
        privateNote: typeof raw?.privateNote === 'string' ? raw.privateNote : '',
      };
    }
    function describe(id) {
      const cell = app.cells.get(id);
      return cell ? app.describe(cell) : 'this option';
    }

    /* ---------- Filter controls ---------- */
    let mount = $('decision-controls');
    if (!mount) {
      mount = element('div');
      mount.id = 'decision-controls';
      const anchor = $('fav-bar') || $('scroll-hint') || $('matrix-navigation') || $('matrix-wrap');
      if (anchor) anchor.before(mount);
      else (document.querySelector('main') || document.body).append(mount);
    }
    mount.classList.add('dec-mount');
    const section = element('section', 'dec-controls');
    section.setAttribute('aria-labelledby', 'dec-controls-title');
    const head = element('div', 'dec-head');
    const heading = element('h2', 'dec-title', 'Review');
    heading.id = 'dec-controls-title';
    head.append(heading, element('p', 'dec-intro', 'Use the status button under each option to record a decision and notes, then narrow the view. Filters combine. A star keeps a favorite; it never sets a decision.'));

    const form = element('form', 'dec-filters');
    form.setAttribute('role', 'search');
    form.setAttribute('aria-label', 'Filter options');
    form.noValidate = true;
    function option(value, text) {
      const node = element('option', '', text);
      node.value = value;
      return node;
    }
    function field(id, labelText, control, extra) {
      const wrap = element('div', extra ? `dec-field ${extra}` : 'dec-field');
      const label = element('label', 'dec-field-label', labelText);
      label.htmlFor = id;
      control.id = id;
      wrap.append(label, control);
      form.append(wrap);
      return label;
    }
    const rowSelect = element('select', 'dec-input');
    rowSelect.append(option('', 'All'), ...rows.map(row => option(row.id, row.name || row.id)));
    const colSelect = element('select', 'dec-input');
    colSelect.append(option('', 'All'), ...cols.map(col => option(col.id, col.name || col.id)));
    const statusSelect = element('select', 'dec-input');
    statusSelect.append(option('', 'Any status'), ...STATUSES.map(status => option(status, LABELS[status])));
    const search = element('input', 'dec-input');
    search.type = 'search';
    search.placeholder = 'Names, descriptions or notes';
    search.autocomplete = 'off';
    search.maxLength = 200;
    const searchHint = element('span', 'dec-sr', 'Matches names, descriptions, statuses and your notes.');
    searchHint.id = 'dec-search-hint';
    search.setAttribute('aria-describedby', searchHint.id);
    const rowLabel = field('dec-filter-row', labels.rows, rowSelect);
    const colLabel = field('dec-filter-column', labels.columns, colSelect);
    field('dec-filter-status', 'Decision', statusSelect);
    field('dec-filter-search', 'Search', search, 'dec-field-search').after(searchHint);
    const reset = button('dec-reset', 'Reset filters');
    reset.disabled = true;
    form.append(reset);

    const result = element('p', 'dec-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    const emptyBox = element('div', 'dec-empty');
    emptyBox.hidden = true;
    const emptyText = element('p', 'dec-empty-text');
    const emptyAction = button('dec-empty-action', 'Show all options');
    emptyBox.append(emptyText, emptyAction);
    section.append(head, form, result, emptyBox);
    mount.replaceChildren(section);

    function readFilter() {
      return {
        row: rowSelect.value,
        col: colSelect.value,
        status: statusSelect.value,
        terms: fold(search.value).trim().split(/\s+/).filter(Boolean),
      };
    }
    let current = readFilter();
    const isActive = f => Boolean(f.row || f.col || f.status || f.terms.length);
    function haystack(cell, decision) {
      const n = app.names(cell);
      const row = app.rows?.get?.(cell.row);
      const col = app.columns?.get?.(cell.column);
      const legacy = Object.entries(cell.attributes || {}).find(([key, value]) => key.toLowerCase() === 'description' && typeof value === 'string')?.[1];
      return fold([n.row, n.column, row?.description, col?.description, cell.description || legacy, LABELS[decision.status], decision.note, decision.privateNote].filter(Boolean).join(' \n '));
    }
    function matches(id, f = current) {
      const cell = app.cells.get(id);
      if (!cell || !app.isReady(cell)) return false;
      if (f.row && cell.row !== f.row) return false;
      if (f.col && cell.column !== f.col) return false;
      const decision = decisionOf(id);
      if (f.status && decision.status !== f.status) return false;
      if (f.terms.length) {
        const text = haystack(cell, decision);
        if (!f.terms.every(term => text.includes(term))) return false;
      }
      return true;
    }
    function favoriteMode() { try { return Boolean(window.MatrixFavorites?.isActive?.()); } catch { return false; } }
    function favoriteIds() {
      try {
        const ids = window.MatrixFavorites?.getScope?.().ids ?? window.MatrixFavorites?.ids?.();
        return Array.isArray(ids) ? ids.filter(id => app.cells.has(id) && app.isReady(app.cells.get(id))) : [];
      } catch { return []; }
    }
    function scopeIds() {
      return favoriteMode() ? favoriteIds() : order.filter(id => app.cards.has(id) && app.isReady(app.cells.get(id)));
    }

    // Matrix: hide rows/columns without a match; blank out non-matching cells inside the rows/columns that remain.
    function applyMatrix(active) {
      const table = $('matrix');
      if (!table) return;
      const bodyRows = table.tBodies[0] ? [...table.tBodies[0].rows] : [];
      const headCells = table.tHead?.rows[0] ? [...table.tHead.rows[0].cells] : [];
      const matchRows = new Set();
      const matchCols = new Set();
      const grid = bodyRows.map((tr, r) => {
        const tds = [...tr.cells].filter(node => node.tagName === 'TD');
        tds.forEach((td, c) => {
          const id = rows[r] && cols[c] ? positions.get(`${rows[r].id}|${cols[c].id}`) : undefined;
          const ok = active && id !== undefined && app.cards.has(id) && matches(id);
          if (ok) { matchRows.add(r); matchCols.add(c); }
          td.classList.toggle('dec-miss', active && !ok);
        });
        return tds;
      });
      grid.forEach((tds, r) => {
        bodyRows[r].classList.toggle('dec-hide', active && !matchRows.has(r));
        tds.forEach((td, c) => td.classList.toggle('dec-hide', active && !matchCols.has(c)));
      });
      headCells.slice(1).forEach((th, c) => th.classList.toggle('dec-hide', active && !matchCols.has(c)));
      table.classList.toggle('dec-trim', active && matchCols.size < cols.length);
    }
    function applyFavorites(active) {
      if (!favGrid) return;
      for (const li of favGrid.children) {
        const id = li.dataset?.favId;
        li.classList.toggle('dec-hide', Boolean(active && id !== undefined && !matches(id)));
      }
    }
    function applyFilters(fromControls) {
      current = readFilter();
      const active = isActive(current);
      applyMatrix(active);
      applyFavorites(active);
      const fav = favoriteMode();
      const scope = scopeIds();
      const visible = active ? scope.filter(id => matches(id)) : scope;
      const listMode = fav && window.MatrixFavorites?.getScope?.().type === 'list';
      const noun = fav && !listMode ? 'favorite' : 'option';
      lastVisible = visible;
      reset.disabled = !active;
      section.classList.toggle('dec-filtering', active);
      if (!active) result.textContent = '';
      else if (!scope.length) result.textContent = listMode ? 'No finished options in this list yet.' : fav ? 'No favorites to filter yet.' : 'No finished options to filter yet.';
      else if (!visible.length) result.textContent = `No ${noun}s match these filters.`;
      else result.textContent = `Showing ${visible.length} of ${plural(scope.length, noun)}.`;
      emptyBox.hidden = !(active && scope.length && !visible.length);
      if (!emptyBox.hidden) {
        emptyText.textContent = `Try a different ${labels.rows}, ${labels.columns}, status or search, or show everything again.`;
        emptyAction.textContent = listMode ? 'Show all in this list' : fav ? 'Show all favorites' : 'Show all options';
      }
      if (fromControls) {
        document.dispatchEvent(new CustomEvent('studio:decisionfilter', { detail: { active, ids: visible.slice() } }));
      }
    }
    function resetFilters(focus) {
      clearTimeout(searchTimer);
      rowSelect.value = '';
      colSelect.value = '';
      statusSelect.value = '';
      search.value = '';
      applyFilters(true);
      if (focus) rowSelect.focus();
    }
    function updateLabels() {
      rowLabel.textContent = labels.rows;
      colLabel.textContent = labels.columns;
      if (dialog.open && openId !== null) writeWhere(openId);
    }

    let searchTimer = 0;
    form.addEventListener('submit', event => {
      event.preventDefault();
      clearTimeout(searchTimer);
      applyFilters(true);
    });
    form.addEventListener('change', event => { if (event.target !== search) applyFilters(true); });
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyFilters(true), 180);
    });
    // Typing here must not reach page-level shortcuts (zoom keys, Esc clearing the compare selection).
    form.addEventListener('keydown', event => event.stopPropagation());
    reset.addEventListener('click', () => resetFilters(true));
    emptyAction.addEventListener('click', () => resetFilters(true));

    /* ---------- Per-card decision action ---------- */
    function decorate(card, id, kind) {
      let action = card.querySelector(':scope > .dec-action');
      if (!action) {
        action = button('dec-action');
        action.dataset.decId = id;
        action.setAttribute('aria-haspopup', 'dialog');
        const glyph = element('span', 'dec-glyph');
        glyph.setAttribute('aria-hidden', 'true');
        const noteMark = element('span', 'dec-note-mark', '✎');
        noteMark.setAttribute('aria-hidden', 'true');
        const edit = element('span', 'dec-edit');
        edit.setAttribute('aria-hidden', 'true');
        action.append(glyph, element('span', 'dec-label'), noteMark, edit);
        if (kind === 'favorite') card.insertBefore(action, card.querySelector(':scope > .fav-select'));
        else card.append(action);
      }
      paint(action, card, id);
    }
    function paint(action, card, id) {
      const decision = decisionOf(id);
      const hasNotes = Boolean(decision.note || decision.privateNote);
      const draft = drafts.has(id);
      const key = `${decision.status}|${hasNotes}|${draft}`;
      if (action.dataset.decKey === key) return;
      action.dataset.decKey = key;
      action.dataset.decStatus = decision.status;
      action.classList.toggle('dec-has-draft', draft);
      card.dataset.decStatus = decision.status;
      action.querySelector('.dec-glyph').textContent = GLYPHS[decision.status];
      action.querySelector('.dec-label').textContent = LABELS[decision.status];
      action.querySelector('.dec-note-mark').hidden = !hasNotes;
      action.querySelector('.dec-edit').textContent = draft ? 'Unsaved' : 'Edit';
      const parts = [`${LABELS[decision.status]}. Edit decision for ${describe(id)}`];
      if (hasNotes) parts.push('has notes');
      if (draft) parts.push('unsaved changes');
      action.setAttribute('aria-label', parts.join(', '));
      action.title = hasNotes ? 'Decision and notes' : 'Set a decision';
    }
    function hookFavorites() {
      const grid = document.querySelector('#fav-panel .fav-grid');
      if (!grid || grid === favGrid) return;
      favObserver?.disconnect();
      favGrid = grid;
      if ('MutationObserver' in window) {
        // Only direct children are observed, so our own card additions never re-trigger this.
        favObserver = new MutationObserver(() => refresh());
        favObserver.observe(grid, { childList: true });
      }
    }
    function paintAll() {
      for (const [id, card] of app.cards) {
        if (card?.isConnected && app.cells.has(id)) decorate(card, id, 'matrix');
      }
      hookFavorites();
      if (!favGrid) return;
      for (const li of favGrid.children) {
        const id = li.dataset?.favId;
        const card = li.querySelector('.fav-card');
        if (id !== undefined && card && app.cells.has(id)) decorate(card, id, 'favorite');
      }
    }
    function refresh() {
      paintAll();
      applyFilters(false);
    }
    function scheduleRefresh() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    }
    function findAction(id) {
      return [...document.querySelectorAll('.dec-action')].find(node => node.dataset.decId === id && node.getClientRects().length) || null;
    }
    document.addEventListener('click', event => {
      const action = event.target instanceof Element ? event.target.closest('.dec-action') : null;
      if (!action || !action.dataset.decId) return;
      openDialog(action.dataset.decId, action);
    });

    /* ---------- Decision dialog ---------- */
    const dialog = element('dialog', 'dec-dialog');
    dialog.id = 'dec-dialog';
    dialog.setAttribute('aria-labelledby', 'dec-dialog-title');
    const dform = element('form', 'dec-form');
    dform.noValidate = true;
    const dhead = element('div', 'dec-dialog-head');
    const thumb = element('img', 'dec-thumb');
    thumb.alt = '';
    thumb.decoding = 'async';
    const titles = element('div', 'dec-heading');
    const dtitle = element('h2', 'dec-dialog-title');
    dtitle.id = 'dec-dialog-title';
    const where = element('p', 'dec-where');
    titles.append(element('p', 'dec-kicker', 'DECISION'), dtitle, where);
    const close = button('icon-button dec-close', '✕');
    close.setAttribute('aria-label', 'Close decision');
    dhead.append(thumb, titles, close);

    const body = element('div', 'dec-body');
    const fieldset = element('fieldset', 'dec-statuses');
    const choices = element('div', 'dec-choices');
    const radios = new Map();
    for (const status of STATUSES) {
      const label = element('label', 'dec-choice');
      label.dataset.decStatus = status;
      const input = element('input');
      input.type = 'radio';
      input.name = 'dec-status';
      input.value = status;
      const mark = element('span', 'dec-glyph', GLYPHS[status]);
      mark.setAttribute('aria-hidden', 'true');
      const text = element('span', 'dec-choice-text');
      text.append(element('strong', '', LABELS[status]), element('small', '', HINTS[status]));
      label.append(input, mark, text);
      choices.append(label);
      radios.set(status, input);
    }
    fieldset.append(element('legend', '', 'Status'), choices, element('p', 'dec-aside', 'Several options can be chosen. Favorites stay separate and never change a status.'));
    function noteField(id, labelText, hintText, extra) {
      const wrap = element('div', `dec-note ${extra}`);
      const label = element('label', 'dec-note-label', labelText);
      label.htmlFor = id;
      const hint = element('p', 'dec-hint', hintText);
      hint.id = `${id}-hint`;
      const area = element('textarea', 'dec-textarea');
      area.id = id;
      area.rows = 3;
      area.maxLength = NOTE_MAX;
      area.setAttribute('aria-describedby', hint.id);
      wrap.append(label, hint, area);
      body.append(wrap);
      return area;
    }
    body.append(fieldset);
    const noteArea = noteField('dec-note', 'Note for the brief', 'Shared: this note can appear in briefs you send to a stylist, client or anyone else.', 'dec-public');
    const privateArea = noteField('dec-private-note', 'Private note', 'Only for you. Private notes are left out of briefs by default.', 'dec-private');
    const saveStatus = element('p', 'dec-save-status');
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    body.append(saveStatus);

    const actions = element('div', 'dec-dialog-actions');
    const revert = button('dec-revert', 'Revert to saved');
    revert.hidden = true;
    const cancel = button('dec-secondary', 'Close');
    const save = element('button', 'dec-primary', 'Save decision');
    save.type = 'submit';
    actions.append(revert, cancel, save);
    dform.append(dhead, body, actions);
    dialog.append(dform);
    document.body.append(dialog);

    let openId = null;
    let opener = null;
    let baseline = null;
    let saving = false;

    function formValues() {
      const checked = [...radios.values()].find(input => input.checked);
      return { status: checked ? checked.value : 'unreviewed', note: noteArea.value, privateNote: privateArea.value };
    }
    function fill(values) {
      (radios.get(values.status) || radios.get('unreviewed')).checked = true;
      noteArea.value = values.note;
      privateArea.value = values.privateNote;
    }
    function dirty() {
      if (!baseline) return false;
      const now = formValues();
      return now.status !== baseline.status || cleanNote(now.note) !== cleanNote(baseline.note) || cleanNote(now.privateNote) !== cleanNote(baseline.privateNote);
    }
    function message(text, tone) {
      saveStatus.textContent = text;
      saveStatus.classList.toggle('is-error', tone === 'error');
      saveStatus.classList.toggle('is-warn', tone === 'warn');
    }
    function writeWhere(id) {
      const cell = app.cells.get(id);
      if (!cell) return;
      const n = app.names(cell);
      where.textContent = `${labels.rows}: ${n.row} · ${labels.columns}: ${n.column}`;
    }
    function openDialog(id, from) {
      const cell = app.cells.get(id);
      if (!cell || dialog.open) return;
      syncProject(project());
      openId = id;
      opener = from || document.activeElement;
      baseline = decisionOf(id);
      const draft = drafts.get(id);
      fill(draft || baseline);
      dtitle.textContent = app.describe(cell);
      writeWhere(id);
      if (cell.src && app.isReady(cell)) {
        thumb.src = cell.src;
        thumb.hidden = false;
      } else {
        thumb.removeAttribute('src');
        thumb.hidden = true;
      }
      revert.hidden = !draft;
      save.disabled = saving || !canSave();
      const state = persistence();
      if (!canSave()) message('Project storage didn’t load, so decisions can’t be saved right now. Your typing stays here until you close the page.', 'error');
      else if (draft) message('Your unsaved changes from earlier are back. Save to keep them.', 'warn');
      else if (state && !state.persistent) message(`Heads up: ${state.message || 'changes last only for this browser session.'}`, 'warn');
      else message('');
      dialog.showModal();
      (radios.get(formValues().status) || radios.get('unreviewed')).focus();
    }
    function requestClose() {
      if (saving) { message('Still saving. One moment.'); return; }
      dialog.close();
    }
    async function submit() {
      if (saving || openId === null) return;
      const s = store();
      if (!canSave()) {
        message('Project storage didn’t load, so this decision can’t be saved. Your changes are still here.', 'error');
        return;
      }
      const id = openId;
      const raw = formValues();
      const entry = {
        status: STATUSES.includes(raw.status) ? raw.status : 'unreviewed',
        note: cleanNote(raw.note),
        privateNote: cleanNote(raw.privateNote),
      };
      const label = describe(id);
      saving = true;
      save.disabled = true;
      save.textContent = 'Saving…';
      dform.setAttribute('aria-busy', 'true');
      message('Saving…');
      try {
        const snapshot = s.get() || {};
        const decisions = { ...readDecisions(snapshot), [id]: entry };
        const updated = await s.update({ decisions });
        syncProject(updated && typeof updated === 'object' ? updated : project());
        drafts.delete(id);
        const state = persistence();
        const text = state && !state.persistent
          ? `${label} set to ${LABELS[entry.status]} for this session only. ${state.message}`.trim()
          : `Saved: ${label} is ${LABELS[entry.status]}.`;
        if (dialog.open && openId === id) {
          const now = formValues();
          baseline = entry;
          if (now.status === raw.status && now.note === raw.note && now.privateNote === raw.privateNote) dialog.close();
          else message(`${text} You’ve edited since then; save again to keep the newer changes.`, 'warn');
        }
        announce(text);
      } catch (error) {
        const reason = error && error.message ? error.message : 'the project could not be stored';
        if (dialog.open && openId === id) {
          message(`Not saved: ${reason}. Your changes are still here, so you can try again.`, 'error');
        } else {
          drafts.set(id, raw);
          announce(`Not saved: ${reason}. Your changes for ${label} are kept; open its decision to try again.`);
        }
      } finally {
        saving = false;
        save.disabled = !canSave();
        save.textContent = 'Save decision';
        dform.removeAttribute('aria-busy');
        refresh();
      }
    }

    dform.addEventListener('submit', event => {
      event.preventDefault();
      submit();
    });
    close.addEventListener('click', requestClose);
    cancel.addEventListener('click', requestClose);
    revert.addEventListener('click', () => {
      if (openId === null) return;
      drafts.delete(openId);
      baseline = decisionOf(openId);
      fill(baseline);
      revert.hidden = true;
      message('Back to the saved decision.');
      (radios.get(baseline.status) || radios.get('unreviewed')).focus();
    });
    dialog.addEventListener('cancel', event => {
      if (!saving) return;
      event.preventDefault();
      message('Still saving. One moment.');
    });
    dialog.addEventListener('keydown', event => {
      // Keep Esc/zoom shortcuts from reaching page-level handlers (e.g. clearing the compare selection).
      event.stopPropagation();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });
    dialog.addEventListener('close', () => {
      const id = openId;
      if (id !== null) {
        if (dirty()) {
          drafts.set(id, formValues());
          announce('Unsaved decision changes are kept for now. Open the decision again to save them.');
        } else if (!saving) {
          drafts.delete(id);
        }
      }
      openId = null;
      baseline = null;
      refresh();
      const target = [opener, id !== null ? findAction(id) : null].find(node => node?.isConnected && node.getClientRects().length) || rowSelect;
      opener = null;
      target.focus();
    });
    window.addEventListener('beforeunload', event => {
      if (!saving && !drafts.size && !(dialog.open && dirty())) return;
      event.preventDefault();
      event.returnValue = '';
    });

    /* ---------- Sync with store and gallery ---------- */
    document.addEventListener('studio:change', event => {
      const next = event.detail?.project;
      syncProject(next && typeof next === 'object' ? next : project());
      updateLabels();
      if (dialog.open && openId !== null && !saving && !dirty()) {
        baseline = decisionOf(openId);
        fill(baseline);
      }
      scheduleRefresh();
    });
    document.addEventListener('matrix:favoriteschange', scheduleRefresh);
    document.addEventListener('studio:listscopechange', scheduleRefresh);
    document.addEventListener('studio:listschange', scheduleRefresh);
    document.addEventListener('matrix:filterchange', () => refresh());
    document.addEventListener('matrix:imagefailed', scheduleRefresh);

    window.StudioDecisions = Object.freeze({
      statuses: Object.freeze(STATUSES.slice()),
      label: status => LABELS[status] || LABELS.unreviewed,
      get: id => decisionOf(id),
      // True when no decision filter is active, so viewers can use it as an extra browse filter.
      matches: id => !isActive(current) || matches(id),
      isFiltering: () => isActive(current),
      visibleIds: () => lastVisible.slice(),
      open: id => openDialog(id, document.activeElement),
      resetFilters: () => resetFilters(false),
      refresh,
    });
    refresh();
  }

  function unavailable() {
    const mount = $('decision-controls');
    if (!mount || mount.childElementCount) return;
    mount.classList.add('dec-mount');
    mount.append(element('p', 'dec-unavailable', 'Decisions and filters need the gallery, which didn’t load. Reload the page to try again.'));
  }
  function boot(tries = 0) {
    const app = window.MATRIX_APP;
    if (app && app.cards instanceof Map && app.cells instanceof Map && typeof app.describe === 'function') {
      start(app);
      return;
    }
    if (tries < 40) setTimeout(() => boot(tries + 1), 125);
    else unavailable();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
})();
