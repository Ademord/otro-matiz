# Otro Matiz

A generic visual decision studio. Load your own data, compare alternatives, record evaluations, organize favorites and export a useful brief. The dataset defines the project title, row and column labels, images and attributes.

The bundled **Color and form** demo contains three geometric forms in three colors. All nine previews are deterministic illustrations created by `scripts/create-demo.py`. The source distribution contains neutral examples only; personal projects and their images belong in separate local project exports.

## Run locally

Serve this directory with `python3 -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000/`. The minimalist workspace opens at the plain root URL. No route flag is required. No package installation, remote fonts, cloud upload or generation API is required. Node.js is needed only for development checks.

This static app can also be hosted on a static website service. A local preview address is available only on the machine running it; it is not a public deployment.

## Load a dataset

Open **Project**, expand **Export & import**, then use **Load a dataset** in **Import a project**. Choose JSON or CSV, review the field mapping and preview, and choose **Load as new project**. Existing projects remain available.

The importer accepts canonical matrices, legacy matrices, portable project exports and record tables. Choose fields for item/row, optional variant/column, image, ID, description and **Product / source link**. Records without a variant field appear in one Preview column. Extra scalar fields are retained as attributes; nested fields need flattening. Limits are 40 rows, 40 columns, 400 combinations and 300 MiB per project.

Local PNG, JPEG and WebP files can be attached and embedded. Imported remote image URLs are refused. This is an export-file importer; it does not connect to database servers or read native database files.

```json
{
  "meta": {"id": "my-dataset", "title": "My comparison", "rowsLabel": "Items", "columnsLabel": "Variants"},
  "rows": [{"id": "item-1", "name": "First item", "sourceUrl": "https://example.com/products/first-item", "attributes": {"material": "paper"}}],
  "columns": [{"id": "variant-1", "name": "First variant"}],
  "cells": [{"id": "preview-1", "row": "item-1", "column": "variant-1", "status": "ready", "src": "assets/preview.png"}]
}
```

Use `pending` without an image for unfilled slots. Missing pairs become pending automatically. Both axes can carry reference images and captions; cells can include detail images. Attributes accept text, finite numbers, booleans and null. The neutral schema uses `rows`, `columns`, `row` and `column`.

Optional `sourceUrl` fields link a row or cell to its product page or other source. A cell's link overrides its row's link. Links must be absolute HTTP(S) URLs of at most 2,048 characters, without credentials or control characters. Record imports recognize common fields such as `source_url`, `product_url` and `product_link`; review the mapping before loading. Links survive project exports and appear in Gallery, Matrix, Favorites and expanded viewers, including when a preview is pending or unavailable.

For a private product catalog, prepare local or embedded product previews, names, prices, size preferences and official product URLs in a separate import file. Open Otro Matiz in the browser you use for shopping, import the project and use the small arrow links to open product pages in new tabs. Add items on the store's own page using that browser's existing session. Links do not select a browser, transfer login cookies, synchronize carts or reserve stock.

Portable projects use schema version 2. Older styling-specific axis keys migrate at the validation boundary while preserving IDs, images, notes, decisions, favorites, lists and annotations. New exports use the neutral keys.

## Share a gallery in one file

In **Project → Export & import → Gallery to share**, choose **Download gallery HTML**. Send that one file: the recipient opens it directly in a browser, without importing a dataset or running Otro Matiz. The snapshot includes the whole project's cards, embedded images, names, descriptions, visible specifications and source links. Pending cards keep their source links. Up to 400 options are supported; the final file must fit within 300 MiB. A missing image prevents the export so incomplete files are not shared silently.

The file also contains a non-executable JSON payload with the public gallery data. Recorded decisions, private notes, favorites, annotations and recipient settings are omitted. Images are embedded, and the page loads no external resources; official source links open when the recipient activates them. Open it in the browser used for shopping to use that browser's existing store session. This is a static snapshot; later edits to the original project do not change it. The portable JSON export remains available for continuing an editable project on another device.

## Evaluate and compare

- Gallery opens as a continuous grid, with the project's title and description above it. Its charcoal palette, responsive page padding, heading proportions and compact cards follow the reference design. Matrix remains available for comparisons across two axes.
- Use **Full image** to keep each original image's proportions, or **Focused preview** for a square crop. Supplied detail images take priority in focused previews; otherwise the View controls adjust crop zoom and focal position without editing image files.
- In **View**, choose optional row/column grouping, the visible specification fields and responsive or custom page spacing. Hex color specifications display a swatch beside their original value. Descriptions stay in the expanded image viewer by default. **Show descriptions on cards** in View makes them available on cards too.
- Open a preview for its full image, closer detail and description. Choose **Compare** in the toolbar, then select two images and choose **Compare 2**. **Cancel** exits selection mode.
- When an item has a source link, use its arrow icon or **Open source** in the viewer to open it in a new tab. Source links stay separate from image, comparison and favorite controls.
- In a two-image comparison, move over either enlarged image to pan both together. Scroll over an image to zoom both; **−**, **+** and **Fit** also work without a mouse wheel. At the initial Detail framing, zooming out returns to the full images. Focus an image and use arrow keys to pan, +/− to zoom, or 0 to reset. Touch users can drag either enlarged image. Linked zoom and position are temporary and do not alter image files or saved projects.
- **Escape** steps back one layer: the frontmost dialog first, then View settings, comparison selection and Focus mode. It also works from Premium navigation and embedded previews; pending-save and draft protections still apply.
- Star options into Favorites and organize them into named lists. A favorite does not imply an evaluation decision.
- Choose **Evaluate** in an expanded image or comparison to record a decision and public or private notes. Cards omit decision footers. Filter by row, column and decision state.
- Use **Project** in the persistent toolbar to switch saved projects, including in Focus mode. Create, duplicate or rename projects through the same tools. Each project has its own labels, goal and data.
- Export an editable project copy or a recipient brief. Review the sharing scope; private notes stay out of recipient briefs.
- Prepare an AI handoff with stable cell IDs and attach generated images to those cells. Account-connected generation is planned; this version does not call a model automatically.

Matrix image size starts at **58%** and changes preview dimensions while labels and controls remain readable. The size controls preserve the matrix position; Alt + wheel can anchor resizing to a preview. Reset or matrix-local `0` returns to 58%. Ctrl/Cmd browser zoom remains independent. Right-drag pans the matrix.

View preferences stay local to this browser and project. **Save presentation to project** explicitly includes framing, grouping, visible specifications, card-description visibility, crop zoom and focal position in project exports and checkpoints. Imported projects use those saved settings as their initial presentation; existing local view choices take precedence. Reset view changes display preferences only.

## Storage and privacy

Projects and attached images use this browser's IndexedDB. View preferences use localStorage. There is no server-side project storage or automatic upload. A static host serves the bundled application files; it does not receive your imported projects through this app.

Browser storage belongs to this device and website origin, can be cleared, and is not a backup. Export important projects. A visible session-only warning appears when persistence is unavailable. Keep personal project exports and uploaded assets outside the source repository and static hosting directory.

## Development

Run `npm test`, `npm run check` and `npm run build` with Node.js 20 or newer. No dependency installation is needed. Rebuild the neutral demo with `python3 scripts/create-demo.py`.

`project-store.js` validates and saves projects; `lists-store.js` handles named lists. `source-links.js` validates optional outbound references and resolves cell overrides. `bootstrap.js` initializes the active project before loading the UI. `dataset-import.js` reviews file imports. `portability.js`, `generation.js` and `presentation.js` handle local exchange, standalone gallery snapshots, AI handoffs and recipient briefs. The generic demo lives in `data.js`, `examples/color-form.json` and `assets/demo/`.

## Editions and publication

Version **0.3.8** is the standalone free edition, maintained in [Ademord/otro-matiz](https://github.com/Ademord/otro-matiz). This repository contains the generic core, neutral demos and development checks. [Premium](https://github.com/Ademord/otro-matiz-premium) is maintained in a separate private repository and assembles this same core with its professional interfaces: annotations, branded recipient briefs, saved brief versions, exact recipient packages and project checkpoints. Personal datasets and imported images are not source assets.

Source licensing remains undecided; no open-source license has been applied. See `LICENSE-DECISION.md`. Account-connected generation remains future work.

The CI workflow runs the core tests, validates the demo and builds the static site on pushes and pull requests. The Pages workflow publishes passing builds from `main` when GitHub Pages is configured to use GitHub Actions. It uploads only the `dist/` output, which is assembled from the explicit `runtime-manifest.json` allowlist. Tests, scripts, documentation and unlisted assets are excluded from hosting. The deployment target is [Ademord.github.io/otro-matiz](https://Ademord.github.io/otro-matiz/). A deployed site is confirmed separately by its successful deployment run.

Run `npm run build`, then serve `dist/` to preview the exact Pages artifact. The app uses relative URLs and works from a repository subpath. The build rejects symlinked runtime paths, references outside the allowlist, non-demo bundled datasets and local machine paths. Newly required runtime assets must be added explicitly to `runtime-manifest.json`.

## Shared integration

Premium assembles this canonical core as its `public-core` dependency, using a pinned core revision for each release. Changes to Gallery, Matrix, comparison and project storage belong here rather than in a second Premium implementation. Matrix, Gallery and Favorites use the same toolbar comparison. Evaluations and full descriptions live in expanded views; card descriptions are optional in View. Imported descriptions stay distinct from scalar specifications and survive exports, AI handoffs and recipient briefs.
