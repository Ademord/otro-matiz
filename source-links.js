/* Optional outbound links. Image sources remain governed by ProjectStore's local-image rules. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SourceLinks = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_LENGTH = 2048;
  const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
  const ENCODED_CONTROLS = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

  function inspect(value) {
    if (typeof value !== 'string' || !value) return {reason: 'must be a non-empty absolute HTTP or HTTPS URL'};
    if (value.length > MAX_LENGTH) return {reason: `is longer than ${MAX_LENGTH} characters`};
    if (CONTROLS.test(value) || ENCODED_CONTROLS.test(value)) return {reason: 'control characters are not allowed'};
    if (value !== value.trim()) return {reason: 'leading or trailing whitespace is not allowed'};
    if (!/^https?:\/\//i.test(value)) return {reason: 'only absolute HTTP or HTTPS URLs are allowed'};
    if (value.includes('\\')) return {reason: 'backslashes are not allowed'};
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/)[0];
    if (!authority) return {reason: 'must include a hostname after the scheme'};
    let url;
    try { url = new URL(value); }
    catch { return {reason: 'must be a valid absolute HTTP or HTTPS URL'}; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return {reason: 'only absolute HTTP or HTTPS URLs are allowed'};
    if (url.username || url.password || authority.includes('@')) return {reason: 'URLs containing credentials are not allowed'};
    if (url.href.length > MAX_LENGTH) return {reason: `normalized URL is longer than ${MAX_LENGTH} characters`};
    return {reason: '', url: url.href};
  }

  /** Return an empty string for a safe URL, otherwise a short validation reason. */
  function problem(value) { return inspect(value).reason; }
  /** Return the safe canonical URL, or an empty string for missing/unsafe input. */
  function normalize(value) { return inspect(value).url || ''; }
  /** A cell's link wins over its row's, which wins over its column's. Unsafe values never become links. */
  function resolve(cell, row, column) { return normalize(cell?.sourceUrl) || normalize(row?.sourceUrl) || normalize(column?.sourceUrl); }

  return Object.freeze({problem, normalize, resolve});
});
