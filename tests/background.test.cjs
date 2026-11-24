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
    tabs: { async query() { return clone(tabs); }, async update(id, patch) { if (options.failTabUpdate) throw Error('navigation failed'); Object.assign(tabs.find(t => t.id === id), patch); }, async remove(id) { tabs = tabs.filter(t => t.id !== id); }, async sendMessage(id, message) { sent.push({ id, message: clone(message) }); }, async create(tab) { created.push(tab); }, onUpdated: event(), onRemoved: event(), onActivated: event() },
    windows: { async getLastFocused() { return { id: 1, focused: options.windowFocused ?? true }; }, onFocusChanged: event() },
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
test('Music tab shift prefers right, then left, then a new tab', async () => {
  const url = 'https://music.youtube.com/watch?v=abc';
  for (const [tabs, expectedId] of [
    [[{ id: 1, index: 0, url: 'https://example.com', active: false, windowId: 1 }, { id: 2, index: 1, url, active: true, windowId: 1 }, { id: 3, index: 2, url: 'https://example.org', active: false, windowId: 1 }], 3],
    [[{ id: 1, index: 0, url: 'https://example.com', active: false, windowId: 1 }, { id: 2, index: 1, url, active: true, windowId: 1 }], 1],
    [[{ id: 2, index: 0, url, active: true, windowId: 1 }], null]
  ]) {
    const w = await worker({ local: seeded(), tabs });
    await w.request({ action: 'thaw', kind: 'music' });
    assert.equal((await w.request({ action: 'musicShift', url }, 2)).ok, true);
    if (expectedId) assert.equal(w.tabs().find(tab => tab.id === expectedId).active, true);
    else assert.equal(w.created[0].windowId, 1);
  }
  const off = await worker({ local: seeded(), tabs: [{ id: 2, index: 0, url, active: true, windowId: 1 }] });
  assert.equal((await off.request({ action: 'musicShift', url }, 2)).ok, false);
  assert.equal(off.created.length, 0);
});
test('blocked ordinary tabs redirect to extension-owned screen, log once, and close after delay', async () => {
  const w = await worker({ local: seeded({ sites: [{ domain: 'reddit.com', bypassEnabled: true }] }), tabs: [{ id: 1, url: 'https://reddit.com/r/test', active: true, windowId: 1 }] });
  let s = await w.request({ action: 'snapshot' });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/); assert.equal(s.stats.current.attempts, 1);
  w.advance(2000); s = await w.request({ action: 'blockState' }, 1); assert.equal(s.block.reason, 'site');
  assert.equal(w.local.data.blockoutV2.daily[B.dayKey(base)].attempts, 1);
  w.advance(3000); await w.request({ action: 'snapshot' }); assert.equal(w.tabs().length, 0);
});
test('three blocked navigations in ten minutes open Need Help once', async () => {
  const w = await worker({ local: seeded({ sites: [{ domain: 'reddit.com', closeSeconds: 0 }] }),
    tabs: [{ id: 1, url: 'https://reddit.com', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' });
  await w.request({ action: 'snapshot' });
  assert.equal(w.local.data.blockoutV2.recentAttempts.length, 1);
  for (let attempt = 2; attempt <= 3; attempt++) {
    await w.api.tabs.update(1, { url: 'https://reddit.com' });
    await w.api.tabs.onUpdated.emit(1, { url: 'https://reddit.com' });
    await w.request({ action: 'snapshot' });
  }
  assert.equal(w.local.data.blockoutV2.recentAttempts.length, 3);
  assert.equal(w.tabs()[0].url, 'chrome-extension://blockout/dashboard.html?forced=1#help');
});
test('configured Need Help threshold opens after two attempts', async () => {
  const w = await worker({ local: seeded({ help: { attempts: 2, windowMinutes: 2 },
    sites: [{ domain: 'reddit.com', closeSeconds: 0 }] }),
    tabs: [{ id: 1, url: 'https://reddit.com', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' });
  w.advance(2 * 60000 + 1);
  await w.api.tabs.update(1, { url: 'https://reddit.com' });
  await w.api.tabs.onUpdated.emit(1, { url: 'https://reddit.com' });
  await w.request({ action: 'snapshot' });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
  assert.equal(w.local.data.blockoutV2.recentAttempts.length, 1);
  w.advance(60000);
  await w.api.tabs.update(1, { url: 'https://reddit.com' });
  await w.api.tabs.onUpdated.emit(1, { url: 'https://reddit.com' });
  await w.request({ action: 'snapshot' });
  assert.equal(w.tabs()[0].url, 'chrome-extension://blockout/dashboard.html?forced=1#help');
});
test('blocked attempts older than ten minutes do not trigger Need Help', async () => {
  const w = await worker({ local: seeded({ sites: [{ domain: 'reddit.com', closeSeconds: 0 }] }),
    tabs: [{ id: 1, url: 'https://reddit.com', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' });
  w.advance(10 * 60000 + 1);
  await w.api.tabs.update(1, { url: 'https://reddit.com' });
  await w.api.tabs.onUpdated.emit(1, { url: 'https://reddit.com' });
  await w.request({ action: 'snapshot' });
  assert.equal(w.local.data.blockoutV2.recentAttempts.length, 1);
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
});
test('each blocked website uses its own tab-close delay', async () => {
  const w = await worker({ local: seeded({ sites: [
    { domain: 'reddit.com', closeSeconds: 0 },
    { domain: 'example.com', closeSeconds: 2 }
  ] }), tabs: [
    { id: 1, url: 'https://reddit.com', active: true, windowId: 1 },
    { id: 2, url: 'https://example.com', active: false, windowId: 1 }
  ] });
  await w.request({ action: 'snapshot' });
  assert.equal((await w.request({ action: 'blockState' }, 1)).block.closeAt, 0);
  w.advance(2000); await w.request({ action: 'snapshot' });
  assert.deepEqual(w.tabs().map(tab => tab.id), [1]);
});
test('limited website time runs only while its tab is focused', async () => {
  const w = await worker({ windowFocused: false, local: seeded({ sites: [{ domain: 'instagram.com', mode: 'limited', dailyMinutes: 5, closeSeconds: 0,
    schedule: { enabled: true, days: [6], start: '12:00', end: '12:00' }, bypassEnabled: false }] }),
    tabs: [{ id: 1, url: 'https://instagram.com', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' });
  w.advance(4 * 60000); await w.request({ action: 'snapshot' });
  assert.equal(w.local.data.blockoutV2.siteUsage[B.dayKey(base) + ':instagram.com'], 4 * 60000);
  await w.api.tabs.update(1, { active: false }); await w.request({ action: 'snapshot' });
  w.advance(10 * 60000); await w.request({ action: 'snapshot' });
  assert.equal(w.local.data.blockoutV2.siteUsage[B.dayKey(base) + ':instagram.com'], 4 * 60000);
  await w.api.tabs.update(1, { active: true }); await w.request({ action: 'snapshot' });
  w.advance(60000); await w.request({ action: 'snapshot' });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
});
test('Instagram blocks outside grace days even if the block-page redirect fails', async () => {
  const monday = +new Date('2026-11-16T12:00:00');
  const w = await worker({ now: monday, failTabUpdate: true, local: seeded({ sites: [{
    domain: 'instagram.com', mode: 'limited', dailyMinutes: 1, closeSeconds: 0,
    schedule: { enabled: true, days: [5, 6], start: '09:00', end: '18:00' }, bypassEnabled: false
  }] }), tabs: [{ id: 1, url: 'https://www.instagram.com/', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' });
  assert.equal(w.sent.at(-1).message.block.reason, 'site');
  assert.equal(w.sent.at(-1).message.block.domain, 'instagram.com');
});
test('Emergency restores Instagram outside its grace window and counts the open tab', async () => {
  const monday = +new Date('2026-11-16T12:00:00');
  const url = 'https://www.instagram.com/';
  const w = await worker({ now: monday, local: seeded({ sites: [{ domain: 'instagram.com', mode: 'limited', dailyMinutes: 5, closeSeconds: 0,
    schedule: { enabled: true, days: [5, 6], start: '22:00', end: '00:00' } }] }),
    tabs: [{ id: 1, url, active: true, windowId: 1 }] });
  await w.request({ action: 'thaw', kind: 'emergency' });
  assert.equal(w.tabs()[0].url, url);
  w.advance(60000);
  const s = await w.request({ action: 'snapshot' });
  assert.equal(s.balances.emergency.remaining, 179 * 60000);
  await w.request({ action: 'thaw', kind: null });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
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
test('Music allowance keeps YouTube Music open and charges Music time', async () => {
  const url = 'https://music.youtube.com/watch?v=abc';
  const w = await worker({ local: seeded({ sites: [{ domain: 'music.youtube.com', kind: 'general' }] }),
    tabs: [{ id: 1, url, active: true, windowId: 1 }] });
  await w.request({ action: 'thaw', kind: 'music' });
  w.advance(60000);
  const s = await w.request({ action: 'snapshot' });
  assert.equal(w.tabs()[0].url, url);
  assert.equal(s.balances.music.remaining, 3540000);
  assert.equal(s.usageMs, 0);
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
test('YouTube channel exception stays on one video and keeps accumulated time', async () => {
  const w = await worker({ local: seeded({ youtube: { channels: ['@carprojects'] } }), tabs: [{ id: 1, url: 'https://youtube.com/watch?v=a', title: 'Study', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); w.advance(60000);
  await w.api.tabs.update(1, { url: 'https://youtube.com/watch?v=b', title: 'Car restoration' });
  const r = await w.request({ action: 'tick', url: 'https://youtube.com/watch?v=b', title: 'Car restoration', channels: ['https://youtube.com/@carprojects'] }, 1);
  assert.equal(r.block.reason, 'channel'); assert.equal(r.usageMs, 60000);
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
  assert.equal((await w.request({ action: 'bypass', phrase: B.defaults().bypassText }, 1)).ok, true);
  const s = await w.request({ action: 'snapshot' }); assert.equal(s.usageMs, 60000);
  await w.api.tabs.update(1, { url: 'https://youtube.com/watch?v=c' });
  const next = await w.request({ action: 'tick', url: 'https://youtube.com/watch?v=c', channels: ['@carprojects'] }, 1);
  assert.equal(next.block.reason, 'channel');
});
test('timer exception does not unlock the next YouTube video', async () => {
  const w = await worker({ windowFocused: false, local: seeded({ youtube: { minutes: 1, freezeMinutes: 5 } }),
    tabs: [{ id: 1, url: 'https://youtube.com/watch?v=one', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); w.advance(60000);
  await w.request({ action: 'snapshot' });
  assert.match(w.tabs()[0].url, /blocked.html\?url=/);
  const until = w.local.data.blockoutV2.timerUntil;
  assert.equal((await w.request({ action: 'bypass', phrase: B.defaults().bypassText }, 1)).ok, true);
  assert.equal(w.local.data.blockoutV2.timerUntil, until);
  await w.api.tabs.update(1, { url: 'https://youtube.com/watch?v=two' });
  const next = await w.request({ action: 'tick', url: 'https://youtube.com/watch?v=two', channels: [] }, 1);
  assert.equal(next.block.reason, 'timer');
});
test('allowed YouTube video stays open and does not spend viewing time', async () => {
  const w = await worker({ local: seeded({ youtube: { minutes: 0.1,
    allowedVideos: [{ label: 'Rain', url: 'https://youtu.be/abcdefghijk' }] } }),
    tabs: [{ id: 1, url: 'https://youtube.com/watch?v=abcdefghijk', active: true, windowId: 1 }] });
  await w.request({ action: 'snapshot' }); w.advance(10000);
  const s = await w.request({ action: 'snapshot' });
  assert.equal(s.usageMs, 0);
  assert.equal(w.tabs()[0].url, 'https://youtube.com/watch?v=abcdefghijk');
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
