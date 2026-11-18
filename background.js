/* This process is the only writer of clocks, budgets, and logs. */
const B = globalThis.Blockout;
const ext = typeof browser !== 'undefined' ? browser : chrome;
let state, chain = Promise.resolve(), focusWindow = -1;
const metadata = new Map();
const navigationAttempts = new Map();
const blockedUrl = ext.runtime.getURL('blocked.html');
const helpUrl = ext.runtime.getURL('dashboard.html') + '#help';
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
  state.siteUsage ||= {};
  state.timerGrants ||= {};
  state.recentAttempts ||= [];
  state.lastHelpAt ||= 0;
  state.config.sites = state.config.sites.map(site => ({
    ...site,
    schedule: site.schedule || { ...state.config.schedule },
    closeSeconds: site.closeSeconds ?? state.config.closeSeconds,
    bypassMinutes: site.bypassMinutes ?? state.config.bypassMinutes,
    bypassText: site.bypassText || state.config.bypassText
  }));
  const boot = await ext.storage.session.get('blockoutBoot');
  if (!boot.blockoutBoot) {
    state.clock = { at: Date.now(), youtube: false, general: false, music: false, screens: false, site: null };
    state.blocks = {}; state.videoGrants = {}; state.timerGrants = {};
    await ext.storage.session.set({ blockoutBoot: true });
  }
  const win = await ext.windows.getLastFocused().catch(() => null);
  focusWindow = win?.id ?? -1;
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
  const focused = await ext.windows.getLastFocused().catch(() => null);
  if (focused?.id != null) focusWindow = focused.id;
  const live = new Set(tabs.map(t => String(t.id)));
  const clock = { at: now, youtube: false, general: false, music: false, screens: false, site: null };
  for (const id of Object.keys(state.blocks)) if (!live.has(id)) delete state.blocks[id];
  for (const id of navigationAttempts.keys()) if (!live.has(String(id))) navigationAttempts.delete(id);
  for (const id of Object.keys(state.videoGrants)) if (!live.has(id)) delete state.videoGrants[id];
  for (const id of Object.keys(state.timerGrants)) if (!live.has(id)) delete state.timerGrants[id];
  for (const tab of tabs) {
    const activeTab = tab.active && (focusWindow < 0 || tab.windowId === focusWindow);
    const target = blockTarget(tab), url = target || tab.url;
    if (!B.parseUrl(url)) { delete state.blocks[tab.id]; delete state.videoGrants[tab.id]; navigationAttempts.delete(tab.id); continue; }
    const newNavigation = !target && navigationAttempts.get(tab.id) === tab.url;
    if (newNavigation) navigationAttempts.delete(tab.id);
    const info = metadata.get(tab.id);
    const title = info?.url === url ? info.title : (target ? state.blocks[tab.id]?.title || '' : tab.title || '');
    const channels = info?.url === url ? info.channels : (target ? state.blocks[tab.id]?.channels || [] : []);
    const id = B.videoId(url);
    if (state.videoGrants[tab.id] && state.videoGrants[tab.id] !== id) delete state.videoGrants[tab.id];
    if (state.timerGrants[tab.id] && state.timerGrants[tab.id] !== id) delete state.timerGrants[tab.id];
    const result = B.decision(state, url, channels, tab.id, now);
    if (result.blocked) {
      const previous = state.blocks[tab.id], signature = `${url}|${result.reason}|${result.channel || ''}`;
      if (!previous || previous.signature !== signature || newNavigation) {
        state.blocks[tab.id] = { ...result, url, title, channels, signature, detectedAt: now, closeAt: result.reason === 'site' && result.closeSeconds > 0 ? now + result.closeSeconds * 1000 : 0, suggestHelp: B.daily(state, now).attempts >= 2, challengeStarted: false };
        B.log(state, 'attempt', now, result.domain);
        if (result.reason === 'channel') B.log(state, 'channel', now, result.channel);
        if (state.recentAttempts.length >= state.config.help.attempts && (!state.lastHelpAt || now < state.lastHelpAt || now - state.lastHelpAt >= state.config.help.windowMinutes * B.MINUTE)) {
          try {
            await ext.tabs.update(tab.id, { url: helpUrl });
            state.lastHelpAt = now;
            delete state.blocks[tab.id];
            continue;
          } catch (error) { console.error('Blockout could not open Need Help:', error); }
        }
      }
      const block = state.blocks[tab.id];
      clock.screens ||= activeTab;
      if (block.closeAt && now >= block.closeAt) await ext.tabs.remove(tab.id).catch(() => {});
      else if (!target) {
        try { await ext.tabs.update(tab.id, { url: blockedUrl + '?url=' + encodeURIComponent(url) }); }
        catch (error) {
          console.error('Blockout could not open the block page:', error);
          await ext.tabs.sendMessage(tab.id, { action: 'enforce', block: publicBlock(block), config: publicConfig() }).catch(() => {});
        }
      }
    } else {
      delete state.blocks[tab.id];
      clock.general ||= !!result.general;
      clock.music ||= !!result.music;
      clock.youtube ||= state.config.youtube.enabled && !!result.videoId && !result.exemptYoutube && activeTab;
      if (result.limitedSite && activeTab) clock.site = result.limitedSite;
      if (target) await ext.tabs.update(tab.id, { url }).catch(() => {});
      else {
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
  delete config.passwordText; delete config.bypassText; if (locked) config.sites.forEach(s => delete s.bypassText);
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
    const schedule = { ...cfg.schedule, ...s.schedule };
    const mode = s.mode || (schedule.enabled ? 'scheduled' : 'always');
    if (!['always', 'scheduled', 'limited'].includes(mode)) throw Error('Invalid blocking mode for ' + d + '.');
    schedule.enabled = mode !== 'always';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.end) || !Array.isArray(schedule.days) || !schedule.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) throw Error('Invalid schedule for ' + d + '.');
    if (schedule.enabled && !schedule.days.length) throw Error('Choose at least one day for ' + d + '.');
    number(s.closeSeconds ?? cfg.closeSeconds, 0, 3600, 'Close delay for ' + d);
    number(s.bypassMinutes ?? cfg.bypassMinutes, 0.1, 180, 'Access duration for ' + d);
    const dailyMinutes = s.dailyMinutes ?? 5;
    if (mode === 'limited') number(dailyMinutes, 0.1, 1440, 'Daily access for ' + d);
    if (s.bypassEnabled && !String(s.bypassText || '').trim()) throw Error('Add an access phrase for ' + d + '.');
    return { domain: d, kind: s.kind === 'music' ? 'music' : 'general', mode, dailyMinutes, message: String(s.message || '').slice(0, 1000), bypassEnabled: s.bypassEnabled !== false, bypassText: String(s.bypassText || '').slice(0, 5000), schedule, closeSeconds: s.closeSeconds ?? cfg.closeSeconds, bypassMinutes: s.bypassMinutes ?? cfg.bypassMinutes };
  });
  cfg.approved = [];
  number(cfg.help.attempts, 1, 100, 'Need Help attempt count');
  number(cfg.help.windowMinutes, 1, 1440, 'Need Help time window');
  if (!Number.isInteger(cfg.help.attempts) || !Number.isInteger(cfg.help.windowMinutes)) throw Error('Need Help settings must be whole numbers.');
  number(cfg.closeSeconds, 0, 3600, 'Close delay'); number(cfg.bypassMinutes, 0.1, 180, 'Bypass duration');
  number(cfg.youtube.minutes, 0.1, 1440, 'YouTube timer'); number(cfg.youtube.freezeMinutes, 0.1, 1440, 'YouTube break');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.schedule.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.schedule.end) || !Array.isArray(cfg.schedule.days) || !cfg.schedule.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) throw Error('Invalid schedule.');
  for (const [kind, a] of Object.entries(cfg.allowances)) { number(a.minutes, 0, kind === 'emergency' ? 180 : 1440, 'Allowance'); if (!['day', 'week', 'month'].includes(a.period)) throw Error('Invalid allowance reset period.'); }
  if (!Array.isArray(cfg.youtube.channels) || cfg.youtube.channels.length > 500) throw Error('Use up to 500 YouTube channel rules.');
  cfg.youtube.channels = [...new Set(cfg.youtube.channels.map(value => B.channelKey(value)))];
  if (cfg.youtube.channels.includes('')) throw Error('Use a YouTube channel URL or @handle on each line.');
  if (!Array.isArray(cfg.youtube.allowedVideos) || cfg.youtube.allowedVideos.length > 200) throw Error('Use up to 200 allowed videos.');
  const allowedIds = new Set();
  cfg.youtube.allowedVideos = cfg.youtube.allowedVideos.map(video => {
    const label = String(video?.label || '').trim(), url = String(video?.url || '').trim();
    const id = B.videoId(url);
    if (!label || !id) throw Error('Allowed videos use: Title | YouTube video URL.');
    if (allowedIds.has(id)) throw Error('The same YouTube video is listed twice.');
    allowedIds.add(id); return { label: label.slice(0, 200), url };
  });
  for (const k of ['promises', 'todos']) if (!Array.isArray(cfg[k]) || cfg[k].some(x => typeof x !== 'string')) throw Error('Invalid ' + k + '.');
  if (!Array.isArray(cfg.resources) || cfg.resources.some(r => !r.label || !B.parseUrl(r.url))) throw Error('Resources need a title and an http(s) URL.');
  if (!String(cfg.bypassText).trim() || !String(cfg.passwordText).trim()) throw Error('Challenge phrases cannot be empty.');
  return cfg;
}
async function handle(message, sender) {
  await load();
  if (message.action === 'tick' && sender.tab && message.url === sender.tab.url) {
    const info = { url: message.url, title: String(message.title || '').slice(0, 2000),
      channels: Array.isArray(message.channels) ? message.channels.slice(0, 6).map(value => String(value).slice(0, 300)) : [] };
    const old = metadata.get(sender.tab.id);
    metadata.set(sender.tab.id, info);
    if (old?.title !== info.title || old?.url !== info.url || old?.channels?.join('|') !== info.channels.join('|') || Date.now() - state.clock.at >= 250) await reconcile();
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
    case 'openHelp': await ext.tabs.create({ url: helpUrl }); return { ok: true };
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
      state.config = validateConfig(next); state.blocks = {}; state.videoGrants = {}; state.timerGrants = {}; await reconcile(); return snapshot();
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
      const imported = B.settings(message.data.config);
      imported.sites = imported.sites.map(site => ({ ...site,
        bypassText: site.bypassText || imported.bypassText,
        schedule: site.schedule || imported.schedule,
        closeSeconds: site.closeSeconds ?? imported.closeSeconds,
        bypassMinutes: site.bypassMinutes ?? imported.bypassMinutes
      }));
      state.config = validateConfig(imported); state.blocks = {}; state.grants = {}; state.videoGrants = {}; state.timerGrants = {}; state.activeThaw = null;
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
ext.tabs.onUpdated.addListener((id, change) => { if (change.url && B.parseUrl(change.url)) navigationAttempts.set(id, change.url); if (change.url || change.title || change.status === 'complete') update(); });
ext.tabs.onRemoved.addListener(id => { metadata.delete(id); navigationAttempts.delete(id); update(); });
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
update();
ext.alarms.create('blockout-check', { periodInMinutes: 0.5 }).catch(console.error);
