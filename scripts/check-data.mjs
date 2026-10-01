import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { validateData } = require('../project-store.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The same boundary used by imports checks IDs, axes, positions, statuses and URLs.
// It accepts the original gallery dataset and always returns canonical rows/columns.
export function checkDataset(data, assetRoot = root) {
  const canonical = validateData(data);
  assert(Array.isArray(canonical.rows) && Array.isArray(canonical.columns), 'Expected canonical axes');
  assert(!Object.hasOwn(canonical, 'haircuts') && !Object.hasOwn(canonical, 'beards'), 'Legacy axes must be migrated');

  function checkAsset(relative) {
    // Embedded images have already passed the shared validator.
    if (relative.startsWith('data:')) return;
    const resolvedRoot = fs.realpathSync(assetRoot);
    const target = path.resolve(resolvedRoot, decodeURIComponent(relative));
    assert(target.startsWith(resolvedRoot + path.sep), `Asset escapes this project: ${relative}`);
    assert(fs.existsSync(target), `Missing asset: ${relative}`);
    assert(fs.realpathSync(target).startsWith(resolvedRoot + path.sep), `Asset escapes this project: ${relative}`);
    assert(fs.statSync(target).isFile(), `Asset is not a file: ${relative}`);
  }
  for (const item of [...canonical.rows, ...canonical.columns]) if (item.source) checkAsset(item.source);
  for (const cell of canonical.cells) for (const key of ['src', 'detail']) if (cell[key]) checkAsset(cell[key]);

  // Canonical exports and legacy saved galleries must normalize to the same data.
  const legacy = {
    haircuts: canonical.rows,
    beards: canonical.columns,
    cells: canonical.cells.map(({ row, column, ...cell }) => ({ ...cell, haircut: row, beard: column })),
    meta: canonical.meta
  };
  const context = { id: canonical.meta.id, updatedAt: canonical.meta.updatedAt };
  assert.deepEqual(validateData(legacy, context), validateData(canonical, context), 'Legacy and canonical data must agree');
  return canonical;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
  const prefix = 'window.MATRIX_DATA = ';
  assert(input.startsWith(prefix), 'Expected the documented JSON assignment');
  const data = checkDataset(JSON.parse(input.slice(prefix.length).trim().replace(/;$/, '')));
  console.log(JSON.stringify({ status: 'PASS', rows: data.rows.length, columns: data.columns.length, ready: data.cells.filter(cell => cell.status === 'ready').length }));
}
