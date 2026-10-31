# Chrome Web Store Listing

Copy text from the code blocks below. The store shows the description as plain text, so it avoids Markdown formatting.

The Firefox Add-ons (AMO) answers are in the [Firefox section](#firefox-add-ons-amo-listing) at the end.

## Summary (132 characters max, comes from `description` in manifest.json)

```text
Automatically switches tabs at a set interval. Includes per-page refresh rules, auto-scrolling, and pausing on activity.
```

## Description

```text
Turn any browser window into a hands-free display. Skilly's Auto Tab Switcher cycles through your open tabs on a timer, keeps each page fresh, and scrolls long pages for you, so dashboards, monitoring tools, status boards and presentations run on their own.

It only runs in the window where you start it. Your other windows stay completely normal, so you can keep working on the same computer while a wall display or second monitor rotates in the background.

WHY INSTALL IT
Most tab rotators either reload every page on every switch (slow and flickery) or never reload at all (stale data). Skilly's Auto Tab Switcher lets you decide per site or per page. A live dashboard can refresh in the background so it is already up to date when it appears, while a slow report page is only reloaded when it is actually out of date.

FEATURES
- Automatic tab switching: rotate through every tab in the window at an interval you choose (5 seconds or more).
- Stay and refresh: stay on the page on screen and refresh it at your interval instead of switching tabs.
- Window isolation: the timer only affects the window it was started in.
- Smart refresh: reload on switch, before switch, never, only when the page is older than N minutes, or periodically in the background so it is ready before it is shown.
- Per-site and per-page rules: override how long a page is shown, its refresh and its scrolling for a whole site or a single page, or skip it in the rotation altogether. Keep a key dashboard on screen longer while everything else rotates quickly. Page rules win over site rules, and each setting falls back to your defaults on its own.
- Auto scroll: smoothly scroll long pages with adjustable speed and start delay, with an option to jump back to the top on each switch, move on to the next tab at the bottom, scroll back up and repeat, or scroll back up and then move on.
- Pause when you need it: pause the timer when you use the mouse or keyboard, or only while hovering over the page or changing settings in the popup.
- Auto-start: begin rotating automatically when the browser launches or a new window opens. Great for kiosks and unattended screens.
- Full screen on start: go full screen when the timer starts and restore the window when it stops. Optionally keep it full screen on every tab switch.
- Countdown badge: see the seconds until the next switch on the toolbar icon, in the color of your choice, or hide it.
- Settings and rules page: set defaults, auto start, full screen, badge and theme in one place, then view, filter, add, edit, duplicate and remove every saved rule, import and export them as a file to back up or copy to another computer, and reset everything to defaults in one click.
- Light, dark or system theme.

GREAT FOR
- NOC and IT monitoring screens (Grafana, Home Assistant, uptime and status pages)
- Office and lobby TVs, digital signage and kiosks
- Sales, support and analytics dashboards
- Presentations and trade show displays
- Keeping an eye on several pages without clicking between them

PRIVACY
No accounts, no tracking and no data collection. Settings and rules are stored locally in your browser and never leave your computer.

Chrome describes the tabs permission as "Read your browsing history". The extension has no access to your history. It only reads the addresses of your open tabs to match your page and site rules, and it never stores or sends them.

HOW TO USE
1. Open the tabs you want to rotate in one window.
2. Click the extension icon, set how long each tab is shown and any refresh or scroll options.
3. Click Start Timer. Click Stop Timer to end the rotation.

Works in Google Chrome and other Chromium-based browsers such as Microsoft Edge, Brave, Vivaldi and Opera.

Open source under the MIT License.
```

## Privacy Practices

### Single purpose

```text
Skilly's Auto Tab Switcher automatically rotates through the open tabs in a browser window on a timer, for unattended displays such as dashboards, monitoring screens and kiosks. The refresh, auto scroll and pause options all exist to keep the rotating pages current and readable while they are shown.
```

### tabs justification

```text
Used to list the tabs in the window where the timer is running, activate the next tab on each interval, and reload tabs according to the user's refresh settings. The active tab's URL is read only so the popup can create and apply per-site or per-page refresh and scroll rules. Tab information is never stored outside the browser or sent anywhere.
```

### storage justification

```text
Used to save the user's settings (interval, pause mode, auto-start, refresh and scroll defaults, badge color, theme) and their per-site and per-page rules. Everything is kept in chrome.storage.local on the user's device. Nothing is synced or transmitted.
```

### idle justification

```text
Used for the optional "Pause Timer: On activity" mode. The extension checks whether the user is active or idle so it can pause tab switching while someone is using the computer and resume once they stop. Only the active/idle state is read. No input content is captured.
```

### scripting justification

```text
Used to register the extension's own bundled content script (content_scroll.js) at runtime, only after the user grants optional site access, and to inject it into tabs that were already open at that moment. That script performs auto scrolling and detects mouse hover for the "Pause Timer: On hover" mode. No remote or dynamically generated code is injected.
```

### alarms justification

```text
Used for a periodic heartbeat, only while the timer is running, that wakes the background service worker so it can perform the "refresh periodically, even in background" option, which reloads hidden tabs on schedule so they are up to date when they are shown. Manifest V3 service workers are suspended when idle, so timers alone are not reliable for this.
```

### Host permission justification

```text
The extension asks for site access (optional_host_permissions, all URLs) only when the user turns on Auto Scroll or Pause Timer: On hover, and works without it for everything else. The user picks which pages to rotate (dashboards, status pages, internal tools), so the sites cannot be known in advance. Access is needed so the content script can auto scroll pages and detect hover to pause the timer. The script does not read, collect or modify page content.
```

### Are you using remote code?

No, I am not using remote code.

```text
All JavaScript is included in the extension package. There are no externally hosted scripts, no eval or new Function, and no code downloaded at runtime.
```

## Test Instructions

Username and password: leave blank (no account or login is required).

Additional instructions (500 characters max):

```text
No login needed. Open one window with 3 tabs, e.g. example.com, a long Wikipedia article and google.com. Click the icon, set Show Each Tab For to 5, then Start Timer. The badge counts down and tabs switch every 5 seconds. Other windows are not affected. Current Tab, Page rule creates per-page rules. To try Auto Scroll or Pause Timer: On hover, turn it on and click Allow in the notice that appears, then click Allow when Chrome asks for site access. Stop Timer ends it.
```

# Firefox Add-ons (AMO) Listing

Submit at <https://addons.mozilla.org/developers/addon/submit/>. Run `.\Build-Package.ps1` and upload the `_firefox.zip`. AMO renders a limited set of Markdown in the description (bold, italic, links, lists), so this one uses it.

The add-on ID `skillys-auto-tab-switcher@bryceforsm.github.io` (set in `Build-Package.ps1`) is permanent once the first version is uploaded. Every later version must keep it, or AMO treats it as a different add-on.

## Upload Version

- **How to distribute this version:** On this site.
- **Compatible platforms:** Firefox only. Leave Firefox for Android unchecked (the extension needs the `windows` API, full screen and keyboard shortcuts, which Android does not have).
- **Do you need to submit source code?** No. Nothing is minified, bundled, transpiled or generated, and there are no third-party libraries.

## Describe Add-on

- **Name:** Skilly's Auto Tab Switcher
- **Add-on URL:** `skillys-auto-tab-switcher`
- **This add-on is experimental:** leave unchecked.
- **Requires payment, non-free services or software, or additional hardware:** leave unchecked.
- **Firefox categories (up to 2):** Tabs. A second category isn't needed.
- **Support email:** your public support address.
- **Support website:** <https://github.com/bryceforsm/skillys-auto-tab-switcher/issues>
- **License:** The MIT License
- **This add-on has a privacy policy:** leave unchecked. No data leaves the device, and the manifest declares `data_collection_permissions: none`, so AMO shows that it collects no data.

### Summary (250 characters max)

```text
Automatically switches tabs at a set interval for dashboards, monitoring screens and kiosks. Includes per-site and per-page refresh rules, auto scrolling, and pausing on activity. Only runs in the window you start it in.
```

### Description

```markdown
Turn any browser window into a hands-free display. Skilly's Auto Tab Switcher cycles through your open tabs on a timer, keeps each page fresh, and scrolls long pages for you, so dashboards, monitoring tools, status boards and presentations run on their own.

It only runs in the window where you start it. Your other windows stay completely normal, so you can keep working on the same computer while a wall display or second monitor rotates in the background.

**Why install it**

Most tab rotators either reload every page on every switch (slow and flickery) or never reload at all (stale data). Skilly's Auto Tab Switcher lets you decide per site or per page. A live dashboard can refresh in the background so it is already up to date when it appears, while a slow report page is only reloaded when it is actually out of date.

**Features**

- **Automatic tab switching:** rotate through every tab in the window at an interval you choose (5 seconds or more).
- **Stay and refresh:** stay on the page on screen and refresh it at your interval instead of switching tabs.
- **Window isolation:** the timer only affects the window it was started in.
- **Smart refresh:** reload on switch, before switch, never, only when the page is older than N minutes, or periodically in the background so it is ready before it is shown.
- **Per-site and per-page rules:** override how long a page is shown, its refresh and its scrolling for a whole site or a single page, or skip it in the rotation altogether. Keep a key dashboard on screen longer while everything else rotates quickly. Page rules win over site rules, and each setting falls back to your defaults on its own.
- **Auto scroll:** smoothly scroll long pages with adjustable speed and start delay, with an option to jump back to the top on each switch, move on to the next tab at the bottom, scroll back up and repeat, or scroll back up and then move on.
- **Pause when you need it:** pause the timer when you use the mouse or keyboard, or only while hovering over the page or changing settings in the popup.
- **Auto start:** begin rotating automatically when the browser launches or a new window opens. Great for kiosks and unattended screens.
- **Full screen on start:** go full screen when the timer starts and restore the window when it stops. Optionally keep it full screen on every tab switch.
- **Countdown badge:** see the seconds until the next switch on the toolbar icon, in the color of your choice, or hide it.
- **Settings and rules page:** set defaults, auto start, full screen, badge and theme in one place, then view, filter, add, edit, duplicate and remove every saved rule, import and export them as a file to back up or copy to another computer, and reset everything to defaults in one click.
- **Light, dark or system theme.**

**Great for**

- NOC and IT monitoring screens (Grafana, Home Assistant, uptime and status pages)
- Office and lobby TVs, digital signage and kiosks
- Sales, support and analytics dashboards
- Presentations and trade show displays
- Keeping an eye on several pages without clicking between them

**Privacy**

No accounts, no tracking and no data collection. Settings and rules are stored locally in your browser and never leave your computer. Site access is optional and only requested when you turn on Auto Scroll or Pause Timer: On hover.

The browser describes the tabs permission as reading your browsing history. The extension has no access to your history. It only reads the addresses of your open tabs to match your page and site rules, and it never stores or sends them.

**How to use**

1. Open the tabs you want to rotate in one window.
2. Click the extension icon, set how long each tab is shown and any refresh or scroll options.
3. Click Start Timer. Click Stop Timer to end the rotation.

Requires Firefox 140 or newer on desktop. Also available for Chrome and other Chromium-based browsers.

Open source under the MIT License: [github.com/bryceforsm/skillys-auto-tab-switcher](https://github.com/bryceforsm/skillys-auto-tab-switcher)
```

### Notes for Reviewers

```text
No login or account is needed.

Source: https://github.com/bryceforsm/skillys-auto-tab-switcher
The package is plain, unminified JavaScript with no build step and no third-party libraries. The files in the zip are the repository files as-is. The only difference from the repository is manifest.json, which Build-Package.ps1 rewrites for Firefox: background.service_worker is replaced by background.scripts (shared.js, background.js) and browser_specific_settings.gecko is added.

The extension makes no network requests, loads no remote code and does not use eval or new Function. Settings and rules are kept in storage.local.

Permissions: tabs (list, activate and reload tabs in the rotating window, and read the active tab URL for per-page rules), storage (settings and rules), idle (optional "Pause Timer: On activity" mode), scripting (register and inject the bundled content_scroll.js), alarms (heartbeat while the timer runs, for background refresh). <all_urls> is an optional host permission, requested only when the user turns on Auto Scroll or Pause Timer: On hover. content_scroll.js only scrolls the page and listens for mouse hover. It does not read or modify page content.

How to test: open one window with 3 tabs, e.g. example.com, a long Wikipedia article and mozilla.org. Click the toolbar icon, set Show Each Tab For to 5, then click Start Timer. The badge counts down and the tabs switch every 5 seconds. Other windows are not affected. In the popup, Current Tab, Page rule creates a per-page rule. To try Auto Scroll or Pause Timer: On hover, turn it on and click Allow in the notice that appears, then click Allow when Firefox asks for site access. Stop Timer ends it. More Settings opens the options page with all settings and saved rules.
```

## After Submitting (Edit Product Page)

- **Homepage:** <https://github.com/bryceforsm/skillys-auto-tab-switcher>
- **Tags:** pick from AMO's list, for example `tab manager` and `productivity`.
- **Icon:** AMO uses the 128px icon from the manifest. A 64x64 or 32x32 PNG can be uploaded to override it.
- **Screenshots:** reuse `Screenshots/webstore/` (1280x800, the size AMO recommends), in this order with these captions:
  - `popup-defaults.png`: The popup, ready to start rotating the tabs in this window.
  - `popup-light.png`: Timer running with a per-page rule that shows this page for 1 minute and refreshes it in the background.
  - `popup-dark.png`: A site rule in the dark theme, with the timer paused while the mouse is over the page.
  - `rules-light.png`: The settings page with defaults for pages without a rule and the list of saved rules.
  - `rules-edit-dark.png`: Editing a page rule on the settings page, in the dark theme.

### Release notes for this version

```text
First release on Firefox Add-ons.
```
