const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'dashboard.html' : pathname.slice(1);
  // Preview serves only shipped frontend files; no backups or local project internals.
  if (!/^[a-z-]+\.(html|css|js)$/.test(name) || ['background.js'].includes(name)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, name), (error, data) => { res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(name)] || 'text/plain' }); res.end(error ? 'Not found' : data); });
}).listen(4173, '127.0.0.1', () => console.log('Blockout preview: http://127.0.0.1:4173 (demo data only; no browser blocking)'));
