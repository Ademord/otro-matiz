/* Linked inspection of two references; framing and saved image files stay intact. */
(function(root) {
  'use strict';
  const MIN = 1, MAX = 6;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
  const point = (rect, x, y) => ({x:clamp((x - rect.left) / Math.max(1, rect.width), 0, 1), y:clamp((y - rect.top) / Math.max(1, rect.height), 0, 1)});
  function imageSize(naturalWidth, naturalHeight, width, height, fit = 'contain') {
    if (fit !== 'contain' || !naturalWidth || !naturalHeight) return {width, height};
    const scale = Math.min(width / naturalWidth, height / naturalHeight);
    return {width:naturalWidth * scale, height:naturalHeight * scale};
  }
  function pan(viewport, image, zoom, focal) {
    const dx = Math.max(0, image.width * zoom - viewport.width) / 2;
    const dy = Math.max(0, image.height * zoom - viewport.height) / 2;
    return {x:dx * (1 - 2 * clamp(focal.x, 0, 1)), y:dy * (1 - 2 * clamp(focal.y, 0, 1))};
  }
  function wheelZoom(zoom, delta, mode = 0, height = 600) {
    const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
    return clamp(zoom * Math.exp(-clamp(pixels, -400, 400) / 500), MIN, MAX);
  }
  function mount(win, doc) {
    const app = win.MATRIX_APP, viewer = doc.getElementById('viewer'), content = doc.getElementById('viewer-content');
    if (!app || !viewer || !content || doc.getElementById('vcn-controls')) return null;
    const create = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const controls = create('div', 'vcn-controls'); controls.id = 'vcn-controls'; controls.hidden = true;
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Linked image zoom');
    const makeButton = (id, text, label, action) => { const node = create('button', 'vcn-button', text); node.id = id; node.type = 'button'; node.setAttribute('aria-label', label); node.addEventListener('click', action); return node; };
    const out = makeButton('vcn-out', '−', 'Zoom out both images', () => zoomOut(true));
    const output = create('output', 'vcn-value', '100%'); output.id = 'vcn-value'; output.setAttribute('aria-label', 'Linked image zoom level');
    const inside = makeButton('vcn-in', '+', 'Zoom in both images', () => setZoom(zoom * 1.25, true));
    const fit = makeButton('vcn-fit', 'Fit', 'Reset both images to current framing', reset);
    const help = create('span', 'vcn-help', 'Move or drag either image to pan both. Scroll or use + / − to zoom.'); help.id = 'vcn-help';
    controls.append(out, output, inside, fit, help);
    (viewer.querySelector('.viewer-tools') || content).after(controls);
    const live = create('span', 'vcn-sr'); live.setAttribute('aria-live', 'polite'); controls.append(live);
    const keyHelp = create('span', 'vcn-sr', 'With an image focused, plus and minus zoom both images, arrow keys pan, and zero resets the framing.'); keyHelp.id = 'vcn-keyhelp'; controls.append(keyHelp);
    let zoom = MIN, focal = {x:.5, y:.5}, pair = '', entries = [], drag = null, observer = null, queued = false, lastDetail = false, restoringFraming = false;
    const comparing = () => viewer.open && app.getViewerCells?.().length === 2;
    const detail = () => viewer.classList.contains('face-detail');
    const usable = entry => !entry.image.hidden && !entry.figure.classList.contains('vex-broken') && entry.image.naturalWidth > 0 && entry.image.naturalHeight > 0;
    const canPan = entry => usable(entry) && (zoom > MIN || entry.size.width * zoom > entry.frame.clientWidth + .5 || entry.size.height * zoom > entry.frame.clientHeight + .5);
    function measure(entry) {
      entry.image.style.removeProperty('transform');
      entry.baseTransform = win.getComputedStyle(entry.image).transform;
      const size = {width:entry.image.offsetWidth || entry.image.clientWidth, height:entry.image.offsetHeight || entry.image.clientHeight};
      entry.size = imageSize(entry.image.naturalWidth, entry.image.naturalHeight, size.width, size.height, win.getComputedStyle(entry.image).objectFit);
    }
    function paint() {
      const ready = entries.filter(usable);
      const navigable = ready.some(canPan);
      controls.hidden = !comparing();
      output.textContent = `${Math.round(zoom * 100)}%`;
      out.disabled = !ready.length || zoom <= MIN && !detail(); inside.disabled = !ready.length || zoom >= MAX;
      out.setAttribute('aria-label', zoom <= MIN && detail() ? 'Show full images' : 'Zoom out both images');
      output.title = detail() ? 'Zoom relative to Detail framing' : 'Zoom relative to Full image framing';
      help.textContent = detail() && zoom <= MIN ? 'Move or drag either image to pan both. Scroll down or use − for full images.' : 'Move or drag either image to pan both. Scroll or use + / − to zoom.';
      fit.disabled = zoom <= MIN && focal.x === .5 && focal.y === .5;
      for (const entry of entries) {
        const active = usable(entry) && navigable;
        entry.frame.classList.toggle('vcn-zoomed', active);
        if (!active) { entry.image.style.removeProperty('transform'); continue; }
        const delta = pan({width:entry.frame.clientWidth, height:entry.frame.clientHeight}, entry.size, zoom, focal);
        const base = entry.baseTransform && entry.baseTransform !== 'none' ? entry.baseTransform + ' ' : '';
        // Keep the original detail translation before the linked scale so its
        // centered crop does not jump when zooming an existing detail frame.
        entry.image.style.transform = `${base}translate3d(${delta.x}px,${delta.y}px,0) scale(${zoom})`;
      }
    }
    function remeasure() { for (const entry of entries) measure(entry); paint(); }
    function schedule() { if (queued) return; queued = true; win.requestAnimationFrame(() => { queued = false; if (comparing()) remeasure(); }); }
    function setZoom(next, announce = false) {
      if (!comparing() || !entries.some(usable)) return;
      zoom = clamp(next, MIN, MAX); if (zoom <= MIN) { zoom = MIN; focal = {x:.5, y:.5}; drag = null; }
      paint(); if (announce) live.textContent = `Both images at ${Math.round(zoom * 100)} percent${zoom === MIN ? ', current framing restored' : ''}.`;
    }
    function reset() { setZoom(MIN, true); }
    function showFull(announce = false) {
      const full = doc.getElementById('full-portrait-button');
      if (!comparing() || !detail() || !full) return false;
      full.click(); if (announce) live.textContent = 'Both full images shown. Framing reset.'; return true;
    }
    function zoomOut(announce = false) { if (zoom <= MIN && detail()) showFull(announce); else setZoom(zoom / 1.25, announce); }
    function clear() {
      observer?.disconnect(); observer = null; drag = null;
      for (const entry of entries) {
        entry.image.removeEventListener('load', schedule); entry.image.removeEventListener('error', schedule);
        entry.image.style.removeProperty('transform'); entry.frame.classList.remove('vcn-zoomed');
        entry.frame.removeAttribute('tabindex'); entry.frame.removeAttribute('role'); entry.frame.removeAttribute('aria-label'); entry.frame.removeAttribute('aria-describedby'); entry.frame.removeAttribute('aria-keyshortcuts');
      }
      entries = []; controls.hidden = true;
    }
    function opened() {
      const nextPair = comparing() ? JSON.stringify(app.getViewerCells().map(cell => cell.id).sort()) : '';
      const retain = Boolean(nextPair && nextPair === pair), restoreDetail = retain && lastDetail; clear();
      if (!retain) { zoom = MIN; focal = {x:.5, y:.5}; }
      pair = nextPair; if (!pair) { lastDetail = false; return; }
      const chosen = app.getViewerCells();
      entries = [...content.querySelectorAll('.viewer-figure')].map((figure, index) => ({figure, frame:figure.querySelector('.viewer-image-frame'), image:figure.querySelector('img'), cell:chosen[index]})).filter(entry => entry.frame && entry.image);
      for (const entry of entries) {
        entry.frame.tabIndex = 0; entry.frame.setAttribute('role', 'group');
        entry.frame.setAttribute('aria-label', `Inspect ${app.describe?.(entry.cell) || entry.cell.id}`);
        entry.frame.setAttribute('aria-describedby', 'vcn-help vcn-keyhelp'); entry.frame.setAttribute('aria-keyshortcuts', 'Shift+Equal Equal Minus 0 Home ArrowLeft ArrowRight ArrowUp ArrowDown');
        entry.image.addEventListener('load', schedule); entry.image.addEventListener('error', schedule);
        entry.image.draggable = false;
      }
      if (win.ResizeObserver) { observer = new win.ResizeObserver(schedule); for (const entry of entries) observer.observe(entry.frame); }
      // openViewer resets framing before it dispatches vieweropen. Restore a
      // swapped pair here so the enhancement's later synthetic Detail click is
      // unnecessary and an explicit user framing choice can still reset zoom.
      if (restoreDetail && !detail()) {
        restoringFraming = true;
        try { doc.getElementById('face-detail-button')?.click(); } finally { restoringFraming = false; }
      }
      lastDetail = detail();
      remeasure();
    }
    function entryAt(event) { return entries.find(entry => entry.frame === event.target?.closest?.('.viewer-image-frame')); }
    content.addEventListener('wheel', event => {
      const entry = entryAt(event); if (!entry || !comparing() || !usable(entry) || event.ctrlKey || event.metaKey || !event.deltaY) return;
      if (zoom <= MIN && detail() && event.deltaY > 0) { if (showFull()) event.preventDefault(); return; }
      const next = wheelZoom(zoom, event.deltaY, event.deltaMode, entry.frame.clientHeight);
      if (next === zoom) return;
      event.preventDefault(); focal = point(entry.frame.getBoundingClientRect(), event.clientX, event.clientY); setZoom(next);
    }, {passive:false});
    content.addEventListener('pointerdown', event => {
      const entry = entryAt(event); if (!entry || !usable(entry) || !entries.some(canPan) || !comparing() || event.pointerType === 'mouse' || event.isPrimary === false) return;
      drag = {id:event.pointerId, entry, x:event.clientX, y:event.clientY, focal:{...focal}};
      entry.frame.setPointerCapture?.(event.pointerId); event.preventDefault();
    });
    content.addEventListener('pointermove', event => {
      const entry = entryAt(event); if (!entry || !usable(entry) || !entries.some(canPan) || !comparing()) return;
      if (event.pointerType === 'mouse' || !event.pointerType) focal = point(entry.frame.getBoundingClientRect(), event.clientX, event.clientY);
      else if (drag?.id === event.pointerId && drag.entry === entry) {
        focal = {x:clamp(drag.focal.x - (event.clientX - drag.x) / Math.max(1, entry.frame.clientWidth * (zoom - 1), entry.size.width * zoom - entry.frame.clientWidth, entry.frame.clientWidth / 2), 0, 1), y:clamp(drag.focal.y - (event.clientY - drag.y) / Math.max(1, entry.frame.clientHeight * (zoom - 1), entry.size.height * zoom - entry.frame.clientHeight, entry.frame.clientHeight / 2), 0, 1)};
        event.preventDefault();
      } else return;
      paint();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) content.addEventListener(type, event => { if (drag?.id === event.pointerId) drag = null; });
    content.addEventListener('keydown', event => {
      const entry = entryAt(event); if (!entry || !comparing() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom * 1.25, true); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomOut(true); }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); reset(); }
      else if (entries.some(canPan) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); focal = {x:clamp(focal.x + (event.key === 'ArrowRight' ? .08 : event.key === 'ArrowLeft' ? -.08 : 0), 0, 1), y:clamp(focal.y + (event.key === 'ArrowDown' ? .08 : event.key === 'ArrowUp' ? -.08 : 0), 0, 1)}; paint();
      }
    });
    for (const id of ['face-detail-button', 'full-portrait-button']) doc.getElementById(id)?.addEventListener('click', () => { if (comparing()) { if (!restoringFraming) { zoom = MIN; focal = {x:.5, y:.5}; } lastDetail = detail(); remeasure(); } });
    doc.addEventListener('matrix:vieweropen', opened);
    viewer.addEventListener('close', () => { clear(); pair = ''; zoom = MIN; focal = {x:.5, y:.5}; lastDetail = false; });
    win.addEventListener('resize', schedule);
    return Object.freeze({getState:() => ({zoom, focal:{...focal}}), reset});
  }
  const api = Object.freeze({MIN, MAX, clamp, point, imageSize, pan, wheelZoom, mount});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViewerNavigation = Object.freeze({...api, controller:mount(root, root.document)});
})(typeof window === 'object' ? window : globalThis);
