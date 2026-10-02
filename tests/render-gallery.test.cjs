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
});
