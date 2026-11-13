const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const B = require('../core.js');
const base = +new Date('2026-11-14T12:00:00');
const clone = value => structuredClone(value);
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, async emit(...args) { await Promise.all(listeners.map(fn => fn(...args))); }, listeners }; }
function store(data = {}) {
  return { data, async get(keys) {
    if (typeof keys === 'string') return { [keys]: clone(data[keys]) };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, clone(data[k])]));
    return { ...clone(keys), ...clone(data) };
  }, async set(value) { Object.assign(data, clone(value)); }, async remove(key) { delete data[key]; } };
}
async function worker(options = {}) {
  let now = options.now ?? base;
  let tabs = clone(options.tabs || []);
  const local = options.local || store(), session = options.session || store(), sync = options.sync || store();
  const sent = [], created = [];
  const api = {
    storage: { local, session, sync },
    runtime: { getURL: name => 'chrome-extension://blockout/' + name, onMessage: event(), onInstalled: event(), onStartup: event() },
    tabs: { async query() { return clone(tabs); }, async update(id, patch) { Object.assign(tabs.find(t => t.id === id), patch); }, async remove(id) { tabs = tabs.filter(t => t.id !== id); }, async sendMessage(id, message) { sent.push({ id, message: clone(message) }); }, async create(tab) { created.push(tab); }, onUpdated: event(), onRemoved: event(), onActivated: event() },
    windows: { async getLastFocused() { return { id: 1, focused: true }; }, onFocusChanged: event() },
    alarms: { async create() {}, onAlarm: event() }
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ chrome: api, console, URL, Date: Clock });
  vm.runInContext(fs.readFileSync(require.resolve('../core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), context);
  async function request(message, tabId) {
    const tab = tabs.find(t => t.id === tabId);
    const sender = tab ? { tab: clone(tab), url: tab.url } : { url: 'chrome-extension://blockout/dashboard.html' };
    return new Promise(resolve => api.runtime.onMessage.listeners[0](message, sender, resolve));
  }
  return { api, local, session, sync, sent, created, request, advance(ms) { now += ms; }, tabs: () => tabs, async alarm() { await api.alarms.onAlarm.emit({ name: 'blockout-check' }); await vm.runInContext('chain', context); } };
}
function seeded(config = {}) { const s = B.createState(config); s.clock.at = base; return store({ blockoutV2: s }); }
test('migration backs up v1 and moves YouTube into dedicated shared settings', async () => {
  const w = await worker({ sync: store({ sites: [{ domain: 'youtube.com', activeTime: 12, freezeTime: 3 }, { domain: 'reddit.com', bypassEnabled: true }], globalSettings: { passwordEnabled: true, passwordText: 'old phrase' } }) });
  const s = await w.request({ action: 'snapshot' });
  assert.equal(s.config.youtube.minutes, 12); assert.equal(s.config.youtube.freezeMinutes, 3);
  assert.equal(s.config.sites.length, 1); assert.equal(s.locked, true);
  assert.equal(w.local.data.legacyBackup.sites.length, 2);
});
test('blocked ordinary tabs redirect to extension-owned screen, log once, and close after delay', async () => {
  const w = await worker({ local: seeded({ sites: [{ domain: 'reddit.com', bypassEnabled: true }] }), tabs: [{ id: 1, url: 'https://reddit.com/r/test', active: true, windowId: 1 }] });
  let s = await w.request({ action: 'snapshot' });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/); assert.equal(s.stats.current.attempts, 1);
  w.advance(2000); s = await w.request({ action: 'blockState' }, 1); assert.equal(s.block.reason, 'site');
  assert.equal(w.local.data.blockoutV2.daily[B.dayKey(base)].attempts, 1);
  w.advance(3000); await w.request({ action: 'snapshot' }); assert.equal(w.tabs().length, 0);
});
test('starting a challenge keeps the block screen open without unlocking the site', async () => {
  const w = await worker({ local: seeded({ sites: [{ domain: 'reddit.com', bypassEnabled: true }] }), tabs: [{ id: 1, url: 'https://reddit.com', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); assert.equal((await w.request({ action: 'challengeStart' }, 1)).ok, true);
  w.advance(10000); const r = await w.request({ action: 'blockState' }, 1);
  assert.equal(w.tabs().length, 1); assert.equal(r.block.closeAt, 0); assert.equal(r.block.reason, 'site');
});
test('an active thaw counts background tabs once and pauses when all eligible tabs close', async () => {
  const w = await worker({ local: seeded({ closeSeconds: 0, sites: [{ domain: 'reddit.com' }] }), tabs: [{ id: 1, url: 'https://reddit.com', active: false, windowId: 1 }, { id: 2, url: 'https://reddit.com/new', active: false, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); await w.request({ action: 'thaw', kind: 'weekend' }); await w.request({ action: 'snapshot' });
  w.advance(60000); let s = await w.request({ action: 'snapshot' }); assert.equal(s.balances.weekend.remaining, 3540000);
  await w.api.tabs.remove(1); await w.api.tabs.remove(2); await w.request({ action: 'snapshot' });
  w.advance(60000); s = await w.request({ action: 'snapshot' }); assert.equal(s.balances.weekend.remaining, 3540000);
});
test('worker suspension preserves clocks, browser restart excludes offline time', async () => {
  const local = seeded({ sites: [{ domain: 'reddit.com' }] }), session = store();
  let w = await worker({ local, session, tabs: [{ id: 1, url: 'https://reddit.com', active: false, windowId: 1 }] });
  await w.request({ action: 'thaw', kind: 'weekend' }); await w.request({ action: 'snapshot' });
  w = await worker({ local, session, now: base + 60000, tabs: w.tabs() });
  let s = await w.request({ action: 'snapshot' }); assert.equal(s.balances.weekend.remaining, 3540000);
  w = await worker({ local, session: store(), now: base + 3600000, tabs: [] });
  s = await w.request({ action: 'snapshot' }); assert.equal(s.balances.weekend.remaining, 3540000);
});
test('YouTube switching videos cannot reset time; keyword bypass keeps accumulated usage', async () => {
  const w = await worker({ local: seeded(), tabs: [{ id: 1, url: 'https://youtube.com/watch?v=a', title: 'Study', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); w.advance(60000);
  await w.api.tabs.update(1, { url: 'https://youtube.com/watch?v=b', title: 'Car restoration' });
  const r = await w.request({ action: 'tick', url: 'https://youtube.com/watch?v=b', title: 'Car restoration' }, 1);
  assert.equal(r.block.reason, 'keyword'); assert.equal(r.usageMs, 60000);
  assert.equal((await w.request({ action: 'bypass', phrase: B.defaults().bypassText }, 1)).ok, true);
  const s = await w.request({ action: 'snapshot' }); assert.equal(s.usageMs, 60000);
});
test('settings protection is enforced in background, including import/export', async () => {
  const w = await worker({ local: seeded({ passwordEnabled: true, passwordText: 'keep me' }) });
  assert.match((await w.request({ action: 'settings', config: B.defaults() })).error, /Unlock/);
  assert.match((await w.request({ action: 'export' })).error, /Unlock/);
  assert.equal((await w.request({ action: 'unlock', phrase: 'wrong' })).ok, false);
  assert.equal((await w.request({ action: 'unlock', phrase: 'keep me' })).ok, true);
  assert.equal((await w.request({ action: 'snapshot' })).locked, false);
});
test('web content cannot change settings or launch allowances', async () => {
  const w = await worker({ tabs: [{ id: 1, url: 'https://example.com', active: true, windowId: 1 }] });
  assert.match((await w.request({ action: 'settings', config: B.defaults() }, 1)).error, /only from Blockout/);
  assert.match((await w.request({ action: 'thaw', kind: 'emergency' }, 1)).error, /only from Blockout/);
});
test('import changes configuration without restoring a spent budget', async () => {
  const s = B.createState(); s.budgets[B.balance(s, 'weekend', base).key] = 60000;
  const w = await worker({ local: store({ blockoutV2: s }) });
  const r = await w.request({ action: 'import', data: { schema: 2, config: B.defaults(), budgets: {} } });
  assert.equal(r.balances.weekend.remaining, 3540000);
});
test('weekly report opens once after a completed reporting week', async () => {
  const s = B.createState(); B.log(s, 'attempt', base - 7 * 86400000, 'reddit.com');
  const w = await worker({ local: store({ blockoutV2: s }) });
  await w.api.runtime.onStartup.emit(); await w.api.runtime.onStartup.emit();
  assert.equal(w.created.length, 1); assert.match(w.created[0].url, /dashboard.html\?week=2026-11-02#stats/);
});
