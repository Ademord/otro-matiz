/* Shared shell: persist first, then initialize the gallery and its companion modules. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const assetVersion = '0.3.8';
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const assetUrl = new URL(src, document.baseURI);
    assetUrl.searchParams.set('v', assetVersion);
    script.src = assetUrl.href;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}. Keep all application files together and reload.`));
    document.head.append(script);
  });
  try {
    if (!window.ProjectStore) throw new Error('Project storage could not load. Keep project-store.js beside this page.');
    await ProjectStore.init(window.MATRIX_DATA);
    const project = ProjectStore.get();
    window.MATRIX_DATA = project.data;
    window.MATRIX_DATA.meta = { ...project.data.meta, id: project.id };
    // Migrate an older gallery's favorites once, without changing its original storage.
    if (!project.favorites.length) {
      const marker = `otro-matiz.migrated.${project.id}`;
      try {
        if (!localStorage.getItem(marker)) {
          const saved = localStorage.getItem(`visual-matrix.${project.id}.favorites.v1`);
          const raw = saved === null ? null : JSON.parse(saved);
          const known = new Set(project.data.cells.map(cell => cell.id));
          if (Array.isArray(raw)) await ProjectStore.update({favorites: raw.filter(id => known.has(id))});
          localStorage.setItem(marker, '1');
        }
      } catch { /* Optional legacy migration; current project remains available. */ }
    }
    const toolsPanel = $('studio-tools-disclosure');
    toolsPanel.addEventListener('toggle', event => {
      if (event.target !== toolsPanel && event.target.open) toolsPanel.open = true;
    }, true);
    for (const script of ['workspace-view.js', 'gallery.js', 'navigation.js', 'lists-store.js', 'favorites.js', 'viewer-enhancements.js', 'viewer-navigation.js', 'workspace.js', 'decisions.js', 'dataset-import.js', 'portability.js', 'generation.js', 'presentation.js', 'workspace-controls.js']) await load(script);
    function labels() {
      const p = ProjectStore.get();
      document.title = `${p.title} · Otro Matiz`;
      document.querySelector('h1').textContent = p.title;
      document.querySelector('.subtitle').textContent = p.goal || 'Explore the possibilities. Keep what matters. Make a decision.';
      const corner = document.querySelector('#matrix .corner');
      if (corner) {
        corner.replaceChildren(document.createTextNode(`${p.rowsLabel} ↓`));
        const label = document.createElement('span');
        label.className = 'column-description';
        label.textContent = `${p.columnsLabel} →`;
        corner.append(label);
      }
      $('matrix-wrap').setAttribute('aria-label', `${p.rowsLabel} and ${p.columnsLabel} comparison table`);
      document.querySelector('#matrix caption').textContent = `${p.rowsLabel} in rows, ${p.columnsLabel} in columns. Select two completed options to compare.`;
      $('scroll-hint-text').textContent = `Scroll sideways to explore all ${p.data.columns.length} columns (${p.columnsLabel})`;
      const state = ProjectStore.status();
      $('studio-storage').hidden = state.persistent;
      $('studio-storage').textContent = state.message || 'Session only: browser storage is unavailable. Export before closing.';
      document.querySelector('.local-tag').textContent = state.persistent ? 'SAVED ON THIS DEVICE' : 'SESSION ONLY';
    }
    labels();
    document.addEventListener('studio:change', labels);
    $('studio-loading').hidden = true;
    window.STUDIO_READY = true;
    document.dispatchEvent(new CustomEvent('studio:ready'));
  } catch (error) {
    $('studio-loading').textContent = `${error.message} Your existing saved projects have not been replaced.`;
    $('studio-loading').classList.add('studio-warning');
    console.error(error);
  }
})();
