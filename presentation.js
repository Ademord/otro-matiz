/* Presentation only. All decisions, stars and selections use the existing store and gallery. */
(() => {
  'use strict';
  const app = window.MATRIX_APP;
  if (!app || !window.StudioDecisions || !window.MatrixFavorites) return;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (cls, text, action) => {
    const node = el('button', cls, text); node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };
  const icon = name => {
    const paths = { star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z', gallery: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', matrix: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', expand: 'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]);
    svg.append(path); return svg;
  };
  document.body.classList.add('studio-experience');
  document.body.classList.toggle('studio-embedded', window.parent !== window);
  const view = window.WorkspaceView;
  const initialView = view?.get();
  let mode = initialView?.layout || 'gallery', previous = initialView?.exploration || 'gallery', toolOpener = null, queued = false;
  const cards = new Map(), groups = [];
  let comparing = false;
  let framing = initialView?.galleryFraming || 'full', grouping = initialView?.galleryGrouping || 'none';
  const all = document.querySelector('.fav-switch button:first-child');
  const favorites = document.querySelector('.fav-switch button:last-child');
  const lookbook = el('section', 'lookbook'); lookbook.id = 'lookbook'; lookbook.setAttribute('aria-label', 'Gallery of visual options');
  $('matrix-navigation').before(lookbook);
  const help = el('p', 'present-help', 'Explore the details. Star what stands out. Compare your favorites.');
  document.querySelector('.title-line').after(help);
  const projectButton = button('present-tools-button', 'Project', openProject);
  projectButton.id = 'present-tools-button'; projectButton.setAttribute('aria-haspopup', 'dialog'); projectButton.setAttribute('aria-controls', 'project-tools-dialog');
  $('fav-bar').append(projectButton);
  const layout = el('div', 'present-layout'); layout.setAttribute('role', 'group'); layout.setAttribute('aria-label', 'Layout');
  const galleryButton = button('', 'Gallery', () => setView('gallery')); galleryButton.id = 'present-gallery'; galleryButton.prepend(icon('gallery'));
  const matrixButton = button('', 'Matrix', () => setView('matrix')); matrixButton.id = 'present-matrix'; matrixButton.prepend(icon('matrix'));
  layout.append(galleryButton, matrixButton); $('fav-bar').append(layout);
  const framingControls = el('div', 'present-framing'); framingControls.setAttribute('role', 'group'); framingControls.setAttribute('aria-label', 'Image framing');
  const focusedButton = button('', 'Focused preview', () => setFraming('focused')); focusedButton.id = 'present-focused';
  const fullButton = button('', 'Full image', () => setFraming('full')); fullButton.id = 'present-full';
  framingControls.append(focusedButton, fullButton); $('fav-bar').append(framingControls);
  const compareTools = el('div', 'present-compare');
  const compareToggle = button('present-compare-toggle', 'Compare', () => setComparing(!comparing)); compareToggle.id = 'present-compare-toggle'; compareToggle.setAttribute('aria-controls', 'lookbook matrix-wrap fav-panel');
  const compareControls = el('div', 'present-compare-controls');
  const compareStatus = el('span', 'present-compare-status'); compareStatus.id = 'present-compare-status'; compareStatus.setAttribute('role', 'status'); compareStatus.setAttribute('aria-live', 'polite');
  const compareNow = button('present-compare-now', 'Compare 2', () => {
    const chosen = selectedCells();
    if (chosen.length === 2) app.openViewer(chosen, compareNow);
  }); compareNow.id = 'present-compare-now';
  const compareCancel = button('present-compare-cancel', 'Cancel', () => setComparing(false, true)); compareCancel.id = 'present-compare-cancel';
  compareControls.append(compareStatus, compareNow, compareCancel); compareTools.append(compareToggle, compareControls); $('fav-bar').append(compareTools);
  const evaluate = button('present-evaluate', 'Evaluate', () => {
    const chosen = app.getViewerCells();
    if (chosen.length === 1) { evaluate.focus(); StudioDecisions.open(chosen[0].id); }
  }); evaluate.id = 'present-evaluate'; evaluate.setAttribute('aria-haspopup', 'dialog'); evaluate.hidden = true;
  const viewerFooter = document.querySelector('.viewer-footer');
  if (viewerFooter) viewerFooter.prepend(evaluate); else $('viewer').append(evaluate);
  const resultCount = el('span', 'present-count'); $('fav-bar').append(resultCount);
  const filterDisclosure = el('details', 'present-filters');
  const filterSummary = el('summary');
  filterSummary.append(el('span', '', 'Filter options'), el('span', 'present-filter-summary', 'All options'));
  const filterMount = $('decision-controls'); filterMount.before(filterDisclosure);
  filterDisclosure.append(filterSummary, filterMount);
  const mobileFilters = matchMedia('(max-width:700px)');
  filterDisclosure.open = initialView ? initialView.filtersOpen : !mobileFilters.matches;
  filterDisclosure.addEventListener('toggle', () => view?.update({ filtersOpen: filterDisclosure.open }));
  mobileFilters.addEventListener('change', event => { if (!view) filterDisclosure.open = !event.matches; });

  // Keep the existing settings forms intact, inside a focused dialog.
  const tools = el('dialog', 'project-tools-dialog'); tools.id = 'project-tools-dialog'; tools.setAttribute('aria-labelledby', 'project-tools-title');
  const toolsHead = el('div', 'project-tools-head');
  const toolsTitle = el('h2', '', 'Project tools'); toolsTitle.id = 'project-tools-title';
  const close = button('icon-button', '×', () => tools.close()); close.setAttribute('aria-label', 'Close project tools');
  toolsHead.append(toolsTitle, close);
  tools.append(toolsHead, $('studio-toolbar'), $('studio-tools-disclosure')); document.body.append(tools);
  close.autofocus = true;
  tools.addEventListener('close', () => {
    if (toolOpener?.isConnected) toolOpener.focus();
    document.dispatchEvent(new CustomEvent('presentation:toolsclose'));
  });
  tools.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); tools.close(); }
  }, true);
  tools.addEventListener('click', event => {
    if (event.target !== tools) return;
    const b = tools.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) tools.close();
  });
  function openTool(which) {
    toolOpener = document.activeElement;
    toolsTitle.textContent = ({settings:'Project settings', files:'Project files', generate:'AI handoff', 'new-project':'New project'})[which] || 'Project tools';
    if (!tools.open) tools.showModal();
    const shell = $('studio-tools-disclosure'); shell.open = true;
    const target = ({settings: $('ws-settings'), files: $('exchange-panel')?.querySelector('details'), generate: $('generation-panel')?.querySelector('details'), 'new-project': $('ws-new')})[which];
    shell.querySelectorAll('details').forEach(d => { d.open = d === target; });
    if (which === 'new-project') $('ws-new-open').click();
    else if (target) { target.open = true; target.querySelector('summary')?.focus(); }
    tools.scrollTop = 0;
  }
  function syncProjectButton() {
    let project; try { project = ProjectStore.get(); } catch { /* The project tools remain reachable without metadata. */ }
    const title = typeof project?.title === 'string' ? project.title.trim() : '';
    projectButton.title = title ? `Project tools · ${title}` : 'Project tools';
    projectButton.setAttribute('aria-label', title ? `Project tools for ${title}` : 'Project tools');
  }
  function openProject() {
    projectButton.focus({preventScroll:true}); openTool('settings');
    const choices = [$('ws-switch-select'), $('ws-settings')?.querySelector('summary'), $('ws-new-open'), close];
    choices.find(node => node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && node.getClientRects().length)?.focus({preventScroll:true});
  }
  syncProjectButton(); document.addEventListener('studio:change', syncProjectButton);
  const rows = new Map(app.data.rows.map(row => [row.id, row]));
  const columns = new Map(app.data.columns.map(column => [column.id, column]));
  const positions = new Map([...app.cells.values()].map(cell => [`${cell.row}|${cell.column}`, cell]));
  function descriptionsFor(cell) {
    // Earlier record imports stored descriptions as metadata. Read them without
    // rewriting saved projects or the immutable bytes of their checkpoints.
    const legacy = Object.entries(cell.attributes || {}).find(([key, value]) => key.toLowerCase() === 'description' && typeof value === 'string')?.[1];
    return [...new Set([rows.get(cell.row)?.description, columns.get(cell.column)?.description, cell.description || legacy]
      .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  }
  function selectedCells() { return [...app.selected].map(id => app.cells.get(id)).filter(app.isReady); }
  function selectForComparison(cell) {
    if (!cell || !app.isReady(cell)) return;
    if (!app.selected.has(cell.id) && app.selected.size >= 2) {
      app.announce('Two images are selected. Deselect one to choose another.'); compareNow.focus({preventScroll:true}); return;
    }
    app.toggleSelection(cell); refresh();
  }
  function setComparing(next, returnFocus = false) {
    comparing = Boolean(next);
    if (!comparing) {
      app.selected.clear(); app.updateSelection(); app.announce('Comparison cancelled.');
    } else if (comparing) app.announce('Select two images to compare.');
    refresh();
    if (returnFocus) compareToggle.focus({preventScroll:true});
  }
  function syncComparison() {
    const available = ['gallery', 'matrix', 'favorites'].includes(mode), active = available && comparing;
    const chosen = selectedCells();
    compareTools.hidden = !available; compareControls.hidden = !active;
    compareToggle.setAttribute('aria-pressed', String(active));
    compareToggle.disabled = !active && [...app.cells.values()].filter(app.isReady).length < 2;
    compareNow.disabled = chosen.length !== 2;
    compareNow.setAttribute('aria-label', chosen.length === 2 ? `Compare ${app.describe(chosen[0])} and ${app.describe(chosen[1])}` : 'Compare two images');
    compareStatus.textContent = chosen.length ? `${chosen.length}/2 selected` : 'Select two images';
    compareStatus.title = chosen.map(app.describe).join(' · ');
    document.body.classList.toggle('gallery-comparing', active);
    for (const ui of cards.values()) {
      const selected = app.selected.has(ui.cell.id);
      if (active && mode === 'gallery') ui.open.setAttribute('aria-pressed', String(selected)); else ui.open.removeAttribute('aria-pressed');
      ui.open.setAttribute('aria-label', active && mode === 'gallery' ? `${selected ? 'Deselect' : 'Select'} ${app.describe(ui.cell)} for comparison` : `Open ${app.describe(ui.cell)}`);
      ui.selectionMark.hidden = !active; ui.selectionMark.textContent = selected ? '✓' : '';
    }
    for (const [id, card] of app.cards) {
      const open = card.querySelector('.option-button'), cell = app.cells.get(id); if (!open || !cell) continue;
      const selected = app.selected.has(id);
      if (active && mode === 'matrix') open.setAttribute('aria-pressed', String(selected)); else open.removeAttribute('aria-pressed');
      open.setAttribute('aria-label', active && mode === 'matrix' ? `${selected ? 'Deselect' : 'Select'} ${app.describe(cell)} for comparison` : `Open ${app.describe(cell)}`);
      // The image is the comparison target. The original controls remain in the
      // shared gallery for compatibility, but never become duplicate card footers.
      const legacySelect = card.querySelector('.select-button'); if (legacySelect) legacySelect.hidden = true;
    }
    for (const open of document.querySelectorAll('.fav-open')) {
      const id = open.closest('.fav-item')?.dataset.favId, cell = app.cells.get(id); if (!cell) continue;
      const selected = app.selected.has(id);
      if (active && mode === 'favorites') open.setAttribute('aria-pressed', String(selected)); else open.removeAttribute('aria-pressed');
      open.setAttribute('aria-label', active && mode === 'favorites' ? `${selected ? 'Deselect' : 'Select'} ${app.describe(cell)} for comparison` : `Open ${app.describe(cell)}`);
    }
  }
  function syncViewer() {
    const chosen = app.getViewerCells();
    evaluate.hidden = chosen.length !== 1;
    if (chosen.length === 1) evaluate.setAttribute('aria-label', `Evaluate ${app.describe(chosen[0])} and add notes`);
    [...$('viewer-content').querySelectorAll('.viewer-figure')].forEach((figure, index) => {
      const cell = chosen[index]; if (!cell) return;
      const caption = figure.querySelector('figcaption'); if (!caption) return;
      let description = caption.querySelector('.present-viewer-description');
      const descriptions = descriptionsFor(cell);
      if (descriptions.length) {
        if (!description) { description = el('section', 'present-viewer-description'); caption.append(description); }
        description.replaceChildren(el('h3', '', 'Description'));
        descriptions.forEach(text => description.append(el('p', '', text)));
      } else description?.remove();
      let evaluateOption = caption.querySelector('.present-evaluate-option');
      if (chosen.length === 2) {
        if (!evaluateOption) {
          evaluateOption = button('present-evaluate present-evaluate-option', 'Evaluate', () => {
            evaluateOption.focus(); StudioDecisions.open(evaluateOption.dataset.evaluateId);
          });
          evaluateOption.setAttribute('aria-haspopup', 'dialog'); caption.append(evaluateOption);
        }
        evaluateOption.dataset.evaluateId = cell.id;
        evaluateOption.setAttribute('aria-label', `Evaluate ${app.describe(cell)} and add notes`);
      } else evaluateOption?.remove();
    });
  }
  const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  function metadataEntries(cell) {
    return [['row', rows.get(cell.row)?.attributes], ['column', columns.get(cell.column)?.attributes], ['cell', cell.attributes]]
      .flatMap(([scope, attributes]) => attributes && typeof attributes === 'object' && !Array.isArray(attributes)
        ? Object.entries(attributes).filter(([label, value]) => scalar(value) && !(scope === 'cell' && label.toLowerCase() === 'description' && typeof value === 'string'))
          .map(([label, value]) => ({key: `${scope}.${label}`, label, value, scope})) : []);
  }
  function getMetadataFields() {
    let project; try { project = window.ProjectStore?.get?.(); } catch { /* Metadata works without persistent storage. */ }
    const labels = {row: project?.rowsLabel || 'Rows', column: project?.columnsLabel || 'Columns', cell: 'Option'};
    const fields = new Map();
    for (const cell of app.cells.values()) for (const entry of metadataEntries(cell)) {
      if (!fields.has(entry.key)) fields.set(entry.key, {key: entry.key, label: `${labels[entry.scope]} · ${entry.label}`});
    }
    return [...fields.values()];
  }
  function renderMetadata(ui, preferences = view?.get()) {
    const entries = metadataEntries(ui.cell), selected = preferences?.metadataFields;
    const visible = Array.isArray(selected)
      ? selected.map(key => entries.find(entry => entry.key === key)).filter(Boolean)
      : entries.filter(entry => entry.value !== null && String(entry.value).trim()).slice(0, 4);
    ui.metadata.replaceChildren(); ui.metadata.hidden = !visible.length;
    for (const entry of visible) {
      const item = el('li', 'look-spec');
      if (typeof entry.value === 'string' && /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(entry.value.trim())) {
        const swatch = el('span', 'look-swatch'); swatch.style.backgroundColor = entry.value.trim(); swatch.setAttribute('aria-hidden', 'true'); item.append(swatch);
      }
      const text = el('span', 'look-spec-copy');
      text.append(el('span', 'look-spec-label', entry.label), el('span', 'look-spec-value', entry.value === null ? 'Not specified' : String(entry.value)));
      item.append(text); ui.metadata.append(item);
    }
  }
  function renderGrouping() {
    groups.length = 0; lookbook.replaceChildren();
    if (grouping === 'none') {
      const grid = el('div', 'look-grid');
      for (const ui of cards.values()) grid.append(ui.card);
      lookbook.append(grid);
    } else {
      const axis = grouping === 'row' ? app.data.rows : app.data.columns;
      axis.forEach((entry, index) => {
        const members = [...cards.values()].filter(ui => ui.cell[grouping] === entry.id);
        if (!members.length) return;
        const group = el('section', 'look-group'), header = el('header', 'look-group-head');
        const title = el('h2', '', entry.name); title.id = `look-group-${grouping}-${index}`; group.setAttribute('aria-labelledby', title.id);
        const tally = el('span', 'look-group-count'); header.append(title, tally);
        const grid = el('div', 'look-grid'); members.forEach(ui => grid.append(ui.card));
        group.append(header, grid); lookbook.append(group); groups.push({group, ids: members.map(ui => ui.cell.id), tally});
      });
    }
    lookbook.append(galleryEmpty);
  }
  function applyFraming() {
    document.body.dataset.galleryFraming = framing;
    const preferences = view?.get() || {};
    document.documentElement.style.setProperty('--gallery-zoom', String(preferences.galleryZoom || 1));
    document.documentElement.style.setProperty('--gallery-focal-x', `${(preferences.galleryFocalX ?? 0.5) * 100}%`);
    document.documentElement.style.setProperty('--gallery-focal-y', `${(preferences.galleryFocalY ?? 0.5) * 100}%`);
    focusedButton.setAttribute('aria-pressed', String(framing === 'focused'));
    fullButton.setAttribute('aria-pressed', String(framing === 'full'));
    for (const ui of cards.values()) if (ui.image && !ui.failed) {
      const detail = framing === 'focused' && ui.cell.detail && !ui.detailFailed;
      ui.open.classList.toggle('look-has-detail', Boolean(detail));
      const source = detail ? ui.cell.detail : ui.cell.src;
      if (ui.image.getAttribute('src') !== source) ui.image.src = source;
    }
  }
  function setFraming(next) {
    if (!['focused', 'full'].includes(next)) return;
    framing = next; view?.update({galleryFraming: next}); applyFraming();
  }
  function markUnavailable(ui, shared = false) {
    if (!ui || ui.failed) return;
    ui.failed = true; ui.open.disabled = true; ui.star.hidden = true;
    ui.card.classList.add('look-unavailable'); ui.open.replaceChildren(el('span', 'look-pending', 'Image unavailable'));
    if (shared) app.markImageFailed?.(ui.cell.id);
    if (app.selected.has(ui.cell.id)) app.toggleSelection(ui.cell);
  }
  let optionIndex = 0;
  for (const row of app.data.rows) {
    for (const col of app.data.columns) {
      const cell = positions.get(`${row.id}|${col.id}`); if (!cell) continue;
      let ui;
      const card = el('article', 'look-card'); card.dataset.lookId = cell.id;
      const media = el('div', 'look-media');
      const open = button('look-open', '', () => {
        if (!app.isReady(cell) || ui.failed) return;
        if (comparing && mode === 'gallery') selectForComparison(cell); else app.openViewer([cell], open);
      });
      open.setAttribute('aria-label', `Open ${app.describe(cell)}`);
      let img = null;
      if (app.isReady(cell)) {
        img = el('img'); img.src = cell.src; img.alt = `${app.describe(cell)} preview`; img.loading = optionIndex < 5 ? 'eager' : 'lazy'; img.decoding = 'async';
        open.append(img);
        img.addEventListener('error', () => {
          if (framing === 'focused' && cell.detail && img.getAttribute('src') === cell.detail && !ui.detailFailed) { ui.detailFailed = true; open.classList.remove('look-has-detail'); img.src = cell.src; return; }
          markUnavailable(ui, true);
        });
      } else { open.disabled = true; open.append(el('span', 'look-pending', 'Awaiting image')); }
      const star = button('look-star', '', () => { if (app.isReady(cell) && !ui.failed) MatrixFavorites.toggle(cell.id); }); star.append(icon('star')); star.setAttribute('aria-label', `Favorite ${app.describe(cell)}`); star.hidden = !app.isReady(cell);
      const caption = el('div', 'look-caption');
      const title = el('h3', 'look-title');
      const name = app.data.columns.length === 1 ? row.name : app.data.rows.length === 1 ? col.name : `${row.name} · ${col.name}`;
      title.append(el('span', 'look-index', String(++optionIndex).padStart(2, '0')), document.createTextNode(` ${name}`)); caption.append(title);
      const metadata = el('ul', 'look-metadata'); metadata.setAttribute('aria-label', 'Specifications'); caption.append(metadata);
      const descriptions = descriptionsFor(cell);
      let description = null;
      if (descriptions.length) {
        description = el('details', 'look-description'); description.append(el('summary', '', 'Description')); description.hidden = !initialView?.galleryDescriptions;
        descriptions.forEach(text => description.append(el('p', '', text))); caption.append(description);
      }
      const selectionMark = el('span', 'look-selection-mark'); selectionMark.setAttribute('aria-hidden', 'true'); selectionMark.hidden = true;
      media.append(open, star, selectionMark); card.append(media, caption);
      ui = {card, star, metadata, description, selectionMark, cell, image: img, open, failed: false, detailFailed: false};
      cards.set(cell.id, ui); renderMetadata(ui);
    }
  }
  const galleryEmpty = el('div', 'look-empty'); galleryEmpty.hidden = true;
  galleryEmpty.append(el('h2', '', 'A different direction?'), el('p', '', 'No options match these filters. Broaden your search to explore more possibilities.'), button('primary-button', 'Clear filters', () => {
    StudioDecisions.resetFilters();
    requestAnimationFrame(() => lookbook.querySelector('.look-card:not([hidden]) .look-open:not(:disabled)')?.focus({preventScroll:true}));
  }));
  renderGrouping(); applyFraming();
  function refresh() {
    queued = false;
    const filtering = StudioDecisions.isFiltering();
    const visibleOption = id => !filtering || StudioDecisions.matches(id);
    let shown = 0;
    for (const [id, ui] of cards) {
      const visible = visibleOption(id);
      ui.card.hidden = !visible; if (visible) shown++;
      const active = MatrixFavorites.has(id), selected = app.selected.has(id);
      const ready = app.isReady(ui.cell) && !ui.failed;
      ui.star.hidden = !ready; ui.open.disabled = !ready;
      ui.star.setAttribute('aria-pressed', String(active));
      ui.star.title = active ? 'Remove from favorites' : 'Save to favorites';
      ui.card.classList.toggle('look-selected', selected);
    }
    for (const g of groups) {
      const n = g.ids.filter(visibleOption).length;
      g.group.hidden = n === 0; g.tally.textContent = `${n} ${n === 1 ? 'option' : 'options'}`;
    }
    resultCount.textContent = mode === 'favorites' ? `${MatrixFavorites.visibleIds().length} ${MatrixFavorites.getScope?.().type === 'list' ? 'in this list' : 'saved'}` : `${shown} options`;
    galleryEmpty.hidden = shown !== 0;
    syncComparison(); syncViewer();
    filterSummary.querySelector('.present-filter-summary').textContent = filtering ? `${shown} matches` : 'All options';
    const project = ProjectStore.get();
    if (!project.goal) document.querySelector('.subtitle').textContent = 'Explore the options. Star what stands out. Compare any two.';
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  function show() {
    if (app.selected.size) comparing = true;
    document.body.dataset.layout = mode;
    lookbook.hidden = mode !== 'gallery';
    $('matrix-wrap').hidden = mode !== 'matrix';
    $('matrix-navigation').hidden = mode !== 'matrix';
    if (mode !== 'matrix') $('scroll-hint').hidden = true;
    galleryButton.setAttribute('aria-pressed', String(mode === 'gallery'));
    matrixButton.setAttribute('aria-pressed', String(mode === 'matrix'));
    galleryButton.hidden = matrixButton.hidden = mode === 'favorites';
    framingControls.hidden = mode === 'matrix';
    const scope = MatrixFavorites.getScope?.();
    view?.update({ layout: mode, exploration: previous,
      ...(mode === 'favorites' ? { favoriteListId: scope?.type === 'list' ? scope.id : null } : {}) });
    refresh();
    document.dispatchEvent(new CustomEvent('presentation:viewchange', { detail: { mode } }));
  }
  function setView(next) {
    if (!['gallery', 'matrix', 'favorites'].includes(next)) return;
    if (next !== 'favorites') previous = next;
    mode = next;
    if (next === 'favorites') {
      const listId = view?.get().favoriteListId;
      if (!listId || !MatrixFavorites.openList?.(listId)) {
        if (MatrixFavorites.openInbox) MatrixFavorites.openInbox(); else favorites.click();
      }
    } else all.click();
    show();
  }
  // Return to the last explicit exploration layout, including after a full reload.
  function resumeExploration() { setView(previous); }
  document.addEventListener('matrix:filterchange', () => { mode = MatrixFavorites.isActive() ? 'favorites' : previous; show(); });
  document.addEventListener('workspace:preferenceschange', event => {
    const { preferences, changed } = event.detail;
    if (changed.includes('filtersOpen') && filterDisclosure.open !== preferences.filtersOpen) filterDisclosure.open = preferences.filtersOpen;
    if (changed.includes('exploration')) previous = preferences.exploration;
    if (changed.includes('layout') && mode !== preferences.layout) setView(preferences.layout);
    if (changed.some(key => ['galleryFraming', 'galleryZoom', 'galleryFocalX', 'galleryFocalY'].includes(key))) { framing = preferences.galleryFraming; applyFraming(); }
    if (changed.includes('galleryGrouping')) { grouping = preferences.galleryGrouping; renderGrouping(); refresh(); }
    if (changed.includes('metadataFields')) for (const ui of cards.values()) renderMetadata(ui, preferences);
    if (changed.includes('galleryDescriptions')) for (const ui of cards.values()) if (ui.description) ui.description.hidden = !preferences.galleryDescriptions;
  });
  document.addEventListener('click', event => {
    if (!comparing || !['matrix', 'favorites'].includes(mode)) return;
    const selector = mode === 'matrix' ? '.option-button' : '.fav-open';
    const open = event.target instanceof Element ? event.target.closest(selector) : null; if (!open) return;
    const id = mode === 'matrix' ? open.closest('.option-card')?.dataset.cellId : open.closest('.fav-item')?.dataset.favId;
    const cell = app.cells.get(id); if (!cell || !app.isReady(cell)) return;
    event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); selectForComparison(cell);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !comparing || document.querySelector('dialog[open]')) return;
    if ($('wv-settings-panel') && !$('wv-settings-panel').hidden) return;
    event.preventDefault(); setComparing(false, true);
  });
  document.addEventListener('matrix:vieweropen', syncViewer);
  // Clearing/removing a tray item can remove the focused button. The original
  // matrix recovery target is hidden in Gallery, so restore its visible peer.
  let previousSelection = new Set(app.selected);
  document.addEventListener('matrix:selectionchange', () => {
    const removed = [...previousSelection].find(id => !app.selected.has(id));
    previousSelection = new Set(app.selected);
    if (removed === undefined) return;
    requestAnimationFrame(() => {
      if (mode !== 'gallery' || document.querySelector('dialog[open]')) return;
      const focused = document.activeElement;
      if (focused !== document.body && focused?.getClientRects().length) return;
      const target = cards.get(removed)?.open;
      if (target?.getClientRects().length) target.focus({preventScroll:true});
      else compareToggle.focus({preventScroll:true});
    });
  });
  for (const event of ['studio:change', 'matrix:favoriteschange', 'matrix:selectionchange', 'studio:decisionfilter', 'matrix:imagefailed']) document.addEventListener(event, schedule);
  document.addEventListener('matrix:imagefailed', event => markUnavailable(cards.get(event.detail?.id)));
  document.addEventListener('studio:ready', refresh, { once: true });
  window.StudioPresentation = Object.freeze({setView, openTool, resumeExploration, getMetadataFields, setFraming, isComparing: () => comparing, getFraming: () => framing, getView: () => mode, getExplorationView: () => previous});
  if (mode === 'favorites') setView(mode); else show();
})();
