const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const links = require('../source-links.js');
const {createProjectStore, validateData, validateProject} = require('../project-store.js');
const importer = require('../dataset-import.js');
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]).toString('base64');
const dataFixture = () => ({
  rows: [{id: 'item', name: 'Example item', sourceUrl: 'https://EXAMPLE.com/products/item', attributes: {material: 'cotton'}}],
  columns: [{id: 'red', name: 'Red'}, {id: 'blue', name: 'Blue'}],
  cells: [
    {id: 'item-red', row: 'item', column: 'red', status: 'ready', src: PNG, sourceUrl: 'https://example.com/products/item?variant=red', attributes: {price: 30}},
    {id: 'item-blue', row: 'item', column: 'blue', status: 'pending'}
  ]
});
const projectFixture = () => ({schemaVersion: 2, id: 'source-project', title: 'Example products', data: dataFixture()});
const validator = {validate: validateProject, validateData};

test('source links normalize safe absolute HTTP(S) URLs and resolve variant overrides', () => {
  assert.equal(links.problem('https://EXAMPLE.com:443/products/item?variant=red#details'), '');
  assert.equal(links.normalize('https://EXAMPLE.com:443/products/item?variant=red#details'), 'https://example.com/products/item?variant=red#details');
  assert.equal(links.normalize('http://example.com'), 'http://example.com/');
  const row = {sourceUrl: 'https://example.com/products/item'};
  assert.equal(links.resolve({sourceUrl: 'https://example.com/products/item?variant=red'}, row), 'https://example.com/products/item?variant=red');
  assert.equal(links.resolve({}, row), row.sourceUrl);
  assert.equal(links.resolve({sourceUrl: 'javascript:alert(1)'}, row), row.sourceUrl);
  assert.equal(links.resolve({sourceUrl: 'javascript:alert(1)'}, {sourceUrl: 'data:text/html,bad'}), '');
  assert.equal(links.resolve(null, null), '');
});

test('source links reject executable, local, relative, credentialed and ambiguous URLs', () => {
  const invalid = [undefined, null, 1, {}, '', '/products/item', 'products/item', '//example.com/item',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/item', 'ftp://example.com/item',
    'https:example.com/item', 'https:///example.com/item', 'https://', 'https://user@example.com/item',
    'https://user:secret@example.com/item', 'https://@example.com/item', 'https://example.com@evil.test/item',
    'https://example.com\\@evil.test/item', 'https://example.com/\nitem', 'https://example.com/\u0000item',
    'https://example.com/\u0085item', 'https://example.com/\u202eitem', 'https://example.com/%0aitem',
    ' https://example.com/item', 'https://example.com/item ', 'https://example.com/' + 'a'.repeat(2048)];
  for (const value of invalid) {
    assert.notEqual(links.problem(value), '', `should reject ${String(value)}`);
    assert.equal(links.normalize(value), '');
  }
  const exact = 'https://example.com/' + 'a'.repeat(2048 - 'https://example.com/'.length);
  assert.equal(links.normalize(exact), exact);
  assert.notEqual(links.problem('https://example.com/' + 'é'.repeat(500)), '', 'canonical encoded length is bounded too');
});

test('validated row and cell links survive completion and JSON export without becoming attributes', () => {
  const input = dataFixture(), before = JSON.stringify(input);
  const valid = validateData(input);
  assert.equal(valid.rows[0].sourceUrl, 'https://example.com/products/item');
  assert.equal(valid.cells[0].sourceUrl, input.cells[0].sourceUrl);
  assert.equal(links.resolve(valid.cells[1], valid.rows[0]), valid.rows[0].sourceUrl);
  assert.deepEqual(valid.rows[0].attributes, {material: 'cotton'});
  assert.deepEqual(valid.cells[0].attributes, {price: 30});
  assert.equal(JSON.stringify(input), before);
  const project = validateProject(projectFixture());
  assert.deepEqual(validateProject(JSON.stringify(project)).data, project.data);
});

test('strict validation rejects unsafe source fields while repair drops only damaged fields with warnings', () => {
  for (const bad of ['javascript:alert(1)', 'https://user:secret@example.com', 12, 'https://example.com/' + 'a'.repeat(2048)]) {
    for (const target of ['rows', 'cells']) {
      const input = projectFixture(); input.data[target][0].sourceUrl = bad;
      assert.throws(() => validateProject(input), new RegExp(`data\\.${target}\\[0\\]\\.sourceUrl: unsafe source URL`));
    }
  }
  const input = projectFixture(); input.data.cells[0].sourceUrl = 'javascript:alert(1)';
  const before = JSON.stringify(input), warnings = [];
  const repaired = validateProject(input, {repair: true, warnings});
  assert.equal(repaired.data.cells[0].sourceUrl, undefined);
  assert.equal(repaired.data.rows[0].sourceUrl, 'https://example.com/products/item');
  assert.equal(repaired.data.cells[0].src, PNG);
  assert.deepEqual(repaired.data.cells[0].attributes, {price: 30});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^data\.cells\[0\]\.sourceUrl: unsafe source URL/);
  assert.equal(JSON.stringify(input), before);
});

test('record link mappings are suggested and retained separately from variant specifications', () => {
  for (const alias of ['source_url', 'product_url', 'product_link', 'url', 'link', 'website', 'Product URL']) {
    assert.equal(importer.suggestMapping(['name', alias]).link, alias);
  }
  const records = [
    {name: 'Example item', color: 'Red', product_url: 'https://example.com/item?variant=red', price: 30},
    {name: 'Example item', color: 'Blue', product_url: 'https://example.com/item?variant=blue', price: 32}
  ];
  const before = JSON.stringify(records);
  const project = importer.prepareProject(importer.parseInput(before), {mapping: {row: 'name', column: 'color', link: 'product_url'}}, validator).project;
  assert.deepEqual(project.data.cells.map(cell => cell.sourceUrl), records.map(record => record.product_url));
  assert.deepEqual(project.data.cells.map(cell => cell.attributes), [{price: 30}, {price: 32}]);
  assert.equal(JSON.stringify(records), before);
  assert.throws(() => importer.prepareProject(importer.parseInput(JSON.stringify([{name: 'Unsafe', link: 'javascript:alert(1)'}])), {}, validator), /sourceUrl: unsafe source URL/);
});

test('CSV and structured imports preserve links but still refuse remote image URLs', () => {
  const csv = 'name,product_link,price\nExample,https://example.com/products/example,30\n';
  const project = importer.prepareProject(importer.parseInput(csv, 'products.csv'), {}, validator).project;
  assert.equal(project.data.cells[0].sourceUrl, 'https://example.com/products/example');
  assert.deepEqual(project.data.cells[0].attributes, {price: '30'});
  const input = dataFixture();
  const imported = importer.prepareProject(importer.parseInput(JSON.stringify(input)), {}, validator).project;
  assert.equal(imported.data.rows[0].sourceUrl, 'https://example.com/products/item');
  assert.equal(imported.data.cells[0].sourceUrl, input.cells[0].sourceUrl);
  assert.deepEqual(imported.data.cells[0].attributes, {price: 30});
  input.cells[0].src = 'https://example.com/remote.png';
  assert.throws(() => importer.prepareProject(importer.parseInput(JSON.stringify(input)), {}, validator), /unsafe image URL/);
});

test('browser-global entry points share the same link validation', () => {
  const window = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'source-links.js'), 'utf8'))(window);
  const module = {exports: {}};
  new Function('window', 'module', fs.readFileSync(path.join(__dirname, '..', 'project-store.js'), 'utf8'))(window, module);
  assert.equal(window.SourceLinks.resolve({}, {sourceUrl: 'https://example.com/item'}), 'https://example.com/item');
  assert.equal(module.exports.validateData(dataFixture()).cells[0].sourceUrl, dataFixture().cells[0].sourceUrl);
  const unsafe = dataFixture(); unsafe.rows[0].sourceUrl = 'javascript:alert(1)';
  assert.throws(() => module.exports.validateData(unsafe), /unsafe source URL/);
});

test('stored projects, duplicates and portable embedding preserve independent source links', async () => {
  const copy = value => JSON.parse(JSON.stringify(value));
  const projects = new Map();
  const backend = {persistent: true, activeId: null,
    async loadIndex() { return {records: [...projects.values()].map(({data, ...metadata}) => metadata), activeId: this.activeId}; },
    async loadProject(id) { return projects.has(id) ? copy(projects.get(id)) : undefined; },
    async commit(project, {makeActive}) { projects.set(project.id, copy(project)); if (makeActive) this.activeId = project.id; },
    async setActive(id) { this.activeId = id; }
  };
  const store = createProjectStore({backend});
  await store.init(dataFixture());
  const imported = await store.importProject(projectFixture());
  const duplicate = await store.duplicate();
  assert.notEqual(duplicate.id, imported.id);
  assert.deepEqual(duplicate.data.rows, imported.data.rows);
  assert.deepEqual(duplicate.data.cells, imported.data.cells);
  const invalidData = copy(store.get().data); invalidData.cells[0].sourceUrl = 'file:///tmp/private';
  const before = store.get();
  await assert.rejects(store.update({data: invalidData}), /unsafe source URL/);
  assert.deepEqual(store.get(), before);
  const reopened = createProjectStore({backend});
  assert.deepEqual((await reopened.init(dataFixture())).data.cells, before.data.cells);
  const window = {}, document = {readyState: 'loading', addEventListener() {}};
  new Function('window', 'document', fs.readFileSync(path.join(__dirname, '..', 'portability.js'), 'utf8'))(window, document);
  const exported = await window.StudioPortability.embedProject(imported);
  assert.equal(exported.data.rows[0].sourceUrl, imported.data.rows[0].sourceUrl);
  assert.equal(exported.data.cells[0].sourceUrl, imported.data.cells[0].sourceUrl);
  exported.data.cells[0].sourceUrl = 'https://example.com/changed';
  assert.equal(imported.data.cells[0].sourceUrl, 'https://example.com/products/item?variant=red');
});
