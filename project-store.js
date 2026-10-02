/*
 * Otro Matiz studio — window.ProjectStore
 *
 * Keeps named projects in IndexedDB ("otro-matiz-studio"): project metadata in "projects",
 * matrix data (including embedded images) in "matrices" and the active project ID in
 * "settings". Matrix data is only rewritten when it changes, so saving a note does not
 * copy every embedded image again. localStorage is never used.
 *
 * Every mutation runs through one queue: it validates first, writes in a single transaction,
 * and only then replaces the current project and dispatches `studio:change` on document.
 * A failed write rejects with an Error and leaves the current project untouched.
 *
 * update(patch) replaces whole top-level fields, so pass complete data/decisions/favorites/lists/annotations/brief
 * values. When saves can overlap, prefer update(project => patch): the function receives the
 * latest committed project inside the queue, which avoids read-modify-write loss.
 *
 * project.lists is optional in files (older projects have none) and always normalised to an
 * array of {id, name, cellIds, createdAt, updatedAt}. Lists are metadata: editing them never
 * rewrites matrix data. A matrix edit prunes list members whose cells were removed.
 */
(function (root) {
  'use strict';

  const sourceLinks = root.SourceLinks || (typeof require === 'function' ? require('./source-links.js') : null);

  const SCHEMA_VERSION = 2;
  const DB_NAME = 'otro-matiz-studio';
  const DB_VERSION = 1;
  const ACTIVE_KEY = 'activeProjectId';
  const OPEN_TIMEOUT_MS = 5000;
  const MiB = 1024 * 1024;

  const LIMITS = Object.freeze({
    projectChars: 300 * MiB,
    imageChars: 40 * MiB,
    rows: 40,
    columns: 40,
    cells: 400,
    projectId: 80,
    axisId: 80,
    cellId: 170,
    title: 120,
    label: 60,
    goal: 2000,
    name: 120,
    description: 1000,
    caption: 200,
    note: 4000,
    recipientName: 120,
    nextStep: 2000,
    brand: 120,
    logoBytes: 512 * 1024,
    logoName: 120,
    path: 260,
    lists: 100,
    listId: 80,
    listName: 120,
    listMembers: 400,
    annotationsPerCell: 8,
    annotationsTotal: 1000,
    annotationId: 80,
    annotationText: 240,
    attributes: 32,
    attributeKey: 80,
    attributeText: 1000,
    sourceUrl: 2048
  });

  const CELL_STATUSES = ['ready', 'pending'];
  const DECISION_STATUSES = ['unreviewed', 'considered', 'shortlisted', 'chosen', 'ruled-out'];
  const RECIPIENTS = ['stylist', 'client', 'general'];
  const BRIEF_DESIGN_DEFAULTS = Object.freeze({
    layout: 'detailed', accent: '#283d31', typography: 'editorial', logo: '', logoName: ''
  });
  const PATCH_FIELDS = ['title', 'goal', 'rowsLabel', 'columnsLabel', 'data', 'decisions', 'favorites', 'lists', 'annotations', 'brief'];

  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const SAFE_SEGMENT = /^[A-Za-z0-9_(),+-](?:[A-Za-z0-9 _.(),+-]*[A-Za-z0-9_(),+-])?$/;
  const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
  const ASSET_FOLDERS = ['assets', 'guides'];
  const DATA_URL_PREFIX = /^data:image\/(png|jpeg|webp);base64,/;
  const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
  const SIGNATURES = {
    png: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
    jpeg: [[0, [0xff, 0xd8, 0xff]]],
    webp: [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]]
  };

  const SINGLE_LINE_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
  const MULTI_LINE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
  const SURROGATES = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g;

  function noop() {}

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function field(object, key) {
    return hasOwn(object, key) ? object[key] : undefined;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value !== null && typeof value === 'object') {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = clone(value[key]);
      return copy;
    }
    return value;
  }

  function reason(error) {
    if (!error) return 'unknown error';
    if (error.name === 'QuotaExceededError') return 'browser storage is full';
    return String(error.message || error.name || error);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isValidId(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max && ID_PATTERN.test(value);
  }

  function newProjectId() {
    const bytes = new Uint8Array(6);
    const cryptoApi = root.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `p-${Date.now().toString(36)}-${random}`;
  }

  function uniqueId(base, taken, max) {
    if (!taken.has(base)) return base;
    const stem = base.slice(0, max - 5).replace(/[-_]+$/, '') || 'item';
    let n = 2;
    while (taken.has(`${stem}-${n}`)) n += 1;
    return `${stem}-${n}`;
  }

  function slugify(name) {
    return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }

  /* ---------- Text ---------- */

  function cleanText(value, multiline) {
    let text = value.replace(SURROGATES, (match, pair) => pair || '�').replace(BIDI_CONTROLS, '');
    if (multiline) {
      text = text.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(MULTI_LINE_CONTROLS, '');
    } else {
      text = text.replace(SINGLE_LINE_CONTROLS, ' ');
    }
    return text.normalize('NFC');
  }

  function quote(value) {
    if (typeof value !== 'string') return `(${value === null ? 'null' : typeof value})`;
    return `"${cleanText(value, false).slice(0, 40)}"`;
  }

  /* ---------- Asset URLs ---------- */

  function decodeBase64Head(chunk) {
    try {
      const decode = typeof root.atob === 'function' ? root.atob.bind(root)
        : (typeof atob === 'function' ? atob : null);
      if (decode) return Array.from(decode(chunk), (char) => char.charCodeAt(0));
      if (typeof Buffer !== 'undefined') return Array.from(Buffer.from(chunk, 'base64'));
    } catch (error) {
      return null;
    }
    return null;
  }

  function dataUrlProblem(value) {
    if (value.length > LIMITS.imageChars) return `embedded image is larger than ${LIMITS.imageChars / MiB} MiB`;
    const match = DATA_URL_PREFIX.exec(value);
    if (!match) return 'only base64 PNG, JPEG or WebP data URLs are allowed';
    const body = value.slice(match[0].length);
    if (body.length < 16 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) return 'embedded image is not valid base64';
    const head = decodeBase64Head(body.slice(0, 16));
    const matches = head && SIGNATURES[match[1]].every(([offset, bytes]) =>
      bytes.every((byte, i) => head[offset + i] === byte));
    return matches ? '' : `embedded data is not a ${match[1].toUpperCase()} image`;
  }

  function pathProblem(value) {
    if (value.length > LIMITS.path) return `path is longer than ${LIMITS.path} characters`;
    const raw = value.startsWith('./') ? value.slice(2) : value;
    if (raw.includes(':')) return 'protocols, remote URLs and drive letters are not allowed';
    if (raw.startsWith('/') || raw.startsWith('\\')) return 'absolute paths are not allowed';
    if (/[\\?#]/.test(raw)) return 'backslashes, queries and fragments are not allowed';
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (error) {
      return 'malformed percent-encoding';
    }
    if (decoded.includes('%')) return 'double-encoded paths are not allowed';
    if (/[\\:?#]/.test(decoded) || decoded.startsWith('/')) return 'encoded separators or protocols are not allowed';
    const segments = decoded.split('/');
    for (const segment of segments) {
      if (!segment) return 'empty path segments are not allowed';
      if (segment === '.' || segment === '..') return 'path traversal is not allowed';
      if (!SAFE_SEGMENT.test(segment)) return 'file names may only use letters, numbers, spaces and - _ . ( ) , +';
    }
    if (segments.length > 1 && !ASSET_FOLDERS.includes(segments[0])) return 'images must be in assets/ or guides/';
    if (!IMAGE_FILE.test(segments[segments.length - 1])) return 'only PNG, JPEG or WebP files are allowed';
    return '';
  }

  /** Returns '' for a safe image URL, otherwise a short reason. */
  function assetUrlProblem(value) {
    if (typeof value !== 'string' || !value) return 'must be a non-empty string';
    if (/^data:/i.test(value)) return dataUrlProblem(value);
    return pathProblem(value);
  }

  /* ---------- Validation ---------- */

  function fail(path, message) {
    const error = new Error(path ? `${path}: ${message}` : message);
    error.name = 'ProjectValidationError';
    error.path = path;
    throw error;
  }

  function count(ctx, length) {
    ctx.chars += length;
    if (ctx.chars > LIMITS.projectChars) fail('', `The project is larger than the ${LIMITS.projectChars / MiB} MiB limit.`);
  }

  function repairOr(ctx, path, message) {
    if (!ctx.repair) fail(path, message);
    ctx.warnings.push(`${path}: ${message}`);
  }

  function text(ctx, value, path, max, options = {}) {
    let result = value === undefined || value === null ? '' : value;
    if (typeof result !== 'string') {
      if (options.required || !ctx.repair) fail(path, 'must be text');
      repairOr(ctx, path, 'must be text');
      result = '';
    }
    result = cleanText(result, options.multiline);
    if (result.length > max) {
      repairOr(ctx, path, `is longer than ${max} characters`);
      result = result.slice(0, max);
    }
    if (!result.trim()) {
      if (options.required) fail(path, 'is required');
      if (options.fallback !== undefined) result = options.fallback;
    }
    count(ctx, result.length);
    return result;
  }

  function optionalText(ctx, target, key, value, path, max, multiline) {
    if (value === undefined || value === null || value === '') return;
    const result = text(ctx, value, path, max, { multiline });
    if (result.trim()) target[key] = result;
  }

  function identifier(ctx, value, path, max) {
    if (typeof value !== 'string' || !value) fail(path, 'must be a non-empty ID');
    if (value.length > max) fail(path, `ID is longer than ${max} characters`);
    if (!ID_PATTERN.test(value)) fail(path, `ID ${quote(value)} may only use letters, numbers, "-" and "_", starting with a letter or number`);
    count(ctx, value.length);
    return value;
  }

  function assetUrl(ctx, value, path) {
    const problem = assetUrlProblem(value);
    if (problem) fail(path, `unsafe image URL (${problem})`);
    count(ctx, value.length);
    return value.startsWith('./') ? value.slice(2) : value;
  }

  function optionalSourceUrl(ctx, target, value, path) {
    if (value === undefined || value === null || value === '') return;
    const problem = sourceLinks ? sourceLinks.problem(value) : 'source link validation is unavailable';
    if (problem) {
      repairOr(ctx, path, `unsafe source URL (${problem})`);
      return;
    }
    const normalized = sourceLinks.normalize(value);
    count(ctx, normalized.length);
    target.sourceUrl = normalized;
  }

  function timestamp(value) {
    if (typeof value === 'string' && value.length <= 40) {
      const time = Date.parse(value);
      if (Number.isFinite(time)) {
        try {
          return new Date(time).toISOString();
        } catch (error) {
          return nowIso();
        }
      }
    }
    return nowIso();
  }

  // Dataset attributes describe any domain (colours, materials, products, treatments).
  // A bounded scalar map avoids silently retaining arbitrary executable or nested data.
  function buildAttributes(ctx, input, path) {
    if (input === undefined) return undefined;
    if (!isPlainObject(input)) fail(path, 'must be an object of text, numbers, booleans or null');
    const keys = Object.keys(input);
    if (keys.length > LIMITS.attributes) fail(path, `has more than ${LIMITS.attributes} entries`);
    const attributes = {};
    for (const key of keys) {
      if (!key || key.length > LIMITS.attributeKey || ['__proto__', 'prototype', 'constructor'].includes(key) ||
          cleanText(key, false) !== key) fail(path, 'attribute names must be safe text of 1 to 80 characters');
      count(ctx, key.length);
      const value = input[key];
      if (typeof value === 'string') attributes[key] = text(ctx, value, `${path}[${quote(key)}]`, LIMITS.attributeText, { multiline: true });
      else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        attributes[key] = value;
        count(ctx, String(value).length);
      } else fail(`${path}[${quote(key)}]`, 'must be text, a finite number, a boolean or null');
    }
    return attributes;
  }

  function buildAxis(ctx, input, path, max) {
    if (!Array.isArray(input) || input.length === 0) fail(path, 'must list at least one entry');
    if (input.length > max) fail(path, `has more than ${max} entries`);
    const seen = new Set();
    return input.map((raw, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isPlainObject(raw)) fail(itemPath, 'must be an object');
      const id = identifier(ctx, field(raw, 'id'), `${itemPath}.id`, LIMITS.axisId);
      if (seen.has(id)) fail(`${itemPath}.id`, `repeats the ID ${quote(id)}`);
      seen.add(id);
      const entry = { id, name: text(ctx, field(raw, 'name'), `${itemPath}.name`, LIMITS.name, { required: true }) };
      optionalText(ctx, entry, 'description', field(raw, 'description'), `${itemPath}.description`, LIMITS.description, true);
      optionalText(ctx, entry, 'referenceCaption', field(raw, 'referenceCaption'), `${itemPath}.referenceCaption`, LIMITS.caption, false);
      const source = field(raw, 'source');
      if (source !== undefined && source !== null && source !== '') entry.source = assetUrl(ctx, source, `${itemPath}.source`);
      optionalSourceUrl(ctx, entry, field(raw, 'sourceUrl'), `${itemPath}.sourceUrl`);
      const attributes = buildAttributes(ctx, field(raw, 'attributes'), `${itemPath}.attributes`);
      if (attributes !== undefined) entry.attributes = attributes;
      return entry;
    });
  }

  function makeMeta(id, updatedAt, cells, previous = {}) {
    return { ...previous, id, updatedAt, ready: cells.filter((cell) => cell.status === 'ready').length, total: cells.length };
  }

  function buildPresentation(ctx, input) {
    if (input === undefined || input === null) return undefined;
    if (!isPlainObject(input)) fail('data.meta.presentation', 'must be an object');
    const result = {};
    const allowed = ['galleryFraming', 'galleryGrouping', 'galleryDescriptions', 'metadataFields', 'galleryZoom', 'galleryFocalX', 'galleryFocalY'];
    for (const key of Object.keys(input)) {
      if (!allowed.includes(key)) fail(`data.meta.presentation.${key}`, 'is not a supported presentation field');
      const value = field(input, key), path = `data.meta.presentation.${key}`;
      if (key === 'galleryFraming' || key === 'galleryGrouping') {
        const choices = key === 'galleryFraming' ? ['full', 'focused'] : ['none', 'row', 'column'];
        if (!choices.includes(value)) fail(path, `must be one of ${choices.join(', ')}`);
        result[key] = value;
      } else if (key === 'galleryDescriptions') {
        if (typeof value !== 'boolean') fail(path, 'must be a boolean');
        result[key] = value;
      } else if (key === 'metadataFields') {
        if (value === null) result[key] = null;
        else {
          if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length) fail(path, 'must be null or at most 32 distinct metadata keys');
          result[key] = value.map((item, index) => {
            const name = text(ctx, item, `${path}[${index}]`, 100, {required: true});
            if (!/^(row|column|cell)\..+/.test(name)) fail(path, 'keys must start with row., column. or cell.');
            return name;
          });
        }
      } else {
        const minimum = key === 'galleryZoom' ? 1 : 0, maximum = key === 'galleryZoom' ? 3 : 1;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path, `must be a number from ${minimum} to ${maximum}`);
        result[key] = value;
      }
    }
    count(ctx, JSON.stringify(result).length);
    return result;
  }

  function buildDataMeta(ctx, input) {
    if (input === undefined || input === null) return {};
    if (!isPlainObject(input)) fail('data.meta', 'must be an object');
    const meta = {};
    for (const [key, max, multiline] of [['title', LIMITS.title, false], ['goal', LIMITS.goal, true],
      ['rowsLabel', LIMITS.label, false], ['columnsLabel', LIMITS.label, false]]) {
      optionalText(ctx, meta, key, field(input, key), `data.meta.${key}`, max, multiline);
    }
    const presentation = buildPresentation(ctx, field(input, 'presentation'));
    if (presentation !== undefined) meta.presentation = presentation;
    return meta;
  }

  // Legacy domain names are read only at this boundary. All returned data uses rows/columns.
  function dataField(input, canonical, legacy) {
    return hasOwn(input, canonical) ? field(input, canonical) : field(input, legacy);
  }

  function buildData(ctx, input, projectId, updatedAt) {
    if (!isPlainObject(input)) fail('data', 'must be an object with rows, columns and cells');
    const rows = buildAxis(ctx, dataField(input, 'rows', 'haircuts'), 'data.rows', LIMITS.rows);
    const columns = buildAxis(ctx, dataField(input, 'columns', 'beards'), 'data.columns', LIMITS.columns);
    if (rows.length * columns.length > LIMITS.cells) {
      fail('data', `${rows.length} × ${columns.length} makes more than ${LIMITS.cells} cells`);
    }
    const rawCells = field(input, 'cells') === undefined ? [] : field(input, 'cells');
    if (!Array.isArray(rawCells)) fail('data.cells', 'must be a list');
    if (rawCells.length > LIMITS.cells) fail('data.cells', `has more than ${LIMITS.cells} cells`);

    const rowIndex = new Map(rows.map((entry, index) => [entry.id, index]));
    const columnIndex = new Map(columns.map((entry, index) => [entry.id, index]));
    const ids = new Set();
    const positions = new Map();
    const cells = rawCells.map((raw, index) => {
      const path = `data.cells[${index}]`;
      if (!isPlainObject(raw)) fail(path, 'must be an object');
      const id = identifier(ctx, field(raw, 'id'), `${path}.id`, LIMITS.cellId);
      if (ids.has(id)) fail(`${path}.id`, `repeats the cell ID ${quote(id)}`);
      const row = dataField(raw, 'row', 'haircut');
      const column = dataField(raw, 'column', 'beard');
      if (!rowIndex.has(row)) fail(`${path}.row`, `refers to unknown row ${quote(row)}`);
      if (!columnIndex.has(column)) fail(`${path}.column`, `refers to unknown column ${quote(column)}`);
      const position = `${row}\n${column}`;
      if (positions.has(position)) fail(path, `uses the same row and column as cell ${quote(positions.get(position))}`);
      let status = field(raw, 'status');
      if (!CELL_STATUSES.includes(status)) {
        repairOr(ctx, `${path}.status`, 'must be "ready" or "pending"');
        status = 'pending';
      }
      const cell = { id, row, column, status };
      optionalText(ctx, cell, 'description', field(raw, 'description'), `${path}.description`, LIMITS.description, true);
      optionalSourceUrl(ctx, cell, field(raw, 'sourceUrl'), `${path}.sourceUrl`);
      for (const key of ['src', 'detail']) {
        const image = field(raw, key);
        if (image !== undefined && image !== null && image !== '') cell[key] = assetUrl(ctx, image, `${path}.${key}`);
      }
      const attributes = buildAttributes(ctx, field(raw, 'attributes'), `${path}.attributes`);
      if (attributes !== undefined) cell.attributes = attributes;
      if (status === 'ready' && !cell.src) {
        repairOr(ctx, `${path}.src`, 'a ready cell needs an image');
        cell.status = 'pending';
      }
      ids.add(id);
      positions.set(position, id);
      return cell;
    });

    // Complete matrix: every row × column pair exists, missing ones as pending cells.
    for (const row of rows) {
      for (const column of columns) {
        if (positions.has(`${row.id}\n${column.id}`)) continue;
        const id = uniqueId(`${row.id}--${column.id}`, ids, LIMITS.cellId);
        ids.add(id);
        cells.push({ id, row: row.id, column: column.id, status: 'pending' });
      }
    }
    cells.sort((a, b) => rowIndex.get(a.row) - rowIndex.get(b.row)
      || columnIndex.get(a.column) - columnIndex.get(b.column));
    return { rows, columns, cells, meta: makeMeta(projectId, updatedAt, cells, buildDataMeta(ctx, field(input, 'meta'))) };
  }

  function buildDecisions(ctx, input, cellIds) {
    if (input === undefined || input === null) return {};
    if (!isPlainObject(input)) fail('decisions', 'must be an object keyed by cell ID');
    const keys = Object.keys(input);
    if (keys.length > LIMITS.cells) fail('decisions', `has more than ${LIMITS.cells} entries`);
    const decisions = {};
    for (const key of keys) {
      const path = `decisions[${quote(key)}]`;
      if (!cellIds.has(key)) {
        if (ctx.dropStaleDecisions) continue;
        repairOr(ctx, path, 'refers to a cell that does not exist');
        continue;
      }
      const raw = input[key];
      if (!isPlainObject(raw)) {
        repairOr(ctx, path, 'must be an object');
        continue;
      }
      let status = field(raw, 'status');
      if (status === undefined) status = 'unreviewed';
      if (!DECISION_STATUSES.includes(status)) {
        repairOr(ctx, `${path}.status`, `must be one of ${DECISION_STATUSES.join(', ')}`);
        status = 'unreviewed';
      }
      decisions[key] = {
        status,
        note: text(ctx, field(raw, 'note'), `${path}.note`, LIMITS.note, { multiline: true }),
        privateNote: text(ctx, field(raw, 'privateNote'), `${path}.privateNote`, LIMITS.note, { multiline: true })
      };
    }
    return decisions;
  }

  function buildFavorites(ctx, input, cellIds) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) fail('favorites', 'must be a list of cell IDs');
    if (input.length > LIMITS.cells) fail('favorites', `has more than ${LIMITS.cells} entries`);
    const favorites = [];
    const seen = new Set();
    input.forEach((id, index) => {
      if (typeof id !== 'string' || !cellIds.has(id)) {
        if (!ctx.dropStaleFavorites) repairOr(ctx, `favorites[${index}]`, `refers to a cell that does not exist ${quote(id)}`);
        return;
      }
      if (!seen.has(id)) {
        seen.add(id);
        favorites.push(id);
      }
    });
    return favorites;
  }

  function listTimestamp(ctx, value, path) {
    if (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))) return timestamp(value);
    repairOr(ctx, path, 'must be a date and time');
    return nowIso();
  }

  function buildList(ctx, raw, path, cellIds, seen) {
    if (!isPlainObject(raw)) fail(path, 'must be an object');
    const id = identifier(ctx, field(raw, 'id'), `${path}.id`, LIMITS.listId);
    if (seen.has(id)) fail(`${path}.id`, `repeats the list ID ${quote(id)}`);
    const name = text(ctx, field(raw, 'name'), `${path}.name`, LIMITS.listName, { required: true });
    const rawMembers = field(raw, 'cellIds');
    if (!Array.isArray(rawMembers)) fail(`${path}.cellIds`, 'must be a list of cell IDs');
    if (rawMembers.length > LIMITS.listMembers) fail(`${path}.cellIds`, `has more than ${LIMITS.listMembers} entries`);
    const members = [];
    const taken = new Set();
    rawMembers.forEach((member, index) => {
      const memberPath = `${path}.cellIds[${index}]`;
      if (typeof member !== 'string' || !cellIds.has(member)) {
        if (!ctx.dropStaleListMembers) repairOr(ctx, memberPath, `refers to a cell that does not exist ${quote(member)}`);
        return;
      }
      if (taken.has(member)) {
        repairOr(ctx, memberPath, `repeats the cell ID ${quote(member)}`);
        return;
      }
      taken.add(member);
      count(ctx, member.length);
      members.push(member);
    });
    const createdAt = listTimestamp(ctx, field(raw, 'createdAt'), `${path}.createdAt`);
    const updatedAt = listTimestamp(ctx, field(raw, 'updatedAt'), `${path}.updatedAt`);
    seen.add(id);
    return { id, name, cellIds: members, createdAt, updatedAt };
  }

  // Named Favorites lists. Strict validation rejects bad entries; when repairing a saved record
  // an unreadable list is skipped with a warning instead of making the whole project unreadable.
  function buildLists(ctx, input, cellIds) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) fail('lists', 'must be a list');
    if (input.length > LIMITS.lists) fail('lists', `has more than ${LIMITS.lists} lists`);
    const seen = new Set();
    const lists = [];
    input.forEach((raw, index) => {
      try {
        lists.push(buildList(ctx, raw, `lists[${index}]`, cellIds, seen));
      } catch (error) {
        if (!ctx.repair || !error || error.name !== 'ProjectValidationError' || !error.path) throw error;
        ctx.warnings.push(error.message);
      }
    });
    return lists;
  }

  // Shareable visual notes. Invalid saved pins are discarded rather than moved to a
  // guessed location; valid siblings survive. Missing legacy annotations default to {}.
  function buildAnnotations(ctx, input, cellIds) {
    if (input === undefined) return {};
    if (!isPlainObject(input)) {
      repairOr(ctx, 'annotations', 'must be an object keyed by cell ID');
      return {};
    }
    const annotations = {};
    let total = 0;
    for (const key of Object.keys(input)) {
      const path = `annotations[${quote(key)}]`;
      if (!cellIds.has(key)) {
        if (!ctx.dropStaleAnnotations) repairOr(ctx, path, 'refers to a cell that does not exist');
        continue;
      }
      const rawPins = input[key];
      if (!Array.isArray(rawPins)) {
        repairOr(ctx, path, 'must be a list of annotations');
        continue;
      }
      if (rawPins.length > LIMITS.annotationsPerCell) repairOr(ctx, path, `has more than ${LIMITS.annotationsPerCell} annotations`);
      const pins = [];
      const seen = new Set();
      for (let index = 0; index < Math.min(rawPins.length, LIMITS.annotationsPerCell); index += 1) {
        const pinPath = `${path}[${index}]`;
        try {
          const raw = rawPins[index];
          if (!isPlainObject(raw)) fail(pinPath, 'must be an object');
          const id = identifier(ctx, field(raw, 'id'), `${pinPath}.id`, LIMITS.annotationId);
          if (seen.has(id)) fail(`${pinPath}.id`, `repeats the annotation ID ${quote(id)}`);
          const x = field(raw, 'x');
          const y = field(raw, 'y');
          for (const [axis, value] of [['x', x], ['y', y]]) {
            if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${pinPath}.${axis}`, 'must be a finite number from 0 to 1');
          }
          const rawText = field(raw, 'text');
          if (typeof rawText !== 'string') fail(`${pinPath}.text`, 'must be text');
          const note = text(ctx, rawText, `${pinPath}.text`, LIMITS.annotationText, { multiline: true });
          if (total >= LIMITS.annotationsTotal) fail('annotations', `has more than ${LIMITS.annotationsTotal} annotations`);
          seen.add(id);
          pins.push({ id, x, y, text: note });
          total += 1;
        } catch (error) {
          if (!ctx.repair || !error || error.name !== 'ProjectValidationError' || !error.path) throw error;
          ctx.warnings.push(error.message);
        }
      }
      annotations[key] = pins;
    }
    return annotations;
  }

  function logoProblem(value) {
    if (typeof value !== 'string') return 'must be text';
    if (!value) return '';
    // Bound encoded input before scanning it; the longest accepted prefix is 23 characters.
    if (value.length > Math.ceil(LIMITS.logoBytes / 3) * 4 + 23) return 'logo is larger than 512 KiB';
    const problem = dataUrlProblem(value);
    if (problem) return problem;
    const body = value.slice(value.indexOf(',') + 1);
    const padding = body.endsWith('==') ? 2 : (body.endsWith('=') ? 1 : 0);
    const decodedBytes = body.length / 4 * 3 - padding;
    return decodedBytes > LIMITS.logoBytes ? 'logo is larger than 512 KiB' : '';
  }

  function buildBriefDesign(ctx, input) {
    let source = input === undefined ? {} : input;
    if (!isPlainObject(source)) {
      repairOr(ctx, 'brief.design', 'must be an object');
      source = {};
    }
    const design = { ...BRIEF_DESIGN_DEFAULTS };
    for (const [key, allowed] of [['layout', ['detailed', 'summary']], ['typography', ['editorial', 'modern']]]) {
      const value = field(source, key);
      if (value === undefined) continue;
      if (!allowed.includes(value)) repairOr(ctx, `brief.design.${key}`, `must be one of ${allowed.join(', ')}`);
      else design[key] = value;
    }
    const accent = field(source, 'accent');
    if (accent !== undefined) {
      if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) {
        repairOr(ctx, 'brief.design.accent', 'must be a six-digit hex color');
      } else design.accent = accent.toLowerCase();
    }
    const logo = field(source, 'logo');
    if (logo !== undefined) {
      const problem = logoProblem(logo);
      if (problem) repairOr(ctx, 'brief.design.logo', problem);
      else design.logo = logo;
    }
    const logoName = field(source, 'logoName');
    if (logoName !== undefined) {
      if (typeof logoName !== 'string') repairOr(ctx, 'brief.design.logoName', 'must be text');
      else design.logoName = text(ctx, logoName, 'brief.design.logoName', LIMITS.logoName);
    }
    // logoName is already counted by text(); include the remaining metadata in the project bound.
    count(ctx, design.layout.length + design.typography.length + design.accent.length + design.logo.length);
    return design;
  }

  function buildBrief(ctx, input) {
    const source = input === undefined || input === null ? {} : input;
    if (!isPlainObject(source)) fail('brief', 'must be an object');
    let recipient = field(source, 'recipient');
    if (recipient === undefined || recipient === '') recipient = 'general';
    if (!RECIPIENTS.includes(recipient)) {
      repairOr(ctx, 'brief.recipient', `must be one of ${RECIPIENTS.join(', ')}`);
      recipient = 'general';
    }
    return {
      recipient,
      recipientName: text(ctx, field(source, 'recipientName'), 'brief.recipientName', LIMITS.recipientName),
      nextStep: text(ctx, field(source, 'nextStep'), 'brief.nextStep', LIMITS.nextStep, { multiline: true }),
      brand: text(ctx, field(source, 'brand'), 'brief.brand', LIMITS.brand),
      design: buildBriefDesign(ctx, field(source, 'design'))
    };
  }

  function buildProject(ctx, input, options) {
    const version = field(input, 'schemaVersion');
    if (version !== 1 && version !== SCHEMA_VERSION) fail('schemaVersion', `must be 1 or ${SCHEMA_VERSION}`);
    let id;
    if (options.id) {
      id = options.id;
    } else if (options.generateMissingId) {
      const rawId = field(input, 'id');
      id = isValidId(rawId, LIMITS.projectId) ? rawId : newProjectId();
    } else {
      id = identifier(ctx, field(input, 'id'), 'id', LIMITS.projectId);
    }
    const updatedAt = options.updatedAt || timestamp(field(input, 'updatedAt'));
    const trusted = options.trustedData;
    const data = trusted
      ? { rows: trusted.rows, columns: trusted.columns, cells: trusted.cells, meta: makeMeta(id, updatedAt, trusted.cells, trusted.meta) }
      : buildData(ctx, field(input, 'data'), id, updatedAt);
    const cellIds = new Set(data.cells.map((cell) => cell.id));
    return {
      schemaVersion: SCHEMA_VERSION,
      id,
      title: text(ctx, field(input, 'title'), 'title', LIMITS.title, { fallback: 'Untitled project' }),
      goal: text(ctx, field(input, 'goal'), 'goal', LIMITS.goal, { multiline: true }),
      rowsLabel: text(ctx, field(input, 'rowsLabel'), 'rowsLabel', LIMITS.label, { fallback: 'Rows' }),
      columnsLabel: text(ctx, field(input, 'columnsLabel'), 'columnsLabel', LIMITS.label, { fallback: 'Columns' }),
      data,
      decisions: buildDecisions(ctx, field(input, 'decisions'), cellIds),
      favorites: buildFavorites(ctx, field(input, 'favorites'), cellIds),
      lists: buildLists(ctx, field(input, 'lists'), cellIds),
      annotations: buildAnnotations(ctx, field(input, 'annotations'), cellIds),
      brief: buildBrief(ctx, field(input, 'brief')),
      updatedAt
    };
  }

  /**
   * Returns a new sanitized project or throws a ProjectValidationError. Never mutates `value`.
   * Accepts a parsed object or JSON text. Internal options: id, updatedAt, trustedData, repair,
   * warnings, dropStaleDecisions, dropStaleFavorites, dropStaleListMembers, dropStaleAnnotations, generateMissingId.
   */
  function validateProject(value, options = {}) {
    const ctx = {
      repair: Boolean(options.repair),
      dropStaleDecisions: Boolean(options.dropStaleDecisions),
      dropStaleFavorites: Boolean(options.dropStaleFavorites),
      dropStaleListMembers: Boolean(options.dropStaleListMembers),
      dropStaleAnnotations: Boolean(options.dropStaleAnnotations),
      warnings: options.warnings || [],
      chars: 0
    };
    let input = value;
    if (typeof input === 'string') {
      if (input.length > LIMITS.projectChars) fail('', `The project file is larger than the ${LIMITS.projectChars / MiB} MiB limit.`);
      try {
        input = JSON.parse(input);
      } catch (error) {
        fail('', 'The project file is not valid JSON.');
      }
    }
    if (!isPlainObject(input)) fail('', 'A project must be a JSON object.');
    try {
      return buildProject(ctx, input, options);
    } catch (error) {
      if (error && error.name === 'ProjectValidationError') throw error;
      return fail('', `The project could not be read (${reason(error)}).`);
    }
  }

  /** Validate and normalize a raw matrix dataset (including legacy axis/cell names).
   * This is the shared importer boundary. It never mutates the input and emits schema-v2 data.
   * The caller may supply id/updatedAt to bind its computed metadata to a project.
   */
  function validateData(value, options = {}) {
    const meta = isPlainObject(value) && isPlainObject(value.meta) ? value.meta : {};
    const id = options.id || (isValidId(meta.id, LIMITS.projectId) ? meta.id : 'dataset');
    const updatedAt = options.updatedAt || timestamp(meta.updatedAt);
    const ctx = { repair: Boolean(options.repair), warnings: options.warnings || [], chars: 0 };
    identifier(ctx, id, 'data.meta.id', LIMITS.projectId);
    return buildData(ctx, value, id, updatedAt);
  }

  function buildNewProject(spec, id) {
    if (!isPlainObject(spec)) fail('', 'create() needs {title, rowsLabel, columnsLabel, rows, columns}.');
    const rows = newAxis(field(spec, 'rows'), 'rows', LIMITS.rows, 'row');
    const columns = newAxis(field(spec, 'columns'), 'columns', LIMITS.columns, 'column');
    if (rows.length * columns.length > LIMITS.cells) {
      fail('', `${rows.length} × ${columns.length} makes more than ${LIMITS.cells} cells.`);
    }
    const updatedAt = nowIso();
    return validateProject({
      schemaVersion: SCHEMA_VERSION,
      id,
      title: field(spec, 'title'),
      goal: field(spec, 'goal'),
      rowsLabel: field(spec, 'rowsLabel'),
      columnsLabel: field(spec, 'columnsLabel'),
      data: { rows, columns, cells: [] },
      decisions: {},
      favorites: [],
      lists: [],
      brief: {},
      updatedAt
    }, { id, updatedAt });
  }

  function newAxis(list, path, max, fallbackPrefix) {
    if (!Array.isArray(list) || list.length === 0) fail(path, 'add at least one name');
    if (list.length > max) fail(path, `can have at most ${max} entries`);
    const taken = new Set();
    return list.map((item, index) => {
      const name = typeof item === 'string' ? item : (isPlainObject(item) ? field(item, 'name') : undefined);
      if (typeof name !== 'string' || !name.trim()) fail(`${path}[${index}]`, 'needs a name');
      const id = uniqueId(slugify(name) || `${fallbackPrefix}-${index + 1}`, taken, LIMITS.axisId);
      taken.add(id);
      const entry = { id, name: name.trim() };
      if (isPlainObject(item)) {
        for (const key of ['description', 'source', 'sourceUrl', 'referenceCaption', 'attributes']) {
          if (hasOwn(item, key)) entry[key] = item[key];
        }
      }
      return entry;
    });
  }

  /* ---------- Storage backends ---------- */

  function metadataOf(project) {
    const meta = Object.assign({}, project);
    delete meta.data;
    return meta;
  }

  function openDatabase(factory) {
    return new Promise((resolve, reject) => {
      if (!factory || typeof factory.open !== 'function') {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => finish(new Error('browser storage did not respond')), OPEN_TIMEOUT_MS);
      function finish(error, db) {
        if (settled) {
          if (db) db.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(db);
      }
      let request;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (error) {
        finish(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('matrices')) db.createObjectStore('matrices', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        finish(null, db);
      };
      request.onerror = () => finish(request.error || new Error('browser storage could not be opened'));
    });
  }

  function createIndexedDbBackend(db) {
    function transact(stores, mode, work) {
      return new Promise((resolve, reject) => {
        const out = {};
        let tx;
        try {
          tx = db.transaction(stores, mode);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(out.value);
        tx.onabort = () => reject(tx.error || new Error('browser storage cancelled the change'));
        try {
          work(tx, out);
        } catch (error) {
          try { tx.abort(); } catch (ignored) { /* already finished */ }
          reject(error);
        }
      });
    }

    return {
      persistent: true,
      loadIndex() {
        return transact(['projects', 'settings'], 'readonly', (tx, out) => {
          out.value = { records: [], activeId: null };
          tx.objectStore('projects').getAll().onsuccess = (event) => { out.value.records = event.target.result || []; };
          tx.objectStore('settings').get(ACTIVE_KEY).onsuccess = (event) => { out.value.activeId = event.target.result; };
        });
      },
      loadProject(id) {
        return transact(['projects', 'matrices'], 'readonly', (tx, out) => {
          out.value = {};
          tx.objectStore('projects').get(id).onsuccess = (event) => { out.value.meta = event.target.result; };
          tx.objectStore('matrices').get(id).onsuccess = (event) => { out.value.matrix = event.target.result; };
        }).then(({ meta, matrix }) => (isPlainObject(meta)
          ? Object.assign({}, meta, { data: isPlainObject(matrix) ? matrix.data : undefined })
          : undefined));
      },
      commit(project, { makeActive, writeData }) {
        return transact(['projects', 'matrices', 'settings'], 'readwrite', (tx) => {
          tx.objectStore('projects').put(metadataOf(project));
          if (writeData) tx.objectStore('matrices').put({ id: project.id, data: project.data });
          if (makeActive) tx.objectStore('settings').put(project.id, ACTIVE_KEY);
        });
      },
      setActive(id) {
        return transact(['settings'], 'readwrite', (tx) => { tx.objectStore('settings').put(id, ACTIVE_KEY); });
      }
    };
  }

  function createMemoryBackend() {
    const projects = new Map();
    let activeId = null;
    return {
      persistent: false,
      async loadIndex() {
        return { records: Array.from(projects.values(), metadataOf), activeId };
      },
      async loadProject(id) {
        return projects.has(id) ? clone(projects.get(id)) : undefined;
      },
      async commit(project, { makeActive }) {
        projects.set(project.id, clone(project));
        if (makeActive) activeId = project.id;
      },
      async setActive(id) {
        activeId = id;
      }
    };
  }

  /* ---------- Store ---------- */

  function summarize(project) {
    return { id: project.id, title: project.title, updatedAt: project.updatedAt };
  }

  function storedSummary(record) {
    const title = typeof record.title === 'string' && record.title.trim()
      ? cleanText(record.title, false).slice(0, LIMITS.title) : 'Untitled project';
    const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt.slice(0, 40) : '';
    return { id: record.id, title, updatedAt };
  }

  function byRecent(a, b) {
    if (a.updatedAt === b.updatedAt) return 0;
    return b.updatedAt > a.updatedAt ? 1 : -1;
  }

  function copyTitle(title) {
    const suffix = ' (copy)';
    return title.slice(0, LIMITS.title - suffix.length) + suffix;
  }

  /**
   * Options (tests/integration only): backend, indexedDB, document, CustomEvent.
   */
  function createProjectStore(options = {}) {
    const doc = hasOwn(options, 'document') ? options.document : root.document;
    const EventCtor = options.CustomEvent || root.CustomEvent;
    let backend = null;
    let current = null;
    let summaries = new Map();
    const dataNeedsMigration = new Set();
    let ready = false;
    let initPromise = null;
    let baseMessage = 'Project storage is starting.';
    let notices = [];
    let saveProblem = '';
    let queue = Promise.resolve();

    function enqueue(task) {
      const run = queue.then(task);
      queue = run.then(noop, noop);
      return run;
    }

    function requireReady() {
      if (!ready) throw new Error('ProjectStore.init() has not finished yet.');
    }

    function isPersistent() {
      return Boolean(backend) && backend.persistent !== false;
    }

    function indexedDbFactory() {
      if (hasOwn(options, 'indexedDB')) return options.indexedDB;
      try {
        return root.indexedDB || null;
      } catch (error) {
        return null;
      }
    }

    function freshId() {
      let id = newProjectId();
      while (summaries.has(id)) id = newProjectId();
      return id;
    }

    function emit(project, structural, fields) {
      if (!doc || typeof doc.dispatchEvent !== 'function' || typeof EventCtor !== 'function') return;
      try {
        doc.dispatchEvent(new EventCtor('studio:change', { detail: { project: clone(project), structural, fields: fields.slice() } }));
      } catch (error) {
        if (typeof console !== 'undefined') console.error(error);
      }
    }

    async function readProject(storage, id, warnings) {
      const raw = await storage.loadProject(id);
      if (!raw) throw new Error('its saved record is missing');
      const project = validateProject(raw, { id, repair: true, warnings });
      if (raw.schemaVersion !== SCHEMA_VERSION || hasOwn(raw.data || {}, 'haircuts') || hasOwn(raw.data || {}, 'beards') ||
          (Array.isArray(raw.data?.cells) && raw.data.cells.some(cell => hasOwn(cell, 'haircut') || hasOwn(cell, 'beard')))) {
        dataNeedsMigration.add(id);
      }
      summaries.set(id, summarize(project));
      return project;
    }

    function markDamaged(id) {
      const entry = summaries.get(id);
      if (entry) entry.damaged = true;
    }

    // Opens the active project, falling back to the most recent readable one.
    // Unreadable records are reported and left untouched.
    async function openSavedProject(storage, found) {
      const index = await storage.loadIndex();
      summaries = new Map();
      for (const record of Array.isArray(index.records) ? index.records : []) {
        if (isPlainObject(record) && typeof record.id === 'string' && record.id) summaries.set(record.id, storedSummary(record));
      }
      const order = Array.from(summaries.values()).sort(byRecent).map((entry) => entry.id);
      const activeId = typeof index.activeId === 'string' && summaries.has(index.activeId) ? index.activeId : null;
      if (activeId) {
        order.splice(order.indexOf(activeId), 1);
        order.unshift(activeId);
      }
      for (const id of order) {
        const warnings = [];
        let project;
        try {
          project = await readProject(storage, id, warnings);
        } catch (error) {
          markDamaged(id);
          found.push(`Saved project ${quote(summaries.get(id).title)} could not be opened (${reason(error)}); it was kept unchanged.`);
          continue;
        }
        if (warnings.length) found.push(`Some invalid details in ${quote(project.title)} were ignored while opening it.`);
        if (id !== activeId) {
          try { await storage.setActive(id); } catch (error) { /* opening still works; retried on next save */ }
        }
        return project;
      }
      return null;
    }

    function startingProject(matrixData, found) {
      const updatedAt = nowIso();
      const meta = isPlainObject(matrixData) && isPlainObject(matrixData.meta) ? matrixData.meta : {};
      const metaId = meta.id;
      const id = isValidId(metaId, LIMITS.projectId) && !summaries.has(metaId) ? metaId : freshId();
      try {
        // Relative demo paths are kept as-is; no image bytes are copied.
        return validateProject({
          schemaVersion: SCHEMA_VERSION,
          id,
          title: field(meta, 'title'),
          goal: field(meta, 'goal'),
          rowsLabel: field(meta, 'rowsLabel'),
          columnsLabel: field(meta, 'columnsLabel'),
          data: matrixData,
          decisions: {},
          favorites: [],
          lists: [],
          brief: {},
          updatedAt
        }, { id, updatedAt });
      } catch (error) {
        found.push(`The starting dataset could not be loaded (${reason(error)}); a blank project was started instead.`);
        return buildNewProject({ title: 'Untitled project', rows: ['Row 1'], columns: ['Column 1'] }, freshId());
      }
    }

    async function initialise(matrixData) {
      const found = [];
      let storage = options.backend || null;
      if (!storage) {
        try {
          storage = createIndexedDbBackend(await openDatabase(indexedDbFactory()));
        } catch (error) {
          storage = createMemoryBackend();
          found.push(`Browser storage is unavailable (${reason(error)}).`);
        }
      }
      let project = null;
      try {
        project = await openSavedProject(storage, found);
      } catch (error) {
        found.push(`Saved projects could not be read (${reason(error)}); they were left untouched.`);
        storage = createMemoryBackend();
        summaries = new Map();
      }
      if (!project) {
        project = startingProject(matrixData, found);
        try {
          await storage.commit(project, { makeActive: true, writeData: true });
        } catch (error) {
          found.push(`The starting project could not be saved (${reason(error)}).`);
          storage = createMemoryBackend();
          summaries = new Map();
          await storage.commit(project, { makeActive: true, writeData: true });
        }
        summaries.set(project.id, summarize(project));
      }
      backend = storage;
      current = project;
      notices = found;
      baseMessage = isPersistent()
        ? 'Projects are saved in this browser.'
        : 'Temporary session: changes last only until this tab closes. Export a project to keep it.';
      ready = true;
      return clone(current);
    }

    async function persist(next, { writeData, structural, fields }) {
      try {
        await backend.commit(next, { makeActive: true, writeData: writeData || dataNeedsMigration.has(next.id) });
        dataNeedsMigration.delete(next.id);
      } catch (error) {
        saveProblem = `Latest change was not saved (${reason(error)}). The previously saved version is still open.`;
        const failure = new Error(`Could not save ${quote(next.title)}: ${reason(error)}.`);
        failure.cause = error;
        throw failure;
      }
      saveProblem = '';
      if (structural) notices = [];
      current = next;
      summaries.set(next.id, summarize(next));
      emit(next, structural, fields);
      return clone(next);
    }

    function init(matrixData) {
      if (!initPromise) {
        initPromise = enqueue(() => initialise(matrixData));
        initPromise.catch(() => { initPromise = null; });
      }
      return initPromise;
    }

    function get() {
      return current ? clone(current) : null;
    }

    function list() {
      return Array.from(summaries.values()).sort(byRecent).map((entry) => {
        const item = { id: entry.id, title: entry.title, updatedAt: entry.updatedAt };
        if (current && entry.id === current.id) item.active = true;
        if (entry.damaged) item.damaged = true;
        return item;
      });
    }

    function update(patch) {
      return enqueue(async () => {
        requireReady();
        const changes = typeof patch === 'function' ? patch(clone(current)) : patch;
        if (!isPlainObject(changes)) throw new Error('update() needs an object with the fields to change.');
        const draft = Object.assign({}, current);
        const fields = [];
        for (const key of Object.keys(changes)) {
          if (PATCH_FIELDS.includes(key)) {
            draft[key] = changes[key];
            fields.push(key);
          } else if (key !== 'updatedAt' && !((key === 'id' || key === 'schemaVersion') && changes[key] === current[key])) {
            throw new Error(`update() cannot change "${key}".`);
          }
        }
        if (!fields.length) return clone(current);
        const dataChanged = fields.includes('data');
        const next = validateProject(draft, {
          id: current.id,
          updatedAt: nowIso(),
          trustedData: dataChanged ? null : current.data,
          dropStaleDecisions: dataChanged && !fields.includes('decisions'),
          dropStaleFavorites: dataChanged && !fields.includes('favorites'),
          dropStaleListMembers: dataChanged && !fields.includes('lists'),
          dropStaleAnnotations: dataChanged && !fields.includes('annotations')
        });
        return persist(next, { writeData: dataChanged, structural: false, fields });
      });
    }

    function create(spec) {
      return enqueue(async () => {
        requireReady();
        const next = buildNewProject(spec, freshId());
        return persist(next, { writeData: true, structural: true, fields: PATCH_FIELDS });
      });
    }

    function duplicate(title) {
      return enqueue(async () => {
        requireReady();
        const id = freshId();
        const name = typeof title === 'string' && title.trim() ? title : copyTitle(current.title);
        const next = validateProject(Object.assign({}, current, { id, title: name }), {
          id,
          updatedAt: nowIso(),
          trustedData: current.data
        });
        return persist(next, { writeData: true, structural: true, fields: PATCH_FIELDS });
      });
    }

    // Capture the selected checkpoint now; queued work must never follow a mutated
    // caller object or silently apply after a different project has become active.
    function restoreCopy(value, options = {}) {
      let captured, expectedProjectId, title;
      try {
        expectedProjectId = options.expectedProjectId;
        if (!isValidId(expectedProjectId, LIMITS.projectId)) throw new Error('Restore needs the expected active project ID.');
        captured = validateProject(value);
        if (captured.id !== expectedProjectId) throw new Error('This checkpoint belongs to a different project.');
        title = options.title === undefined ? copyTitle(captured.title) : options.title;
        if (typeof title !== 'string' || !cleanText(title, false).trim() || title.length > LIMITS.title) throw new Error('Use a project title of 1 to 120 characters.');
        // Validation constructs an owned canonical graph, including private notes.
        captured = clone(captured);
      } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        requireReady();
        if (current.id !== expectedProjectId) throw new Error('The active project changed. Reopen its history before restoring.');
        if (!isPersistent()) throw new Error('Browser storage is unavailable. Restore as a new project needs persistent storage.');
        const id = freshId();
        const next = validateProject(Object.assign({}, captured, { id, title }), { id, updatedAt: nowIso() });
        return persist(next, { writeData: true, structural: true, fields: PATCH_FIELDS });
      });
    }

    function activate(id) {
      return enqueue(async () => {
        requireReady();
        if (typeof id !== 'string' || !summaries.has(id)) throw new Error('That project does not exist in this browser.');
        if (id === current.id) return clone(current);
        const title = summaries.get(id).title;
        let next;
        const warnings = [];
        try {
          next = await readProject(backend, id, warnings);
        } catch (error) {
          markDamaged(id);
          throw new Error(`${quote(title)} could not be opened (${reason(error)}). It was left unchanged.`);
        }
        try {
          await backend.setActive(id);
        } catch (error) {
          saveProblem = `Switching projects was not saved (${reason(error)}).`;
          throw new Error(`Could not switch to ${quote(title)}: ${reason(error)}.`);
        }
        saveProblem = '';
        notices = warnings.length ? [`Some invalid details in ${quote(next.title)} were ignored while opening it.`] : [];
        current = next;
        emit(next, true, PATCH_FIELDS);
        return clone(next);
      });
    }

    function validate(value) {
      return validateProject(value, { generateMissingId: true });
    }

    function importProject(value) {
      return enqueue(async () => {
        requireReady();
        const id = freshId();
        const next = validateProject(value, { id, updatedAt: nowIso() });
        return persist(next, { writeData: true, structural: true, fields: PATCH_FIELDS });
      });
    }

    function status() {
      const parts = notices.slice(0, 3);
      if (notices.length > 3) parts.push(`${notices.length - 3} more storage notices.`);
      parts.push(saveProblem || baseMessage);
      return { persistent: ready && isPersistent(), message: parts.join(' ') };
    }

    return Object.freeze({
      init,
      get,
      list,
      update,
      create,
      duplicate,
      restoreCopy,
      activate,
      validate,
      importProject,
      status,
      validateData,
      checkAssetUrl: assetUrlProblem,
      limits: LIMITS
    });
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { createProjectStore, validateProject, validateData, assetUrlProblem, LIMITS, SCHEMA_VERSION };
  }
  root.ProjectStore = createProjectStore();
})(typeof window !== 'undefined' ? window : globalThis);
