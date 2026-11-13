# Blockout 2.0

A browser extension for deliberate browsing: scheduled lockdown, manually started entertainment allowances, YouTube boundaries, and a personal support kit. Everything stays in browser storage; no account or cloud service is required.

## Try the interface

Run `npm run preview`, then open http://127.0.0.1:4173. This is an interface preview with its own demo data. It does **not** block websites or consume real allowances. `popup.html` previews the toolbar panel.

## Load the extension

**For Edge, load this project folder directly:** open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `D:\HTML - CSS\Blockout`. When updating an existing installation, click its **Reload** button instead. The source manifest targets Edge/Chromium Manifest V3.

Run `powershell -ExecutionPolicy Bypass -File .\build_xpi.ps1` to build Firefox and Chromium packages. The first build preserves the original v1 XPI under `releases/`.

- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension.xpi`. The generated package uses Firefox background scripts. The XPI is unsigned; persistent installation in standard Firefox requires Mozilla signing. Keep the same extension ID to migrate existing data.
- **Chrome / Edge / Chromium:** extract `extension-chromium.zip` to a folder, open the browser’s extensions page, enable developer mode, and choose **Load unpacked** for that folder. The Chromium build uses a service worker.

The source manifest uses a service worker for Edge/Chromium. The build script generates a Firefox-only manifest with background scripts and the Firefox extension ID. The builds require a modern MV3 browser with `storage.session` and Promise extension APIs (Firefox 121+, Chromium 120+).

After updating, reload existing website tabs so they receive the new content scripts. Use the toolbar popup to open the full dashboard.

## Rules in this release

- Ordinary blocked domains and their subdomains are blocked immediately during lockdown. Default lockdown applies all day; optional schedules support selected days and overnight periods. The block screen closes the tab after 5 seconds by default; set 0 to leave it open. Beginning a phrase challenge keeps the blocked page open to give you time to type.
- Approved domains override ordinary site rules. They do not exempt YouTube videos from keyword/timer checks. More specific site rules beat broader blocked-domain rules.
- Weekend thaw defaults to **60 minutes separately on Saturday and Sunday**. Emergency thaw defaults to a **180-minute weekly pool**; music has a **separate 60-minute daily pool**. Emergency/music reset periods and all limits are configurable. Instagram shares the general budget; no separate Instagram allowance is implemented.
- An allowance begins only on manual activation. Time counts once while **any eligible entertainment tab is open**, including background tabs and unfocused windows. Switching to a study tab does not pause it. Closing all eligible tabs pauses consumption; stopping an allowance preserves unused time. A new calendar allowance period requires manual activation again. Only one thaw can be active at a time.
- Music thaw unlocks only domains marked Music. General thaw does not bypass YouTube’s special rules. Allowances and usage are shared across tabs and survive reloads and worker suspension. Browser shutdown time is excluded when starting a fresh browser session.
- YouTube video pages (including Shorts and live pages) share a focused-tab viewing timer, default 30 minutes, followed by a 5-minute break. Keyword groups match case-insensitive phrases in the title and accessible page metadata; these rules are heuristic and may overmatch or miss content. A keyword bypass allows the current video in that tab and does not reset the timer. A timer bypass resets the shared timer and allows the current video. Changing video revokes that tab’s video exception.
- Ordinary-site phrase bypasses grant a configurable domain exception (default 10 minutes). These timed exceptions are separate from thaw budgets. Editing rules can be phrase-protected for the browser session. This is a self-control aid, not tamper-proof access control.
- Need Help is a predefined decision tree with personal promises, tasks, and saved resources. It does not disable rules. Saved resources follow normal rules; special resource priority remains pending the owner’s definition.
- Weekly reports count blocked attempts, keyword categories, challenge starts/completions/failed submissions, eligible thaw use, focused YouTube page time, and focused block-screen time. They include daily trends and previous-week comparisons. Reports open once on browser startup after a completed reporting week. Daily history is retained for 120 days; reports are derived from that history. Timing measures page availability, not eye attention or playback.

## Data and migration

On first run, v1 sync settings are backed up as `legacyBackup` in local extension storage. Ordinary sites become default lockdown rules. An existing YouTube rule becomes the dedicated YouTube timer. V2 settings, budgets, and history are stored locally and do not sync between browsers/devices.

Backup exports include configuration, plaintext challenge phrases, budgets, and daily history. Import restores **configuration only** so an old backup cannot refund spent time. Exported history remains available in the JSON file. Menu phrases are meant to add friction, not protect secrets.

## Development and verification

```text
npm ci
npm test
npm run check
powershell -ExecutionPolicy Bypass -File .\build_xpi.ps1
powershell -ExecutionPolicy Bypass -File .\verify_xpi.ps1
```

Production code has no external dependencies. jsdom is a development-only dependency for interface interaction tests. Tests cover the rules engine, the background process with mocked extension APIs, and the popup/dashboard/challenge DOM. Real browser validation is still required for browser-specific API behavior, YouTube navigation/metadata timing, worker suspension, and visual layout.

Before release, verify in both browsers: installation, v1 migration, two entertainment tabs sharing a budget, close-to-pause behavior, allowance expiry, restart with restored tabs, schedule transitions, YouTube SPA navigation/Shorts, both phrase bypass paths, block-screen close timing, settings protection, backup import/export, and the weekly report.
