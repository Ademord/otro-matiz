'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { validateProject } = require('../project-store.js');
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
  const window = {};
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
