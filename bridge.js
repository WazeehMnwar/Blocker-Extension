/* Web preview uses isolated demo data; extension pages always use the background. */
globalThis.BlockoutBridge = (() => {
  const api = typeof browser !== 'undefined' ? browser : globalThis.chrome;
  const live = !!api?.runtime?.id;
  let demo = null;
  const time = ms => { const sec = Math.ceil(Math.max(0, ms) / 1000); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
  async function send(message) {
    let result;
    if (live) {
      const reply = api.runtime.sendMessage(message);
      if (message.action !== 'snapshot') result = await reply;
      else {
        let timer;
        try {
          result = await Promise.race([reply, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Blockout did not respond. Retrying shortly.')), 5000);
          })]);
        } finally { clearTimeout(timer); }
      }
    }
    else {
      demo ||= JSON.parse(localStorage.getItem('blockout-preview') || 'null') || Blockout.createState();
      if (!demo.config.sites.length && !localStorage.getItem('blockout-preview')) demo.config.sites = [{ domain: 'reddit.com', kind: 'general', bypassEnabled: true }, { domain: 'instagram.com', kind: 'general', bypassEnabled: true }, { domain: 'open.spotify.com', kind: 'music', bypassEnabled: true }];
      if (message.action === 'settings') { demo.config = Blockout.settings({ ...message.config, passwordText: message.config.passwordText || demo.config.passwordText, bypassText: message.config.bypassText || demo.config.bypassText }); }
      if (message.action === 'thaw') demo.activeThaw = message.kind;
      if (message.action === 'todo') demo.config.todos.splice(message.index, 1);
      if (message.action === 'import') { if (message.data?.schema !== 2) throw Error('Choose a Blockout v2 export.'); demo.config = Blockout.settings(message.data.config); }
      if (message.action === 'unlock') result = { ok: message.phrase === demo.config.passwordText };
      else if (message.action === 'export') result = { data: demo };
      else result = { config: demo.config, locked: false, usageMs: demo.usageMs, timerUntil: demo.timerUntil, activeThaw: demo.activeThaw, clock: demo.clock,
        balances: Object.fromEntries(['weekend', 'emergency', 'music'].map(k => [k, Blockout.balance(demo, k, Date.now())])), stats: Blockout.summary(demo), daily: demo.daily };
      localStorage.setItem('blockout-preview', JSON.stringify(demo));
    }
    if (result?.error) throw Error(result.error);
    if (!result) throw Error('Blockout could not connect. Reload the extension and try again.');
    return result;
  }
  return { send, time, live };
})();
