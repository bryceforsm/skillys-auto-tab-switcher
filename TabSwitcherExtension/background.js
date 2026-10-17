importScripts('shared.js');

const PAUSE_COLOR = '#d93025';
const IDLE_SECONDS = 15;
const LOAD_TIMEOUT_MS = 30000;
const HEARTBEAT_ALARM = 'heartbeat';
const STOP_SCROLLING = { command: 'stopScrolling' };

let settings = normalizeSettings({});
let activityPaused = false;
let tabLoadedAt = {}; // tabId -> timestamp of the last completed load
let loadTimesTimer = null;
let ticker = null;
const windows = new Map(); // windowId -> state, only for windows where the timer is running

const ready = init().catch((err) => console.error('Auto Tab Switcher failed to initialise', err));

async function init() {
    const [local, session] = await Promise.all([
        chrome.storage.local.get(null),
        chrome.storage.session.get(['running', 'tabLoadedAt'])
    ]);
    settings = normalizeSettings(local);
    tabLoadedAt = session.tabLoadedAt || {};

    chrome.idle.setDetectionInterval(IDLE_SECONDS);
    // Wakes the worker if Chrome suspends it, and drives background refreshes.
    if (!(await chrome.alarms.get(HEARTBEAT_ALARM))) {
        chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
    }
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
        windows.set(windowId, w);
        if (isPaused(w)) pause(w); else resume(w);
    }
    persistRunning();
    if (windows.size) ensureTicker();
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
        switchingTo: null,    // tab we activated ourselves, so onActivated can ignore it
        activeTabId: null,
        badgeTabId: null,
        restoreState: null    // window state to return to on stop, set only if we made it full screen
    };
}

function isPaused(w) {
    return activityPaused || w.hoverPaused || w.waitingTabId !== null;
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

function restartCountdown(w) {
    w.deadline = null;
    w.remaining = settings.switchInterval * 1000;
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
    windows.delete(windowId);
    persistRunning();
    if (!windows.size) {
        clearInterval(ticker);
        ticker = null;
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
    }
}

// ---------- Countdown and switching ----------

function ensureTicker() {
    if (!ticker) ticker = setInterval(tick, 1000);
}

// The per-second API calls in here also keep the service worker alive while a timer runs.
function tick() {
    const now = Date.now();
    for (const [windowId, w] of windows) {
        if (w.deadline !== null && now >= w.deadline) {
            w.deadline = null;
            w.remaining = 0;
            switchTab(windowId, w).catch((err) => {
                console.warn('Tab switch failed', err);
                if (windows.get(windowId) === w) restartCountdown(w);
            });
        } else {
            renderBadge(windowId);
        }
    }
}

async function switchTab(windowId, w) {
    const tabs = await chrome.tabs.query({ windowId });
    if (windows.get(windowId) !== w) return;
    if (!tabs.length) {
        restartCountdown(w);
        return;
    }

    const currentIndex = tabs.findIndex((t) => t.active);
    const current = tabs[currentIndex];
    const next = tabs[(currentIndex + 1) % tabs.length];

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

    if (shouldRefreshOnSwitch(tab)) {
        waitForLoad(w, tab.id);
        await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => finishWait(w, tab.id));
    } else if (tab.status !== 'complete') {
        // Discarded or still-loading tabs: start the countdown once the page is ready.
        waitForLoad(w, tab.id);
    } else {
        tabReady(w, tab.id);
    }
}

function shouldRefreshOnSwitch(tab) {
    const rule = refreshRuleFor(settings, tab.url || tab.pendingUrl);
    switch (rule.mode) {
        case 'switch':
            return true;
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
                chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
            }
        }
    }
}

// ---------- Pausing ----------

async function refreshActivityState() {
    const state = settings.pauseMode === 'activity' ? await chrome.idle.queryState(IDLE_SECONDS) : 'idle';
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
    w.hoverPaused = !!isHovering;
    if (w.hoverPaused) pause(w); else resume(w);
    persistRunning();
    renderBadge(tab.windowId);
}

function scrollSignature(s) {
    return JSON.stringify([s.pauseMode, s.defaultScroll, Object.entries(s.pageRules).map(([key, rule]) => [key, rule.scroll])]);
}

function applySettingsChange(prev) {
    const scrollChanged = scrollSignature(prev) !== scrollSignature(settings);

    for (const [windowId, w] of windows) {
        if (prev.pauseMode === 'hover' && settings.pauseMode !== 'hover') w.hoverPaused = false;
        if (prev.switchInterval !== settings.switchInterval) {
            restartCountdown(w);
        } else {
            resume(w);
        }
        if (scrollChanged && w.activeTabId !== null && w.waitingTabId === null && !activityPaused) {
            startScrolling(w.activeTabId, false);
        }
        renderBadge(windowId);
    }
    persistRunning();
    if (prev.pauseMode !== settings.pauseMode) refreshActivityState();
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
    if (!tab) return;
    const scroll = scrollSettingsFor(settings, tab.url);
    const pauseOnHover = settings.pauseMode === 'hover';
    if (!scroll.autoScroll && !pauseOnHover) {
        sendToTab(tabId, STOP_SCROLLING);
        return;
    }
    const message = {
        command: 'startScrolling',
        autoScroll: scroll.autoScroll,
        speed: scroll.scrollSpeed,
        delay: scroll.scrollDelay,
        scrollToTop: onArrival && scroll.scrollToTop,
        pauseOnHover
    };
    chrome.tabs.sendMessage(tabId, message).catch(async () => {
        // Tabs opened before install or update have no content script yet.
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content_scroll.js'] });
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
    } else if (w.hoverPaused) {
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
        else if (msg.command === 'hoverStateChange') handleHover(msg.isHovering, sender.tab);
        sendResponse({ running: windows.has(msg.windowId) });
    });
    return true;
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
        if (w.waitingTabId === tabId) finishWait(w, tabId);
        else if (tab.active && !activityPaused) startScrolling(tabId, false);
    });
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    ready.then(() => {
        const w = windows.get(windowId);
        if (!w) return;
        if (w.switchingTo === tabId) {
            w.switchingTo = null;
            return;
        }
        // The user picked a tab by hand: give it a full interval and move scrolling over to it.
        if (w.activeTabId !== null && w.activeTabId !== tabId) sendToTab(w.activeTabId, STOP_SCROLLING);
        w.activeTabId = tabId;
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
            if (w.activeTabId === tabId) w.activeTabId = null;
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
    ready.then(() => forgetWindow(windowId));
});

chrome.idle.onStateChanged.addListener((state) => {
    ready.then(() => setActivityPaused(settings.pauseMode === 'activity' && state === 'active'));
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
