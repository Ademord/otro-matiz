'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = path.resolve(__dirname, '..');
const load = () => import(require('node:url').pathToFileURL(path.join(core, 'scripts', 'render-gallery.mjs')).href);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the product-research recipe example renders as a gallery of pending cards with source links', async () => {
  const { prepareProject, renderGallery } = await load();
  const dir = path.join(core, 'docs', 'agent-recipes', 'product-research');
  const text = fs.readFileSync(path.join(dir, 'records.json'), 'utf8');
  const records = JSON.parse(text);
  assert(records.length > 0);
  for (const record of records) {
    assert.equal(record.image, '', 'Recipe examples carry no photos; images stay in the private work folder');
    assert.match(record.product_url, /^https:\/\//);
  }
  const project = prepareProject({ text, filename: 'records.json', imagesDir: dir, title: 'Recipe example' });
  assert.equal(project.data.cells.length, records.length);
  assert(project.data.cells.every(cell => cell.status === 'pending'));
  const html = await renderGallery(project, { date: new Date('2026-10-15T12:00:00Z') });
  for (const record of records) assert.match(html, new RegExp(`href="${escape(record.product_url)}"`));
  assert.match(html, /Recipe example/);
});
