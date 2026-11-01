'use strict';
/*
 * A relay's settings do not always arrive as one file.
 *
 * The native acSELerator export is a folder with one file per settings group
 * (set_1.txt .. set_6.txt, set_G.txt and so on), and that folder is usually
 * handed over zipped. This module turns any of those -- a zip, a folder, or a
 * single file -- into a list of named texts, so the parser upstream only ever
 * deals with text.
 *
 * The zip reader is implemented here rather than pulled in as a dependency:
 * it needs to handle stored and deflated entries and nothing else, and zlib
 * is already in Node.
 *
 * It reads bytes rather than Buffers and takes its inflate as an argument, so
 * the web build can hand it the browser's DecompressionStream and get the
 * same entries out. Zip parsing is fiddly enough that having two of them was
 * never going to end well.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DECODER = new TextDecoder('utf-8');

/* Node has a synchronous inflate; the browser does not, so the seam is async
 * on both sides and the web build passes its own. */
const nodeInflate = async (raw) => zlib.inflateRawSync(raw);

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/* Entries worth reading. Binary blobs and the odd marker file are skipped. */
const TEXTY = /\.(txt|html?|csv|tsv|json|set|rdb|cfg)$/i;

/**
 * Read a zip from bytes.
 * @param {Uint8Array|ArrayBuffer} buffer
 * @param {Function} [inflateRaw] async (Uint8Array) -> Uint8Array
 * @returns {Promise<Array<{name: string, text: string}>>}
 */
async function readZip(buffer, inflateRaw) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (i) => view.getUint32(i, true);
  const u16 = (i) => view.getUint16(i, true);
  const inflate = inflateRaw || nodeInflate;

  // The end-of-central-directory record is at the tail, after a comment of
  // unknown length, so scan backwards for its signature.
  let eocd = -1;
  const from = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (u32(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

  const count = u16(eocd + 10);
  let p = u32(eocd + 16);
  const out = [];

  for (let i = 0; i < count && p + 46 <= buf.length; i += 1) {
    if (u32(p) !== CEN_SIG) break;
    const method = u16(p + 10);
    const compressed = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOffset = u32(p + 42);
    const name = DECODER.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;                 // directory entry
    if (!TEXTY.test(name)) continue;

    if (u32(localOffset) !== LOC_SIG) continue;
    const lNameLen = u16(localOffset + 26);
    const lExtraLen = u16(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      try {
        data = await inflate(raw);
      } catch (err) {
        continue;                                      // unreadable entry
      }
    } else continue;                                   // unsupported method

    out.push({ name, text: DECODER.decode(data) });
  }

  if (!out.length) throw new Error('The zip holds no readable settings files');
  return out;
}

/*
 * Settings groups come out of file names as much as file contents, and the
 * protection groups matter most, so put set_1..set_N first and the rest after.
 * Whatever is read first wins a name collision.
 */
function rank(name) {
  const base = path.basename(name).toLowerCase();
  const numeric = base.match(/^set_(\d+)\./);
  if (numeric) return [0, Number(numeric[1])];
  if (/^set_/.test(base)) return [1, 0];
  if (/^cfg\./.test(base)) return [2, 0];
  return [3, 0];
}

function sortSources(sources) {
  return sources.slice().sort((a, b) => {
    const ra = rank(a.name);
    const rb = rank(b.name);
    return ra[0] - rb[0] || ra[1] - rb[1] || a.name.localeCompare(b.name);
  });
}

/** Every readable text file directly in a folder, and one level below it. */
function readFolder(dir) {
  const out = [];
  const walk = (base, depth) => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) walk(full, depth + 1);
      } else if (TEXTY.test(entry.name)) {
        out.push({ name: path.relative(dir, full), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir, 0);
  if (!out.length) throw new Error('No readable settings files in that folder');
  return out;
}

/**
 * Turn a path into the texts it holds.
 * @returns {{label: string, kind: string, sources: Array}}
 */
async function readSource(target) {
  const stat = fs.statSync(target);

  if (stat.isDirectory()) {
    return { label: path.basename(target), kind: 'folder', sources: sortSources(readFolder(target)) };
  }
  if (/\.zip$/i.test(target)) {
    return {
      label: path.basename(target),
      kind: 'zip',
      sources: sortSources(await readZip(fs.readFileSync(target)))
    };
  }
  return {
    label: path.basename(target),
    kind: 'file',
    sources: [{ name: path.basename(target), text: fs.readFileSync(target, 'utf8') }]
  };
}

module.exports = { readZip, readFolder, readSource, sortSources, TEXTY };
