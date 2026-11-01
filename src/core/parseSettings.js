'use strict';
/*
 * Reads an acSELerator settings export into a flat map of setting name to raw
 * string value.
 *
 * The real export is a report table with a header row -- Group, Setting,
 * Range, Default Value, Value, Delta, Description, Comments, Hidden -- so the
 * value is NOT the cell next to the name. Walking cells in pairs picks up the
 * Range text instead, which looks plausible and is entirely wrong. The parser
 * therefore locates the header and reads by column.
 *
 * Settings are repeated per setting group (1..6, L1..L6 on a 311L), so the
 * same mnemonic appears many times with different values. Taking the first
 * sighting would silently choose a group, so groups are kept separately and
 * the chosen one is recorded.
 *
 * Other layouts exist, and an export that does not carry a recognisable header
 * falls back to pair-walking. Anything unrecognised is kept rather than
 * dropped, so a mapping gap is visible instead of silent.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°',
  Omega: 'Ω', ang: '∠', minus: '−', ndash: '–', mdash: '—'
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name] !== undefined ? ENTITIES[name] : m));
}

function clean(s) {
  return decodeEntities(String(s))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNoise(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
}

/* A setting mnemonic: no spaces, short, at least one letter. Deliberately
 * accepts a lowercase start, because k0M1 and k0A1 are real setting names. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_#.]{0,23}$/;
const ALL_DIGITS = /^[-+−]?[\d.,]+$/;

function looksLikeName(s) {
  if (!s || s.length > 24) return false;
  if (!NAME_RE.test(s)) return false;
  if (ALL_DIGITS.test(s)) return false;        // a bare number is a value
  return /[A-Za-z]/.test(s);
}

function tableRows(html) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(clean(c[2].replace(/<[^>]+>/g, ' ')));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/*
 * Find the header and the Setting/Value column pairs.
 *
 * Pairs rather than a single pair because some exports lay out two columns of
 * settings side by side ("Setting | Value | Setting | Value"). Each Setting
 * column is matched with the next column headed exactly "Value" -- exactly,
 * so "Default Value" is never mistaken for it.
 */
function findHeader(rows) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const head = rows[i].map((c) => c.toLowerCase());
    const names = [];
    const values = [];
    head.forEach((c, j) => {
      if (c === 'setting' || c === 'setting name' || c === 'name') names.push(j);
      if (c === 'value' || c === 'setting value') values.push(j);
    });
    if (!names.length || !values.length) continue;

    const pairs = [];
    for (const nameIdx of names) {
      const valueIdx = values.find((v) => v > nameIdx);
      if (valueIdx !== undefined) pairs.push([nameIdx, valueIdx]);
    }
    if (pairs.length) {
      return { row: i, pairs, group: head.indexOf('group'), width: head.length };
    }
  }
  return null;
}

/*
 * Read the Setting/Value columns out of each row.
 *
 * A row can be wider than the header when an export lays several settings
 * side by side under one set of headings, so the column pattern is repeated
 * across the row in blocks of the header's width. Without this, every setting
 * past the first block is silently dropped.
 */
function fromHeaderTable(rows, header, put) {
  const block = Math.max(1, header.width);
  for (let i = header.row + 1; i < rows.length; i += 1) {
    const r = rows[i];
    const group = header.group >= 0 && header.group < r.length ? r[header.group] : null;
    for (let offset = 0; offset < r.length; offset += block) {
      for (const [nameIdx, valueIdx] of header.pairs) {
        const nameAt = nameIdx + offset;
        const valueAt = valueIdx + offset;
        if (r.length <= valueAt) continue;
        const name = r[nameAt];
        const value = r[valueAt];
        if (!looksLikeName(name)) continue;
        if (value === undefined || value === '') continue;
        put(name, value, 'column', group);
      }
    }
  }
}

/* Fallback for exports with no usable header: name, then the next cell. */
function fromPairs(rows, put) {
  for (const cells of rows) {
    if (cells.length < 2) continue;
    for (let i = 0; i + 1 < cells.length; i += 1) {
      if (looksLikeName(cells[i]) && cells[i + 1] !== '') {
        put(cells[i], cells[i + 1], 'pair', null);
        i += 1;
      }
    }
  }
}

/* ------------------------------------------------------- other formats -- */

/*
 * Exports arrive as HTML reports, CSV or tab-separated dumps, SEL text
 * settings files and Grid Configurator JSON. Only the way rows are obtained
 * differs; the header / pair / text logic below is shared, so adding a format
 * means adding a row source and nothing else.
 */
function detectKind(text, fileName) {
  const head = text.slice(0, 4000);
  if (/<\s*(table|html|tr|body)\b/i.test(head)) return 'html';
  if (looksNative(text)) return 'native';
  const ext = String(fileName || '').toLowerCase().replace(/^.*\./, '');
  if (ext === 'json' || /^\s*[[{]/.test(head)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch (err) {
      // not JSON after all; fall through
    }
  }
  if (delimiterOf(text)) return 'delimited';
  return 'text';
}

/* The delimiter that appears consistently across the first several lines. */
function delimiterOf(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  if (lines.length < 2) return null;
  let best = null;
  for (const d of ['\t', ',', ';', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min < 1) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = min * consistent;
    if (!best || score > best.score) best = { d, score };
  }
  return best ? best.d : null;
}

/* Delimited rows, honouring double-quoted fields. */
function delimitedRows(text) {
  const d = delimiterOf(text);
  if (!d) return [];
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === d) { cells.push(clean(cur)); cur = ''; } else cur += ch;
    }
    cells.push(clean(cur));
    rows.push(cells);
  }
  return rows;
}

/*
 * JSON exports. The shape is not fixed, so walk the tree and take anything
 * that reads as a setting: an object of name -> scalar, or an array of
 * objects carrying a name-ish and a value-ish key.
 */
function fromJson(text, put) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    return;
  }
  const NAME_KEYS = ['name', 'setting', 'settingname', 'mnemonic', 'id', 'key'];
  const VALUE_KEYS = ['value', 'settingvalue', 'val', 'current'];
  const GROUP_KEYS = ['group', 'settinggroup', 'groupname'];
  const lower = (o) => {
    const out = {};
    for (const k of Object.keys(o)) out[k.toLowerCase().replace(/[^a-z]/g, '')] = o[k];
    return out;
  };

  (function walk(node, group) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, group);
      return;
    }
    const l = lower(node);
    const nameKey = NAME_KEYS.find((k) => typeof l[k] === 'string');
    const valueKey = VALUE_KEYS.find((k) => l[k] !== undefined && typeof l[k] !== 'object');
    const groupKey = GROUP_KEYS.find((k) => l[k] !== undefined && typeof l[k] !== 'object');
    const here = groupKey ? String(l[groupKey]) : group;

    if (nameKey && valueKey && looksLikeName(String(l[nameKey]))) {
      put(String(l[nameKey]), String(l[valueKey]), 'json', here || null);
    } else {
      for (const [k, v] of Object.entries(node)) {
        if (v === null) continue;
        if (typeof v === 'object') walk(v, here);
        else if (looksLikeName(k)) put(k, String(v), 'json', here || null);
      }
    }
  }(root, null));
}

/*
 * The native acSELerator database export: one file per settings group, in an
 * INI-ish shape.
 *
 *   [INFO]
 *   RELAYTYPE=SEL-311L-1
 *   FID=SEL-311L-1-R502-V0-Z106006-D20141106
 *   [1]
 *   RID,"SEL-311L LINE RELAY L2P"
 *   CTR,"120"
 *
 * The section header is the settings group, so a folder of set_1.txt ..
 * set_6.txt carries the same groups the HTML report does. [INFO] is metadata
 * rather than a group, so its keys are recorded ungrouped.
 */
const NATIVE_SECTION = /^\[([^\]\r\n]{1,24})\]$/;
const NATIVE_QUOTED = /^([A-Za-z0-9_#.]{1,24})\s*,\s*"([\s\S]*)"\s*$/;
const NATIVE_BARE = /^([A-Za-z0-9_#.]{1,24})\s*[,=]\s*(.*)$/;

function looksNative(text) {
  const head = text.slice(0, 2000);
  if (!/^\s*\[[^\]\r\n]{1,24}\]\s*$/m.test(head)) return false;
  return /^[A-Za-z0-9_#.]{1,24}\s*[,=]/m.test(head);
}

function fromNative(text, put) {
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    // Lines are terminated with a record separator (0x1C) and may carry other
    // control bytes. Left in place they end up inside the value.
    const line = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
    if (!line) continue;

    const sec = line.match(NATIVE_SECTION);
    if (sec) {
      section = sec[1].trim();
      continue;
    }

    const m = line.match(NATIVE_QUOTED) || line.match(NATIVE_BARE);
    if (!m) continue;
    const name = m[1];
    if (!looksLikeName(name)) continue;
    const value = m[2].replace(/^"|"$/g, '').trim();
    if (value === '') continue;

    // [INFO] holds device metadata, not a protection group.
    const group = section && !/^info$/i.test(section) ? section : null;
    put(name, value, 'native', group);
  }
}

/* Last resort: "NAME = VALUE" in running text, for FID lines and the like. */
function fromText(html, put) {
  /* Line by line, because a line break is the only thing that reliably ends a
   * value here. Collapsing whitespace first would let one value swallow the
   * rest of the file. */
  const text = decodeEntities(String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/ /g, ' ');

  const re = /^[\s>*#-]*([A-Za-z0-9][A-Za-z0-9_#.]{1,23})[ \t]*(?::=|=)[ \t]*(.+?)[ \t]*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    if (looksLikeName(m[1]) && m[2].trim()) put(m[1], m[2].trim(), 'text', null);
  }
}

/**
 * Parse an export.
 *
 * @param {string} html raw file contents
 * @param {object} [opts] { group } to read a specific settings group
 */
function parseSettings(input, opts = {}) {
  const text = String(input);
  const kind = detectKind(text, opts.fileName);
  const doc = kind === 'html' ? stripNoise(text) : text;

  const entries = [];
  const groupOrder = [];
  const strategies = { column: 0, native: 0, pair: 0, json: 0, text: 0 };

  function put(name, value, how, group) {
    entries.push({ name: name.toUpperCase(), raw: name, value, how, group: group || null });
    strategies[how] += 1;
    if (group && !groupOrder.includes(group)) groupOrder.push(group);
  }

  let rows = [];
  if (kind === 'html') rows = tableRows(doc);
  else if (kind === 'delimited') rows = delimitedRows(doc);
  else if (kind === 'json') fromJson(doc, put);
  else if (kind === 'native') fromNative(doc, put);

  const header = rows.length ? findHeader(rows) : null;
  if (header) fromHeaderTable(rows, header, put);

  // Only fall back when the structured pass found little; otherwise
  // pair-walking would bury the correct values under hundreds of Range
  // strings taken from the column beside each name.
  const structured = strategies.column + strategies.json + strategies.native;
  if (structured < 10 && rows.length) {
    fromPairs(rows, put);
  }
  /*
   * Text scanning runs on whatever sits outside the tables, so a FID line in
   * a paragraph is still picked up without dragging hundreds of "Range = ..."
   * strings out of the table cells alongside it.
   */
  fromText(doc.replace(/<table\b[\s\S]*?<\/table>/gi, ' '), put);

  const byGroup = Object.create(null);
  for (const e of entries) {
    const bucket = e.group || '_';
    if (!byGroup[bucket]) byGroup[bucket] = Object.create(null);
    if (byGroup[bucket][e.name] === undefined) byGroup[bucket][e.name] = e.value;
  }

  const layout = header ? 'column'
    : (strategies.native ? 'native'
      : (strategies.json ? 'json' : (strategies.pair ? 'pair' : 'text')));

  return finalise({ byGroup, groupOrder, strategies, kind, layout }, opts);
}

/*
 * Flatten the per-group settings into the single view the rest of the app
 * reads, and record which group each value came from. Shared so that a folder
 * of per-group files resolves exactly the way one combined file does.
 */
function finalise(parts, opts = {}) {
  const { byGroup, groupOrder, strategies, kind, layout } = parts;

  // Numeric groups are the protection groups; prefer the requested one, then
  // the first numeric group, then whatever came first.
  const numeric = groupOrder.filter((g) => /^\d+$/.test(g));
  const chosen = (opts.group && groupOrder.includes(opts.group)) ? opts.group
    : (numeric[0] || groupOrder[0] || null);

  const values = Object.create(null);
  const origin = Object.create(null);
  const order = [];

  // Chosen group first, then ungrouped, then anything else; first wins.
  const preference = [chosen, '_'].concat(groupOrder.filter((g) => g !== chosen));
  for (const bucket of preference) {
    const set = byGroup[bucket];
    if (!set) continue;
    for (const name of Object.keys(set)) {
      if (values[name] !== undefined) continue;
      values[name] = set[name];
      origin[name] = bucket === '_' ? 'ungrouped' : 'group ' + bucket;
      order.push(name);
    }
  }

  return {
    values,
    order,
    origin,
    byGroup,
    groups: groupOrder,
    group: chosen,
    count: order.length,
    strategies,
    kind,
    layout,
    has: (name) => values[String(name).toUpperCase()] !== undefined,
    get: (name) => values[String(name).toUpperCase()],
    pairs: () => order.map((k) => ({ name: k, value: values[k], via: origin[k] })),

    /*
     * The same setting in other groups, where it carries a different value.
     * Those copies were disregarded in favour of the chosen group, and saying
     * so is more useful than hiding it.
     */
    others: (name) => {
      const key = String(name).toUpperCase();
      const mine = values[key];
      const out = [];
      for (const bucket of Object.keys(byGroup)) {
        if (bucket === chosen || bucket === '_') continue;
        const v = byGroup[bucket][key];
        if (v !== undefined && v !== mine) out.push({ group: bucket, value: v });
      }
      return out;
    }
  };
}

/**
 * Parse several files as one relay.
 *
 * The native export splits a relay across set_1.txt .. set_6.txt and friends,
 * so each file contributes its own settings group. Sources are taken in the
 * order given and the first sighting of a name within a group wins.
 *
 * @param {Array<{name: string, text: string}>} sources
 */
function parseMany(sources, opts = {}) {
  const byGroup = Object.create(null);
  const groupOrder = [];
  const strategies = {};
  const kinds = [];
  const layouts = [];
  const files = [];

  for (const source of sources) {
    const part = parseSettings(source.text, { fileName: source.name });
    files.push({ name: source.name, count: part.count, kind: part.kind, groups: part.groups });
    if (!part.count) continue;

    kinds.push(part.kind);
    layouts.push(part.layout);
    for (const g of part.groups) if (!groupOrder.includes(g)) groupOrder.push(g);
    for (const [g, set] of Object.entries(part.byGroup)) {
      if (!byGroup[g]) byGroup[g] = Object.create(null);
      for (const [name, value] of Object.entries(set)) {
        if (byGroup[g][name] === undefined) byGroup[g][name] = value;
      }
    }
    for (const [k, v] of Object.entries(part.strategies)) {
      strategies[k] = (strategies[k] || 0) + v;
    }
  }

  const unique = (xs) => [...new Set(xs)];
  const out = finalise({
    byGroup,
    groupOrder,
    strategies,
    kind: unique(kinds).join('+') || 'none',
    layout: unique(layouts).join('+') || 'none'
  }, opts);
  out.files = files;
  return out;
}

/**
 * Pull a number out of a raw setting value.
 * Handles "8.32", "8.32 Ohm", "OFF", "8,32" and a Unicode minus. Returns null
 * rather than NaN so a missing setting is distinguishable from a genuine zero.
 */
function toNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/−/g, '-').trim();
  if (/^(off|n\/?a|none|disabled|n|no)$/i.test(s)) return null;
  const m = s.match(/-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

module.exports = { parseSettings, parseMany, toNumber, clean, decodeEntities, looksLikeName };
