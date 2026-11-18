const $ = id => document.getElementById(id);
const names = { weekend: 'Weekend', emergency: 'Emergency', music: 'Music' };
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const s = await BlockoutBridge.send({ action: 'snapshot' });
    $('status-title').textContent = s.activeThaw ? 'Allowance active' : 'Website rules';
    $('status-detail').textContent = s.activeThaw === 'music' ? 'YouTube Music and music sites are available. Time runs while a tab is open.' : s.activeThaw === 'emergency' ? 'Blocked websites are available. YouTube rules still apply.' : s.activeThaw ? 'Time runs while an eligible site is open.' : `${s.config.sites.length} website rules configured.`;
    const remaining = s.timerUntil > Date.now() ? s.timerUntil - Date.now() : Math.max(0, s.config.youtube.minutes * 60000 - s.usageMs);
    $('youtube-time').textContent = (s.timerUntil ? 'Break · ' : '') + BlockoutBridge.time(remaining);
    $('youtube-progress').style.width = `${Math.min(100, s.usageMs / (s.config.youtube.minutes * 60000) * 100)}%`;
    $('youtube-used').textContent = `${BlockoutBridge.time(s.usageMs)} used of ${BlockoutBridge.time(s.config.youtube.minutes * 60000)}`;
    $('allowances').replaceChildren();
    for (const [kind, b] of Object.entries(s.balances)) {
      const row = document.createElement('div'); row.className = 'allowance-row';
      const name = document.createElement('span'); name.textContent = names[kind];
      const meter = document.createElement('span'); meter.className = 'allowance-metrics';
      const time = document.createElement('span'); time.className = 'mono'; time.textContent = BlockoutBridge.time(b.remaining) + ' left';
      const used = document.createElement('small'); used.textContent = BlockoutBridge.time(Math.max(0, b.total - b.remaining)) + ' used';
      meter.append(time, used);
      const button = document.createElement('button'); button.className = 'small-button'; button.textContent = s.activeThaw === kind ? 'Stop' : 'Start'; button.disabled = !b.available || b.remaining <= 0;
      button.onclick = async () => { try { await BlockoutBridge.send({ action: 'thaw', kind: s.activeThaw === kind ? null : kind }); await refresh(); } catch (e) { $('error').textContent = e.message; } };
      row.append(name, meter, button); $('allowances').append(row);
    }
  } catch (e) { $('error').textContent = e.message; } finally { busy = false; }
}
refresh(); setInterval(refresh, 1000);
