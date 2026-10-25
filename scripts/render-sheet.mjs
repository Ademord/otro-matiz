#!/usr/bin/env node
// Checklist sheet: a second view on the card catalog. Records -> one self-contained page where every card has
// a tick box, Copy buttons for chosen fields and a running total of one number field (bills to pay, a packing
// list, a shopping list). Ticks are kept in the viewer's browser only. See AGENTS.md "Checklist sheet".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareProject, createCardCatalog } from './render-gallery.mjs';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const slug = text => String(text || 'sheet').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sheet';

/**
 * "CHF 1'234.50", "1.234,50", 12.85 -> 1234.5 / 1234.5 / 12.85. Empty -> null. Anything else throws, never guesses:
 * more than two decimals ("1.234" could be a thousand) and a currency other than `unit` ("EUR 50" in a CHF total) are refused.
 */
export function parseNumber(value, unit = '') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  const raw = String(value).replace(/[\s'’]/g, '');
  const [, before, number, after] = /^([A-Za-z]*)(.*?)([A-Za-z]*)$/.exec(raw);
  const currency = before || after;
  if ((before && after) || (currency && currency.toUpperCase() !== String(unit).toUpperCase())) {
    throw new Error(`“${value}” is not ${unit ? `a ${unit} amount` : 'a plain number'}.`);
  }
  let text = number;
  if (text.includes('.') && text.includes(',')) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else text = text.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`“${value}” is not a number.`);
  if (/\.\d{3,}$/.test(text)) throw new Error(`“${value}” has more than two decimals (or a thousands separator): write it as 1234.00.`);
  return Number(text);
}

/** What is still open. Runs in the page too (inlined by toString), so the page and the tests share one rule. */
export function summarize(items) {
  let cents = 0, open = 0;
  for (const item of items) if (!item.done) { open++; cents += item.cents || 0; }
  return {cents, open, total: items.length};
}

const TRUE = new Set(['true', 'yes', 'y', '1', 'x']), FALSE = new Set(['false', 'no', 'n', '0', '']);
function parseBool(value, where) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  throw new Error(`${where}: “${value}” is not yes or no.`);
}

const SHEET_CSS = `:root{--bg:#f5f5f2;--fg:#1c1c1a;--card:#fff;--mut:#6b6b66;--line:#d9d9d2;--acc:#0b5fff;--warn:#a15c00}
@media (prefers-color-scheme:dark){:root{--bg:#121413;--fg:#ececE8;--card:#1c1f1d;--mut:#9a9d98;--line:#34383a;--acc:#6ea3ff;--warn:#e0a040}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}h1{font-size:1.2rem;margin:0 0 4px}h2{font-size:1.05rem;margin:0}
.kicker,.meta,.goal{color:var(--mut);font-size:.82rem;margin:0}.goal{margin:4px 0}
.total{position:sticky;top:0;z-index:1;font-weight:600;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin:10px 0 14px}
.group{font-size:1rem;margin:20px 0 8px}
.sheet-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 14px}
.sheet-card.done{opacity:.45}
.top{display:flex;justify-content:space-between;gap:8px}.amount{text-align:right;font-weight:700;font-size:1.15rem;white-space:nowrap}
.variant,.description,.specs{color:var(--mut);font-size:.85rem}.description{margin:6px 0}
.specs{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0}.specs dt{font-weight:600}.specs dd{margin:0}
.image{text-align:center;margin:8px 0}.image img{width:min(100%,300px);height:auto;background:#fff;padding:6px;border-radius:6px;image-rendering:pixelated}
.copy{display:flex;align-items:center;gap:6px;margin:5px 0}.copy .label{width:76px;font-size:.78rem;color:var(--mut);overflow-wrap:anywhere}
.amount.none{color:var(--warn);font-size:.85rem;font-weight:600}
.copy input,.copy textarea{flex:1;min-width:0;resize:none;font:inherit;font-size:.9rem;padding:7px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button,.source{font:inherit;font-size:.9rem;padding:7px 12px;border-radius:6px;border:1px solid var(--acc);background:transparent;color:var(--acc);text-decoration:none;display:inline-block;cursor:pointer}
.source{margin:6px 0}.tick{display:block;margin-top:10px;font-weight:600}.tick input{width:20px;height:20px;vertical-align:middle}
footer{color:var(--mut);font-size:.78rem;margin:20px 0}
@media print{.total{position:static}button{display:none}.sheet-card{break-inside:avoid}}`;

// Inlined into the page; its sha256 goes into the CSP, so no other script can run. Line endings are LF: a browser
// hashes the script after turning CRLF into LF, and summarize.toString() keeps the CRLF of a Windows checkout.
function pageScript(storageKey) {
  return `(function(){
var summarize=${summarize.toString()};
var KEY=${JSON.stringify(storageKey).replace(/</g, '\\u003c')};
function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
function put(k,v){try{localStorage.setItem(k,v)}catch(e){}}
var cards=[].slice.call(document.querySelectorAll('.sheet-card')),box=document.getElementById('sheet-total');
function update(){
  var items=cards.map(function(c){var t=c.querySelector('.tick input');c.classList.toggle('done',t.checked);return {done:t.checked,cents:Number(c.dataset.cents||0)}});
  var s=summarize(items),open=s.open+' of '+s.total+' open';
  box.textContent=box.dataset.sum?box.dataset.label+': '+(box.dataset.unit?box.dataset.unit+' ':'')+(s.cents/100).toFixed(2)+' ('+open+')':open;
}
cards.forEach(function(c){var t=c.querySelector('.tick input'),k=KEY+':'+c.dataset.key,v=get(k);
  if(v==='1'||v==='0')t.checked=v==='1';
  t.addEventListener('change',function(){put(k,t.checked?'1':'0');update()})});
document.querySelectorAll('.copy button').forEach(function(b){b.addEventListener('click',function(){
  var i=b.previousElementSibling;function ok(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1200)}
  function old(){i.select();try{document.execCommand('copy');ok()}catch(e){}}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(i.value).then(ok,old);else old()})});
update();})();`.replace(/\r\n?/g, '\n');
}

/**
 * Render a card catalog (createCardCatalog) as a checklist sheet.
 * Field options name specifications by label, case-insensitive. A label no card has is an error, not a silent no-op.
 * @param {object} catalog
 * @param {object} [options]
 * @param {string[]} [options.copy]  Fields shown with a Copy button, in this order
 * @param {string} [options.sum]     Number field added up over the cards not ticked
 * @param {string} [options.unit]    Shown before the sum and the card amounts, e.g. "CHF"
 * @param {string} [options.sumLabel] Text before the total (default "Still open")
 * @param {string} [options.tick]    Tick box label (default "Done")
 * @param {string} [options.done]    Yes/no field that ticks a card from the start (the viewer can untick it)
 * @param {string} [options.group]   Field whose values become headings, in order of first appearance
 * @param {string} [options.linkLabel] Text of the source link (default "Open source")
 * @param {string} [options.id]      Browser storage key for the ticks (default: from the title)
 * @param {Date} [options.date]
 */
export function renderSheet(catalog, options = {}) {
  if (catalog?.format !== 'otro-matiz-card-catalog-v1') throw new Error('renderSheet needs an otro-matiz-card-catalog-v1 catalog.');
  const {copy = [], sum, unit = '', sumLabel = 'Still open', tick = 'Done', done, group, linkLabel = 'Open source'} = options;
  const id = slug(options.id || catalog.title);
  const lower = value => String(value).toLowerCase();
  const pick = (card, label) => [...card.specifications].reverse().find(entry => lower(entry.label) === lower(label));
  for (const label of [...copy, sum, done, group].filter(Boolean)) {
    if (!catalog.cards.some(card => pick(card, label))) throw new Error(`No card has a field “${label}”.`);
  }
  const used = new Set([...copy, sum, done, group].filter(Boolean).map(lower));
  const multiVariant = new Set(catalog.cards.map(card => card.variant)).size > 1;
  const groups = new Map();
  for (const card of catalog.cards) {
    const where = `Card “${card.title}”`;
    let amount = null;
    if (sum) { try { amount = parseNumber(pick(card, sum)?.value, unit); } catch (error) { throw new Error(`${where}: ${error.message}`); } }
    const isDone = done ? parseBool(pick(card, done)?.value, where) : false;
    const heading = group ? String(pick(card, group)?.value ?? '') : '';
    // A multi-line value (an address) goes in a textarea: an <input> would drop its line breaks when copied.
    const field = entry => /[\r\n]/.test(String(entry.value))
      ? `<textarea readonly rows="${String(entry.value).split(/\r\n|\r|\n/).length}" aria-label="${escapeHtml(entry.label)}">${escapeHtml(entry.value)}</textarea>`
      : `<input readonly value="${escapeHtml(entry.value)}" aria-label="${escapeHtml(entry.label)}">`;
    const copies = copy.map(label => pick(card, label)).filter(entry => entry && entry.value !== null && String(entry.value) !== '')
      .map(entry => `<div class="copy"><span class="label">${escapeHtml(entry.label)}</span>${field(entry)}<button type="button">Copy</button></div>`).join('');
    const rest = card.specifications.filter(entry => !used.has(lower(entry.label)) && entry.value !== null && String(entry.value).trim());
    const specs = rest.length ? `<dl class="specs">${rest.map(entry => `<dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd>`).join('')}</dl>` : '';
    // The stored tick belongs to this exact card content: a regenerated sheet with a changed bill (or next month's bill
    // under the same id) starts from the data again instead of inheriting an old "Paid".
    const key = `${card.id}:${crypto.createHash('sha256').update(JSON.stringify([card.title, card.variant, card.specifications])).digest('hex').slice(0, 12)}`;
    const amountHtml = !sum ? '' : amount === null ? '<div class="amount none">no amount</div>'
      : `<div class="amount">${escapeHtml(unit ? `${unit} ` : '')}${amount.toFixed(2)}</div>`;
    const html = `<section class="sheet-card${isDone ? ' done' : ''}" data-id="${escapeHtml(card.id)}" data-key="${escapeHtml(key)}" data-cents="${amount === null ? 0 : Math.round(amount * 100)}">
<div class="top"><div><h2>${escapeHtml(card.title)}</h2>${multiVariant ? `<div class="variant">${escapeHtml(card.variant)}</div>` : ''}</div>${amountHtml}</div>
${card.descriptions.map(text => `<p class="description">${escapeHtml(text)}</p>`).join('')}${specs}
${card.images.primary ? `<div class="image"><img src="${escapeHtml(card.images.primary)}" alt="${escapeHtml(card.title)}"></div>` : ''}${copies}
${card.sourceUrl ? `<a class="source" href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>` : ''}
<label class="tick"><input type="checkbox"${isDone ? ' checked' : ''}> ${escapeHtml(tick)}</label></section>`;
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push({html, done: isDone, cents: amount === null ? 0 : Math.round(amount * 100)});
  }
  const all = [...groups.values()].flat();
  const first = summarize(all), open = `${first.open} of ${first.total} open`;
  const totalText = sum ? `${sumLabel}: ${unit ? `${unit} ` : ''}${(first.cents / 100).toFixed(2)} (${open})` : open;
  const body = [...groups].map(([heading, cards]) => `${heading ? `<h3 class="group">${escapeHtml(heading)}</h3>` : ''}${cards.map(card => card.html).join('\n')}`).join('\n');
  const script = pageScript(`otro-matiz-sheet:${id}`);
  const hash = crypto.createHash('sha256').update(script).digest('base64');
  const date = options.date instanceof Date ? options.date : new Date();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(catalog.title)}</title><style>${SHEET_CSS}</style></head><body><main>
<header><p class="kicker">Otro Matiz · Checklist</p><h1>${escapeHtml(catalog.title)}</h1>${catalog.goal ? `<p class="goal">${escapeHtml(catalog.goal)}</p>` : ''}<p class="meta">${escapeHtml(date.toLocaleDateString('en', {day: 'numeric', month: 'long', year: 'numeric'}))}</p></header>
<div class="total" id="sheet-total"${sum ? ` data-sum="1" data-label="${escapeHtml(sumLabel)}" data-unit="${escapeHtml(unit)}"` : ''}>${escapeHtml(totalText)}</div>
${body}
<footer>Created locally with Otro Matiz. Ticks are saved in this browser only.</footer>
</main><script>${script}</script></body></html>`;
}

const USAGE = `Usage: node scripts/render-sheet.mjs <dataset.json|dataset.csv> <sheet.html> [options]

Sheet options (fields are named by their label, case-insensitive):
  --copy <field>          Show this field with a Copy button (repeatable, in order)
  --sum <field>           Add up this number field over the cards not ticked
  --unit <text>           Unit before the sum and the amounts, e.g. CHF
  --sum-label <text>      Text before the total (default "Still open")
  --tick <text>           Tick box label (default "Done")
  --done <field>          Yes/no field that ticks a card from the start
  --group <field>         Headings from this field's values
  --link-label <text>     Text of the source link (default "Open source")
  --id <text>             Browser storage key for the ticks (default: from the title)

Dataset options, as in render-gallery.mjs: --images <dir>, --map <role>=<field>, --table <n>, --title <text>

Prints one JSON line on success: {"html", "bytes", "cards", "open"}.`;

function parseArgs(argv) {
  const options = {copy: [], mapping: {}}, positional = [];
  const names = {'--sum': 'sum', '--unit': 'unit', '--sum-label': 'sumLabel', '--tick': 'tick', '--done': 'done', '--group': 'group',
    '--link-label': 'linkLabel', '--id': 'id', '--images': 'imagesDir', '--title': 'title'};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return {help: true};
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value.`);
    if (arg === '--copy') options.copy.push(value);
    else if (arg === '--map') {
      const [role, ...field] = value.split('=');
      if (!field.length) throw new Error('--map expects <role>=<field>.');
      options.mapping[role] = field.join('=');
    } else if (arg === '--table') {
      if (!/^\d+$/.test(value)) throw new Error('--table expects a table number: 0, 1, 2, …');
      options.tableIndex = Number(value);
    } else if (names[arg]) options[names[arg]] = value;
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (positional.length !== 2 || positional.some(value => !value)) throw new Error('Give one non-empty dataset path and one non-empty output HTML path.');
  return {...options, input: positional[0], output: positional[1]};
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(USAGE + '\n'); return; }
  if (!fs.existsSync(args.input) || !fs.statSync(args.input).isFile()) throw new Error(`The dataset “${args.input}” does not exist.`);
  const output = path.resolve(args.output);
  if (fs.existsSync(output)) {
    // File identity, not the path: catches case aliases (data.json / DATA.JSON on Windows), hard and symbolic links.
    const a = fs.statSync(args.input), b = fs.lstatSync(output);
    if (!b.isFile()) throw new Error('The sheet must be a new or regular file, not a folder or a link.');
    if (a.dev === b.dev && a.ino === b.ino) throw new Error('The sheet must not replace the dataset.');
  }
  const project = prepareProject({text: fs.readFileSync(args.input, 'utf8'), filename: args.input,
    imagesDir: args.imagesDir || path.dirname(path.resolve(args.input)), mapping: args.mapping, tableIndex: args.tableIndex, title: args.title});
  const catalog = createCardCatalog(project);
  const html = renderSheet(catalog, args);
  const temp = `${output}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, html, {flag: 'wx'}); fs.renameSync(temp, output); } catch (error) { fs.rmSync(temp, {force: true}); throw error; }
  const opened = /id="sheet-total"[^>]*>([^<]*)</.exec(html)[1];
  process.stdout.write(JSON.stringify({html: args.output, bytes: Buffer.byteLength(html), cards: catalog.cards.length, open: opened}) + '\n');
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
