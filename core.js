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
      help: { attempts: 3, windowMinutes: 10 },
      youtube: { enabled: true, minutes: 30, freezeMinutes: 5, channels: [], allowedVideos: [] },
      allowances: { weekend: { minutes: 60, period: 'day' }, emergency: { minutes: 180, period: 'week' }, music: { minutes: 60, period: 'day' } },
      promises: ['Protect the time you set aside for the things that matter.'], resources: [], todos: []
    };
  }
  function settings(input = {}) {
    const d = defaults();
    const youtube = { ...d.youtube, ...input.youtube }; delete youtube.keywords;
    return { ...d, ...input, schedule: { ...d.schedule, ...input.schedule }, help: { ...d.help, ...input.help }, youtube,
      allowances: Object.fromEntries(Object.entries(d.allowances).map(([k, v]) => [k, { ...v, ...input.allowances?.[k] }])) };
  }
  function createState(config = {}) {
    return { schema: 2, config: settings(config), budgets: {}, siteUsage: {}, activeThaw: null, usageMs: 0, timerUntil: 0,
      grants: {}, videoGrants: {}, timerGrants: {}, blocks: {}, recentAttempts: [], lastHelpAt: 0, daily: {}, lastReport: null,
      clock: { at: 0, youtube: false, general: false, music: false, screens: false, site: null } };
  }
  function domain(value) {
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim());
      if (!['http:', 'https:'].includes(u.protocol) || u.port || !u.hostname.includes('.') || /[\s<>]/.test(value)) return '';
      return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch { return ''; }
  }
  const matches = (host, target) => host === target || host.endsWith('.' + target);
  function channelKey(value) {
    if (typeof value !== 'string') return '';
    let path = value.trim();
    if (!path.startsWith('@') && !/^(channel|c|user)\//i.test(path)) {
      try {
        const u = new URL(/^https?:\/\//i.test(path) ? path : 'https://' + path);
        if (!['http:', 'https:'].includes(u.protocol) || !matches(u.hostname.toLowerCase(), 'youtube.com')) return '';
        path = decodeURIComponent(u.pathname);
      } catch { return ''; }
    }
    const parts = path.replace(/^\/|\/$/g, '').split('/');
    const tabs = ['videos', 'shorts', 'streams', 'featured', 'about', 'playlists', 'community'];
    if (parts.length === 2 && tabs.includes(parts[1].toLowerCase())) parts.pop();
    if (parts.length === 3 && tabs.includes(parts[2].toLowerCase())) parts.pop();
    if (parts.length === 1 && /^@[^/?#\s]+$/u.test(parts[0])) return parts[0].toLowerCase();
    if (parts.length !== 2) return '';
    const type = parts[0].toLowerCase(), name = parts[1];
    if (type === 'channel' && /^UC[A-Za-z0-9_-]{20,}$/.test(name)) return 'channel/' + name;
    if (['c', 'user'].includes(type) && /^[^/?#\s]+$/u.test(name)) return type + '/' + name.toLowerCase();
    return '';
  }
  function parseUrl(value) {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
  }
  function videoId(value) {
    const u = parseUrl(value);
    if (!u) return '';
    if (u.hostname === 'youtu.be') return u.pathname.match(/^\/([^/]+)/)?.[1] || '';
    if (!matches(u.hostname, 'youtube.com')) return '';
    if (u.pathname === '/watch') return u.searchParams.get('v') || '';
    return u.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
  }
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function siteWindowKey(site, now) {
    const d = new Date(now);
    const [startHour, startMinute] = site.schedule.start.split(':').map(Number);
    const [endHour, endMinute] = site.schedule.end.split(':').map(Number);
    if (startHour * 60 + startMinute > endHour * 60 + endMinute && d.getHours() * 60 + d.getMinutes() < endHour * 60 + endMinute) d.setDate(d.getDate() - 1);
    return dayKey(+d) + ':' + site.domain;
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
      sites: {}, categories: {}, channels: {}, thaw: { weekend: 0, emergency: 0, music: 0 } };
  }
  function log(s, kind, now, details = '') {
    const d = daily(s, now);
    if (kind === 'attempt') {
      d.attempts++; d.sites[details] = (d.sites[details] || 0) + 1;
      s.recentAttempts = (s.recentAttempts || []).filter(time => time <= now && time >= now - s.config.help.windowMinutes * MINUTE).slice(-99);
      s.recentAttempts.push(now);
    }
    if (kind === 'channel') { d.channels ||= {}; d.channels[details] = (d.channels[details] || 0) + 1; }
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
      const activeSite = c.site && s.config.sites.find(site => site.domain === c.site && site.mode === 'limited');
      if (activeSite && scheduled({ schedule: { ...activeSite.schedule, enabled: true } }, from)) {
        s.siteUsage ||= {};
        const key = siteWindowKey(activeSite, from);
        s.siteUsage[key] = (s.siteUsage[key] || 0) + delta;
      }
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
    if (s.timerUntil && now >= s.timerUntil) {
      for (const [tabId, id] of Object.entries(s.timerGrants || {})) if (s.videoGrants[tabId] === id) delete s.videoGrants[tabId];
      s.timerGrants = {}; s.timerUntil = 0; s.usageMs = 0;
    }
    if (!s.timerUntil && s.usageMs >= s.config.youtube.minutes * MINUTE) s.timerUntil = now + s.config.youtube.freezeMinutes * MINUTE;
    if (s.activeThaw && !balance(s, s.activeThaw, now).available) s.activeThaw = null;
    for (const [k, g] of Object.entries(s.grants)) if (g <= now) delete s.grants[k];
    for (const key of Object.keys(s.daily).sort().slice(0, -120)) delete s.daily[key];
    for (const key of Object.keys(s.budgets)) {
      const kind = key.split(':')[0];
      if (!s.config.allowances[kind] || key !== balance(s, kind, now).key) delete s.budgets[key];
    }
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    for (const key of Object.keys(s.siteUsage || {})) if (key.slice(0, 10) < dayKey(+yesterday)) delete s.siteUsage[key];
  }
  function decision(s, url, channelRefs, tabId, now) {
    const u = parseUrl(url); if (!u) return { blocked: false };
    const host = u.hostname.toLowerCase(), config = s.config;
    if (host === 'music.youtube.com' && s.activeThaw === 'music') {
      const music = balance(s, 'music', now);
      if (music.available && music.remaining > 0) return { blocked: false, music: true, general: false, exemptYoutube: true };
    }
    const site = config.sites.filter(x => matches(host, x.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
    const mode = site?.mode || (site?.schedule?.enabled ? 'scheduled' : 'always');
    const inWindow = site && scheduled({ schedule: { ...(site.schedule || config.schedule), enabled: true } }, now);
    const limitUsed = site && mode === 'limited' ? (s.siteUsage?.[siteWindowKey(site, now)] || 0) : 0;
    const limitedAllowed = site && mode === 'limited' && inWindow && limitUsed < site.dailyMinutes * MINUTE;
    const emergency = s.activeThaw === 'emergency' && balance(s, 'emergency', now).remaining > 0;
    const general = !!site && (mode !== 'limited' || (emergency && !limitedAllowed));
    const shouldBlock = site && (mode === 'limited' ? !limitedAllowed : mode === 'always' || inWindow);
    if (shouldBlock) {
      const thaw = s.activeThaw && balance(s, s.activeThaw, now).available && balance(s, s.activeThaw, now).remaining > 0 && (s.activeThaw !== 'music' || site.kind === 'music');
      if ((!thaw || (mode === 'limited' && s.activeThaw !== 'emergency')) && !(s.grants[site.domain] > now)) return { blocked: true, reason: 'site', domain: site.domain, message: site.message || '', bypass: site.bypassEnabled !== false, phrase: site.bypassText || config.bypassText, closeSeconds: site.closeSeconds ?? config.closeSeconds, bypassMinutes: site.bypassMinutes ?? config.bypassMinutes };
    }
    const id = videoId(url);
    if (config.youtube.enabled && id) {
      if ((config.youtube.allowedVideos || []).some(video => videoId(video.url) === id)) {
        return { blocked: false, general: !!general, music: !!general && site.kind === 'music',
          limitedSite: limitedAllowed ? site.domain : null, videoId: id, exemptYoutube: true };
      }
      if (s.timerUntil > now && s.timerGrants?.[tabId] !== id) return { blocked: true, reason: 'timer', domain: 'youtube.com', videoId: id, until: s.timerUntil, bypass: true, phrase: config.bypassText };
      const refs = Array.isArray(channelRefs) ? channelRefs : [channelRefs];
      const blockedChannel = (config.youtube.channels || []).find(channel => refs.some(ref => channelKey(ref) === channelKey(channel)));
      if (blockedChannel && s.videoGrants[tabId] !== id) return { blocked: true, reason: 'channel', domain: 'youtube.com', videoId: id, channel: blockedChannel, bypass: true, phrase: config.bypassText };
    }
    return { blocked: false, general: !!general, music: !!general && site.kind === 'music', limitedSite: limitedAllowed ? site.domain : null, videoId: id };
  }
  function bypass(s, block, tabId, phrase, now) {
    if (!block?.bypass || phrase !== block.phrase) { log(s, 'failedBypasses', now); return false; }
    if (block.reason === 'site') s.grants[block.domain] = now + (block.bypassMinutes ?? s.config.bypassMinutes) * MINUTE;
    else if (block.reason === 'channel') s.videoGrants[tabId] = block.videoId;
    else if (block.reason === 'timer') {
      s.timerGrants ||= {}; s.timerGrants[tabId] = block.videoId;
      s.videoGrants[tabId] = block.videoId;
    }
    log(s, 'bypasses', now); return true;
  }
  function summary(s, now = Date.now()) {
    const week = weekKey(now), prev = new Date(week + 'T12:00:00'); prev.setDate(prev.getDate() - 7);
    const previous = weekKey(+prev);
    function aggregate(start, end) {
      const result = { attempts: 0, bypassStarts: 0, bypasses: 0, failedBypasses: 0, blockedMs: 0, youtubeMs: 0, sites: {}, categories: {}, channels: {}, thaw: { weekend: 0, emergency: 0, music: 0 } };
      for (const [key, d] of Object.entries(s.daily)) if (key >= start && key < end) {
        for (const k of ['attempts', 'bypassStarts', 'bypasses', 'failedBypasses', 'blockedMs', 'youtubeMs']) result[k] += d[k] || 0;
        for (const k of ['sites', 'categories', 'channels', 'thaw']) for (const [name, n] of Object.entries(d[k] || {})) result[k][name] = (result[k][name] || 0) + n;
      }
      return result;
    }
    const next = new Date(week + 'T12:00:00'); next.setDate(next.getDate() + 7);
    return { week, previousWeek: previous, current: aggregate(week, dayKey(+next)), previous: aggregate(previous, week) };
  }
  const api = { MINUTE, clone, defaults, settings, createState, domain, channelKey, matches, parseUrl, videoId, dayKey, weekKey, periodKey, weekend, balance, scheduled, daily, log, advance, decision, bypass, summary };
  root.Blockout = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
