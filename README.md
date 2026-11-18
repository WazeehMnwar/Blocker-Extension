# Blockout

A browser extension that helps you spend less time on distracting websites and more time on what matters. Set your boundaries, plan some downtime, and keep track of your browsing habits.

Built for Microsoft Edge, with support for Chrome and a separate Firefox build.

## Features

- **Website blocking** — Block sites and their subdomains, allow approved sites, and choose when restrictions apply.
- **Entertainment allowances** — Manually start weekend, emergency, or music time. One shared budget counts while eligible tabs are open, including background tabs. Close all eligible tabs to pause it.
- **YouTube controls** — Block chosen channels using their links or handles, with a viewing timer shared across videos and tabs.
- **Deliberate exceptions** — Type a custom phrase to bypass a restriction. YouTube exceptions apply only to the current video; timer exceptions do not reset the shared timer.
- **Need Help** — A guided check-in with personal reminders, a to-do list, and saved alternatives.
- **Weekly stats** — Review blocked attempts, bypasses, allowance usage, and changes from the previous week.
- **Custom settings** — Adjust schedules, block-screen messages, tab-closing delays, and allowance budgets. Add a phrase before settings can be edited.

## Install in Microsoft Edge

1. Clone this repository or download and extract its ZIP from GitHub.
2. Open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the project folder containing `manifest.json`.
5. Open the **Extensions** menu and click **Blockout**. Choose **Show in toolbar** to keep it beside the address bar.

For Chrome, follow the same steps at `chrome://extensions`.

No build or npm installation is needed to load the extension. After updating the files, reload Blockout on the extensions page and refresh existing website tabs.

## Get started

Open the popup and click **Open your dashboard**. Add your blocked sites in **Settings**, mark music sites as **Music**, and adjust your timers and allowances.

Default allowances are 60 minutes per weekend day, a 180-minute weekly emergency pool, and a separate 60-minute daily music pool. Each allowance starts manually. YouTube's channel and timer rules still apply during entertainment allowances.

## Privacy

Settings and browsing stats stay in your browser. Blockout has no account, analytics service, or cloud sync. You can export a backup or import settings from the dashboard.

This is a personal self-control tool. Channel detection depends on YouTube exposing the video's channel link, and the extension can be disabled through your browser.

## Development

```sh
npm ci
npm test
npm run check
npm run preview
```

The preview runs at `http://127.0.0.1:4173` with demo data; it does not block websites. Node.js is needed only for development tools.

To build and verify the Firefox and Chromium packages on Windows:

```powershell
.\build_xpi.ps1
.\verify_xpi.ps1
```

For Firefox, load the generated `extension.xpi` through **Load Temporary Add-on** at `about:debugging#/runtime/this-firefox`. The package is unsigned; permanent installation in standard Firefox requires signing.
