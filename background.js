/* This process is the only writer of clocks, budgets, and logs. */
if (typeof importScripts === 'function') importScripts('core.js');
const B = globalThis.Blockout;
const ext = typeof browser !== 'undefined' ? browser : chrome;
let state, chain = Promise.resolve(), focusWindow = -1;
const metadata = new Map();
const blockedUrl = ext.runtime.getURL('blocked.html');
function serial(fn) { const result = chain.then(fn); chain = result.catch(console.error); return result; }
async function load() {
  if (state) return;
  const saved = await ext.storage.local.get('blockoutV2');
  if (saved.blockoutV2) state = saved.blockoutV2;
  else {
    const old = await ext.storage.sync.get({ sites: [], globalSettings: {} });
    const cfg = B.defaults();
    const oldYoutube = old.sites.find(s => ['youtube.com', 'www.youtube.com'].includes(B.domain(s.domain)));
    if (oldYoutube) {
      cfg.youtube.minutes = oldYoutube.activeTime > 0 ? oldYoutube.activeTime : 30;
      cfg.youtube.freezeMinutes = oldYoutube.freezeTime > 0 ? oldYoutube.freezeTime : 5;
      if (oldYoutube.bypassText) cfg.bypassText = oldYoutube.bypassText;
    }
    cfg.sites = old.sites.map(s => ({ domain: B.domain(s.domain), kind: 'general', message: s.message || '', bypassEnabled: !!s.bypassEnabled, bypassText: s.bypassText || '' })).filter(s => s.domain && s.domain !== 'youtube.com');
    cfg.passwordEnabled = !!old.globalSettings.passwordEnabled;
    cfg.passwordText = old.globalSettings.passwordText || 'Unlock Menu';
    state = B.createState(cfg);
    await ext.storage.local.set({ legacyBackup: { ...old, lockouts: (await ext.storage.local.get('lockouts')).lockouts || {} } });
  }
  state.config = B.settings(state.config);
  const boot = await ext.storage.session.get('blockoutBoot');
  if (!boot.blockoutBoot) {
    state.clock = { at: Date.now(), youtube: false, general: false, music: false, screens: false };
    state.blocks = {}; state.videoGrants = {};
    await ext.storage.session.set({ blockoutBoot: true });
  }
  const win = await ext.windows.getLastFocused().catch(() => null);
  focusWindow = win?.focused ? win.id : -1;
}
function blockTarget(tab) {
  if (!tab.url?.startsWith(blockedUrl)) return null;
  const url = new URL(tab.url).searchParams.get('url'); return B.parseUrl(url) ? url : null;
}
function publicConfig() { return { promises: state.config.promises, closeSeconds: state.config.closeSeconds, youtube: state.config.youtube }; }
function publicBlock(block) { if (!block) return null; const { phrase, ...safe } = block; return safe; }
async function reconcile(now = Date.now()) {
  await load(); B.advance(state, now);
  const tabs = await ext.tabs.query({});
  const live = new Set(tabs.map(t => String(t.id)));
  const clock = { at: now, youtube: false, general: false, music: false, screens: false };
  for (const id of Object.keys(state.blocks)) if (!live.has(id)) delete state.blocks[id];
  for (const id of Object.keys(state.videoGrants)) if (!live.has(id)) delete state.videoGrants[id];
  for (const tab of tabs) {
    const target = blockTarget(tab), url = target || tab.url;
    if (!B.parseUrl(url)) { delete state.videoGrants[tab.id]; continue; }
    const info = metadata.get(tab.id);
    const title = info?.url === url ? info.title : (target ? state.blocks[tab.id]?.title || '' : tab.title || '');
    const id = B.videoId(url);
    if (state.videoGrants[tab.id] && state.videoGrants[tab.id] !== id) delete state.videoGrants[tab.id];
    const result = B.decision(state, url, title, tab.id, now);
    if (result.blocked) {
      const previous = state.blocks[tab.id], signature = `${url}|${result.reason}|${result.category || ''}`;
      if (!previous || previous.signature !== signature) {
        state.blocks[tab.id] = { ...result, url, title, signature, detectedAt: now, closeAt: result.reason === 'site' && state.config.closeSeconds > 0 ? now + state.config.closeSeconds * 1000 : 0, suggestHelp: B.daily(state, now).attempts >= 2, challengeStarted: false };
        B.log(state, 'attempt', now, result.domain);
        if (result.reason === 'keyword') B.log(state, 'keyword', now, result.category);
      }
      const block = state.blocks[tab.id];
      clock.screens ||= tab.active && tab.windowId === focusWindow;
      if (result.reason === 'site' && !target) await ext.tabs.update(tab.id, { url: blockedUrl + '?url=' + encodeURIComponent(url) }).catch(() => {});
      else if (block.closeAt && now >= block.closeAt) await ext.tabs.remove(tab.id).catch(() => {});
      else if (!target) await ext.tabs.sendMessage(tab.id, { action: 'enforce', block: publicBlock(block), config: publicConfig() }).catch(() => {});
    } else {
      delete state.blocks[tab.id];
      if (target) await ext.tabs.update(tab.id, { url }).catch(() => {});
      else {
        clock.general ||= !!result.general;
        clock.music ||= !!result.music;
        clock.youtube ||= state.config.youtube.enabled && !!result.videoId && tab.active && tab.windowId === focusWindow;
        await ext.tabs.sendMessage(tab.id, { action: 'enforce', block: null }).catch(() => {});
      }
    }
  }
  state.clock = clock;
  await ext.storage.local.set({ blockoutV2: state }); return tabs;
}
async function snapshot() {
  const auth = await ext.storage.session.get('blockoutUnlocked');
  const locked = state.config.passwordEnabled && !auth.blockoutUnlocked;
  const config = B.clone(state.config);
  delete config.passwordText; delete config.bypassText; config.sites.forEach(s => delete s.bypassText);
  return { config, locked, usageMs: state.usageMs, timerUntil: state.timerUntil, activeThaw: state.activeThaw, clock: state.clock,
    balances: Object.fromEntries(['weekend', 'emergency', 'music'].map(k => [k, B.balance(state, k, Date.now())])), stats: B.summary(state), daily: state.daily };
}
async function requireUnlocked() {
  const { blockoutUnlocked } = await ext.storage.session.get('blockoutUnlocked');
  if (state.config.passwordEnabled && !blockoutUnlocked) throw Error('Unlock your settings first.');
}
function validateConfig(raw) {
  const cfg = B.settings(raw);
  const number = (v, min, max, label) => { if (!Number.isFinite(v) || v < min || v > max) throw Error(label + ' is outside its allowed range.'); };
  if (!Array.isArray(cfg.sites) || cfg.sites.length > 500) throw Error('Use up to 500 site rules.');
  const seen = new Set();
  cfg.sites = cfg.sites.map(s => {
    const d = B.domain(s.domain); if (!d || seen.has(d)) throw Error('Site domains must be valid and unique.');
    if (B.matches(d, 'youtube.com')) throw Error('Use the dedicated YouTube controls instead of an ordinary site rule.'); seen.add(d);
    return { domain: d, kind: s.kind === 'music' ? 'music' : 'general', message: String(s.message || '').slice(0, 1000), bypassEnabled: s.bypassEnabled !== false, bypassText: String(s.bypassText || '').slice(0, 5000) };
  });
  if (!Array.isArray(cfg.approved)) throw Error('Approved domains must be a list.');
  cfg.approved = [...new Set(cfg.approved.map(d => { const value = B.domain(d); if (!value) throw Error('Invalid approved domain: ' + d); return value; }))];
  number(cfg.closeSeconds, 0, 3600, 'Close delay'); number(cfg.bypassMinutes, 0.1, 180, 'Bypass duration');
  number(cfg.youtube.minutes, 0.1, 1440, 'YouTube timer'); number(cfg.youtube.freezeMinutes, 0.1, 1440, 'YouTube break');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.schedule.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.schedule.end) || !Array.isArray(cfg.schedule.days) || !cfg.schedule.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) throw Error('Invalid schedule.');
  for (const [kind, a] of Object.entries(cfg.allowances)) { number(a.minutes, 0, kind === 'emergency' ? 180 : 1440, 'Allowance'); if (!['day', 'week', 'month'].includes(a.period)) throw Error('Invalid allowance reset period.'); }
  if (!Array.isArray(cfg.youtube.keywords) || cfg.youtube.keywords.some(g => !g.name || !Array.isArray(g.words) || g.words.some(w => typeof w !== 'string'))) throw Error('Invalid keyword groups.');
  for (const k of ['promises', 'todos']) if (!Array.isArray(cfg[k]) || cfg[k].some(x => typeof x !== 'string')) throw Error('Invalid ' + k + '.');
  if (!Array.isArray(cfg.resources) || cfg.resources.some(r => !r.label || !B.parseUrl(r.url))) throw Error('Resources need a title and an http(s) URL.');
  if (!String(cfg.bypassText).trim() || !String(cfg.passwordText).trim()) throw Error('Challenge phrases cannot be empty.');
  return cfg;
}
async function handle(message, sender) {
  await load();
  if (message.action === 'tick' && sender.tab && message.url === sender.tab.url) {
    const info = { url: message.url, title: String(message.title || '').slice(0, 2000) };
    const old = metadata.get(sender.tab.id);
    metadata.set(sender.tab.id, info);
    if (old?.title !== info.title || old?.url !== info.url || Date.now() - state.clock.at >= 250) await reconcile();
  } else await reconcile();
  const isUI = sender.url?.startsWith(ext.runtime.getURL('')) && !sender.url?.startsWith(blockedUrl);
  const tabId = sender.tab?.id ?? (isUI ? message.tabId : undefined);
  switch (message.action) {
    case 'tick': {
      const host = B.parseUrl(sender.tab?.url)?.hostname || '';
      const watch = B.matches(host, 'youtube.com') || state.config.sites.some(s => B.matches(host, s.domain));
      return { block: publicBlock(state.blocks[tabId]), config: publicConfig(), usageMs: state.usageMs, watch };
    }
    case 'blockState': return { block: publicBlock(state.blocks[tabId]), config: publicConfig() };
    case 'challengeStart': {
      const block = state.blocks[tabId]; if (block && !block.challengeStarted) { block.challengeStarted = true; block.closeAt = 0; B.log(state, 'bypassStarts', Date.now()); }
      return { ok: !!block?.bypass };
    }
    case 'challengeHint': return { phrase: state.blocks[tabId]?.bypass ? state.blocks[tabId].phrase : '' };
    case 'bypass': {
      const ok = B.bypass(state, state.blocks[tabId], tabId, message.phrase, Date.now());
      if (ok) delete state.blocks[tabId]; await reconcile(); return { ok };
    }
    case 'openHelp': await ext.tabs.create({ url: ext.runtime.getURL('dashboard.html#help') }); return { ok: true };
    case 'closeBlocked': if (state.blocks[tabId]) await ext.tabs.remove(tabId); return { ok: true };
    default: if (!isUI) throw Error('This action is available only from Blockout.');
  }
  switch (message.action) {
    case 'snapshot': return snapshot();
    case 'unlock': { const ok = message.phrase === state.config.passwordText; if (ok) await ext.storage.session.set({ blockoutUnlocked: true }); return { ok }; }
    case 'lock': await ext.storage.session.remove('blockoutUnlocked'); return { ok: true };
    case 'settings': {
      await requireUnlocked();
      const next = { ...message.config, passwordText: message.config.passwordText || state.config.passwordText, bypassText: message.config.bypassText || state.config.bypassText };
      next.sites = next.sites.map(s => ({ ...s, bypassText: s.bypassText || state.config.sites.find(old => old.domain === s.domain)?.bypassText || '' }));
      state.config = validateConfig(next); state.blocks = {}; await reconcile(); return snapshot();
    }
    case 'thaw': {
      const kind = message.kind;
      if (kind === null) state.activeThaw = null;
      else {
        if (!['weekend', 'emergency', 'music'].includes(kind)) throw Error('Unknown allowance.');
        const b = B.balance(state, kind, Date.now()); if (!b.available || b.remaining <= 0) throw Error('This allowance is not available right now.');
        state.activeThaw = kind;
      }
      await reconcile(); return snapshot();
    }
    case 'todo': { const i = Number(message.index); if (!Number.isInteger(i) || i < 0 || i >= state.config.todos.length) throw Error('Unknown task.'); state.config.todos.splice(i, 1); return snapshot(); }
    case 'reportSeen': state.lastReport = B.weekKey(Date.now()); return { ok: true };
    case 'export': await requireUnlocked(); return { data: { schema: 2, config: state.config, daily: state.daily, budgets: state.budgets } };
    case 'import': {
      await requireUnlocked(); if (message.data?.schema !== 2) throw Error('Choose a Blockout v2 export.');
      state.config = validateConfig(message.data.config); state.blocks = {}; state.grants = {}; state.videoGrants = {}; state.activeThaw = null;
      await reconcile(); return snapshot();
    }
    default: throw Error('Unknown action.');
  }
}
ext.runtime.onMessage.addListener((message, sender, respond) => {
  serial(async () => { try { const result = await handle(message, sender); if (!['tick', 'snapshot', 'blockState', 'challengeHint'].includes(message.action)) await ext.storage.local.set({ blockoutV2: state }); respond(result); } catch (error) { respond({ error: error.message }); } });
  return true;
});
const update = () => serial(() => reconcile()).catch(console.error);
ext.tabs.onUpdated.addListener((id, change) => { if (change.url || change.title || change.status === 'complete') update(); });
ext.tabs.onRemoved.addListener(id => { metadata.delete(id); update(); });
ext.tabs.onActivated.addListener(update);
ext.windows.onFocusChanged.addListener(id => { focusWindow = id; update(); });
ext.alarms.onAlarm.addListener(update);
ext.runtime.onInstalled.addListener(() => serial(async () => { await reconcile(); await ext.alarms.create('blockout-check', { periodInMinutes: 0.5 }); }));
ext.runtime.onStartup.addListener(() => serial(async () => {
  await load(); await reconcile(); await ext.alarms.create('blockout-check', { periodInMinutes: 0.5 });
  const week = B.weekKey(Date.now());
  if (state.lastReport !== week && Object.keys(state.daily).some(d => d < week)) {
    await ext.tabs.create({ url: ext.runtime.getURL('dashboard.html') + '?week=' + B.summary(state).previousWeek + '#stats' }); state.lastReport = week; await ext.storage.local.set({ blockoutV2: state });
  }
}));
