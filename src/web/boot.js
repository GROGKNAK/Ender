'use strict';
/*
 * Boots the web build.
 *
 * The app's logic is CommonJS, written for the desktop app's main process and
 * shared with this one unchanged. The build step wraps each of those files in
 * a function and writes them to modules.js; this is the `require` that runs
 * them. No source is transformed -- every module body is the same text that
 * runs on the desktop -- and nothing is evaluated from a string, so the page
 * keeps a content security policy that forbids it.
 *
 * Nothing here talks to a server. The relay settings a user drops in are read
 * in the page and never leave it, which for this kind of data is the only
 * arrangement worth offering.
 */

(function () {
  const defs = window.__enderModules || {};
  const cache = Object.create(null);

  function fail(what, err) {
    const box = document.getElementById('boot');
    if (box) {
      box.className = 'bootfail';
      box.innerHTML = '<h1>Ender could not start</h1><p></p><pre></pre>';
      box.querySelector('p').textContent = what;
      box.querySelector('pre').textContent = String((err && err.stack) || err || '');
    }
    if (window.console) window.console.error(what, err);
  }

  /* ------------------------------------------------- the node that isn't --- */

  /*
   * Node built-ins the shared modules reach for. Only the parts actually used
   * in the browser are real: `path` is needed because the zip reader ranks
   * entries by file name, while `fs` cannot mean anything here and says so
   * rather than returning something plausible and wrong.
   */
  const missing = (name) => () => {
    throw new Error("'" + name + "' is not available in the browser build");
  };

  const STUBS = {
    fs: {
      readFileSync: missing('fs.readFileSync'),
      writeFileSync: missing('fs.writeFileSync'),
      readdirSync: missing('fs.readdirSync'),
      statSync: missing('fs.statSync'),
      existsSync: () => false,
      mkdirSync: missing('fs.mkdirSync'),
      unlinkSync: missing('fs.unlinkSync')
    },
    path: {
      basename: (p, ext) => {
        const base = String(p).split(/[\\/]/).filter(Boolean).pop() || '';
        return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
      },
      extname: (p) => {
        const base = String(p).split(/[\\/]/).pop() || '';
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.slice(dot) : '';
      },
      join: (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
      relative: (from, to) => String(to).slice(String(from).length).replace(/^[\\/]+/, '')
    },
    // The zip reader takes its inflate as an argument in this build, so the
    // synchronous one is never reached.
    zlib: { inflateRawSync: missing('zlib.inflateRawSync') }
  };

  /* ----------------------------------------------------------- require --- */

  function resolve(from, spec) {
    if (spec[0] !== '.') return spec;
    const base = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.' || part === '') continue;
      else if (part === '..') base.pop();
      else base.push(part);
    }
    return base.join('/').replace(/\.js$/, '');
  }

  function requireFrom(from) {
    return function req(spec) {
      const id = resolve(from, spec);
      if (id === 'pdf-lib') {
        if (!window.PDFLib) throw new Error('The PDF library did not load');
        return window.PDFLib;
      }
      if (id in STUBS) return STUBS[id];
      if (cache[id]) return cache[id].exports;

      const def = defs[id];
      if (!def) throw new Error('Unknown module: ' + spec + ' (as ' + id + ')');
      const module = { exports: {} };
      cache[id] = module;        // registered before running, so cycles resolve
      try {
        def(requireFrom(id), module, module.exports);
      } catch (err) {
        delete cache[id];
        err.message = id + '.js: ' + err.message;
        throw err;
      }
      return module.exports;
    };
  }

  /* -------------------------------------------------------------- boot --- */

  function script(src) {
    return new Promise((ok, no) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = ok;
      el.onerror = () => no(new Error('Could not load ' + src));
      document.head.appendChild(el);
    });
  }

  async function start() {
    const manifest = window.__enderManifest || {};

    if (!window.PDFLib) {
      return fail('The PDF library did not load, so reports could not be written.',
        new Error('window.PDFLib is undefined'));
    }
    if (!Object.keys(defs).length) {
      return fail('The application modules did not load.',
        new Error('window.__enderModules is empty'));
    }

    try {
      await requireFrom('web/boot')('./bridge').install();
    } catch (err) {
      return fail('The application failed to start.', err);
    }

    // The views are ordinary browser scripts and load the ordinary way, after
    // window.ender exists -- app.js reads it as soon as it runs.
    try {
      for (const src of manifest.scripts || []) await script(src);
    } catch (err) {
      return fail('The interface scripts could not be loaded.', err);
    }

    const box = document.getElementById('boot');
    if (box) box.remove();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
