#!/usr/bin/env node
import catalogChanges from '../catalog-changes.js';
// Headless gallery export: dataset (JSON or CSV) + local images -> one shareable HTML file.
// It runs the same importer, project validator and `buildGallery` as the browser app,
// so a file made here matches Project -> Export & import -> Download gallery HTML.
// See AGENTS.md for the data contract and how to call this from an agent or MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { validateProject, validateData, LIMITS } = require('../project-store.js');
const SourceLinks = require('../source-links.js');
const DatasetImport = require('../dataset-import.js');

const ROLES = ['id', 'row', 'column', 'image', 'description', 'link'];
const store = { validate: validateProject, validateData };

function loadPortability() {
  // portability.js is a browser module. Give it only what buildGallery needs: no DOM mount,
  // no network. Images are embedded before it runs, so its fetch is never reached.
  const window = { SourceLinks };
  const document = { readyState: 'loading', addEventListener() {} };
  const noFetch = () => { throw new Error('The headless gallery export does not fetch images.'); };
  const source = fs.readFileSync(path.join(root, 'portability.js'), 'utf8');
  new Function('window', 'document', 'fetch', 'location', source)(window, document, noFetch, { protocol: 'file:' });
  return window.StudioPortability;
}

function sniffMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function readImage(imagesDir, ref) {
  const base = fs.realpathSync(imagesDir);
  let decoded;
  try { decoded = decodeURIComponent(ref.startsWith('./') ? ref.slice(2) : ref); } catch { throw new Error(`Image path “${ref}” is not valid.`); }
  const target = path.resolve(base, decoded);
  if (!target.startsWith(base + path.sep)) throw new Error(`Image path “${ref}” leaves the images folder.`);
  if (!fs.existsSync(target)) throw new Error(`Missing image “${ref}” in ${imagesDir}, so nothing was exported.`);
  const real = fs.realpathSync(target);
  if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) throw new Error(`Image path “${ref}” is not a file inside the images folder.`);
  const bytes = fs.readFileSync(real);
  const mime = sniffMime(bytes);
  if (!mime) throw new Error(`Image “${ref}” is not a PNG, JPEG or WebP file.`);
  const url = `data:${mime};base64,${bytes.toString('base64')}`;
  if (url.length > LIMITS.imageChars) throw new Error(`Image “${ref}” is larger than the ${LIMITS.imageChars / 1024 / 1024} MiB embedded-image limit.`);
  return url;
}

/**
 * Turn a dataset into a validated project with every image embedded.
 * @param {object} input
 * @param {string} input.text      Dataset text: records (JSON array/table or CSV), a row/column dataset, or a portable project.
 * @param {string} [input.filename] Used to recognise CSV (".csv"). Defaults to JSON.
 * @param {string} [input.imagesDir] Folder that relative image paths resolve against. Required when the dataset references images.
 * @param {object} [input.mapping] Record field roles: {id, row, column, image, description, link}. Unset roles are guessed from field names.
 * @param {number} [input.tableIndex] Which table of a multi-table JSON file to use.
 * @param {string} [input.title] @param {string} [input.rowsLabel] @param {string} [input.columnsLabel]
 * @returns {object} The validated project, ready for `renderGallery` or for import in the app.
 */
export function prepareProject({ text, filename = 'dataset.json', imagesDir, mapping, tableIndex, title, rowsLabel, columnsLabel } = {}) {
  const parsed = DatasetImport.parseInput(text, filename);
  let fullMapping;
  if (parsed.kind === 'records') {
    const table = parsed.tables[tableIndex || 0];
    if (!table) throw new Error(`The dataset has no table ${tableIndex}.`);
    const unknown = Object.keys(mapping || {}).filter(role => !ROLES.includes(role));
    if (unknown.length) throw new Error(`Unknown mapping role “${unknown[0]}”. Use ${ROLES.join(', ')}.`);
    fullMapping = { ...DatasetImport.suggestMapping(DatasetImport.recordFields(table.records)), ...(mapping || {}) };
  }
  // Validates every field, path and link exactly as the browser import does; image paths stay relative here.
  const { project } = DatasetImport.prepareProject(parsed, { tableIndex, mapping: fullMapping, title, rowsLabel, columnsLabel }, store);
  const cache = new Map();
  const embed = ref => {
    if (typeof ref !== 'string' || !ref || ref.startsWith('data:')) return ref;
    if (!imagesDir) throw new Error(`The dataset references image “${ref}”; pass the folder that contains it.`);
    if (!cache.has(ref)) cache.set(ref, readImage(imagesDir, ref));
    return cache.get(ref);
  };
  const data = project.data;
  for (const item of [...data.rows, ...data.columns]) if (item.source) item.source = embed(item.source);
  for (const cell of data.cells) for (const key of ['src', 'detail']) if (cell[key]) cell[key] = embed(cell[key]);
  return validateProject(project);
}

/** Render a validated project as the self-contained gallery HTML string. */
export async function renderGallery(project, { date } = {}) {
  return loadPortability().buildGallery(validateProject(project), date ? { date } : {});
}

/** Public, flat card data for local learning views, directories and connector adapters. */
export function createCardCatalog(project) {
  return loadPortability().createCardCatalog(validateProject(project));
}

const USAGE = `Usage: node scripts/render-gallery.mjs <dataset.json|dataset.csv> <gallery.html> [options]

Options:
  --images <dir>          Folder that image paths resolve against (default: the dataset's folder)
  --map <role>=<field>    Record field for a role: id, row, column, image, description, link (repeatable)
  --table <n>             Table index in a JSON file with several record tables (default 0)
  --title <text>          Project title (default: dataset meta.title or "Imported dataset")
  --rows-label <text>     Name for rows (default "Items")
  --columns-label <text>  Name for columns (default "Variants")
  --project <file.json>   Also write the editable project, importable in the app
  --catalog <file.json>   Also write public card data for another local view or adapter
  --help                  Show this help

Prints one JSON line on success: {"html", "bytes", "options", "ready", "project"}, plus "catalog" when requested.`;

function parseArgs(argv) {
  const options = { mapping: {} }, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value.`);
    if (arg === '--images') options.imagesDir = value;
    else if (arg === '--map') {
      const [role, ...field] = value.split('=');
      if (!ROLES.includes(role) || !field.length) throw new Error(`--map expects <role>=<field> with a role of ${ROLES.join(', ')}.`);
      options.mapping[role] = field.join('=');
    } else if (arg === '--table') {
      if (!/^\d+$/.test(value)) throw new Error('--table expects a table number: 0, 1, 2, …');
      options.tableIndex = Number(value);
    }
    else if (arg === '--title') options.title = value;
    else if (arg === '--rows-label') options.rowsLabel = value;
    else if (arg === '--columns-label') options.columnsLabel = value;
    else if (arg === '--project' || arg === '--catalog') {
      if (!value) throw new Error(`${arg} needs a non-empty file path.`);
      options[arg === '--project' ? 'projectOut' : 'catalogOut'] = value;
    }
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (positional.length !== 2 || positional.some(value => !value)) throw new Error('Give one non-empty dataset path and one non-empty output HTML path.');
  return { ...options, input: positional[0], output: positional[1] };
}

// Resolve the parent as well as the filename: lexical paths can alias the input
// or another output through a symlinked directory. Never replace an output symlink.
function outputPath(target) {
  const absolute = path.resolve(target);
  const resolved = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  let stat;
  try { stat = fs.lstatSync(resolved); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat && !stat.isFile()) throw new Error('Output targets must be regular files, not directories or symbolic links.');
  return resolved;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(USAGE + '\n'); return; }
  const targets = [args.output, args.projectOut, args.catalogOut].filter(Boolean).map(outputPath);
  // File identity also catches hard links and case aliases on case-insensitive volumes.
  const identities = [args.input, ...targets].filter(target => fs.existsSync(target)).map(target => {
    const stat = fs.statSync(target);
    return `${stat.dev}:${stat.ino}`;
  });
  if (new Set(targets).size !== targets.length || targets.includes(fs.realpathSync(args.input)) || new Set(identities).size !== identities.length) {
    throw new Error('Input, gallery, project and catalog files must have distinct paths.');
  }
  const stat = fs.statSync(args.input);
  if (stat.size > DatasetImport.MAX_BYTES) throw new Error('The dataset exceeds the 300 MiB file limit.');
  const project = prepareProject({
    text: fs.readFileSync(args.input, 'utf8'), filename: args.input,
    imagesDir: args.imagesDir || path.dirname(path.resolve(args.input)),
    mapping: args.mapping, tableIndex: args.tableIndex, title: args.title, rowsLabel: args.rowsLabel, columnsLabel: args.columnsLabel
  });
  const html = await renderGallery(project);
  const catalog = args.catalogOut ? JSON.stringify(createCardCatalog(project)) : null;
  // Stage every file before publishing outputs; preflight rejects invalid/aliased destinations.
  const outputs = [[args.output, html], ...(args.projectOut ? [[args.projectOut, JSON.stringify(project)]] : []),
    ...(args.catalogOut ? [[args.catalogOut, catalog]] : [])]
    .map(([, content], index) => ({ target: targets[index], content, temp: `${targets[index]}.${process.pid}.tmp` }));
  try {
    for (const file of outputs) fs.writeFileSync(file.temp, file.content);
    for (const file of outputs) fs.renameSync(file.temp, file.target);
  } catch (error) {
    for (const file of outputs) fs.rmSync(file.temp, { force: true });
    throw error;
  }
  process.stdout.write(JSON.stringify({ html: args.output, bytes: Buffer.byteLength(html), options: project.data.cells.length,
    ready: project.data.meta.ready, project: args.projectOut || null, ...(args.catalogOut ? {catalog: args.catalogOut} : {}) }) + '\n');
}

if (process.argv[1] && process.argv[1] !== '-' && fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

// Data-only comparison of explicit public catalog snapshots. No storage or collection.
export const compareCardCatalogs = catalogChanges.compareCardCatalogs;
