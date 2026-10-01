// Run: node tests/project-store.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = path.join(__dirname, '..');

function loadStoreModule() {
  const module = { exports: {} };
  new Function('window', 'module', fs.readFileSync(path.join(core, 'project-store.js'), 'utf8'))({}, module);
  return module.exports;
}

const { createProjectStore, validateProject, assetUrlProblem } = loadStoreModule();

const png = (bytes) => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
const PNG = png([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]);
const JPEG_AS_PNG = png([0xff, 0xd8, 0xff, ...new Array(21).fill(0)]);
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, ...new Array(21).fill(0)]).toString('base64');
const WEBP = 'data:image/webp;base64,' + Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...new Array(12).fill(0)]).toString('base64');
const DEFAULT_DESIGN = { layout: 'detailed', accent: '#283d31', typography: 'editorial', logo: '', logoName: '' };

function sampleProject(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'source-project',
    title: 'Sample',
    goal: '',
    rowsLabel: 'Haircuts',
    columnsLabel: 'Beards',
    data: {
      rows: [{ id: 'crop', name: 'Crop', source: 'guides/crop.png' }, { id: 'quiff', name: 'Quiff' }],
      columns: [{ id: 'clean', name: 'Clean' }, { id: 'stubble', name: 'Stubble' }],
      cells: [
        { id: 'quiff--stubble', row: 'quiff', column: 'stubble', status: 'ready', src: PNG },
        { id: 'crop--clean', row: 'crop', column: 'clean', status: 'ready', src: 'assets/crop--clean.png' }
      ],
      meta: { id: 'whatever', ready: 99 }
    },
    decisions: { 'crop--clean': { status: 'shortlisted', note: 'Nice', privateNote: 'secret' } },
    favorites: ['crop--clean'],
    brief: { recipient: 'stylist' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function fakeDocument() {
  return { events: [], dispatchEvent(event) { this.events.push(event); return true; } };
}
class FakeEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

function fakeBackend(seed = {}) {
  const json = (value) => JSON.parse(JSON.stringify(value));
  const backend = {
    persistent: true,
    activeId: seed.activeId || null,
    fail: false,
    projects: new Map(Object.entries(seed.projects || {}).map(([id, value]) => [id, json(value)])),
    async loadIndex() {
      return { records: [...backend.projects.values()].map(({ data, ...meta }) => meta), activeId: backend.activeId };
    },
    async loadProject(id) { return backend.projects.has(id) ? json(backend.projects.get(id)) : undefined; },
    async commit(project, { makeActive, writeData }) {
      if (backend.fail) { const error = new Error('disk'); error.name = 'QuotaExceededError'; throw error; }
      const previous = backend.projects.get(project.id);
      const copy = json(project);
      if (!writeData && previous) copy.data = previous.data;
      backend.projects.set(project.id, copy);
      if (makeActive) backend.activeId = project.id;
    },
    async setActive(id) { if (backend.fail) throw new Error('disk'); backend.activeId = id; }
  };
  return backend;
}

function newStore(backend) {
  const document = fakeDocument();
  const options = { document, CustomEvent: FakeEvent };
  if (backend) options.backend = backend; else options.indexedDB = null;
  return { store: createProjectStore(options), document };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('validate sanitizes, completes the matrix and does not mutate input', () => {
  const input = sampleProject({ title: 'A\u0000b\u202Ec <img src=x onerror=alert(1)>', extra: 'dropped' });
  const before = JSON.stringify(input);
  const project = validateProject(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(project.title, 'A bc <img src=x onerror=alert(1)>');
  assert.equal(project.extra, undefined);
  assert.equal(project.data.cells.length, 4);
  assert.deepEqual(project.data.cells.map((cell) => cell.id), ['crop--clean', 'crop--stubble', 'quiff--clean', 'quiff--stubble']);
  assert.equal(project.data.cells[1].status, 'pending');
  assert.deepEqual(project.data.meta, { id: 'source-project', updatedAt: project.updatedAt, ready: 2, total: 4 });
  assert.deepEqual(project.brief, { recipient: 'stylist', recipientName: '', nextStep: '', brand: '', design: DEFAULT_DESIGN });
});

test('asset URLs: unsafe forms rejected, local paths and real data images accepted', () => {
  const unsafe = [
    'https://example.com/a.png', '//example.com/a.png', '/abs/a.png', 'C:/a.png', 'file:///a.png',
    'javascript:alert(1)', '../a.png', 'assets/../a.png', 'assets/%2e%2e/a.png', 'assets/%252e%252e/a.png',
    'assets/%E0%A4%A.png', 'assets\\a.png', 'assets/a.png?x=1', 'other/a.png', 'assets/a.svg', 'assets/.hidden.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGgxPg==', 'data:image/png;base64,####',
    'DATA:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA', JPEG_AS_PNG, ''
  ];
  for (const url of unsafe) assert.notEqual(assetUrlProblem(url), '', `should reject ${url}`);
  for (const url of ['assets/a.png', './guides/b.jpg', 'c.webp', 'assets/my%20photo.png', PNG]) {
    assert.equal(assetUrlProblem(url), '', `should accept ${url}`);
  }
  const bad = sampleProject();
  bad.data.cells[0].src = 'https://evil.test/x.png';
  assert.throws(() => validateProject(bad), /data\.cells\[0\]\.src: unsafe image URL/);
});

test('validate rejects bad structure, references and bounds', () => {
  const cases = [
    [(p) => { p.schemaVersion = 99; }, /schemaVersion/],
    [(p) => { p.data.cells[1].id = 'quiff--stubble'; }, /repeats the cell ID/],
    [(p) => { p.data.cells.push({ id: 'dup', row: 'crop', column: 'clean', status: 'pending' }); }, /same row and column/],
    [(p) => { p.data.cells[0].row = 'nope'; }, /unknown row/],
    [(p) => { p.data.cells[0].status = 'done'; }, /ready.*pending/],
    [(p) => { p.data.cells[0].src = undefined; }, /ready cell needs an image/],
    [(p) => { p.data.rows.push({ id: 'crop', name: 'Again' }); }, /repeats the ID/],
    [(p) => { p.data.rows[0].id = '__proto__'; }, /may only use/],
    [(p) => { p.decisions['ghost'] = { status: 'chosen' }; }, /does not exist/],
    [(p) => { p.decisions['crop--clean'].status = 'maybe'; }, /must be one of/],
    [(p) => { p.favorites = ['ghost']; }, /does not exist/],
    [(p) => { p.brief.recipient = 'boss'; }, /brief\.recipient/],
    [(p) => { p.title = 'x'.repeat(121); }, /longer than 120/],
    [(p) => { p.data.rows = Array.from({ length: 41 }, (_, i) => ({ id: `r${i}`, name: `R${i}` })); p.data.cells = []; p.decisions = {}; p.favorites = []; }, /more than 40/],
    [(p) => { p.data.rows = Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, name: `R${i}` })); p.data.columns = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `C${i}` })); p.data.cells = []; p.decisions = {}; p.favorites = []; }, /more than 400 cells/]
  ];
  for (const [mutate, pattern] of cases) {
    const project = sampleProject();
    mutate(project);
    assert.throws(() => validateProject(project), pattern);
  }
  assert.throws(() => validateProject('{not json'), /not valid JSON/);
});

test('volatile init reuses demo image paths without copying bytes', async () => {
  const window = {};
  new Function('window', fs.readFileSync(path.join(core, 'data.js'), 'utf8'))(window);
  const { store } = newStore();
  const project = await store.init(window.MATRIX_DATA);
  assert.equal(project.id, window.MATRIX_DATA.meta.id);
  assert.equal(project.data.cells.length, window.MATRIX_DATA.cells.length);
  assert.ok(project.data.cells.every((cell) => !cell.src || !cell.src.startsWith('data:')));
  const status = store.status();
  assert.equal(status.persistent, false);
  assert.match(status.message, /Temporary session/);
});

test('create builds a pending matrix with unique IDs; projects stay isolated', async () => {
  const { store, document } = newStore(fakeBackend());
  const demo = await store.init(sampleProject().data);
  const created = await store.create({ title: 'Glasses', rowsLabel: 'Frames', columnsLabel: 'Colours', rows: ['Round', 'round', '★'], columns: ['Black', 'Tortoise'] });
  assert.notEqual(created.id, demo.id);
  assert.deepEqual(created.data.rows.map((row) => row.id), ['round', 'round-2', 'row-3']);
  assert.equal(created.data.cells.length, 6);
  assert.ok(created.data.cells.every((cell) => cell.status === 'pending'));
  assert.equal(new Set(created.data.cells.map((cell) => cell.id)).size, 6);
  await store.update({ favorites: ['round--black'], goal: 'Pick frames' });
  assert.equal(document.events.at(-1).type, 'studio:change');
  assert.equal(document.events.at(-1).detail.structural, false);
  const back = await store.activate(demo.id);
  assert.deepEqual(back.favorites, []);
  assert.equal(back.goal, '');
  assert.equal(store.list().length, 2);
  const again = await store.activate(created.id);
  assert.deepEqual(again.favorites, ['round--black']);
  assert.equal(again.goal, 'Pick frames');
});

test('import always assigns a new ID; duplicate clones with a new ID', async () => {
  const { store } = newStore(fakeBackend());
  await store.init(sampleProject().data);
  const first = await store.importProject(JSON.stringify(sampleProject()));
  const second = await store.importProject(sampleProject());
  assert.notEqual(first.id, 'source-project');
  assert.notEqual(first.id, second.id);
  assert.equal(second.data.meta.id, second.id);
  assert.equal(second.decisions['crop--clean'].privateNote, 'secret');
  const copy = await store.duplicate();
  assert.notEqual(copy.id, second.id);
  assert.equal(copy.title, 'Sample (copy)');
  assert.equal(store.list().length, 4);
});

test('failed persistence keeps the current project and emits nothing', async () => {
  const backend = fakeBackend();
  const { store, document } = newStore(backend);
  await store.init(sampleProject().data);
  const before = store.get();
  const eventCount = document.events.length;
  backend.fail = true;
  await assert.rejects(store.update({ title: 'Lost?' }), /Could not save.*storage is full/);
  await assert.rejects(store.create({ rows: ['A'], columns: ['B'] }), /Could not save/);
  assert.deepEqual(store.get(), before);
  assert.equal(document.events.length, eventCount);
  assert.equal(store.list().length, 1);
  assert.match(store.status().message, /not saved/);
  backend.fail = false;
  assert.equal((await store.update({ title: 'Kept' })).title, 'Kept');
  assert.doesNotMatch(store.status().message, /not saved/);
});

test('invalid import and bad updates leave active work intact', async () => {
  const backend = fakeBackend();
  const { store } = newStore(backend);
  await store.init(sampleProject().data);
  const before = store.get();
  const bad = sampleProject();
  bad.data.cells[0].src = '../../secret.png';
  await assert.rejects(store.importProject(bad), /unsafe image URL/);
  await assert.rejects(store.update({ id: 'other' }), /cannot change "id"/);
  await assert.rejects(store.update({ favorites: ['ghost'] }), /does not exist/);
  assert.deepEqual(store.get(), before);
  assert.equal(backend.projects.size, 1);
});

test('overlapping updates are serialized without losing fields', async () => {
  const { store } = newStore(fakeBackend());
  await store.init(sampleProject().data);
  const cellId = store.get().data.cells[0].id;
  await Promise.all([
    store.update({ title: 'One' }),
    store.update({ goal: 'Two' }),
    store.update((project) => ({ favorites: [...project.favorites, cellId] })),
    store.update((project) => ({ decisions: { ...project.decisions, [cellId]: { status: 'chosen', note: '', privateNote: '' } } }))
  ]);
  const project = store.get();
  assert.equal(project.title, 'One');
  assert.equal(project.goal, 'Two');
  assert.deepEqual(project.favorites, [cellId]);
  assert.equal(project.decisions[cellId].status, 'chosen');
});

test('damaged saved project is reported and kept; a valid one opens', async () => {
  const good = validateProject(sampleProject({ id: 'good', title: 'Good', updatedAt: '2026-01-01T00:00:00.000Z' }));
  const broken = { schemaVersion: 2, id: 'broken', title: 'Broken', updatedAt: '2026-02-01T00:00:00.000Z', data: { rows: 'nope' } };
  const backend = fakeBackend({ projects: { good, broken }, activeId: 'broken' });
  const { store } = newStore(backend);
  const project = await store.init(sampleProject().data);
  assert.equal(project.id, 'good');
  assert.match(store.status().message, /"Broken" could not be opened/);
  assert.deepEqual(backend.projects.get('broken'), broken);
  assert.equal(store.list().find((item) => item.id === 'broken').damaged, true);
  await assert.rejects(store.activate('broken'), /could not be opened/);
  assert.equal(store.get().id, 'good');
});

const listFixture = (overrides = {}) => ({ id: 'list-one', name: 'One', cellIds: ['crop--clean'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides });
test('lists: legacy projects default empty; explicit overlap and independent copies survive validation', () => {
  assert.deepEqual(validateProject(sampleProject()).lists, []);
  const input = sampleProject({ lists: [listFixture(), listFixture({ id: 'list-two', name: 'Two' })] });
  const valid = validateProject(input);
  assert.deepEqual(valid.lists, input.lists);
  valid.lists[0].cellIds.push('quiff--stubble');
  assert.deepEqual(input.lists[0].cellIds, ['crop--clean']);
  assert.deepEqual(valid.lists[1].cellIds, ['crop--clean']);
});
test('lists: reject malformed identities, names, timestamps, bounds and unknown references', () => {
  const bad = [
    [listFixture(), listFixture()],
    [listFixture({ id: '../bad' })], [listFixture({ name: '' })], [listFixture({ name: 'a'.repeat(121) })],
    [listFixture({ createdAt: 'yesterday' })], [listFixture({ cellIds: ['unknown'] })],
    [listFixture({ cellIds: ['crop--clean', 'crop--clean'] })], [listFixture({ cellIds: Array(401).fill('crop--clean') })],
    Array.from({length:101}, (_, i) => listFixture({id:`list-${i}`}))
  ];
  for (const lists of bad) assert.throws(() => validateProject(sampleProject({lists})), /lists/);
});
test('lists: matrix edits prune removed references while retaining names and valid membership', async () => {
  const { store } = newStore(fakeBackend()); await store.init(sampleProject().data);
  await store.update({lists:[listFixture({cellIds:['crop--clean','quiff--stubble']})]});
  const data = store.get().data; data.rows = data.rows.filter(r=>r.id==='crop'); data.cells = data.cells.filter(c=>c.row==='crop');
  await store.update({data});
  assert.equal(store.get().lists[0].name,'One');assert.deepEqual(store.get().lists[0].cellIds,['crop--clean']);
});
test('lists: queued metadata writes retain stars and failed transactions never commit', async () => {
  const backend = fakeBackend(); const {store, document} = newStore(backend); await store.init(sampleProject().data);
  await Promise.all([store.update({lists:[listFixture()]}),store.update(p=>({favorites:[...p.favorites,'quiff--stubble']}))]);
  const before = store.get(); assert.equal(before.lists.length,1);assert.ok(before.favorites.includes('quiff--stubble'));
  backend.fail=true; await assert.rejects(store.update({lists:[]}),/disk|storage|full/i);assert.deepEqual(store.get(),before);
});

test('brief design: legacy and partial inputs receive independent defaults without mutation', () => {
  for (const brief of [undefined, {}, { recipient: 'client' }, { design: {} }]) {
    assert.deepEqual(validateProject(sampleProject({ brief })).brief.design, DEFAULT_DESIGN);
  }
  const input = sampleProject({ brief: { recipient: 'client', recipientName: 'Ana', nextStep: 'Discuss\noptions', brand: 'Studio', design: { accent: '#AABBCC' } } });
  const before = JSON.stringify(input);
  const validated = validateProject(input);
  assert.deepEqual(validated.brief.design, { ...DEFAULT_DESIGN, accent: '#aabbcc' });
  assert.equal(JSON.stringify(input), before);
  assert.equal(validated.brief.recipientName, 'Ana');
  assert.equal(validated.brief.nextStep, 'Discuss\noptions');
  assert.equal(validated.brief.brand, 'Studio');
  assert.equal(validated.schemaVersion, 2);
  validated.brief.design.layout = 'summary';
  assert.equal(validateProject(sampleProject()).brief.design.layout, 'detailed');
});

test('brief design: strict enums, types, hex colors and text bounds reject invalid present values', () => {
  for (const design of [null, [], 'summary', 2, false]) {
    assert.throws(() => validateProject(sampleProject({ brief: { design } })), /brief\.design: must be an object/);
  }
  const cases = {
    layout: ['', null, 1, 'Summary', 'grid'],
    typography: ['', null, {}, 'serif', 'Modern'],
    accent: ['', null, 3, '#abc', '#12345678', 'red', ' #abcdef', '#abcdeg', '#abcdef\n'],
    logo: [null, 4, {}, 'assets/logo.png', 'https://example.com/logo.png', '//host/logo.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', JPEG_AS_PNG, 'data:image/png;base64,####'],
    logoName: [null, 5, {}, 'x'.repeat(121)]
  };
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) {
      assert.throws(() => validateProject(sampleProject({ brief: { design: { [key]: value } } })), new RegExp(`brief\\.design\\.${key}`));
    }
  }
});

test('brief design: PNG JPEG WebP accepted; decoded 512 KiB boundary enforced precisely', () => {
  for (const logo of ['', PNG, JPEG, WEBP]) {
    assert.equal(validateProject(sampleProject({ brief: { design: { logo } } })).brief.design.logo, logo);
  }
  const sizedPng = (size) => {
    const bytes = Buffer.alloc(size);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    return png(bytes);
  };
  const exact = sizedPng(512 * 1024);
  assert.equal(validateProject(sampleProject({ brief: { design: { logo: exact } } })).brief.design.logo, exact);
  for (const size of [512 * 1024 + 1, 512 * 1024 + 3]) {
    assert.throws(() => validateProject(sampleProject({ brief: { design: { logo: sizedPng(size) } } })), /brief\.design\.logo:.*512 KiB/);
  }
  assert.equal(validateProject(sampleProject({ brief: { design: { logoName: 'A\u0000B\u202EC' } } })).brief.design.logoName, 'A BC');
  assert.equal(validateProject(sampleProject({ brief: { design: { logoName: 'x'.repeat(120) } } })).brief.design.logoName.length, 120);
});

test('brief design: repair warns per damaged field while retaining valid siblings and stored source', async () => {
  const input = sampleProject({ brief: { recipient: 'client', recipientName: 'Ana', nextStep: 'Keep me', brand: 'Studio', design: { layout: 'summary', accent: 'red', typography: null, logo: 'https://bad/logo.png', logoName: 'x'.repeat(121) } } });
  const before = JSON.stringify(input);
  const warnings = [];
  const repaired = validateProject(input, { repair: true, warnings });
  assert.deepEqual(repaired.brief.design, { ...DEFAULT_DESIGN, layout: 'summary', logoName: 'x'.repeat(120) });
  assert.equal(warnings.length, 4);
  for (const field of ['accent', 'typography', 'logo', 'logoName']) assert.ok(warnings.some(w => w.startsWith(`brief.design.${field}:`)));
  assert.equal(repaired.brief.nextStep, 'Keep me');
  assert.equal(JSON.stringify(input), before);
  const invalidObjectWarnings = [];
  assert.deepEqual(validateProject(sampleProject({ brief: { design: null } }), { repair: true, warnings: invalidObjectWarnings }).brief.design, DEFAULT_DESIGN);
  assert.equal(invalidObjectWarnings.length, 1);
  const backend = fakeBackend({ projects: { [input.id]: input }, activeId: input.id });
  const { store } = newStore(backend);
  await store.init(sampleProject().data);
  assert.deepEqual(store.get().brief.design, repaired.brief.design);
  assert.match(store.status().message, /invalid details/);
  assert.equal(JSON.stringify(backend.projects.get(input.id)), before);
});

test('brief design: JSON import, duplication and reload preserve design and old project content', async () => {
  const backend = fakeBackend();
  const { store } = newStore(backend);
  await store.init(sampleProject().data);
  const original = sampleProject({ lists: [listFixture()], brief: { recipient: 'client', recipientName: 'Ana', brand: 'Studio', nextStep: 'Meet tomorrow', design: { layout: 'summary', accent: '#abcdef', typography: 'modern', logo: WEBP, logoName: 'Studio mark' } } });
  const imported = await store.importProject(JSON.stringify(original));
  assert.deepEqual(imported.brief, original.brief);
  assert.deepEqual(validateProject(JSON.stringify(imported)), imported);
  const duplicate = await store.duplicate();
  assert.notEqual(duplicate.id, imported.id);
  for (const field of ['brief', 'lists', 'decisions', 'favorites']) assert.deepEqual(duplicate[field], imported[field]);
  const { store: reopened } = newStore(backend);
  assert.deepEqual((await reopened.init(sampleProject().data)).brief, original.brief);
  await reopened.update(p => ({ brief: { ...p.brief, nextStep: 'Updated', design: { ...p.brief.design, accent: '#112233' } } }));
  assert.equal((await reopened.activate(imported.id)).brief.design.accent, '#abcdef');
  assert.equal(reopened.get().brief.nextStep, 'Meet tomorrow');
});

test('brief design: failed persistence and validation keep committed state; queued writes recover', async () => {
  const backend = fakeBackend();
  const { store, document } = newStore(backend);
  await store.init(sampleProject().data);
  await store.update(p => ({ brief: { ...p.brief, design: { ...p.brief.design, logo: PNG, logoName: 'Original' } } }));
  const before = store.get();
  const events = document.events.length;
  backend.fail = true;
  await assert.rejects(store.update(p => ({ brief: { ...p.brief, design: { ...p.brief.design, accent: '#112233' } } })), /Could not save/);
  assert.deepEqual(store.get(), before);
  assert.deepEqual(backend.projects.get(before.id).brief, before.brief);
  assert.equal(document.events.length, events);
  backend.fail = false;
  await assert.rejects(store.update(p => ({ brief: { ...p.brief, design: { accent: 'invalid' } } })), /brief\.design\.accent/);
  await Promise.all([
    store.update(p => ({ brief: { ...p.brief, nextStep: 'Queued' } })),
    store.update(p => ({ brief: { ...p.brief, design: { ...p.brief.design, layout: 'summary' } } }))
  ]);
  assert.deepEqual(store.get().brief.design, { ...before.brief.design, layout: 'summary' });
  assert.equal(store.get().brief.nextStep, 'Queued');
  assert.doesNotMatch(store.status().message, /not saved/);
});

const pinFixture = (overrides = {}) => ({ id: 'pin-1', x: 0, y: 1, text: 'Keep this edge', ...overrides });

test('annotations: legacy default, normalized edge pins, plain text and independent nonmutating output', () => {
  assert.deepEqual(validateProject(sampleProject()).annotations, {});
  const input = sampleProject({ annotations: {
    'crop--clean': [pinFixture({ text: '<script>literal & text</script>\r\nA\u0000\u202eB', extra: true }), pinFixture({ id: 'pin-2', x: 1, y: 0, text: '' })],
    'quiff--stubble': [pinFixture({ text: 'x'.repeat(240) })]
  } });
  const before = JSON.stringify(input);
  const valid = validateProject(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(valid.annotations['crop--clean'], [pinFixture({ text: '<script>literal & text</script>\nAB' }), pinFixture({ id: 'pin-2', x: 1, y: 0, text: '' })]);
  assert.equal(valid.annotations['quiff--stubble'][0].text.length, 240);
  valid.annotations['crop--clean'][0].x = 0.5;
  assert.equal(input.annotations['crop--clean'][0].x, 0);
});

test('annotations: strict imports reject bad maps, IDs, text, references, nonfinite and out-of-range coordinates', () => {
  for (const annotations of [null, [], true, 'pins', { ghost: [] }, { 'crop--clean': {} }, JSON.parse('{"__proto__":[]}')]) {
    assert.throws(() => validateProject(sampleProject({ annotations })), /annotations/);
  }
  const badPins = [null, [], {}, pinFixture({ id: '__proto__' }), pinFixture({ id: 'bad id' }), pinFixture({ id: 'x'.repeat(81) }),
    ...[NaN, Infinity, -Infinity, -0.001, 1.001, '0.5', null, undefined].flatMap(value => [pinFixture({ x: value }), pinFixture({ y: value })]),
    ...[undefined, null, {}, 4, 'x'.repeat(241)].map(text => pinFixture({ text }))];
  for (const pin of badPins) {
    assert.throws(() => validateProject(sampleProject({ annotations: { 'crop--clean': [pin] } })), /annotations/);
  }
  assert.throws(() => validateProject(sampleProject({ annotations: { 'crop--clean': [pinFixture(), pinFixture()] } })), /repeats the annotation ID/);
  const eight = Array.from({ length: 8 }, (_, i) => pinFixture({ id: `pin-${i}` }));
  assert.equal(validateProject(sampleProject({ annotations: { 'crop--clean': eight } })).annotations['crop--clean'].length, 8);
  assert.throws(() => validateProject(sampleProject({ annotations: { 'crop--clean': [...eight, pinFixture({ id: 'pin-9' })] } })), /more than 8/);
});

test('annotations: total bound accepts 1000, rejects 1001 and repairs deterministically', () => {
  const input = sampleProject({ decisions: {}, favorites: [] });
  input.data.rows = Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
  input.data.columns = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Column ${i}` }));
  input.data.cells = [];
  const complete = validateProject(input);
  complete.annotations = Object.fromEntries(complete.data.cells.slice(0, 125).map(cell => [cell.id, Array.from({ length: 8 }, (_, i) => pinFixture({ id: `pin-${i}` }))]));
  assert.equal(Object.values(validateProject(complete).annotations).flat().length, 1000);
  complete.annotations[complete.data.cells[125].id] = [pinFixture()];
  assert.throws(() => validateProject(complete), /more than 1000/);
  const warnings = [];
  assert.equal(Object.values(validateProject(complete, { repair: true, warnings }).annotations).flat().length, 1000);
  assert.ok(warnings.some(w => /more than 1000/.test(w)));
});

test('annotations: damaged saved pins warn and preserve valid siblings, source and other project fields', async () => {
  const input = sampleProject({ annotations: {
    'crop--clean': [pinFixture(), pinFixture(), pinFixture({ id: 'bad-position', x: 2 }), pinFixture({ id: 'long-text', text: 'x'.repeat(241) }), pinFixture({ id: 'bad-text', text: null })],
    'quiff--stubble': 'bad', ghost: [pinFixture()]
  } });
  const before = JSON.stringify(input);
  const warnings = [];
  const repaired = validateProject(input, { repair: true, warnings });
  assert.deepEqual(repaired.annotations, { 'crop--clean': [pinFixture(), pinFixture({ id: 'long-text', text: 'x'.repeat(240) })] });
  assert.equal(warnings.length, 6);
  assert.equal(JSON.stringify(input), before);
  for (const annotations of [null, [], 'bad']) {
    const notices = [];
    assert.deepEqual(validateProject(sampleProject({ annotations }), { repair: true, warnings: notices }).annotations, {});
    assert.equal(notices.length, 1);
  }
  const oversized = Array.from({ length: 9 }, (_, i) => pinFixture({ id: `p-${i}` }));
  assert.equal(validateProject(sampleProject({ annotations: { 'crop--clean': oversized } }), { repair: true }).annotations['crop--clean'].length, 8);
  const backend = fakeBackend({ projects: { [input.id]: input }, activeId: input.id });
  const { store } = newStore(backend);
  await store.init(sampleProject().data);
  assert.deepEqual(store.get().annotations, repaired.annotations);
  assert.deepEqual(store.get().decisions, repaired.decisions);
  assert.match(store.status().message, /invalid details/);
  assert.equal(JSON.stringify(backend.projects.get(input.id)), before);
  await store.create({ title: 'Other', rows: ['Row'], columns: ['Column'] });
  await store.activate(input.id);
  assert.match(store.status().message, /invalid details/);
});

test('annotations: matrix edits prune removed cells; explicit invalid replacements fail atomically', async () => {
  const { store } = newStore(fakeBackend());
  await store.init(sampleProject().data);
  await store.update({ annotations: { 'crop--clean': [pinFixture()], 'quiff--stubble': [pinFixture()] }, lists: [listFixture()] });
  const before = store.get();
  const data = structuredClone(before.data);
  data.rows = data.rows.filter(row => row.id === 'crop');
  data.cells = data.cells.filter(cell => cell.row === 'crop');
  await assert.rejects(store.update({ data, annotations: before.annotations }), /does not exist/);
  assert.deepEqual(store.get(), before);
  const saved = await store.update({ data });
  assert.deepEqual(saved.annotations, { 'crop--clean': [pinFixture()] });
  assert.deepEqual(saved.lists, before.lists);
});

test('annotations: queued changes preserve metadata; failed persistence and invalid import leave committed content untouched', async () => {
  const backend = fakeBackend();
  const { store, document } = newStore(backend);
  await store.init(sampleProject().data);
  await store.importProject(sampleProject({ lists: [listFixture()] }));
  const before = store.get();
  const events = document.events.length;
  backend.fail = true;
  await assert.rejects(store.update({ annotations: { 'crop--clean': [pinFixture()] } }), /Could not save/);
  assert.deepEqual(store.get(), before);
  assert.deepEqual(backend.projects.get(before.id), before);
  assert.equal(document.events.length, events);
  backend.fail = false;
  await assert.rejects(store.importProject({ ...before, annotations: { ghost: [pinFixture()] } }), /does not exist/);
  assert.deepEqual(store.get(), before);
  await Promise.all([
    store.update(p => ({ annotations: { ...p.annotations, 'crop--clean': [pinFixture()] } })),
    store.update(p => ({ annotations: { ...p.annotations, 'quiff--stubble': [pinFixture({ text: 'Second' })] } })),
    store.update(p => ({ brief: { ...p.brief, nextStep: 'Queued next step' } }))
  ]);
  const after = store.get();
  assert.equal(Object.keys(after.annotations).length, 2);
  for (const field of ['data', 'decisions', 'favorites', 'lists']) {
    if (field === 'data') assert.deepEqual(after.data.cells, before.data.cells);
    else assert.deepEqual(after[field], before[field]);
  }
  assert.equal(after.brief.nextStep, 'Queued next step');
  assert.deepEqual(after.brief.design, before.brief.design);
  assert.deepEqual(document.events.at(-2).detail.fields, ['annotations']);
  assert.doesNotMatch(store.status().message, /not saved/);
});

test('annotations: portable embedding, JSON import, duplication and reload retain independent copies', async () => {
  const window = {};
  const document = { readyState: 'loading', addEventListener() {} };
  new Function('window', 'document', fs.readFileSync(path.join(core, 'portability.js'), 'utf8'))(window, document);
  const input = validateProject(sampleProject({ annotations: { 'crop--clean': [pinFixture({ text: '<img src=x> & "notes"' })] }, lists: [listFixture()] }));
  input.data.rows[0].source = PNG;
  input.data.cells.find(cell => cell.id === 'crop--clean').src = PNG;
  const before = JSON.stringify(input);
  const exported = await window.StudioPortability.embedProject(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(exported.annotations, input.annotations);
  exported.annotations['crop--clean'][0].x = 0.25;
  assert.equal(input.annotations['crop--clean'][0].x, 0);
  const backend = fakeBackend();
  const { store } = newStore(backend);
  await store.init(sampleProject().data);
  const imported = await store.importProject(JSON.stringify(exported));
  const duplicate = await store.duplicate();
  assert.notEqual(duplicate.id, imported.id);
  assert.deepEqual(duplicate.annotations, imported.annotations);
  duplicate.annotations['crop--clean'][0].text = 'External mutation';
  assert.equal(store.get().annotations['crop--clean'][0].text, '<img src=x> & "notes"');
  const { store: reopened } = newStore(backend);
  await reopened.init(sampleProject().data);
  assert.deepEqual(reopened.get().annotations, imported.annotations);
  await reopened.update(p => ({ annotations: { ...p.annotations, 'crop--clean': [pinFixture({ text: 'Changed copy' })] } }));
  await reopened.activate(imported.id);
  assert.deepEqual(reopened.get().annotations, imported.annotations);
  for (const field of ['brief', 'lists', 'decisions', 'favorites']) assert.deepEqual(reopened.get()[field], input[field]);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}\n`, error);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
})();

