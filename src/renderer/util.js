'use strict';
/*
 * Shared renderer helpers.
 *
 * The renderer owns no engineering: everything here is formatting, DOM
 * building and escaping. If a function in this file ever needs to know what a
 * zero-sequence impedance is, it belongs in src/core instead.
 */

const U = (function () {
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const n = (v, dp = 3) =>
    (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(dp));

  const deg = (v) => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1) + '°';
  const deg2 = (v) => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '°';

  // Complex values arrive over IPC as plain {re, im}.
  const abs = (z) => Math.hypot(z.re, z.im);
  const arg = (z) => {
    let d = Math.atan2(z.im, z.re) * 180 / Math.PI;
    if (d <= -180) d += 360;
    if (d > 180) d -= 360;
    return d;
  };
  const polar = (z, unit, dp = 3) => n(abs(z), dp) + (unit ? ' ' + unit : '') + ' ∠ ' + deg2(arg(z));

  const OHM = 'Ω';

  function tip(label, title, text, formula, right) {
    const code = formula ? '<span class="tcode">' + esc(formula) + '</span>' : '';
    return '<span class="tip' + (right ? ' right' : '') + '">' + label +
      '<span class="q">?</span><span class="tipbox"><b>' + esc(title) + '</b>' +
      esc(text) + code + '</span></span>';
  }

  const tag = (text, kind) => '<span class="tag ' + kind + '">' + esc(text) + '</span>';

  function hexA(hex, a) {
    const v = parseInt(String(hex).replace('#', ''), 16);
    if (!Number.isFinite(v)) return '';
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }

  function toast(message, bad) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    const mark = document.createElement('span');
    mark.className = 'ok';
    mark.textContent = bad ? '!' : '✓';
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(mark);
    el.appendChild(text);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, 2400);
  }

  /* Wrap an async action so a failure is reported rather than swallowed. */
  function guard(fn, okMessage) {
    return async function wrapped(...args) {
      try {
        const out = await fn(...args);
        if (okMessage && out !== null && out !== false) toast(typeof okMessage === 'function' ? okMessage(out) : okMessage);
        return out;
      } catch (err) {
        toast(err.message || String(err), true);
        return null;
      }
    };
  }

  /* Delegated click handling keeps re-rendered views from leaking listeners. */
  function on(root, selector, event, handler) {
    root.addEventListener(event, (e) => {
      const hit = e.target.closest(selector);
      if (hit && root.contains(hit)) handler(e, hit);
    });
  }

  const bytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  const when = (iso) => (iso ? String(iso).slice(0, 10) : '—');

  return { esc, n, deg, deg2, abs, arg, polar, OHM, tip, tag, hexA, toast, guard, on, bytes, when };
}());
