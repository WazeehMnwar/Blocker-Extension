(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let screen = null, host = null, busy = false, previousInert = false, nextTick = null;
  const send = message => api.runtime.sendMessage(message);
  function channelRefs() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return [];
    const watchId = new URL(location.href).searchParams.get('v');
    const watch = document.querySelector('ytd-watch-flexy[video-id]');
    if (watchId && watch && watch.getAttribute('video-id') !== watchId) return [];
    const owners = document.querySelectorAll('ytd-watch-metadata #owner, ytd-video-owner-renderer, ytd-reel-player-overlay-renderer #channel-name, ytd-reel-player-header-renderer');
    const links = [...owners].flatMap(owner => [...owner.querySelectorAll('a[href]')].map(link => link.href))
      .filter(href => {
        const u = new URL(href);
        return /(^|\.)youtube\.com$/.test(u.hostname) && /^\/(?:@|channel\/|c\/|user\/)/.test(u.pathname);
      });
    const channelId = document.querySelector('meta[itemprop="channelId"]')?.content;
    if (channelId?.startsWith('UC')) links.push('channel/' + channelId);
    return [...new Set(links)].slice(0, 6);
  }
  function enforce(message) {
    if (message.block) {
      if (!screen) {
        host = document.createElement('div'); host.id = 'blockout-boundary';
        screen = BlockoutChallenge(host, send);
        document.documentElement.appendChild(host);
        previousInert = !!document.body.inert; document.body.inert = true;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
      if (!host.isConnected) document.documentElement.appendChild(host);
      screen.update(message.block, message.config);
      document.querySelectorAll('video,audio').forEach(media => media.pause());
    } else if (screen) { screen.destroy(); screen = null; host = null; document.body.inert = previousInert; }
  }
  async function tick() {
    if (busy) return; busy = true;
    clearTimeout(nextTick);
    try {
      const title = document.title.slice(0, 2000);
      const result = await send({ action: 'tick', url: location.href, title, channels: channelRefs() });
      enforce(result);
      // Unrelated websites do not need an ongoing heartbeat.
      if (result.watch) nextTick = setTimeout(tick, 1000);
    } catch { /* Extension was reloaded or the page is closing. */ } finally { busy = false; }
  }
  api.runtime.onMessage.addListener(message => { if (message.action === 'enforce') enforce(message); });
  document.addEventListener('play', e => { if (screen && e.target.pause) e.target.pause(); }, true);
  document.addEventListener('visibilitychange', tick);
  document.addEventListener('yt-navigate-finish', tick);
  tick();
})();
