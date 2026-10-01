(() => {
  'use strict';
  const MAX_BYTES = 12 * 1024 * 1024;
  const MIN_SIDE = 16;
  const MAX_SIDE = 16384;
  const MAX_REFERENCES = 40;
  const TYPE_NAMES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
  const EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const OUTPUT_EXT = { png: 'png', jpg: 'jpg', webp: 'webp' };
  const SCOPE_NAMES = {
    missing: 'Missing combinations',
    selection: 'Current comparison selection',
    favorites: 'Favorites',
    pick: 'Chosen existing cells',
    one: 'One exact cell'
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
  function oneLine(value) { return clean(value).replace(/\s+/g, ' '); }
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  function slug(value) {
    return oneLine(value).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
  }
  function defaultReady(cell) { return Boolean(cell && cell.status === 'ready' && cell.src); }

  function axes(project) {
    const data = project && project.data ? project.data : {};
    return {
      rowsLabel: oneLine(project && project.rowsLabel) || 'Rows',
      columnsLabel: oneLine(project && project.columnsLabel) || 'Columns',
      rows: Array.isArray(data.rows) ? data.rows : [],
      columns: Array.isArray(data.columns) ? data.columns : [],
      cells: Array.isArray(data.cells) ? data.cells : []
    };
  }
  // Cells in grid order (row, then column); ignores cells whose row/column is unknown.
  function orderedCells(project) {
    const a = axes(project);
    const rowIndex = new Map(a.rows.map((row, index) => [row.id, index]));
    const columnIndex = new Map(a.columns.map((column, index) => [column.id, index]));
    return a.cells
      .filter(cell => cell && typeof cell.id === 'string' && rowIndex.has(cell.row) && columnIndex.has(cell.column))
      .sort((x, y) => rowIndex.get(x.row) - rowIndex.get(y.row) || columnIndex.get(x.column) - columnIndex.get(y.column));
  }
  function cellNames(project, cell) {
    const a = axes(project);
    const row = a.rows.find(item => item.id === cell.row) || { id: cell.row, name: cell.row };
    const column = a.columns.find(item => item.id === cell.column) || { id: cell.column, name: cell.column };
    return { row, column, caption: `${oneLine(row.name) || row.id} · ${oneLine(column.name) || column.id}` };
  }
  // Only relative, project-local reference paths are listed; embedded or remote sources are never copied into the brief.
  function localReference(source) {
    const value = clean(source);
    if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('\\') || value.includes('..')) return '';
    return value;
  }

  function metadataAttributes(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const entries = Object.entries(input).filter(([, value]) => value === null || typeof value === 'string' ||
      typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
    return entries.length ? Object.fromEntries(entries) : null;
  }
  function metadataText(value) { return value === null ? 'Not specified' : (typeof value === 'string' ? oneLine(value) : String(value)); }

  function makeBriefData(project, ids, invariants, options = {}) {
    const a = axes(project);
    const isReady = typeof options.isReady === 'function' ? options.isReady : defaultReady;
    const format = OUTPUT_EXT[options.format] || 'png';
    const labeling = options.labeling === 'none' ? 'none' : 'caption';
    const byId = new Map(orderedCells(project).map(cell => [cell.id, cell]));
    const wanted = [];
    for (const id of Array.isArray(ids) ? ids : []) if (byId.has(id) && !wanted.includes(id)) wanted.push(id);
    const projectReferences = new Map();
    const items = wanted.map(id => {
      const cell = byId.get(id);
      const n = cellNames(project, cell);
      const rowName = oneLine(n.row.name) || n.row.id;
      const columnName = oneLine(n.column.name) || n.column.id;
      const rowReference = localReference(n.row.source);
      const columnReference = localReference(n.column.source);
      if (rowReference) projectReferences.set(`row:${n.row.id}`, { path: rowReference, row: rowName });
      if (columnReference) projectReferences.set(`column:${n.column.id}`, { path: columnReference, column: columnName });
      const rowAttributes = metadataAttributes(n.row.attributes);
      const columnAttributes = metadataAttributes(n.column.attributes);
      const legacy = Object.entries(cell.attributes || {}).find(([key, value]) => key.toLowerCase() === 'description' && typeof value === 'string')?.[1];
      const description = oneLine(cell.description || legacy);
      const cellAttributes = metadataAttributes(Object.fromEntries(Object.entries(cell.attributes || {}).filter(([key, value]) => !(key.toLowerCase() === 'description' && typeof value === 'string'))));
      return {
        cellId: id,
        row: { id: n.row.id, name: rowName, description: oneLine(n.row.description), ...(rowAttributes ? { attributes: rowAttributes } : {}) },
        column: { id: n.column.id, name: columnName, description: oneLine(n.column.description), ...(columnAttributes ? { attributes: columnAttributes } : {}) },
        ...(description ? {description} : {}),
        ...(cellAttributes ? { attributes: cellAttributes } : {}),
        currentState: isReady(cell) ? 'has-image' : 'pending',
        change: `Set ${a.rowsLabel} to “${rowName}” and ${a.columnsLabel} to “${columnName}”.`,
        caption: n.caption,
        outputFile: `${id}.${format}`
      };
    });
    const batch = options.batch || {};
    return {
      kind: 'otro-matiz-ai-brief',
      version: 1,
      notice: 'This is a brief for your AI tool. Nothing was sent automatically.',
      preparedOn: options.now || new Date().toISOString().slice(0, 10),
      project: { id: project && project.id || '', title: oneLine(project && project.title) || 'Untitled project', goal: clean(project && project.goal) },
      scope: SCOPE_NAMES[options.scope] || '',
      batch: { number: batch.number || 1, of: batch.of || 1, first: batch.first || (items.length ? 1 : 0), last: batch.last || items.length, inScope: batch.inScope || items.length },
      axes: {
        rows: { label: a.rowsLabel, values: a.rows.map(row => ({ id: row.id, name: oneLine(row.name) || row.id })) },
        columns: { label: a.columnsLabel, values: a.columns.map(column => ({ id: column.id, name: oneLine(column.name) || column.id })) }
      },
      keepUnchanged: clean(invariants),
      additionalChanges: clean(options.additional),
      referenceFiles: (Array.isArray(options.references) ? options.references : []).map(oneLine).filter(Boolean),
      projectReferences: [...projectReferences.values()],
      labeling,
      outputFormat: format,
      items
    };
  }

  function makeBrief(project, ids, invariants, options = {}) {
    const d = makeBriefData(project, ids, invariants, options);
    const lines = [];
    const push = (...values) => lines.push(...values);
    push(`AI IMAGE BRIEF — ${d.project.title}`, `Prepared ${d.preparedOn} in Otro Matiz. ${d.notice}`, '');
    if (d.batch.of > 1) push(`Batch ${d.batch.number} of ${d.batch.of}: cells ${d.batch.first}–${d.batch.last} of ${d.batch.inScope}${d.scope ? ` (${d.scope})` : ''}.`, '');
    else if (d.scope) push(`Scope: ${d.scope}, ${d.items.length} ${d.items.length === 1 ? 'image' : 'images'}.`, '');
    push('PROJECT GOAL', d.project.goal || '(No goal written in the project.)', '');
    push('AXES');
    push(`${d.axes.rows.label} (${d.axes.rows.values.length}): ${d.axes.rows.values.map(v => v.name).join(', ') || '(none)'}`);
    push(`${d.axes.columns.label} (${d.axes.columns.values.length}): ${d.axes.columns.values.map(v => v.name).join(', ') || '(none)'}`, '');
    push('KEEP UNCHANGED', d.keepUnchanged || '(Nothing specified.)', '');
    if (d.additionalChanges) push('ALSO CHANGE IN EVERY IMAGE', d.additionalChanges, '');
    push('REFERENCE FILES (local; attach them yourself if your AI tool accepts files)');
    if (!d.referenceFiles.length && !d.projectReferences.length) push('(None listed.)');
    for (const name of d.referenceFiles) push(`- ${name}`);
    for (const ref of d.projectReferences) push(ref.column !== undefined
      ? `- ${ref.path} (${d.axes.columns.label} reference: ${ref.column})`
      : `- ${ref.path} (${d.axes.rows.label} reference: ${ref.row})`);
    push('');
    push(`IMAGES TO PRODUCE (${d.items.length})`);
    if (!d.items.length) push('(No cells selected.)');
    d.items.forEach((item, index) => {
      push(`${index + 1}. Cell ID: ${item.cellId}`);
      push(`   ${d.axes.rows.label}: ${item.row.name}${item.row.description ? ` — ${item.row.description}` : ''}`);
      push(`   ${d.axes.columns.label}: ${item.column.name}${item.column.description ? ` — ${item.column.description}` : ''}`);
      if (item.description) push(`   Description: ${item.description}`);
      for (const [label, attributes] of [[d.axes.rows.label, item.row.attributes], [d.axes.columns.label, item.column.attributes], ['This option', item.attributes]]) {
        if (!attributes) continue;
        push(`   ${label} specifications:`);
        for (const [key, value] of Object.entries(attributes)) push(`      ${key}: ${metadataText(value)}`);
      }
      push(`   Change: ${item.change}`);
      push(`   Current state: ${item.currentState === 'pending' ? 'no image yet' : 'has an image; this output replaces it'}`);
      push(d.labeling === 'caption' ? `   Caption text in the image, exactly: “${item.caption}”` : '   Caption: none; put no text in the image');
      push(`   Output file name: ${item.outputFile}`);
    });
    push('');
    push('OUTPUT RULES');
    push('- Produce exactly one image per cell ID listed above. Do not skip, merge, reorder or add images.');
    push(`- Name each file exactly as given (cell ID + .${d.outputFormat}) so it can be attached to the matching cell.`);
    push(d.labeling === 'caption' ? '- Use the caption text exactly as written; do not add other text.' : '- Do not render any text, captions or labels in the images.');
    push('- If a cell cannot be produced, name its cell ID and the reason instead of substituting another image.');
    push('- Deliver PNG, JPEG or WebP, each no larger than 12 MiB.');
    push('');
    push('CELL ID → OUTPUT FILE (return this mapping unchanged)');
    for (const item of d.items) push(`${item.cellId} → ${item.outputFile}`);
    return lines.join('\n');
  }

  async function sniffType(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...head.subarray(start, end));
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (head.length >= 8 && png.every((byte, index) => head[index] === byte)) return 'image/png';
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return '';
  }
  function declaredType(file) {
    const type = clean(file.type).toLowerCase();
    if (type === 'image/jpg') return 'image/jpeg';
    if (type) return TYPE_NAMES[type] ? type : `unsupported:${type}`;
    const extension = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
    return EXTENSIONS[(extension || '').toLowerCase()] || 'unsupported:unknown';
  }
  function decode(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = async () => {
        try { if (image.decode) await image.decode(); } catch (_) { /* onload already confirmed decodable */ }
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => reject(new Error('the browser could not decode it as an image (the file may be damaged)'));
      image.src = url;
    });
  }
  // Checks declared type, signature, size and decodability. Returns {type,width,height,url}; caller owns url.
  async function inspectImage(file) {
    if (!file) throw new Error('choose an image file first');
    const declared = declaredType(file);
    if (declared.startsWith('unsupported:')) throw new Error('only PNG, JPEG or WebP files can be attached');
    if (!file.size) throw new Error('the file is empty');
    if (file.size > MAX_BYTES) throw new Error(`the file is ${formatBytes(file.size)}; the limit is 12 MiB`);
    const detected = await sniffType(file);
    if (!detected) throw new Error('the file contents are not a PNG, JPEG or WebP image');
    if (detected !== declared) throw new Error(`the file is labelled ${TYPE_NAMES[declared]} but its contents are ${TYPE_NAMES[detected]}; re-export it with the right extension`);
    const url = URL.createObjectURL(file);
    try {
      const size = await decode(url);
      if (!size.width || !size.height) throw new Error('the image has no readable dimensions');
      if (size.width < MIN_SIDE || size.height < MIN_SIDE) throw new Error(`the image is ${size.width}×${size.height}px; each side must be at least ${MIN_SIDE}px`);
      if (size.width > MAX_SIDE || size.height > MAX_SIDE) throw new Error(`the image is ${size.width}×${size.height}px; each side must be at most ${MAX_SIDE}px`);
      return { type: detected, width: size.width, height: size.height, url };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  async function toDataUrl(file, type) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    return `data:${type};base64,${btoa(binary)}`;
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = element('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function field(labelText, control, hintText) {
    const wrap = element('div', 'gen-field');
    const label = element('label', 'gen-label', labelText);
    label.htmlFor = control.id;
    wrap.append(label);
    if (hintText) {
      const hint = element('p', 'gen-hint', hintText);
      hint.id = `${control.id}-hint`;
      control.setAttribute('aria-describedby', hint.id);
      wrap.append(hint);
    }
    wrap.append(control);
    return wrap;
  }
  function button(text, className = 'gen-button') {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  }

  function mount() {
    const root = document.getElementById('generation-panel');
    if (!root || root.dataset.genMounted) return;
    root.dataset.genMounted = 'true';
    const store = window.ProjectStore;
    const app = window.MATRIX_APP || null;
    const details = element('details', 'gen-panel');
    const summary = element('summary', 'gen-summary', 'AI handoff');
    const body = element('div', 'gen-body');
    details.append(summary, body);
    root.append(details);
    if (!store || typeof store.get !== 'function' || typeof store.update !== 'function') {
      body.append(element('p', 'gen-error', 'The AI handoff is unavailable because project storage did not load. Reload the page to try again.'));
      return;
    }
    const isReady = cell => (app && typeof app.isReady === 'function' ? app.isReady(cell) : defaultReady(cell));
    const current = () => { try { return store.get(); } catch (_) { return null; } };
    const hasImage = cell => Boolean(cell && cell.status === 'ready' && cell.src);

    const state = { scope: 'missing', pick: new Set(), batchIndex: 0, references: [], signature: '' };

    const notice = element('p', 'gen-notice', 'This creates a brief for your AI; nothing is sent automatically.');
    const lede = element('p', 'gen-lede', 'Copy or download the brief, use it in the AI tool you choose, then attach each returned image to its exact cell ID below.');
    body.append(notice, lede);

    // ——— Brief builder ———
    const briefSection = element('section', 'gen-section');
    const briefHeading = element('h3', 'gen-heading', 'Write the brief');
    briefHeading.id = 'gen-brief-heading';
    briefSection.setAttribute('aria-labelledby', briefHeading.id);

    const scopeSet = element('fieldset', 'gen-scope');
    scopeSet.append(element('legend', 'gen-label', 'Cells to include'));
    const scopeRadios = new Map();
    const scopeCounts = new Map();
    for (const key of Object.keys(SCOPE_NAMES)) {
      const label = element('label', 'gen-choice');
      const input = element('input');
      input.type = 'radio';
      input.name = 'gen-scope';
      input.value = key;
      input.id = `gen-scope-${key}`;
      const count = element('span', 'gen-count');
      label.append(input, element('span', '', SCOPE_NAMES[key]), count);
      scopeRadios.set(key, input);
      scopeCounts.set(key, count);
      scopeSet.append(label);
    }
    const scopeHint = element('p', 'gen-hint gen-scope-hint');
    scopeHint.setAttribute('aria-live', 'polite');
    const pickExisting = button('Choose existing cells to regenerate', 'gen-button gen-link');
    pickExisting.hidden = true;

    const oneSelect = element('select', 'gen-input');
    oneSelect.id = 'gen-one-cell';
    const oneWrap = field('Cell', oneSelect);
    oneWrap.hidden = true;

    const pickWrap = element('fieldset', 'gen-pick');
    pickWrap.hidden = true;
    pickWrap.append(element('legend', 'gen-label', 'Cells to regenerate'));
    const pickTools = element('div', 'gen-actions');
    const pickReady = button('Select all with images');
    const pickClear = button('Clear');
    pickTools.append(pickReady, pickClear);
    const pickList = element('div', 'gen-pick-list');
    pickWrap.append(pickTools, pickList);

    const batchInput = element('input', 'gen-input gen-batch-size');
    batchInput.type = 'number';
    batchInput.id = 'gen-batch-size';
    batchInput.min = '1';
    batchInput.max = '400';
    batchInput.step = '1';
    batchInput.value = '12';
    batchInput.inputMode = 'numeric';
    const batchWrap = element('div', 'gen-batch');
    const batchText = element('p', 'gen-batch-text');
    const batchNav = element('div', 'gen-actions');
    const batchPrev = button('Previous batch');
    const batchNext = button('Next batch');
    batchNav.append(batchPrev, batchNext);
    batchWrap.append(field('Images per brief', batchInput, 'Split large requests into batches your AI tool can handle.'), batchText, batchNav);

    const additional = element('textarea', 'gen-input');
    additional.id = 'gen-additional';
    additional.rows = 3;
    additional.maxLength = 4000;
    const invariants = element('textarea', 'gen-input');
    invariants.id = 'gen-invariants';
    invariants.rows = 3;
    invariants.maxLength = 4000;
    invariants.placeholder = 'e.g. same subject, angle, lighting, background and framing';

    const referenceInput = element('input', 'gen-input gen-file');
    referenceInput.type = 'file';
    referenceInput.id = 'gen-references';
    referenceInput.multiple = true;
    const referenceList = element('ul', 'gen-reference-list');
    const referenceClear = button('Clear file names');
    referenceClear.hidden = true;

    const labeling = element('select', 'gen-input');
    labeling.id = 'gen-labeling';
    for (const [value, text] of [['caption', 'Exact caption in the image'], ['none', 'No text in the image']]) labeling.append(new Option(text, value));
    const format = element('select', 'gen-input');
    format.id = 'gen-format';
    for (const [value, text] of [['png', 'PNG (.png)'], ['jpg', 'JPEG (.jpg)'], ['webp', 'WebP (.webp)']]) format.append(new Option(text, value));
    const optionsRow = element('div', 'gen-row');
    optionsRow.append(field('Labeling', labeling), field('Output file type', format));

    const preview = element('textarea', 'gen-input gen-preview');
    preview.id = 'gen-preview';
    preview.readOnly = true;
    preview.rows = 14;
    preview.spellcheck = false;
    const actions = element('div', 'gen-actions');
    const copyButton = button('Copy brief', 'gen-button gen-primary');
    const txtButton = button('Download .txt');
    const jsonButton = button('Download .json');
    actions.append(copyButton, txtButton, jsonButton);
    const briefStatus = element('p', 'gen-status');
    briefStatus.setAttribute('role', 'status');

    briefSection.append(
      briefHeading, scopeSet, scopeHint, pickExisting, oneWrap, pickWrap, batchWrap,
      field('Things to change in every image (optional)', additional, 'Each cell already asks for its own row and column values.'),
      field('Keep unchanged', invariants, 'Write what must stay the same. The brief adds nothing you did not write.'),
      field('Reference files (names only)', referenceInput, 'Only file names go into the brief. Files are not read, uploaded or embedded; give them to your AI yourself.'),
      referenceList, referenceClear, optionsRow,
      field('Brief (plain text)', preview), actions, briefStatus
    );

    // ——— Attach form ———
    const attachSection = element('section', 'gen-section');
    const attachHeading = element('h3', 'gen-heading', 'Attach generated image');
    attachHeading.id = 'gen-attach-heading';
    attachSection.setAttribute('aria-labelledby', attachHeading.id);
    const form = element('form', 'gen-form');
    form.noValidate = true;
    form.setAttribute('aria-labelledby', attachHeading.id);
    const attachSelect = element('select', 'gen-input');
    attachSelect.id = 'gen-attach-cell';
    attachSelect.required = true;
    const caption = element('p', 'gen-caption');
    caption.id = 'gen-attach-caption';
    caption.setAttribute('aria-live', 'polite');
    const fileInput = element('input', 'gen-input gen-file');
    fileInput.type = 'file';
    fileInput.id = 'gen-attach-file';
    fileInput.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
    fileInput.required = true;
    const localPreview = element('figure', 'gen-local');
    localPreview.hidden = true;
    const localImage = element('img', 'gen-local-image');
    localImage.alt = '';
    const localCaption = element('figcaption', 'gen-hint');
    localPreview.append(localImage, localCaption);
    const fileStatus = element('p', 'gen-file-status');
    fileStatus.setAttribute('aria-live', 'polite');
    const confirmLabel = element('label', 'gen-choice gen-confirm');
    const confirm = element('input');
    confirm.type = 'checkbox';
    confirm.id = 'gen-attach-confirm';
    confirmLabel.append(confirm, element('span', '', 'Replace the existing image in this cell'));
    confirmLabel.hidden = true;
    const submit = element('button', 'gen-button gen-primary', 'Attach image');
    submit.type = 'submit';
    const attachStatus = element('p', 'gen-status');
    attachStatus.setAttribute('role', 'status');
    const cellField = field('Cell ID', attachSelect, 'Choose the exact cell the image was made for. Only that cell changes.');
    cellField.append(caption);
    attachSelect.setAttribute('aria-describedby', `${attachSelect.id}-hint ${caption.id}`);
    form.append(cellField, field('Image file (PNG, JPEG or WebP, up to 12 MiB)', fileInput), fileStatus, localPreview, confirmLabel, submit, attachStatus);
    attachSection.append(attachHeading, form);

    body.append(briefSection, attachSection);

    // ——— Data helpers ———
    function scopeIds(project, scope) {
      if (!project) return [];
      const cells = orderedCells(project);
      if (scope === 'missing') return cells.filter(cell => !isReady(cell)).map(cell => cell.id);
      if (scope === 'selection') {
        const selected = new Set(app && app.selected ? app.selected : []);
        return cells.filter(cell => selected.has(cell.id)).map(cell => cell.id);
      }
      if (scope === 'favorites') {
        const favorites = new Set(Array.isArray(project.favorites) ? project.favorites : []);
        return cells.filter(cell => favorites.has(cell.id)).map(cell => cell.id);
      }
      if (scope === 'pick') return cells.filter(cell => state.pick.has(cell.id)).map(cell => cell.id);
      if (scope === 'one') return cells.some(cell => cell.id === oneSelect.value) ? [oneSelect.value] : [];
      return [];
    }
    function batchSize() {
      const value = Math.floor(Number(batchInput.value));
      return Number.isFinite(value) && value >= 1 ? Math.min(value, 400) : 12;
    }
    function optionText(project, cell) {
      return `${cell.id} — ${cellNames(project, cell).caption}`;
    }

    // Rebuilds cell pickers only when cell IDs, names or image states changed, preserving choices.
    function rebuildCellControls(project) {
      const cells = orderedCells(project);
      const signature = JSON.stringify([project && project.id, project && project.rowsLabel, project && project.columnsLabel,
        cells.map(cell => [cell.id, optionText(project, cell), isReady(cell), hasImage(cell)])]);
      if (signature === state.signature) return;
      state.signature = signature;
      const known = new Set(cells.map(cell => cell.id));
      for (const id of [...state.pick]) if (!known.has(id)) state.pick.delete(id);
      const rowsLabel = axes(project).rowsLabel;

      const oneValue = oneSelect.value;
      oneSelect.replaceChildren();
      let group = null;
      let groupRow = null;
      for (const cell of cells) {
        if (cell.row !== groupRow) {
          groupRow = cell.row;
          group = element('optgroup');
          group.label = `${rowsLabel}: ${cellNames(project, cell).row.name || cell.row}`;
          oneSelect.append(group);
        }
        group.append(new Option(`${optionText(project, cell)}${isReady(cell) ? '' : ' (pending)'}`, cell.id));
      }
      if (known.has(oneValue)) oneSelect.value = oneValue;

      pickList.replaceChildren();
      groupRow = null;
      let box = null;
      for (const cell of cells) {
        if (cell.row !== groupRow) {
          groupRow = cell.row;
          box = element('div', 'gen-pick-group');
          box.setAttribute('role', 'group');
          const title = element('p', 'gen-pick-title', cellNames(project, cell).row.name || cell.row);
          title.id = `gen-pick-row-${pickList.children.length}`;
          box.setAttribute('aria-labelledby', title.id);
          box.append(title);
          pickList.append(box);
        }
        const label = element('label', 'gen-choice');
        const input = element('input');
        input.type = 'checkbox';
        input.value = cell.id;
        input.checked = state.pick.has(cell.id);
        const names = cellNames(project, cell);
        label.append(input, element('span', '', `${names.column.name || cell.column}`), element('span', 'gen-cell-id', `${cell.id}${isReady(cell) ? '' : ' · pending'}`));
        box.append(label);
      }

      const attachValue = attachSelect.value;
      attachSelect.replaceChildren();
      const pending = element('optgroup');
      pending.label = 'Needs an image';
      const filled = element('optgroup');
      filled.label = 'Has an image (will be replaced)';
      for (const cell of cells) (hasImage(cell) ? filled : pending).append(new Option(optionText(project, cell), cell.id));
      if (pending.children.length) attachSelect.append(pending);
      if (filled.children.length) attachSelect.append(filled);
      if (known.has(attachValue)) attachSelect.value = attachValue;
      else if (pending.firstElementChild) attachSelect.value = pending.firstElementChild.value;
      updateAttachCaption();
    }

    function updateAttachCaption() {
      const project = current();
      const cell = project && orderedCells(project).find(item => item.id === attachSelect.value);
      if (!cell) {
        caption.textContent = 'No cell chosen.';
        confirmLabel.hidden = true;
        return;
      }
      const names = cellNames(project, cell);
      caption.textContent = hasImage(cell)
        ? `Replaces the current image in cell ${cell.id} (“${names.caption}”). No other cell changes.`
        : `Fills pending cell ${cell.id} (“${names.caption}”). No other cell changes.`;
      confirmLabel.hidden = !hasImage(cell);
      if (confirmLabel.hidden) confirm.checked = false;
    }

    function scopeHintText(scope, total, project) {
      if (total) return '';
      if (scope === 'missing') {
        const a = axes(project);
        const gaps = a.rows.length * a.columns.length - orderedCells(project).length;
        return gaps > 0
          ? `Every cell with an ID has an image. ${gaps} grid ${gaps === 1 ? 'position has' : 'positions have'} no cell ID, so ${gaps === 1 ? 'it' : 'they'} cannot be briefed or attached. You can still regenerate existing cells.`
          : 'No missing combinations: every cell already has an image. You can choose existing cells to regenerate instead.';
      }
      if (scope === 'selection') return 'No options are selected for comparison. Use “Select to compare” on up to two options.';
      if (scope === 'favorites') return 'This project has no favorites yet.';
      if (scope === 'pick') return 'Tick the cells to include below.';
      return 'Choose a cell.';
    }

    function render() {
      const project = current();
      if (!project) {
        scopeHint.textContent = 'The project is not available yet.';
        return;
      }
      rebuildCellControls(project);
      for (const [key, count] of scopeCounts) {
        count.textContent = key === 'one' ? '' : ` (${scopeIds(project, key).length})`;
      }
      const ids = scopeIds(project, state.scope);
      const size = batchSize();
      const batches = Math.max(1, Math.ceil(ids.length / size));
      state.batchIndex = Math.min(Math.max(0, state.batchIndex), batches - 1);
      const start = state.batchIndex * size;
      const batchIds = ids.slice(start, start + size);
      scopeHint.textContent = scopeHintText(state.scope, ids.length, project);
      pickExisting.hidden = !(state.scope === 'missing' && !ids.length);
      oneWrap.hidden = state.scope !== 'one';
      pickWrap.hidden = state.scope !== 'pick';
      batchText.textContent = ids.length
        ? `${ids.length} ${ids.length === 1 ? 'cell' : 'cells'} in scope. This brief covers ${batchIds.length === 1 ? `cell ${start + 1}` : `cells ${start + 1}–${start + batchIds.length}`}${batches > 1 ? ` (batch ${state.batchIndex + 1} of ${batches})` : ''}.`
        : 'No cells in scope yet.';
      batchPrev.disabled = state.batchIndex === 0;
      batchNext.disabled = state.batchIndex >= batches - 1;
      batchNav.hidden = batches < 2;
      const empty = !batchIds.length;
      preview.value = empty ? '' : makeBrief(project, batchIds, invariants.value, briefOptions(ids.length, batches, start, batchIds.length));
      preview.placeholder = empty ? 'Choose cells above to see the brief.' : '';
      for (const control of [copyButton, txtButton, jsonButton]) control.disabled = empty;
      state.last = { project, batchIds, total: ids.length, batches, start };
    }
    function briefOptions(total, batches, start, count) {
      return {
        isReady,
        scope: state.scope,
        additional: additional.value,
        references: state.references,
        labeling: labeling.value,
        format: format.value,
        batch: { number: state.batchIndex + 1, of: batches, first: start + 1, last: start + count, inScope: total }
      };
    }
    function fileBase() {
      const last = state.last;
      const suffix = last && last.batches > 1 ? `-batch-${state.batchIndex + 1}-of-${last.batches}` : '';
      return `${slug(last && last.project.title)}-ai-brief${suffix}`;
    }
    function say(node, text, kind) {
      node.textContent = text;
      node.classList.toggle('gen-bad', kind === 'bad');
      node.classList.toggle('gen-good', kind === 'good');
    }

    // ——— Brief events ———
    scopeSet.addEventListener('change', event => {
      if (event.target.name !== 'gen-scope') return;
      state.scope = event.target.value;
      state.batchIndex = 0;
      say(briefStatus, '');
      render();
    });
    pickExisting.addEventListener('click', () => {
      state.scope = 'pick';
      scopeRadios.get('pick').checked = true;
      state.batchIndex = 0;
      render();
      (pickList.querySelector('input') || scopeRadios.get('pick')).focus();
    });
    oneSelect.addEventListener('change', render);
    pickList.addEventListener('change', event => {
      const input = event.target;
      if (input.type !== 'checkbox') return;
      if (input.checked) state.pick.add(input.value);
      else state.pick.delete(input.value);
      render();
    });
    pickReady.addEventListener('click', () => {
      const project = current();
      for (const cell of orderedCells(project)) if (isReady(cell)) state.pick.add(cell.id);
      for (const input of pickList.querySelectorAll('input')) input.checked = state.pick.has(input.value);
      render();
    });
    pickClear.addEventListener('click', () => {
      state.pick.clear();
      for (const input of pickList.querySelectorAll('input')) input.checked = false;
      render();
    });
    batchInput.addEventListener('input', () => { state.batchIndex = 0; render(); });
    batchPrev.addEventListener('click', () => { state.batchIndex -= 1; render(); });
    batchNext.addEventListener('click', () => { state.batchIndex += 1; render(); });
    for (const control of [additional, invariants]) control.addEventListener('input', render);
    for (const control of [labeling, format]) control.addEventListener('change', render);
    referenceInput.addEventListener('change', () => {
      const names = [...referenceInput.files].map(file => oneLine(file.name).slice(0, 200)).filter(Boolean);
      for (const name of names) if (!state.references.includes(name) && state.references.length < MAX_REFERENCES) state.references.push(name);
      referenceInput.value = '';
      renderReferences();
      render();
    });
    referenceClear.addEventListener('click', () => {
      state.references = [];
      renderReferences();
      render();
      referenceInput.focus();
    });
    function renderReferences() {
      referenceList.replaceChildren(...state.references.map(name => element('li', '', name)));
      referenceClear.hidden = !state.references.length;
    }

    copyButton.addEventListener('click', async () => {
      const text = preview.value;
      if (!text) return;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (_) { copied = false; }
      if (!copied) {
        try {
          preview.focus();
          preview.select();
          copied = document.execCommand('copy');
        } catch (_) { copied = false; }
      }
      say(briefStatus, copied
        ? 'Brief copied. Paste it into your AI tool; nothing was sent from here.'
        : 'Copying was blocked by the browser. The brief text is selected: press Ctrl+C (or ⌘C) to copy it.', copied ? 'good' : 'bad');
    });
    txtButton.addEventListener('click', () => {
      if (!preview.value) return;
      download(`${fileBase()}.txt`, `${preview.value}\n`, 'text/plain;charset=utf-8');
      say(briefStatus, `Downloaded ${fileBase()}.txt.`, 'good');
    });
    jsonButton.addEventListener('click', () => {
      const last = state.last;
      if (!last || !last.batchIds.length) return;
      const data = makeBriefData(last.project, last.batchIds, invariants.value, briefOptions(last.total, last.batches, last.start, last.batchIds.length));
      data.text = preview.value;
      download(`${fileBase()}.json`, `${JSON.stringify(data, null, 2)}\n`, 'application/json');
      say(briefStatus, `Downloaded ${fileBase()}.json.`, 'good');
    });

    // ——— Attach events ———
    let inspection = 0;
    let checked = null;
    let busy = false;
    function clearLocal() {
      if (checked && checked.url) URL.revokeObjectURL(checked.url);
      checked = null;
      localImage.removeAttribute('src');
      localPreview.hidden = true;
    }
    async function checkFile() {
      const token = ++inspection;
      clearLocal();
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        say(fileStatus, '');
        return null;
      }
      say(fileStatus, `Checking ${file.name}…`);
      try {
        const result = await inspectImage(file);
        if (token !== inspection) {
          URL.revokeObjectURL(result.url);
          return null;
        }
        checked = Object.assign(result, { file });
        localImage.src = result.url;
        localImage.alt = `Local preview of ${file.name}`;
        localCaption.textContent = `${file.name} · ${TYPE_NAMES[result.type]} · ${result.width}×${result.height}px · ${formatBytes(file.size)}`;
        localPreview.hidden = false;
        say(fileStatus, 'Image checked. It stays on this device until you attach it.', 'good');
        return checked;
      } catch (error) {
        if (token === inspection) say(fileStatus, `${file.name} can’t be attached: ${error.message}.`, 'bad');
        return null;
      }
    }
    attachSelect.addEventListener('change', () => { updateAttachCaption(); say(attachStatus, ''); });
    fileInput.addEventListener('change', () => { say(attachStatus, ''); checkFile(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const project = current();
      const id = attachSelect.value;
      const cell = project && orderedCells(project).find(item => item.id === id);
      if (!cell) {
        say(attachStatus, 'Choose the cell ID this image belongs to.', 'bad');
        attachSelect.focus();
        return;
      }
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        say(attachStatus, 'Choose a PNG, JPEG or WebP file to attach.', 'bad');
        fileInput.focus();
        return;
      }
      if (hasImage(cell) && !confirm.checked) {
        say(attachStatus, `Cell ${id} already has an image. Tick “Replace the existing image in this cell” to confirm.`, 'bad');
        confirm.focus();
        return;
      }
      busy = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      try {
        say(attachStatus, 'Checking the image…');
        const result = checked && checked.file === file ? checked : await checkFile();
        if (!result) throw new Error(fileStatus.textContent || 'the image could not be checked');
        say(attachStatus, `Saving the image to cell ${id}…`);
        const dataUrl = await toDataUrl(file, result.type);
        const latest = current();
        if (!latest || latest.id !== project.id) throw new Error('the active project changed while saving. Nothing was attached; try again');
        if (!latest.data.cells.some(item => item.id === id)) throw new Error(`cell ${id} no longer exists in this project`);
        const cells = latest.data.cells.map(item => (item.id === id ? Object.assign({}, item, { status: 'ready', src: dataUrl }) : item));
        await store.update({ data: Object.assign({}, latest.data, { cells }) });
        const persistent = !(typeof store.status === 'function' && store.status() && store.status().persistent === false);
        if (persistent) {
          say(attachStatus, `Attached to cell ${id}. Reloading to show it…`, 'good');
          if (app && typeof app.announce === 'function') app.announce(`Image attached to cell ${id}. Reloading.`);
          window.location.reload();
          return;
        }
        say(attachStatus, `Attached to cell ${id} for this session only: storage is unavailable, so it is not saved. Reloading would discard it; export the project to keep it.`, 'bad');
      } catch (error) {
        const message = error && error.message ? error.message.replace(/\.$/, '') : 'unknown error';
        say(attachStatus, `Not attached: ${message}. Your project and this form were left as they were.`, 'bad');
      } finally {
        busy = false;
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    });

    // ——— Outside changes ———
    const refresh = () => render();
    document.addEventListener('studio:change', refresh);
    document.addEventListener('matrix:selectionchange', refresh);
    document.addEventListener('matrix:favoriteschange', refresh);
    document.addEventListener('matrix:imagefailed', refresh);

    const initial = current();
    if (initial && !scopeIds(initial, 'missing').length) state.scope = 'pick';
    scopeRadios.get(state.scope).checked = true;
    render();
    if (state.scope === 'pick' && initial) scopeHint.textContent = 'No missing combinations: every cell already has an image. Tick existing cells below to regenerate them.';
  }

  window.StudioGeneration = Object.freeze({ makeBrief, makeBriefData, inspectImage });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
