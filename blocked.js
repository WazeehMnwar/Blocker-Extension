const api = typeof browser !== 'undefined' ? browser : chrome;
const host = document.createElement('div'); document.body.appendChild(host);
const screen = BlockoutChallenge(host, message => api.runtime.sendMessage(message));
let busy = false;
async function refresh() {
  if (busy) return; busy = true;
  try { const r = await api.runtime.sendMessage({ action: 'blockState' }); if (r.block) screen.update(r.block, r.config); }
  catch { /* Tab can close or navigate while this request is in flight. */ } finally { busy = false; }
}
setInterval(refresh, 500); refresh();
