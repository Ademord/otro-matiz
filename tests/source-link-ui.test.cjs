'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dataset, boot } = require('./helpers/presentation-harness.cjs');

function sourceDataset() {
  const data = dataset(2, 2);
  data.rows[0].sourceUrl = 'https://example.com/items/form-1';
  data.cells[0].sourceUrl = 'https://example.com/items/form-1?finish=1';
  return data;
}

function assertSource(link, href) {
  assert.ok(link, 'an outbound link exists');
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, href);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(link.getAttribute('aria-label'), /^Open source for .+ \(opens in a new tab\)$/);
  assert.equal(link.title, 'Open source · example.com');
  const icon = link.querySelector('.source-link-glyph');
  assert.equal(icon.tagName, 'SVG', 'the external-link icon does not depend on a font glyph');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.getAttribute('focusable'), 'false');
  assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(icon.getAttribute('stroke'), 'currentColor');
  assert.ok(icon.querySelector('path').getAttribute('d'));
  assert.equal(link.closest('button'), null, 'the link is separate from image and comparison controls');
}

test('Gallery and Matrix expose cell links, row fallbacks and no link for unrelated items', () => {
  const h = boot(sourceDataset());
  const expectations = [
    ['r0-c0', 'https://example.com/items/form-1?finish=1'],
    ['r0-c1', 'https://example.com/items/form-1']
  ];
  for (const [id, href] of expectations) {
    assertSource(h.card(id).querySelector('.source-link'), href);
    assertSource(h.app.cards.get(id).querySelector('.source-link'), href);
  }
  assert.equal(h.card('r1-c0').querySelector('.source-link'), null);
  assert.equal(h.app.cards.get('r1-c0').querySelector('.source-link'), null);
  assert.ok(h.card('r1-c0').querySelector('.look-title'), 'unlinked layouts retain their normal title');
});

test('source activation leaves Gallery and Matrix viewer, comparison and favorite state intact', () => {
  const h = boot(sourceDataset());
  for (const layout of ['gallery', 'matrix']) {
    h.window.StudioPresentation.setView(layout); h.flush();
    const card = layout === 'gallery' ? h.card('r0-c0') : h.app.cards.get('r0-c0');
    card.querySelector('.source-link').click();
    assert.equal(h.elements.viewer.open, false);
    assert.deepEqual([...h.app.selected], []);
    h.document.getElementById('present-compare-toggle').click();
    card.querySelector('.source-link-glyph').click(); h.flush();
    assert.equal(h.window.StudioPresentation.isComparing(), true);
    assert.equal(h.elements.viewer.open, false);
    assert.deepEqual([...h.app.selected], []);
    h.document.getElementById('present-compare-cancel').click(); h.flush();
  }
  assert.deepEqual(h.calls.viewers, []);
  assert.deepEqual(h.calls.favorites, []);
});

test('Favorites source links preserve saved-list selection and the shared comparison mode', () => {
  const h = boot(sourceDataset(), {}, true);
  h.window.MatrixFavorites.openList('review'); h.flush();
  const item = id => h.document.getElementById('fav-panel').querySelectorAll('.fav-item').find(node => node.dataset.favId === id);
  const link = item('r0-c1').querySelector('.source-link');
  assertSource(link, 'https://example.com/items/form-1');
  const box = item('r0-c0').querySelector('input');
  box.checked = true; box.dispatchEvent({type: 'change'});
  h.document.getElementById('present-compare-toggle').click(); h.flush();
  link.click(); h.flush();
  assert.equal(h.elements.viewer.open, false);
  assert.deepEqual([...h.app.selected], []);
  assert.deepEqual(Array.from(h.window.MatrixFavorites.getSelection()), ['r0-c0']);
  assert.deepEqual(h.project.favorites, ['r0-c0', 'r0-c1', 'r1-c0', 'r1-c1']);
  assert.deepEqual(h.project.lists[0].cellIds, ['r0-c0', 'r0-c1', 'r1-c0', 'r1-c1']);
});

test('expanded viewers label the source action and retain links while changing framing or comparing', () => {
  const h = boot(sourceDataset(), {}, true);
  h.card('r0-c0').querySelector('.look-open').click();
  let link = h.elements['viewer-content'].querySelector('.vex-source');
  assertSource(link, 'https://example.com/items/form-1?finish=1');
  assert.equal(link.querySelector('.source-link-label').textContent, 'Open source');
  h.elements['face-detail-button'].click();
  assert.equal(h.elements['viewer-content'].querySelector('.vex-source'), link);
  link.click();
  assert.deepEqual(Array.from(h.app.getViewerCells(), cell => cell.id), ['r0-c0']);
  assert.deepEqual([...h.app.selected], []);
  h.elements['close-viewer'].click();
  h.app.openViewer([h.app.cells.get('r0-c0'), h.app.cells.get('r0-c1')]);
  const links = h.elements['viewer-content'].querySelectorAll('.vex-source');
  assert.equal(links.length, 2);
  assertSource(links[0], 'https://example.com/items/form-1?finish=1');
  assertSource(links[1], 'https://example.com/items/form-1');
});

test('pending and failed previews keep useful source links without becoming comparison options', () => {
  const data = sourceDataset(); data.cells[1].status = 'pending'; delete data.cells[1].src;
  const h = boot(data);
  const pending = h.elements.matrix.querySelectorAll('td').find(node => node.dataset.cellId === 'r0-c1');
  assertSource(pending.querySelector('.source-link'), 'https://example.com/items/form-1');
  assertSource(h.card('r0-c1').querySelector('.source-link'), 'https://example.com/items/form-1');
  assert.equal(h.app.cards.has('r0-c1'), false);
  h.app.markImageFailed('r0-c0'); h.flush();
  const failed = h.elements.matrix.querySelectorAll('td').find(node => node.dataset.cellId === 'r0-c0');
  assertSource(failed.querySelector('.source-link'), 'https://example.com/items/form-1?finish=1');
  assertSource(h.card('r0-c0').querySelector('.source-link'), 'https://example.com/items/form-1?finish=1');
  assert.equal(h.app.isReady(h.app.cells.get('r0-c0')), false);
  assert.equal(h.card('r0-c0').querySelector('.look-open').disabled, true);
});

test('unsafe source values never appear as actionable UI links', () => {
  const data = dataset(1, 2);
  data.rows[0].sourceUrl = 'javascript:alert(1)';
  data.cells[0].sourceUrl = 'https://user:password@example.com/private';
  data.cells[1].sourceUrl = '//example.com/item';
  const h = boot(data, {}, true);
  assert.equal(h.document.querySelectorAll('.source-link').length, 0);
  h.window.MatrixFavorites.openInbox(); h.flush();
  assert.equal(h.document.querySelectorAll('.source-link').length, 0);
  h.card('r0-c0').querySelector('.look-open').click();
  assert.equal(h.elements['viewer-content'].querySelector('.vex-source'), null);
});
