(() => {
  'use strict';
  const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
  const MAX_BRIEF_ITEMS = 6;
  const FETCH_CONCURRENCY = 6;
  const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const STATUS_LABELS = { chosen: 'Chosen', shortlisted: 'Shortlisted', considered: 'Considered', 'ruled-out': 'Ruled out', unreviewed: 'Not yet decided' };
  const DEFAULT_BRIEF = { recipient: 'general', recipientName: '', nextStep: '', brand: '' };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  function slug(text) {
    return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
  }
  function isoDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function sizeLabel(bytes) { return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MiB`; }
  function getStore() {
    const store = window.ProjectStore;
    if (!store || typeof store.get !== 'function' || !store.get()) throw new Error('Project storage is not ready. Reload the page and try again.');
    return store;
  }
  function namer(project) {
    const rows = new Map((project.data?.rows || []).map(item => [item.id, item.name]));
    const columns = new Map((project.data?.columns || []).map(item => [item.id, item.name]));
    return cell => ({ row: rows.get(cell.row) || cell.row, column: columns.get(cell.column) || cell.column });
  }
  // Only relative paths beneath the page are fetched; everything else is refused before any request.
  function isLocalPath(src) {
    if (typeof src !== 'string' || !src || src.length > 2048) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^[\\/]/.test(src) || src.includes('\\')) return false;
    return !src.split('/').some(part => part === '..');
  }
  function sniffMime(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return '';
  }
  function readDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
      reader.readAsDataURL(blob);
    });
  }
  async function toDataUrl(src) {
    if (typeof src === 'string' && src.startsWith('data:')) {
      if (DATA_IMAGE.test(src)) return src;
      throw new Error('Unsupported embedded image.');
    }
    if (!isLocalPath(src)) throw new Error('Not a local image path.');
    const response = await fetch(src, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const mime = sniffMime(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
    if (!mime) throw new Error('Not a PNG, JPEG or WebP image.');
    const url = await readDataUrl(new Blob([blob], { type: mime }));
    if (!DATA_IMAGE.test(url)) throw new Error('Image could not be encoded.');
    return url;
  }
  function limiter(size) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= size || !queue.length) return;
      active++;
      const { task, resolve, reject } = queue.shift();
      task().then(resolve, reject).finally(() => { active--; next(); });
    };
    return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
  }
  // One conversion per distinct src; failures are collected rather than thrown so all problems are reported together.
  function makeEmbedder(onProgress) {
    const cache = new Map();
    const failed = [];
    const limit = limiter(FETCH_CONCURRENCY);
    let done = 0;
    function embed(src) {
      if (!cache.has(src)) {
        cache.set(src, limit(() => toDataUrl(src)).then(url => url, () => { failed.push(String(src).slice(0, 120)); return null; })
          .finally(() => { done++; if (onProgress) onProgress(done, cache.size); }));
      }
      return cache.get(src);
    }
    return { embed, failed };
  }
  function imageError(failed) {
    const shown = failed.slice(0, 3).join(', ') + (failed.length > 3 ? `, and ${failed.length - 3} more` : '');
    let message = `${failed.length === 1 ? 'One image' : `${failed.length} images`} could not be read (${shown}), so nothing was exported.`;
    message += location.protocol === 'file:'
      ? ' Browsers block reading image files when the studio is opened straight from disk. Serve the folder locally instead — for example run "python -m http.server 8000" inside public-core and open http://localhost:8000 — then try again.'
      : ' Check that these files still exist beside the studio, then try again.';
    const error = new Error(message);
    error.failed = failed.slice();
    return error;
  }

  async function embedProject(project, onProgress) {
    if (!project?.data) throw new Error('There is no project to export.');
    const copy = clone(project);
    const targets = [];
    for (const item of [...(copy.data.rows || []), ...(copy.data.columns || [])]) if (typeof item?.source === 'string' && item.source) targets.push([item, 'source']);
    for (const item of copy.data.cells || []) for (const key of ['src', 'detail']) if (typeof item?.[key] === 'string' && item[key]) targets.push([item, key]);
    const embedder = makeEmbedder(onProgress);
    await Promise.all(targets.map(async ([item, key]) => {
      const url = await embedder.embed(item[key]);
      if (url) item[key] = url;
    }));
    if (embedder.failed.length) throw imageError(embedder.failed);
    return copy;
  }

  function candidates(project) {
    const favorites = new Set(Array.isArray(project?.favorites) ? project.favorites : []);
    const decisions = project?.decisions || {};
    const list = [];
    for (const cell of project?.data?.cells || []) {
      const status = decisions[cell.id]?.status;
      const favorite = favorites.has(cell.id);
      if (!cell.src || !(status === 'chosen' || status === 'shortlisted' || favorite)) continue;
      list.push({ cell, status: STATUS_LABELS[status] ? status : 'unreviewed', favorite, rank: status === 'chosen' ? 0 : status === 'shortlisted' ? 1 : 2 });
    }
    return list.sort((a, b) => a.rank - b.rank);
  }
  function tagsFor(status, favorite) {
    const tags = [STATUS_LABELS[status] || STATUS_LABELS.unreviewed];
    if (favorite) tags.push('Favorite');
    return tags.join(' · ');
  }
  // Lists are read fresh from the stored project (StudioLists only as a fallback); membership is never taken from events.
  let controller = null;
  function listsOf(project) {
    let raw = Array.isArray(project?.lists) ? project.lists : null;
    if (!raw) { try { raw = typeof window.StudioLists?.all === 'function' ? window.StudioLists.all() : []; } catch { raw = []; } }
    return (Array.isArray(raw) ? raw : []).filter(list => list && typeof list.id === 'string')
      .map(list => ({ id: list.id, name: String(list.name || '').trim() || 'Untitled list', cellIds: Array.isArray(list.cellIds) ? list.cellIds.filter(id => typeof id === 'string') : [] }));
  }
  function findList(project, id) { return listsOf(project).find(list => list.id === id) || null; }
  function listSig(list) { return list ? JSON.stringify([list.id, list.name, list.cellIds]) : ''; }
  function listCandidates(project, list) {
    const byId = new Map((project?.data?.cells || []).map(cell => [cell.id, cell]));
    const favorites = new Set(Array.isArray(project?.favorites) ? project.favorites : []);
    return (list?.cellIds || []).map(id => {
      const cell = byId.get(id);
      const status = project?.decisions?.[id]?.status;
      return { cell: cell || { id }, status: STATUS_LABELS[status] ? status : 'unreviewed', favorite: favorites.has(id), available: !!cell?.src, reason: !cell ? 'No longer in this project' : !cell.src ? 'No image yet, can’t be included' : '' };
    });
  }

  const BRIEF_CSS = `:root{color-scheme:light;--ink:#1f2a22;--muted:#5b645d;--line:#dcd4c4;--paper:#faf6ee;--accent:#2f5a3f}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 22px 56px}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;line-height:1.2}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 8px}h1{font-size:34px;margin:0 0 6px}
.meta{color:var(--muted);margin:0 0 30px;font-size:14px}section{margin:0 0 30px}h2{font-size:20px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.text,.note{white-space:pre-line;margin:0}.option-description{margin-top:8px}.muted{color:var(--muted);font-style:italic;margin:0}
.options{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px}figure{margin:0;break-inside:avoid;page-break-inside:avoid}
figure img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#fff}figcaption{padding-top:10px}
.tags{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 4px}h3{font-size:18px;margin:0 0 6px}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:14px}dt{color:var(--muted)}dd{margin:0}.note{margin-top:8px;font-size:15px}
footer{border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:13px}
@page{margin:14mm}@media print{body{background:#fff}main{max-width:none;padding:0}.options{grid-template-columns:repeat(2,1fr)}figure img{max-height:110mm;object-fit:contain}h2{break-after:avoid}section:last-of-type{break-inside:avoid}}`;

  async function buildBrief(project, ids, options = {}) {
    if (!project?.data) throw new Error('There is no project to build a brief from.');
    const unique = [...new Set(Array.isArray(ids) ? ids : [])];
    if (!unique.length) throw new Error('Select at least one image for the brief.');
    if (unique.length > MAX_BRIEF_ITEMS) throw new Error(`A brief can include at most ${MAX_BRIEF_ITEMS} images.`);
    const list = options.list && typeof options.list.id === 'string' ? options.list : null;
    if (list) {
      const members = new Set(Array.isArray(list.cellIds) ? list.cellIds : []);
      if (unique.some(id => !members.has(id))) throw new Error(`An image outside the list "${list.name}" was requested, so nothing was built.`);
    }
    const byId = new Map((project.data.cells || []).map(cell => [cell.id, cell]));
    const rows = new Map((project.data.rows || []).map(row => [row.id, row]));
    const columns = new Map((project.data.columns || []).map(column => [column.id, column]));
    const name = namer(project);
    const favorites = new Set(Array.isArray(project.favorites) ? project.favorites : []);
    const items = unique.map(id => {
      const cell = byId.get(id);
      if (!cell) throw new Error('A selected image is no longer part of this project.');
      const names = name(cell);
      if (!cell.src) throw new Error(`${names.row} · ${names.column} has no image yet.`);
      const decision = project.decisions?.[id] || {};
      // Only the public note is read; privateNote is never touched here.
      const legacy = Object.entries(cell.attributes || {}).find(([key, value]) => key.toLowerCase() === 'description' && typeof value === 'string')?.[1];
      const descriptions = [...new Set([rows.get(cell.row)?.description, columns.get(cell.column)?.description, cell.description || legacy]
        .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
      return { cell, ...names, descriptions, status: STATUS_LABELS[decision.status] ? decision.status : 'unreviewed', favorite: favorites.has(id), note: typeof decision.note === 'string' ? decision.note.trim() : '' };
    });
    const embedder = makeEmbedder(options.onProgress);
    const urls = await Promise.all(items.map(item => embedder.embed(item.cell.src)));
    if (embedder.failed.length || !urls.every(url => url && DATA_IMAGE.test(url))) throw imageError(embedder.failed.length ? embedder.failed : ['embedded image']);

    const publicNotes = options.publicNotes !== false;
    const date = options.date instanceof Date ? options.date : new Date();
    const dateLabel = date.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });
    const title = String(project.title || '').trim() || 'Untitled project';
    const goal = String(project.goal || '').trim();
    const nextStep = String(options.nextStep ?? project.brief?.nextStep ?? '').trim();
    const recipientName = String(project.brief?.recipientName || '').trim();
    const rowsLabel = String(project.rowsLabel || '').trim() || 'Row';
    const columnsLabel = String(project.columnsLabel || '').trim() || 'Column';
    const text = (value, empty) => value ? `<p class="text">${escapeHtml(value)}</p>` : `<p class="muted">${escapeHtml(empty)}</p>`;
    const figures = items.map((item, index) => {
      const label = `${item.row} · ${item.column}`;
      const note = publicNotes && item.note ? `<p class="note">${escapeHtml(item.note)}</p>` : '';
      const descriptions = item.descriptions.map(value => `<p class="text option-description">${escapeHtml(value)}</p>`).join('');
      return `<figure><img src="${escapeHtml(urls[index])}" alt="${escapeHtml(label)}"><figcaption><p class="tags">${escapeHtml(tagsFor(item.status, item.favorite))}</p><h3>${escapeHtml(label)}</h3><dl><dt>${escapeHtml(rowsLabel)}</dt><dd>${escapeHtml(item.row)}</dd><dt>${escapeHtml(columnsLabel)}</dt><dd>${escapeHtml(item.column)}</dd></dl>${descriptions}${note}</figcaption></figure>`;
    }).join('\n');
    const meta = `${recipientName ? `Prepared for ${escapeHtml(recipientName)} · ` : ''}Snapshot of <time datetime="${isoDate(date)}">${escapeHtml(dateLabel)}</time>`;
    const noteLine = publicNotes ? 'Public notes are included.' : 'Notes are not included.';
    const annotationLine = unique.some(id => Array.isArray(project.annotations?.[id]) && project.annotations[id].length)
      ? ' Numbered annotations saved on these images are omitted from this basic brief.' : '';
    const listLine = list ? `<p class="meta">List “${escapeHtml(list.name)}” · ${items.length} of ${list.cellIds.length} saved image${list.cellIds.length === 1 ? '' : 's'}, membership as of ${escapeHtml(dateLabel)}</p>` : '';
    const listFoot = list ? ` Images come only from the saved list “${escapeHtml(list.name)}” as it stood when this brief was built; later list edits do not change this file.` : '';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}${list ? ` — ${escapeHtml(list.name)}` : ''} — brief, ${isoDate(date)}</title>
<style>${BRIEF_CSS}</style>
</head>
<body>
<main>
<header><p class="kicker">Otro Matiz · Brief</p><h1>${escapeHtml(title)}</h1><p class="meta">${meta}</p>${listLine}</header>
<section><h2>Goal</h2>${text(goal, 'No goal has been written for this project yet.')}</section>
<section><h2>${list ? 'Selected from this list' : 'Selected options'}</h2><div class="options">
${figures}
</div></section>
<section><h2>Next step</h2>${text(nextStep, 'No next step has been written yet.')}</section>
<footer><p>Created locally with Otro Matiz on ${escapeHtml(dateLabel)}. Statuses are the decisions recorded in the project; favorites are marked separately and do not imply a decision. ${noteLine} Private notes are never included in a brief.${annotationLine}${listFoot}</p></footer>
</main>
</body>
</html>`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function loadFrame(frame, html) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The brief took too long to load.')), 30000);
      frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      frame.srcdoc = html;
    });
  }
  async function printFrame(frame) {
    const win = frame.contentWindow;
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    if (!win || !doc) throw new Error('This browser blocked printing from the studio. Download the HTML, open it, and print from there.');
    const images = [...doc.images];
    await Promise.all(images.map(img => img.complete ? null : new Promise(done => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    })));
    await Promise.all(images.map(img => (img.decode ? img.decode().catch(() => {}) : null)));
    const broken = images.filter(img => !img.naturalWidth).length;
    if (broken) throw new Error(`${broken === 1 ? 'One image' : `${broken} images`} in the brief did not load, so printing was stopped.`);
    win.focus();
    win.print();
  }
  async function printHtml(html) {
    const frame = element('iframe', 'pt-print-frame');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = 'Brief print copy';
    document.body.append(frame);
    try {
      await loadFrame(frame, html);
      await printFrame(frame);
    } finally {
      setTimeout(() => frame.remove(), 2000);
    }
  }

  function mount() {
    const host = document.getElementById('exchange-panel');
    if (!host || host.querySelector('.pt-panel')) return;
    let busy = false;
    let picked = new Set();
    let touched = false;
    let nextDirty = false;
    let scopeListId = null;
    let scopeListName = '';
    let scopeState = { list: null, missing: false };

    const button = (text, className) => { const node = element('button', className, text); node.type = 'button'; return node; };
    const statusLine = () => { const node = element('p', 'pt-status'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); return node; };
    const setStatus = (node, text, isError = false) => { node.textContent = text; node.classList.toggle('is-error', isError); };
    const checkbox = (id, text, checked) => {
      const wrap = element('div', 'pt-check');
      const input = element('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = checked;
      const label = element('label', '', text);
      label.htmlFor = id;
      wrap.append(input, label);
      return { wrap, input };
    };
    const section = (title, intro) => {
      const node = element('section', 'pt-section');
      node.append(element('h3', '', title), element('p', 'pt-intro', intro));
      return node;
    };

    const details = element('details', 'pt-panel');
    const body = element('div', 'pt-body');
    details.append(element('summary', 'pt-summary', 'Export & import'), body);

    // 1. Portable project file
    const saveSection = section('Portable project file', 'Download this project as one JSON file to keep a backup or continue on another device. Reference images and option images are copied into the file.');
    const privateToggle = checkbox('pt-include-private', 'Include private notes in this file', false);
    const privateHint = element('p', 'pt-hint');
    privateHint.id = 'pt-private-hint';
    privateToggle.input.setAttribute('aria-describedby', privateHint.id);
    const syncPrivateHint = () => {
      privateHint.textContent = privateToggle.input.checked
        ? 'Private notes WILL be in this file. Share it only with people allowed to read them.'
        : 'Private notes will be left out.';
      privateHint.classList.toggle('pt-warn', privateToggle.input.checked);
    };
    syncPrivateHint();
    const withImages = button('Download project with images', 'pt-primary');
    const metadataOnly = button('Project metadata (images not included)');
    const saveActions = element('div', 'pt-actions');
    saveActions.append(withImages, metadataOnly);
    const saveStatus = statusLine();
    saveSection.append(privateToggle.wrap, privateHint, saveActions, saveStatus);
    if (location.protocol === 'file:') {
      saveSection.insertBefore(element('p', 'pt-hint pt-warn', 'This page is open straight from disk, so the browser may block copying images. Open the studio through a local server (for example http://localhost:8000), or use the metadata-only file.'), saveActions);
    }

    // 2. Import
    const importSection = section('Import a project', 'Adds the file as a new project and opens it. Your current project stays in the project list. Files up to 300 MiB.');
    const importField = element('div', 'pt-field');
    const fileInput = element('input', 'pt-file');
    fileInput.type = 'file';
    fileInput.id = 'pt-import-file';
    fileInput.accept = 'application/json,.json';
    const fileLabel = element('label', '', 'Project JSON file');
    fileLabel.htmlFor = fileInput.id;
    importField.append(fileLabel, fileInput);
    const importStatus = statusLine();
    importSection.append(importField, importStatus);
    const datasetContainer = element('div', 'pt-dataset-import');
    datasetContainer.id = 'pt-dataset-import';
    importSection.append(datasetContainer);
    window.DatasetImport?.mount(datasetContainer);

    // 3. Brief
    const briefSection = section('Brief to share', `A standalone page with up to ${MAX_BRIEF_ITEMS} images you pick, the project goal, their recorded status and the next step. It opens offline and can be printed or saved as PDF.`);
    const annotationHint = element('p', 'pt-hint', 'This basic brief omits numbered annotations. Use the professional brief’s Detailed layout with Include annotations enabled to share them.');
    annotationHint.hidden = true;
    const picks = element('fieldset', 'pt-picks');
    const pickHint = element('p', 'pt-hint');
    pickHint.id = 'pt-pick-hint';
    picks.setAttribute('aria-describedby', pickHint.id);
    const pickList = element('ul', 'pt-pick-list');
    picks.append(element('legend', '', `Images for the brief (up to ${MAX_BRIEF_ITEMS})`), pickHint, pickList);
    const notesToggle = checkbox('pt-public-notes', 'Include public notes', true);
    const nextField = element('div', 'pt-field');
    const nextInput = element('textarea');
    nextInput.id = 'pt-next-step';
    nextInput.rows = 2;
    nextInput.maxLength = 2000;
    const nextLabel = element('label', '', 'Next step');
    nextLabel.htmlFor = nextInput.id;
    nextField.append(nextLabel, nextInput);
    const previewButton = button('Preview brief', 'pt-primary');
    const downloadButton = button('Download HTML');
    const printButton = button('Print / PDF');
    const briefActions = element('div', 'pt-actions');
    briefActions.append(previewButton, downloadButton, printButton);
    const briefStatus = statusLine();
    const scopeField = element('div', 'pt-field');
    const scopeSelect = element('select');
    scopeSelect.id = 'pt-brief-scope';
    const scopeLabel = element('label', '', 'Brief scope');
    scopeLabel.htmlFor = scopeSelect.id;
    scopeField.append(scopeLabel, scopeSelect);
    briefSection.append(scopeField, picks, notesToggle.wrap, element('p', 'pt-hint', 'Private notes are never included in a brief.'), annotationHint, nextField, briefActions, briefStatus);

    body.append(saveSection, importSection, briefSection);
    host.append(details);

    // Preview dialog
    const dialog = element('dialog', 'pt-preview');
    dialog.setAttribute('aria-labelledby', 'pt-preview-title');
    const dialogHead = element('div', 'pt-preview-head');
    const dialogTitle = element('h2', '', 'Brief preview');
    dialogTitle.id = 'pt-preview-title';
    const closeButton = button('Close');
    dialogHead.append(dialogTitle, closeButton);
    const frame = element('iframe', 'pt-preview-frame');
    frame.title = 'Brief preview';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    const dialogDownload = button('Download HTML', 'pt-primary');
    const dialogPrint = button('Print / PDF');
    const dialogActions = element('div', 'pt-actions');
    dialogActions.append(dialogDownload, dialogPrint);
    const dialogStatus = statusLine();
    dialog.append(dialogHead, frame, dialogActions, dialogStatus);
    document.body.append(dialog);
    let preview = null;
    let opener = null;
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      preview = null;
      frame.srcdoc = '';
      if (opener?.isConnected) opener.focus();
    });

    const actionButtons = [withImages, metadataOnly, dialogDownload, dialogPrint];
    function updatePickState() {
      const inputs = [...pickList.querySelectorAll('input')];
      const count = picked.size;
      for (const input of inputs) input.disabled = busy || input.dataset.unavailable === '1' || (!input.checked && count >= MAX_BRIEF_ITEMS);
      scopeSelect.disabled = busy;
      const { list, missing } = scopeState;
      if (missing) pickHint.textContent = `The list “${scopeListName || 'you picked'}” no longer exists, so a new brief can’t be built from it. Choose another scope.`;
      else if (list) {
        const total = list.cellIds.length;
        const off = inputs.filter(input => input.dataset.unavailable === '1').length;
        let hint = !total ? 'This list has no saved images yet. Add images to it from Favorites, then come back.'
          : total > MAX_BRIEF_ITEMS ? `This list has ${total} saved images; a brief holds at most ${MAX_BRIEF_ITEMS}, so choose which to include. None are picked for you. ${count} of ${MAX_BRIEF_ITEMS} selected.`
          : `${count} of ${total - off} list image${total - off === 1 ? '' : 's'} selected.`;
        if (off) hint += ` ${off} saved image${off === 1 ? ' has' : 's have'} no picture and can’t be included.`;
        pickHint.textContent = hint;
      } else if (!inputs.length) pickHint.textContent = 'No choices yet. Mark images as Chosen or Shortlisted, or add favorites, then come back to build a brief.';
      else if (!count) pickHint.textContent = 'Select at least one image to build a brief.';
      else if (count >= MAX_BRIEF_ITEMS) pickHint.textContent = `${count} of ${MAX_BRIEF_ITEMS} selected, the maximum. Clear one to swap it for another.`;
      else pickHint.textContent = `${count} of ${MAX_BRIEF_ITEMS} selected.`;
      for (const node of [previewButton, downloadButton, printButton]) node.disabled = busy || !count || missing;
    }
    function setBusy(value) {
      busy = value;
      for (const node of actionButtons) node.disabled = value;
      fileInput.disabled = value;
      updatePickState();
    }
    async function run(statusNode, task) {
      if (busy) return;
      setBusy(true);
      setStatus(statusNode, 'Working…');
      try {
        const message = await task();
        if (message) setStatus(statusNode, message);
      } catch (error) {
        setStatus(statusNode, error?.message || String(error), true);
        if (dialog.open && statusNode !== dialogStatus) setStatus(dialogStatus, error?.message || String(error), true);
      } finally {
        setBusy(false);
      }
    }

    function renderPicks() {
      if (!details.open) return;
      let project;
      try { project = getStore().get(); } catch (error) {
        pickList.replaceChildren();
        updatePickState();
        pickHint.textContent = error.message;
        return;
      }
      renderScopeOptions(project);
      annotationHint.hidden = !Object.values(project.annotations || {}).some(pins => Array.isArray(pins) && pins.length);
      let list;
      if (scopeListId) {
        const saved = findList(project, scopeListId);
        if (saved) scopeListName = saved.name;
        scopeState = { list: saved, missing: !saved };
        list = saved ? listCandidates(project, saved) : [];
        const available = new Set(list.filter(item => item.available).map(item => item.cell.id));
        // Six or fewer: all usable members. More than six: the user must pick; never the first six.
        if (!touched) picked = saved && saved.cellIds.length <= MAX_BRIEF_ITEMS ? available : new Set();
        else for (const id of [...picked]) if (!available.has(id)) picked.delete(id);
      } else {
        scopeState = { list: null, missing: false };
        list = candidates(project).map(item => ({ ...item, available: true }));
        const available = new Set(list.map(item => item.cell.id));
        if (!touched) picked = new Set(list.filter(item => item.rank < 2).slice(0, MAX_BRIEF_ITEMS).map(item => item.cell.id));
        else for (const id of [...picked]) if (!available.has(id)) picked.delete(id);
      }
      const focusedId = pickList.contains(document.activeElement) ? document.activeElement.dataset.cellId : null;
      const name = namer(project);
      pickList.replaceChildren(...list.map((item, index) => {
        const names = name(item.cell);
        const li = element('li');
        const label = element('label', 'pt-pick');
        const input = element('input');
        input.type = 'checkbox';
        input.id = `pt-pick-${index}`;
        input.dataset.cellId = item.cell.id;
        input.checked = item.available && picked.has(item.cell.id);
        if (!item.available) input.dataset.unavailable = '1';
        const thumb = element('img');
        if (item.available) thumb.src = item.cell.src;
        thumb.alt = '';
        thumb.loading = 'lazy';
        const textWrap = element('span', 'pt-pick-text');
        const tags = tagsFor(item.status, item.favorite) + (item.reason ? ` · ${item.reason}` : '');
        textWrap.append(element('span', 'pt-pick-name', names.row ? `${names.row} · ${names.column}` : item.cell.id), element('span', 'pt-pick-tags', tags));
        label.append(input, thumb, textWrap);
        li.append(label);
        return li;
      }));
      if (!nextDirty && document.activeElement !== nextInput) nextInput.value = project.brief?.nextStep || '';
      updatePickState();
      if (focusedId) [...pickList.querySelectorAll('input')].find(input => input.dataset.cellId === focusedId)?.focus();
    }
    function renderScopeOptions(project) {
      const lists = listsOf(project);
      const options = [new Option('Chosen, shortlisted & favorites (no list)', ''), ...lists.map(list => new Option(`List: ${list.name} (${list.cellIds.length})`, list.id))];
      if (scopeListId && !lists.some(list => list.id === scopeListId)) options.push(new Option(`List: ${scopeListName || 'unknown'} (deleted)`, scopeListId));
      scopeSelect.replaceChildren(...options);
      scopeSelect.value = scopeListId || '';
    }
    function setScope(id) {
      if ((id || null) !== scopeListId) { scopeListId = id || null; scopeListName = ''; touched = false; picked = new Set(); }
      renderPicks();
    }
    scopeSelect.addEventListener('change', () => setScope(scopeSelect.value || null));
    // A built snapshot never changes; list edits only mark it stale.
    function checkStale() {
      if (!dialog.open || !preview?.listId) return;
      let list = null;
      try { const project = getStore().get(); if (project.id === preview.projectId) list = findList(project, preview.listId); } catch { list = null; }
      if (!list) setStatus(dialogStatus, `The list “${preview.listName}” was deleted after this snapshot. This preview and its download are unchanged, but it can’t be rebuilt from that list.`, true);
      else if (listSig(list) !== preview.sig) setStatus(dialogStatus, `Stale: “${preview.listName}” was renamed or its images changed after this snapshot. This preview and its download are unchanged; close and rebuild to update.`, true);
    }
    pickList.addEventListener('change', event => {
      const input = event.target;
      if (!input?.dataset?.cellId || input.dataset.unavailable) return;
      touched = true;
      if (input.checked && picked.size < MAX_BRIEF_ITEMS) picked.add(input.dataset.cellId);
      else { input.checked = false; picked.delete(input.dataset.cellId); }
      updatePickState();
    });
    details.addEventListener('toggle', renderPicks);
    document.addEventListener('studio:change', renderPicks);
    document.addEventListener('matrix:favoriteschange', renderPicks);
    document.addEventListener('studio:listschange', renderPicks);
    document.addEventListener('studio:change', checkStale);
    document.addEventListener('studio:listschange', checkStale);
    privateToggle.input.addEventListener('change', syncPrivateHint);

    nextInput.addEventListener('input', () => { nextDirty = true; });
    nextInput.addEventListener('change', async () => {
      try {
        const store = getStore();
        const project = store.get();
        const value = nextInput.value.trim();
        if ((project.brief?.nextStep || '') !== value) {
          await store.update({ brief: { ...DEFAULT_BRIEF, ...(project.brief || {}), nextStep: value } });
          setStatus(briefStatus, store.status?.().persistent === false ? 'Next step kept for this session only; storage is unavailable.' : 'Next step saved.');
        }
        nextDirty = false;
      } catch (error) {
        setStatus(briefStatus, `Next step not saved: ${error.message} It will still be used in this brief.`, true);
      }
    });

    function exportProject(includeImages) {
      return run(saveStatus, async () => {
        const store = getStore();
        const project = clone(store.get());
        const includePrivate = privateToggle.input.checked;
        if (!includePrivate) for (const decision of Object.values(project.decisions || {})) if (decision && typeof decision === 'object') decision.privateNote = '';
        let result = project;
        let removed = 0;
        if (includeImages) {
          try {
            result = await embedProject(project, (done, total) => setStatus(saveStatus, `Copying images ${done} of ${total}…`));
          } catch (error) {
            throw new Error(`${error.message} You can still download "Project metadata (images not included)".`);
          }
        } else {
          for (const item of [...(project.data.rows || []), ...(project.data.columns || [])]) if (typeof item.source === 'string' && item.source.startsWith('data:')) { delete item.source; removed++; }
          for (const cell of project.data.cells || []) for (const key of ['src', 'detail']) if (typeof cell[key] === 'string' && cell[key].startsWith('data:')) { delete cell[key]; if (key === 'src') cell.status = 'pending'; removed++; }
        }
        setStatus(saveStatus, 'Checking the file…');
        let valid;
        try { valid = store.validate(result); } catch (error) { throw new Error(`The export did not pass validation, so nothing was downloaded: ${error.message}`); }
        const blob = new Blob([JSON.stringify(valid, null, includeImages ? 0 : 2)], { type: 'application/json' });
        if (blob.size > MAX_IMPORT_BYTES) throw new Error(`This file would be ${sizeLabel(blob.size)}, above the 300 MiB import limit, so nothing was downloaded. Use "Project metadata (images not included)" instead.`);
        const filename = `otro-matiz-${slug(valid.title)}-${includeImages ? 'project' : 'metadata'}-${isoDate()}.json`;
        download(blob, filename);
        const parts = [`Downloaded ${filename} (${sizeLabel(blob.size)}).`];
        parts.push(includeImages ? 'Images are included.' : 'Images are not included; the file refers to image files beside the studio.');
        if (removed) parts.push(`${removed} embedded image${removed === 1 ? ' was' : 's were'} left out and will appear as pending.`);
        parts.push(includePrivate ? 'Private notes are included.' : 'Private notes were left out.');
        return parts.join(' ');
      });
    }
    withImages.addEventListener('click', () => exportProject(true));
    metadataOnly.addEventListener('click', () => exportProject(false));

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      run(importStatus, async () => {
        const unchanged = 'Nothing was imported; your current project is unchanged.';
        try {
          if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} is ${sizeLabel(file.size)}, above the 300 MiB limit. ${unchanged}`);
          if (!file.size) throw new Error(`${file.name} is empty. ${unchanged}`);
          const store = getStore();
          if (store.status?.().persistent === false) throw new Error(`Storage is unavailable in this browser session, so an imported project would be lost when the page reloads. ${unchanged}`);
          setStatus(importStatus, `Reading ${file.name}…`);
          let parsed;
          try { parsed = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} is not a readable JSON file. ${unchanged}`); }
          setStatus(importStatus, 'Checking the project…');
          try { store.validate(parsed); } catch (error) { throw new Error(`${file.name} can't be imported: ${error.message} ${unchanged}`); }
          setStatus(importStatus, 'Saving as a new project…');
          let project;
          try { project = await store.importProject(parsed); } catch (error) { throw new Error(`Saving the import failed: ${error.message} ${unchanged}`); }
          setStatus(importStatus, `Imported "${project?.title || file.name}" as a new project. Reloading…`);
          location.reload();
          return '';
        } finally {
          fileInput.value = '';
        }
      });
    });

    async function makeBrief(statusNode) {
      const project = getStore().get();
      let ids;
      let list = null;
      if (scopeListId) {
        list = findList(project, scopeListId);
        if (!list) throw new Error(`The list “${scopeListName || 'you picked'}” no longer exists, so a new brief can’t be built from it. Choose another scope.`);
        const available = new Set(listCandidates(project, list).filter(item => item.available).map(item => item.cell.id));
        ids = list.cellIds.filter(id => picked.has(id) && available.has(id));
        if (ids.length > MAX_BRIEF_ITEMS) throw new Error(`Select at most ${MAX_BRIEF_ITEMS} images from this list.`);
      } else ids = candidates(project).filter(item => picked.has(item.cell.id)).map(item => item.cell.id).slice(0, MAX_BRIEF_ITEMS);
      const html = await buildBrief(project, ids, {
        list,
        publicNotes: notesToggle.input.checked,
        nextStep: nextInput.value,
        onProgress: (done, total) => setStatus(statusNode, `Embedding images ${done} of ${total}…`)
      });
      return { html, filename: `otro-matiz-${slug(project.title)}${list ? `-${slug(list.name)}` : ''}-brief-${isoDate()}.html`, count: ids.length, projectId: project.id, listId: list?.id || null, listName: list?.name || '', sig: listSig(list) };
    }
    const saveHtml = brief => {
      download(new Blob([brief.html], { type: 'text/html;charset=utf-8' }), brief.filename);
      return `Downloaded ${brief.filename} with ${brief.count} image${brief.count === 1 ? '' : 's'}. It opens offline in any browser.`;
    };
    const printHint = 'Print dialog opened. Choose "Save as PDF" as the destination to keep a PDF.';

    previewButton.addEventListener('click', event => {
      const source = event.currentTarget;
      run(briefStatus, async () => {
        const brief = await makeBrief(briefStatus);
        opener = source;
        preview = brief;
        setStatus(dialogStatus, 'Loading preview…');
        dialog.showModal();
        closeButton.focus();
        await loadFrame(frame, brief.html);
        setStatus(dialogStatus, 'This is exactly what the downloaded file contains.');
        checkStale();
        return 'Preview opened.';
      });
    });
    downloadButton.addEventListener('click', () => run(briefStatus, async () => saveHtml(await makeBrief(briefStatus))));
    printButton.addEventListener('click', () => run(briefStatus, async () => {
      const brief = await makeBrief(briefStatus);
      setStatus(briefStatus, 'Preparing images for print…');
      await printHtml(brief.html);
      return printHint;
    }));
    dialogDownload.addEventListener('click', () => run(dialogStatus, async () => {
      if (!preview) throw new Error('Open the preview again.');
      return saveHtml(preview);
    }));
    dialogPrint.addEventListener('click', () => run(dialogStatus, async () => {
      if (!preview) throw new Error('Open the preview again.');
      await printFrame(frame);
      return printHint;
    }));

    controller = {
      openList(listId) {
        let project = null;
        try { project = getStore().get(); } catch { project = null; }
        const list = project ? findList(project, listId) : null;
        setScope(listId);
        if (window.StudioPresentation?.openTool) window.StudioPresentation.openTool('files');
        else { const shell = document.getElementById('studio-tools-disclosure'); if (shell) shell.open = true; }
        details.open = true;
        renderPicks();
        if (!project) setStatus(briefStatus, 'Project storage is not ready, so the list could not be opened. Reload the page and try again.', true);
        else if (!list) setStatus(briefStatus, 'That list could not be found; it may have been deleted. Choose a scope below.', true);
        else setStatus(briefStatus, `Brief scoped to the list “${list.name}”.`);
        briefSection.scrollIntoView?.({ block: 'start' });
        scopeSelect.focus({ preventScroll: true });
        return !!list;
      }
    };
    updatePickState();
  }

  function openListBrief(listId) {
    if (typeof listId !== 'string' || !listId) return false;
    try {
      const premium = window.parent !== window ? window.parent.PremiumBrief : null;
      if (premium && typeof premium.openList === 'function' && typeof premium.isReady === 'function' && premium.isReady() && premium.openList(listId) !== false) return true;
    } catch { /* parent is cross-origin or not the premium shell */ }
    if (!controller) mount();
    return controller ? controller.openList(listId) : false;
  }
  document.addEventListener('studio:briefrequest', event => {
    const listId = event.detail?.listId;
    if (event.defaultPrevented || typeof listId !== 'string' || !listId) return;
    event.preventDefault();
    openListBrief(listId);
  });

  window.StudioPortability = Object.freeze({ embedProject, buildBrief, candidates, listCandidates, openListBrief });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
