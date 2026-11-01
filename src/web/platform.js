'use strict';
/*
 * The browser standing in for a computer.
 *
 * The shared session asks for five things -- read a source, hash it, measure
 * it, name it, and say what version is running -- and this is the browser's
 * answer to each. Nothing is uploaded: a dropped file is read in the page
 * with the File API, and relay settings never leave the machine they were
 * opened on.
 *
 * The session deals in opaque targets, which on the desktop happen to be file
 * paths. Here they are tokens standing for files the user chose, so the views
 * can keep handing the same kind of value around without caring which build
 * they are running in.
 */

const { readZip, sortSources, TEXTY } = require('../core/bundle');

const stash = new Map();
let seq = 0;

/** Remember a chosen file or folder and return the token that stands for it. */
function keep(label, files) {
  seq += 1;
  const token = 'web:' + seq + ':' + label;
  stash.set(token, { label, files });
  return token;
}

const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '';

/* A token's display name is the part after the sequence number. Falling back
 * to plain basename keeps this honest if it is ever handed a real path. */
function labelOf(target) {
  const entry = stash.get(target);
  if (entry) return entry.label;
  return basename(String(target).replace(/^web:\d+:/, ''));
}

/*
 * The browser's inflate. DecompressionStream is asynchronous, which is why
 * the shared zip reader takes its inflate as an argument rather than reaching
 * for Node's synchronous one.
 */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readSource(target) {
  const entry = stash.get(target);
  if (!entry) throw new Error('That file is no longer open. Choose it again.');
  const { label, files } = entry;

  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    return { label, kind: 'zip', sources: sortSources(await readZip(bytes, inflateRaw)) };
  }

  if (files.length === 1) {
    return {
      label,
      kind: 'file',
      sources: [{ name: files[0].name, text: await files[0].text() }]
    };
  }

  /*
   * A chosen folder. webkitRelativePath carries the path inside it, which is
   * what the group ranking reads, and the same filter the desktop uses keeps
   * binaries and stray markers out.
   */
  const wanted = files.filter((f) => TEXTY.test(f.name));
  if (!wanted.length) throw new Error('No readable settings files in that folder');
  const sources = await Promise.all(wanted.map(async (f) => ({
    name: f.webkitRelativePath || f.name,
    text: await f.text()
  })));
  return { label, kind: 'folder', sources: sortSources(sources) };
}

async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  /*
   * SubtleCrypto needs a secure context. A page served over plain HTTP from
   * somewhere other than localhost has none, and the hash is only ever used
   * to tell two files apart and to stamp provenance, so a readable marker
   * beats failing the load outright.
   */
  if (!(window.crypto && window.crypto.subtle)) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    }
    return 'nodigest' + h.toString(16).padStart(8, '0').repeat(6);
  }
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------ choosing --- */

/*
 * A file dialog, as a promise. The input is thrown away each time: reusing
 * one means choosing the same file twice in a row fires no change event, and
 * the second load silently does nothing.
 */
function choose({ folder, accept }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (folder) {
      input.webkitdirectory = true;
    } else if (accept) {
      input.accept = accept;
    }
    input.style.display = 'none';
    const done = (value) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

async function pick() {
  const files = await choose({ accept: '.html,.htm,.txt,.csv,.tsv,.json,.set,.rdb,.cfg,.zip' });
  if (!files || !files.length) return null;
  return keep(files[0].name, files);
}

async function pickFolder() {
  const files = await choose({ folder: true });
  if (!files || !files.length) return null;
  const first = files[0].webkitRelativePath || files[0].name;
  return keep(first.split('/')[0] || 'folder', files);
}

/** The token for a file dropped onto the page. */
const tokenFor = (file) => keep(file.name, [file]);

/** The token for a whole drop, which may be one file or several. */
function tokenForDrop(files) {
  const list = [...files];
  if (!list.length) return '';
  if (list.length === 1) return tokenFor(list[0]);
  const rel = list[0].webkitRelativePath || '';
  return keep(rel ? rel.split('/')[0] : list.length + ' files', list);
}

/* ------------------------------------------------------------- demo ---- */

/*
 * The demo pair ships with the site. Fetched rather than embedded so the
 * sample files stay the same ones the desktop app and the tests read.
 */
async function demoToken(end, file) {
  const res = await fetch('samples/' + file, { cache: 'no-cache' });
  if (!res.ok) throw new Error('The demo settings could not be loaded (HTTP ' + res.status + ')');
  const blob = await res.blob();
  return keep(file, [new File([blob], file, { type: 'text/html' })]);
}

/* ---------------------------------------------------------- delivery --- */

/** Hand the finished file to the browser's downloads. */
function download(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: Safari has been known to cancel a download whose blob url
  // disappears while it is still being written.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

module.exports = {
  readSource, hash, basename, labelOf, keep,
  pick, pickFolder, tokenFor, tokenForDrop, demoToken,
  download, inflateRaw,
  byteLength: (text) => new TextEncoder().encode(text).length
};
