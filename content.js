(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let screen = null, host = null, busy = false, previousInert = false, nextTick = null, musicShiftTimer = null, musicShifted = false;
  const send = message => api.runtime.sendMessage(message);
  let retryDelay = 1000;
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
    let deadline;
    try {
      const title = document.title.slice(0, 2000);
      const result = await Promise.race([
        send({ action: 'tick', url: location.href, title, channels: channelRefs() }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Blockout check timed out.')), 5000); })
      ]);
      if (!result || result.error || !Object.hasOwn(result, 'block')) throw Error('Blockout check failed.');
      retryDelay = 1000;
      enforce(result);
      if (result.musicShift && document.visibilityState === 'visible') {
        if (!musicShiftTimer && !musicShifted) {
          musicShiftTimer = setTimeout(async () => {
            musicShiftTimer = null; musicShifted = true;
            try { await send({ action: 'musicShift', url: location.href }); } catch { /* Tab or extension closed. */ }
          }, 5000);
        }
      } else {
        clearTimeout(musicShiftTimer); musicShiftTimer = null; musicShifted = false;
      }
      // Unrelated websites do not need an ongoing heartbeat.
      if (result.watch) nextTick = setTimeout(tick, 1000);
    } catch {
      // Keep the last enforcement decision until the worker can answer again.
      nextTick = setTimeout(tick, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    } finally { clearTimeout(deadline); busy = false; }
  }
  api.runtime.onMessage.addListener(message => { if (message.action === 'enforce') enforce(message); });
  document.addEventListener('play', e => { if (screen && e.target.pause) e.target.pause(); }, true);
  document.addEventListener('visibilitychange', tick);
  document.addEventListener('yt-navigate-finish', tick);
  tick();
})();
