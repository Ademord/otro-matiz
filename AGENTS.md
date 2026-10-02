# Otro Matiz for agents

This file is for coding agents, scripts and MCP servers that want to **fill Otro Matiz with data and produce a shareable gallery** without clicking through the app. Read it before writing an integration. Human-facing docs are in `README.md`.

## What you can do without a browser

| Goal | Use |
|---|---|
| Records + photos → one HTML file to send to friends | `node scripts/render-gallery.mjs` (or `npm run gallery --`) |
| Records + photos → editable project the user opens in the app | same command with `--project out.json`, then **Project → Export & import → Import a project** in the app |
| Call it from your own Node code | `import { prepareProject, renderGallery } from './scripts/render-gallery.mjs'` |

The command runs the app's own importer (`dataset-import.js`), validator (`project-store.js`) and gallery exporter (`portability.js` → `buildGallery`). A file made here is the same as **Download gallery HTML** in the app. Don't copy those modules into another repo: call this script from a checkout pinned to a commit or tag.

There is no server, API or URL parameter for pushing data into a running browser app. Projects live in that browser's IndexedDB. To get data into the app, hand the user a project JSON to import.

## Quick start

```sh
# products.csv and assets/ are in the same folder
node scripts/render-gallery.mjs products.csv gallery.html --title "Autumn drop" --project project.json
# {"html":"gallery.html","bytes":10321,"options":3,"ready":2,"project":"project.json"}
```

`products.csv`:

```csv
sku,name,color,image,price,product_url
tee-blue,Crest Tee,Blue,assets/tee.png,25 EUR,https://example.com/products/tee
hoodie,Rest Day Hoodie,Grey,,55 EUR,https://example.com/products/hoodie
```

On success the command exits 0 and prints one JSON line. On failure it exits 1, writes one plain-language reason to stderr and writes no files. `--help` lists every option.

## The data contract

**Input formats** (detected automatically):
- **Records**: a CSV file, a JSON array of flat objects, or a JSON object holding such arrays (`records`, `items`, `products`, …; choose one with `--table <n>`). This is the simplest shape for scraped catalogs.
- **Row/column dataset**: `{meta, rows, columns, cells}`, as shown in `README.md` and `examples/product-shades.json`.
- **Portable project**: anything with `schemaVersion` and `data`, such as a previous `--project` output or an export from the app.

**Record field roles.** Roles are guessed from field names. Use `--map role=field` to set them yourself:

| Role | Guessed from | Meaning |
|---|---|---|
| `id` | id, sku, code | Stable card ID (letters, digits, `-`, `_`); every record needs one. With no such field, or `--map id=`, IDs are generated from the names |
| `row` | name, title, product | Card title. One row per record unless `column` is set |
| `column` | (none) | Optional variant axis, such as color. Records with the same `row` are grouped |
| `image` | image, photo, src, thumbnail | Relative image path (see below). Empty means a "Preview pending" card |
| `description` | description, notes, details | Shown in the card's details |
| `link` | source_url, product_url, url, link | Product page. Must be absolute `http(s)`. Anything else is kept as a plain attribute |

Every other field must be a scalar (text, number, boolean, null) and becomes a specification shown on the card. Flatten nested data before export.

**Images**
- Paths are relative and must start with `assets/` or `guides/`, for example `assets/tee.png`. They resolve against `--images <dir>`, which defaults to the dataset's folder.
- Use PNG, JPEG or WebP only, at most 40 MiB each once embedded. Symlinks and paths that leave the folder are refused.
- **Remote image URLs are refused on purpose.** Download photos yourself, from sources you are allowed to use, then point at the local files.
- A referenced image that is missing stops the export, so a gallery is never silently incomplete.

**Limits:** 40 rows, 40 columns, 400 cards, 300 MiB per dataset and per gallery. If your delivery channel has a smaller attachment limit, shrink the photos before export. Never drop items to fit.

**Privacy:** the gallery contains names, descriptions, specifications, links and images only. Decisions, private notes, favorites and annotations are never exported. Keep personal datasets and photos out of this repository.

## JS API

```js
import fs from 'node:fs';
import { prepareProject, renderGallery } from '/path/to/otro-matiz/scripts/render-gallery.mjs';

const project = prepareProject({
  text: fs.readFileSync('products.json', 'utf8'),
  filename: 'products.json',         // ".csv" switches to CSV parsing
  imagesDir: '/work/drop',           // where assets/... live
  mapping: { column: 'color' },      // optional overrides of the guessed roles
  title: 'Autumn drop'               // optional: rowsLabel, columnsLabel, tableIndex
});                                  // throws Error with a readable message on any problem
const html = await renderGallery(project);   // the self-contained gallery as a string
fs.writeFileSync('gallery.html', html);
fs.writeFileSync('project.json', JSON.stringify(project)); // importable in the app
```

## Wiring it into an agent or MCP server

Keep integrations outside this repository, for example as a skill or plugin in your agent repo. Their job is to collect records and download photos. This repo turns them into the gallery.

**Simplest: a skill that runs the command.** Have the skill write `products.json` and `assets/*` into a work folder, run `node <otro-matiz>/scripts/render-gallery.mjs products.json gallery.html --project project.json`, check that the exit code is 0, then deliver `gallery.html`.

**As an MCP tool.** This is a minimal stdio server with `@modelcontextprotocol/sdk` 1.x and `zod`. It exposes one tool that takes records and local image paths:

```js
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { prepareProject, renderGallery } from '/path/to/otro-matiz/scripts/render-gallery.mjs';

const server = new McpServer({ name: 'otro-matiz-gallery', version: '0.1.0' });
server.registerTool('render_gallery', {
  description: 'Build a self-contained Otro Matiz gallery HTML from flat product records. Image fields are paths like assets/x.png inside workDir.',
  inputSchema: {
    workDir: z.string().describe('Absolute folder that holds assets/ and receives the output files'),
    records: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    title: z.string().optional(),
    mapping: z.record(z.string(), z.string()).optional()
  }
}, async ({ workDir, records, title, mapping }) => {
  const project = prepareProject({ text: JSON.stringify(records), filename: 'records.json', imagesDir: workDir, title, mapping });
  const html = await renderGallery(project);
  const out = path.join(workDir, 'gallery.html');
  fs.writeFileSync(out, html);
  fs.writeFileSync(path.join(workDir, 'project.json'), JSON.stringify(project));
  return { content: [{ type: 'text', text: JSON.stringify({ gallery: out, cards: project.data.cells.length, ready: project.data.meta.ready }) }] };
});
await server.connect(new StdioServerTransport());
```

Errors thrown by `prepareProject` and `renderGallery` are plain-language messages. With the SDK above they come back to the client as a tool result with `isError: true`. Pass them on unchanged.

The snippet was checked end to end with `@modelcontextprotocol/sdk` 1.32 and `zod` 4 through a stdio client.

## Where things are

| File | Role |
|---|---|
| `scripts/render-gallery.mjs` | Headless command and JS API described here |
| `tests/render-gallery.test.cjs` | Behaviour of the command: links, pending cards, refusals |
| `dataset-import.js` | Parses CSV/JSON and maps record fields (`parseInput`, `suggestMapping`, `mapRecords`, `prepareProject`) |
| `project-store.js` | The validation boundary for every project: IDs, paths, images, limits (`validateProject`, `validateData`) |
| `source-links.js` | Which product links are accepted |
| `portability.js` | `buildGallery`: the HTML snapshot, its CSP and its inert JSON payload |
| `examples/` | Neutral sample datasets |

Changes to validation or the gallery format belong in those core files, so the app and the command stay identical. Run `npm test`, `npm run check` and `npm run build` before a pull request.
