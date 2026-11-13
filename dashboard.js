'use strict';
const $ = id => document.getElementById(id);
const B = Blockout, bridge = BlockoutBridge;
const names = { weekend: 'Weekend', emergency: 'Emergency', music: 'Music' };
const icons = { weekend: '◷', emergency: '✳', music: '♫' };
let snapshot, page = 'home', busy = false, settingsDirty = false, settingsLoaded = false, supportFingerprint = '', statsFingerprint = '', toastTimer;
const lines = value => value.split('\n').map(s => s.trim()).filter(Boolean);
function node(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function toast(text, error = false) { const e = $('toast'); e.textContent = text; e.hidden = false; e.classList.toggle('error-toast', error); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.hidden = true, 4500); }
async function call(message) { const result = await bridge.send(message); if (result.config) snapshot = result; return result; }
function route() {
  const hash = location.hash.slice(1), headings = ['rules', 'schedule', 'youtube', 'budgets', 'support', 'data'];
  page = ['home', 'thaw', 'help', 'stats', 'settings'].includes(hash) ? hash : headings.some(h => hash === h + '-heading') ? 'settings' : 'home';
  document.querySelectorAll('.page').forEach(e => e.hidden = e.id !== 'page-' + page);
  document.querySelectorAll('[data-nav]').forEach(e => { const active = e.dataset.nav === page; e.classList.toggle('active', active); if (active) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = 'Your space / ' + ({ home: 'Overview', thaw: 'Time to unwind', help: 'Need Help', stats: 'Your week', settings: 'Settings' })[page];
  if (snapshot) { render(); if (page === 'settings' && !settingsLoaded) fillSettings(); }
  if (page === 'stats') bridge.send({ action: 'reportSeen' }).catch(() => {});
  if (hash.endsWith('-heading')) requestAnimationFrame(() => $(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('today').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date());
$('preview-badge').hidden = bridge.live;
function render() {
  if (!snapshot) return;
  const s = snapshot, now = Date.now(), scheduled = B.scheduled(s.config, now);
  if (page === 'home') {
    $('lockdown-badge').replaceChildren(node('span', 'status-dot'), document.createTextNode(s.activeThaw ? names[s.activeThaw].toUpperCase() + ' THAW ACTIVE' : scheduled ? 'LOCKDOWN ACTIVE' : 'OUTSIDE SCHEDULE'));
    $('focus-title').innerText = s.activeThaw ? 'Time to enjoy.\nOn your terms.' : 'Your attention\nhas a home.';
    $('focus-detail').innerText = s.activeThaw ? 'Your allowance is ready.\nClose eligible tabs to pause the clock.' : 'Distractions have boundaries.\nWhat matters gets your time.';
    $('rule-count').textContent = `${s.config.sites.length} site ${s.config.sites.length === 1 ? 'boundary' : 'boundaries'}`;
    const breaking = s.timerUntil > now;
    const remaining = breaking ? s.timerUntil - now : Math.max(0, s.config.youtube.minutes * 60000 - s.usageMs);
    const [m, sec] = bridge.time(remaining).split(':');
    $('session-time').replaceChildren(document.createTextNode(m), node('span', '', ':' + sec));
    $('session-caption').textContent = !s.config.youtube.enabled ? 'YouTube rules are turned off' : breaking ? 'remaining in your break' : 'remaining in this session';
    $('session-limit').textContent = `${s.config.youtube.minutes} min limit`;
    $('session-progress').style.width = `${Math.min(100, s.usageMs / (s.config.youtube.minutes * 60000) * 100)}%`;
    $('home-promise').textContent = '“' + (s.config.promises[0] || 'Give your attention to something you chose.') + '”';
    allowances('home-allowances');
  }
  if (page === 'thaw') allowances('thaw-allowances');
  if (page === 'help') renderSupport();
  if (page === 'stats') renderStats();
  if (page === 'settings') {
    $('unlock-form').hidden = !s.locked; $('settings-form').hidden = s.locked; $('lock-settings').hidden = !s.config.passwordEnabled || s.locked;
  }
}
function allowances(id) {
  const parent = $(id), s = snapshot;
  if (!parent.children.length) for (const kind of Object.keys(names)) {
    const card = node('article', 'allowance-card ' + kind); card.dataset.kind = kind;
    const top = node('div', 'split'); top.append(node('h3', '', names[kind]), node('span', 'allowance-icon', icons[kind]));
    const time = node('div', 'allowance-time'); time.dataset.time = '';
    const caption = node('small'); caption.dataset.caption = '';
    const description = node('p', '', kind === 'weekend' ? 'A little entertainment, each weekend day.' : kind === 'emergency' ? 'Extra breathing room for the harder days.' : 'A soundtrack, without opening everything.');
    const button = node('button', 'button secondary'); button.type = 'button';
    button.onclick = async () => { try { await call({ action: 'thaw', kind: snapshot.activeThaw === kind ? null : kind }); render(); toast(snapshot.activeThaw ? `${names[kind]} allowance ready. Open an eligible site to use it.` : 'Allowance stopped. Unused time is preserved.'); } catch (e) { toast(e.message, true); } };
    const status = node('div', 'allowance-state'); status.dataset.status = '';
    card.append(top, time, caption, description, button, status); parent.append(card);
  }
  for (const card of parent.children) {
    const kind = card.dataset.kind, b = s.balances[kind], active = s.activeThaw === kind;
    card.classList.toggle('active', active);
    card.querySelector('[data-time]').textContent = bridge.time(b.remaining);
    card.querySelector('[data-caption]').textContent = `of ${b.total / 60000} minutes · ${kind === 'weekend' ? 'per weekend day' : 'per ' + s.config.allowances[kind].period}`;
    const button = card.querySelector('button'); button.textContent = active ? 'Stop & keep unused time' : 'Start ' + names[kind].toLowerCase() + ' thaw →';
    button.disabled = !b.available || b.remaining <= 0;
    button.classList.toggle('primary', active); button.classList.toggle('secondary', !active);
    card.querySelector('[data-status]').textContent = active ? ((kind === 'music' ? s.clock.music : s.clock.general) ? '● Counting · eligible tabs are open' : 'Ⅱ Ready · no eligible tabs open') : !b.available ? 'Available Saturday & Sunday' : b.remaining <= 0 ? 'Used up for this period' : 'Not started · your time is preserved';
  }
}
const flows = {
  focus: { icon: '◎', label: 'I can’t focus', question: 'What would help you get started?', choices: [['small', 'Make the task smaller'], ['clarity', 'See what I planned to do']] },
  uneasy: { icon: '≈', label: 'I feel uneasy', question: 'What kind of support sounds useful?', choices: [['breathe', 'A quiet minute'], ['talk', 'Talk it through']] },
  tired: { icon: '☾', label: 'I’m tired', question: 'What does your energy need?', choices: [['break', 'A short break away from the screen'], ['nap', 'A brief desk nap']] },
  bored: { icon: '◌', label: 'I’m bored', question: 'What would feel better than a feed?', choices: [['alternative', 'Something I saved for this moment'], ['move', 'A change of scene']] },
  scroll: { icon: '↻', label: 'I want to scroll', question: 'What would you like to try first?', choices: [['promise', 'Remember why I set these rules'], ['alternative', 'Choose a saved alternative']] }
};
const recommendations = {
  small: ['Make it almost too easy.', 'Pick one task below. Work on just the first sentence, page, or small step for five minutes. You can decide what comes next after that.'],
  clarity: ['One thing. Then the next.', 'Look at your tasks below and choose the smallest useful step. You don’t have to finish everything right now.'],
  breathe: ['Take a minute without a feed.', 'Put your feet on the floor, relax your shoulders, and breathe at a comfortable pace. Give yourself a moment before choosing what to do next.'],
  talk: ['Put the feeling into words.', 'Write down what’s on your mind, or talk it through with ChatGPT. Opening a conversation does not disable your boundaries.'],
  break: ['Step away for a little while.', 'Get some water, stretch, or look outside for five minutes. Leave the screen behind; your rules will still be here when you return.'],
  nap: ['Rest is a useful next step.', 'If it suits your day, set an alarm for a short rest in a comfortable, safe place. Come back to one small task afterward.'],
  alternative: ['Choose something you already chose.', 'Open a saved resource below. There’s no recommendation feed here. Your normal website and YouTube rules still apply.'],
  move: ['Change the scene.', 'Stand up, walk for a few minutes, or step outside if you can. Give yourself a different input before you decide what comes next.'],
  promise: ['Come back to your own words.', 'Read one of your promises below. Take a breath, then choose the next thing you want to give your attention to.']
};
function resetHelp() {
  $('help-step').textContent = 'A SMALL CHECK-IN'; $('help-question').textContent = 'How are you feeling right now?'; $('help-result').hidden = true; $('help-options').hidden = false; $('help-options').replaceChildren();
  for (const [key, flow] of Object.entries(flows)) {
    const button = node('button', 'choice'); button.type = 'button'; button.append(node('span', '', flow.icon), document.createTextNode(flow.label));
    button.onclick = () => {
      $('help-step').textContent = flow.label.toUpperCase(); $('help-question').textContent = flow.question; $('help-options').replaceChildren();
      for (const [result, label] of flow.choices) {
        const choice = node('button', 'choice', label); choice.type = 'button'; choice.onclick = () => showRecommendation(result); $('help-options').append(choice);
      }
    };
    $('help-options').append(button);
  }
}
function showRecommendation(key) {
  const [title, detail] = recommendations[key]; $('help-question').textContent = title; $('help-options').hidden = true;
  const result = $('help-result'); result.hidden = false; result.replaceChildren(node('p', 'help-result-text', detail));
  if (key === 'talk') { const a = node('a', 'button primary', 'Open ChatGPT ↗'); a.href = 'https://chatgpt.com/'; a.target = '_blank'; a.rel = 'noopener noreferrer'; result.append(a); }
  if (key === 'promise') result.append(node('p', 'promise-item', snapshot.config.promises[0] || 'Give your attention to something you chose.'));
  result.append(node('small', '', 'This walkthrough does not turn off lockdown.'));
}
$('help-reset').onclick = resetHelp;
function renderSupport() {
  const config = snapshot.config, fingerprint = JSON.stringify([config.promises, config.todos, config.resources]);
  if (fingerprint === supportFingerprint) return; supportFingerprint = fingerprint;
  $('help-promises').replaceChildren(...config.promises.map(p => node('div', 'promise-item', p)));
  if (!config.promises.length) $('help-promises').append(node('p', 'empty', 'Add a note to your future self in Settings.'));
  $('help-todos').replaceChildren();
  config.todos.forEach((task, index) => { const row = node('div', 'todo-item'); const button = node('button', '', '✓'); button.setAttribute('aria-label', 'Complete ' + task); button.onclick = async () => { try { await call({ action: 'todo', index }); renderSupport(); } catch (e) { toast(e.message, true); } }; row.append(button, node('span', '', task)); $('help-todos').append(row); });
  if (!config.todos.length) $('help-todos').append(node('p', 'empty', 'A clear list starts with one small step. Add yours in Settings.'));
  $('help-resources').replaceChildren();
  config.resources.forEach(r => { const a = node('a', 'resource-link', r.label + ' ↗'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(node('small', '', new URL(r.url).hostname)); $('help-resources').append(a); });
  if (!config.resources.length) $('help-resources').append(node('p', 'empty', 'Save a useful video, a favorite article, or a helpful website in Settings.'));
}
function renderStats() {
  const weeks = [...new Set([snapshot.stats.week, ...Object.keys(snapshot.daily).map(d => B.weekKey(+new Date(d + 'T12:00:00')))])].sort().reverse();
  const old = $('stats-week').value;
  if ([...$('stats-week').options].map(o => o.value).join() !== weeks.join()) {
    $('stats-week').replaceChildren(...weeks.map(w => { const e = node('option', '', w === snapshot.stats.week ? 'This week · ' + w : 'Week of ' + w); e.value = w; return e; }));
    const requested = new URL(location.href).searchParams.get('week');
    if (weeks.includes(old)) $('stats-week').value = old;
    else if (weeks.includes(requested)) $('stats-week').value = requested;
  }
  const selected = $('stats-week').value || snapshot.stats.week;
  const fingerprint = JSON.stringify([selected, snapshot.daily]); if (fingerprint === statsFingerprint) return; statsFingerprint = fingerprint;
  const report = B.summary({ daily: snapshot.daily }, +new Date(selected + 'T12:00:00'));
  const current = report.current, previous = report.previous;
  const cards = [['Blocked attempts', 'attempts', String], ['Completed bypasses', 'bypasses', String], ['Time on block screens', 'blockedMs', value => bridge.time(value)], ['YouTube viewing time', 'youtubeMs', value => Math.round(value / 60000) + 'm']];
  $('stat-cards').replaceChildren(...cards.map(([label, key, format]) => { const card = node('article', 'stat-card'); const delta = current[key] - previous[key]; card.append(node('div', 'label', label), node('div', 'value', format(current[key])), node('div', 'comparison', previous[key] ? `${delta >= 0 ? '+' : '−'}${format(Math.abs(delta))} vs previous week` : 'No previous-week baseline')); return card; }));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(selected + 'T12:00:00'); d.setDate(d.getDate() + i); return { key: B.dayKey(+d), label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d) }; });
  const values = days.map(d => snapshot.daily[d.key]?.attempts || 0), max = Math.max(1, ...values);
  $('daily-chart').replaceChildren(...days.map((d, i) => { const col = node('div', 'chart-column'); const bar = node('div', 'chart-bar'); bar.style.height = Math.max(2, values[i] / max * 140) + 'px'; col.append(node('span', 'chart-number', String(values[i])), bar, node('span', 'chart-label', d.label)); return col; }));
  $('daily-chart').setAttribute('aria-label', days.map((d, i) => `${d.label}: ${values[i]} blocked attempts`).join(', '));
  breakdown('stats-sites', current.sites, 'No blocked attempts this week.'); breakdown('stats-keywords', current.categories, 'No keyword matches this week.');
  $('stats-thaw').replaceChildren(...Object.entries(current.thaw).map(([kind, value]) => { const row = node('div', 'breakdown-row'); row.append(node('span', '', names[kind]), node('span', 'mono', bridge.time(value) + ' used')); return row; }));
  $('stats-outcomes').textContent = `${current.bypassStarts} challenges started · ${current.bypasses} completed · ${current.failedBypasses} unsuccessful submissions. Remaining allowance balances are shown in Time to unwind.`;
}
function breakdown(id, data, empty) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  $(id).replaceChildren(...entries.map(([name, count]) => { const row = node('div', 'breakdown-row'); row.append(node('span', '', name), node('span', 'mono', String(count))); return row; }));
  if (!entries.length) $(id).append(node('p', 'empty', empty));
}
$('stats-week').onchange = () => { statsFingerprint = ''; renderStats(); };
function addSite(site = {}) {
  const row = node('div', 'rule-row');
  const top = node('div', 'rule-top');
  const input = node('input'); input.type = 'text'; input.value = site.domain || ''; input.placeholder = 'example.com'; input.required = true; input.dataset.domain = ''; input.setAttribute('aria-label', 'Blocked domain');
  const kind = node('select'); kind.dataset.kind = ''; kind.setAttribute('aria-label', 'Site category'); for (const [value, label] of [['general', 'General'], ['music', 'Music']]) { const option = node('option', '', label); option.value = value; kind.append(option); } kind.value = site.kind || 'general';
  const remove = node('button', 'remove-rule', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove site rule'); remove.onclick = () => { row.remove(); settingsDirty = true; $('save-status').textContent = 'You have unsaved changes.'; };
  const message = node('input', 'rule-message'); message.placeholder = 'Optional message on this site’s block screen'; message.value = site.message || ''; message.dataset.message = ''; message.setAttribute('aria-label', 'Block screen message');
  const label = node('label', 'toggle-row'); const check = node('input'); check.type = 'checkbox'; check.checked = site.bypassEnabled !== false; check.dataset.bypass = ''; label.append(check, document.createTextNode('Allow a typed-phrase exception'));
  top.append(input, kind, remove); row.append(top, message, label); $('site-rules').append(row);
}
function fillSettings() {
  if (!snapshot || settingsDirty) return;
  const c = snapshot.config; settingsLoaded = true;
  $('site-rules').replaceChildren(); c.sites.forEach(addSite);
  $('approved-domains').value = c.approved.join('\n'); $('schedule-enabled').checked = c.schedule.enabled;
  $('schedule-days').replaceChildren(...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => { const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.value = i; input.checked = c.schedule.days.includes(i); label.append(input, document.createTextNode(d)); return label; }));
  $('schedule-start').value = c.schedule.start; $('schedule-end').value = c.schedule.end;
  $('close-seconds').value = c.closeSeconds; $('bypass-minutes').value = c.bypassMinutes; $('bypass-phrase').value = ''; $('password-phrase').value = '';
  $('password-enabled').checked = c.passwordEnabled; $('youtube-enabled').checked = c.youtube.enabled;
  $('youtube-minutes').value = c.youtube.minutes; $('youtube-freeze').value = c.youtube.freezeMinutes;
  $('youtube-keywords').value = c.youtube.keywords.map(g => g.name + ': ' + g.words.join(', ')).join('\n');
  for (const kind of Object.keys(names)) $('' + kind + '-minutes').value = c.allowances[kind].minutes;
  $('emergency-period').value = c.allowances.emergency.period; $('music-period').value = c.allowances.music.period;
  $('promises').value = c.promises.join('\n'); $('todos').value = c.todos.join('\n'); $('resources').value = c.resources.map(r => r.label + ' | ' + r.url).join('\n');
}
function readSettings() {
  const c = B.clone(snapshot.config), num = id => Number($(id).value);
  c.sites = [...$('site-rules').children].map(row => ({ domain: row.querySelector('[data-domain]').value, kind: row.querySelector('[data-kind]').value, message: row.querySelector('[data-message]').value, bypassEnabled: row.querySelector('[data-bypass]').checked }));
  c.approved = lines($('approved-domains').value); c.schedule = { enabled: $('schedule-enabled').checked, days: [...$('schedule-days').querySelectorAll('input:checked')].map(e => Number(e.value)), start: $('schedule-start').value, end: $('schedule-end').value };
  c.closeSeconds = num('close-seconds'); c.bypassMinutes = num('bypass-minutes'); c.bypassText = $('bypass-phrase').value.trim(); c.passwordText = $('password-phrase').value.trim(); c.passwordEnabled = $('password-enabled').checked;
  c.youtube = { enabled: $('youtube-enabled').checked, minutes: num('youtube-minutes'), freezeMinutes: num('youtube-freeze'), keywords: parseKeywords($('youtube-keywords').value) };
  for (const kind of Object.keys(names)) c.allowances[kind].minutes = num(kind + '-minutes');
  c.allowances.emergency.period = $('emergency-period').value; c.allowances.music.period = $('music-period').value;
  c.promises = lines($('promises').value); c.todos = lines($('todos').value);
  c.resources = lines($('resources').value).map(line => { const sep = line.indexOf('|'); if (sep < 1 || !B.parseUrl(line.slice(sep + 1).trim())) throw Error('Saved resources use: Title | https://address'); return { label: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() }; });
  return c;
}
function parseKeywords(text) {
  return lines(text).map(line => { const i = line.indexOf(':'); if (i < 1) throw Error('Keyword groups use: Category: phrase, phrase'); const words = line.slice(i + 1).split(',').map(w => w.trim()).filter(Boolean); if (!words.length) throw Error('Each keyword group needs at least one phrase.'); return { name: line.slice(0, i).trim(), words }; });
}
$('add-site').onclick = () => { addSite(); settingsDirty = true; $('site-rules').lastElementChild.querySelector('input').focus(); };
$('settings-form').addEventListener('input', () => { settingsDirty = true; $('save-status').textContent = 'You have unsaved changes.'; });
$('settings-form').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try { await call({ action: 'settings', config: readSettings() }); settingsDirty = false; settingsLoaded = false; fillSettings(); render(); $('save-status').textContent = 'Saved. Your boundaries are in place.'; toast('Your boundaries have been saved.'); }
  catch (error) { toast(error.message, true); $('save-status').textContent = error.message; } finally { button.disabled = false; }
};
$('unlock-phrase').addEventListener('paste', e => e.preventDefault()); $('unlock-phrase').addEventListener('drop', e => e.preventDefault());
$('unlock-form').onsubmit = async e => { e.preventDefault(); try { const r = await call({ action: 'unlock', phrase: $('unlock-phrase').value }); if (!r.ok) $('unlock-error').textContent = 'The phrase doesn’t match yet.'; else { $('unlock-phrase').value = ''; await refresh(); fillSettings(); } } catch (error) { toast(error.message, true); } };
$('lock-settings').onclick = async () => { try { await call({ action: 'lock' }); await refresh(); } catch (e) { toast(e.message, true); } };
$('export-data').onclick = async () => {
  try { const r = await call({ action: 'export' }); const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })); const a = node('a'); a.href = url; a.download = 'blockout-backup-' + B.dayKey(Date.now()) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); } catch (e) { toast(e.message, true); }
};
$('import-data').onclick = () => $('backup-file').click();
$('backup-file').onchange = async e => { try { const file = e.target.files[0]; if (!file) return; if (file.size > 2000000) throw Error('Choose a backup under 2 MB.'); await call({ action: 'import', data: JSON.parse(await file.text()) }); settingsDirty = false; fillSettings(); render(); toast('Settings imported. Spent time was preserved.'); } catch (error) { toast(error.message, true); } finally { e.target.value = ''; } };
$('import-keywords').onclick = () => $('keyword-file').click();
$('keyword-file').onchange = async e => { try { const file = e.target.files[0]; if (!file) return; if (file.size > 200000) throw Error('Choose a keyword file under 200 KB.'); const groups = JSON.parse(await file.text()); if (!Array.isArray(groups) || groups.some(g => !g.name || !Array.isArray(g.words) || g.words.some(w => typeof w !== 'string'))) throw Error('Use a JSON array of {name, words} groups.'); $('youtube-keywords').value = groups.map(g => g.name + ': ' + g.words.join(', ')).join('\n'); settingsDirty = true; $('save-status').textContent = 'Keywords imported. Save to apply them.'; } catch (error) { toast(error.message, true); } finally { e.target.value = ''; } };
async function refresh() {
  if (busy) return; busy = true;
  try { await call({ action: 'snapshot' }); render(); if (page === 'settings' && !settingsLoaded) fillSettings(); }
  catch (error) { toast(error.message, true); } finally { busy = false; }
}
window.addEventListener('beforeunload', e => { if (settingsDirty) { e.preventDefault(); e.returnValue = ''; } });
resetHelp(); route(); refresh(); setInterval(refresh, 1000);
