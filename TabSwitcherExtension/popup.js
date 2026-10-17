const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let currentWindowId = null;
let timerRunning = false;
let badgeVisible = true;
let rules = {};        // working copy of pageRules, persisted by Save Settings
let pageKeys = null;   // rule keys for the active tab, null when rules cannot apply to it
let pageUrl = '';
let savedSnapshot = '';

init();

async function init() {
    fillModeSelect($('defaultMode'), false);
    fillModeSelect($('ruleMode'), true);

    const [win, [tab], stored] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        chrome.storage.local.get(null)
    ]);
    currentWindowId = win.id;
    const s = normalizeSettings(stored);

    badgeVisible = s.badgeVisible;
    rules = structuredClone(s.pageRules);
    $('interval').value = s.switchInterval;
    $('pauseMode').value = s.pauseMode;
    $('autoStart').checked = s.autoStart;
    $('theme').value = s.theme;
    $('fullscreenOnStart').checked = s.fullscreenOnStart;
    $('defaultMode').value = s.defaultRefresh.mode;
    $('defaultMinutes').value = s.defaultRefresh.minutes;
    $('autoScroll').checked = s.defaultScroll.autoScroll;
    $('scrollToTop').checked = s.defaultScroll.scrollToTop;
    $('scrollDelay').value = s.defaultScroll.scrollDelay;
    $('scrollSpeed').value = s.defaultScroll.scrollSpeed;
    $('scrollSpeedDisplay').textContent = s.defaultScroll.scrollSpeed;
    $('badgeColor').value = s.badgeColor;

    setupPageEditor(tab);
    renderRuleList();
    updateVisibility();
    savedSnapshot = snapshot();

    for (const id of ['interval', 'pauseMode', 'autoStart', 'fullscreenOnStart', 'defaultMode', 'defaultMinutes', 'autoScroll',
        'scrollToTop', 'scrollDelay', 'scrollSpeed', 'badgeColor']) {
        $(id).addEventListener('input', onFormChange);
        $(id).addEventListener('change', onFormChange);
    }
    $('ruleScope').addEventListener('change', () => {
        loadEditorRule();
        checkUnsavedChanges();
    });
    for (const id of ['ruleMode', 'ruleMinutes', 'ruleDisplayMode', 'ruleDisplaySeconds', 'ruleScrollMode', 'ruleScrollToTop', 'ruleScrollDelay', 'ruleScrollSpeed']) {
        $(id).addEventListener('input', onRuleEdit);
        $(id).addEventListener('change', onRuleEdit);
    }
    $('scrollSpeed').addEventListener('input', () => {
        $('scrollSpeedDisplay').textContent = $('scrollSpeed').value;
    });
    $('ruleScrollSpeed').addEventListener('input', () => {
        $('ruleScrollSpeedDisplay').textContent = $('ruleScrollSpeed').value;
    });
    $('saveAll').addEventListener('click', save);
    $('toggleTimer').addEventListener('click', toggleTimer);
    $('toggleBadge').addEventListener('click', toggleBadge);
    // Applies immediately, like the badge toggle, rather than waiting for Save Settings.
    $('theme').addEventListener('change', () => chrome.storage.local.set({ theme: $('theme').value }));
    $('manageRules').addEventListener('click', manageRules);

    updateBadgeButtonState();
    const response = await chrome.runtime.sendMessage({ command: 'getTimerState', windowId: currentWindowId });
    timerRunning = !!response?.running;
    updateButtonState();
}

function fillModeSelect(select, includeDefault) {
    if (includeDefault) select.add(new Option('Use default', 'default'));
    for (const [value, label] of Object.entries(REFRESH_MODES)) select.add(new Option(label, value));
}

function currentInterval() {
    return clampInt($('interval').value, 5, 86400, 30);
}

function currentDefaultRefresh() {
    return { mode: $('defaultMode').value, minutes: clampInt($('defaultMinutes').value, 1, 1440, 5) };
}

function currentDefaultScroll() {
    return {
        autoScroll: $('autoScroll').checked,
        scrollToTop: $('scrollToTop').checked,
        scrollDelay: clampInt($('scrollDelay').value, 0, 3600, 5),
        scrollSpeed: clampInt($('scrollSpeed').value, 1, 100, 20)
    };
}

// ---------- Per-page rule editor ----------

function setupPageEditor(tab) {
    pageKeys = tab ? ruleKeysForUrl(tab.url) : null;
    if (!pageKeys) {
        $('pageRuleEditor').hidden = true;
        $('pageRuleUnavailable').hidden = false;
        return;
    }
    pageUrl = tab.url;
    const url = new URL(tab.url);
    $('pageLabel').textContent = url.host + url.pathname;
    $('pageLabel').title = tab.url;
    // file:// pages have no host, so only a page rule makes sense.
    $('ruleScope').querySelector('option[value="site"]').disabled = !pageKeys.site;
    $('ruleScope').value = rules[pageKeys.page] || !pageKeys.site ? 'page' : 'site';
    loadEditorRule();
}

function editorKey() {
    return $('ruleScope').value === 'page' ? pageKeys.page : pageKeys.site;
}

function loadEditorRule() {
    if (!pageKeys) return;
    const rule = rules[editorKey()] || {};
    $('ruleMode').value = rule.refresh ? rule.refresh.mode : 'default';
    $('ruleMinutes').value = (rule.refresh || currentDefaultRefresh()).minutes;

    $('ruleDisplayMode').value = rule.display ? 'custom' : 'default';
    $('ruleDisplaySeconds').value = rule.display ? rule.display.seconds : currentInterval();

    const scroll = rule.scroll || currentDefaultScroll();
    $('ruleScrollMode').value = rule.scroll ? (rule.scroll.autoScroll ? 'on' : 'off') : 'default';
    $('ruleScrollToTop').checked = scroll.scrollToTop;
    $('ruleScrollDelay').value = scroll.scrollDelay;
    $('ruleScrollSpeed').value = scroll.scrollSpeed;
    $('ruleScrollSpeedDisplay').textContent = scroll.scrollSpeed;

    updateVisibility();
    updateEffectiveRule();
}

function onRuleEdit() {
    const key = editorKey();
    const rule = {};
    const mode = $('ruleMode').value;
    if (mode !== 'default') {
        rule.refresh = { mode, minutes: clampInt($('ruleMinutes').value, 1, 1440, 5) };
    }
    if ($('ruleDisplayMode').value === 'custom') {
        rule.display = { seconds: clampInt($('ruleDisplaySeconds').value, 5, 86400, 30) };
    }
    const scrollMode = $('ruleScrollMode').value;
    if (scrollMode !== 'default') {
        rule.scroll = {
            autoScroll: scrollMode === 'on',
            scrollToTop: $('ruleScrollToTop').checked,
            scrollDelay: clampInt($('ruleScrollDelay').value, 0, 3600, 5),
            scrollSpeed: clampInt($('ruleScrollSpeed').value, 1, 100, 20)
        };
    }
    if (rule.refresh || rule.scroll || rule.display) rules[key] = rule; else delete rules[key];
    updateVisibility();
    renderRuleList();
    checkUnsavedChanges();
}

function updateEffectiveRule() {
    if (!pageKeys) return;
    const s = {
        pageRules: rules,
        switchInterval: currentInterval(),
        defaultRefresh: currentDefaultRefresh(),
        defaultScroll: currentDefaultScroll()
    };
    $('effectiveRule').textContent =
        'Show for in effect: ' + describeDisplay(displaySecondsFor(s, pageUrl)) +
        '\nRefresh in effect: ' + describeRefresh(refreshRuleFor(s, pageUrl)) +
        '\nScroll in effect: ' + describeScroll(scrollSettingsFor(s, pageUrl));
}

function renderRuleList() {
    $('ruleCount').textContent = Object.keys(rules).length;
    updateEffectiveRule();
}

function manageRules() {
    // Opening a tab closes the popup, which would silently drop unsaved edits.
    if (snapshot() !== savedSnapshot) {
        $('status').textContent = 'Save your changes before opening the rules page.';
        return;
    }
    chrome.runtime.openOptionsPage();
}

// ---------- Form state ----------

function updateVisibility() {
    $('defaultMinutesWrap').hidden = !MINUTE_MODES.includes($('defaultMode').value);
    $('ruleMinutesWrap').hidden = !MINUTE_MODES.includes($('ruleMode').value);
    $('ruleDisplayWrap').hidden = $('ruleDisplayMode').value !== 'custom';
    $('ruleScrollOptions').hidden = $('ruleScrollMode').value !== 'on';
}

function collectSettings() {
    return {
        switchInterval: currentInterval(),
        pauseMode: $('pauseMode').value,
        autoStart: $('autoStart').checked,
        fullscreenOnStart: $('fullscreenOnStart').checked,
        defaultRefresh: currentDefaultRefresh(),
        defaultScroll: currentDefaultScroll(),
        pageRules: Object.fromEntries(Object.keys(rules).sort().map((key) => [key, rules[key]])),
        badgeColor: $('badgeColor').value
    };
}

function snapshot() {
    return JSON.stringify(collectSettings());
}

function onFormChange() {
    updateVisibility();
    updateEffectiveRule();
    checkUnsavedChanges();
}

function checkUnsavedChanges() {
    const saveBtn = $('saveAll');
    if (snapshot() !== savedSnapshot) {
        saveBtn.classList.add('unsaved');
        saveBtn.textContent = 'Save Settings (Unsaved Changes)';
        $('status').textContent = '';
    } else {
        saveBtn.classList.remove('unsaved');
        saveBtn.textContent = 'Save Settings';
    }
}

async function save() {
    const settings = collectSettings();
    await chrome.storage.local.set(settings);
    await chrome.storage.local.remove(LEGACY_KEYS);

    // Show the values as they were clamped and saved.
    $('interval').value = settings.switchInterval;
    $('scrollDelay').value = settings.defaultScroll.scrollDelay;
    $('defaultMinutes').value = settings.defaultRefresh.minutes;
    loadEditorRule();

    savedSnapshot = snapshot();
    checkUnsavedChanges();
    $('status').textContent = 'Settings saved.';
}

// ---------- Timer and badge buttons ----------

async function toggleTimer() {
    const command = timerRunning ? 'stopTimer' : 'startTimer';
    const response = await chrome.runtime.sendMessage({ command, windowId: currentWindowId });
    timerRunning = !!response?.running;
    updateButtonState();
}

function toggleBadge() {
    badgeVisible = !badgeVisible;
    chrome.storage.local.set({ badgeVisible });
    updateBadgeButtonState();
}

function updateButtonState() {
    const button = $('toggleTimer');
    button.textContent = timerRunning ? 'Stop Timer' : 'Start Timer';
    button.classList.toggle('running', timerRunning);
}

function updateBadgeButtonState() {
    $('toggleBadge').textContent = badgeVisible ? 'Hide Badge' : 'Show Badge';
}
