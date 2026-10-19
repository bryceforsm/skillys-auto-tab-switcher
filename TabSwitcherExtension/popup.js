const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let currentWindowId = null;
let timerRunning = false;
let defaults = normalizeSettings({}); // stored settings, for the defaults rules fall back to
let rules = {};        // pageRules, written to storage on every edit
let pageKeys = null;   // rule keys for the active tab, null when rules cannot apply to it
let pageUrl = '';
let customizing = false;
let undo = null;       // { key, rule } removed by the last Reset

init();

async function init() {
    fillModeSelect($('ruleMode'));

    const [win, [tab], stored] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        chrome.storage.local.get(null)
    ]);
    currentWindowId = win.id;
    chrome.runtime.connect({ name: 'popup' }).postMessage({ windowId: currentWindowId });
    defaults = normalizeSettings(stored);

    rules = defaults.pageRules;
    $('interval').value = defaults.switchInterval;
    $('pauseMode').value = defaults.pauseMode;

    setupPageEditor(tab);
    renderRuleState();
    updateVisibility();

    watch('interval', saveGeneral);
    watch('pauseMode', saveGeneral);
    $('ruleScope').addEventListener('change', loadEditorRule);
    for (const id of ['ruleMode', 'ruleMinutes', 'ruleDisplayMode', 'ruleDisplaySeconds', 'ruleScrollMode', 'ruleScrollToTop', 'ruleScrollDelay', 'ruleScrollSpeed']) {
        watch(id, onRuleEdit);
    }
    $('ruleScrollSpeed').addEventListener('input', () => {
        $('ruleScrollSpeedDisplay').textContent = $('ruleScrollSpeed').value;
    });
    $('customize').addEventListener('click', () => {
        customizing = true;
        updateVisibility();
    });
    $('pageReset').addEventListener('click', () => resetRule('page'));
    $('siteReset').addEventListener('click', () => resetRule('site'));
    $('undo').addEventListener('click', undoReset);
    $('toggleTimer').addEventListener('click', toggleTimer);
    $('manageRules').addEventListener('click', manageRules);

    const response = await chrome.runtime.sendMessage({ command: 'getTimerState', windowId: currentWindowId });
    timerRunning = !!response?.running;
    updateButtonState();
    showShortcut();
    setInterval(refreshCountdown, 1000);
    refreshCountdown();

    // The keyboard shortcut can start or stop the timer while the popup is open.
    chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'session' || !changes.running) return;
        const state = await chrome.runtime.sendMessage({ command: 'getTimerState', windowId: currentWindowId });
        timerRunning = !!state?.running;
        updateButtonState();
    });
}

let shortcutText = '';
let countdownText = '';

async function showShortcut() {
    const commands = await chrome.commands.getAll();
    shortcutText = commands.find((c) => c.name === 'toggle-timer')?.shortcut || '';
    renderHint();
}

function renderHint() {
    const text = [countdownText, shortcutText].filter(Boolean).join(' \u00b7 ');
    $('shortcutHint').textContent = text;
    $('shortcutHint').hidden = !text;
}

async function refreshCountdown() {
    const state = timerRunning ? await chrome.runtime.sendMessage({ command: 'getTimerState', windowId: currentWindowId }) : null;
    let text = '';
    if (state?.running) {
        if (state.loading) text = 'Loading page';
        else if (state.paused) text = `Paused at ${state.seconds}s`;
        else text = `Next tab in ${state.seconds}s`;
    }
    countdownText = text;
    renderHint();
}

function fillModeSelect(select) {
    select.add(new Option('Use default', 'default'));
    for (const [value, label] of Object.entries(REFRESH_MODES)) select.add(new Option(label, value));
}

// committed is true on change (blur, Enter, picking an option) and false while typing.
function watch(id, save) {
    const el = $(id);
    el.addEventListener('change', () => save(true));
    // Number boxes also save while typing, once the value is in range, so closing the popup keeps it.
    if (el.type === 'number') {
        el.addEventListener('input', () => {
            if (el.value !== '' && el.validity.valid) save(false);
        });
    }
}

function currentInterval() {
    return clampInt($('interval').value, 5, 86400, defaults.switchInterval);
}

function saveGeneral(committed) {
    defaults.switchInterval = currentInterval();
    defaults.pauseMode = $('pauseMode').value;
    if (committed) $('interval').value = defaults.switchInterval;
    chrome.storage.local.set({ switchInterval: defaults.switchInterval, pauseMode: defaults.pauseMode });
    updateEffectiveRule();
}

// ---------- Per-page rule editor ----------

function setupPageEditor(tab) {
    pageKeys = tab ? ruleKeysForUrl(tab.url) : null;
    if (!pageKeys) {
        $('pageRuleEditor').hidden = true;
        $('pageRuleUnavailable').hidden = false;
        return;
    }
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
    return pageKeys[$('ruleScope').value];
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
    renderRuleState();
}

function onRuleEdit(committed) {
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
    if (rule.refresh || rule.scroll || rule.display) {
        // Remembered so the rules page can open the site the way it was visited.
        if (key.startsWith('host:')) rule.scheme = new URL(pageUrl).protocol.slice(0, -1);
        rules[key] = rule;
    } else {
        delete rules[key];
    }
    chrome.storage.local.set({ pageRules: rules });
    showStatus('', false);
    // Show the values as they were clamped and saved.
    if (committed) {
        loadEditorRule();
    } else {
        updateVisibility();
        renderRuleState();
    }
}

function resetRule(scope) {
    const key = pageKeys[scope];
    undo = { key, rule: rules[key] };
    delete rules[key];
    chrome.storage.local.set({ pageRules: rules });
    loadEditorRule();
    showStatus(scope === 'page' ? 'Page rule removed.' : 'Site rule removed.', true);
}

function undoReset() {
    rules[undo.key] = undo.rule;
    chrome.storage.local.set({ pageRules: rules });
    loadEditorRule();
    showStatus('Rule restored.', false);
}

function showStatus(text, canUndo) {
    if (!canUndo) undo = null;
    $('statusText').textContent = text;
    $('undo').hidden = !canUndo;
}

// Where a section comes from, matching the order ruleSectionFor() checks.
function sectionSource(section) {
    if (rules[pageKeys.page]?.[section]) return 'page rule';
    if (pageKeys.site && rules[pageKeys.site]?.[section]) return 'site rule';
    return 'default';
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
        `Show For in effect: ${describeDisplay(displaySecondsFor(s, pageUrl))} (${sectionSource('display')})` +
        `\nRefresh in effect: ${describeRefresh(refreshRuleFor(s, pageUrl))} (${sectionSource('refresh')})` +
        `\nAuto Scroll in effect: ${describeScroll(scrollSettingsFor(s, pageUrl))} (${sectionSource('scroll')})`;
}

function renderRuleState() {
    $('ruleCount').textContent = Object.keys(rules).length;
    if (!pageKeys) return;
    for (const scope of ['page', 'site']) {
        const has = !!(pageKeys[scope] && rules[pageKeys[scope]]);
        const name = scope === 'page' ? 'Page' : 'Site';
        $(scope + 'Chip').hidden = !pageKeys[scope];
        $(scope + 'Chip').classList.toggle('active', has);
        $(scope + 'ChipText').textContent = has ? `${name} rule` : `No ${scope} rule`;
        $(scope + 'Reset').hidden = !has;
    }
    updateEffectiveRule();
}

async function manageRules() {
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
    refreshCountdown();
}
