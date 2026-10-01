(() => {
  'use strict';
  const wrap = document.getElementById('matrix-wrap');
  const table = document.getElementById('matrix');
  const toolbar = document.getElementById('matrix-navigation');
  if (!wrap || !table || !toolbar || table.hidden) return;

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.5;
  const DEFAULT_ZOOM = 0.58;
  const BASE_IMAGE_WIDTH = 300;
  const MIN_CARD_WIDTH = 124;
  const CELL_GUTTER = 16;
  const STORAGE_KEY = 'visual-matrix.' + (window.MATRIX_DATA?.meta?.id || 'default') + '.zoom.v1';
  const readout = document.getElementById('matrix-zoom');
  const minus = document.getElementById('zoom-out');
  const plus = document.getElementById('zoom-in');
  const view = window.WorkspaceView;
  let zoom = DEFAULT_ZOOM;
  let pan = null;
  let suppressContextUntil = 0;
  let intended = { left: 0, top: 0 };
  let restoreEpoch = 0;
  let restoring = false;
  let inputUntil = 0;
  let pointerHeld = false;
  let scrollQueued = false;
  let programmaticPoint = null;
  let writingView = false;
  const clamp = value => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

  function isEditable(target) {
    return target instanceof Element && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"],[role="spinbutton"],[role="slider"]'));
  }
  function canNavigate() {
    return wrap.getClientRects().length > 0 && !wrap.closest('[hidden],[inert]') && !document.querySelector('dialog[open]');
  }

  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_ZOOM && stored <= MAX_ZOOM) zoom = stored;
  } catch { /* The gallery also works where file-origin storage is unavailable. */ }
  if (view) {
    const saved = view.get();
    zoom = saved.zoom;
    intended = { left: saved.matrixLeft, top: saved.matrixTop };
  }
  const sizeLabel = document.createElement('label');
  sizeLabel.className = 'matrix-size-label';
  sizeLabel.htmlFor = 'matrix-size';
  sizeLabel.textContent = 'Image size';
  const size = document.createElement('input');
  size.type = 'number'; size.id = 'matrix-size'; size.min = '10'; size.max = '250'; size.step = '1';
  size.setAttribute('aria-label', 'Image size, percent');
  size.setAttribute('inputmode', 'numeric');
  size.style.width = '4.5em';
  sizeLabel.append(size, document.createTextNode('%'));
  readout.before(sizeLabel);
  readout.hidden = true;

  function rowWidth() {
    const styles = getComputedStyle(table);
    const width = parseFloat(styles.getPropertyValue?.('--row-width'));
    return Number.isFinite(width) && width > 0 ? width : 200;
  }
  function columnCount() {
    const headings = table.tHead?.rows[0]?.cells;
    if (headings) return [...headings].slice(1).filter(th => !th.hidden && !th.classList.contains('dec-hide')).length;
    return window.MATRIX_DATA?.columns?.length || 6;
  }
  function imageWidth() {
    return BASE_IMAGE_WIDTH * zoom;
  }
  function syncControls() {
    readout.value = `${Math.round(zoom * 100)}%`;
    if (document.activeElement !== size) size.value = String(Math.round(zoom * 100));
    if (zoom <= MIN_ZOOM && document.activeElement === minus) plus.focus();
    if (zoom >= MAX_ZOOM && document.activeElement === plus) minus.focus();
    minus.disabled = zoom <= MIN_ZOOM;
    plus.disabled = zoom >= MAX_ZOOM;
  }
  function applyLayout() {
    syncControls();
    // Hidden tables have zero geometry. Never let that clamp the saved point.
    if (!canNavigate()) return false;
    // Resize image/card geometry only. The axis text and action controls retain
    // native font sizes, and short matrices no longer stretch their first column.
    const width = imageWidth();
    const cardWidth = Math.max(MIN_CARD_WIDTH, width);
    const count = columnCount();
    table.style.setProperty('--image-width', `${width}px`);
    table.style.setProperty('--card-width', `${cardWidth}px`);
    table.style.setProperty('--cell-width', `${cardWidth + CELL_GUTTER}px`);
    table.style.setProperty('--visible-column-count', String(count));
    table.style.width = `${rowWidth() + (cardWidth + CELL_GUTTER) * count}px`;
    const hint = document.getElementById('scroll-hint');
    if (hint) hint.hidden = !canNavigate() || wrap.scrollWidth <= wrap.clientWidth + 1;
    return true;
  }
  function applyPoint() {
    wrap.scrollLeft = Math.min(intended.left, Math.max(0, wrap.scrollWidth - wrap.clientWidth));
    wrap.scrollTop = Math.min(intended.top, Math.max(0, wrap.scrollHeight - wrap.clientHeight));
    programmaticPoint = { left: wrap.scrollLeft, top: wrap.scrollTop };
  }
  function refreshLayout() {
    const epoch = ++restoreEpoch;
    restoring = true;
    if (!applyLayout()) { restoring = false; return; }
    applyPoint();
    // The favorites view and density controls also settle layout in a frame.
    // Reapply once after them, but never after a newer user gesture.
    requestAnimationFrame(() => {
      if (epoch !== restoreEpoch) return;
      if (applyLayout()) applyPoint();
      requestAnimationFrame(() => { if (epoch === restoreEpoch) restoring = false; });
    });
  }
  function beginInput() {
    ++restoreEpoch;
    restoring = false;
    programmaticPoint = null;
    inputUntil = performance.now() + 600;
  }
  function savePoint() {
    if (!canNavigate()) return;
    intended = { left: wrap.scrollLeft, top: wrap.scrollTop };
    updateView({ matrixLeft: intended.left, matrixTop: intended.top });
  }
  function updateView(patch) {
    writingView = true;
    try { view?.update(patch); } finally { writingView = false; }
  }
  function queueScrollSave() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const matchesRestore = programmaticPoint && wrap.scrollLeft === programmaticPoint.left && wrap.scrollTop === programmaticPoint.top;
      if (restoring || matchesRestore || !(pointerHeld || performance.now() < inputUntil)) return;
      if (!canNavigate()) return;
      savePoint();
      // Native touch panning cancels the pointer; each accepted user scroll
      // extends the window so continuous momentum keeps being saved.
      inputUntil = performance.now() + 600;
    });
  }
  function setZoom(requested, point) {
    if (!Number.isFinite(requested) || !canNavigate()) return;
    beginInput();
    const previousLeft = wrap.scrollLeft;
    const previousTop = wrap.scrollTop;
    const next = Math.round(clamp(requested) * 1000) / 1000;
    const bounds = wrap.getBoundingClientRect();
    const x = point ? Math.max(0, Math.min(wrap.clientWidth, point.x - bounds.left - wrap.clientLeft)) : wrap.clientWidth / 2;
    const y = point ? Math.max(0, Math.min(wrap.clientHeight, point.y - bounds.top - wrap.clientTop)) : wrap.clientHeight / 2;
    const clientX = bounds.left + wrap.clientLeft + x;
    const clientY = bounds.top + wrap.clientTop + y;
    // Size controls change grid density, so they keep the existing pan. Only
    // an explicit pointer over a cell requests image anchoring.
    const target = point ? document.elementFromPoint?.(clientX, clientY) : null;
    const anchor = target?.closest?.('.option-button,td');
    const rectangle = anchor && table.contains(anchor) ? anchor.getBoundingClientRect() : null;
    const anchored = rectangle && rectangle.width > 0 && rectangle.height > 0;
    const fractionX = anchored ? Math.max(0, Math.min(1, (clientX - rectangle.left) / rectangle.width)) : 0;
    const fractionY = anchored ? Math.max(0, Math.min(1, (clientY - rectangle.top) / rectangle.height)) : 0;
    zoom = next;
    applyLayout();
    wrap.scrollLeft = previousLeft;
    wrap.scrollTop = previousTop;
    if (anchored && anchor.isConnected) {
      const resized = anchor.getBoundingClientRect();
      // Keep the first row/column visible when starting at an edge; otherwise
      // a growing image can push its label underneath a sticky header.
      wrap.scrollLeft = previousLeft <= 1 ? 0 : wrap.scrollLeft + resized.left + fractionX * resized.width - clientX;
      wrap.scrollTop = previousTop <= 1 ? 0 : wrap.scrollTop + resized.top + fractionY * resized.height - clientY;
    }
    intended = { left: wrap.scrollLeft, top: wrap.scrollTop };
    if (view) updateView({ zoom, matrixLeft: intended.left, matrixTop: intended.top });
    else try { localStorage.setItem(STORAGE_KEY, String(zoom)); } catch { /* Optional persistence. */ }
  }
  size.addEventListener('change', () => { setZoom(size.valueAsNumber / 100); size.value = String(Math.round(zoom * 100)); });
  size.addEventListener('keydown', event => { if (event.key === 'Enter') { setZoom(size.valueAsNumber / 100); size.value = String(Math.round(zoom * 100)); } });
  minus.addEventListener('click', () => setZoom(zoom - 0.1));
  plus.addEventListener('click', () => setZoom(zoom + 0.1));
  const reset = document.getElementById('zoom-reset');
  reset.title = 'Reset image size to 58%';
  reset.addEventListener('click', () => setZoom(DEFAULT_ZOOM));
  document.getElementById('zoom-fit').addEventListener('click', () => {
    const count = columnCount();
    if (!count) return;
    const available = (wrap.clientWidth - 2 - rowWidth()) / count - CELL_GUTTER;
    setZoom(Math.min(1, available / BASE_IMAGE_WIDTH), { x: wrap.getBoundingClientRect().left, y: wrap.getBoundingClientRect().top });
    if (available < MIN_CARD_WIDTH) window.MATRIX_APP?.announce?.('Cards are at their smallest readable width. Scroll sideways to see the remaining columns.');
  });

  wrap.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey && canNavigate()) beginInput();
    // Ctrl/Cmd (including trackpad pinch encoded as Ctrl+wheel) belongs to the
    // browser. Never compete with host accelerators, especially in an iframe.
    if (event.ctrlKey || event.metaKey || !event.altKey || event.shiftKey || event.defaultPrevented || !event.cancelable || !event.deltaY || !canNavigate() || isEditable(event.target)) return;
    event.preventDefault();
    wrap.focus({ preventScroll: true });
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? wrap.clientHeight : 1;
    const delta = Math.max(-300, Math.min(300, event.deltaY * unit));
    setZoom(zoom * Math.exp(-delta * 0.0015), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  function keyboardZoom(event) {
    // These keys are local only while focus is inside the matrix or its toolbar.
    // Modified browser shortcuts always pass through unchanged.
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || event.isComposing || !canNavigate() || isEditable(event.target) || !event.currentTarget.contains(document.activeElement)) return;
    if (event.key === 'Escape' && pan) {
      stopPan(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    let next;
    if (event.key === '+') next = zoom + 0.1;
    else if (event.key === '-') next = zoom - 0.1;
    else if (event.key === '0') next = DEFAULT_ZOOM;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setZoom(next);
  }
  wrap.addEventListener('keydown', keyboardZoom);
  toolbar.addEventListener('keydown', keyboardZoom);
  wrap.addEventListener('keydown', event => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginInput();
  });
  wrap.addEventListener('scroll', queueScrollSave, { passive: true });
  wrap.addEventListener('pointerdown', event => {
    if (canNavigate() && !isEditable(event.target)) { beginInput(); pointerHeld = true; }
  });
  window.addEventListener('pointerup', () => { if (pointerHeld) queueScrollSave(); pointerHeld = false; });
  window.addEventListener('pointercancel', () => { pointerHeld = false; });

  function stopPan(cancelled = false) {
    if (!pan) return;
    const ended = pan;
    pan = null;
    wrap.classList.remove('is-panning');
    if (ended.dragged) savePoint();
    if (ended.dragged && !cancelled) suppressContextUntil = performance.now() + 500;
    if (wrap.hasPointerCapture(ended.id)) wrap.releasePointerCapture(ended.id);
  }
  wrap.addEventListener('pointerdown', event => {
    if (event.button !== 2 || event.pointerType !== 'mouse' || !canNavigate() || isEditable(event.target)) return;
    stopPan(true);
    suppressContextUntil = 0;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: wrap.scrollLeft, top: wrap.scrollTop, dragged: false };
    wrap.focus({ preventScroll: true });
  });
  window.addEventListener('pointermove', event => {
    if (!pan || event.pointerId !== pan.id) return;
    if (!canNavigate()) { stopPan(true); return; }
    if (!(event.buttons & 2)) { stopPan(); return; }
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.dragged && Math.hypot(dx, dy) < 5) return;
    if (!pan.dragged) {
      pan.dragged = true;
      wrap.setPointerCapture(pan.id);
      wrap.classList.add('is-panning');
    }
    event.preventDefault();
    wrap.scrollLeft = pan.left - dx;
    wrap.scrollTop = pan.top - dy;
  }, { passive: false });
  window.addEventListener('pointerup', event => { if (pan && event.pointerId === pan.id && event.button === 2) stopPan(); });
  window.addEventListener('pointercancel', event => { if (pan && event.pointerId === pan.id) stopPan(true); });
  wrap.addEventListener('lostpointercapture', () => stopPan(true));
  window.addEventListener('blur', () => { stopPan(true); pointerHeld = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPan(true); });
  for (const type of ['presentation:viewchange', 'matrix:filterchange', 'matrix:vieweropen']) document.addEventListener(type, () => stopPan(true));
  wrap.addEventListener('contextmenu', event => {
    if (pan?.dragged || performance.now() < suppressContextUntil) {
      event.preventDefault();
      suppressContextUntil = 0;
    }
  });
  document.addEventListener('presentation:viewchange', refreshLayout);
  document.addEventListener('matrix:filterchange', refreshLayout);
  document.addEventListener('workspace:preferenceschange', event => {
    const { preferences, changed } = event.detail;
    if (changed.includes('zoom') && preferences.zoom !== zoom) { zoom = preferences.zoom; syncControls(); }
    if (changed.includes('matrixLeft')) intended.left = preferences.matrixLeft;
    if (changed.includes('matrixTop')) intended.top = preferences.matrixTop;
    // Own pan writes must not launch a competing restoration frame.
    if (!writingView && changed.some(name => ['zoom', 'matrixLeft', 'matrixTop', 'margin', 'focus', 'sidebarCollapsed', 'filtersOpen', 'details'].includes(name))) refreshLayout();
  });
  window.addEventListener('pagehide', () => {
    const matchesRestore = programmaticPoint && wrap.scrollLeft === programmaticPoint.left && wrap.scrollTop === programmaticPoint.top;
    if (!restoring && !matchesRestore && (pointerHeld || performance.now() < inputUntil)) savePoint();
  });
  window.MatrixNavigation = Object.freeze({
    getState: () => ({ zoom, left: wrap.scrollLeft, top: wrap.scrollTop, intendedLeft: intended.left, intendedTop: intended.top }),
    setZoom, refresh: refreshLayout
  });
  refreshLayout();
  if ('ResizeObserver' in window) new ResizeObserver(refreshLayout).observe(wrap);
  else window.addEventListener('resize', refreshLayout);
})();
