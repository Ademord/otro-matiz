/* Local dataset adapters. Parsing and mapping are shared with the Node tests. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.DatasetImport = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 300 * 1024 * 1024;
  const MAX_RECORDS = 400;
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  const copy = value => JSON.parse(JSON.stringify(value));
  function byteLength(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes++;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function checkSize(text, maxBytes = MAX_BYTES) {
    if (typeof text !== 'string') throw new Error('The dataset must be text.');
    if (text.length > maxBytes || byteLength(text) > maxBytes) throw new Error('The dataset exceeds the 300 MiB file limit.');
  }
  function parseCSV(input, options = {}) {
    checkSize(input, options.maxBytes);
    const text = input.replace(/^\uFEFF/, '');
    const records = []; let row = [], field = '', quoted = false, closed = false, line = 1;
    function finishRow() {
      row.push(field);
      if (!(row.length === 1 && row[0].trim() === '')) records.push(row);
      if (records.length > MAX_RECORDS + 1) throw new Error('The dataset has more than 400 records. Choose a smaller table.');
      row = []; field = ''; closed = false;
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else if (ch === '\r' || ch === '\n') {
          field += '\n'; line++; if (ch === '\r' && text[i + 1] === '\n') i++;
        } else field += ch;
        continue;
      }
      if (closed && ch !== ',' && ch !== '\r' && ch !== '\n') {
        if (ch === ' ' || ch === '\t') continue;
        throw new Error(`CSV line ${line}: unexpected text after a closing quote.`);
      }
      if (ch === '"') {
        if (field) throw new Error(`CSV line ${line}: quotes must start at the beginning of a field.`);
        quoted = true;
      } else if (ch === ',') { row.push(field); field = ''; closed = false; }
      else if (ch === '\r' || ch === '\n') { finishRow(); line++; if (ch === '\r' && text[i + 1] === '\n') i++; }
      else field += ch;
    }
    if (quoted) throw new Error(`CSV line ${line}: an opening quote has no closing quote.`);
    if (field || row.length || closed) finishRow();
    if (!records.length) throw new Error('The CSV is empty. Add a header row and at least one record.');
    const headers = records.shift().map(value => value.trim());
    const seen = new Set();
    for (const [index, header] of headers.entries()) {
      if (!header) throw new Error(`CSV header ${index + 1} is empty. Give every column a name.`);
      if (seen.has(header.toLowerCase())) throw new Error(`CSV repeats the header “${header}”. Use unique column names.`);
      if (['__proto__', 'constructor', 'prototype'].includes(header)) throw new Error(`CSV header “${header}” is reserved. Rename it.`);
      seen.add(header.toLowerCase());
    }
    if (!records.length) throw new Error('The CSV has headers but no records.');
    if (records.length > MAX_RECORDS) throw new Error('The dataset has more than 400 records. Choose a smaller table.');
    return records.map((values, index) => {
      if (values.length !== headers.length) throw new Error(`CSV record ${index + 1} has ${values.length} fields; the header has ${headers.length}. Check commas and quotes.`);
      return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    });
  }
  function parseInput(text, filename = '') {
    checkSize(text);
    if (/\.csv$/i.test(filename)) return {kind: 'records', tables: [{name: 'CSV records', records: parseCSV(text)}]};
    let value;
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('This is not valid JSON. Choose a .json or .csv dataset.'); }
    if (plain(value) && own(value, 'schemaVersion') && own(value, 'data')) return {kind: 'project', project: value};
    if (plain(value) && (own(value, 'rows') || own(value, 'haircuts'))) return {kind: 'structured', data: value};
    if (Array.isArray(value)) return {kind: 'records', tables: [{name: 'Records', records: value}]};
    if (plain(value)) {
      const keys = Object.keys(value).filter(key => Array.isArray(value[key]) && value[key].every(plain));
      keys.sort((a, b) => (a === 'records' || a === 'items' ? -1 : 0) - (b === 'records' || b === 'items' ? -1 : 0));
      if (keys.length) return {kind: 'records', tables: keys.map(name => ({name, records: value[name]}))};
    }
    throw new Error('Use a row/column dataset, a project, or a JSON array of records. JSON objects can contain tables such as “records”, “items” or “products”.');
  }
  function recordFields(records) {
    if (!Array.isArray(records) || !records.length) throw new Error('This table has no records.');
    if (records.length > MAX_RECORDS) throw new Error('The dataset has more than 400 records. Choose a smaller table.');
    const fields = new Set();
    records.forEach((record, index) => {
      if (!plain(record)) throw new Error(`Record ${index + 1} must be an object with named fields.`);
      for (const key of Object.keys(record)) {
        if (!scalar(record[key])) throw new Error(`Record ${index + 1}, field “${key}” contains nested data. Flatten objects and arrays into named scalar fields before importing.`);
        if (!key || key.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Record ${index + 1} has an unsupported field name. Use safe names of 1 to 80 characters.`);
        fields.add(key);
      }
    });
    return [...fields];
  }
  function suggestMapping(fields) {
    const pick = names => fields.find(field => names.includes(field.toLowerCase().replace(/[\s_-]+/g, ''))) || '';
    return {
      id: pick(['id', 'sku', 'code', 'identifier']), row: pick(['name', 'title', 'label', 'product', 'shape', 'style']), column: '',
      image: pick(['image', 'imageurl', 'imagepath', 'photo', 'src', 'preview', 'thumbnail']),
      description: pick(['description', 'notes', 'details', 'summary'])
    };
  }
  function slug(value, max = 80) {
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'item';
  }
  function uniqueId(name, taken, max = 80) {
    const base = slug(name, max); let id = base, suffix = 1;
    while (taken.has(id)) { const tail = `-${++suffix}`; id = base.slice(0, max - tail.length) + tail; }
    taken.add(id); return id;
  }
  function label(value, fallback) { return value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim(); }
  function mapRecords(records, mapping = {}, metadata = {}) {
    const fields = recordFields(records);
    for (const [role, key] of Object.entries(mapping)) if (key && !fields.includes(key)) throw new Error(`The selected ${role} field “${key}” does not exist in this table.`);
    const rows = [], columns = [], cells = [], rowIds = new Set(), columnIds = new Set(), cellIds = new Set(), pairs = new Set();
    const rowByName = new Map(), columnByName = new Map();
    const mapped = new Set([mapping.id, mapping.row, mapping.column, mapping.image, mapping.description].filter(Boolean));
    for (const [index, record] of records.entries()) {
      const rowName = label(mapping.row ? record[mapping.row] : undefined, `Item ${index + 1}`);
      const columnName = label(mapping.column ? record[mapping.column] : undefined, 'Preview');
      if (mapping.row && !label(record[mapping.row], '')) throw new Error(`Record ${index + 1} has an empty row/name field.`);
      if (mapping.column && !label(record[mapping.column], '')) throw new Error(`Record ${index + 1} has an empty column/variant field.`);
      let row = mapping.column ? rowByName.get(rowName) : null;
      if (!row) {
        row = {id: uniqueId(rowName, rowIds), name: rowName};
        rows.push(row); if (mapping.column) rowByName.set(rowName, row);
      }
      let column = columnByName.get(columnName);
      if (!column) { column = {id: uniqueId(columnName, columnIds), name: columnName}; columns.push(column); columnByName.set(columnName, column); }
      const pair = `${row.id}\n${column.id}`;
      if (pairs.has(pair)) throw new Error(`Record ${index + 1} repeats the row/column pair “${rowName} / ${columnName}”. Give variants distinct names.`);
      pairs.add(pair);
      let id;
      if (mapping.id) {
        id = label(record[mapping.id], '');
        if (!id || id.length > 170 || !ID.test(id)) throw new Error(`Record ${index + 1} has an unsafe ID. IDs use letters, numbers, hyphens or underscores and at most 170 characters. Choose “Generate IDs” to make new ones.`);
        if (cellIds.has(id)) throw new Error(`Record ${index + 1} repeats the ID “${id}”. IDs must be unique.`);
        cellIds.add(id);
      } else id = uniqueId(`${row.id}--${column.id}`, cellIds, 170);
      const image = mapping.image ? record[mapping.image] : '';
      if (image !== undefined && image !== null && typeof image !== 'string') throw new Error(`Record ${index + 1}: the image field must be a local path or embedded PNG, JPEG or WebP image.`);
      const src = typeof image === 'string' ? image.trim() : '';
      const attributes = Object.fromEntries(Object.entries(record).filter(([key]) => !mapped.has(key)));
      const cell = {id, row: row.id, column: column.id, status: src ? 'ready' : 'pending'};
      if (mapping.description && label(record[mapping.description], '')) cell.description = String(record[mapping.description]);
      if (src) cell.src = src;
      if (Object.keys(attributes).length) cell.attributes = attributes;
      cells.push(cell);
    }
    if (rows.length > 40 || columns.length > 40) throw new Error('Use at most 40 rows and 40 columns. Group records with a row/name and column/variant field, or choose a smaller table.');
    if (rows.length * columns.length > 400) throw new Error(`This mapping makes ${rows.length} × ${columns.length} = ${rows.length * columns.length} slots; the limit is 400.`);
    return {rows, columns, cells, meta: {...metadata}};
  }
  function extras(raw, known, path, previous = {}) {
    if (!plain(previous)) throw new Error(`${path}.attributes must be an object of scalar fields.`);
    const attributes = {...previous};
    for (const [key, value] of Object.entries(raw)) {
      if (known.includes(key)) continue;
      if (!scalar(value)) throw new Error(`${path}.${key} contains nested data. Flatten extra fields into scalar attributes before importing.`);
      if (own(attributes, key)) throw new Error(`${path}.${key} conflicts with an existing attribute.`);
      Object.defineProperty(attributes, key, {value, enumerable: true, configurable: true, writable: true});
    }
    return attributes;
  }
  function normalizeStructured(raw) {
    if (!plain(raw)) throw new Error('The dataset must be an object with rows, columns and cells.');
    if (raw.meta !== undefined && raw.meta !== null && !plain(raw.meta)) throw new Error('Dataset metadata must be an object with named fields.');
    const rows = own(raw, 'rows') ? raw.rows : raw.haircuts;
    const columns = own(raw, 'columns') ? raw.columns : raw.beards;
    const axis = (entries, path) => Array.isArray(entries) ? entries.map((entry, index) => {
      if (!plain(entry)) return entry;
      const attributes = extras(entry, ['id', 'name', 'description', 'source', 'referenceCaption', 'attributes'], `${path}[${index}]`, entry.attributes);
      return {...entry, ...(Object.keys(attributes).length ? {attributes} : {})};
    }) : entries;
    const meta = plain(raw.meta) ? raw.meta : {};
    const inherited = extras(raw, ['rows', 'columns', 'haircuts', 'beards', 'cells', 'meta'], 'data');
    const metaExtras = extras(meta, ['id', 'updatedAt', 'ready', 'total', 'title', 'goal', 'rowsLabel', 'columnsLabel', 'presentation'], 'data.meta');
    const cells = Array.isArray(raw.cells) ? raw.cells.map((entry, index) => {
      if (!plain(entry)) return entry;
      const attributes = extras(entry, ['id', 'row', 'column', 'haircut', 'beard', 'status', 'src', 'detail', 'description', 'attributes'], `data.cells[${index}]`, entry.attributes);
      for (const [key, value] of Object.entries(inherited)) attributes[`dataset.${key}`] = value;
      for (const [key, value] of Object.entries(metaExtras)) attributes[`meta.${key}`] = value;
      const cell = {...entry, row: own(entry, 'row') ? entry.row : entry.haircut, column: own(entry, 'column') ? entry.column : entry.beard};
      delete cell.haircut; delete cell.beard;
      if (!own(cell, 'status')) cell.status = cell.src ? 'ready' : 'pending';
      if (Object.keys(attributes).length) cell.attributes = attributes;
      return cell;
    }) : raw.cells;
    return {rows: axis(rows, 'data.rows'), columns: axis(columns, 'data.columns'), cells, meta: {...meta}};
  }
  function basename(path) {
    try { return decodeURIComponent(String(path).split('/').pop()); } catch { return String(path).split('/').pop(); }
  }
  function embedImages(data, images = []) {
    const files = new Map();
    for (const image of images) {
      if (!image || typeof image.name !== 'string' || typeof image.dataUrl !== 'string') throw new Error('Each selected image needs a filename and embedded image data.');
      const name = basename(image.name);
      if (files.has(name)) throw new Error(`Two selected images have the filename “${name}”. Choose one file for each name.`);
      files.set(name, image.dataUrl);
    }
    const result = copy(data), used = new Set();
    const targets = [...result.rows.map(item => [item, 'source']), ...result.columns.map(item => [item, 'source']),
      ...result.cells.flatMap(cell => [[cell, 'src'], [cell, 'detail']])];
    for (const [item, key] of targets) {
      const src = item[key];
      if (typeof src !== 'string' || !src || src.startsWith('data:')) continue;
      const name = basename(src);
      if (files.has(name)) { item[key] = files.get(name); used.add(name); }
    }
    return {data: result, used: [...used], unused: [...files.keys()].filter(name => !used.has(name))};
  }
  function prepareProject(parsed, options, store) {
    if (!store || typeof store.validateData !== 'function' || typeof store.validate !== 'function') throw new Error('Project storage is not ready. Reload the page and try again.');
    const settings = options || {};
    let source, original;
    if (parsed.kind === 'project') { original = store.validate(parsed.project); source = original.data; }
    else if (parsed.kind === 'structured') source = normalizeStructured(parsed.data);
    else if (parsed.kind === 'records') {
      const table = parsed.tables[settings.tableIndex || 0];
      if (!table) throw new Error('Choose a table from this JSON file.');
      source = mapRecords(table.records, settings.mapping || suggestMapping(recordFields(table.records)));
    } else throw new Error('No dataset is ready to review.');
    // Validate references before replacing paths, so selecting an image cannot
    // turn an unsafe URL into an accepted dataset.
    const validatedData = store.validateData(source);
    const embedded = embedImages(validatedData, settings.images);
    const data = store.validateData(embedded.data);
    const meta = data.meta || {};
    const project = store.validate({
      ...(original || {}), schemaVersion: 2, id: original?.id || 'dataset-preview',
      title: label(settings.title, original?.title || meta.title || 'Imported dataset'),
      goal: original?.goal || meta.goal || '',
      rowsLabel: label(settings.rowsLabel, original?.rowsLabel || meta.rowsLabel || 'Items'),
      columnsLabel: label(settings.columnsLabel, original?.columnsLabel || meta.columnsLabel || 'Variants'), data
    });
    checkSize(JSON.stringify(project));
    return {project, usedImages: embedded.used, unusedImages: embedded.unused};
  }
  async function importReviewed(store, project) {
    const valid = store.validate(project);
    if (store.status?.().persistent === false) throw new Error('This browser cannot save a new project right now. Keep the dataset file and try again when storage is available.');
    return store.importProject(valid);
  }
  function mount(container) {
    if (!container || container.dataset.importMounted) return;
    container.dataset.importMounted = 'true';
    const document = root.document;
    const el = (tag, cls, text) => {
      const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;
    };
    const field = (name, control, id, hint) => {
      const node = el('div', 'pt-field'), caption = el('label', '', name); control.id = id; caption.htmlFor = id;
      node.append(caption, control); if (hint) node.append(el('p', 'pt-hint', hint)); return node;
    };
    const button = text => { const node = el('button', 'pt-button', text); node.type = 'button'; return node; };
    const textInput = value => { const node = el('input', 'ws-input'); node.type = 'text'; node.value = value; return node; };
    const heading = el('h3', '', 'Load a dataset');
    const intro = el('p', 'pt-intro', 'Choose a JSON database or CSV table, review its fields, then load it as a new project. Files stay in this browser.');
    const sourceInput = el('input', 'pt-file'); sourceInput.type = 'file'; sourceInput.accept = '.json,.csv,application/json,text/csv';
    const examples = el('div', 'pt-actions');
    const colorExample = button('Color and form'), productExample = button('Product shades'); examples.append(colorExample, productExample);
    const controls = el('div'); controls.hidden = true;
    const tableSelect = el('select', 'ws-input'), tableField = field('Table to use', tableSelect, 'ds-table');
    const mappingPane = el('div'), selectors = {};
    const roles = [['id', 'Record ID', 'Generate IDs'], ['row', 'Row / name', 'One row per record'], ['column', 'Column / variant', 'One Preview column'], ['image', 'Image', 'No images yet'], ['description', 'Description', 'No description field']];
    for (const [role, name] of roles) { const select = el('select', 'ws-input'); selectors[role] = select; mappingPane.append(field(name, select, `ds-${role}`)); }
    const titleInput = textInput('Imported dataset'); titleInput.maxLength = 120;
    const rowLabel = textInput('Items'), columnLabel = textInput('Variants'); rowLabel.maxLength = columnLabel.maxLength = 60;
    const imageInput = el('input', 'pt-file'); imageInput.type = 'file'; imageInput.multiple = true; imageInput.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
    const reviewButton = button('Review dataset'), loadButton = button('Load as new project'); loadButton.disabled = true;
    const actions = el('div', 'pt-actions'); actions.append(reviewButton, loadButton);
    const preview = el('div', 'ds-preview'); preview.hidden = true; preview.setAttribute('aria-label', 'Dataset preview');
    const status = el('p', 'pt-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    controls.append(tableField, mappingPane, field('Project title', titleInput, 'ds-title'), field('Rows show', rowLabel, 'ds-rows-label'), field('Columns show', columnLabel, 'ds-columns-label'),
      field('Optional local image files', imageInput, 'ds-images', 'Match filenames from the dataset to embed PNG, JPEG or WebP files. Unmatched paths stay relative to the studio: use a filename, assets/ or guides/.'), preview, actions);
    container.replaceChildren(heading, intro, field('Dataset JSON or CSV file', sourceInput, 'ds-file', 'Up to 300 MiB; 40 rows, 40 columns and 400 combinations. Extra scalar fields are kept as attributes. Flatten nested fields before importing.'), examples, controls, status);
    let parsed = null, candidate = null, revision = 0, busy = false;
    function message(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); }
    function invalidate() { revision++; candidate = null; loadButton.disabled = true; preview.hidden = true; }
    function mapping() { return Object.fromEntries(Object.entries(selectors).map(([role, select]) => [role, select.value])); }
    function setBusy(value) {
      busy = value; sourceInput.disabled = imageInput.disabled = reviewButton.disabled = colorExample.disabled = productExample.disabled = value;
      tableSelect.disabled = titleInput.disabled = rowLabel.disabled = columnLabel.disabled = value;
      Object.values(selectors).forEach(select => { select.disabled = value; });
      loadButton.disabled = value || !candidate; container.setAttribute('aria-busy', String(value));
    }
    function setTable() {
      invalidate();
      const records = parsed.tables[Number(tableSelect.value)].records, fields = recordFields(records), suggested = suggestMapping(fields);
      for (const [role, , empty] of roles) {
        const select = selectors[role], first = el('option', '', empty); first.value = '';
        select.replaceChildren(first, ...fields.map(name => { const option = el('option', '', name); option.value = name; return option; }));
        select.value = suggested[role] || '';
      }
    }
    async function selectedImages() {
      const files = [...imageInput.files];
      if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Selected images exceed the 300 MiB limit.');
      const images = [];
      for (const file of files) {
        const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const mime = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 ? 'image/png'
          : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? 'image/jpeg'
            : String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP' ? 'image/webp' : '';
        if (!mime) throw new Error(`“${file.name}” is not a PNG, JPEG or WebP image.`);
        if (Math.ceil(file.size / 3) * 4 > 40 * 1024 * 1024) throw new Error(`“${file.name}” is larger than the 40 MiB embedded-image limit.`);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new root.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error || new Error(`Could not read “${file.name}”.`));
          reader.readAsDataURL(new root.Blob([file], {type: mime}));
        });
        images.push({name: file.name, dataUrl});
      }
      return images;
    }
    async function review() {
      if (!parsed || busy) return;
      invalidate(); const version = revision; setBusy(true); message('Reviewing dataset…');
      try {
        const images = await selectedImages();
        const reviewed = prepareProject(parsed, {tableIndex: Number(tableSelect.value) || 0, mapping: mapping(), title: titleInput.value,
          rowsLabel: rowLabel.value, columnsLabel: columnLabel.value, images}, root.ProjectStore);
        if (version !== revision) return;
        candidate = reviewed.project;
        const {rows, columns, cells} = candidate.data;
        const ready = cells.filter(cell => cell.status === 'ready').length;
        preview.replaceChildren(el('h4', '', candidate.title), el('p', 'pt-hint', `${rows.length} rows × ${columns.length} columns = ${cells.length} combinations. ${ready} images ready; ${cells.length - ready} pending.`),
          el('p', 'pt-hint', `${candidate.rowsLabel}: ${rows.slice(0, 4).map(item => item.name).join(' · ')}${rows.length > 4 ? ' …' : ''}`),
          el('p', 'pt-hint', `${candidate.columnsLabel}: ${columns.slice(0, 4).map(item => item.name).join(' · ')}${columns.length > 4 ? ' …' : ''}`));
        if (parsed.kind === 'project') preview.append(el('p', 'pt-hint', 'Saved decisions, favorites, lists and annotations in this project will be preserved.'));
        const paths = [...rows, ...columns].filter(item => item.source && !item.source.startsWith('data:')).length + cells.filter(item => item.src && !item.src.startsWith('data:')).length;
        if (paths) preview.append(el('p', 'pt-hint', `${paths} image references use local paths. Select their image files above to embed them for a portable project.`));
        if (reviewed.unusedImages.length) preview.append(el('p', 'pt-hint', `No dataset reference matched: ${reviewed.unusedImages.join(', ')}.`));
        preview.hidden = false; message('Preview ready. Review the names and dimensions, then load as a new project.');
      } catch (error) { candidate = null; message(`${error.message} Your current project is unchanged.`, true); }
      finally { setBusy(false); }
    }
    async function openSource(text, name) {
      invalidate(); controls.hidden = true; parsed = null; imageInput.value = '';
      try {
        parsed = parseInput(text, name);
        const source = parsed.kind === 'project' ? parsed.project : parsed.data?.meta || {};
        titleInput.value = source.title || name.replace(/\.(json|csv)$/i, '').replace(/[-_]+/g, ' ') || 'Imported dataset';
        rowLabel.value = source.rowsLabel || 'Items'; columnLabel.value = source.columnsLabel || 'Variants';
        tableField.hidden = parsed.kind !== 'records' || parsed.tables.length < 2; mappingPane.hidden = parsed.kind !== 'records';
        controls.hidden = false;
        if (parsed.kind === 'records') {
          tableSelect.replaceChildren(...parsed.tables.map((table, i) => { const option = el('option', '', `${table.name} (${table.records.length} records)`); option.value = String(i); return option; }));
          tableSelect.value = '0'; setTable();
        }
        message(`Opened “${name}” for review.`); await review();
      } catch (error) { message(`${error.message} Your current project is unchanged.`, true); }
    }
    sourceInput.addEventListener('change', async () => {
      if (busy) return; const file = sourceInput.files[0]; if (!file) return;
      invalidate(); parsed = null; controls.hidden = true;
      try {
        if (!/\.(json|csv)$/i.test(file.name)) throw new Error('Choose a .json or .csv file.');
        if (file.size > MAX_BYTES) throw new Error('The dataset exceeds the 300 MiB file limit.');
        setBusy(true); message(`Reading “${file.name}”…`); const text = await file.text(); setBusy(false); await openSource(text, file.name);
      } catch (error) { setBusy(false); message(`${error.message} Your current project is unchanged.`, true); }
    });
    tableSelect.addEventListener('change', () => { try { setTable(); message('Table changed. Review the fields before loading.'); } catch (error) { message(error.message, true); } });
    for (const control of [...Object.values(selectors), titleInput, rowLabel, columnLabel, imageInput]) control.addEventListener('change', () => { invalidate(); message('Fields changed. Review the dataset again before loading.'); });
    for (const control of [titleInput, rowLabel, columnLabel]) control.addEventListener('input', invalidate);
    reviewButton.addEventListener('click', review);
    loadButton.addEventListener('click', async () => {
      if (!candidate || busy) return; const project = candidate; setBusy(true); message('Saving the reviewed dataset as a new project…');
      try { const loaded = await importReviewed(root.ProjectStore, project); message(`Loaded “${loaded.title}” as a new project. Reloading…`); root.location.reload(); }
      catch (error) { message(`${error.message} Your current project is unchanged.`, true); setBusy(false); }
    });
    async function openExample(name) {
      if (busy || !['color-form', 'product-shades'].includes(name)) return;
      invalidate(); parsed = null; controls.hidden = true; setBusy(true); message('Opening example dataset…');
      try { const response = await root.fetch(`examples/${name}.json`, {cache: 'no-cache'}); if (!response.ok) throw new Error('The example dataset could not be opened.');
        const text = await response.text(); setBusy(false); await openSource(text, `${name}.json`); }
      catch (error) { setBusy(false); message(`${error.message} Your current project is unchanged.`, true); }
    }
    colorExample.addEventListener('click', () => openExample('color-form')); productExample.addEventListener('click', () => openExample('product-shades'));
    const example = new URLSearchParams(root.location.search).get('dataset');
    if (['color-form', 'product-shades'].includes(example)) openExample(example);
  }
  return Object.freeze({parseCSV, parseInput, recordFields, suggestMapping, mapRecords, normalizeStructured, embedImages, prepareProject, importReviewed, mount, MAX_BYTES});
});
