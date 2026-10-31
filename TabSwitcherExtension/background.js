// Firefox loads shared.js through the manifest's background scripts instead.
if (typeof importScripts === 'function') importScripts('shared.js');

const PAUSE_COLOR = '#d93025';
const MIN_IDLE_SECONDS = 15; // chrome.idle will not detect idleness faster than this
const LOAD_TIMEOUT_MS = 30000;
const PRELOAD_LEAD_MS = 5000; // how long before a switch the "Before switch" refresh runs
const PRELOAD_VALID_MS = 20000;
const MIN_SHOW_MS = 5000; // same floor as Show Each Tab For, so short pages can't make tabs cycle nonstop
const HEARTBEAT_ALARM = 'heartbeat';
const STOP_SCROLLING = { command: 'stopScrolling' };

let settings = normalizeSettings({});
let activityPaused = false;
let tabLoadedAt = {}; // tabId -> timestamp of the last completed load
let loadTimesTimer = null;
let ticker = null;
const windows = new Map(); // windowId -> state, only for windows where the timer is running
const stayWindows = new Set(); // windows that refresh the active tab instead of switching
const popupWindows = new Set(); // windows with the popup open

const CONTENT_SCRIPT_ID = 'content-scroll';

const ready = init().catch((err) => console.error("Skilly's Auto Tab Switcher failed to initialise", err));

// Registered only while the optional site access is granted. Checked on every worker start.
async function syncContentScript() {
    const [granted, existing] = await Promise.all([
        hasSiteAccess(),
        chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
    ]);
    if (granted && !existing.length) {
        await chrome.scripting.registerContentScripts([{
            id: CONTENT_SCRIPT_ID,
            matches: ['<all_urls>'],
            js: ['content_scroll.js'],
            persistAcrossSessions: true
        }]);
    } else if (!granted && existing.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
}

syncContentScript().catch((err) => console.error('Content script sync failed', err));

async function init() {
    const [local, session] = await Promise.all([
        chrome.storage.local.get(null),
        chrome.storage.session.get(['running', 'tabLoadedAt', 'stayWindows'])
    ]);
    settings = normalizeSettings(local);
    tabLoadedAt = session.tabLoadedAt || {};
    for (const id of session.stayWindows || []) stayWindows.add(id);

    chrome.idle.setDetectionInterval(idleSeconds());
    await refreshActivityState();

    // Session storage survives a worker restart but not a browser restart, so window IDs here are still valid.
    for (const [id, saved] of Object.entries(session.running || {})) {
        const windowId = Number(id);
        try {
            await chrome.windows.get(windowId);
        } catch (e) {
            continue;
        }
        const w = newWindowState(windowId);
        w.deadline = saved.deadline ?? null;
        w.remaining = saved.remaining ?? w.remaining;
        w.restoreState = saved.restoreState ?? null;
        const tab = await getActiveTab(windowId);
        w.activeTabId = tab ? tab.id : null;
        w.activeUrl = tab ? tab.url : null;
        windows.set(windowId, w);
        if (isPaused(w)) pause(w); else resume(w);
    }
    persistRunning();
    // Older versions kept the heartbeat alarm running even with no timer.
    if (windows.size) ensureTicker(); else chrome.alarms.clear(HEARTBEAT_ALARM);
}

// ---------- Window state ----------

function newWindowState(windowId) {
    return {
        windowId,
        deadline: null,       // timestamp of the next switch while counting down
        remaining: settings.switchInterval * 1000, // ms left while paused
        waitingTabId: null,   // tab we are waiting on to finish loading
        waitTimer: null,
        hoverPaused: false,
        hoverResumeTimer: null,
        switchingTo: null,    // tab we activated ourselves, so onActivated can ignore it
        activeTabId: null,
        activeUrl: null,      // URL of activeTabId, used to pick its display time
        badgeTabId: null,
        restoreState: null    // window state to return to on stop, set only if we made it full screen
    };
}

function popupPaused(w) {
    return settings.pauseMode === 'hover' && popupWindows.has(w.windowId);
}

function isPaused(w) {
    return activityPaused || w.hoverPaused || popupPaused(w) || w.waitingTabId !== null;
}

function remainingMs(w) {
    return w.deadline !== null ? Math.max(0, w.deadline - Date.now()) : w.remaining;
}

function pause(w) {
    if (w.deadline === null) return;
    w.remaining = remainingMs(w);
    w.deadline = null;
}

function resume(w) {
    if (w.deadline === null && !isPaused(w)) w.deadline = Date.now() + w.remaining;
}

function intervalSeconds(s, w) {
    return stayWindows.has(w.windowId) ? s.switchInterval : displaySecondsFor(s, w.activeUrl);
}

function persistStayWindows() {
    chrome.storage.session.set({ stayWindows: [...stayWindows] });
}

function setStayOnPage(windowId, stay) {
    if (stay) stayWindows.add(windowId); else stayWindows.delete(windowId);
    persistStayWindows();
    const w = windows.get(windowId);
    if (!w) return;
    restartCountdown(w);
    renderBadge(windowId);
}

function restartCountdown(w) {
    w.deadline = null;
    w.shownAt = Date.now();
    w.remaining = intervalSeconds(settings, w) * 1000;
    w.shownSeconds = undefined;
    w.preloadChecked = false;
    resume(w);
    persistRunning();
}

function persistRunning() {
    const running = {};
    for (const [id, w] of windows) {
        running[id] = { deadline: w.deadline, remaining: w.remaining, restoreState: w.restoreState };
    }
    chrome.storage.session.set({ running });
}

function persistLoadTimes() {
    clearTimeout(loadTimesTimer);
    loadTimesTimer = setTimeout(() => chrome.storage.session.set({ tabLoadedAt }), 1000);
}

async function startWindow(windowId) {
    if (windows.has(windowId)) return;
    const w = newWindowState(windowId);
    windows.set(windowId, w);
    if (settings.fullscreenOnStart) await enterFullscreen(w);
    const tab = await getActiveTab(windowId);
    w.activeTabId = tab ? tab.id : null;
    w.activeUrl = tab ? tab.url : null;
    restartCountdown(w);
    if (tab && !activityPaused) startScrolling(tab.id, true);
    ensureTicker();
    renderBadge(windowId);
}

async function enterFullscreen(w) {
    const win = await chrome.windows.get(w.windowId).catch(() => null);
    if (!win || win.state === 'fullscreen') return;
    try {
        await chrome.windows.update(w.windowId, { state: 'fullscreen' });
        w.restoreState = win.state === 'minimized' ? 'normal' : win.state;
    } catch (e) {
        // Some window types or platforms refuse full screen. Keep running windowed.
    }
}

// Minimized windows are left alone so a switch never pops one up.
async function restoreFullscreen(w) {
    const win = await chrome.windows.get(w.windowId).catch(() => null);
    if (!win || (win.state !== 'normal' && win.state !== 'maximized')) return;
    try {
        await chrome.windows.update(w.windowId, { state: 'fullscreen' });
        if (!w.restoreState) w.restoreState = win.state;
    } catch (e) {
        // Some window types or platforms refuse full screen.
    }
}

// Only undoes full screen we applied, and only if the user has not already left it.
async function exitFullscreen(w) {
    if (!w.restoreState) return;
    const win = await chrome.windows.get(w.windowId).catch(() => null);
    if (win && win.state === 'fullscreen') {
        await chrome.windows.update(w.windowId, { state: w.restoreState }).catch(() => {});
    }
}

// Drops runtime state. Returns false if the window was not running.
function forgetWindow(windowId) {
    const w = windows.get(windowId);
    if (!w) return false;
    clearTimeout(w.waitTimer);
    clearTimeout(w.hoverResumeTimer);
    windows.delete(windowId);
    persistRunning();
    if (!windows.size) {
        clearInterval(ticker);
        ticker = null;
        chrome.alarms.clear(HEARTBEAT_ALARM);
    }
    return true;
}

async function stopWindow(windowId) {
    const w = windows.get(windowId);
    if (!forgetWindow(windowId)) return;
    exitFullscreen(w);
    const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
    for (const tab of tabs) {
        clearBadge(tab.id);
        sendToTab(tab.id, STOP_SCROLLING);
        // Switching turned this off. Let Chrome unload the tab under memory pressure again.
        if (!tab.autoDiscardable) chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => {});
    }
}

// ---------- Countdown and switching ----------

function ensureTicker() {
    if (ticker) return;
    ticker = setInterval(tick, 1000);
    // Wakes the worker if Chrome suspends it, and drives background refreshes.
    chrome.alarms.get(HEARTBEAT_ALARM).then((alarm) => {
        if (!alarm) chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
    });
}

// The per-second API calls in here also keep the service worker alive while a timer runs.
function tick() {
    const now = Date.now();
    for (const [windowId, w] of windows) {
        if (w.deadline !== null && now >= w.deadline) {
            advance(windowId, w);
        } else {
            w.shownSeconds = Math.ceil(remainingMs(w) / 1000); // same value the badge shows until the next tick
            if (w.deadline !== null && !w.preloadChecked && w.deadline - now <= PRELOAD_LEAD_MS) {
                w.preloadChecked = true;
                preloadNext(windowId, w);
            }
            renderBadge(windowId);
        }
    }
}

// The timer ran out, or the page finished scrolling and its rule says to move on.
function advance(windowId, w) {
    w.deadline = null;
    w.remaining = 0;
    switchTab(windowId, w).catch((err) => {
        console.warn('Tab switch failed', err);
        if (windows.get(windowId) === w) restartCountdown(w);
    });
}

// The timer still decides: a held or loading window ignores the early switch.
function handleScrollFinished(tab) {
    if (stayWindows.has(tab.windowId)) return;
    const w = windows.get(tab.windowId);
    if (!w || w.activeTabId !== tab.id || isPaused(w)) return;
    const earliest = (w.shownAt || 0) + MIN_SHOW_MS;
    if (Date.now() < earliest) {
        if (w.deadline > earliest) w.deadline = earliest;
        persistRunning();
        return;
    }
    advance(tab.windowId, w);
}

async function switchTab(windowId, w) {
    if (settings.keepFullscreen) await restoreFullscreen(w);
    const tabs = await chrome.tabs.query({ windowId });
    if (windows.get(windowId) !== w) return;
    if (!tabs.length) {
        restartCountdown(w);
        return;
    }

    const { current, next } = pickNext(tabs);

    // With a single tab we "switch" to the same tab so its refresh rule still applies.
    if (!current || next.id !== current.id) {
        if (current) {
            sendToTab(current.id, STOP_SCROLLING);
            clearBadge(current.id);
        }
        w.switchingTo = next.id;
        await chrome.tabs.update(next.id, { active: true, autoDiscardable: false });
    }
    w.activeTabId = next.id;

    const tab = await chrome.tabs.get(next.id);
    if (windows.get(windowId) !== w) return;
    w.activeUrl = tab.url || tab.pendingUrl;

    if (shouldRefreshOnSwitch(w, tab)) {
        waitForLoad(w, tab.id);
        await chrome.tabs.reload(tab.id).catch(() => finishWait(w, tab.id));
    } else if (tab.status !== 'complete') {
        // Discarded or still-loading tabs: start the countdown once the page is ready.
        waitForLoad(w, tab.id);
    } else {
        tabReady(w, tab.id);
    }
}

function pickNext(tabs) {
    const currentIndex = tabs.findIndex((t) => t.active);
    const current = tabs[currentIndex];
    if (current && stayWindows.has(current.windowId)) return { current, next: current };
    const wantPinned = settings.pinnedTabs === 'only';
    const eligible = (t) => (settings.pinnedTabs === 'include' || !!t.pinned === wantPinned) && !isSkippedTab(t);
    // Starts after the current tab and ends on it, so the current tab is only picked when nothing else qualifies.
    const ordered = tabs.map((_, i) => tabs[(currentIndex + 1 + i) % tabs.length]);
    // Stays on the current tab when no other tab qualifies.
    const next = ordered.find(eligible) || current || ordered[0];
    return { current, next };
}

function isSkippedTab(tab) {
    if (stayWindows.has(tab.windowId)) return false;
    const url = tab.url || tab.pendingUrl;
    return (settings.skipInternalPages && isInternalUrl(url)) || isSkippedByRule(settings, url);
}

// Reloads the next tab shortly before its turn, so it is already fresh when shown.
async function preloadNext(windowId, w) {
    const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
    if (windows.get(windowId) !== w) return;
    const { current, next } = pickNext(tabs);
    if (!next || (current && next.id === current.id)) return;
    if (refreshRuleFor(settings, next.url || next.pendingUrl).mode !== 'preload') return;
    w.preloaded = { tabId: next.id, at: Date.now() };
    chrome.tabs.reload(next.id).catch(() => { w.preloaded = null; });
}

function shouldRefreshOnSwitch(w, tab) {
    if (stayWindows.has(w.windowId)) return true;
    const rule = refreshRuleFor(settings, tab.url || tab.pendingUrl);
    switch (rule.mode) {
        case 'switch':
            return true;
        case 'preload': {
            // Reload now if the early reload didn't happen or was long enough ago to be stale.
            const p = w.preloaded;
            w.preloaded = null;
            return !(p && p.tabId === tab.id && Date.now() - p.at < PRELOAD_VALID_MS);
        }
        case 'stale':
        case 'background':
            return Date.now() - (tabLoadedAt[tab.id] || 0) >= rule.minutes * 60000;
        default:
            return false;
    }
}

function waitForLoad(w, tabId) {
    w.waitingTabId = tabId;
    pause(w);
    clearTimeout(w.waitTimer);
    // A page that never finishes loading must not stall the rotation.
    w.waitTimer = setTimeout(() => finishWait(w, tabId), LOAD_TIMEOUT_MS);
    renderBadge(w.windowId);
}

function finishWait(w, tabId) {
    if (w.waitingTabId !== tabId || windows.get(w.windowId) !== w) return;
    clearTimeout(w.waitTimer);
    w.waitingTabId = null;
    tabReady(w, tabId);
}

function tabReady(w, tabId) {
    restartCountdown(w);
    if (!activityPaused) startScrolling(tabId, true);
    renderBadge(w.windowId);
}

// Reloads inactive tabs whose rule asks for periodic refreshes.
async function backgroundRefresh() {
    const now = Date.now();
    for (const windowId of [...windows.keys()]) {
        if (stayWindows.has(windowId)) continue;
        const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
        for (const tab of tabs) {
            if (tab.active || tab.status !== 'complete') continue;
            const rule = refreshRuleFor(settings, tab.url);
            if (rule.mode !== 'background') continue;
            if (!(tab.id in tabLoadedAt)) {
                // Loaded before we started tracking. Count from now rather than reloading everything at once.
                tabLoadedAt[tab.id] = now;
                persistLoadTimes();
            } else if (now - tabLoadedAt[tab.id] >= rule.minutes * 60000) {
                chrome.tabs.reload(tab.id).catch(() => {});
            }
        }
    }
}

// ---------- Pausing ----------

function idleSeconds() {
    return Math.max(MIN_IDLE_SECONDS, settings.resumeDelay);
}

async function refreshActivityState() {
    const state = settings.pauseMode === 'activity' ? await chrome.idle.queryState(idleSeconds()) : 'idle';
    setActivityPaused(state === 'active');
}

function setActivityPaused(paused) {
    if (paused === activityPaused) return;
    activityPaused = paused;
    for (const [windowId, w] of windows) {
        if (paused) {
            pause(w);
            if (w.activeTabId !== null) sendToTab(w.activeTabId, STOP_SCROLLING);
        } else {
            resume(w);
            if (w.activeTabId !== null && w.waitingTabId === null) startScrolling(w.activeTabId, false);
        }
        renderBadge(windowId);
    }
    persistRunning();
}

function handleHover(isHovering, tab) {
    if (!tab || !tab.active || settings.pauseMode !== 'hover') return;
    const w = windows.get(tab.windowId);
    if (!w) return;
    clearTimeout(w.hoverResumeTimer);
    if (isHovering || settings.resumeDelay <= 0) {
        w.hoverPaused = !!isHovering;
        updatePause(w);
        return;
    }
    // Stay paused for Resume After seconds once the pointer has left.
    w.hoverResumeTimer = setTimeout(() => {
        w.hoverPaused = false;
        updatePause(w);
    }, settings.resumeDelay * 1000);
}

// Scrolling follows the timer: it holds while the timer is held by hover or the popup, and resumes with it.
function scrollHeld(w) {
    return w.hoverPaused || popupPaused(w);
}

function updatePause(w) {
    if (isPaused(w)) pause(w); else resume(w);
    if (w.activeTabId !== null) sendToTab(w.activeTabId, { command: 'pauseState', paused: scrollHeld(w) });
    persistRunning();
    renderBadge(w.windowId);
}

function scrollSignature(s) {
    return JSON.stringify([s.pauseMode, s.skipInternalPages, s.defaultScroll, Object.entries(s.pageRules).map(([key, rule]) => [key, rule.scroll, rule.skip])]);
}

function applySettingsChange(prev) {
    const scrollChanged = scrollSignature(prev) !== scrollSignature(settings);

    for (const [windowId, w] of windows) {
        if (prev.pauseMode === 'hover' && settings.pauseMode !== 'hover') w.hoverPaused = false;
        if (intervalSeconds(prev, w) !== intervalSeconds(settings, w)) {
            restartCountdown(w);
        } else if (isPaused(w)) {
            pause(w);
        } else {
            resume(w);
        }
        if (scrollChanged && w.activeTabId !== null && w.waitingTabId === null && !activityPaused) {
            startScrolling(w.activeTabId, false);
        }
        renderBadge(windowId);
    }
    persistRunning();
    if (prev.pauseMode !== settings.pauseMode || prev.resumeDelay !== settings.resumeDelay) {
        chrome.idle.setDetectionInterval(idleSeconds());
        refreshActivityState();
    }
}

// ---------- Tabs, badge and content script messaging ----------

async function getActiveTab(windowId) {
    const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
    return tab;
}

function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

// onArrival applies the page's "scroll to top" option. Resumes and setting changes keep the position.
async function startScrolling(tabId, onArrival) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    // The timer may have stopped while we waited, and scrolling only runs with the timer.
    if (!tab || !windows.has(tab.windowId)) return;
    const scroll = scrollSettingsFor(settings, tab.url);
    const autoScroll = scroll.autoScroll && !isSkippedTab(tab);
    const pauseOnHover = settings.pauseMode === 'hover';
    if (!autoScroll && !pauseOnHover) {
        sendToTab(tabId, STOP_SCROLLING);
        return;
    }
    const message = {
        command: 'startScrolling',
        autoScroll,
        speed: scroll.scrollSpeed,
        delay: scroll.scrollDelay,
        atEnd: scroll.atEnd,
        endDelay: scroll.endDelay,
        scrollToTop: onArrival && scroll.scrollToTop,
        pauseOnHover,
        paused: scrollHeld(windows.get(tab.windowId))
    };
    chrome.tabs.sendMessage(tabId, message).catch(async () => {
        // Tabs opened before install or update have no content script yet.
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content_scroll.js'] });
            if (!windows.has(tab.windowId)) return;
            await chrome.tabs.sendMessage(tabId, message);
        } catch (e) {
            // Restricted pages (chrome://, the web store) cannot be scripted.
        }
    });
}

function clearBadge(tabId) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
}

async function renderBadge(windowId) {
    const w = windows.get(windowId);
    if (!w) return;
    const tab = await getActiveTab(windowId);
    if (!tab || windows.get(windowId) !== w) return;

    if (w.badgeTabId !== null && (w.badgeTabId !== tab.id || !settings.badgeVisible)) {
        clearBadge(w.badgeTabId);
        w.badgeTabId = null;
    }
    if (!settings.badgeVisible) return;

    let text;
    let color = settings.badgeColor;
    if (activityPaused) {
        text = '...';
        color = PAUSE_COLOR;
    } else if (w.hoverPaused || popupPaused(w)) {
        text = '||';
        color = PAUSE_COLOR;
    } else if (w.waitingTabId !== null) {
        text = '\u21bb';
    } else {
        text = String(Math.ceil(remainingMs(w) / 1000));
    }

    w.badgeTabId = tab.id;
    chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id }).catch(() => {});
    chrome.action.setBadgeText({ text, tabId: tab.id }).catch(() => {});
}

// ---------- Event listeners (registered synchronously so they wake the worker) ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    ready.then(async () => {
        // Only extension pages (the popup) may start or stop timers, not content scripts.
        const fromPopup = !sender.tab;
        if (msg.command === 'startTimer' && fromPopup) await startWindow(msg.windowId);
        else if (msg.command === 'stopTimer' && fromPopup) await stopWindow(msg.windowId);
        else if (msg.command === 'setStayOnPage' && fromPopup) setStayOnPage(msg.windowId, msg.stay);
        else if (msg.command === 'hoverStateChange') handleHover(msg.isHovering, sender.tab);
        else if (msg.command === 'scrollFinished' && sender.tab) handleScrollFinished(sender.tab);
        const w = windows.get(msg.windowId);
        sendResponse({ running: !!w, seconds: w ? (w.shownSeconds ?? Math.ceil(remainingMs(w) / 1000)) : 0, paused: !!w && isPaused(w), loading: !!w && w.waitingTabId !== null, stay: stayWindows.has(msg.windowId) });
    });
    return true;
});

// The shortcut is set (and can be changed) at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-timer') return;
    ready.then(async () => {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        if (!win) return;
        if (windows.has(win.id)) await stopWindow(win.id);
        else await startWindow(win.id);
    });
});

// The popup holds a port open while it is shown, so On hover also covers editing in the popup.
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'popup' || port.sender.tab) return;
    let windowId = null;
    const update = () => {
        const w = windows.get(windowId);
        if (!w) return;
        updatePause(w);
    };
    port.onMessage.addListener((msg) => {
        windowId = msg.windowId;
        ready.then(() => {
            popupWindows.add(windowId);
            update();
        });
    });
    port.onDisconnect.addListener(() => {
        ready.then(() => {
            popupWindows.delete(windowId);
            update();
        });
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    ready.then(async () => {
        const prev = settings;
        settings = normalizeSettings(await chrome.storage.local.get(null));
        applySettingsChange(prev);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    ready.then(() => {
        tabLoadedAt[tabId] = Date.now();
        persistLoadTimes();
        const w = windows.get(tab.windowId);
        if (!w) return;
        if (w.activeTabId === tabId) w.activeUrl = tab.url;
        if (w.waitingTabId === tabId) finishWait(w, tabId);
        else if (tab.active && !activityPaused) startScrolling(tabId, false);
    });
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    ready.then(async () => {
        const w = windows.get(windowId);
        if (!w) return;
        if (w.switchingTo === tabId) {
            w.switchingTo = null;
            return;
        }
        // The user picked a tab by hand: give it a full interval and move scrolling over to it.
        if (w.activeTabId !== null && w.activeTabId !== tabId) sendToTab(w.activeTabId, STOP_SCROLLING);
        w.activeTabId = tabId;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (windows.get(windowId) !== w || w.activeTabId !== tabId) return;
        w.activeUrl = tab ? tab.url || tab.pendingUrl : null;
        w.hoverPaused = false;
        if (w.waitingTabId !== null) {
            clearTimeout(w.waitTimer);
            w.waitingTabId = null;
        }
        restartCountdown(w);
        if (!activityPaused) startScrolling(tabId, false);
        renderBadge(windowId);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    ready.then(() => {
        delete tabLoadedAt[tabId];
        persistLoadTimes();
        for (const w of windows.values()) {
            if (w.activeTabId === tabId) {
                w.activeTabId = null;
                w.activeUrl = null;
            }
            if (w.badgeTabId === tabId) w.badgeTabId = null;
            if (w.waitingTabId === tabId) {
                clearTimeout(w.waitTimer);
                w.waitingTabId = null;
                restartCountdown(w);
            }
        }
    });
});

chrome.windows.onRemoved.addListener((windowId) => {
    ready.then(() => {
        forgetWindow(windowId);
        if (stayWindows.delete(windowId)) persistStayWindows();
    });
});

chrome.idle.onStateChanged.addListener((state) => {
    ready.then(() => setActivityPaused(settings.pauseMode === 'activity' && state === 'active'));
});

chrome.permissions.onAdded.addListener(() => {
    syncContentScript().catch(() => {});
    // Tabs that are already open get the script injected by startScrolling().
    ready.then(() => {
        if (activityPaused) return;
        for (const w of windows.values()) {
            if (w.activeTabId !== null) startScrolling(w.activeTabId, false);
        }
    });
});

chrome.permissions.onRemoved.addListener(() => {
    syncContentScript().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) ready.then(backgroundRefresh);
});

chrome.runtime.onInstalled.addListener(() => {
    // Write normalised settings so pre-2.0 keys are migrated, then drop the old ones.
    ready.then(async () => {
        await chrome.storage.local.set(settings);
        await chrome.storage.local.remove(LEGACY_KEYS);
    });
});

chrome.runtime.onStartup.addListener(() => {
    ready.then(async () => {
        if (!settings.autoStart) return;
        const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
        for (const win of all) startWindow(win.id);
    });
});

chrome.windows.onCreated.addListener((win) => {
    ready.then(() => {
        if (settings.autoStart) startWindow(win.id);
    });
}, { windowTypes: ['normal'] });
