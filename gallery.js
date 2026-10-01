(() => {
  'use strict';
  const data = window.MATRIX_DATA;
  const $ = id => document.getElementById(id);
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.columns) || !Array.isArray(data.cells)) {
    $('empty-state').hidden = false;
    $('matrix').hidden = true;
    return;
  }

  const rows = new Map(data.rows.map(row => [row.id, row]));
  const columns = new Map(data.columns.map(column => [column.id, column]));
  const cells = new Map(data.cells.map(c => [c.id, c]));
  const positions = new Map(data.cells.map(c => [`${c.row}|${c.column}`, c]));
  const selected = new Set();
  const failed = new Set();
  const selectButtons = new Map();
  const cards = new Map();
  const containers = new Map();
  const viewer = $('viewer');
  const total = data.rows.length * data.columns.length;
  $('matrix').style.setProperty('--column-count', data.columns.length);
  let lastOpener = null;
  let viewerCells = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function isReady(cell) { return cell && cell.status === 'ready' && Boolean(cell.src) && !failed.has(cell.id); }
  function names(cell) {
    return { row: rows.get(cell.row)?.name || cell.row, column: columns.get(cell.column)?.name || cell.column };
  }
  function describe(cell) { const n = names(cell); return `${n.row} · ${n.column}`; }
  function announce(text) { $('announcement').textContent = text; }
  function axisLabels(project) {
    if (!project) {
      try { project = window.ProjectStore?.get?.(); } catch { /* Gallery can open without storage. */ }
    }
    const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
    return {
      row: label(project?.rowsLabel, label(data.meta?.rowsLabel, 'Rows')),
      column: label(project?.columnsLabel, label(data.meta?.columnsLabel, 'Columns'))
    };
  }
  function updateAxisLabels(project) {
    const labels = axisLabels(project);
    corner.replaceChildren(document.createTextNode(`${labels.row} ↓`), element('span', 'column-description', `${labels.column} →`));
    $('matrix-wrap').setAttribute('aria-label', `${labels.row} and ${labels.column} comparison table`);
    const caption = $('matrix').querySelector('caption');
    if (caption) caption.textContent = `${labels.row} in rows, ${labels.column} in columns. Only completed options can be opened or compared.`;
    $('scroll-hint-text').textContent = `Scroll sideways to explore all ${data.columns.length} columns (${labels.column})`;
  }
  function updateCounts() {
    const ready = [...positions.values()].filter(isReady).length;
    $('ready-count').textContent = `${ready} / ${total}`;
    $('progress-description').textContent = 'combinations ready';
    $('remaining-count').textContent = ready === total ? 'All combinations ready' : `${total - ready} still to explore`;
  }
  function markImageFailed(id) {
    const cell = cells.get(id);
    if (!cell?.src || failed.has(id)) return false;
    failed.add(id);
    selected.delete(id);
    containers.get(id)?.replaceChildren(pendingCard('Image unavailable'));
    selectButtons.delete(id);
    cards.delete(id);
    updateCounts();
    updateSelection();
    document.dispatchEvent(new CustomEvent('matrix:imagefailed', { detail: { id } }));
    return true;
  }

  function pendingCard(message = 'Pending') {
    const pending = element('div', 'pending-card');
    const mark = element('span', 'pending-mark', message === 'Pending' ? '·' : '!');
    mark.setAttribute('aria-hidden', 'true');
    pending.append(mark, element('span', 'pending-word', message));
    return pending;
  }

  const head = element('thead');
  const headerRow = element('tr');
  const corner = element('th', 'corner', 'Rows ↓');
  corner.scope = 'col';
  corner.append(element('span', 'column-description', 'Columns →'));
  headerRow.append(corner);
  for (const columnOption of data.columns) {
    const th = element('th', '', columnOption.name);
    th.scope = 'col';
    if (columnOption.description) th.append(element('span', 'column-description', columnOption.description));
    if (columnOption.source) {
      const referenceCaption = columnOption.referenceCaption || 'Reference image';
      const reference = element('img', 'reference column-reference');
      reference.src = columnOption.source;
      reference.alt = `${columnOption.name} — ${referenceCaption}`;
      reference.loading = 'lazy';
      Object.assign(reference.style, { display: 'block', width: '65px', height: '65px', objectFit: 'cover', borderRadius: '7px', marginTop: '8px' });
      th.append(reference, element('span', 'reference-caption column-description', referenceCaption));
    }
    headerRow.append(th);
  }
  head.append(headerRow);
  const body = element('tbody');
  for (const rowOption of data.rows) {
    const row = element('tr');
    row.dataset.rowId = rowOption.id;
    const heading = element('th');
    heading.scope = 'row';
    const referenceCaption = rowOption.referenceCaption || 'Reference image';
    if (rowOption.source) {
      const reference = element('img', 'reference');
      reference.src = rowOption.source;
      reference.alt = `${rowOption.name} — ${referenceCaption}`;
      reference.loading = 'lazy';
      heading.append(reference);
    }
    heading.append(element('span', 'row-name', rowOption.name));
    if (rowOption.description) heading.append(element('span', 'row-description', rowOption.description));
    if (rowOption.source) heading.append(element('span', 'reference-caption', referenceCaption));
    row.append(heading);
    for (const columnOption of data.columns) {
      const td = element('td');
      const cell = positions.get(`${rowOption.id}|${columnOption.id}`);
      td.dataset.columnId = columnOption.id;
      if (cell) { td.dataset.cellId = cell.id; containers.set(cell.id, td); }
      td.setAttribute('aria-label', `${rowOption.name}, ${columnOption.name}`);
      if (!isReady(cell)) {
        td.append(pendingCard());
        row.append(td);
        continue;
      }
      const card = element('div', 'option-card');
      card.dataset.cellId = cell.id;
      const open = element('button', 'option-button');
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${describe(cell)}`);
      const img = element('img');
      img.src = cell.src;
      img.alt = `${describe(cell)} preview`;
      img.loading = 'lazy';
      img.addEventListener('error', () => markImageFailed(cell.id), { once: true });
      const icon = element('span', 'open-icon', '⤢');
      icon.setAttribute('aria-hidden', 'true');
      open.append(img, icon);
      open.addEventListener('click', () => openViewer([cell], open));
      const select = element('button', 'select-button');
      select.type = 'button';
      select.setAttribute('aria-label', `Select ${describe(cell)} for comparison`);
      select.setAttribute('aria-pressed', 'false');
      const mark = element('span', 'selection-mark');
      mark.setAttribute('aria-hidden', 'true');
      select.append(mark, element('span', 'select-label', 'Compare'));
      select.addEventListener('click', () => toggleSelection(cell));
      selectButtons.set(cell.id, select);
      cards.set(cell.id, card);
      card.append(open, select);
      td.append(card);
      row.append(td);
    }
    body.append(row);
  }
  $('matrix').append(head, body);
  updateAxisLabels();
  document.addEventListener('studio:change', event => updateAxisLabels(event.detail?.project));

  function toggleSelection(cell) {
    if (selected.has(cell.id)) selected.delete(cell.id);
    else if (selected.size < 2) selected.add(cell.id);
    else {
      announce('Two options are already selected. Remove one or clear the selection to choose another.');
      $('compare-button').focus();
      return;
    }
    updateSelection();
    announce(`${selected.size} of 2 options selected.`);
  }
  function updateSelection() {
    for (const [id, button] of selectButtons) {
      const active = selected.has(id);
      button.setAttribute('aria-pressed', String(active));
      button.querySelector('.selection-mark').textContent = active ? '✓' : '';
      button.querySelector('.select-label').textContent = active ? 'Selected' : 'Compare';
      cards.get(id)?.classList.toggle('selected', active);
    }
    const list = $('selected-list');
    list.replaceChildren();
    for (const id of selected) {
      const cell = cells.get(id);
      const n = names(cell);
      const item = element('div', 'selection-item');
      const img = element('img');
      img.src = cell.src;
      img.alt = '';
      const label = element('div', 'selection-label');
      label.append(element('strong', '', n.row), element('span', '', n.column));
      const remove = element('button', 'selection-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${describe(cell)} from comparison`);
      remove.addEventListener('click', () => toggleSelection(cell));
      item.append(img, label, remove);
      list.append(item);
    }
    $('compare-tray').hidden = selected.size === 0;
    $('compare-button').disabled = selected.size !== 2;
    $('compare-button').textContent = selected.size === 2 ? 'Compare 2' : 'Select one more';
    document.body.classList.toggle('has-selection', selected.size > 0);
    document.dispatchEvent(new CustomEvent('matrix:selectionchange'));
  }

  function metadataEntries(attributes) {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
    return Object.entries(attributes).filter(([, value]) => value === null || typeof value === 'string' ||
      typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
  }
  function metadataDetails(cell) {
    const labels = axisLabels();
    const groups = [
      [labels.row, rows.get(cell.row)?.attributes],
      [labels.column, columns.get(cell.column)?.attributes],
      ['This option', cell.attributes]
    ].map(([label, attributes]) => [label, metadataEntries(attributes)]).filter(([, entries]) => entries.length);
    if (!groups.length) return null;
    const details = element('details', 'option-metadata');
    details.append(element('summary', '', 'Specifications'));
    for (const [label, entries] of groups) {
      const group = element('section', 'metadata-group');
      group.append(element('strong', '', label));
      const list = element('dl');
      for (const [key, value] of entries) {
        const term = element('dt', '', key);
        const description = element('dd', '', value === null ? 'Not specified' : String(value));
        description.style.overflowWrap = 'anywhere';
        description.style.whiteSpace = 'pre-wrap';
        list.append(term, description);
      }
      group.append(list);
      details.append(group);
    }
    return details;
  }

  function openViewer(chosen, opener) {
    chosen = chosen.filter(isReady);
    if (!chosen.length) return;
    if (!viewer.open) lastOpener = opener || document.activeElement;
    viewerCells = chosen.slice();
    const comparing = chosen.length === 2;
    viewer.classList.toggle('comparing', comparing);
    $('viewer-kicker').textContent = comparing ? 'SIDE BY SIDE' : 'IMAGE VIEW';
    $('viewer-title').textContent = comparing ? 'Compare your selections' : describe(chosen[0]);
    const content = $('viewer-content');
    content.replaceChildren();
    for (const cell of chosen) {
      const n = names(cell);
      const figure = element('figure', 'viewer-figure');
      const frame = element('div', 'viewer-image-frame');
      const img = element('img');
      img.src = cell.src;
      img.alt = `${describe(cell)} full image`;
      const caption = element('figcaption');
      caption.append(element('strong', '', n.row), element('span', '', n.column));
      const metadata = metadataDetails(cell);
      if (metadata) caption.append(metadata);
      frame.append(img);
      figure.append(frame, caption);
      content.append(figure);
    }
    setViewerMode(false);
    if (!viewer.open) viewer.showModal();
    $('close-viewer').focus();
    document.dispatchEvent(new CustomEvent('matrix:vieweropen', { detail: { ids: chosen.map(cell => cell.id) } }));
  }
  function setViewerMode(detail) {
    viewer.classList.toggle('face-detail', detail);
    [...$('viewer-content').querySelectorAll('.viewer-figure')].forEach((figure, index) => {
      const cell = viewerCells[index], img = figure.querySelector('img');
      if (!cell || !img) return;
      const supplied = detail && cell.detail && !img.dataset.detailFailed;
      figure.classList.toggle('has-detail-image', Boolean(supplied));
      img.src = supplied ? cell.detail : cell.src;
      img.alt = `${describe(cell)} ${supplied ? 'detail' : 'full'} image`;
    });
    $('face-detail-button').setAttribute('aria-pressed', String(detail));
    $('full-portrait-button').setAttribute('aria-pressed', String(!detail));
    $('viewer-mode-description').textContent = detail ? 'Closer view of the image' : 'Whole image, including its caption';
  }
  $('face-detail-button').addEventListener('click', () => setViewerMode(true));
  $('full-portrait-button').addEventListener('click', () => setViewerMode(false));
  function closeViewer() { if (viewer.open) viewer.close(); }
  $('close-viewer').addEventListener('click', closeViewer);
  $('close-viewer-bottom').addEventListener('click', closeViewer);
  viewer.addEventListener('close', () => { if (lastOpener?.isConnected) lastOpener.focus(); });
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeViewer();
  });
  $('clear-selection').addEventListener('click', () => {
    const first = [...selected][0];
    selected.clear();
    updateSelection();
    selectButtons.get(first)?.focus();
    announce('Selection cleared.');
  });
  $('compare-button').addEventListener('click', event => {
    if (selected.size === 2) openViewer([...selected].map(id => cells.get(id)), event.currentTarget);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const viewPanel = $('wv-settings-panel');
    if (viewPanel && !viewPanel.hidden) return;
    if (window.StudioPresentation?.isComparing?.()) return;
    if (!viewer.open && selected.size) {
      event.preventDefault();
      selected.clear();
      updateSelection();
      announce('Selection cleared.');
    }
  });

  const wrap = $('matrix-wrap');
  function updateScrollHint() { $('scroll-hint').hidden = wrap.scrollWidth <= wrap.clientWidth + 1; }
  window.addEventListener('resize', updateScrollHint);
  if ('ResizeObserver' in window) new ResizeObserver(updateScrollHint).observe(wrap);
  updateScrollHint();
  if (data.meta?.updatedAt) {
    const date = new Date(data.meta.updatedAt);
    if (!Number.isNaN(date.getTime())) $('updated-at').textContent = `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  updateCounts();
  window.MATRIX_APP = Object.freeze({data,cells,rows,columns,cards,selectButtons,selected,isReady,describe,names,toggleSelection,updateSelection,openViewer,announce,markImageFailed,getViewerCells: () => viewerCells.slice()});
})();
