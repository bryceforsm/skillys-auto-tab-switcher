# Chrome Web Store Listing

Copy text from the code blocks below. The store shows the description as plain text, so it avoids Markdown formatting.

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
- Window isolation: the timer only affects the window it was started in.
- Smart refresh: reload on every switch, never, only when the page is older than N minutes, or periodically in the background so it is ready before it is shown.
- Per-site and per-page rules: override how long a page is shown, its refresh and its scrolling for a whole site or a single page. Keep a key dashboard on screen longer while everything else rotates quickly. Page rules win over site rules, and each setting falls back to your defaults on its own.
- Auto scroll: smoothly scroll long pages with adjustable speed and start delay, with an option to jump back to the top on each switch.
- Pause when you need it: pause the timer when you use the mouse or keyboard, or only while hovering over the page or changing settings in the popup.
- Auto-start: begin rotating automatically when the browser launches or a new window opens. Great for kiosks and unattended screens.
- Full screen on start: go full screen when the timer starts and restore the window when it stops.
- Countdown badge: see the seconds until the next switch on the toolbar icon, in the color of your choice, or hide it.
- Settings and rules page: set defaults, auto start, full screen, badge and theme in one place, then view, filter, add, edit and remove every saved rule, import and export them as a file to back up or copy to another computer, and reset everything to defaults in one click.
- Light, dark or system theme.

GREAT FOR
- NOC and IT monitoring screens (Grafana, Home Assistant, uptime and status pages)
- Office and lobby TVs, digital signage and kiosks
- Sales, support and analytics dashboards
- Presentations and trade show displays
- Keeping an eye on several pages without clicking between them

PRIVACY
No accounts, no tracking and no data collection. Settings and rules are stored locally in your browser and never leave your computer.

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
Used to inject the extension's own bundled content script (content_scroll.js) into tabs that were already open before the extension was installed or updated, because declared content scripts do not run in those tabs until they reload. That script performs auto scrolling and detects mouse hover for the "Pause Timer: On hover" mode. No remote or dynamically generated code is injected.
```

### alarms justification

```text
Used for a periodic heartbeat that wakes the background service worker so it can perform the "refresh periodically, even in background" option, which reloads hidden tabs on schedule so they are up to date when they are shown. Manifest V3 service workers are suspended when idle, so timers alone are not reliable for this.
```

### Host permission justification

```text
The extension is meant to rotate whatever pages the user chooses (dashboards, status pages, internal tools), so it cannot know the sites in advance. Access to all URLs is needed so the content script can auto scroll pages and detect hover to pause the timer, and so the scripting permission can inject that same script into tabs opened before installation. The script does not read, collect or modify page content.
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
No login needed. Open one window with 3 tabs, e.g. example.com, a long Wikipedia article and google.com. Click the icon, set Show Each Tab For to 5, click Save Settings, then Start Timer. The badge counts down and tabs switch every 5 seconds. Other windows are not affected. Pause Timer: On hover pauses while the mouse is over the page. Current Tab, Customize creates per-page rules. More Settings and Rules holds defaults (Auto Scroll: Enable scrolls long pages) and all rules. Stop Timer ends it.
```
