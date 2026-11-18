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
function setupSettingsFolds() {
  const descriptions = {
    'youtube-heading': 'Channels, viewing time, and allowed videos',
    'budgets-heading': 'Weekend, emergency, and music time',
    'help-settings-heading': 'When repeated attempts open Need Help',
    'support-heading': 'Reminders, tasks, and saved links',
    'access-heading': 'Phrase to edit settings',
    'data-heading': 'Export and import'
  };
  document.querySelectorAll('.settings-content > .panel:not(.site-rules-panel)').forEach((panel, index) => {
    const heading = panel.querySelector(':scope > h2');
    const fold = node('details', 'settings-fold');
    const summary = node('summary', 'settings-fold-summary');
    const label = node('div', 'settings-fold-label');
    const content = node('div', 'settings-fold-content');
    fold.dataset.section = heading.id;
    label.append(heading, node('span', 'settings-fold-note', descriptions[heading.id]));
    summary.append(node('span', 'settings-fold-index', String(index + 1).padStart(2, '0')), label, node('span', 'settings-fold-chevron'));
    while (panel.firstChild) content.append(panel.firstChild);
    fold.append(summary, content);
    panel.replaceWith(fold);
  });
  $('settings-form').addEventListener('invalid', event => {
    const section = event.target.closest('.settings-fold, .rule-row');
    if (section) section.open = true;
  }, true);
  document.querySelectorAll('.settings-nav a').forEach(link => link.addEventListener('click', () => {
    const section = document.getElementById(link.hash.slice(1))?.closest('.settings-fold');
    if (section) section.open = true;
  }));
}
function route() {
  const hash = location.hash.slice(1), headings = ['rules', 'youtube', 'budgets', 'help-settings', 'support', 'access', 'data'];
  page = ['home', 'thaw', 'help', 'stats', 'settings'].includes(hash) ? hash : headings.some(h => hash === h + '-heading') ? 'settings' : 'home';
  document.querySelectorAll('.page').forEach(e => e.hidden = e.id !== 'page-' + page);
  document.querySelectorAll('[data-nav]').forEach(e => { const active = e.dataset.nav === page; e.classList.toggle('active', active); if (active) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = 'Your space / ' + ({ home: 'Overview', thaw: 'Time to unwind', help: 'Need Help', stats: 'Your week', settings: 'Settings' })[page];
  if (snapshot) { render(); if (page === 'settings' && !settingsLoaded) fillSettings(); }
  if (page === 'stats') bridge.send({ action: 'reportSeen' }).catch(() => {});
  if (hash.endsWith('-heading')) {
    const heading = $(hash);
    const section = heading?.closest('.settings-fold');
    if (section) section.open = true;
    requestAnimationFrame(() => heading?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
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
  if (page === 'help') { renderSupport(); renderNap(); }
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
    const progress = node('div', 'allowance-progress'); progress.setAttribute('role', 'progressbar');
    const progressFill = node('span'); progress.append(progressFill);
    const used = node('div', 'allowance-used'); used.dataset.used = '';
    const description = node('p', '', kind === 'weekend' ? 'Ordinary blocked sites, on Saturday and Sunday.' : kind === 'emergency' ? 'Every site in your blocked-site list, including grace-period sites. YouTube rules stay separate.' : 'YouTube Music and sites marked Music.');
    const button = node('button', 'button secondary'); button.type = 'button';
    button.onclick = async () => { try { await call({ action: 'thaw', kind: snapshot.activeThaw === kind ? null : kind }); render(); toast(snapshot.activeThaw ? `${names[kind]} allowance ready. Open an eligible site to use it.` : 'Allowance stopped. Unused time is preserved.'); } catch (e) { toast(e.message, true); } };
    const status = node('div', 'allowance-state'); status.dataset.status = '';
    card.append(top, time, caption, progress, used, description, button, status); parent.append(card);
  }
  for (const card of parent.children) {
    const kind = card.dataset.kind, b = s.balances[kind], active = s.activeThaw === kind;
    card.classList.toggle('active', active);
    card.querySelector('[data-time]').textContent = bridge.time(b.remaining);
    const spent = Math.max(0, b.total - b.remaining);
    card.querySelector('[data-used]').textContent = bridge.time(spent) + ' used this period';
    const progress = card.querySelector('.allowance-progress');
    progress.firstChild.style.width = (b.total ? Math.min(100, spent / b.total * 100) : 0) + '%';
    progress.setAttribute('aria-valuenow', String(Math.round(spent / 60000)));
    progress.setAttribute('aria-valuemax', String(b.total / 60000));
    progress.setAttribute('aria-label', names[kind] + ' minutes used');
    card.querySelector('[data-caption]').textContent = `of ${b.total / 60000} minutes · ${kind === 'weekend' ? 'per weekend day' : 'per ' + s.config.allowances[kind].period}`;
    const button = card.querySelector('button'); button.textContent = active ? 'Stop & keep unused time' : 'Start ' + names[kind].toLowerCase() + ' thaw →';
    button.disabled = !b.available || b.remaining <= 0;
    button.classList.toggle('primary', active); button.classList.toggle('secondary', !active);
    card.querySelector('[data-status]').textContent = active ? ((kind === 'music' ? s.clock.music : s.clock.general) ? '● Counting · eligible tabs are open' : 'Ⅱ Ready · no eligible tabs open') : !b.available ? 'Available Saturday & Sunday' : b.remaining <= 0 ? 'Used up for this period' : 'Not started · your time is preserved';
  }
}
const feelings = {
  uneasy: 'Feel uneasy',
  focus: "Can't focus",
  tired: 'Feeling tired',
  bored: 'Bored',
  horny: 'Horny'
};
let napUntil = Number(sessionStorage.getItem('blockoutNapUntil')) || 0;
function resetHelp() {
  $('help-step').textContent = 'CHECK IN'; $('help-question').textContent = 'How are you feeling?';
  $('help-result').hidden = true; $('help-options').hidden = false; $('help-options').replaceChildren();
  for (const [key, label] of Object.entries(feelings)) {
    const button = node('button', 'choice feeling-choice', label); button.type = 'button';
    button.onclick = () => showHelpActions(key);
    $('help-options').append(button);
  }
}
function helpLink(label, url) {
  const link = node('a', 'button secondary', label);
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function showHelpActions(key) {
  $('help-step').textContent = feelings[key].toUpperCase();
  $('help-question').textContent = 'Choose a next step';
  $('help-options').hidden = true;
  const result = $('help-result'); result.hidden = false; result.replaceChildren();
  const groups = node('div', 'help-action-grid');
  const group = title => {
    const section = node('section', 'help-action-group');
    section.append(node('h3', '', title));
    groups.append(section); return section;
  };
  const quick = group('Quick boost');
  const quickLinks = node('div', 'help-action-links');
  quickLinks.append(helpLink('Instagram', 'https://www.instagram.com/'), helpLink('LinkedIn', 'https://www.linkedin.com/'));
  quick.append(quickLinks);
  group('Talk it through').append(helpLink('Open ChatGPT', 'https://chatgpt.com/'));
  const saved = group('Listen to a saved video');
  const videos = [...(snapshot?.config.youtube.allowedVideos || []), ...(snapshot?.config.resources || []).filter(item => B.videoId(item.url))];
  const seen = new Set();
  const videoLinks = node('div', 'help-action-links');
  for (const video of videos) {
    const id = B.videoId(video.url); if (seen.has(id)) continue; seen.add(id);
    videoLinks.append(helpLink(video.label, video.url));
  }
  if (!seen.size) videoLinks.append(node('a', 'button secondary', 'Add a video in Settings'));
  if (!seen.size) videoLinks.firstChild.href = '#youtube-heading';
  saved.append(videoLinks);
  const rest = group('Power nap');
  const napControls = node('div', 'help-action-links');
  const start = node('button', 'button secondary', 'Start 20-minute timer'); start.type = 'button'; start.id = 'nap-start';
  start.onclick = () => { napUntil = Date.now() + 20 * 60000; sessionStorage.setItem('blockoutNapUntil', String(napUntil)); renderNap(); };
  const reset = node('button', 'button secondary', 'Reset timer'); reset.type = 'button'; reset.id = 'nap-reset';
  reset.onclick = () => { napUntil = 0; sessionStorage.removeItem('blockoutNapUntil'); renderNap(); };
  napControls.append(start, reset); rest.append(napControls, node('p', 'nap-status'));
  result.append(groups, node('small', '', 'Site links still follow your blocking rules.'));
  renderNap();
}
function renderNap() {
  const status = document.querySelector('#help-result .nap-status');
  if (!status) return;
  const remaining = napUntil - Date.now();
  status.textContent = !napUntil ? 'Timer not started' : remaining > 0 ? bridge.time(remaining) + ' left' : '20 minutes finished';
  document.querySelector('#nap-reset').hidden = !napUntil;
  document.querySelector('#nap-start').textContent = napUntil ? 'Restart 20-minute timer' : 'Start 20-minute timer';
}
$('help-reset').onclick = resetHelp;
function renderSupport() {
  const config = snapshot.config, fingerprint = JSON.stringify([config.promises, config.todos, config.resources, config.youtube.allowedVideos]);
  if (fingerprint === supportFingerprint) return; supportFingerprint = fingerprint;
  $('help-promises').replaceChildren(...config.promises.map(p => node('div', 'promise-item', p)));
  if (!config.promises.length) $('help-promises').append(node('p', 'empty', 'Add a note to your future self in Settings.'));
  $('help-todos').replaceChildren();
  config.todos.forEach((task, index) => { const row = node('div', 'todo-item'); const button = node('button', '', '✓'); button.setAttribute('aria-label', 'Complete ' + task); button.onclick = async () => { try { await call({ action: 'todo', index }); renderSupport(); } catch (e) { toast(e.message, true); } }; row.append(button, node('span', '', task)); $('help-todos').append(row); });
  if (!config.todos.length) $('help-todos').append(node('p', 'empty', 'A clear list starts with one small step. Add yours in Settings.'));
  $('help-resources').replaceChildren();
  for (const video of config.youtube.allowedVideos || []) {
    const a = node('a', 'resource-link', video.label + ' ↗'); a.href = video.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.append(node('small', '', 'Allowed YouTube video')); $('help-resources').append(a);
  }
  config.resources.forEach(r => { const a = node('a', 'resource-link', r.label + ' ↗'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.append(node('small', '', new URL(r.url).hostname)); $('help-resources').append(a); });
  if (!(config.youtube.allowedVideos || []).length && !config.resources.length) $('help-resources').append(node('p', 'empty', 'Save a useful video, a favorite article, or a helpful website in Settings.'));
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
  breakdown('stats-sites', current.sites, 'No blocked attempts this week.'); breakdown('stats-channels', current.channels, 'No channel blocks this week.');
  $('stats-thaw').replaceChildren(...Object.entries(current.thaw).map(([kind, value]) => { const row = node('div', 'breakdown-row'); row.append(node('span', '', names[kind]), node('span', 'mono', bridge.time(value) + ' used')); return row; }));
  $('stats-outcomes').textContent = `${current.bypassStarts} challenges started · ${current.bypasses} completed · ${current.failedBypasses} unsuccessful submissions. Remaining allowance balances are shown in Time to unwind.`;
}
function breakdown(id, data, empty) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  $(id).replaceChildren(...entries.map(([name, count]) => { const row = node('div', 'breakdown-row'); row.append(node('span', '', name), node('span', 'mono', String(count))); return row; }));
  if (!entries.length) $(id).append(node('p', 'empty', empty));
}
$('stats-week').onchange = () => { statsFingerprint = ''; renderStats(); };
function addSite(site = {}, expand = false) {
  const row = node('details', 'rule-row');
  row.open = expand;
  const summary = node('summary', 'rule-summary');
  const summaryName = node('strong', 'rule-summary-name');
  const summaryMode = node('span', 'rule-summary-mode');
  const summaryKind = node('span', 'rule-summary-kind');
  summary.append(summaryName, summaryMode, summaryKind, node('span', 'rule-summary-chevron'));
  const body = node('div', 'rule-body');
  const top = node('div', 'rule-top');
  const input = node('input'); input.type = 'text'; input.value = site.domain || ''; input.placeholder = 'example.com'; input.required = true; input.dataset.domain = ''; input.setAttribute('aria-label', 'Blocked domain');
  const kind = node('select'); kind.dataset.kind = ''; kind.setAttribute('aria-label', 'Site category'); for (const [value, label] of [['general', 'General'], ['music', 'Music']]) { const option = node('option', '', label); option.value = value; kind.append(option); } kind.value = site.kind || 'general';
  const remove = node('button', 'remove-rule', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove site rule'); remove.onclick = () => { row.remove(); settingsDirty = true; $('save-status').textContent = 'You have unsaved changes.'; };
  const message = node('input', 'rule-message'); message.placeholder = 'Optional message on this site’s block screen'; message.value = site.message || ''; message.dataset.message = ''; message.setAttribute('aria-label', 'Block screen message');
  const field = (text, control) => { const label = node('label', 'rule-field'); label.append(node('span', '', text), control); return label; };
  const numeric = (key, value, min, max) => { const control = node('input'); control.type = 'number'; control.min = min; control.max = max; control.required = true; control.value = value; control.dataset[key] = ''; return control; };
  const access = node('label', 'toggle-row'); const check = node('input'); check.type = 'checkbox'; check.checked = site.bypassEnabled === true; check.dataset.bypass = ''; access.append(check, document.createTextNode('Allow temporary access with a phrase'));
  const phrase = node('textarea'); phrase.rows = 2; phrase.dataset.phrase = ''; phrase.value = site.bypassText || ''; phrase.placeholder = 'Type the phrase for this website'; phrase.required = check.checked;
  const minutes = numeric('minutes', site.bypassMinutes ?? 10, 0.1, 180); minutes.step = 'any';
  const accessFields = node('div', 'rule-fields'); accessFields.append(field('Phrase to type', phrase), field('Access lasts (minutes)', minutes));
  check.onchange = () => { phrase.required = check.checked; accessFields.hidden = !check.checked; };
  accessFields.hidden = !check.checked;
  const close = numeric('close', site.closeSeconds ?? 5, 0, 3600);
  const schedule = site.schedule || { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' };
  const mode = node('select'); mode.dataset.mode = '';
  for (const [value, label] of [['always', 'Block all the time'], ['scheduled', 'Block at set times'], ['limited', 'Grace period at set times']]) { const option = node('option', '', label); option.value = value; mode.append(option); }
  mode.value = site.mode || (schedule.enabled ? 'scheduled' : 'always');
  const dailyMinutes = numeric('dailyMinutes', site.dailyMinutes ?? 5, 0.1, 1440); dailyMinutes.step = 'any';
  const limitField = field('Grace period (focused minutes)', dailyMinutes);
  const days = node('div', 'day-picker'); days.dataset.days = '';
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((name, index) => { const day = node('label'); const box = node('input'); box.type = 'checkbox'; box.value = index; box.checked = schedule.days.includes(index); day.append(box, document.createTextNode(name)); days.append(day); });
  const start = node('input'); start.type = 'time'; start.required = true; start.dataset.start = ''; start.value = schedule.start;
  const end = node('input'); end.type = 'time'; end.required = true; end.dataset.end = ''; end.value = schedule.end;
  const times = node('div', 'rule-schedule'); const timeFields = node('div', 'rule-fields');
  const startField = field('Access starts', start), endField = field('Access ends', end);
  const timeHeading = node('strong', 'rule-time-heading');
  timeFields.append(startField, endField); times.append(timeHeading, days, timeFields, node('small', '', 'Same start and end means all day. Overnight hours count toward the day they start.'));
  const syncMode = () => {
    times.hidden = mode.value === 'always'; limitField.hidden = mode.value !== 'limited'; dailyMinutes.required = mode.value === 'limited';
    timeHeading.textContent = mode.value === 'limited' ? 'Hours when grace time is available' : 'Hours when this website is blocked';
    startField.firstChild.textContent = mode.value === 'limited' ? 'Access starts' : 'Block starts';
    endField.firstChild.textContent = mode.value === 'limited' ? 'Access ends' : 'Block ends';
    row.dataset.ruleMode = mode.value;
  };
  const updateSummary = () => {
    summaryName.textContent = input.value.trim() || 'New website';
    summaryMode.textContent = mode.selectedOptions[0].textContent;
    summaryKind.textContent = kind.selectedOptions[0].textContent;
  };
  mode.onchange = () => { syncMode(); updateSummary(); };
  input.addEventListener('input', updateSummary);
  kind.addEventListener('change', updateSummary);
  syncMode(); updateSummary();
  const blocking = node('div', 'rule-group');
  blocking.append(node('h3', '', 'When to block'), field('Blocking mode', mode), limitField, times);
  const screen = node('div', 'rule-group');
  screen.append(node('h3', '', 'Block screen'), field('Message (optional)', message), field('Close tab after (seconds; 0 keeps it open)', close));
  const exception = node('div', 'rule-group');
  exception.append(node('h3', '', 'Temporary access'), access, accessFields);
  top.append(field('Website', input), field('Category', kind), remove);
  body.append(top, blocking, screen, exception);
  row.append(summary, body);
  row.addEventListener('toggle', () => {
    if (row.open) $('site-rules').querySelectorAll('.rule-row').forEach(other => { if (other !== row) other.open = false; });
  });
  $('site-rules').append(row);
}
function fillSettings() {
  if (!snapshot || settingsDirty) return;
  const c = snapshot.config; settingsLoaded = true;
  $('site-rules').replaceChildren(); c.sites.forEach(site => addSite({
    ...site, bypassText: site.bypassText || c.bypassText,
    schedule: site.schedule || c.schedule, closeSeconds: site.closeSeconds ?? c.closeSeconds,
    bypassMinutes: site.bypassMinutes ?? c.bypassMinutes
  }));
  $('password-phrase').value = ''; $('youtube-bypass-phrase').value = '';
  $('help-attempts').value = c.help.attempts; $('help-window').value = c.help.windowMinutes;
  $('password-enabled').checked = c.passwordEnabled; $('youtube-enabled').checked = c.youtube.enabled;
  $('youtube-minutes').value = c.youtube.minutes; $('youtube-freeze').value = c.youtube.freezeMinutes;
  $('youtube-channels').value = (c.youtube.channels || []).join('\n');
  $('youtube-allowed-videos').value = (c.youtube.allowedVideos || []).map(video => video.label + ' | ' + video.url).join('\n');
  for (const kind of Object.keys(names)) $('' + kind + '-minutes').value = c.allowances[kind].minutes;
  $('emergency-period').value = c.allowances.emergency.period; $('music-period').value = c.allowances.music.period;
  $('promises').value = c.promises.join('\n'); $('todos').value = c.todos.join('\n'); $('resources').value = c.resources.map(r => r.label + ' | ' + r.url).join('\n');
}
function readSettings() {
  const c = B.clone(snapshot.config), num = id => Number($(id).value);
  c.sites = [...$('site-rules').children].map(row => ({
    domain: row.querySelector('[data-domain]').value, kind: row.querySelector('[data-kind]').value,
    message: row.querySelector('[data-message]').value, bypassEnabled: row.querySelector('[data-bypass]').checked,
    bypassText: row.querySelector('[data-phrase]').value.trim(),
    bypassMinutes: Number(row.querySelector('[data-minutes]').value),
    closeSeconds: Number(row.querySelector('[data-close]').value),
    mode: row.querySelector('[data-mode]').value,
    dailyMinutes: Number(row.querySelector('[data-daily-minutes]').value),
    schedule: { enabled: row.querySelector('[data-mode]').value !== 'always',
      days: [...row.querySelector('[data-days]').querySelectorAll('input:checked')].map(e => Number(e.value)),
      start: row.querySelector('[data-start]').value, end: row.querySelector('[data-end]').value }
  }));
  c.approved = []; c.bypassText = $('youtube-bypass-phrase').value.trim(); c.passwordText = $('password-phrase').value.trim(); c.passwordEnabled = $('password-enabled').checked;
  c.help = { attempts: num('help-attempts'), windowMinutes: num('help-window') };
  c.youtube = { enabled: $('youtube-enabled').checked, minutes: num('youtube-minutes'), freezeMinutes: num('youtube-freeze'),
    channels: lines($('youtube-channels').value).map(value => {
      const key = B.channelKey(value); if (!key) throw Error('Use a YouTube channel URL or @handle on each line.'); return key;
    }),
    allowedVideos: lines($('youtube-allowed-videos').value).map(line => {
      const sep = line.indexOf('|'), label = line.slice(0, sep).trim(), url = line.slice(sep + 1).trim();
      if (sep < 1 || !label || !B.videoId(url)) throw Error('Allowed videos use: Title | YouTube video URL.');
      return { label, url };
    }) };
  for (const kind of Object.keys(names)) c.allowances[kind].minutes = num(kind + '-minutes');
  c.allowances.emergency.period = $('emergency-period').value; c.allowances.music.period = $('music-period').value;
  c.promises = lines($('promises').value); c.todos = lines($('todos').value);
  c.resources = lines($('resources').value).map(line => { const sep = line.indexOf('|'); if (sep < 1 || !B.parseUrl(line.slice(sep + 1).trim())) throw Error('Saved resources use: Title | https://address'); return { label: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() }; });
  return c;
}
$('add-site').onclick = () => { addSite({}, true); settingsDirty = true; $('save-status').textContent = 'You have unsaved changes.'; $('site-rules').lastElementChild.querySelector('[data-domain]').focus(); };
$('settings-form').addEventListener('input', () => { settingsDirty = true; $('save-status').textContent = 'You have unsaved changes.'; });
$('settings-form').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try { await call({ action: 'settings', config: readSettings() }); settingsDirty = false; settingsLoaded = false; fillSettings(); render(); $('save-status').textContent = 'Settings saved.'; toast('Settings saved.'); }
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
async function refresh() {
  if (busy) return; busy = true;
  try { await call({ action: 'snapshot' }); render(); if (page === 'settings' && !settingsLoaded) fillSettings(); }
  catch (error) { toast(error.message, true); } finally { busy = false; }
}
window.addEventListener('beforeunload', e => { if (settingsDirty) { e.preventDefault(); e.returnValue = ''; } });
setupSettingsFolds(); resetHelp(); route(); refresh(); setInterval(refresh, 1000);
