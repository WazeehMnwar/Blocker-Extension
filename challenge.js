/* One accessible challenge surface for extension pages and YouTube's isolated overlay. */
globalThis.BlockoutChallenge = function (container, send) {
  const root = container.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;display:block;color:#edf1ec;background:#101512;font:15px/1.6 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}main{height:100dvh;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:36px 24px;background:radial-gradient(ellipse at 50% 35%,#253b2c66,transparent 65%)}
    header{align-self:stretch;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:750;letter-spacing:2px}header span{color:#91a398;font-weight:400;letter-spacing:0}
    article{width:min(620px,100%);margin:auto;text-align:center;padding:36px 0}.symbol{width:72px;height:72px;display:grid;place-items:center;margin:0 auto 26px;border:1px solid #627e4a;border-radius:24px;color:#d6f69c;font-size:32px;background:#d6f69c0a}
    .eyebrow{color:#c4e792;text-transform:uppercase;letter-spacing:2px;font-size:11px;font-weight:700}h1{font-size:clamp(32px,5vw,54px);line-height:1.12;letter-spacing:-2px;margin:18px 0}p{color:#9eada2;margin:14px 0}.promise{padding:20px;border-top:1px solid #2b352d;border-bottom:1px solid #2b352d;margin:28px 0;color:#d5ded6}.timer{font:500 42px/1.4 ui-monospace,monospace;letter-spacing:-2px;color:#d6f69c}
    button{font:600 14px system-ui,sans-serif;padding:13px 20px;border:1px solid #3c4b40;border-radius:10px;background:#202a23;color:#e9efe7;cursor:pointer}button:hover{background:#2d3b30}button:focus-visible,textarea:focus-visible{outline:2px solid #d6f69c;outline-offset:4px}.primary{background:#d6f69c;color:#152010;border-color:#d6f69c}.primary:hover{background:#e3ffb4}.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
    footer{padding-top:24px;color:#84978b;font-size:13px;text-align:center}footer button{border:0;background:none;color:#c9e8a2;padding:8px}textarea{width:100%;height:140px;resize:vertical;background:#121a15;color:#edf1ec;border:1px solid #455544;border-radius:10px;padding:16px;font:15px/1.6 system-ui}form{text-align:left;margin-top:24px}label{display:block;margin:10px 0;color:#a4b4a6}.hint{white-space:pre-wrap;overflow-wrap:anywhere;background:#202a23;padding:16px;border-radius:10px;font-size:14px;color:#dce5d8}small{color:#8da18f} [hidden]{display:none!important}
  </style><main role="dialog" aria-modal="true" aria-labelledby="title"><header>▥ &nbsp; BLOCKOUT <span>A little space to choose.</span></header><article>
    <div class="symbol" aria-hidden="true">Ⅱ</div><div class="eyebrow" id="reason"></div><h1 id="title"></h1><p id="description"></p>
    <p class="promise" id="promise"></p><div class="timer" id="timer" aria-label="Time remaining"></div><p id="timing"></p>
    <div class="actions"><button id="leave" class="primary">Close this tab</button><button id="begin">Make an exception</button></div>
    <form id="challenge" hidden><label for="phrase">Type your phrase exactly to continue</label><div class="hint" id="hint" hidden></div>
    <button id="show" type="button">Show phrase</button><label><textarea id="phrase" placeholder="Take a breath. Type deliberately." autocomplete="off" spellcheck="false" required></textarea></label>
    <div class="actions"><button class="primary" type="submit">Continue deliberately →</button><button id="cancel" type="button">Back</button></div><p id="error" role="status"></p></form>
  </article><footer><span id="help-copy">Feeling stuck? Find a different next step.</span><br><button id="help">Need Help ↗</button></footer></main>`;
  const $ = id => root.getElementById(id);
  let current, signature, phraseVisible = false;
  function timing() {
    if (!current) return;
    const end = current.closeAt || current.until;
    $('timer').textContent = end ? format(Math.max(0, end - Date.now())) : '';
    $('timing').textContent = current.closeAt ? 'Until this tab closes. Start an exception to keep the challenge open.' : current.until ? 'Until your viewing timer resets.' : 'Your boundary stays in place until you choose a next step.';
  }
  function format(ms) { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function update(block, config = {}) {
    current = block; if (!block) return;
    if (signature !== block.signature) {
      signature = block.signature; $('challenge').hidden = true; $('phrase').value = ''; $('hint').hidden = true; phraseVisible = false;
    }
    $('reason').textContent = block.reason === 'keyword' ? `Keyword boundary · ${block.category}` : block.reason === 'timer' ? 'Shared viewing limit reached' : `Site boundary · ${block.domain}`;
    $('title').textContent = block.message || (block.reason === 'timer' ? 'Time to come up for air.' : 'Remember what you came here for.');
    $('description').textContent = block.reason === 'keyword' ? 'This video matched a category you chose to interrupt. An exception allows this video; your shared timer keeps running.' : block.reason === 'timer' ? 'Your YouTube session has reached its limit. Take a break, or complete your phrase to reset the timer.' : 'This website is inside your lockdown rules. You can activate an allowance from Blockout when you choose to unwind.';
    $('promise').textContent = config.promises?.[0] || 'Give your attention to something you chose.';
    $('begin').hidden = !block.bypass || !$('challenge').hidden;
    $('help-copy').textContent = block.suggestHelp ? 'A few attempts in a row? Let’s find a different next step.' : 'Feeling stuck? Find a different next step.';
    timing();
  }
  $('begin').onclick = async () => {
    const r = await send({ action: 'challengeStart' });
    if (r?.ok) { $('challenge').hidden = false; $('begin').hidden = true; $('phrase').focus(); }
  };
  $('show').onclick = async () => {
    phraseVisible = !phraseVisible;
    if (phraseVisible) { const r = await send({ action: 'challengeHint' }); $('hint').textContent = r.phrase; }
    $('hint').hidden = !phraseVisible; $('show').textContent = phraseVisible ? 'Hide phrase' : 'Show phrase';
  };
  $('cancel').onclick = () => { $('challenge').hidden = true; $('begin').hidden = !current?.bypass; };
  $('phrase').addEventListener('paste', e => e.preventDefault());
  $('phrase').addEventListener('drop', e => e.preventDefault());
  $('challenge').onsubmit = async e => {
    e.preventDefault(); const r = await send({ action: 'bypass', phrase: $('phrase').value });
    $('error').textContent = r.ok ? 'Exception granted.' : r.error || 'The phrase doesn’t match yet. Check the wording and spacing.';
  };
  $('help').onclick = () => send({ action: 'openHelp' });
  $('leave').onclick = () => send({ action: 'closeBlocked' });
  const interval = setInterval(timing, 250);
  return { update, destroy() { clearInterval(interval); container.remove(); } };
};
