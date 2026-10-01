/* Device-local view preferences; explicit savePresentation copies only chosen display settings into the project. */
(() => {
  'use strict';
  const projectId = window.MATRIX_DATA?.meta?.id || 'default';
  const key = `visual-matrix.${projectId}.workspace.v1`;
  const legacyKey = `visual-matrix.${projectId}.zoom.v1`;
  const defaults = Object.freeze({ layout: 'gallery', exploration: 'gallery', margin: null,
    focus: false, sidebarCollapsed: true, filtersOpen: false, details: false,
    zoom: 0.58, matrixLeft: 0, matrixTop: 0, favoriteListId: null,
    galleryFraming: 'full', galleryGrouping: 'none', galleryDescriptions: false, metadataFields: null,
    galleryZoom: 1, galleryFocalX: 0.5, galleryFocalY: 0.5 });
  const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function valid(name, value) {
    if (name === 'layout') return ['gallery', 'matrix', 'favorites'].includes(value);
    if (name === 'exploration') return ['gallery', 'matrix'].includes(value);
    if (name === 'margin') return value === null || finite(value) && value >= 0 && value <= 96;
    if (name === 'galleryFraming') return ['focused', 'full'].includes(value);
    if (name === 'galleryGrouping') return ['none', 'row', 'column'].includes(value);
    if (name === 'galleryZoom') return finite(value) && value >= 1 && value <= 3;
    if (name === 'galleryFocalX' || name === 'galleryFocalY') return finite(value) && value >= 0 && value <= 1;
    if (name === 'metadataFields') return value === null || (Array.isArray(value) && value.length <= 32 && new Set(value).size === value.length && value.every(key => typeof key === 'string' && key.length <= 100 && /^(row|column|cell)\..+/.test(key) && !/[\u0000-\u001f]/.test(key)));
    if (name === 'zoom') return finite(value) && value >= 0.1 && value <= 2.5;
    if (name === 'matrixLeft' || name === 'matrixTop') return finite(value) && value >= 0;
    if (name === 'favoriteListId') return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256);
    return typeof defaults[name] === 'boolean' && typeof value === 'boolean';
  }
  function merge(base, patch) {
    const next = { ...base };
    if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
      for (const name of Object.keys(defaults)) if (own(patch, name) && valid(name, patch[name])) next[name] = Array.isArray(patch[name]) ? patch[name].slice() : patch[name];
    }
    return next;
  }
  const snapshot = value => ({...value, metadataFields: Array.isArray(value.metadataFields) ? value.metadataFields.slice() : null});
  const presentationKeys = ['galleryFraming', 'galleryGrouping', 'galleryDescriptions', 'metadataFields', 'galleryZoom', 'galleryFocalX', 'galleryFocalY'];
  let preferences = merge(defaults, window.MATRIX_DATA?.meta?.presentation);
  try {
    const legacy = Number(localStorage.getItem(legacyKey));
    if (valid('zoom', legacy)) preferences.zoom = legacy;
  } catch { /* Private browsing/storage policy: keep an in-memory session. */ }
  try { preferences = merge(preferences, JSON.parse(localStorage.getItem(key))); } catch { /* Ignore corrupt or unavailable preferences. */ }
  function commit(next) {
    const changed = Object.keys(defaults).filter(name => JSON.stringify(preferences[name]) !== JSON.stringify(next[name]));
    if (!changed.length) return snapshot(preferences);
    preferences = next;
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Still usable in memory. */ }
    if (changed.includes('zoom')) {
      try { localStorage.setItem(legacyKey, String(preferences.zoom)); } catch { /* Older gallery compatibility is optional. */ }
    }
    document.dispatchEvent(new CustomEvent('workspace:preferenceschange', { detail: { preferences: snapshot(preferences), changed } }));
    return snapshot(preferences);
  }
  window.WorkspaceView = Object.freeze({
    get: () => snapshot(preferences),
    update: patch => commit(merge(preferences, patch)),
    reset: () => commit(snapshot(defaults)),
    async savePresentation() {
      if (!window.ProjectStore?.update) throw new Error('Project storage is unavailable.');
      const presentation = Object.fromEntries(presentationKeys.map(name => [name, Array.isArray(preferences[name]) ? preferences[name].slice() : preferences[name]]));
      await window.ProjectStore.update(project => ({data: {...project.data, meta: {...project.data.meta, presentation}}}));
      return presentation;
    }
  });
})();
