const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectStore, validateProject, validateData, SCHEMA_VERSION } = require('../project-store.js');
const clone = value => JSON.parse(JSON.stringify(value));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA';
const TIME = '2026-10-01T08:00:00.000Z';

function legacyProject() {
  return {
    schemaVersion: 1, id: 'old-project', title: 'My comparison', goal: 'Choose a shade',
    rowsLabel: 'Shapes', columnsLabel: 'Palettes', updatedAt: TIME,
    data: {
      haircuts: [{ id: 'shape-a', name: 'Soft shape', source: 'guides/shape-a.png', referenceCaption: 'My reference', description: 'Rounded', attributes: { material: 'neoprene', stretch: true } }],
      beards: [{ id: 'blue', name: 'Blue palette', source: 'guides/blue.png', referenceCaption: 'Blue reference', description: 'Muted', attributes: { saturation: 0.4 } }, { id: 'red', name: 'Red palette' }],
      cells: [{ id: 'my-choice', haircut: 'shape-a', beard: 'blue', status: 'ready', src: PNG, detail: 'assets/blue-detail.png', attributes: { tone: 'loyal', score: 8, washable: true, alternative: null } }],
      meta: { id: 'old-project', title: 'Seed title', goal: 'Seed goal', rowsLabel: 'Seed shapes', columnsLabel: 'Seed colours', updatedAt: TIME, ready: 999, total: 999 }
    },
    decisions: { 'my-choice': { status: 'shortlisted', note: 'Keep the black crown', privateNote: 'Fits my preferences' } },
    favorites: ['my-choice'],
    lists: [{ id: 'options', name: 'Next visit', cellIds: ['my-choice'], createdAt: TIME, updatedAt: TIME }],
    annotations: { 'my-choice': [{ id: 'pin', x: 0.2, y: 0.3, text: 'Blue inner ear' }] },
    brief: { recipient: 'general', recipientName: 'Maker', nextStep: 'Review materials', brand: 'Personal', design: { layout: 'summary', typography: 'modern', accent: '#164e83', logo: PNG, logoName: 'Mark' } }
  };
}

function assertCanonical(value) {
  if (Array.isArray(value)) return value.forEach(assertCanonical);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['haircuts', 'beards', 'haircut', 'beard'].includes(key), `legacy property ${key}`);
    assertCanonical(child);
  }
}

function backendFor(project) {
  const backend = {
    persistent: true, fail: false, activeId: project?.id || null, writes: [],
    projects: new Map(project ? [[project.id, clone(project)]] : []),
    async loadIndex() { return { records: [...this.projects.values()].map(({ data, ...meta }) => meta), activeId: this.activeId }; },
    async loadProject(id) { return clone(this.projects.get(id)); },
    async setActive(id) { this.activeId = id; },
    async commit(project, options) {
      if (this.fail) throw new Error('disk full');
      const next = clone(project), previous = this.projects.get(project.id);
      if (!options.writeData && previous) next.data = previous.data;
      this.projects.set(project.id, next); this.activeId = project.id;
      this.writes.push({ id: project.id, ...options });
    }
  };
  return backend;
}

test('schema 1 migrates into schema 2 without changing IDs, images or review metadata', () => {
  const input = legacyProject(), before = clone(input), migrated = validateProject(input);
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(input, before);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, input.id);
  assert.deepEqual(migrated.data.rows, input.data.haircuts);
  assert.deepEqual(migrated.data.columns, input.data.beards);
  assert.deepEqual(migrated.data.cells[0], { id: 'my-choice', row: 'shape-a', column: 'blue', status: 'ready', src: PNG, detail: 'assets/blue-detail.png', attributes: input.data.cells[0].attributes });
  assert.deepEqual(migrated.data.cells[1], { id: 'shape-a--red', row: 'shape-a', column: 'red', status: 'pending' });
  assert.deepEqual(migrated.data.meta, { ...input.data.meta, ready: 1, total: 2 });
  for (const key of ['title', 'goal', 'rowsLabel', 'columnsLabel', 'decisions', 'favorites', 'lists', 'annotations', 'brief', 'updatedAt']) assert.deepEqual(migrated[key], input[key], key);
  assertCanonical(migrated);
  assert.deepEqual(validateProject(JSON.stringify(migrated)), migrated);
});

test('raw generic and legacy datasets use one importer boundary and independent scalar metadata', () => {
  const input = legacyProject().data, normalized = validateData(input);
  assertCanonical(normalized);
  const generic = { rows: normalized.rows, columns: normalized.columns, cells: normalized.cells, meta: normalized.meta };
  assert.deepEqual(validateData(generic), normalized);
  normalized.rows[0].attributes.material = 'External edit';
  normalized.columns[0].attributes.saturation = 1;
  normalized.cells[0].attributes.score = 0;
  assert.equal(input.haircuts[0].attributes.material, 'neoprene');
  assert.equal(input.beards[0].attributes.saturation, 0.4);
  assert.equal(input.cells[0].attributes.score, 8);
});

test('cell descriptions validate as plain text while older description metadata stays byte compatible', () => {
  const input = legacyProject(); input.data.cells[0].description = '<img src=x onerror=alert(1)>\r\nA\u0000\u202eB';
  const normalized = validateProject(input);
  assert.equal(normalized.data.cells[0].description, '<img src=x onerror=alert(1)>\nAB');
  assert.deepEqual(validateProject(JSON.stringify(normalized)), normalized);
  for (const description of ['x'.repeat(1001), {}, true]) {
    const invalid = clone(input); invalid.data.cells[0].description = description;
    assert.throws(() => validateProject(invalid), /data\.cells\[0\]\.description/);
  }
  const older = validateProject(legacyProject()); older.data.cells[0].attributes.description = 'Existing imported prose';
  const before = JSON.stringify(older);
  assert.equal(JSON.stringify(validateProject(older)), before, 'old canonical payloads stay valid without rewriting description attributes');
  assert.equal(JSON.stringify(older), before);
});

test('generic starters use dataset metadata and neutral defaults, including raw legacy data', async () => {
  const source = legacyProject().data;
  const store = createProjectStore({ indexedDB: null, document: null });
  const started = await store.init(source);
  assert.equal(started.title, source.meta.title);
  assert.equal(started.goal, source.meta.goal);
  assert.equal(started.rowsLabel, source.meta.rowsLabel);
  assert.equal(started.columnsLabel, source.meta.columnsLabel);
  assertCanonical(started);
  const blankMeta = clone(source); delete blankMeta.meta;
  const neutral = await createProjectStore({ indexedDB: null, document: null }).init(blankMeta);
  assert.equal(neutral.title, 'Untitled project');
  assert.equal(neutral.goal, '');
  assert.equal(neutral.rowsLabel, 'Rows');
  assert.equal(neutral.columnsLabel, 'Columns');
});

test('create accepts domain-neutral axis references and attributes, preserving pending structure', async () => {
  const store = createProjectStore({ indexedDB: null, document: null });
  await store.init();
  const project = await store.create({ title: 'Hair dyes', rowsLabel: 'Products', columnsLabel: 'Shades', rows: [{ name: 'Product A', source: 'guides/product.png', referenceCaption: 'Ingredient chart', attributes: { ammoniaFree: true } }], columns: [{ name: 'Blue', source: 'guides/blue.png', referenceCaption: 'Colour sample', attributes: { hex: '#164e83' } }] });
  assertCanonical(project);
  assert.equal(project.data.rows[0].source, 'guides/product.png');
  assert.equal(project.data.columns[0].source, 'guides/blue.png');
  assert.equal(project.data.columns[0].referenceCaption, 'Colour sample');
  assert.deepEqual(project.data.rows[0].attributes, { ammoniaFree: true });
  assert.deepEqual(project.data.cells, [{ id: 'product-a--blue', row: 'product-a', column: 'blue', status: 'pending' }]);
});

test('detail images, column references and attribute maps retain validation and bounds', () => {
  const attempts = [
    data => { data.cells[0].detail = 'https://example.com/detail.png'; },
    data => { data.beards[0].source = '../secret.png'; },
    data => { data.beards[0].referenceCaption = 'x'.repeat(201); },
    data => { data.cells[0].attributes = { nested: {} }; },
    data => { data.haircuts[0].attributes = { array: [] }; },
    data => { data.cells[0].attributes = { infinite: Infinity }; },
    data => { data.cells[0].attributes = { tooLong: 'x'.repeat(1001) }; },
    data => { data.cells[0].attributes = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`key${i}`, i])); },
    data => { data.cells[0].attributes = JSON.parse('{"__proto__":"bad"}'); },
    data => { data.meta.rowsLabel = 'x'.repeat(61); }
  ];
  for (const mutate of attempts) {
    const data = legacyProject().data; mutate(data);
    assert.throws(() => validateData(data), { name: 'ProjectValidationError' });
  }
});

test('optional presentation metadata survives canonical, legacy and JSON project round trips', () => {
  const input = legacyProject();
  input.data.meta.presentation = {galleryFraming: 'focused', galleryGrouping: 'column', galleryDescriptions: true, metadataFields: ['row.material', 'column.saturation', 'cell.score'], galleryZoom: 2, galleryFocalX: 0.25, galleryFocalY: 0.75};
  const before = clone(input), normalized = validateProject(input);
  assert.deepEqual(normalized.data.meta.presentation, input.data.meta.presentation);
  assert.deepEqual(validateData(normalized.data).meta.presentation, input.data.meta.presentation);
  assert.deepEqual(validateProject(JSON.stringify(normalized)), normalized);
  normalized.data.meta.presentation.metadataFields.push('cell.tone');
  assert.deepEqual(input, before);
  const hidden = clone(input); hidden.data.meta.presentation.metadataFields = [];
  assert.deepEqual(validateProject(hidden).data.meta.presentation.metadataFields, []);
  const automatic = clone(input); automatic.data.meta.presentation.metadataFields = null;
  assert.equal(validateProject(automatic).data.meta.presentation.metadataFields, null);
  assert.equal(Object.hasOwn(validateProject(legacyProject()).data.meta, 'presentation'), false);
});

test('presentation metadata rejects unsupported fields, unsafe keys and invalid crop bounds', () => {
  const invalid = [
    {galleryFraming: 'portrait'}, {galleryGrouping: 'all'}, {galleryDescriptions: 'yes'}, {galleryDescriptions: 1}, {galleryDescriptions: null}, {galleryZoom: 0.9}, {galleryZoom: 3.1},
    {galleryFocalX: -0.1}, {galleryFocalY: 1.1}, {galleryFocalX: Infinity},
    {metadataFields: ['unknown.material']}, {metadataFields: ['row.material', 'row.material']},
    {metadataFields: ['cell.']}, {metadataFields: ['row.' + 'x'.repeat(101)]},
    {metadataFields: Array.from({length: 33}, (_, i) => `cell.field${i}`)},
    {layout: 'favorites'}, {matrixLeft: 400}, {unknown: true}
  ];
  for (const presentation of invalid) {
    const input = legacyProject(); input.data.meta.presentation = presentation;
    assert.throws(() => validateProject(input), {name: 'ProjectValidationError'}, JSON.stringify(presentation));
  }
});

test('first metadata save migrates a legacy disk matrix atomically and retries after failure', async () => {
  const original = legacyProject(), backend = backendFor(original);
  const store = createProjectStore({ backend, document: null });
  await store.init();
  assertCanonical(store.get());
  assert.deepEqual(backend.projects.get(original.id), original);
  const before = store.get(); backend.fail = true;
  await assert.rejects(store.update({ goal: 'New goal' }), /Could not save/);
  assert.deepEqual(store.get(), before);
  assert.deepEqual(backend.projects.get(original.id), original);
  backend.fail = false;
  const saved = await store.update({ goal: 'New goal' });
  assert.equal(backend.writes[0].writeData, true);
  assertCanonical(backend.projects.get(original.id));
  assert.equal(saved.decisions['my-choice'].privateNote, original.decisions['my-choice'].privateNote);
  await store.update({ goal: 'Later goal' });
  assert.equal(backend.writes[1].writeData, false);
  const reloaded = createProjectStore({ backend, document: null }); await reloaded.init();
  assert.deepEqual(reloaded.get(), store.get());
});
