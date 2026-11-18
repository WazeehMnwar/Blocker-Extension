const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
for (const name of fs.readdirSync(root).filter(n => n.endsWith('.js'))) cp.execFileSync(process.execPath, ['--check', path.join(root, name)], { stdio: 'inherit' });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'background-entry.js');
assert.equal(manifest.background.type, 'module');
assert.ok(!('scripts' in manifest.background), 'Edge MV3 source must not declare background.scripts');
assert.ok(!('browser_specific_settings' in manifest), 'Firefox settings belong only in the Firefox package');
const entryFiles = [manifest.background.service_worker, 'background.js', 'core.js', manifest.action.default_popup, manifest.options_ui.page, ...manifest.content_scripts.flatMap(c => c.js)];
for (const name of entryFiles) assert.ok(fs.existsSync(path.join(root, name)), 'Missing manifest entry: ' + name);
for (const name of fs.readdirSync(root).filter(n => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate IDs in ' + name);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(path.join(root, match[1])), 'Missing asset in ' + name + ': ' + match[1]);
  assert.ok(!/\son\w+=/i.test(html), 'Inline event handler violates extension CSP: ' + name);
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const js = fs.readFileSync(path.join(root, match[1]), 'utf8');
    const localIds = [...ids, ...[...js.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])];
    for (const ref of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(localIds.includes(ref[1]), `${match[1]} references missing #${ref[1]} in ${name}`);
  }
}
console.log('Syntax, manifest, HTML IDs, CSP, and local assets checked.');
