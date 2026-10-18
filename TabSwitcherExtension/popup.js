const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let currentWindowId = null;
let timerRunning = false;
let defaults = normalizeSettings({}); // stored settings, for the defaults rules fall back to
let rules = {};        // working copy of pageRules, persisted by Save Settings
let pageKeys = null;   // rule keys for the active tab, null when rules cannot apply to it
let pageUrl = '';
let customizing = false;
let savedSnapshot = '';

init();

async function init() {
    fillModeSelect($('ruleMode'));

    const [win, [tab], stored] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        chrome.storage.local.get(null)
    ]);
    currentWindowId = win.id;
    defaults = normalizeSettings(stored);

    rules = structuredClone(defaults.pageRules);
    $('interval').value = defaults.switchInterval;
    $('pauseMode').value = defaults.pauseMode;

    setupPageEditor(tab);
    renderRuleList();
    updateVisibility();
    savedSnapshot = snapshot();

    for (const id of ['interval', 'pauseMode']) {
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
    $('ruleScrollSpeed').addEventListener('input', () => {
        $('ruleScrollSpeedDisplay').textContent = $('ruleScrollSpeed').value;
    });
    $('customize').addEventListener('click', () => {
        customizing = true;
        updateVisibility();
    });
    $('saveAll').addEventListener('click', save);
    $('toggleTimer').addEventListener('click', toggleTimer);
    $('manageRules').addEventListener('click', manageRules);

    const response = await chrome.runtime.sendMessage({ command: 'getTimerState', windowId: currentWindowId });
    timerRunning = !!response?.running;
    updateButtonState();
}

function fillModeSelect(select) {
    select.add(new Option('Use default', 'default'));
    for (const [value, label] of Object.entries(REFRESH_MODES)) select.add(new Option(label, value));
}

function currentInterval() {
    return clampInt($('interval').value, 5, 86400, 30);
}

// ---------- Per-page rule editor ----------

function setupPageEditor(tab) {
    pageKeys = tab ? ruleKeysForUrl(tab.url) : null;
    if (!pageKeys) {
        $('pageRuleEditor').hidden = true;
        $('pageRuleUnavailable').hidden = false;
        return;
    }
    // Edit a rule saved under the www or non-www form rather than creating a second one.
    if (!rules[pageKeys.site] && rules[pageKeys.siteTwin]) pageKeys.site = pageKeys.siteTwin;
    if (!rules[pageKeys.page] && rules[pageKeys.pageTwin]) pageKeys.page = pageKeys.pageTwin;
    // Pages without a rule start collapsed to a one-line summary.
    customizing = !!(rules[pageKeys.page] || (pageKeys.site && rules[pageKeys.site]));
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
    $('ruleMinutes').value = (rule.refresh || defaults.defaultRefresh).minutes;

    $('ruleDisplayMode').value = rule.display ? 'custom' : 'default';
    $('ruleDisplaySeconds').value = rule.display ? rule.display.seconds : currentInterval();

    const scroll = rule.scroll || defaults.defaultScroll;
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
        defaultRefresh: defaults.defaultRefresh,
        defaultScroll: defaults.defaultScroll
    };
    $('effectiveRule').textContent =
        'Show For in effect: ' + describeDisplay(displaySecondsFor(s, pageUrl)) +
        '\nRefresh in effect: ' + describeRefresh(refreshRuleFor(s, pageUrl)) +
        '\nAuto Scroll in effect: ' + describeScroll(scrollSettingsFor(s, pageUrl));
}

function renderRuleList() {
    $('ruleCount').textContent = Object.keys(rules).length;
    updateEffectiveRule();
}

async function manageRules() {
    // Opening a tab closes the popup, which would silently drop unsaved edits.
    if (snapshot() !== savedSnapshot) {
        $('status').textContent = 'Save your changes before opening More Settings and Rules.';
        return;
    }
    // Otherwise the rotation would switch away from the settings tab.
    if (timerRunning) await chrome.runtime.sendMessage({ command: 'stopTimer', windowId: currentWindowId });
    chrome.runtime.openOptionsPage();
}

// ---------- Form state ----------

function updateVisibility() {
    $('ruleFields').hidden = !customizing;
    $('customize').hidden = customizing;
    $('ruleMinutesWrap').hidden = !MINUTE_MODES.includes($('ruleMode').value);
    $('ruleMinutesLabel').textContent = refreshMinutesLabel($('ruleMode').value);
    $('ruleDisplayWrap').hidden = $('ruleDisplayMode').value !== 'custom';
    $('ruleScrollOptions').hidden = $('ruleScrollMode').value !== 'on';
}

function collectSettings() {
    return {
        switchInterval: currentInterval(),
        pauseMode: $('pauseMode').value,
        pageRules: Object.fromEntries(Object.keys(rules).sort().map((key) => [key, rules[key]]))
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
    const status = $('status');
    if (snapshot() !== savedSnapshot) {
        saveBtn.classList.add('unsaved');
        saveBtn.textContent = 'Save Settings (Unsaved Changes)';
        status.textContent = 'Unsaved changes are lost when this popup closes.';
        status.classList.add('warning');
    } else {
        saveBtn.classList.remove('unsaved');
        saveBtn.textContent = 'Save Settings';
        if (status.classList.contains('warning')) status.textContent = '';
        status.classList.remove('warning');
    }
}

async function save() {
    const settings = collectSettings();
    await chrome.storage.local.set(settings);
    await chrome.storage.local.remove(LEGACY_KEYS);

    // Show the values as they were clamped and saved.
    $('interval').value = settings.switchInterval;
    loadEditorRule();

    savedSnapshot = snapshot();
    checkUnsavedChanges();
    $('status').textContent = 'Settings saved.';
}

// ---------- Timer button ----------

async function toggleTimer() {
    const command = timerRunning ? 'stopTimer' : 'startTimer';
    const response = await chrome.runtime.sendMessage({ command, windowId: currentWindowId });
    timerRunning = !!response?.running;
    updateButtonState();
}

function updateButtonState() {
    const button = $('toggleTimer');
    button.textContent = timerRunning ? 'Stop Timer' : 'Start Timer';
    button.classList.toggle('running', timerRunning);
}
