'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const build = import(pathToFileURL(path.join(root, 'scripts/build-site.mjs')).href);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matiz-static-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  for (const file of [...manifest.files, 'runtime-manifest.json']) {
    const destination = path.join(dir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  return dir;
}

test('static output contains only declared runtime files and excludes old output and unlisted data', async t => {
  const dir = fixture(t), { buildSite } = await build;
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist/obsolete.html'), 'Old build');
  fs.mkdirSync(path.join(dir, 'exports'));
  fs.writeFileSync(path.join(dir, 'exports/private-project.json'), 'Not a source asset');
  fs.writeFileSync(path.join(dir, 'README.md'), 'Development documentation');
  fs.writeFileSync(path.join(dir, 'assets/demo/unlisted.png'), 'Not approved');
  const result = buildSite(dir);
  assert.equal(result.files, 42);
  assert.equal(result.images, 9);
  assert(fs.existsSync(path.join(dir, 'dist/index.html')));
  for (const example of ['color-form', 'product-shades']) assert(fs.existsSync(path.join(dir, 'dist/examples', `${example}.json`)), 'Dataset importer examples must be deployed');
  for (const file of ['obsolete.html', 'exports/private-project.json', 'README.md', 'assets/demo/unlisted.png', 'runtime-manifest.json']) {
    assert(!fs.existsSync(path.join(dir, 'dist', file)), `Excluded: ${file}`);
  }
});

test('missing or undeclared references fail before replacing a previous output', async t => {
  const dir = fixture(t), { buildSite } = await build;
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist/previous.html'), 'Keep until valid');
  fs.appendFileSync(path.join(dir, 'index.html'), '<script src="unlisted.js"></script>');
  assert.throws(() => buildSite(dir), /outside the allowlist/);
  assert(fs.existsSync(path.join(dir, 'dist/previous.html')));
});

test('symlinked runtime assets and output directories cannot be copied or removed', async t => {
  const dir = fixture(t), { buildSite } = await build;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'matiz-static-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'image.png'), 'Outside runtime');
  const image = path.join(dir, 'assets/demo/circle--blue.png');
  fs.rmSync(image);
  fs.symlinkSync(path.join(outside, 'image.png'), image);
  assert.throws(() => buildSite(dir), /Symlinked runtime path/);
  fs.rmSync(image);
  fs.copyFileSync(path.join(root, 'assets/demo/circle--blue.png'), image);
  fs.symlinkSync(outside, path.join(dir, 'dist'), 'dir');
  assert.throws(() => buildSite(dir), /Output directory cannot be a symlink/);
  assert(fs.existsSync(path.join(outside, 'image.png')));
});

test('publication refuses a changed bundled project rather than exporting personal data', async t => {
  const dir = fixture(t), { buildSite } = await build;
  const dataPath = path.join(dir, 'data.js');
  fs.writeFileSync(dataPath, fs.readFileSync(dataPath, 'utf8').replace('color-form-demo', 'personal-project'));
  assert.throws(() => buildSite(dir), /Only the neutral bundled dataset/);
});
