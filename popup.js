const $ = id => document.getElementById(id);
const names = { weekend: 'Weekend', emergency: 'Emergency', music: 'Music' };
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try {
    const s = await BlockoutBridge.send({ action: 'snapshot' });
    $('status-title').textContent = s.activeThaw ? 'Enjoy it intentionally.' : 'Make room for focus.';
    $('status-detail').textContent = s.activeThaw ? `${names[s.activeThaw]} thaw is armed. Time counts while an eligible site is open.` : Blockout.scheduled(s.config, Date.now()) ? 'Lockdown is active. Your boundaries are in place.' : 'Outside your lockdown schedule. Your next session is set.';
    const remaining = s.timerUntil > Date.now() ? s.timerUntil - Date.now() : Math.max(0, s.config.youtube.minutes * 60000 - s.usageMs);
    $('youtube-time').textContent = (s.timerUntil ? 'Break · ' : '') + BlockoutBridge.time(remaining);
    $('youtube-progress').style.width = `${Math.min(100, s.usageMs / (s.config.youtube.minutes * 60000) * 100)}%`;
    $('allowances').replaceChildren();
    for (const [kind, b] of Object.entries(s.balances)) {
      const row = document.createElement('div'); row.className = 'allowance-row';
      const name = document.createElement('span'); name.textContent = names[kind];
      const time = document.createElement('span'); time.className = 'mono muted'; time.textContent = BlockoutBridge.time(b.remaining);
      const button = document.createElement('button'); button.className = 'small-button'; button.textContent = s.activeThaw === kind ? 'Stop' : 'Start'; button.disabled = !b.available || b.remaining <= 0;
      button.onclick = async () => { try { await BlockoutBridge.send({ action: 'thaw', kind: s.activeThaw === kind ? null : kind }); await refresh(); } catch (e) { $('error').textContent = e.message; } };
      row.append(name, time, button); $('allowances').append(row);
    }
  } catch (e) { $('error').textContent = e.message; } finally { busy = false; }
}
refresh(); setInterval(refresh, 1000);
