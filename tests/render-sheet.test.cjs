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
  assert.match(html, /data-id="gym-2026-10" data-key="[^"]+" data-cents="5900">[\s\S]*?<input type="checkbox" checked> Paid/);
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
  await assert.rejects(sheet(bad), /Card “Phone plan, October”: “about forty” is not a CHF amount/);
});

test('Swiss and European amounts parse to the same number; the page adds cents, so 0.10 + 0.20 is 0.30', async () => {
  const { parseNumber, summarize } = await load();
  assert.equal(parseNumber("CHF 1'234.50", 'CHF'), 1234.5);
  assert.equal(parseNumber('1.234,50'), 1234.5);
  assert.equal(parseNumber('12,85'), 12.85);
  assert.equal(parseNumber(''), null);
  assert.throws(() => parseNumber('12.85.1'), /not a number/);
  // Never guess: a thousands separator read as a decimal point would show CHF 1.23 for a 1234.00 bill.
  assert.throws(() => parseNumber('1.234'), /more than two decimals/);
  assert.throws(() => parseNumber('1,234'), /more than two decimals/);
  assert.throws(() => parseNumber('84.305'), /more than two decimals/);
  // Another currency, or a word, must not be added into a CHF total.
  assert.throws(() => parseNumber('EUR 50', 'CHF'), /not a CHF amount/);
  assert.throws(() => parseNumber('ca 40', 'CHF'), /not a CHF amount/);
  assert.throws(() => parseNumber('CHF 40'), /not a plain number/);
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
  assert.ok(scripts[0].includes(summarize.toString().replace(/\r\n?/g, '\n')));
});

test('a CRLF checkout (Windows) still gives a hash the browser accepts: the browser hashes the script with LF line endings', async () => {
  // Simulate the checkout: the same module with CRLF line endings, next to render-gallery.mjs so its import resolves.
  const crlf = path.join(core, 'scripts', `.render-sheet-crlf-${process.pid}.mjs`);
  fs.writeFileSync(crlf, fs.readFileSync(script, 'utf8').replace(/\r?\n/g, '\r\n'));
  try {
    const { renderSheet } = await import(pathToFileURL(crlf).href);
    const { prepareProject, createCardCatalog } = await gallery();
    const html = renderSheet(createCardCatalog(prepareProject({text: JSON.stringify(records()), filename: 'r.json', title: 'Bills'})), BILLS);
    const body = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!body.includes('\r'), 'the script text must be LF only');
    const hash = crypto.createHash('sha256').update(body).digest('base64');
    assert.ok(html.includes(`'sha256-${hash}'`));
  } finally { fs.rmSync(crlf, {force: true}); }
});

test('a missing amount is marked on the card and adds nothing; a multi-line value keeps its line breaks when copied', async () => {
  const data = records();
  data[1].amount = '';
  data[0].payee = 'Example Utilities AG\nBahnhofstrasse 1\n8000 Zürich';
  const html = await sheet(data);
  assert.match(/data-id="phone-2026-10"[\s\S]*?<\/section>/.exec(html)[0], /<div class="amount none">no amount<\/div>/);
  assert.equal(total(html), 'Still to pay: CHF 204.30 (3 of 4 open)');
  assert.match(html, /<textarea readonly rows="3" aria-label="payee">Example Utilities AG\nBahnhofstrasse 1\n8000 Zürich<\/textarea><button/);
});

test('a stored tick belongs to the card content: next month\'s bill under the same id does not inherit "Paid"', async () => {
  const keys = html => Object.fromEntries([...html.matchAll(/data-id="([^"]+)" data-key="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const before = keys(await sheet(records()));
  const changed = records();
  changed[0].amount = '91.10';
  const after = keys(await sheet(changed));
  assert.notEqual(after['water-2026-10'], before['water-2026-10']);
  assert.equal(after['phone-2026-10'], before['phone-2026-10']);
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

test('the sheet never replaces the dataset, also through another name for the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otro-sheet-'));
  const input = path.join(dir, 'data.json'), alias = path.join(dir, 'alias.json');
  fs.copyFileSync(sample, input);
  fs.linkSync(input, alias);                        // a hard link; a case alias (DATA.JSON on Windows) is the same file the same way
  const run = out => spawnSync(process.execPath, [script, input, out, '--sum', 'amount'], {encoding: 'utf8'});
  for (const out of [input, alias, input.toUpperCase()]) {
    if (out === input.toUpperCase() && !fs.existsSync(out)) continue;   // case-sensitive file system: a different file
    const res = run(out);
    assert.equal(res.status, 1, out);
    assert.equal(res.stderr.trim(), 'The sheet must not replace the dataset.');
  }
  assert.equal(fs.readFileSync(input, 'utf8'), fs.readFileSync(sample, 'utf8'));
  const missing = spawnSync(process.execPath, [script, path.join(dir, 'nope.json'), path.join(dir, 'x.html')], {encoding: 'utf8'});
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does not exist/);
});
