'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const core = path.resolve(__dirname, '..');
const script = path.join(core, 'scripts', 'render-gallery.mjs');
const load = () => import(require('node:url').pathToFileURL(script).href);

function workspace(csv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otro-gallery-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.copyFileSync(path.join(core, 'assets/demo/circle--blue.png'), path.join(dir, 'assets/tee.png'));
  fs.copyFileSync(path.join(core, 'assets/demo/square--amber.png'), path.join(dir, 'assets/shorts.png'));
  fs.writeFileSync(path.join(dir, 'products.csv'), csv);
  return dir;
}
const CSV = 'sku,name,color,image,price,product_url\n' +
  'tee-blue,Crest Tee,Blue,assets/tee.png,25 EUR,https://example.com/tee\n' +
  'shorts-amber,Arrival Shorts,Amber,assets/shorts.png,30 EUR,https://example.com/shorts\n' +
  'hoodie,Rest Day Hoodie,Grey,,55 EUR,https://example.com/hoodie\n';
const payload = html => JSON.parse(/<script type="application\/json" id="otro-matiz-gallery-data">([\s\S]*?)<\/script>/.exec(html)[1]);

test('records and local images become one self-contained gallery with links and pending cards', async () => {
  const { prepareProject, renderGallery } = await load();
  const dir = workspace(CSV);
  const project = prepareProject({ text: CSV, filename: 'products.csv', imagesDir: dir, title: 'Drop' });
  assert.equal(project.title, 'Drop');
  assert.deepEqual(project.data.cells.map(cell => [cell.id, cell.status]), [['tee-blue', 'ready'], ['shorts-amber', 'ready'], ['hoodie', 'pending']]);
  assert.match(project.data.cells[0].src, /^data:image\/png;base64,/);
  const html = await renderGallery(project, { date: new Date('2026-10-02T10:00:00Z') });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /href="https:\/\/example\.com\/hoodie"/);
  assert.equal((html.match(/data:image\/png/g) || []).length, 2);
  const data = payload(html);
  assert.equal(data.format, 'otro-matiz-gallery-v1');
  assert.deepEqual(data.data.cells.map(cell => cell.attributes.price), ['25 EUR', '30 EUR', '55 EUR']);
});

test('the field mapping can group variants into columns', async () => {
  const { prepareProject } = await load();
  const dir = workspace(CSV);
  const project = prepareProject({ text: CSV, filename: 'products.csv', imagesDir: dir, mapping: { column: 'color' } });
  assert.deepEqual(project.data.columns.map(column => column.name), ['Blue', 'Amber', 'Grey']);
  assert.throws(() => prepareProject({ text: CSV, filename: 'products.csv', imagesDir: dir, mapping: { colour: 'color' } }), /Unknown mapping role/);
});

test('remote, missing, escaping and non-image references stop the export', async () => {
  const { prepareProject } = await load();
  const dir = workspace(CSV);
  const attempt = image => prepareProject({ text: CSV.replace('assets/tee.png', image), filename: 'products.csv', imagesDir: dir });
  assert.throws(() => attempt('https://cdn.example.com/tee.png'), /remote URLs/);
  assert.throws(() => attempt('assets/missing.png'), /Missing image/);
  fs.writeFileSync(path.join(dir, 'assets/notes.png'), 'not an image');
  assert.throws(() => attempt('assets/notes.png'), /not a PNG, JPEG or WebP/);
  fs.symlinkSync(path.join(core, 'package.json'), path.join(dir, 'assets/link.png'));
  assert.throws(() => attempt('assets/link.png'), /not a file inside the images folder/);
  assert.throws(() => prepareProject({ text: CSV, filename: 'products.csv' }), /pass the folder/);
});

test('the command writes the gallery and the editable project, and the project renders the same gallery', () => {
  const dir = workspace(CSV);
  const out = JSON.parse(execFileSync(process.execPath, [script, path.join(dir, 'products.csv'), path.join(dir, 'g.html'), '--project', path.join(dir, 'p.json')], { encoding: 'utf8' }));
  assert.deepEqual([out.options, out.ready], [3, 2]);
  const again = spawnSync(process.execPath, [script, path.join(dir, 'p.json'), path.join(dir, 'g2.html')], { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(payload(fs.readFileSync(path.join(dir, 'g2.html'), 'utf8')), payload(fs.readFileSync(path.join(dir, 'g.html'), 'utf8')));
  const failed = spawnSync(process.execPath, [script, path.join(dir, 'products.csv'), path.join(dir, 'g3.html'), '--map', 'nope=x'], { encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /--map expects/);
  assert.equal(fs.existsSync(path.join(dir, 'g3.html')), false);
  const halfway = spawnSync(process.execPath, [script, path.join(dir, 'products.csv'), path.join(dir, 'g4.html'), '--project', path.join(dir, 'missing-dir', 'p.json')], { encoding: 'utf8' });
  assert.equal(halfway.status, 1);
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('g4.html')), [], 'no gallery or temporary file is left when the project write fails');
  const table = spawnSync(process.execPath, [script, path.join(dir, 'products.csv'), path.join(dir, 'g5.html'), '--table', 'abc'], { encoding: 'utf8' });
  assert.equal(table.status, 1); assert.match(table.stderr, /--table expects a table number/);
});

test('card catalogs preserve stable IDs, pending records, source links and display metadata', async () => {
  const { prepareProject, createCardCatalog } = await load();
  const dir = workspace(CSV);
  const project = prepareProject({text: CSV, filename: 'products.csv', imagesDir: dir});
  project.data.rows[0].description = 'A reusable base layer';
  project.data.cells[0].description = 'Blue version';
  project.data.meta.presentation = {metadataFields: ['cell.price']};
  const catalog = createCardCatalog(project);
  assert.equal(catalog.format, 'otro-matiz-card-catalog-v1');
  assert.deepEqual(catalog.summary, {total: 3, ready: 2, pending: 1, withImages: 2});
  assert.deepEqual(catalog.cards.map(card => card.id), ['tee-blue', 'shorts-amber', 'hoodie']);
  assert.equal(catalog.cards[0].title, 'Crest Tee');
  assert.deepEqual(catalog.cards[0].descriptions, ['A reusable base layer', 'Blue version']);
  assert.match(catalog.cards[0].images.primary, /^data:image\/png;base64,/);
  assert.deepEqual(catalog.cards[0].displaySpecifications.map(spec => spec.value), ['25 EUR']);
  assert.equal(catalog.cards[2].images.primary, null);
  assert.equal(catalog.cards[2].sourceUrl, 'https://example.com/hoodie');
});

test('card catalogs use the gallery privacy boundary without mutating the editable project', async () => {
  const { prepareProject, createCardCatalog } = await load();
  const dir = workspace(CSV);
  const project = prepareProject({text: CSV, filename: 'products.csv', imagesDir: dir});
  project.decisions = {'tee-blue': {status: 'unreviewed', note: 'evaluation-only-marker', privateNote: 'secret-note-marker'}};
  project.favorites = ['tee-blue'];
  project.brief.recipientName = 'secret-recipient-marker';
  Object.assign(project.data.cells[0].attributes, {'Private notes':'secret-attribute-marker', 'meta.recipient':'secret-meta-marker', Profile:'Public specification'});
  const before = JSON.stringify(project);
  const catalog = createCardCatalog(project);
  const raw = JSON.stringify(catalog);
  assert.doesNotMatch(raw, /secret-|evaluation-only-marker/);
  assert.equal('favorites' in catalog, false);
  assert.equal('decisions' in catalog, false);
  assert.equal('annotations' in catalog, false);
  assert.ok(catalog.cards[0].specifications.some(spec => spec.label === 'Profile' && spec.value === 'Public specification'));
  assert.equal(JSON.stringify(project), before);
});

test('the catalog CLI output is usable and refuses overlapping or unwritable output paths', () => {
  const dir = workspace(CSV), input = path.join(dir, 'products.csv');
  const html = path.join(dir, 'gallery.html'), project = path.join(dir, 'project.json'), catalog = path.join(dir, 'cards.json');
  const out = JSON.parse(execFileSync(process.execPath, [script, input, html, '--project', project, '--catalog', catalog], {encoding:'utf8'}));
  assert.equal(out.catalog, catalog);
  assert.equal(JSON.parse(fs.readFileSync(catalog,'utf8')).cards.length, 3);
  const original = fs.readFileSync(input,'utf8');
  const overlap = spawnSync(process.execPath, [script, input, path.join(dir,'bad.html'), '--catalog', input], {encoding:'utf8'});
  assert.equal(overlap.status, 1);
  assert.match(overlap.stderr, /distinct paths/);
  assert.equal(fs.readFileSync(input,'utf8'), original);
  assert.equal(fs.existsSync(path.join(dir,'bad.html')), false);
  const missing = spawnSync(process.execPath, [script, input, path.join(dir,'missing.html'), '--project', path.join(dir,'missing.project.json'), '--catalog', path.join(dir,'absent/cards.json')], {encoding:'utf8'});
  assert.equal(missing.status, 1);
  assert.equal(fs.existsSync(path.join(dir,'missing.html')), false);
  assert.equal(fs.existsSync(path.join(dir,'missing.project.json')), false);
});


test('catalog destinations cannot alias the input or another output through a symlinked folder', () => {
  const dir = workspace(CSV), input = path.join(dir, 'products.csv');
  const alias = path.join(dir, 'alias');
  fs.symlinkSync(dir, alias, 'dir');
  const html = path.join(dir, 'gallery.html'), original = fs.readFileSync(input, 'utf8');
  const inputAlias = spawnSync(process.execPath, [script, input, html, '--catalog', path.join(alias, 'products.csv')], {encoding: 'utf8'});
  assert.equal(inputAlias.status, 1);
  assert.match(inputAlias.stderr, /distinct paths/);
  assert.equal(fs.readFileSync(input, 'utf8'), original);
  assert.equal(fs.existsSync(html), false);
  const outputAlias = spawnSync(process.execPath, [script, input, html, '--catalog', path.join(alias, 'gallery.html')], {encoding: 'utf8'});
  assert.equal(outputAlias.status, 1);
  assert.match(outputAlias.stderr, /distinct paths/);
  assert.equal(fs.existsSync(html), false);
});

test('non-file catalog destinations fail before replacing any existing exports', () => {
  for (const type of ['directory', 'symlink']) {
    const dir = workspace(CSV), input = path.join(dir, 'products.csv');
    const html = path.join(dir, 'gallery.html'), project = path.join(dir, 'project.json'), catalog = path.join(dir, 'catalog');
    fs.writeFileSync(html, 'existing gallery');
    fs.writeFileSync(project, 'existing project');
    if (type === 'directory') fs.mkdirSync(catalog);
    else fs.symlinkSync(input, catalog);
    const result = spawnSync(process.execPath, [script, input, html, '--project', project, '--catalog', catalog], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /regular files/);
    assert.equal(fs.readFileSync(html, 'utf8'), 'existing gallery');
    assert.equal(fs.readFileSync(project, 'utf8'), 'existing project');
    assert.equal(fs.readFileSync(input, 'utf8'), CSV);
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
  }
});


test('catalog output refuses an existing file alias of the dataset', () => {
  const dir = workspace(CSV), input = path.join(dir, 'products.csv');
  const alias = path.join(dir, 'input-alias.json'), html = path.join(dir, 'gallery.html');
  fs.linkSync(input, alias);
  const aliases = [alias];
  const caseAlias = path.join(dir, 'PRODUCTS.CSV');
  if (fs.existsSync(caseAlias)) aliases.push(caseAlias);
  for (const target of aliases) {
    const result = spawnSync(process.execPath, [script, input, html, '--catalog', target], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /distinct paths/);
    assert.equal(fs.readFileSync(input, 'utf8'), CSV);
    assert.equal(fs.existsSync(html), false);
  }
});


test('empty output paths are rejected before existing exports are changed', () => {
  const dir = workspace(CSV), input = path.join(dir, 'products.csv');
  const html = path.join(dir, 'gallery.html'), project = path.join(dir, 'project.json');
  fs.writeFileSync(html, 'existing gallery');
  fs.writeFileSync(project, 'existing project');
  for (const args of [[input, '', '--project', project], [input, html, '--project', ''], [input, html, '--catalog', '']]) {
    const result = spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /non-empty/);
    assert.equal(fs.readFileSync(html, 'utf8'), 'existing gallery');
    assert.equal(fs.readFileSync(project, 'utf8'), 'existing project');
    assert.equal(fs.readFileSync(input, 'utf8'), CSV);
  }
});
