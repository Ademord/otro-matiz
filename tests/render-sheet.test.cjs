'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const core = path.resolve(__dirname, '..');
const script = path.join(core, 'scripts', 'render-sheet.mjs');
const sample = path.join(core, 'examples', 'checklist-bills.json');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(script).href);
const gallery = () => import(pathToFileURL(path.join(core, 'scripts', 'render-gallery.mjs')).href);
const BILLS = {copy: ['IBAN', 'reference', 'amount', 'payee'], sum: 'amount', unit: 'CHF', sumLabel: 'Still to pay', tick: 'Paid',
  done: 'paid', group: 'status', linkLabel: 'Open invoice', date: new Date('2026-10-25T10:00:00Z')};

async function sheet(records, options = BILLS) {
  const [{ renderSheet }, { prepareProject, createCardCatalog }] = await Promise.all([load(), gallery()]);
  const project = prepareProject({text: JSON.stringify(records), filename: 'records.json', title: 'Bills'});
  return renderSheet(createCardCatalog(project), options);
}
const records = () => JSON.parse(fs.readFileSync(sample, 'utf8'));
const total = html => /id="sheet-total"[^>]*>([^<]*)</.exec(html)[1];

test('the opening total counts only what is still open, so a paid bill never inflates what is left to pay', async () => {
  const html = await sheet(records());
  // 84.30 + 39.00 + 120.00; the gym bill is marked paid in the data.
  assert.equal(total(html), 'Still to pay: CHF 243.30 (3 of 4 open)');
  assert.match(html, /data-id="gym-2026-10" data-cents="5900">[\s\S]*?<input type="checkbox" checked> Paid/);
  assert.match(html, /class="sheet-card done" data-id="gym-2026-10"/);
});

test('copy fields carry the exact value from the data, because a changed IBAN or reference sends money elsewhere', async () => {
  const html = await sheet(records());
  assert.match(html, /<span class="label">IBAN<\/span><input readonly value="CH93 0076 2011 6238 5295 7"/);
  assert.match(html, /<span class="label">reference<\/span><input readonly value="21 00000 00003 13947 14300 09017"/);
  // A card without that field gets no empty Copy row.
  const dentist = /data-id="dentist-2026-10"[\s\S]*?<\/section>/.exec(html)[0];
  assert.doesNotMatch(dentist, /label">IBAN/);
});

test('headings follow the group field in order of first appearance, and fields shown elsewhere are not repeated', async () => {
  const html = await sheet(records());
  const headings = [...html.matchAll(/<h3 class="group">([^<]*)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(headings, ['To pay', 'To check', 'Paid']);
  const water = /data-id="water-2026-10"[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(water, /<dt>due<\/dt><dd>15 Nov 2026<\/dd>/);
  assert.doesNotMatch(water, /<dt>(IBAN|status|paid|amount)<\/dt>/);
  assert.match(water, /href="https:\/\/example\.com\/invoices\/water-2026-10"[^>]*>Open invoice</);
});

test('a field name that no card has stops the export: a typo must not silently drop the Copy buttons or the total', async () => {
  await assert.rejects(sheet(records(), {...BILLS, copy: ['IBNA']}), /No card has a field “IBNA”/);
  await assert.rejects(sheet(records(), {...BILLS, sum: 'amonut'}), /No card has a field “amonut”/);
});

test('a sum value that is not a number stops the export instead of counting as zero', async () => {
  const bad = records();
  bad[1].amount = 'about forty';
  await assert.rejects(sheet(bad), /Card “Phone plan, October”: “about forty” is not a number/);
});

test('Swiss and European amounts parse to the same number; the page adds cents, so 0.10 + 0.20 is 0.30', async () => {
  const { parseNumber, summarize } = await load();
  assert.equal(parseNumber("CHF 1'234.50"), 1234.5);
  assert.equal(parseNumber('1.234,50'), 1234.5);
  assert.equal(parseNumber('12,85'), 12.85);
  assert.equal(parseNumber(''), null);
  assert.throws(() => parseNumber('12.85.1'), /not a number/);
  assert.deepEqual(summarize([{cents: 10, done: false}, {cents: 20, done: false}, {cents: 999, done: true}]), {cents: 30, open: 2, total: 3});
});

test('the only script is the sheet script, allowed by its hash; the page uses the same summarize as the tests', async () => {
  const { summarize } = await load();
  const html = await sheet(records());
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  const hash = crypto.createHash('sha256').update(scripts[0]).digest('base64');
  assert.match(html, new RegExp(`script-src 'sha256-${hash.replace(/[+/]/g, ch => `\\${ch}`)}'`));
  assert.match(html, /default-src 'none'; img-src data:/);
  assert.ok(scripts[0].includes(summarize.toString()));
});

test('record text is shown as text, never as markup', async () => {
  const evil = records();
  evil[0].payee = '<img src=x onerror=alert(1)>';
  evil[0].name = 'Water </script><script>alert(1)</script>';
  const html = await sheet(evil);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal([...html.matchAll(/<script>/g)].length, 1);
  assert.match(html, /value="&lt;img src=x onerror=alert\(1\)&gt;"/);
});

test('the command writes the sheet and reports the opening total; a bad field exits 1 with one plain reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otro-sheet-'));
  const out = path.join(dir, 'bills.html');
  const args = [script, sample, out, '--title', 'Bills', '--copy', 'IBAN', '--sum', 'amount', '--unit', 'CHF', '--done', 'paid', '--group', 'status'];
  const ok = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert.equal(ok.status, 0, ok.stderr);
  const line = JSON.parse(ok.stdout);
  assert.equal(line.cards, 4);
  assert.equal(line.open, 'Still open: CHF 243.30 (3 of 4 open)');
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!doctype html>'));
  const bad = spawnSync(process.execPath, [...args, '--copy', 'nope'], {encoding: 'utf8'});
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr.trim(), 'No card has a field “nope”.');
  assert.deepEqual(fs.readdirSync(dir), ['bills.html']);
});
