/* Display controls use the shared, device-local WorkspaceView preferences. */
(() => {
  'use strict';
  if (!window.StudioPresentation || document.getElementById('wv-controls')) return;
  const $ = id => document.getElementById(id);
  const root = document.documentElement, body = document.body;
  const DEFAULTS = {margin:null, focus:false, filtersOpen:false, details:false, galleryFraming:'full', galleryGrouping:'none', galleryDescriptions:false, metadataFields:null, galleryZoom:1, galleryFocalX:0.5, galleryFocalY:0.5};
  const clampMargin = value => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(96, Math.max(0, n)) : null;
  };
  const autoMargin = () => Math.round(Math.min(42, Math.max(14, root.clientWidth * 0.025)));
  const store = window.WorkspaceView || (() => {
    let state = {...DEFAULTS}; return {get:() => ({...state}), update(patch) { state = {...state, ...patch}; return {...state}; }};
  })();
  const read = () => { try { return {...DEFAULTS, ...store.get()}; } catch { return {...DEFAULTS}; } };
  let current = read();
  const paths = {filter:'M4 5h16l-6 7.5V18l-4 2v-7.5Z', details:'M4 6h16M4 12h11M4 18h14', focus:'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', settings:'M4 7h16M4 17h16M8 4v6M16 14v6'};
  const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[name]); svg.append(path); return svg;
  };
  const tool = (id,name,text,title) => {
    const node = document.createElement('button'); node.type='button'; node.id=id; node.className='wv-button'; node.title=title;
    const label = document.createElement('span'); label.className='wv-label'; label.textContent=text; node.append(icon(name),label); return node;
  };
  const toolbar = document.createElement('div'); toolbar.id='wv-controls'; toolbar.className='wv-toolbar'; toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','Workspace view');
  const filtersButton = tool('wv-filters-toggle','filter','Filters','Show or hide filter options');
  const filterFlag = document.createElement('span'); filterFlag.className='wv-flag'; filterFlag.hidden=true; filterFlag.innerHTML='<span class="wv-dot" aria-hidden="true"></span><span class="sr-only">, active</span>'; filtersButton.append(filterFlag);
  const detailsButton = tool('wv-details-toggle','details','Matrix details','Show matrix descriptions and navigation hints');
  const focusButton = tool('wv-focus-toggle','focus','Focus mode','Hide the project header and sidebar');
  const settingsButton = tool('wv-settings-toggle','settings','View','Framing, grouping, specifications and spacing'); settingsButton.setAttribute('aria-controls','wv-settings-panel'); settingsButton.setAttribute('aria-expanded','false');
  const panel = document.createElement('div'); panel.id='wv-settings-panel'; panel.className='wv-popover'; panel.hidden=true; panel.setAttribute('role','group'); panel.setAttribute('aria-labelledby','wv-settings-title');
  panel.innerHTML=`
    <p class="wv-popover-title" id="wv-settings-title">View settings</p>
    <div class="wv-field" id="wv-grouping-field">
      <label for="wv-grouping">Group gallery</label>
      <select id="wv-grouping"><option value="none">One continuous grid</option><option value="row">By row</option><option value="column">By column</option></select>
    </div>
    <div class="wv-field" id="wv-descriptions-field">
      <label class="wv-check"><input type="checkbox" id="wv-card-descriptions">Show descriptions on cards</label>
      <p class="wv-hint">Descriptions remain available in the expanded image viewer.</p>
    </div>
    <section class="wv-field" id="wv-framing-field" aria-labelledby="wv-framing-title">
      <strong id="wv-framing-title">Focused preview</strong>
      <label for="wv-gallery-zoom">Preview zoom <output id="wv-gallery-zoom-value"></output></label>
      <input type="range" id="wv-gallery-zoom" min="1" max="3" step="0.1">
      <label for="wv-focal-x">Horizontal focus <output id="wv-focal-x-value"></output></label>
      <input type="range" id="wv-focal-x" min="0" max="100" step="1">
      <label for="wv-focal-y">Vertical focus <output id="wv-focal-y-value"></output></label>
      <input type="range" id="wv-focal-y" min="0" max="100" step="1">
      <p class="wv-hint">Applies to focused previews. Supplied detail images stay complete.</p>
    </section>
    <fieldset class="wv-field wv-metadata" id="wv-metadata-field">
      <legend>Card specifications</legend>
      <label class="wv-check"><input type="checkbox" id="wv-metadata-auto">Automatic: up to four fields</label>
      <div id="wv-metadata-fields" class="wv-metadata-fields"></div>
      <p class="wv-hint">Choose fields to show, or clear all to hide specifications.</p>
    </fieldset>
    <div class="wv-field">
      <label>Side margins</label>
      <label class="wv-check"><input type="checkbox" id="wv-margin-auto">Responsive spacing</label>
      <div class="wv-margin-row">
        <input type="range" id="wv-margin-range" min="0" max="96" step="1" aria-label="Side margins in pixels" aria-describedby="wv-margin-hint">
        <span class="wv-number"><input type="number" id="wv-margin-number" min="0" max="96" step="1" inputmode="numeric" aria-label="Side margins in pixels" aria-describedby="wv-margin-hint"><span aria-hidden="true">px</span></span>
      </div>
      <p class="wv-hint" id="wv-margin-hint">Responsive spacing follows the window. Custom spacing is saved for this project.</p>
    </div>
    <div class="wv-extra" id="wv-extra-options"></div>
    <div class="wv-popover-actions">
      <button type="button" class="wv-text-button" id="wv-save-presentation">Save presentation to project</button>
      <p id="wv-presentation-status" class="wv-hint" role="status"></p>
      <button type="button" class="wv-text-button" id="wv-reset" aria-describedby="wv-reset-hint">Reset view</button>
      <p class="wv-hint" id="wv-reset-hint">Restores layout, image size, spacing and panels. Favorites, lists and notes stay.</p>
    </div>`;
  toolbar.append(filtersButton,settingsButton,panel); const favBar=$('fav-bar'); if(favBar) favBar.append(toolbar); else $('matrix-navigation').before(toolbar);
  $('wv-extra-options').append(detailsButton,focusButton);
  const range=$('wv-margin-range'), number=$('wv-margin-number'), automatic=$('wv-margin-auto'), reset=$('wv-reset');
  const grouping=$('wv-grouping'), descriptions=$('wv-card-descriptions'), metadataAuto=$('wv-metadata-auto'), metadataFields=$('wv-metadata-fields'), metadataChecks=new Map();
  const zoom=$('wv-gallery-zoom'), focalX=$('wv-focal-x'), focalY=$('wv-focal-y'), savePresentation=$('wv-save-presentation'), presentationStatus=$('wv-presentation-status');
  reset.hidden=typeof store.reset!=='function'; savePresentation.hidden=typeof store.savePresentation!=='function';
  const filters=document.querySelector('.present-filters'); if(filters) { if(!filters.id) filters.id='wv-filter-panel'; filtersButton.setAttribute('aria-controls',filters.id); } else filtersButton.hidden=true;
  body.classList.add('wv-density');
  function renderMetadataChoices() {
    metadataFields.replaceChildren(); metadataChecks.clear();
    for(const field of StudioPresentation.getMetadataFields?.() || []) {
      const label=document.createElement('label'); label.className='wv-check';
      const input=document.createElement('input'); input.type='checkbox'; input.value=field.key;
      input.addEventListener('change',() => {
        const keys=[...metadataChecks].filter(([,control]) => control.checked).map(([key]) => key);
        if(keys.length>32) { input.checked=false; presentationStatus.textContent='Choose at most 32 specification fields.'; return; }
        save({metadataFields:keys});
      });
      const text=document.createElement('span'); text.textContent=field.label; label.append(input,text); metadataFields.append(label); metadataChecks.set(field.key,input);
    }
    $('wv-metadata-field').hidden=!metadataChecks.size;
  }
  function syncContext() {
    const layout=StudioPresentation.getView(); detailsButton.hidden=layout!=='matrix';
    $('wv-grouping-field').hidden=layout!=='gallery';
    $('wv-descriptions-field').hidden=layout!=='gallery';
    $('wv-metadata-field').hidden=layout!=='gallery' || !metadataChecks.size;
    $('wv-framing-field').hidden=layout==='matrix' || current.galleryFraming!=='focused';
  }
  function apply(prefs) {
    current={...DEFAULTS,...prefs}; const margin=clampMargin(current.margin);
    root.style.setProperty('--wv-margin',margin===null?'clamp(14px, 2.5vw, 42px)':`${margin}px`);
    body.classList.toggle('wv-details',!!current.details); body.classList.toggle('wv-focus',!!current.focus);
    if(filters && filters.open!==!!current.filtersOpen) filters.open=!!current.filtersOpen;
    filtersButton.setAttribute('aria-expanded',String(!!current.filtersOpen)); detailsButton.setAttribute('aria-pressed',String(!!current.details)); focusButton.setAttribute('aria-pressed',String(!!current.focus));
    focusButton.title=current.focus?'Exit focus mode (Esc)':'Hide the project header and sidebar';
    automatic.checked=margin===null; range.disabled=number.disabled=automatic.checked;
    if(document.activeElement!==range) range.value=String(margin??autoMargin()); if(document.activeElement!==number) number.value=String(margin??autoMargin());
    grouping.value=current.galleryGrouping; descriptions.checked=!!current.galleryDescriptions; metadataAuto.checked=current.metadataFields===null;
    const selected=Array.isArray(current.metadataFields)?current.metadataFields:[...metadataChecks.keys()].slice(0,4);
    for(const [key,input] of metadataChecks) { input.checked=selected.includes(key); input.disabled=metadataAuto.checked; }
    if(document.activeElement!==zoom) zoom.value=String(current.galleryZoom);
    if(document.activeElement!==focalX) focalX.value=String(Math.round(current.galleryFocalX*100)); if(document.activeElement!==focalY) focalY.value=String(Math.round(current.galleryFocalY*100));
    $('wv-gallery-zoom-value').textContent=`${Math.round(current.galleryZoom*100)}%`; $('wv-focal-x-value').textContent=`${Math.round(current.galleryFocalX*100)}%`; $('wv-focal-y-value').textContent=`${Math.round(current.galleryFocalY*100)}%`;
    syncContext();
  }
  function save(patch) { try { store.update(patch); } catch { /* Preferences remain usable in memory. */ } apply(read()); }
  filtersButton.addEventListener('click',() => save({filtersOpen:!current.filtersOpen})); filters?.addEventListener('toggle',() => { if(filters.open!==!!current.filtersOpen) filters.open=!!current.filtersOpen; });
  function syncFilterFlag() { filterFlag.hidden=!window.StudioDecisions?.isFiltering?.(); }
  for(const event of ['studio:decisionfilter','studio:change','studio:ready']) document.addEventListener(event,syncFilterFlag);
  detailsButton.addEventListener('click',() => save({details:!current.details})); focusButton.addEventListener('click',() => save({focus:!current.focus}));
  grouping.addEventListener('change',() => save({galleryGrouping:grouping.value}));
  descriptions.addEventListener('change',() => save({galleryDescriptions:descriptions.checked}));
  metadataAuto.addEventListener('change',() => save({metadataFields:metadataAuto.checked?null:[...metadataChecks.keys()].slice(0,4)}));
  automatic.addEventListener('change',() => save({margin:automatic.checked?null:clampMargin(number.value)??autoMargin()}));
  zoom.addEventListener('input',() => save({galleryZoom:Number(zoom.value)})); focalX.addEventListener('input',() => save({galleryFocalX:Number(focalX.value)/100})); focalY.addEventListener('input',() => save({galleryFocalY:Number(focalY.value)/100}));
  let saveTimer=0;
  function preview(value,source) {
    const margin=clampMargin(value); if(margin===null) return;
    root.style.setProperty('--wv-margin',`${margin}px`); if(source!==range) range.value=String(margin); if(source!==number) number.value=String(margin);
    clearTimeout(saveTimer); saveTimer=setTimeout(() => { saveTimer=0; save({margin}); },180);
  }
  function commit(value) {
    clearTimeout(saveTimer); saveTimer=0; const margin=clampMargin(value)??clampMargin(current.margin)??autoMargin(); range.value=number.value=String(margin); save({margin});
  }
  range.addEventListener('input',() => preview(range.value,range)); range.addEventListener('change',() => commit(range.value));
  number.addEventListener('input',() => { if(number.validity.valid) preview(number.value,number); }); number.addEventListener('change',() => commit(number.value));
  reset.addEventListener('click',() => {
    clearTimeout(saveTimer); saveTimer=0; try { store.reset(); } catch { /* Keep the current view. */ } apply(read());
    const live=$('announcement'); if(live) live.textContent='View reset. Favorites, lists and notes were kept.';
  });
  savePresentation.addEventListener('click',async () => {
    if(savePresentation.disabled) return; savePresentation.disabled=true; presentationStatus.textContent='Saving presentation…';
    try { await store.savePresentation(); presentationStatus.textContent='Presentation saved. Exported projects will retain these choices.'; }
    catch(error) { presentationStatus.textContent=`Could not save presentation: ${error.message || 'Project storage is unavailable.'}`; }
    finally { savePresentation.disabled=false; }
  });
  function place() {
    const anchor=settingsButton.getBoundingClientRect(), width=panel.offsetWidth, viewport=root.clientWidth;
    panel.style.left=`${Math.round(Math.max(8,Math.min(anchor.right-width,viewport-width-8)))}px`; panel.style.top=`${Math.round(Math.max(8,Math.min(anchor.bottom+6,innerHeight-panel.offsetHeight-8)))}px`;
  }
  function openPanel() { panel.hidden=false; place(); settingsButton.setAttribute('aria-expanded','true'); $('wv-grouping-field').hidden?automatic.focus({preventScroll:true}):grouping.focus({preventScroll:true}); }
  function closePanel(returnFocus) { if(panel.hidden) return; panel.hidden=true; settingsButton.setAttribute('aria-expanded','false'); if(saveTimer) commit(range.value); if(returnFocus) settingsButton.focus({preventScroll:true}); }
  settingsButton.addEventListener('click',() => panel.hidden?openPanel():closePanel(false));
  document.addEventListener('pointerdown',event => { if(!panel.hidden && !panel.contains(event.target) && !settingsButton.contains(event.target)) closePanel(false); });
  panel.addEventListener('focusout',event => { if(event.relatedTarget && !panel.contains(event.relatedTarget) && event.relatedTarget!==settingsButton) closePanel(false); });
  addEventListener('resize',() => { if(current.margin===null) apply(current); if(!panel.hidden) place(); });
  addEventListener('scroll',() => { if(!panel.hidden) place(); },{capture:true,passive:true});
  document.addEventListener('keydown',event => {
    if(event.key!=='Escape' || event.defaultPrevented) return;
    if(!panel.hidden) { event.preventDefault(); closePanel(true); return; }
    if(current.focus && !document.querySelector('dialog[open]')) { event.preventDefault(); save({focus:false}); settingsButton.focus({preventScroll:true}); }
  });
  document.addEventListener('workspace:preferenceschange',event => apply(event.detail?.preferences || read()));
  document.addEventListener('presentation:viewchange',syncContext);
  document.addEventListener('studio:change',() => { renderMetadataChoices(); apply(read()); });
  renderMetadataChoices(); apply(current); syncFilterFlag();
})();
