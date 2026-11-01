'use strict';
/*
 * What the app believes before anyone tells it otherwise.
 *
 * Kept apart from the stores that hold them because there are two: the
 * desktop app writes JSON files under the user's profile, the web build uses
 * the browser's own storage. Both start from exactly these values, so a
 * report run on one and a report run on the other rest on the same
 * assumptions rather than on whichever defaults each shell happened to
 * declare.
 */

/*
 * Sign-off labels. `as` is how a label reads in a summary -- several codes can
 * mean the same outcome -- and the colour is the one it is drawn in. A site
 * will usually replace this list with its own vocabulary; it is a starting
 * point, not a standard.
 */
const DEFAULT_LABELS = [
  { code: '—', text: 'Not set', colour: '#8b95a5', as: 'Neutral', dflt: true },
  { code: 'PASS', text: 'Passed', colour: '#3fb950', as: 'Pass', dflt: false },
  { code: 'FAIL', text: 'Failed', colour: '#f85149', as: 'Fail', dflt: false },
  { code: 'NOOP', text: 'No operation', colour: '#d29922', as: 'Skipped', dflt: false },
  { code: 'NO TEST', text: 'Not tested', colour: '#8b95a5', as: 'Skipped', dflt: false },
  { code: 'N/A', text: 'Not applicable', colour: '#8b95a5', as: 'Neutral', dflt: false },
  { code: 'DEFER', text: 'Deferred to next outage', colour: '#d29922', as: 'Skipped', dflt: false },
  { code: 'RETEST', text: 'Retest required', colour: '#f85149', as: 'Fail', dflt: false }
];

const DEFAULT_CONFIG = {
  labels: DEFAULT_LABELS,
  engineers: [],
  org: {
    utility: '',
    division: '',
    titlePrefix: 'Line Protection Test Record',
    footer: ''
  },
  defaults: {
    faultModel: 'sourceImpedance',
    testCurrent: 5.0,
    infeed: 0.65,
    vnom: 67.0,
    inZonePct: 85,
    outZonePct: 110,
    warnVolts: 100
  }
};

const DEFAULT_THEME = {
  preset: 'ender-dark',
  accent: '#4f9dff',
  roles: {},
  textSize: 14,
  density: 'normal'
};

/* The merge both stores apply when reading. Stored labels replace the
 * defaults wholesale rather than merging, because a site that has written its
 * own vocabulary does not want ours reappearing underneath it. */
function mergeConfig(stored) {
  const s = stored || {};
  return {
    labels: s.labels && s.labels.length ? s.labels : DEFAULT_CONFIG.labels,
    engineers: s.engineers || DEFAULT_CONFIG.engineers,
    org: Object.assign({}, DEFAULT_CONFIG.org, s.org),
    defaults: Object.assign({}, DEFAULT_CONFIG.defaults, s.defaults)
  };
}

const mergeTheme = (stored) => Object.assign({}, DEFAULT_THEME, stored || {});

const clone = (v) => JSON.parse(JSON.stringify(v));

module.exports = {
  DEFAULT_LABELS, DEFAULT_CONFIG, DEFAULT_THEME, mergeConfig, mergeTheme, clone
};
