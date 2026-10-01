(() => {
  'use strict';

  const LIMITS = { axis: 40, cells: 400, title: 120, label: 60, goal: 2000, name: 120 };
  const toolbar = document.getElementById('studio-toolbar');
  const panel = document.getElementById('workspace-panel');
  const state = { project: null, busy: false, busyButton: null, listKey: '', pendingList: null, optionCount: 0, settingsDirty: false, started: false };
  const ui = {};

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  function store() { return window.ProjectStore; }
  function readProject() { try { return store().get() || null; } catch (error) { return null; } }
  function storageStatus() {
    try {
      const status = store().status();
      return { persistent: Boolean(status && status.persistent), message: clean(status && status.message) };
    } catch (error) {
      return { persistent: false, message: '' };
    }
  }
  function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function useful(text) { return /[\p{L}\p{N}]/u.test(text); }
  function shorten(text, max = 40) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
  function plural(count, one, many) { return `${count} ${count === 1 ? one : many}`; }
  function titleOf(project) { return clean(project && project.title) || 'Untitled project'; }
  function lines(text) { return String(text || '').split(/\r?\n/).map(clean).filter(Boolean); }
  function sentence(text) { return text && !/[.!?…]$/.test(text) ? `${text}.` : text; }
  function friendly(error, lead, tail) {
    const detail = error && typeof error.message === 'string' ? clean(error.message) : '';
    return [lead, sentence(detail), tail].filter(Boolean).join(' ');
  }
  function setStatus(node, text, tone) {
    node.textContent = text || '';
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }
  function markInvalid(controls, invalid) {
    for (const control of controls) control.removeAttribute('aria-invalid');
    if (invalid) invalid.setAttribute('aria-invalid', 'true');
  }
  function dateLabel(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function field(label, control, hint) {
    const wrap = el('div', { className: 'ws-field' }, el('label', { for: control.id, text: label }), control);
    if (hint) {
      const hintId = `${control.id}-hint`;
      wrap.append(el('p', { className: 'ws-hint', id: hintId, text: hint }));
      control.setAttribute('aria-describedby', hintId);
    }
    return wrap;
  }
  function textInput(id, maxlength, placeholder) {
    return el('input', { id, className: 'ws-input', type: 'text', maxlength, placeholder, autocomplete: 'off', required: true });
  }
  function details(id, label, hint) {
    const summary = el('summary', { id: `${id}-summary` }, el('span', { text: label }), hint ? el('span', { className: 'ws-summary-hint', text: hint }) : null);
    const section = el('details', { id, className: 'ws-section' }, summary);
    section.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !section.open || event.defaultPrevented) return;
      event.preventDefault();
      section.open = false;
      summary.focus();
    });
    return section;
  }

  function buildToolbar() {
    ui.title = el('strong', { id: 'ws-current-title', className: 'ws-current-title' });
    ui.switchSelect = el('select', { id: 'ws-switch-select', className: 'ws-select' });
    ui.switchButton = el('button', { id: 'ws-switch-open', className: 'ws-button', type: 'submit', text: 'Open' });
    ui.switchForm = el('form', { id: 'ws-switch-form', className: 'ws-switch', 'aria-label': 'Switch project', hidden: true },
      el('label', { className: 'sr-only', for: 'ws-switch-select', text: 'Choose a project to open' }), ui.switchSelect, ui.switchButton);
    ui.newButton = el('button', { id: 'ws-new-open', className: 'ws-button ws-button--primary', type: 'button', 'aria-controls': 'ws-new', 'aria-expanded': 'false', text: 'New project' });
    ui.storage = el('p', { id: 'ws-storage-note', className: 'ws-storage-note', hidden: true });
    ui.barStatus = el('p', { id: 'ws-bar-status', className: 'ws-status', role: 'status', 'aria-live': 'polite' });
    toolbar.replaceChildren(el('div', { className: 'ws-bar', role: 'group', 'aria-label': 'Current project' },
      el('p', { className: 'ws-current' }, el('span', { className: 'ws-kicker', text: 'Project' }), ui.title),
      el('div', { className: 'ws-bar-actions' }, ui.switchForm, ui.newButton),
      ui.storage,
      ui.barStatus));
  }

  function buildSettings() {
    ui.setTitle = textInput('ws-settings-title', LIMITS.title);
    ui.setGoal = el('textarea', { id: 'ws-settings-goal', className: 'ws-input', rows: 2, maxlength: LIMITS.goal, placeholder: 'e.g. Choose a direction for the next collection' });
    ui.setRows = textInput('ws-settings-rows-label', LIMITS.label, 'e.g. Shape');
    ui.setColumns = textInput('ws-settings-columns-label', LIMITS.label, 'e.g. Color');
    ui.settingsSave = el('button', { id: 'ws-settings-save', className: 'ws-button ws-button--primary', type: 'submit', text: 'Save changes' });
    ui.settingsStatus = el('p', { id: 'ws-settings-status', className: 'ws-status', role: 'status', 'aria-live': 'polite' });
    ui.settingsForm = el('form', { id: 'ws-settings-form', className: 'ws-form', novalidate: true },
      field('Project title', ui.setTitle),
      field('Goal', ui.setGoal, 'What are you trying to decide? Optional.'),
      el('div', { className: 'ws-pair' },
        field('Rows show', ui.setRows, 'What each row represents.'),
        field('Columns show', ui.setColumns, 'What each column represents.')),
      el('div', { className: 'ws-actions' }, ui.settingsSave, ui.settingsStatus));

    ui.duplicate = el('button', { id: 'ws-duplicate', className: 'ws-button', type: 'button', text: 'Duplicate project' });
    ui.duplicateStatus = el('p', { id: 'ws-duplicate-status', className: 'ws-status', role: 'status', 'aria-live': 'polite' });
    ui.duplicateRow = el('div', { id: 'ws-duplicate-row', className: 'ws-aside' },
      el('p', { className: 'ws-hint', id: 'ws-duplicate-hint', text: 'Make a copy to explore a variation without changing this project. The copy opens right away.' }),
      ui.duplicate, ui.duplicateStatus);
    ui.duplicate.setAttribute('aria-describedby', 'ws-duplicate-hint');
    ui.pausedNote = el('p', { id: 'ws-paused-note', className: 'ws-hint ws-aside', hidden: true,
      text: 'Creating, copying and switching projects is paused because this browser isn’t saving right now. Opening another project would discard this session.' });

    ui.settings = details('ws-settings', 'Project settings', 'Title, goal, labels');
    ui.settings.append(el('div', { className: 'ws-body' }, ui.settingsForm, ui.duplicateRow, ui.pausedNote));
  }

  function buildNewProject() {
    ui.newTitle = textInput('ws-new-title', LIMITS.title, 'e.g. Spring refresh');
    ui.newRowsLabel = textInput('ws-new-rows-label', LIMITS.label, 'e.g. Shape');
    ui.newColumnsLabel = textInput('ws-new-columns-label', LIMITS.label, 'e.g. Color');
    ui.newRows = el('textarea', { id: 'ws-new-rows', className: 'ws-input ws-lines', rows: 6, required: true, placeholder: 'Rounded\nAngular\nTapered' });
    ui.newColumns = el('textarea', { id: 'ws-new-columns', className: 'ws-input ws-lines', rows: 6, required: true, placeholder: 'Crimson\nDenim\nIvory' });
    ui.newSize = el('p', { id: 'ws-new-size', className: 'ws-size' });
    const linesHint = el('p', { id: 'ws-new-lines-hint', className: 'ws-hint',
      text: `One name per line. Up to ${LIMITS.axis} rows and ${LIMITS.axis} columns, ${LIMITS.cells} combinations in total.` });
    for (const area of [ui.newRows, ui.newColumns]) area.setAttribute('aria-describedby', 'ws-new-lines-hint ws-new-size');
    ui.newCreate = el('button', { id: 'ws-new-create', className: 'ws-button ws-button--primary', type: 'submit', text: 'Create and open' });
    ui.newStatus = el('p', { id: 'ws-new-status', className: 'ws-status', role: 'status', 'aria-live': 'polite' });
    ui.newForm = el('form', { id: 'ws-new-form', className: 'ws-form', novalidate: true },
      el('p', { className: 'ws-intro', text: 'Name what the rows and columns stand for, then list them. Every combination starts as an empty slot you can fill with images later.' }),
      field('Project title', ui.newTitle),
      el('div', { className: 'ws-pair' }, field('Rows show', ui.newRowsLabel), field('Columns show', ui.newColumnsLabel)),
      el('div', { className: 'ws-pair' }, field('Row names', ui.newRows), field('Column names', ui.newColumns)),
      el('div', { className: 'ws-size-line' }, linesHint, ui.newSize),
      el('div', { className: 'ws-actions' }, ui.newCreate, ui.newStatus));
    ui.newSection = details('ws-new', 'New project', 'Start an empty grid');
    ui.newSection.append(el('div', { className: 'ws-body' }, ui.newForm));
  }

  function buildPanel() {
    buildSettings();
    buildNewProject();
    panel.replaceChildren(el('div', { className: 'ws-panel' }, ui.settings, ui.newSection));
  }

  function renderCurrent() {
    const title = titleOf(state.project);
    ui.title.textContent = title;
    ui.title.title = title;
  }

  function projectSettings(project) {
    return {
      title: String((project && project.title) || ''),
      goal: String((project && project.goal) || ''),
      rowsLabel: String((project && project.rowsLabel) || ''),
      columnsLabel: String((project && project.columnsLabel) || '')
    };
  }
  function settingsValues() {
    return { title: clean(ui.setTitle.value), goal: ui.setGoal.value.trim(), rowsLabel: clean(ui.setRows.value), columnsLabel: clean(ui.setColumns.value) };
  }
  function settingsChanged() {
    const saved = projectSettings(state.project);
    const now = settingsValues();
    return now.title !== clean(saved.title) || now.goal !== saved.goal.trim() || now.rowsLabel !== clean(saved.rowsLabel) || now.columnsLabel !== clean(saved.columnsLabel);
  }
  function fillSettings(force) {
    if (!state.project) return;
    if (!force && (state.settingsDirty || ui.settingsForm.contains(document.activeElement))) return;
    const saved = projectSettings(state.project);
    ui.setTitle.value = saved.title;
    ui.setGoal.value = saved.goal;
    ui.setRows.value = saved.rowsLabel;
    ui.setColumns.value = saved.columnsLabel;
    markInvalid([ui.setTitle, ui.setGoal, ui.setRows, ui.setColumns], null);
    state.settingsDirty = false;
  }
  function checkSettings(values) {
    if (!values.title || !useful(values.title)) return { control: ui.setTitle, message: 'Give the project a title with at least one letter or number.' };
    if (values.title.length > LIMITS.title) return { control: ui.setTitle, message: `Keep the title under ${LIMITS.title} characters.` };
    if (values.goal.length > LIMITS.goal) return { control: ui.setGoal, message: `Keep the goal under ${LIMITS.goal} characters.` };
    if (!values.rowsLabel || !useful(values.rowsLabel)) return { control: ui.setRows, message: 'Say what the rows show, for example “Shape”.' };
    if (!values.columnsLabel || !useful(values.columnsLabel)) return { control: ui.setColumns, message: 'Say what the columns show, for example “Color”.' };
    return null;
  }

  function renderStorage() {
    const status = storageStatus();
    const persistent = status.persistent;
    ui.storage.hidden = persistent;
    if (!persistent) {
      ui.storage.replaceChildren(el('strong', { text: 'Not saved permanently. ' }),
        status.message || 'This browser isn’t storing projects, so changes last only until this tab is closed or reloaded.');
    }
    ui.newButton.hidden = !persistent;
    ui.newSection.hidden = !persistent;
    ui.duplicateRow.hidden = !persistent;
    ui.pausedNote.hidden = persistent;
    ui.switchForm.hidden = !persistent || state.optionCount < 2;
  }

  function syncButtons() {
    const set = (button, off) => button.setAttribute('aria-disabled', off ? 'true' : 'false');
    const same = !ui.switchSelect.value || Boolean(state.project && ui.switchSelect.value === state.project.id);
    set(ui.switchButton, state.busy || same);
    set(ui.newButton, state.busy);
    set(ui.duplicate, state.busy);
    set(ui.settingsSave, state.busy);
    set(ui.newCreate, state.busy);
  }
  function setBusy(button, label) {
    state.busy = true;
    state.busyButton = button;
    button.dataset.wsLabel = button.textContent;
    button.textContent = label;
    const form = button.closest('form');
    if (form) form.setAttribute('aria-busy', 'true');
    syncButtons();
  }
  function clearBusy() {
    const button = state.busyButton;
    if (button) {
      button.textContent = button.dataset.wsLabel || button.textContent;
      delete button.dataset.wsLabel;
      const form = button.closest('form');
      if (form) form.removeAttribute('aria-busy');
    }
    state.busy = false;
    state.busyButton = null;
    syncButtons();
  }
  function confirmDiscard() {
    if (!state.settingsDirty) return true;
    return window.confirm('Your project settings have unsaved changes. Continue and discard them?');
  }
  function structuralBlocked(statusNode) {
    if (storageStatus().persistent) return false;
    renderStorage();
    setStatus(statusNode, 'This browser isn’t saving right now, so projects can’t be created, copied or switched. Your current work is still open.', 'error');
    return true;
  }
  function reload() { window.location.reload(); }

  function refreshList() {
    let result;
    try { result = store().list(); } catch (error) { return; }
    Promise.resolve(result).then(renderList, () => {});
  }
  function renderList(list) {
    if (!Array.isArray(list) || !state.project) return;
    const projects = list.filter(item => item && typeof item.id === 'string' && item.id);
    if (!projects.some(item => item.id === state.project.id)) projects.unshift({ id: state.project.id, title: state.project.title, updatedAt: state.project.updatedAt });
    const key = JSON.stringify([state.project.id, projects.map(item => [item.id, item.title, item.updatedAt])]);
    if (key === state.listKey) return;
    if (document.activeElement === ui.switchSelect) { state.pendingList = list; return; }
    state.listKey = key;
    state.pendingList = null;
    const counts = new Map();
    for (const item of projects) counts.set(titleOf(item), (counts.get(titleOf(item)) || 0) + 1);
    const used = new Set();
    const options = projects.map(item => {
      let label = titleOf(item);
      if (counts.get(label) > 1) {
        const date = dateLabel(item.updatedAt);
        if (date) label = `${label} · ${date}`;
      }
      let unique = label;
      for (let n = 2; used.has(unique); n += 1) unique = `${label} (${n})`;
      used.add(unique);
      const current = item.id === state.project.id;
      return el('option', { value: item.id, text: current ? `${unique} — open now` : unique });
    });
    ui.switchSelect.replaceChildren(...options);
    ui.switchSelect.value = state.project.id;
    state.optionCount = options.length;
    renderStorage();
    syncButtons();
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.busy) return;
    const values = settingsValues();
    const problem = checkSettings(values);
    const controls = [ui.setTitle, ui.setGoal, ui.setRows, ui.setColumns];
    markInvalid(controls, problem && problem.control);
    if (problem) {
      setStatus(ui.settingsStatus, problem.message, 'error');
      problem.control.focus();
      return;
    }
    if (!settingsChanged()) {
      setStatus(ui.settingsStatus, 'No changes to save.', 'info');
      return;
    }
    setBusy(ui.settingsSave, 'Saving…');
    try {
      const project = await store().update(values);
      state.project = project || readProject() || state.project;
      fillSettings(true);
      renderCurrent();
      refreshList();
      const persistent = storageStatus().persistent;
      setStatus(ui.settingsStatus, persistent ? 'Saved.' : 'Updated for this session only — not saved permanently.', persistent ? 'ok' : 'warn');
    } catch (error) {
      setStatus(ui.settingsStatus, friendly(error, 'Couldn’t save these changes.', 'Your edits are still here, so you can try again.'), 'error');
    } finally {
      clearBusy();
      renderStorage();
    }
  }

  function readNewPlan() {
    const values = {
      title: clean(ui.newTitle.value),
      rowsLabel: clean(ui.newRowsLabel.value),
      columnsLabel: clean(ui.newColumnsLabel.value),
      rows: lines(ui.newRows.value),
      columns: lines(ui.newColumns.value)
    };
    const fail = (control, message) => ({ values, problem: { control, message } });
    if (!values.title || !useful(values.title)) return fail(ui.newTitle, 'Give the project a title with at least one letter or number.');
    if (!values.rowsLabel || !useful(values.rowsLabel)) return fail(ui.newRowsLabel, 'Say what the rows show, for example “Shape”.');
    if (!values.columnsLabel || !useful(values.columnsLabel)) return fail(ui.newColumnsLabel, 'Say what the columns show, for example “Color”.');
    const rowProblem = checkNames(values.rows, 'row');
    if (rowProblem) return fail(ui.newRows, rowProblem);
    const columnProblem = checkNames(values.columns, 'column');
    if (columnProblem) return fail(ui.newColumns, columnProblem);
    const total = values.rows.length * values.columns.length;
    if (total > LIMITS.cells) {
      return fail(values.rows.length >= values.columns.length ? ui.newRows : ui.newColumns,
        `${values.rows.length} × ${values.columns.length} makes ${total} combinations; the limit is ${LIMITS.cells}. Remove some rows or columns.`);
    }
    return { values, problem: null };
  }
  function checkNames(names, noun) {
    if (!names.length) return `Add at least one ${noun} name, one per line.`;
    if (names.length > LIMITS.axis) return `You listed ${names.length} ${noun}s; the limit is ${LIMITS.axis}.`;
    const seen = new Set();
    for (const name of names) {
      if (!useful(name)) return `“${shorten(name)}” isn’t a usable ${noun} name. Include at least one letter or number.`;
      if (name.length > LIMITS.name) return `“${shorten(name)}” is too long. Keep ${noun} names under ${LIMITS.name} characters.`;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return `“${shorten(name)}” is listed twice. Each ${noun} needs its own name.`;
      seen.add(key);
    }
    return '';
  }
  function updateSize() {
    const rows = lines(ui.newRows.value).length;
    const columns = lines(ui.newColumns.value).length;
    if (!rows && !columns) { setStatus(ui.newSize, 'Your grid size appears here as you type.', ''); return; }
    const total = rows * columns;
    const over = [];
    if (rows > LIMITS.axis) over.push(`more than ${LIMITS.axis} rows`);
    if (columns > LIMITS.axis) over.push(`more than ${LIMITS.axis} columns`);
    if (total > LIMITS.cells) over.push(`more than ${LIMITS.cells} combinations`);
    const size = `${plural(rows, 'row', 'rows')} × ${plural(columns, 'column', 'columns')} = ${plural(total, 'combination', 'combinations')}`;
    setStatus(ui.newSize, over.length ? `${size} — ${over.join(' and ')}.` : `${size}.`, over.length ? 'error' : '');
  }

  async function createProject(event) {
    event.preventDefault();
    if (state.busy || structuralBlocked(ui.newStatus)) return;
    const plan = readNewPlan();
    markInvalid([ui.newTitle, ui.newRowsLabel, ui.newColumnsLabel, ui.newRows, ui.newColumns], plan.problem && plan.problem.control);
    if (plan.problem) {
      setStatus(ui.newStatus, plan.problem.message, 'error');
      plan.problem.control.focus();
      return;
    }
    if (!confirmDiscard()) return;
    setBusy(ui.newCreate, 'Creating…');
    let opened = false;
    try {
      await store().create(plan.values);
      opened = true;
      setStatus(ui.newStatus, 'Project created. Opening it…', 'ok');
      reload();
    } catch (error) {
      setStatus(ui.newStatus, friendly(error, 'Couldn’t create the project.', 'Your entries are still here, so you can adjust them and try again.'), 'error');
    } finally {
      if (!opened) { clearBusy(); renderStorage(); }
    }
  }

  async function duplicateProject() {
    if (state.busy || structuralBlocked(ui.duplicateStatus)) return;
    if (!confirmDiscard()) return;
    setBusy(ui.duplicate, 'Duplicating…');
    let opened = false;
    try {
      await store().duplicate();
      opened = true;
      setStatus(ui.duplicateStatus, 'Copy created. Opening it…', 'ok');
      reload();
    } catch (error) {
      setStatus(ui.duplicateStatus, friendly(error, 'Couldn’t duplicate this project.', 'The current project is unchanged.'), 'error');
    } finally {
      if (!opened) { clearBusy(); renderStorage(); }
    }
  }

  async function switchProject(event) {
    event.preventDefault();
    if (state.busy) return;
    const id = ui.switchSelect.value;
    if (!id || id === state.project.id) {
      setStatus(ui.barStatus, 'Choose a different project to open.', 'info');
      return;
    }
    if (structuralBlocked(ui.barStatus) || !confirmDiscard()) return;
    setBusy(ui.switchButton, 'Opening…');
    let opened = false;
    try {
      await store().activate(id);
      opened = true;
      setStatus(ui.barStatus, 'Opening project…', 'ok');
      reload();
    } catch (error) {
      ui.switchSelect.value = state.project.id;
      setStatus(ui.barStatus, friendly(error, 'Couldn’t open that project.', 'You’re still in the current one.'), 'error');
    } finally {
      if (!opened) { clearBusy(); renderStorage(); }
    }
  }

  function openNewProject() {
    if (ui.newSection.hidden) return;
    const outer = document.getElementById('studio-tools-disclosure');
    if (outer) outer.open = true;
    ui.newSection.open = true;
    ui.newSection.scrollIntoView({ block: 'nearest' });
    ui.newTitle.focus();
  }

  function onStudioChange(event) {
    const project = (event && event.detail && event.detail.project) || readProject();
    if (!project) return;
    state.project = project;
    renderCurrent();
    fillSettings(false);
    renderStorage();
    refreshList();
  }

  function wire() {
    ui.switchForm.addEventListener('submit', switchProject);
    ui.switchSelect.addEventListener('change', () => { syncButtons(); setStatus(ui.barStatus, '', ''); });
    ui.switchSelect.addEventListener('blur', () => { if (state.pendingList) renderList(state.pendingList); });
    ui.newButton.addEventListener('click', openNewProject);
    ui.newSection.addEventListener('toggle', () => ui.newButton.setAttribute('aria-expanded', String(ui.newSection.open)));
    ui.settingsForm.addEventListener('submit', saveSettings);
    ui.settingsForm.addEventListener('input', event => {
      event.target.removeAttribute('aria-invalid');
      const dirty = settingsChanged();
      if (dirty === state.settingsDirty) return;
      state.settingsDirty = dirty;
      setStatus(ui.settingsStatus, dirty ? 'Unsaved changes.' : '', dirty ? 'info' : '');
    });
    ui.duplicate.addEventListener('click', duplicateProject);
    ui.newForm.addEventListener('submit', createProject);
    ui.newForm.addEventListener('input', event => {
      event.target.removeAttribute('aria-invalid');
      if (event.target === ui.newRows || event.target === ui.newColumns) updateSize();
    });
    document.addEventListener('studio:change', onStudioChange);
  }

  function showUnavailable() {
    if (!toolbar) return;
    toolbar.replaceChildren(el('div', { className: 'ws-bar' }, el('p', { id: 'ws-unavailable', className: 'ws-status', 'data-tone': 'error', role: 'status',
      text: 'Project tools couldn’t load, so projects can’t be created or switched right now. Reload the page to try again.' })));
  }

  function start() {
    if (state.started || !toolbar || !panel) return;
    const api = store();
    if (!api || typeof api.get !== 'function') { showUnavailable(); return; }
    const project = readProject();
    if (!project) { showUnavailable(); return; }
    state.started = true;
    state.project = project;
    buildToolbar();
    buildPanel();
    wire();
    renderCurrent();
    fillSettings(true);
    renderStorage();
    updateSize();
    syncButtons();
    refreshList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
