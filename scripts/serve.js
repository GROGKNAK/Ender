'use strict';
/*
 * Serves the built site for local checking.
 *
 * The web build is static -- no server is involved in running it, and the
 * published copy is files on a CDN. This exists only because browsers apply
 * different rules to file:// pages than to served ones, and checking the app
 * under file:// would be checking something nobody will ever run.
 *
 *   node scripts/serve.js [port] [dir]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 4173;
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'site'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(String(req.url).split('?')[0]);
  // Resolve inside ROOT and refuse anything that climbs out of it.
  const target = path.resolve(ROOT, '.' + (url.endsWith('/') ? url + 'index.html' : url));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (err, body) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + url);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store'
    }).end(body);
  });
}).listen(PORT, () => {
  console.log('serving ' + ROOT + ' on http://localhost:' + PORT);
});
