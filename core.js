/* Shared, dependency-free rules. Also loaded by the Node test runner. */
(function (root) {
  'use strict';
  const MINUTE = 60000;
  const clone = value => JSON.parse(JSON.stringify(value));
  function defaults() {
    return {
      sites: [], approved: [],
      schedule: { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' },
      closeSeconds: 5, bypassMinutes: 10, bypassText: 'I am choosing this deliberately. I understand why I set this boundary.',
      passwordEnabled: false, passwordText: 'Unlock Menu',
      youtube: { enabled: true, minutes: 30, freezeMinutes: 5, keywords: [
        { name: 'Car projects', words: ['car rebuild', 'restoration', 'barn find'] }
      ] },
      allowances: { weekend: { minutes: 60, period: 'day' }, emergency: { minutes: 180, period: 'week' }, music: { minutes: 60, period: 'day' } },
      promises: ['Protect the time you set aside for the things that matter.'], resources: [], todos: []
    };
  }
  function settings(input = {}) {
    const d = defaults();
    return { ...d, ...input, schedule: { ...d.schedule, ...input.schedule }, youtube: { ...d.youtube, ...input.youtube },
      allowances: Object.fromEntries(Object.entries(d.allowances).map(([k, v]) => [k, { ...v, ...input.allowances?.[k] }])) };
  }
  function createState(config = {}) {
    return { schema: 2, config: settings(config), budgets: {}, activeThaw: null, usageMs: 0, timerUntil: 0,
      grants: {}, videoGrants: {}, blocks: {}, daily: {}, lastReport: null,
      clock: { at: 0, youtube: false, general: false, music: false, screens: false } };
  }
  function domain(value) {
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim());
      if (!['http:', 'https:'].includes(u.protocol) || u.port || !u.hostname.includes('.') || /[\s<>]/.test(value)) return '';
      return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch { return ''; }
  }
  const matches = (host, target) => host === target || host.endsWith('.' + target);
  function parseUrl(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
  }
  function videoId(value) {
    const u = parseUrl(value);
    if (!u || !matches(u.hostname, 'youtube.com')) return '';
    if (u.pathname === '/watch') return u.searchParams.get('v') || '';
    return u.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
  }
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function weekKey(ms) {
    const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dayKey(+d);
  }
  function periodKey(ms, period) {
    return period === 'week' ? weekKey(ms) : period === 'month' ? dayKey(ms).slice(0, 7) : dayKey(ms);
  }
  const weekend = ms => [0, 6].includes(new Date(ms).getDay());
  function balance(s, kind, now) {
    const cfg = s.config.allowances[kind];
    const key = kind + ':' + periodKey(now, kind === 'weekend' ? 'day' : cfg.period);
    return { key, remaining: Math.max(0, cfg.minutes * MINUTE - (s.budgets[key] || 0)), total: cfg.minutes * MINUTE,
      available: kind !== 'weekend' || weekend(now) };
  }
  function scheduled(config, now) {
    const rule = config.schedule;
    if (!rule.enabled) return true;
    const d = new Date(now), minute = d.getHours() * 60 + d.getMinutes();
    const num = str => { const [h, m] = str.split(':').map(Number); return h * 60 + m; };
    const start = num(rule.start), end = num(rule.end);
    if (start === end) return rule.days.includes(d.getDay());
    if (start < end) return rule.days.includes(d.getDay()) && minute >= start && minute < end;
    return (rule.days.includes(d.getDay()) && minute >= start) || (rule.days.includes((d.getDay() + 6) % 7) && minute < end);
  }
  function daily(s, now) {
    const key = dayKey(now);
    return s.daily[key] ||= { attempts: 0, bypassStarts: 0, bypasses: 0, failedBypasses: 0, blockedMs: 0, youtubeMs: 0,
      sites: {}, categories: {}, thaw: { weekend: 0, emergency: 0, music: 0 } };
  }
  function log(s, kind, now, details = '') {
    const d = daily(s, now);
    if (kind === 'attempt') { d.attempts++; d.sites[details] = (d.sites[details] || 0) + 1; }
    if (kind === 'keyword') d.categories[details] = (d.categories[details] || 0) + 1;
    if (['bypassStarts', 'bypasses', 'failedBypasses'].includes(kind)) d[kind]++;
  }
  function advance(s, now) {
    const c = s.clock;
    if (!c.at || now < c.at) { c.at = now; return; }
    let from = c.at;
    while (from < now) {
      const midnight = new Date(from); midnight.setHours(24, 0, 0, 0);
      const to = Math.min(now, +midnight), delta = to - from;
      const d = daily(s, from);
      if (c.youtube && !s.timerUntil) { s.usageMs += delta; d.youtubeMs += delta; }
      if (c.screens) d.blockedMs += delta;
      if (s.activeThaw) {
        const b = balance(s, s.activeThaw, from);
        const consuming = s.activeThaw === 'music' ? c.music : c.general;
        if (!b.available || b.remaining <= 0) s.activeThaw = null;
        else if (consuming) {
          const spent = Math.min(delta, b.remaining);
          s.budgets[b.key] = (s.budgets[b.key] || 0) + spent;
          d.thaw[s.activeThaw] += spent;
          if (spent >= b.remaining) s.activeThaw = null;
        }
      }
      // A fresh allowance period always needs a new manual activation.
      if (s.activeThaw) {
        const kind = s.activeThaw, period = kind === 'weekend' ? 'day' : s.config.allowances[kind].period;
        if (periodKey(from, period) !== periodKey(to, period)) s.activeThaw = null;
      }
      from = to;
    }
    c.at = now;
    if (s.timerUntil && now >= s.timerUntil) { s.timerUntil = 0; s.usageMs = 0; }
    if (!s.timerUntil && s.usageMs >= s.config.youtube.minutes * MINUTE) s.timerUntil = now + s.config.youtube.freezeMinutes * MINUTE;
    if (s.activeThaw && !balance(s, s.activeThaw, now).available) s.activeThaw = null;
    for (const [k, g] of Object.entries(s.grants)) if (g <= now) delete s.grants[k];
    for (const key of Object.keys(s.daily).sort().slice(0, -120)) delete s.daily[key];
    for (const key of Object.keys(s.budgets)) {
      const kind = key.split(':')[0];
      if (!s.config.allowances[kind] || key !== balance(s, kind, now).key) delete s.budgets[key];
    }
  }
  function keyword(config, title) {
    const text = (title || '').normalize('NFKC').toLocaleLowerCase();
    return config.youtube.keywords.find(g => g.words.some(w => w.trim() && text.includes(w.normalize('NFKC').trim().toLocaleLowerCase())));
  }
  function decision(s, url, title, tabId, now) {
    const u = parseUrl(url); if (!u) return { blocked: false };
    const host = u.hostname.toLowerCase(), config = s.config;
    const site = config.sites.filter(x => matches(host, x.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
    const general = site && !config.approved.some(x => matches(host, x));
    if (general && scheduled(config, now)) {
      const thaw = s.activeThaw && balance(s, s.activeThaw, now).available && balance(s, s.activeThaw, now).remaining > 0 && (s.activeThaw !== 'music' || site.kind === 'music');
      if (!thaw && !(s.grants[site.domain] > now)) return { blocked: true, reason: 'site', domain: site.domain, message: site.message || '', bypass: site.bypassEnabled !== false, phrase: site.bypassText || config.bypassText };
    }
    const id = videoId(url);
    if (config.youtube.enabled && id) {
      if (s.timerUntil > now) return { blocked: true, reason: 'timer', domain: 'youtube.com', videoId: id, until: s.timerUntil, bypass: true, phrase: config.bypassText };
      const group = keyword(config, title);
      if (group && s.videoGrants[tabId] !== id) return { blocked: true, reason: 'keyword', domain: 'youtube.com', videoId: id, category: group.name, bypass: true, phrase: config.bypassText };
    }
    return { blocked: false, general: !!general, music: !!general && site.kind === 'music', videoId: id };
  }
  function bypass(s, block, tabId, phrase, now) {
    if (!block?.bypass || phrase !== block.phrase) { log(s, 'failedBypasses', now); return false; }
    if (block.reason === 'site') s.grants[block.domain] = now + s.config.bypassMinutes * MINUTE;
    else {
      s.videoGrants[tabId] = block.videoId;
      if (block.reason === 'timer') { s.usageMs = 0; s.timerUntil = 0; }
    }
    log(s, 'bypasses', now); return true;
  }
  function summary(s, now = Date.now()) {
    const week = weekKey(now), prev = new Date(week + 'T12:00:00'); prev.setDate(prev.getDate() - 7);
    const previous = weekKey(+prev);
    function aggregate(start, end) {
      const result = { attempts: 0, bypassStarts: 0, bypasses: 0, failedBypasses: 0, blockedMs: 0, youtubeMs: 0, sites: {}, categories: {}, thaw: { weekend: 0, emergency: 0, music: 0 } };
      for (const [key, d] of Object.entries(s.daily)) if (key >= start && key < end) {
        for (const k of ['attempts', 'bypassStarts', 'bypasses', 'failedBypasses', 'blockedMs', 'youtubeMs']) result[k] += d[k] || 0;
        for (const k of ['sites', 'categories', 'thaw']) for (const [name, n] of Object.entries(d[k] || {})) result[k][name] = (result[k][name] || 0) + n;
      }
      return result;
    }
    const next = new Date(week + 'T12:00:00'); next.setDate(next.getDate() + 7);
    return { week, previousWeek: previous, current: aggregate(week, dayKey(+next)), previous: aggregate(previous, week) };
  }
  const api = { MINUTE, clone, defaults, settings, createState, domain, matches, parseUrl, videoId, dayKey, weekKey, periodKey, weekend, balance, scheduled, daily, log, advance, keyword, decision, bypass, summary };
  root.Blockout = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
