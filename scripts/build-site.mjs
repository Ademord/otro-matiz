import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkDataset } from './check-data.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localMachinePath = /\/(?:Users|var\/folders|private\/var\/folders)\//;

function declaredPath(value) {
  assert.equal(typeof value, 'string', 'Runtime path must be a string');
  assert.match(value, /^(?:[a-z0-9-]+\.(?:html|js|css)|assets\/demo\/[a-z0-9-]+\.png|examples\/[a-z0-9-]+\.json)$/, `Invalid runtime path: ${value}`);
  return value;
}

function assertRegularPath(root, relative) {
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    assert(!stat.isSymbolicLink(), `Symlinked runtime path: ${relative}`);
  }
  assert(fs.statSync(cursor).isFile(), `Runtime asset must be a regular file: ${relative}`);
  return cursor;
}

export function buildSite(sourceRoot = defaultRoot) {
  const root = fs.realpathSync(sourceRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1, 'Unsupported runtime manifest');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Runtime manifest must contain files');
  const files = manifest.files.map(declaredPath);
  const allowed = new Set(files);
  assert.equal(allowed.size, files.length, 'Duplicate runtime paths');
  assert(allowed.has('index.html') && allowed.has('bootstrap.js') && allowed.has('data.js'), 'Missing app entrypoints');

  const text = new Map();
  for (const file of files) {
    const full = assertRegularPath(root, file);
    if (/\.(?:html|js|css)$/.test(file)) {
      const content = fs.readFileSync(full, 'utf8');
      assert(!localMachinePath.test(content), `Local machine path in runtime asset: ${file}`);
      text.set(file, content);
    }
  }

  function checkReference(raw, from) {
    if (raw.startsWith('#')) return;
    assert(!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(raw), `External or absolute runtime reference in ${from}: ${raw}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(raw.split(/[?#]/)[0])));
    assert(allowed.has(resolved), `Runtime reference is outside the allowlist in ${from}: ${raw}`);
  }
  for (const match of text.get('index.html').matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) checkReference(match[1], 'index.html');
  // Bootstrap's companion modules are loaded dynamically, rather than in HTML.
  for (const match of text.get('bootstrap.js').matchAll(/["']([a-z0-9-]+\.js)["']/g)) checkReference(match[1], 'bootstrap.js');
  for (const [file, content] of text) if (file.endsWith('.css')) {
    for (const match of content.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) checkReference(match[1], file);
  }

  for (const example of ['color-form', 'product-shades']) {
    const file = `examples/${example}.json`;
    assert(allowed.has(file), `Missing importer example: ${file}`);
    checkDataset(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), root);
  }

  const prefix = 'window.MATRIX_DATA = ';
  assert(text.get('data.js').startsWith(prefix), 'Expected a neutral JSON dataset assignment');
  const data = checkDataset(JSON.parse(text.get('data.js').slice(prefix.length).trim().replace(/;$/, '')), root);
  assert.equal(data.meta.id, 'color-form-demo', 'Only the neutral bundled dataset can be published');
  assert.equal(data.meta.title, 'Color and form', 'Unexpected bundled dataset title');
  assert.deepEqual(data.rows.map(row => row.id), ['circle', 'square', 'triangle'], 'Unexpected bundled forms');
  assert.deepEqual(data.columns.map(column => column.id), ['blue', 'green', 'amber'], 'Unexpected bundled colors');
  assert.equal(data.cells.length, 9, 'Expected exactly nine demo previews');
  for (const cell of data.cells) {
    assert.equal(cell.src, `assets/demo/${cell.row}--${cell.column}.png`, 'Unexpected demo image');
    assert(allowed.has(cell.src), `Dataset image is outside the allowlist: ${cell.src}`);
  }

  // Output is deliberately fixed to root/dist; callers cannot remove arbitrary directories.
  const out = path.join(root, 'dist');
  if (fs.existsSync(out)) assert(!fs.lstatSync(out).isSymbolicLink(), 'Output directory cannot be a symlink');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  for (const file of files) {
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return { files: files.length + 1, images: data.cells.length, directory: out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildSite();
  console.log(JSON.stringify({ status: 'PASS', files: result.files, images: result.images, directory: 'dist/' }));
}
