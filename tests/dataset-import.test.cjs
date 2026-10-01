const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const importer = require('../dataset-import.js');
const {validateData, validateProject, createProjectStore} = require('../project-store.js');
const validator = {validateData, validate: value => validateProject(value, {generateMissingId: true})};
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]).toString('base64');
const WEBP = 'data:image/webp;base64,' + Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...new Array(12).fill(0)]).toString('base64');
const shapeData = () => ({
  meta: {title: 'Color and form', rowsLabel: 'Shape', columnsLabel: 'Color'},
  rows: [{id: 'circle', name: 'Circle'}, {id: 'square', name: 'Square'}],
  columns: [{id: 'red', name: 'Red'}, {id: 'blue', name: 'Blue'}],
  cells: [{id: 'circle-red', row: 'circle', column: 'red', status: 'ready', src: 'assets/circle-red.png'}]
});
test('quoted CSV preserves commas, escaped quotes, line breaks and BOM without executing content', () => {
  const records = importer.parseCSV('\uFEFFSKU,Product,Description,Price\r\nD1,"Copper, warm","A ""soft"" tone\r\nSecond line",14.5\r\nD2,"Blue","=SUM(A1:A2)",19\r\n');
  assert.deepEqual(records, [
    {SKU: 'D1', Product: 'Copper, warm', Description: 'A "soft" tone\nSecond line', Price: '14.5'},
    {SKU: 'D2', Product: 'Blue', Description: '=SUM(A1:A2)', Price: '19'}
  ]);
});
test('malformed CSV explains duplicate/empty headers, fields and unclosed or misplaced quotes', () => {
  for (const [csv, reason] of [
    ['name,Name\na,b', /repeats the header/], ['name,\na,b', /header 2 is empty/], ['a,b\nx', /record 1 has 1 fields/],
    ['name\n"unfinished', /no closing quote/], ['name\nhi"there', /quotes must start/], ['name\n"ok"no', /unexpected text/],
    ['name\n', /no records/], ['', /CSV is empty/], ['__proto__,name\nx,y', /reserved/]
  ]) assert.throws(() => importer.parseCSV(csv), reason);
  assert.throws(() => importer.parseCSV('name\n😀😀', {maxBytes: 10}), /300 MiB/);
});
test('JSON supports records, items and named table selection without assuming a domain', () => {
  const parsed = importer.parseInput(JSON.stringify({products: [{name: 'Copper'}], notes: ['not a table'], items: [{name: 'Blue'}]}), 'catalog.json');
  assert.equal(parsed.kind, 'records'); assert.deepEqual(parsed.tables.map(table => table.name), ['items', 'products']);
  const prepared = importer.prepareProject(parsed, {tableIndex: 1, title: 'Dyes'}, validator);
  assert.equal(prepared.project.title, 'Dyes'); assert.equal(prepared.project.data.rows[0].name, 'Copper');
  assert.equal(prepared.project.data.columns[0].name, 'Preview');
  assert.throws(() => importer.parseInput('{broken', 'catalog.json'), /not valid JSON/);
  assert.throws(() => importer.prepareProject(importer.parseInput('["no"]'), {}, validator), /must be an object/);
});
test('canonical shape data respects metadata, fills pending pairs and is not mutated', () => {
  const data = shapeData(), before = JSON.stringify(data);
  const reviewed = importer.prepareProject(importer.parseInput(before), {}, validator).project;
  assert.equal(JSON.stringify(data), before); assert.equal(reviewed.title, 'Color and form');
  assert.equal(reviewed.rowsLabel, 'Shape'); assert.equal(reviewed.columnsLabel, 'Color');
  assert.equal(reviewed.data.cells.length, 4); assert.equal(reviewed.data.meta.ready, 1);
  assert.equal(reviewed.data.cells[0].id, 'circle-red');
});
test('reviewed dataset imports preserve portable presentation defaults and reject invalid ones', () => {
  const data = {meta: {title: 'Color study'}, rows: [{id: 'shape', name: 'Circle'}], columns: [{id: 'color', name: 'Blue', attributes: {hex: '#507DB5'}}], cells: [{id: 'option', row: 'shape', column: 'color', status: 'ready', src: PNG}]};
  data.meta.presentation = {galleryFraming: 'focused', galleryGrouping: 'none', galleryDescriptions: false, metadataFields: ['column.hex'], galleryZoom: 1.6, galleryFocalX: 0.4, galleryFocalY: 0.6};
  const before = JSON.stringify(data), reviewed = importer.prepareProject(importer.parseInput(before), {}, validator).project;
  assert.deepEqual(reviewed.data.meta.presentation, data.meta.presentation);
  assert.deepEqual(validateProject(JSON.stringify(reviewed)).data.meta.presentation, data.meta.presentation);
  assert.equal(JSON.stringify(data), before);
  data.meta.presentation.galleryZoom = 4;
  assert.throws(() => importer.prepareProject(importer.parseInput(JSON.stringify(data)), {}, validator), /galleryZoom/);
});
test('legacy axis and cell names normalize only at the import boundary', () => {
  const parsed = importer.parseInput(JSON.stringify({haircuts: [{id: 'one', name: 'One'}], beards: [{id: 'two', name: 'Two'}],
    cells: [{id: 'legacy-option', haircut: 'one', beard: 'two', src: PNG}]}));
  const project = importer.prepareProject(parsed, {rowsLabel: 'Model', columnsLabel: 'Finish'}, validator).project;
  assert.deepEqual(project.data.cells[0], {id: 'legacy-option', row: 'one', column: 'two', status: 'ready', src: PNG});
  assert.equal(project.data.haircuts, undefined); assert.equal(project.data.beards, undefined);
});
test('product shade records map arbitrary fields into axes while retaining scalar specifications', () => {
  const records = [
    {sku: 'D-101', product: 'Permanent', shade: 'Copper', picture: 'assets/copper.webp', strength: 20, vegan: true, description: 'Warm finish'},
    {sku: 'D-102', product: 'Permanent', shade: 'Blue', picture: WEBP, strength: 10, vegan: false, description: 'Cool finish'},
    {sku: 'D-103', product: 'Temporary', shade: 'Blue', picture: '', strength: null, vegan: true, description: 'Trial shade'}
  ];
  const parsed = importer.parseInput(JSON.stringify(records));
  const reviewed = importer.prepareProject(parsed, {title: 'Dye shades', rowsLabel: 'Product', columnsLabel: 'Shade',
    mapping: {id: 'sku', row: 'product', column: 'shade', image: 'picture', description: 'description'}}, validator).project;
  assert.equal(reviewed.data.rows.length, 2); assert.equal(reviewed.data.columns.length, 2); assert.equal(reviewed.data.cells.length, 4);
  assert.equal(reviewed.data.meta.ready, 2); assert.equal(reviewed.data.cells[0].id, 'D-101');
  assert.deepEqual(reviewed.data.cells[0].attributes, {strength: 20, vegan: true});
  assert.equal(reviewed.data.cells[0].description, 'Warm finish');
  assert.equal(reviewed.data.cells.find(cell => cell.id === 'D-102').description, 'Cool finish');
  assert.equal(reviewed.data.cells.find(cell => cell.id === 'D-103').status, 'pending');
});
test('arbitrary mapped description fields stay per option and never become card specifications', () => {
  const records = [{name: 'Blue', prose: 'Keep <this> literal\nSecond line', price: 0}, {name: 'Blue', prose: 'A different proposal', price: 4}];
  const before = JSON.stringify(records);
  const project = importer.prepareProject(importer.parseInput(before), {mapping: {row: 'name', description: 'prose'}}, validator).project;
  assert.deepEqual(project.data.cells.map(cell => cell.description), records.map(record => record.prose));
  assert.deepEqual(project.data.cells.map(cell => cell.attributes), [{price: 0}, {price: 4}]);
  assert.ok(project.data.rows.every(row => !Object.hasOwn(row, 'description')));
  assert.equal(JSON.stringify(records), before);
  const structured = shapeData(); structured.cells[0].description = 'Only in expanded details';
  const imported = importer.prepareProject(importer.parseInput(JSON.stringify(structured)), {}, validator).project;
  assert.equal(imported.data.cells[0].description, structured.cells[0].description);
  assert.equal(imported.data.cells[0].attributes, undefined);
});
test('one Preview column keeps each record distinct even when names repeat', () => {
  const data = importer.mapRecords([{id: 'a', name: 'Blue'}, {id: 'b', name: 'Blue'}], {id: 'id', row: 'name'});
  assert.equal(data.rows.length, 2); assert.equal(data.rows[0].name, data.rows[1].name); assert.notEqual(data.rows[0].id, data.rows[1].id);
  assert.deepEqual(data.cells.map(cell => cell.id), ['a', 'b']);
});
test('duplicate IDs, unsafe IDs and duplicate row/variant pairs fail clearly', () => {
  assert.throws(() => importer.mapRecords([{id: 'a', name: 'One'}, {id: 'a', name: 'Two'}], {id: 'id', row: 'name'}), /repeats the ID/);
  assert.throws(() => importer.mapRecords([{id: '../a', name: 'One'}], {id: 'id', row: 'name'}), /unsafe ID/);
  assert.throws(() => importer.mapRecords([{name: 'One', color: 'Blue'}, {name: 'One', color: 'Blue'}], {row: 'name', column: 'color'}), /repeats the row\/column pair/);
  assert.throws(() => importer.mapRecords([{name: 'One', color: ''}], {row: 'name', column: 'color'}), /empty column\/variant/);
});
test('nested fields and malformed attribute maps require flattening instead of silent loss', () => {
  assert.throws(() => importer.mapRecords([{name: 'Copper', specs: {strength: 20}}], {row: 'name'}), /specs.*nested data/);
  assert.throws(() => importer.mapRecords([{name: 'Copper', colors: ['red']}], {row: 'name'}), /Flatten/);
  const data = shapeData(); data.cells[0].specs = {material: 'paper'};
  assert.throws(() => importer.normalizeStructured(data), /specs contains nested data/);
  delete data.cells[0].specs; data.cells[0].attributes = ['invalid'];
  assert.throws(() => importer.normalizeStructured(data), /attributes must be an object/);
});
test('extra structured specifications are retained as bounded attributes', () => {
  const data = shapeData(); data.rows[0].material = 'Paper'; data.cells[0].finish = 'Matte'; data.meta.maker = 'Local';
  const project = importer.prepareProject(importer.parseInput(JSON.stringify(data)), {}, validator).project;
  assert.equal(project.data.rows[0].attributes.material, 'Paper');
  assert.deepEqual(project.data.cells[0].attributes, {finish: 'Matte', 'meta.maker': 'Local'});
});
test('axis, cell-grid, record and path limits are enforced before any import', () => {
  assert.throws(() => importer.mapRecords(Array.from({length: 41}, (_, i) => ({name: `Item ${i}`})), {row: 'name'}), /at most 40 rows/);
  const records = Array.from({length: 21}, (_, i) => ({name: `Item ${i}`, variant: `Shade ${i}`}));
  assert.throws(() => importer.mapRecords(records, {row: 'name', column: 'variant'}), /441 slots/);
  assert.throws(() => importer.recordFields(Array.from({length: 401}, () => ({name: 'item'}))), /400 records/);
  for (const src of ['https://example.com/image.png', '../image.png', '/tmp/image.png', 'other/image.png', 'assets/a.svg', 'assets/' + 'a'.repeat(270) + '.png']) {
    const data = shapeData(); data.cells[0].src = src;
    assert.throws(() => importer.prepareProject(importer.parseInput(JSON.stringify(data)), {}, validator), /unsafe image URL/);
  }
});
test('selected local images bind by basename across axes and cells without fetching', () => {
  const data = shapeData(); data.rows[0].source = 'guides/circle.png'; data.cells[0].detail = 'circle.png';
  const before = JSON.stringify(data);
  const result = importer.prepareProject(importer.parseInput(before), {images: [{name: 'circle.png', dataUrl: PNG}, {name: 'circle-red.png', dataUrl: PNG}, {name: 'unused.webp', dataUrl: WEBP}]}, validator);
  assert.equal(result.project.data.rows[0].source, PNG); assert.equal(result.project.data.cells[0].src, PNG); assert.equal(result.project.data.cells[0].detail, PNG);
  assert.deepEqual(result.unusedImages, ['unused.webp']); assert.equal(JSON.stringify(data), before);
  assert.throws(() => importer.embedImages(data, [{name: 'same.png', dataUrl: PNG}, {name: 'same.png', dataUrl: PNG}]), /Two selected images/);
  const unsafe = shapeData(); unsafe.cells[0].src = 'https://example.com/circle-red.png';
  assert.throws(() => importer.prepareProject(importer.parseInput(JSON.stringify(unsafe)), {images: [{name: 'circle-red.png', dataUrl: PNG}]}, validator), /unsafe image URL/);
});
test('embedded image bytes are validated after binding, including spoofed MIME data', () => {
  const parsed = importer.parseInput(JSON.stringify(shapeData()));
  assert.throws(() => importer.prepareProject(parsed, {images: [{name: 'circle-red.png', dataUrl: 'data:image/png;base64,' + Buffer.from('not an image at all').toString('base64')}]}, validator), /not a PNG image|not valid base64/);
});
test('a complete project keeps evaluations, favorites, lists, annotations and private notes', () => {
  const full = validateProject({schemaVersion: 2, id: 'original', title: 'Reviewed shapes', rowsLabel: 'Shape', columnsLabel: 'Color', data: shapeData(),
    decisions: {'circle-red': {status: 'chosen', note: 'Best', privateNote: 'Private'}}, favorites: ['circle-red'],
    lists: [{id: 'keepers', name: 'Keepers', cellIds: ['circle-red'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}], annotations: {'circle-red': [{id: 'pin-1', x: 0.2, y: 0.3, text: 'Edge'}]}});
  const reviewed = importer.prepareProject(importer.parseInput(JSON.stringify(full)), {}, validator).project;
  assert.deepEqual(reviewed.decisions, full.decisions); assert.deepEqual(reviewed.favorites, full.favorites);
  assert.deepEqual(reviewed.lists, full.lists); assert.deepEqual(reviewed.annotations, full.annotations);
});
function backend() {
  const projects = new Map();
  return {persistent: true, fail: false, activeId: null, projects,
    async loadIndex() { return {records: [...projects.values()].map(({data, ...rest}) => rest), activeId: this.activeId}; },
    async loadProject(id) { return projects.get(id); },
    async commit(project, {makeActive}) { if (this.fail) throw new Error('Quota exceeded'); projects.set(project.id, JSON.parse(JSON.stringify(project))); if (makeActive) this.activeId = project.id; },
    async setActive(id) { this.activeId = id; }};
}
test('malformed data and failed storage leave the current project and evaluations intact', async () => {
  const storage = backend(), store = createProjectStore({backend: storage, document: null});
  const initial = shapeData(); initial.meta.title = 'Current';
  await store.init(initial); await store.update({decisions: {'circle-red': {status: 'chosen', note: 'Keep this', privateNote: 'Personal'}}});
  const before = JSON.stringify(store.get()), active = storage.activeId, count = storage.projects.size;
  const parsed = importer.parseInput(JSON.stringify([{id: 'new', name: 'Copper', image: PNG}]));
  const reviewed = importer.prepareProject(parsed, {title: 'New shades'}, store).project;
  assert.equal(JSON.stringify(store.get()), before, 'review is read only');
  storage.fail = true; await assert.rejects(importer.importReviewed(store, reviewed), /Quota|Saving|saved/i);
  assert.equal(JSON.stringify(store.get()), before); assert.equal(storage.activeId, active); assert.equal(storage.projects.size, count);
  await assert.rejects(importer.importReviewed(store, {...reviewed, data: {rows: []}}), /data.rows/);
  assert.equal(JSON.stringify(store.get()), before);
});
test('a reviewed dataset is added as a new project and retains the old one', async () => {
  const storage = backend(), store = createProjectStore({backend: storage, document: null});
  const initial = shapeData(); initial.meta.title = 'Current'; await store.init(initial);
  const original = store.get();
  const reviewed = importer.prepareProject(importer.parseInput('[{"name":"Copper"}]'), {title: 'New shades'}, store).project;
  const loaded = await importer.importReviewed(store, reviewed);
  assert.notEqual(loaded.id, original.id); assert.equal(store.get().title, 'New shades'); assert.equal(storage.projects.get(original.id).title, 'Current');
});

function mountedImporter() {
  const nodes = [], ids = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = new Map(); this.files = []; this.value = ''; this.hidden = false;
      this.classList = {toggle() {}}; nodes.push(this); }
    set id(value) { this._id = value; ids.set(value, this); } get id() { return this._id; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    async emit(type) { return this.listeners.get(type)?.({type, target: this}); }
  }
  const document = {createElement: tag => new Element(tag)};
  let imported = 0, reloaded = 0;
  const requests = [];
  const root = {document, location: {search: '', reload() { reloaded++; }}, ProjectStore: {...validator,
    status: () => ({persistent: true}), async importProject(project) { imported++; return project; }},
    async fetch(url) { requests.push(url); return {ok: true, async text() { return JSON.stringify(shapeData()); }}; }};
  const context = vm.createContext({window: root, URLSearchParams});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dataset-import.js'), 'utf8'), context);
  const container = new Element('div'); root.DatasetImport.mount(container);
  return {root, ids, nodes, container, requests, imported: () => imported, reloaded: () => reloaded,
    button: name => nodes.find(node => node.tag === 'button' && node.textContent === name)};
}
test('browser mount reviews a source first, disables stale previews and imports only on explicit load', async () => {
  const ui = mountedImporter(), file = ui.ids.get('ds-file');
  file.files = [{name: 'dyes.csv', size: 70, async text() { return 'sku,name,image\nD-1,Copper,assets/copper.png'; }}];
  await file.emit('change');
  assert.equal(ui.imported(), 0); assert.equal(ui.button('Load as new project').disabled, false);
  ui.ids.get('ds-title').value = 'New name'; await ui.ids.get('ds-title').emit('input');
  assert.equal(ui.button('Load as new project').disabled, true);
  await ui.button('Review dataset').emit('click'); await ui.button('Load as new project').emit('click');
  assert.equal(ui.imported(), 1); assert.equal(ui.reloaded(), 1);
});
test('example buttons open a preview without modifying saved projects', async () => {
  const ui = mountedImporter(); await ui.button('Color and form').emit('click');
  assert.deepEqual(ui.requests, ['examples/color-form.json']);
  assert.equal(ui.imported(), 0); assert.equal(ui.button('Load as new project').disabled, false);
});
