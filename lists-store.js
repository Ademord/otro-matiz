/* Project-local saved collections. Membership edits never alter stars or image data. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const store = () => {
    if (!window.ProjectStore?.get()) throw new Error('Your project is still opening. Try again in a moment.');
    return window.ProjectStore;
  };
  const all = () => store().get().lists || [];
  const get = id => all().find(list => list.id === id) || null;
  function members(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Select valid images for this list.');
    return [...new Set(ids)];
  }
  function name(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Give your list a name.');
    return value.trim();
  }
  function find(lists, id) {
    const list = lists.find(item => item.id === id);
    if (!list) throw new Error('That list no longer exists. Choose another list.');
    return list;
  }
  function uniqueId(lists) {
    let id;
    do { id = `list-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`; }
    while (lists.some(list => list.id === id));
    return id;
  }
  async function write(action, change) {
    const api = store(), expectedProject = api.get().id;
    let changedId, removed;
    const saved = await api.update(project => {
      if (project.id !== expectedProject) throw new Error('The project changed. Reopen the list in the current project.');
      const lists = project.lists || [];
      const result = change(lists, project);
      changedId = result.id;
      removed = result.removed;
      return { lists };
    });
    document.dispatchEvent(new CustomEvent('studio:listschange', { detail: { projectId: saved.id, id: changedId, action } }));
    return removed ? clone(removed) : clone(saved.lists.find(list => list.id === changedId));
  }
  async function create(title, ids) {
    const label = name(title), cellIds = members(ids);
    return write('create', lists => {
      const id = uniqueId(lists), date = new Date().toISOString();
      lists.push({ id, name: label, cellIds, createdAt: date, updatedAt: date });
      return { id };
    });
  }
  async function rename(id, title) {
    const label = name(title);
    return write('rename', lists => { const list = find(lists, id); list.name = label; list.updatedAt = new Date().toISOString(); return { id }; });
  }
  async function duplicate(id, title) {
    return write('duplicate', lists => {
      const original = find(lists, id), nextId = uniqueId(lists), date = new Date().toISOString();
      const label = title === undefined ? `${original.name.slice(0, 111)} (copy)` : name(title);
      lists.push({ ...original, id: nextId, name: label, cellIds: original.cellIds.slice(), createdAt: date, updatedAt: date });
      return { id: nextId };
    });
  }
  async function add(id, ids) {
    const incoming = members(ids);
    return write('add', lists => {
      const list = find(lists, id); list.cellIds = [...new Set([...list.cellIds, ...incoming])]; list.updatedAt = new Date().toISOString(); return { id };
    });
  }
  async function removeMembers(id, ids) {
    const outgoing = new Set(members(ids));
    return write('remove-members', lists => {
      const list = find(lists, id); list.cellIds = list.cellIds.filter(cell => !outgoing.has(cell)); list.updatedAt = new Date().toISOString(); return { id };
    });
  }
  async function remove(id) {
    return write('delete', lists => { const removed = find(lists, id); lists.splice(lists.indexOf(removed), 1); return { id, removed }; });
  }
  async function restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('There is no deleted list to restore.');
    const copy = clone(snapshot);
    return write('restore', lists => {
      if (lists.some(list => list.id === copy.id)) throw new Error('A list with that ID already exists. It has not been replaced.');
      lists.push(copy); return { id: copy.id };
    });
  }
  window.StudioLists = Object.freeze({ all, get, create, rename, duplicate, add, removeMembers, remove, restore });
})();
