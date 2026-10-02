'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { validateProject, validateData } = require('../project-store.js');
const SourceLinks = require('../source-links.js');
const DatasetImporter = require('../dataset-import.js');
const core = path.resolve(__dirname, '..');
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PNG = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;

function project() {
  return validateProject({
    schemaVersion: 2, id: 'materials-demo', title: 'Material & finish', goal: 'Choose a warm finish',
    rowsLabel: 'Materials', columnsLabel: 'Finishes', updatedAt: '2026-10-01T10:00:00.000Z',
    data: {
      rows: [{ id: 'oak', name: 'Oak <natural>', source: 'guides/oak.png' }, { id: 'steel', name: 'Steel' }],
      columns: [{ id: 'matte', name: 'Matte', source: 'guides/matte.png' }, { id: 'gloss', name: 'Gloss' }],
      cells: [
        { id: 'steel-gloss', row: 'steel', column: 'gloss', status: 'ready', src: PNG },
        { id: 'oak-matte', row: 'oak', column: 'matte', status: 'ready', src: PNG, detail: PNG }
      ]
    },
    decisions: { 'oak-matte': { status: 'chosen', note: 'Keep <this> & warmth', privateNote: 'PRIVATE SECRET' } },
    favorites: ['oak-matte'], annotations: { 'oak-matte': [{ id: 'pin-one', x: 0.2, y: 0.3, text: 'Texture' }] },
    lists: [{ id: 'shortlist', name: 'Warm shortlist', cellIds: ['oak-matte'], createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' }],
    brief: { recipientName: 'Designer', nextStep: 'Compare samples' }
  });
}

function loadModule(filename, extras = {}) {
  const window = {SourceLinks};
  const document = { readyState: 'loading', addEventListener() {} };
  const environment = { window, document, ...extras };
  new Function(...Object.keys(environment), fs.readFileSync(path.join(core, filename), 'utf8'))(...Object.values(environment));
  return window;
}

class Reader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload();
    }, error => { this.error = error; this.onerror(); });
  }
}

test('AI handoff preserves exact canonical cell names, axes, references and output mapping', () => {
  const api = loadModule('generation.js').StudioGeneration;
  const input = project();
  const before = JSON.stringify(input);
  const brief = api.makeBriefData(input, ['oak-matte', 'unknown', 'steel-gloss', 'oak-matte'], 'Same angle', { scope: 'selection', format: 'webp', now: '2026-10-01' });
  assert.deepEqual(brief.items.map(item => [item.cellId, item.row.id, item.column.id, item.outputFile]), [
    ['oak-matte', 'oak', 'matte', 'oak-matte.webp'], ['steel-gloss', 'steel', 'gloss', 'steel-gloss.webp']
  ]);
  assert.equal(brief.items[0].caption, 'Oak <natural> · Matte');
  assert.equal(brief.axes.rows.label, 'Materials');
  assert.equal(brief.axes.columns.label, 'Finishes');
  assert.deepEqual(brief.projectReferences, [
    { path: 'guides/oak.png', row: 'Oak <natural>' }, { path: 'guides/matte.png', column: 'Matte' }
  ]);
  const text = api.makeBrief(input, ['oak-matte'], 'Same angle');
  assert.match(text, /Materials reference: Oak <natural>/);
  assert.match(text, /Finishes reference: Matte/);
  assert.match(text, /oak-matte → oak-matte.png/);
  assert.doesNotMatch(text, /PRIVATE SECRET|Haircut|Beard/);
  assert.equal(JSON.stringify(input), before);
});

test('legacy saved galleries work in handoffs after shared store migration', () => {
  const input = project();
  input.schemaVersion = 1;
  input.data.haircuts = input.data.rows;
  input.data.beards = input.data.columns;
  delete input.data.rows;
  delete input.data.columns;
  input.data.cells = input.data.cells.map(({ row, column, ...cell }) => ({ ...cell, haircut: row, beard: column }));
  const migrated = validateProject(input);
  const brief = loadModule('generation.js').StudioGeneration.makeBriefData(migrated, ['oak-matte'], 'Same angle');
  assert.equal(brief.items[0].row.name, 'Oak <natural>');
  assert.equal(brief.items[0].column.name, 'Matte');
  assert.equal(brief.items[0].currentState, 'has-image');
});

test('attachment checks refuse mismatched image types, damaged files and oversized input', async () => {
  const inspect = loadModule('generation.js').StudioGeneration.inspectImage;
  const file = (name, type, bytes = PNG_BYTES) => {
    const blob = new Blob([bytes], { type });
    return { name, type, size: blob.size, slice: (...args) => blob.slice(...args) };
  };
  await assert.rejects(inspect(file('output.jpg', 'image/jpeg')), /labelled JPEG.*contents are PNG/);
  await assert.rejects(inspect(file('output.png', 'image/png', new Uint8Array([1, 2, 3]))), /contents are not a PNG/);
  await assert.rejects(inspect(file('output.svg', 'image/svg+xml')), /only PNG, JPEG or WebP/);
  await assert.rejects(inspect({ ...file('output.png', 'image/png'), size: 12 * 1024 * 1024 + 1 }), /limit is 12 MiB/);
});

test('portable project includes both axis references and detail images without changing decisions or private content', async () => {
  const requests = [];
  const fetch = async src => { requests.push(src); return { ok: true, blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }) }; };
  const api = loadModule('portability.js', { fetch, FileReader: Reader, location: { protocol: 'http:' } }).StudioPortability;
  const input = project();
  input.data.cells.find(cell => cell.id === 'oak-matte').detail = 'guides/detail.png';
  input.data.meta.presentation = {galleryFraming: 'focused', galleryGrouping: 'none', galleryDescriptions: false, metadataFields: ['row.material'], galleryZoom: 2, galleryFocalX: 0.3, galleryFocalY: 0.7};
  const before = JSON.stringify(input);
  const exported = await api.embedProject(input);
  assert.deepEqual(requests.sort(), ['guides/detail.png', 'guides/matte.png', 'guides/oak.png']);
  assert.equal(exported.data.rows[0].source, PNG);
  assert.equal(exported.data.columns[0].source, PNG);
  assert.equal(exported.data.cells.find(cell => cell.id === 'oak-matte').detail, PNG);
  assert.deepEqual(exported.decisions, input.decisions);
  assert.deepEqual(exported.annotations, input.annotations);
  assert.deepEqual(exported.brief, input.brief);
  assert.deepEqual(exported.lists, input.lists);
  assert.deepEqual(exported.data.meta.presentation, input.data.meta.presentation);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(validateProject(exported), exported);
});

test('unavailable axis or detail image refuses the whole portable export', async () => {
  const api = loadModule('portability.js', {
    fetch: async src => ({ ok: src !== 'guides/detail.png', status: 404, blob: async () => new Blob([PNG_BYTES]) }),
    FileReader: Reader, location: { protocol: 'http:' }
  }).StudioPortability;
  const input = project();
  input.data.cells[0].detail = 'guides/detail.png';
  const before = JSON.stringify(input);
  await assert.rejects(api.embedProject(input), /detail.png.*nothing was exported/);
  assert.equal(JSON.stringify(input), before);
});

test('share brief uses canonical labels, escapes public text and keeps private notes out', async () => {
  const api = loadModule('portability.js').StudioPortability;
  const input = project();
  const html = await api.buildBrief(input, ['oak-matte'], { list: input.lists[0], date: new Date('2026-10-01T12:00:00.000Z') });
  assert.match(html, /Oak &lt;natural&gt; · Matte/);
  assert.match(html, /<dt>Materials<\/dt>/);
  assert.match(html, /<dt>Finishes<\/dt>/);
  assert.match(html, /Keep &lt;this&gt; &amp; warmth/);
  assert.match(html, /Warm shortlist/);
  assert.doesNotMatch(html, /PRIVATE SECRET|undefined/);
  await assert.rejects(api.buildBrief(input, ['steel-gloss'], { list: input.lists[0] }), /outside the list/);
});

test('portable HTML briefs include accessible escaped source links with variant overrides and row fallback', async () => {
  const requests = [];
  const api = loadModule('portability.js', {fetch: async src => { requests.push(src); throw new Error('No resources should load'); }}).StudioPortability;
  const input = project();
  input.data.rows[0].sourceUrl = 'https://example.test/products/oak';
  input.data.rows[1].sourceUrl = 'https://example.test/products/steel';
  input.data.cells.find(cell => cell.id === 'oak-matte').sourceUrl = 'https://example.test/products/oak?variant=matte&label="special"';
  const before = JSON.stringify(input);
  const html = await api.buildBrief(input, ['oak-matte', 'steel-gloss'], {date: new Date('2026-10-01T12:00:00.000Z')});
  assert.match(html, /href="https:\/\/example\.test\/products\/oak\?variant=matte&amp;label=%22special%22"/);
  assert.match(html, /href="https:\/\/example\.test\/products\/steel"/);
  assert.doesNotMatch(html, /href="https:\/\/example\.test\/products\/oak"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Open source for Oak &lt;natural&gt; · Matte \(opens in a new tab\)"/);
  assert.equal((html.match(/<span>Open source<\/span>/g) || []).length, 2);
  assert.equal((html.match(/<svg[^>]+aria-hidden="true"/g) || []).length, 2);
  assert.match(html, /\(new tab\)<\/span>/);
  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  assert.doesNotMatch(html, /<script\b|<link\b|<img[^>]+src="https?:|PRIVATE SECRET/);
  assert.deepEqual(requests, []);
  assert.equal(JSON.stringify(input), before);
});

test('portable briefs omit unsafe links and leave no-link output unchanged', async () => {
  const api = loadModule('portability.js').StudioPortability;
  const input = project(), options = {date: new Date('2026-10-01T12:00:00.000Z')};
  const noLinks = await api.buildBrief(input, ['oak-matte'], options);
  assert.doesNotMatch(noLinks, /class="source-link"|\.source-link\{|<svg/);
  input.data.rows[0].sourceUrl = 'https://user:secret@example.test/item';
  input.data.cells.find(cell => cell.id === 'oak-matte').sourceUrl = 'javascript:alert(1)';
  const unsafeLinks = await api.buildBrief(input, ['oak-matte'], options);
  assert.equal(unsafeLinks, noLinks);
  assert.doesNotMatch(unsafeLinks, /javascript:|user:secret/);
  input.data.rows[0].sourceUrl = 'https://example.test/item';
  const fallback = await api.buildBrief(input, ['oak-matte'], options);
  assert.match(fallback, /href="https:\/\/example\.test\/item"/);
  assert.doesNotMatch(fallback, /javascript:|PRIVATE SECRET/);
});

function galleryPayload(html) {
  const match = /<script type="application\/json" id="otro-matiz-gallery-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'one inert public payload is included');
  return {raw: match[1], value: JSON.parse(match[1])};
}

test('single-file galleries embed previews, details and references, preserve public specifications and support pending options', async () => {
  const requests = [];
  const api = loadModule('portability.js', {fetch: async src => { requests.push(src); return {ok: true, blob: async () => new Blob([PNG_BYTES], {type: 'image/png'})}; }, FileReader: Reader}).StudioPortability;
  const input = project();
  input.data.rows[0].sourceUrl = 'https://example.test/products/oak';
  input.data.rows[0].attributes = {material: 'Oak'};
  input.data.columns[0].attributes = {finish: 'Matte'};
  const oak = input.data.cells.find(cell => cell.id === 'oak-matte');
  oak.description = 'A warm option'; oak.detail = 'guides/detail.png';
  oak.attributes = {price: 30, stock: true, rank: 2, size: 'XS', quantity: 1};
  oak.sourceUrl = 'https://example.test/products/oak?variant=matte';
  const before = JSON.stringify(input);
  const html = await api.buildGallery(input, {date: new Date('2026-10-02T10:00:00Z')});
  const payload = galleryPayload(html).value;
  assert.equal((html.match(/<article class="card"/g) || []).length, 4);
  assert.match(html, /Preview pending/);
  assert.match(html, /href="https:\/\/example\.test\/products\/oak\?variant=matte"/);
  assert.match(html, /href="https:\/\/example\.test\/products\/oak"/, 'pending variant inherits the row link');
  assert.match(html, /<details><summary>View details<\/summary>/);
  assert.match(html, /A warm option/);
  assert.match(html, /<dt>material<\/dt><dd>Oak<\/dd>/);
  assert.match(html, /<dt>finish<\/dt><dd>Matte<\/dd>/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /opens in a new tab/);
  // Images are embedded once, in the page itself; the inert payload carries the text and specifications only.
  assert.ok([...payload.data.rows, ...payload.data.columns].every(item => !('source' in item)));
  assert.ok(payload.data.cells.every(cell => !('src' in cell) && !('detail' in cell)));
  assert.equal(payload.data.cells.find(cell => cell.id === 'oak-matte').status, 'ready');
  assert.doesNotMatch(galleryPayload(html).raw, /data:image/, 'no image data is repeated in the payload');
  assert.match(html, /<img class="detail-image" src="data:image\/png;base64,/);
  assert.deepEqual(requests.sort(), ['guides/detail.png', 'guides/matte.png', 'guides/oak.png']);
  assert.doesNotMatch(html, /<img[^>]+src="(?:https?:|guides\/)|<link\b|PRIVATE SECRET|Prepared for Designer/);
  assert.equal(JSON.stringify(input), before);
});

test('gallery metadata honors selected fields or limits the default card summary to four', async () => {
  const api = loadModule('portability.js', {fetch: async () => ({ok: true, blob: async () => new Blob([PNG_BYTES], {type: 'image/png'})}), FileReader: Reader}).StudioPortability;
  const input = project();
  const cell = input.data.cells.find(cell => cell.id === 'oak-matte');
  cell.attributes = {first: 1, second: 2, third: 3, fourth: 4, fifth: 5, empty: null};
  let html = await api.buildGallery(input);
  let card = /data-cell-id="oak-matte">([\s\S]*?)<\/article>/.exec(html)[1];
  assert.match(card.split('<details>')[0], /<dt>fourth<\/dt>/);
  assert.doesNotMatch(card.split('<details>')[0], /<dt>fifth<\/dt>/);
  assert.match(card.split('<details>')[1], /<dt>fifth<\/dt>/);
  input.data.meta.presentation = {metadataFields: ['cell.fifth', 'cell.empty']};
  html = await api.buildGallery(input);
  card = /data-cell-id="oak-matte">([\s\S]*?)<\/article>/.exec(html)[1];
  assert.match(card.split('<details>')[0], /<dt>fifth<\/dt><dd>5<\/dd>/);
  assert.match(card.split('<details>')[0], /<dt>empty<\/dt><dd>Not specified<\/dd>/);
  assert.doesNotMatch(card.split('<details>')[0], /<dt>first<\/dt>/);
  assert.deepEqual(galleryPayload(html).value.data.meta.presentation.metadataFields, ['cell.fifth', 'cell.empty']);
});

test('gallery output escapes HTML and inert JSON, omits private state and safely resolves malformed link overrides', async () => {
  const api = loadModule('portability.js', {fetch: async () => ({ok: true, blob: async () => new Blob([PNG_BYTES], {type: 'image/png'})}), FileReader: Reader}).StudioPortability;
  const input = project();
  input.title = 'Catalog </script><img src=x onerror=alert(1)>';
  input.goal = 'Public goal\u2028line\u2029end';
  input.profile = {email: 'PROFILE SECRET'};
  input.data.rows[0].sourceUrl = 'https://example.test/item?color=red&size=xs';
  const cell = input.data.cells.find(cell => cell.id === 'oak-matte');
  cell.sourceUrl = 'javascript:alert(1)';
  cell.description = '</script><script>alert("x")</script>\u2028\u2029';
  cell.attributes = {public: 'Visible', privateNote: 'ATTRIBUTE SECRET', 'dataset.privateNote': 'NAMESPACED PRIVATE', 'meta.recipientName': 'NAMESPACED RECIPIENT', 'dataset.profile': 'NAMESPACED PROFILE'};
  const html = await api.buildGallery(input);
  const payload = galleryPayload(html);
  assert.match(html, /Catalog &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /href="https:\/\/example\.test\/item\?color=red&amp;size=xs"/);
  assert.doesNotMatch(html, /PRIVATE SECRET|ATTRIBUTE SECRET|NAMESPACED PRIVATE|NAMESPACED RECIPIENT|NAMESPACED PROFILE|PROFILE SECRET|Designer|javascript:/);
  assert.deepEqual(payload.value.data.cells.find(cell => cell.id === 'oak-matte').attributes, {public: 'Visible'});
  // Plain specification names that happen to match workspace fields are ordinary product data and stay.
  input.data.rows[0].attributes = {Profile: 'All-season', Brief: 'Kurz', Width: '205'};
  const plain = galleryPayload(await api.buildGallery(input)).value;
  assert.deepEqual(plain.data.rows[0].attributes, {Profile: 'All-season', Brief: 'Kurz', Width: '205'});
  for (const key of ['decisions', 'favorites', 'annotations', 'brief', 'profile', 'recipient']) assert.equal(payload.value[key], undefined);
  assert.doesNotMatch(payload.raw, /<|\u2028|\u2029/);
  assert.equal(payload.value.data.cells.find(cell => cell.id === 'oak-matte').description, cell.description);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.match(html, /<script type="application\/json"/);
  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
});

test('gallery privacy filtering covers namespaced fields created by the real structured importer', async () => {
  const raw = {privateNote: 'DATASET PRIVATE', profile: 'DATASET PROFILE', meta: {recipientName: 'META RECIPIENT'},
    rows: [{id: 'one', name: 'One', privateNote: 'ROW PRIVATE', material: 'Cotton'}], columns: [{id: 'preview', name: 'Preview'}],
    cells: [{id: 'one-preview', row: 'one', column: 'preview', status: 'ready', src: PNG}]};
  const imported = DatasetImporter.prepareProject(DatasetImporter.parseInput(JSON.stringify(raw)), {}, {validate: validateProject, validateData}).project;
  assert.equal(imported.data.cells[0].attributes['dataset.privateNote'], 'DATASET PRIVATE');
  assert.equal(imported.data.cells[0].attributes['meta.recipientName'], 'META RECIPIENT');
  const html = await loadModule('portability.js').StudioPortability.buildGallery(imported);
  assert.doesNotMatch(html, /DATASET PRIVATE|DATASET PROFILE|META RECIPIENT|ROW PRIVATE/);
  const payload = galleryPayload(html).value;
  assert.deepEqual(payload.data.rows[0].attributes, {material: 'Cotton'});
  assert.equal(payload.data.cells[0].attributes, undefined);
});

test('gallery snapshots include more than six options and enforce dataset and final file bounds', async () => {
  const input = {title: 'Many items', data: {rows: Array.from({length: 20}, (_, i) => ({id: `item-${i}`, name: `Item ${i}`})), columns: [{id: 'preview', name: 'Preview'}],
    cells: Array.from({length: 20}, (_, i) => ({id: `cell-${i}`, row: `item-${i}`, column: 'preview', status: 'ready', src: PNG}))}};
  const api = loadModule('portability.js').StudioPortability;
  const html = await api.buildGallery(input);
  assert.equal((html.match(/<article class="card"/g) || []).length, 20);
  assert.equal(galleryPayload(html).value.data.cells.length, 20);
  const full = structuredClone(input);
  full.data.columns = Array.from({length: 20}, (_, i) => ({id: `variant-${i}`, name: `Variant ${i}`}));
  full.data.cells = full.data.rows.flatMap(row => full.data.columns.map(column => ({id: `${row.id}-${column.id}`, row: row.id, column: column.id, status: 'pending'})));
  assert.equal(galleryPayload(await api.buildGallery(full)).value.data.cells.length, 400);
  const tooManyCells = structuredClone(input); tooManyCells.data.cells = Array(401).fill(input.data.cells[0]);
  await assert.rejects(api.buildGallery(tooManyCells), /at most 400 combinations/);
  const tooManyRows = structuredClone(input); tooManyRows.data.rows = Array.from({length: 41}, (_, i) => ({id: `item-${i}`, name: `Item ${i}`}));
  await assert.rejects(api.buildGallery(tooManyRows), /1 to 40 rows and columns/);
  let sizedFiles = 0;
  class SizeBoundProbe extends Blob { get size() { sizedFiles++; return sizedFiles === 2 ? 300 * 1024 * 1024 + 1 : super.size; } }
  const bounded = loadModule('portability.js', {Blob: SizeBoundProbe}).StudioPortability;
  await assert.rejects(bounded.buildGallery(input), /300 MiB single-file limit/);
  assert.equal(sizedFiles, 2, 'both the public input and final single-file output are bounded');
});

test('gallery embedding failures refuse the whole file and unsafe image references never cause a request', async () => {
  const requests = [];
  const api = loadModule('portability.js', {fetch: async src => { requests.push(src); return {ok: src !== 'guides/matte.png', status: 404, blob: async () => new Blob([PNG_BYTES], {type: 'image/png'})}; }, FileReader: Reader, location: {protocol: 'http:'}}).StudioPortability;
  await assert.rejects(api.buildGallery(project()), /nothing was exported/);
  const spoofedPng = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
  for (const src of ['https://example.test/image.png', 'assets/%2e%2e/image.png', 'assets/%252e%252e/image.png', 'data:image/png;base64,bm90IGFuIGltYWdl', spoofedPng]) {
    requests.length = 0;
    const input = project(); input.data.cells.find(cell => cell.id === 'oak-matte').src = src;
    await assert.rejects(api.buildGallery(input), /safe local|invalid embedded/);
    assert.deepEqual(requests, []);
  }
  const oversized = project(); oversized.data.cells.find(cell => cell.id === 'oak-matte').src = 'data:image/png;base64,' + 'A'.repeat(40 * 1024 * 1024);
  await assert.rejects(api.buildGallery(oversized), /40 MiB limit/);
});

test('gallery rechecks encoded local images against the embedded limit and full PNG signature', async () => {
  const input = project();
  const makeApi = bytes => loadModule('portability.js', {fetch: async src => ({ok: true,
    blob: async () => new Blob([src === 'guides/oak.png' ? bytes : PNG_BYTES], {type: 'image/png'})}), FileReader: Reader}).StudioPortability;
  const oversized = new Uint8Array(30 * 1024 * 1024);
  oversized.set(PNG_BYTES);
  await assert.rejects(makeApi(oversized).buildGallery(input), /Embedded reference image.*40 MiB limit/);
  const truncatedSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  await assert.rejects(makeApi(truncatedSignature).buildGallery(input), /Embedded reference image.*invalid embedded image data/);
});

test('option descriptions survive handoffs and basic briefs without becoming specifications or exposing private notes', async () => {
  const input = project(), cell = input.data.cells.find(cell => cell.id === 'oak-matte');
  cell.description = 'Quiet <textile> & finish\nKeep this placement';
  input.data.rows[0].description = 'Shared details'; input.data.columns[0].description = 'Shared details';
  for (const legacy of [false, true]) {
    const copy = JSON.parse(JSON.stringify(input));
    if (legacy) { copy.data.cells.find(cell => cell.id === 'oak-matte').attributes = {Description: cell.description, price: 12}; delete copy.data.cells.find(cell => cell.id === 'oak-matte').description; }
    const before = JSON.stringify(copy), generation = loadModule('generation.js').StudioGeneration;
    const data = generation.makeBriefData(copy, ['oak-matte'], 'Same angle');
    assert.equal(data.items[0].description, 'Quiet <textile> & finish Keep this placement');
    assert.ok(!Object.keys(data.items[0].attributes || {}).some(key => key.toLowerCase() === 'description'));
    assert.match(generation.makeBrief(copy, ['oak-matte'], 'Same angle'), /Description: Quiet <textile> & finish Keep this placement/);
    const html = await loadModule('portability.js').StudioPortability.buildBrief(copy, ['oak-matte'], {publicNotes: false});
    assert.match(html, /Quiet &lt;textile&gt; &amp; finish\nKeep this placement/);
    assert.equal(html.split('Shared details').length - 1, 1, 'shared axis descriptions are deduplicated');
    assert.doesNotMatch(html, /PRIVATE SECRET|Keep &lt;this&gt;/);
    assert.equal(JSON.stringify(copy), before);
  }
});

test('data checker validates canonical and legacy datasets and checks column/detail assets', async t => {
  const { checkDataset } = await import(pathToFileURL(path.join(core, 'scripts/check-data.mjs')).href);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'otro-matiz-data-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'guides'));
  for (const name of ['oak', 'matte', 'detail']) fs.writeFileSync(path.join(temp, 'guides', `${name}.png`), PNG_BYTES);
  const input = project().data;
  input.cells[0].detail = 'guides/detail.png';
  const canonical = checkDataset(input, temp);
  const legacy = { haircuts: input.rows, beards: input.columns, cells: input.cells.map(({ row, column, ...cell }) => ({ ...cell, haircut: row, beard: column })), meta: input.meta };
  assert.deepEqual(checkDataset(legacy, temp), canonical);
  fs.unlinkSync(path.join(temp, 'guides/matte.png'));
  assert.throws(() => checkDataset(input, temp), /Missing asset: guides\/matte.png/);
  fs.writeFileSync(path.join(temp, 'guides/matte.png'), PNG_BYTES);
  fs.unlinkSync(path.join(temp, 'guides/detail.png'));
  assert.throws(() => checkDataset(input, temp), /Missing asset: guides\/detail.png/);
  const unknown = structuredClone(input);
  unknown.cells[0].row = 'missing';
  assert.throws(() => checkDataset(unknown, temp), /unknown row/);
});
