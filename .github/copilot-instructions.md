# Project Guidelines

Skilly's Auto Tab Switcher is a Manifest V3 Chromium extension in plain JavaScript. There's no build step, framework or package manager. See [README.md](../README.md) for user-facing behavior.

## Architecture

All extension code lives in `TabSwitcherExtension/`:

- `shared.js` is loaded by the service worker (`importScripts`) and by the popup and rules pages (`<script>`). It owns `DEFAULTS`, `normalizeSettings()` and rule lookup. Anything both sides need goes here.
- `background.js` is the service worker. It handles per-window timers, switching, refreshing and the badge. Runtime state that has to survive a worker restart goes in `chrome.storage.session`.
- `popup.html` / `popup.js` hold the settings, plus the **Current Tab** rule editor. Edits are kept in memory until **Save Settings**.
- `rules.html` / `rules.js` is the options page that lists, adds and edits rules. Its writes are immediate (read-modify-write against storage).
- `content_scroll.js` handles auto scroll and hover detection only. It must not read or change page content.

Settings live in `chrome.storage.local`, and every reader goes through `normalizeSettings()`. To add a setting, update `DEFAULTS`, `normalizeSettings()` and the popup's `collectSettings()`.

## Rules model

- Keys are `host:<host incl. port>` for a whole site and `page:<protocol//host+path>` for a page (no query or hash).
- Each rule has optional sections: `refresh`, `scroll` and `display` (seconds on screen). A missing section means "use default".
- Each section is resolved on its own: page rule, then site rule, then the global default (`ruleSectionFor()` in `shared.js`). `www.` and the bare domain are treated as the same site. Don't mention that in the UI or docs.
- In the UI, `switchInterval` is labelled **Show Each Tab For** and `display` is labelled **Show For**.

## Constraints

- Chrome caps popups at 800x600. The popup is about 590px tall with everything expanded, so any new row there needs space found elsewhere.
- The dark theme uses nested `:root[data-theme="dark"]` rules that outrank `#id.class` selectors. Every new state class (for example `.unsaved` or `.warning`) needs a dark variant too.
- No network requests, remote code, `eval` or `new Function`. The store privacy answers in `Misc/STORE_LISTING.md` depend on this.
- `<all_urls>` is intentional. See `Misc/designnotes.md`.

## Build and Test

- Node.js isn't installed, so JS can't be run from the terminal.
- To check layout, open `popup.html` or `rules.html` via `file://` in the integrated browser. `chrome.*` is undefined there, so init throws and every section stays expanded (worst case for height).
- For real testing, load the folder unpacked at `chrome://extensions` and reload it after changes.
- Package with `.\Build-Package.ps1`. The zip name comes from today's date and the `version` in `manifest.json`, and `*.zip` is gitignored.
- After UI or label changes, regenerate the README and store images with the `store-screenshots` skill (`.github/skills/store-screenshots/`) and check them for cut-off text.

## Conventions

- Comments: one short line, only for what the code can't show.
- User-facing text and docs: no em dashes or semicolons.
- When behavior or labels change, update the README Usage section and `Misc/STORE_LISTING.md`. The store limits are a 132-character summary (the manifest `description`) and 500 characters for test instructions. The description is plain text.
