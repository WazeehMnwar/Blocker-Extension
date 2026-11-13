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
test('approved domains override ordinary rules but not YouTube filters', () => {
  const s = state(); s.config.approved = ['reddit.com', 'youtube.com'];
  assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=a', 'A car restoration', 1, saturday).reason, 'keyword');
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
test('music thaw does not unlock unrelated sites or YouTube keywords', () => {
  const s = state(); s.activeThaw = 'music';
  assert.equal(B.decision(s, 'https://open.spotify.com', '', 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://reddit.com', '', 1, saturday).blocked, true);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=a', 'restoration', 1, saturday).reason, 'keyword');
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
test('keyword bypass permits only that video and preserves shared timer', () => {
  const s = state(); s.usageMs = 120000;
  const block = B.decision(s, 'https://youtube.com/watch?v=one', 'restoration', 1, saturday);
  assert.equal(B.bypass(s, block, 1, s.config.bypassText, saturday), true);
  assert.equal(s.usageMs, 120000);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', 'restoration', 1, saturday).blocked, false);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=two', 'restoration', 1, saturday).reason, 'keyword');
  s.timerUntil = saturday + 60000;
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', 'restoration', 1, saturday).reason, 'timer');
});
test('timer bypass resets shared time and allows the current video', () => {
  const s = state(); s.usageMs = 1800000; s.timerUntil = saturday + 300000;
  const block = B.decision(s, 'https://youtube.com/watch?v=one', 'restoration', 1, saturday);
  assert.equal(B.bypass(s, block, 1, s.config.bypassText, saturday), true);
  assert.equal(s.usageMs, 0); assert.equal(s.timerUntil, 0);
  assert.equal(B.decision(s, 'https://youtube.com/watch?v=one', 'restoration', 1, saturday).blocked, false);
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
