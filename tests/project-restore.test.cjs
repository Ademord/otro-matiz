'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectStore, validateProject } = require('../project-store.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA';
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


test('restore copy preserves every saved field including private content, leaves original intact and persists reload', async () => {
  const original = validateProject(sampleProject({ lists: [{id:'one',name:'Shortlist',cellIds:['crop--clean'],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}], annotations: {'crop--clean':[{id:'pin-one',x:.2,y:.3,text:'Keep length'}]} }));
  const b = fakeBackend({projects:{[original.id]: original},activeId:original.id}), {store,document}=newStore(b);
  await store.init(); const saved=store.get();
  await store.update({title:'Current edited title', goal:'New goal'}); const current=store.get(), originalDisk=JSON.parse(JSON.stringify(b.projects.get(original.id)));
  const copy=await store.restoreCopy(saved,{expectedProjectId:original.id,title:'Restored checkpoint'});
  assert.notEqual(copy.id,original.id); assert.equal(copy.title,'Restored checkpoint');
  const normalize = p => ({...p,id:'ID',title:'TITLE',updatedAt:'TIME',data:{...p.data,meta:{...p.data.meta,id:'ID',updatedAt:'TIME'}}});
  assert.deepEqual(normalize(copy),normalize(saved)); assert.deepEqual(b.projects.get(original.id),originalDisk);
  assert.equal(copy.decisions['crop--clean'].privateNote,'secret'); assert.equal(store.list().length,2);
  const reload=newStore(b).store; await reload.init(); assert.deepEqual(reload.get(),copy);
  assert.equal(document.events.at(-1).detail.structural,true);
});

test('captures caller checkpoint and options before queued work, later activation serializes normally', async () => {
  const b=fakeBackend(),{store}=newStore(b);await store.init(sampleProject().data);
  const original=store.get(), checkpoint=store.get(), options={expectedProjectId:original.id,title:'Captured title'};
  const restore=store.restoreCopy(checkpoint,options); checkpoint.goal='MUTATED';checkpoint.data.rows[0].name='MUTATED';options.title='MUTATED';options.expectedProjectId='other';
  const activate=store.activate(original.id); const result=await restore;await activate;
  assert.equal(result.goal,original.goal);assert.equal(result.title,'Captured title');assert.deepEqual(result.data.rows,original.data.rows);assert.equal(store.get().id,original.id);
});

test('earlier queued project switch rejects stale restore without creating or replacing a project', async () => {
  const b=fakeBackend(),{store}=newStore(b);await store.init(sampleProject().data);
  const first=store.get(); const second=await store.duplicate('Second');await store.activate(first.id);
  const switcher=store.activate(second.id);const restore=store.restoreCopy(first,{expectedProjectId:first.id,title:'Stale'});
  await switcher;await assert.rejects(restore,/active project changed/);assert.equal(store.get().id,second.id);assert.equal(store.list().length,2);
});

test('quota failure preserves active project and index; retry creates one complete copy', async () => {
  const b=fakeBackend(),{store}=newStore(b);await store.init(sampleProject().data);const first=store.get(),index=store.list();b.fail=true;
  await assert.rejects(store.restoreCopy(first,{expectedProjectId:first.id,title:'Retry me'}),/Could not save/);
  assert.deepEqual(store.get(),first);assert.deepEqual(store.list(),index);assert.equal(b.activeId,first.id);assert.equal(b.projects.size,1);
  b.fail=false;const copy=await store.restoreCopy(first,{expectedProjectId:first.id,title:'Retry me'});assert.notEqual(copy.id,first.id);assert.equal(b.projects.size,2);
});

test('temporary storage refuses restore and malformed or mismatched snapshots never write', async () => {
  const {store}=newStore();await store.init(sampleProject().data);const first=store.get();
  await assert.rejects(store.restoreCopy(first,{expectedProjectId:first.id}),/persistent storage/);assert.equal(store.list().length,1);
  const b=fakeBackend(), persistent=newStore(b).store;await persistent.init(sampleProject().data);const p=persistent.get();
  for (const [value,opts] of [[p,{}],[{...p,id:'someone-else'},{expectedProjectId:p.id}],[{...p,schemaVersion:99},{expectedProjectId:p.id}],[p,{expectedProjectId:p.id,title:''}],[p,{expectedProjectId:p.id,title:'x'.repeat(121)}]]) {
    await assert.rejects(persistent.restoreCopy(value,opts));assert.deepEqual(persistent.get(),p);assert.equal(b.projects.size,1);
  }
});
