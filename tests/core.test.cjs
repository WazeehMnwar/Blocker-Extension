const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../core.js');
const at = value => +new Date(value);
const saturday = at('2026-11-14T12:00:00');
const site = { domain: 'reddit.com', kind: 'general', bypassEnabled: true };
const music = { domain: 'spotify.com', kind: 'music', bypassEnabled: true };
function state() { const s = B.createState({ sites: [site, music] }); s.clock.at = saturday; return s; }
test('matches domains and subdomains without matching lookalikes', () => {
  const s = state();
  assert.equal(B.decision(s, 'https://old.reddit.com', '', 1, saturday).blocked, true);
  assert.equal(B.decision(s, 'https://notreddit.com', '', 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://reddit.com.evil.com', '', 1, saturday).blocked, false);
  assert.equal(B.domain('https://WWW.Reddit.com/path'), 'reddit.com');
  assert.equal(B.domain('javascript:alert(1)'), '');
  assert.equal(B.domain('<bad>.com'), '');
});
test('the most specific site rule takes priority', () => {
  const s = state(); s.config.sites.push({ domain: 'old.reddit.com', bypassEnabled: false });
  assert.equal(B.decision(s, 'https://old.reddit.com', '', 1, saturday).bypass, false);
});
test('each blocked website has its own schedule, phrase, delay, and access length', () => {
  const s = state();
  s.config.sites[0] = { ...site, bypassText: 'reddit phrase', bypassMinutes: 2, closeSeconds: 8,
    schedule: { enabled: true, days: [0], start: '09:00', end: '18:00' } };
  assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday).blocked, false);
  s.config.sites[0].schedule.days = [6];
  const block = B.decision(s, 'https://reddit.com', '', 1, saturday);
  assert.equal(block.phrase, 'reddit phrase');
  assert.equal(block.closeSeconds, 8);
  assert.equal(block.bypassMinutes, 2);
  assert.equal(B.decision(s, 'https://open.spotify.com', '', 2, saturday).blocked, true);
  assert.equal(B.bypass(s, block, 1, 'reddit phrase', saturday), true);
  assert.equal(B.decision(s, 'https://reddit.com', '', 2, saturday + 119000).blocked, false);
  assert.equal(B.decision(s, 'https://reddit.com', '', 2, saturday + 120000).blocked, true);
});
test('limited site grants five focused minutes in its window, then blocks', () => {
  const start = at('2026-11-14T22:00:00');
  const s = B.createState({ sites: [{ domain: 'instagram.com', mode: 'limited', dailyMinutes: 5,
    schedule: { enabled: true, days: [6], start: '22:00', end: '00:00' }, bypassEnabled: false }] });
  s.clock.at = start;
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, start - 1000).blocked, true);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, start).limitedSite, 'instagram.com');
  s.clock.site = 'instagram.com'; B.advance(s, start + 4 * 60000);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, start + 4 * 60000).blocked, false);
  s.clock.site = null; B.advance(s, start + 10 * 60000);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, start + 10 * 60000).blocked, false);
  s.clock.site = 'instagram.com'; B.advance(s, start + 11 * 60000);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, start + 11 * 60000).blocked, true);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, at('2026-11-15T00:00:00')).blocked, true);
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, at('2026-11-21T22:00:00')).blocked, false);
});
test('emergency opens a grace-period site outside its window and charges time', () => {
  const monday = at('2026-11-16T12:00:00');
  const s = B.createState({ sites: [{ domain: 'instagram.com', mode: 'limited', dailyMinutes: 5,
    schedule: { enabled: true, days: [5, 6], start: '22:00', end: '00:00' } }] });
  s.clock.at = monday;
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, monday).blocked, true);
  s.activeThaw = 'emergency';
  const open = B.decision(s, 'https://instagram.com', '', 1, monday);
  assert.equal(open.blocked, false); assert.equal(open.general, true);
  s.clock.general = true; B.advance(s, monday + 60000);
  assert.equal(B.balance(s, 'emergency', monday).remaining, 179 * 60000);
  s.activeThaw = null;
  assert.equal(B.decision(s, 'https://instagram.com', '', 1, monday + 60000).blocked, true);
});
test('thaw is manual and consumes once for open eligible tabs, including background tabs', () => {
  const s = state(); s.clock.general = true;
  B.advance(s, saturday + 60000); assert.equal(B.balance(s, 'weekend', saturday).remaining, 3600000);
  s.activeThaw = 'weekend'; B.advance(s, saturday + 120000);
  assert.equal(B.balance(s, 'weekend', saturday).remaining, 3540000);
  s.clock.general = false; B.advance(s, saturday + 180000);
  assert.equal(B.balance(s, 'weekend', saturday).remaining, 3540000);
});
test('thaw expiry immediately restores default lockdown', () => {
  const s = state(); s.activeThaw = 'weekend'; s.clock.general = true;
  assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday).blocked, false);
  B.advance(s, saturday + 3600000);
  assert.equal(s.activeThaw, null); assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday + 3600000).blocked, true);
});
test('music thaw does not unlock unrelated sites or blocked YouTube channels', () => {
  const s = state(); s.activeThaw = 'music'; s.config.youtube.channels = ['@carprojects'];
  assert.equal(B.decision(s, 'https://open.spotify.com', '', 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday).blocked, true);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=a', ['https://youtube.com/@carprojects'], 1, saturday).reason, 'channel');
});
test('music thaw opens YouTube Music without spending the YouTube session', () => {
  const s = state(); s.config.sites.push({ domain: 'music.youtube.com', kind: 'general', mode: 'always' });
  s.timerUntil = saturday + 60000; s.activeThaw = 'music';
  const allowed = B.decision(s, 'https://music.youtube.com/watch?v=abc', [], 1, saturday);
  assert.equal(allowed.blocked, false); assert.equal(allowed.music, true); assert.equal(allowed.exemptYoutube, true);
  s.clock.music = true; B.advance(s, saturday + 30000);
  assert.equal(B.balance(s, 'music', saturday).remaining, 3570000);
  assert.equal(s.usageMs, 0);
  s.activeThaw = null;
  assert.equal(B.decision(s, 'https://music.youtube.com/watch?v=abc', [], 1, saturday + 30000).reason, 'site');
});
test('music budget only counts eligible music tabs', () => {
  const s = state(); s.activeThaw = 'music'; s.clock.general = true;
  B.advance(s, saturday + 60000); assert.equal(B.balance(s, 'music', saturday).remaining, 3600000);
  s.clock.music = true; B.advance(s, saturday + 120000); assert.equal(B.balance(s, 'music', saturday).remaining, 3540000);
});
test('each weekend day has a separate budget and needs manual activation', () => {
  const s = state(); s.clock.at = at('2026-11-14T23:59:00'); s.clock.general = true; s.activeThaw = 'weekend';
  B.advance(s, at('2026-11-15T00:01:00'));
  assert.equal(s.activeThaw, null); assert.equal(B.balance(s, 'weekend', at('2026-11-15T00:01:00')).remaining, 3600000);
  assert.equal(B.balance(s, 'weekend', at('2026-11-16T12:00:00')).available, false);
});
test('weekly and monthly allowance keys reset on local calendar boundaries', () => {
  assert.equal(B.weekKey(at('2026-11-15T23:00:00')), '2026-11-09');
  assert.equal(B.weekKey(at('2026-11-16T00:00:00')), '2026-11-16');
  assert.equal(B.periodKey(at('2026-12-01T00:00:00'), 'month'), '2026-12');
});
test('overnight schedules extend into the following day only', () => {
  const c = B.defaults(); c.schedule = { enabled: true, days: [5], start: '22:00', end: '02:00' };
  assert.equal(B.scheduled(c, at('2026-11-13T23:00:00')), true);
  assert.equal(B.scheduled(c, at('2026-11-14T01:00:00')), true);
  assert.equal(B.scheduled(c, at('2026-11-14T03:00:00')), false);
  assert.equal(B.scheduled(c, at('2026-11-14T23:00:00')), false);
});
test('same start/end is all day on selected days', () => {
  const c = B.defaults(); c.schedule = { enabled: true, days: [6], start: '09:00', end: '09:00' };
  assert.equal(B.scheduled(c, saturday), true); assert.equal(B.scheduled(c, saturday + 86400000), false);
});
test('channel bypass permits only one video and preserves shared viewing time', () => {
  const s = state(); s.usageMs = 120000; s.config.youtube.channels = ['@carprojects'];
  const refs = ['https://youtube.com/@carprojects/videos'];
  const block = B.decision(s, 'https://youtube.com/watch?v=one', refs, 1, saturday);
  assert.equal(B.bypass(s, block, 1, s.config.bypassText, saturday), true);
  assert.equal(s.usageMs, 120000);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', refs, 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=two', refs, 1, saturday).reason, 'channel');
  s.timerUntil = saturday + 60000;
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', refs, 1, saturday).reason, 'timer');
});
test('timer bypass allows only the current video until the break ends', () => {
  const s = state(); s.usageMs = 1800000; s.timerUntil = saturday + 300000;
  const block = B.decision(s, 'https://youtube.com/watch?v=one', [], 1, saturday);
  assert.equal(B.bypass(s, block, 1, s.config.bypassText, saturday), true);
  assert.equal(s.usageMs, 1800000); assert.equal(s.timerUntil, saturday + 300000);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', [], 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=two', [], 1, saturday).reason, 'timer');
  B.advance(s, saturday + 300000);
  assert.equal(s.timerUntil, 0); assert.equal(s.usageMs, 0);
});
test('channel links and handles resolve to exact channel rules', () => {
  assert.equal(B.channelKey('https://www.youtube.com/@CarProjects/videos'), '@carprojects');
  assert.equal(B.channelKey('@CarProjects'), '@carprojects');
  assert.equal(B.channelKey('https://youtube.com/watch?v=one'), '');
  const s = state(); s.config.youtube.channels = ['@carprojects'];
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', ['@carprojects'], 1, saturday).reason, 'channel');
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', ['@other'], 1, saturday).blocked, false);
});
test('allowed YouTube video bypasses channel and timer blocks by video ID', () => {
  const s = state();
  s.config.youtube.channels = ['@ambient'];
  s.config.youtube.allowedVideos = [{ label: 'Rain', url: 'https://youtu.be/abcdefghijk?si=example' }];
  s.timerUntil = saturday + 60000;
  const allowed = B.decision(s, 'https://www.youtube.com/watch?v=abcdefghijk', ['@ambient'], 1, saturday);
  assert.equal(allowed.blocked, false); assert.equal(allowed.exemptYoutube, true);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=other-video', ['@ambient'], 1, saturday).reason, 'timer');
});
test('wrong phrase cannot grant an exception', () => {
  const s = state(); const block = B.decision(s, 'https://reddit.com', '', 1, saturday);
  assert.equal(B.bypass(s, block, 1, 'wrong', saturday), false);
  assert.equal(B.daily(s, saturday).failedBypasses, 1); assert.deepEqual(s.grants, {});
});
test('ordinary bypass grants a timed domain allowance across tabs', () => {
  const s = state(); const block = B.decision(s, 'https://reddit.com', '', 1, saturday);
  B.bypass(s, block, 1, s.config.bypassText, saturday);
  assert.equal(B.decision(s, 'https://reddit.com', '', 2, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://reddit.com', '', 2, saturday + 600000).blocked, true);
});
test('shared YouTube clock persists through serialized worker state and enforces a break', () => {
  let s = state(); s.clock.youtube = true; B.advance(s, saturday + 60000);
  s = JSON.parse(JSON.stringify(s)); B.advance(s, saturday + 1800000);
  assert.equal(s.usageMs, 1800000); assert.equal(s.timerUntil, saturday + 2100000);
  B.advance(s, saturday + 2100000); assert.equal(s.timerUntil, 0); assert.equal(s.usageMs, 0);
});
test('Shorts and live URLs share the same video timer', () => {
  assert.equal(B.videoId('https://www.youtube.com/shorts/abc'), 'abc');
  assert.equal(B.videoId('https://m.youtube.com/live/def'), 'def');
  assert.equal(B.videoId('https://youtube.com/results?search_query=abc'), '');
});
test('historic weekly reports exclude subsequent weeks', () => {
  const s = state(); B.log(s, 'attempt', saturday, 'reddit.com'); B.log(s, 'attempt', saturday + 7 * 86400000, 'reddit.com');
  assert.equal(B.summary(s, saturday).current.attempts, 1);
  assert.equal(B.summary(s, saturday + 7 * 86400000).previous.attempts, 1);
});
test('measured screen time and daily usage split at midnight', () => {
  const s = state(); s.clock.at = at('2026-11-14T23:59:30'); s.clock.screens = true;
  B.advance(s, at('2026-11-15T00:00:30'));
  assert.equal(s.daily['2026-11-14'].blockedMs, 30000); assert.equal(s.daily['2026-11-15'].blockedMs, 30000);
});
