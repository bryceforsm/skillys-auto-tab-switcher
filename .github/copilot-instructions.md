# Project Guidelines

Skilly's Auto Tab Switcher is a Manifest V3 Chromium extension in plain JavaScript. There's no build step, framework or package manager. See [README.md](../README.md) for user-facing behavior.

## Architecture

All extension code lives in `TabSwitcherExtension/`:

- `shared.js` is loaded by the service worker (`importScripts`) and by the popup and rules pages (`<script>`). It owns `DEFAULTS`, `normalizeSettings()` and rule lookup. Anything both sides need goes here.
- `background.js` is the service worker. It handles per-window timers, switching, refreshing and the badge. Runtime state that has to survive a worker restart goes in `chrome.storage.session`.
- `popup.html` / `popup.js` hold only the day-to-day controls: Start/Stop, **Show Each Tab For**, **Pause Timer** and the **Current Tab** rule editor (always collapsed until you click a chip) with **Page rule**/**Site rule** chips and their **Reset** buttons. Every edit is written to storage straight away (number boxes save while typing once the value is in range).
- `rules.html` / `rules.js` is the options page (**More Settings and Rules**). It holds the set-and-forget settings (Show Each Tab For and Pause Timer again, auto start, full screen, badge, theme, Default Refresh, Default Auto Scroll) and lists, adds and edits rules. Its writes are immediate (read-modify-write against storage).
- `content_scroll.js` handles auto scroll and hover detection only. It must not read or change page content.

Settings live in `chrome.storage.local`, and every reader goes through `normalizeSettings()`. To add a setting, update `DEFAULTS`, `normalizeSettings()` and the page that edits it (the popup's `saveGeneral()` or the options page's `saveGeneral()`/`fillGeneral()`). Keep the popup small: new set-and-forget settings belong on the options page.

## Rules model

- Keys are `host:<host incl. port>` for a whole site and `page:<protocol//host+path>` for a page (no query or hash).
- Each rule has optional sections: `refresh`, `scroll`, `display` (seconds on screen) and `skip` (`true` leaves it out of the rotation, `false` is allowed on page rules only and keeps a page in even when its site is skipped). A missing section means "use default". Site rules also keep `scheme` (`http` or `https`), only for opening the site from the rules page.
- Each section is resolved on its own: page rule, then site rule, then the global default (`ruleSectionFor()` in `shared.js`). Keys never keep a leading `www.` or, for web pages, a trailing slash (`normalizeKey()` in `shared.js`), so both forms of an address match.
- In the UI, `switchInterval` is labelled **Show Each Tab For** and `display` is labelled **Show For**.

## Constraints

- Chrome caps popups at 800x600. The popup is about 470px tall with everything expanded, so any new row there needs space found elsewhere.
- The dark theme uses nested `:root[data-theme="dark"]` rules that outrank `#id.class` selectors. Every new state class (for example `.rule-chip.active`) needs a dark variant too.
- No network requests, remote code, `eval` or `new Function`. The store privacy answers in `Misc/STORE_LISTING.md` depend on this.
- The code must run in both Chrome and Firefox (Firefox 140+, background event page). Use only WebExtension APIs both support, guard anything browser-specific (see `openShortcutSettings()` in `shared.js`), and keep `manifest.json` Chrome-valid. Firefox-only manifest changes belong in `Build-Package.ps1`.
- `<all_urls>` is an optional host permission, requested only when the user clicks **Allow** on the notice shown in the popup or rules page after Auto Scroll or Pause On Hover is turned on (never automatically). The content script is registered at runtime, so don't add `content_scripts` or `host_permissions` back. See `Misc/designnotes.md`.

## Build and Test

- Node.js isn't installed, so JS can't be run from the terminal.
- To check layout, open `popup.html` or `rules.html` via `file://` in the integrated browser. `chrome.*` is undefined there, so init throws and every section stays expanded (worst case for height).
- For real testing, load the folder unpacked at `chrome://extensions` and reload it after changes.
- Package with `.\Build-Package.ps1`. The zip name comes from today's date and the `version` in `manifest.json`, and `*.zip` is gitignored. It also writes a `_firefox.zip` whose manifest swaps `background.service_worker` for background `scripts` and adds the gecko settings. Keep code free of Chrome-only calls (use `openShortcutSettings()` from `shared.js`, and guard `importScripts`).
- After UI or label changes, regenerate the README and store images with the `store-screenshots` skill (`.github/skills/store-screenshots/`) and check them for cut-off text.

## Conventions

- Comments: one short line, only for what the code can't show.
- User-facing text and docs: no em dashes or semicolons.
- When behavior or labels change, update the README Usage section and `Misc/STORE_LISTING.md`. The store limits are a 132-character summary (the manifest `description`) and 500 characters for test instructions. The description is plain text.
