const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
function open(file, hash = '') {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), { url: 'http://localhost/' + file + hash, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  const RealDate = w.Date;
  w.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-11-14T12:00:00'])); } static now() { return +new RealDate('2026-11-14T12:00:00'); } };
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(root, script.getAttribute('src')), 'utf8'));
  return { dom, w, d: w.document, errors, close() { dom.window.close(); } };
}
test('dashboard loads a complete overview without runtime errors', async t => {
  const ui = open('dashboard.html'); t.after(() => ui.close()); await wait();
  assert.equal(ui.d.querySelector('#page-home').hidden, false);
  assert.equal(ui.d.querySelectorAll('#home-allowances .allowance-card').length, 3);
  assert.equal(ui.d.querySelector('#rule-count').textContent, '3 site boundaries');
  assert.equal(ui.d.querySelector('#preview-badge').hidden, false);
  assert.deepEqual(ui.errors, []);
});
test('all main navigation routes work and settings fill correctly', async t => {
  const ui = open('dashboard.html'); t.after(() => ui.close()); await wait();
  for (const page of ['thaw', 'help', 'stats', 'settings', 'home']) {
    ui.w.location.hash = page; await wait();
    assert.equal(ui.d.querySelector('#page-' + page).hidden, false);
    assert.equal(ui.d.querySelectorAll('.page:not([hidden])').length, 1);
  }
  assert.equal(ui.d.querySelector('#youtube-minutes').value, '30');
  assert.equal(ui.d.querySelectorAll('#site-rules .rule-row').length, 3);
  assert.deepEqual(ui.errors, []);
});
test('saving settings persists site rules, budgets, phrases, and support data', async t => {
  const ui = open('dashboard.html', '#settings'); t.after(() => ui.close()); await wait();
  ui.d.querySelector('#add-site').click();
  ui.d.querySelector('#site-rules').lastElementChild.querySelector('[data-domain]').value = 'example.com';
  ui.d.querySelector('#youtube-minutes').value = '12';
  ui.d.querySelector('#weekend-minutes').value = '45';
  ui.d.querySelector('#bypass-phrase').value = 'My new boundary';
  ui.d.querySelector('#promises').value = 'Keep the promise';
  ui.d.querySelector('#resources').value = 'A useful article | https://example.org/article';
  ui.d.querySelector('#settings-form button[type=submit]').click(); await wait();
  const s = JSON.parse(ui.w.localStorage.getItem('blockout-preview'));
  assert.equal(s.config.sites.at(-1).domain, 'example.com');
  assert.equal(s.config.youtube.minutes, 12); assert.equal(s.config.allowances.weekend.minutes, 45);
  assert.equal(s.config.bypassText, 'My new boundary'); assert.equal(s.config.promises[0], 'Keep the promise');
  assert.equal(s.config.resources[0].url, 'https://example.org/article');
  assert.equal(ui.d.querySelector('#bypass-phrase').value, ''); assert.deepEqual(ui.errors, []);
});
test('malformed keyword groups show a useful validation error', async t => {
  const ui = open('dashboard.html', '#settings'); t.after(() => ui.close()); await wait();
  ui.d.querySelector('#youtube-keywords').value = 'missing separator';
  ui.d.querySelector('#settings-form button[type=submit]').click(); await wait();
  assert.match(ui.d.querySelector('#toast').textContent, /Category: phrase/);
});
test('thaw buttons start and stop an allowance without navigation', async t => {
  const ui = open('dashboard.html', '#thaw'); t.after(() => ui.close()); await wait();
  const button = ui.d.querySelector('#thaw-allowances [data-kind=weekend] button');
  button.click(); await wait();
  assert.match(button.textContent, /Stop/);
  button.click(); await wait();
  assert.match(button.textContent, /Start/); assert.deepEqual(ui.errors, []);
});
test('Need Help supports follow-up questions and actionable results', async t => {
  const ui = open('dashboard.html', '#help'); t.after(() => ui.close()); await wait();
  const buttons = ui.d.querySelectorAll('#help-options button'); assert.equal(buttons.length, 5);
  buttons[1].click(); assert.match(ui.d.querySelector('#help-question').textContent, /support/);
  ui.d.querySelectorAll('#help-options button')[1].click();
  assert.equal(ui.d.querySelector('#help-result').hidden, false);
  assert.equal(ui.d.querySelector('#help-result a').href, 'https://chatgpt.com/');
  ui.d.querySelector('#help-reset').click(); assert.equal(ui.d.querySelectorAll('#help-options button').length, 5);
  assert.deepEqual(ui.errors, []);
});
test('stats render empty-state cards and an accessible seven-day chart', async t => {
  const ui = open('dashboard.html', '#stats'); t.after(() => ui.close()); await wait();
  assert.equal(ui.d.querySelectorAll('.stat-card').length, 4);
  assert.equal(ui.d.querySelectorAll('.chart-column').length, 7);
  assert.match(ui.d.querySelector('#daily-chart').getAttribute('aria-label'), /blocked attempts/);
  assert.match(ui.d.querySelector('#stats-sites').textContent, /No blocked attempts/);
  assert.deepEqual(ui.errors, []);
});
test('popup connects and shows the three allowance controls', async t => {
  const ui = open('popup.html'); t.after(() => ui.close()); await wait();
  assert.equal(ui.d.querySelectorAll('.allowance-row').length, 3);
  assert.match(ui.d.querySelector('#youtube-time').textContent, /30:00/);
  assert.equal(ui.d.querySelector('#error').textContent, ''); assert.deepEqual(ui.errors, []);
});
test('challenge uses safe text, shows its phrase, and submits a deliberate exception', async t => {
  const dom = new JSDOM('<body><div id="host"></div></body>', { runScripts: 'outside-only', url: 'https://youtube.com/watch?v=x' }); t.after(() => dom.window.close());
  const w = dom.window; w.eval(fs.readFileSync(path.join(root, 'challenge.js'), 'utf8'));
  const calls = [];
  const screen = w.BlockoutChallenge(w.document.getElementById('host'), async message => { calls.push(message); return message.action === 'challengeHint' ? { phrase: 'A deliberate exception' } : { ok: true }; });
  const shadow = w.document.getElementById('host').shadowRoot;
  screen.update({ reason: 'keyword', category: '<script>bad()</script>', domain: 'youtube.com', signature: 'x', bypass: true }, { promises: ['Keep going'] });
  assert.equal(shadow.querySelectorAll('script').length, 0);
  shadow.querySelector('#begin').click(); await wait(); assert.equal(shadow.querySelector('#challenge').hidden, false);
  shadow.querySelector('#show').click(); await wait(); assert.equal(shadow.querySelector('#hint').textContent, 'A deliberate exception');
  shadow.querySelector('#phrase').value = 'A deliberate exception';
  shadow.querySelector('#challenge').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait();
  assert.equal(calls.at(-1).action, 'bypass'); assert.equal(calls.at(-1).phrase, 'A deliberate exception');
  screen.destroy(); assert.equal(w.document.getElementById('host'), null);
});
test('content enforcement pauses media, makes the page inert, and restores it after bypass', async t => {
  const dom = new JSDOM('<body><h1 class="ytd-watch-metadata">A restoration</h1><video></video></body>', { runScripts: 'outside-only', url: 'https://youtube.com/watch?v=x' }); t.after(() => dom.window.close());
  const w = dom.window; let paused = 0, listener;
  w.document.querySelector('video').pause = () => paused++;
  const block = { reason: 'keyword', category: 'Car projects', domain: 'youtube.com', signature: 'x', bypass: true };
  w.chrome = { runtime: { async sendMessage() { return { block, config: { promises: [] } }; }, onMessage: { addListener(fn) { listener = fn; } } } };
  w.eval(fs.readFileSync(path.join(root, 'challenge.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8'));
  await wait();
  assert.ok(w.document.getElementById('blockout-boundary')); assert.equal(w.document.body.inert, true); assert.ok(paused > 0);
  listener({ action: 'enforce', block: null });
  assert.equal(w.document.getElementById('blockout-boundary'), null); assert.equal(w.document.body.inert, false);
});
