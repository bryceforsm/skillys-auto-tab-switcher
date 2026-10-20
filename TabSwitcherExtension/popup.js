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
    setupSteppers();
    $('ruleScope').addEventListener('change', loadEditorRule);
    for (const id of ['ruleMode', 'ruleMinutes', 'ruleDisplayMode', 'ruleDisplaySeconds', 'ruleScrollMode', 'ruleScrollToTop', 'ruleScrollDelay', 'ruleScrollSpeed']) {
        watch(id, onRuleEdit);
    }
    $('ruleScrollSpeed').addEventListener('input', () => {
        $('ruleScrollSpeedDisplay').textContent = $('ruleScrollSpeed').value;
    });
    for (const scope of ['page', 'site']) {
        $(scope + 'Chip').addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            // Clicking the open chip again collapses the editor.
            customizing = !(customizing && $('ruleScope').value === scope);
            $('ruleScope').value = scope;
            loadEditorRule();
        });
    }
    $('pageReset').addEventListener('click', () => resetRule('page'));
    $('siteReset').addEventListener('click', () => resetRule('site'));
    $('undo').addEventListener('click', undoReset);
    $('toggleTimer').addEventListener('click', toggleTimer);
    $('shortcutHint').addEventListener('click', openShortcutSettings);
    $('manageRules').addEventListener('click', manageRules);
    $('moreSettings').addEventListener('click', manageRules);
    $('allowAccess').addEventListener('click', () => requestSiteAccess());
    chrome.permissions.onAdded.addListener(showAccessNote);
    chrome.permissions.onRemoved.addListener(showAccessNote);

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
    shortcutText = commands.find((c) => c.name === 'toggle-timer')?.shortcut || 'Set shortcut';
    renderHint();
}

function renderHint() {
    $('countdownHint').textContent = countdownText;
    $('shortcutHint').textContent = shortcutText;
    $('timerInfo').hidden = !countdownText && !shortcutText;
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

// The +/- buttons step by 5 (1 with Shift), repeat while held and save like typing does.
function setupSteppers() {
    for (const field of document.querySelectorAll('.number-field:has(.step)')) {
        const input = field.querySelector('input');
        let timer = null;
        const step = (dir, shift) => {
            if (input.value === '') input.value = input.min;
            else if (dir > 0) input.stepUp(shift ? 1 : 5);
            else input.stepDown(shift ? 1 : 5);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const stop = () => {
            if (timer === null) return;
            clearTimeout(timer);
            clearInterval(timer);
            timer = null;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        for (const button of field.querySelectorAll('.step')) {
            const dir = Number(button.dataset.dir);
            button.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                step(dir, e.shiftKey);
                timer = setTimeout(() => {
                    timer = setInterval(() => step(dir, e.shiftKey), 70);
                }, 400);
            });
            for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
            // Keyboard activation has no pointer events.
            button.addEventListener('click', (e) => {
                if (e.detail !== 0) return;
                step(dir, e.shiftKey);
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
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
    showAccessNote();
    updateEffectiveRule();
}

async function showAccessNote() {
    $('accessNote').hidden = !needsSiteAccess(defaults) || await hasSiteAccess();
}

// ---------- Per-page rule editor ----------

function setupPageEditor(tab) {
    pageKeys = tab ? ruleKeysForUrl(tab.url) : null;
    if (!pageKeys) {
        $('pageRuleEditor').hidden = true;
        $('pageRuleUnavailable').hidden = false;
        return;
    }
    // The editor always starts collapsed to the summary, and clicking a Page rule or Site rule chip opens it.
    customizing = false;
    pageUrl = tab.url;
    // file:// pages have no host, so only a page rule makes sense.
    $('ruleScope').querySelector('option[value="site"]').disabled = !pageKeys.site;
    $('ruleScope').value = rules[pageKeys.page] || !pageKeys.site ? 'page' : 'site';
    loadEditorRule();
}

function editorKey() {
    return pageKeys[$('ruleScope').value];
}

// With the site rule selected, only the host is shown because that is what the rule applies to.
function updatePageLabel() {
    const url = new URL(pageUrl);
    const siteOnly = customizing && $('ruleScope').value === 'site';
    $('pageLabel').textContent = siteOnly ? url.host : url.host + url.pathname;
    $('pageLabel').title = siteOnly ? `Applies to every page on ${url.host}` : pageUrl;
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
    const rows = [
        ['Show For:', describeDisplay(displaySecondsFor(s, pageUrl)), sectionSource('display')],
        ['Refresh:', describeRefresh(refreshRuleFor(s, pageUrl)), sectionSource('refresh')],
        ['Auto Scroll:', describeScroll(scrollSettingsFor(s, pageUrl)), sectionSource('scroll')]
    ];
    $('effectiveRule').replaceChildren(...rows.map(([label, value, source]) => {
        const item = document.createElement('div');
        item.className = 'summary-item';
        const name = document.createElement('span');
        name.className = 'summary-label';
        name.textContent = label;
        const text = document.createElement('span');
        text.className = 'summary-value';
        text.append(`${value} `);
        const from = document.createElement('span');
        from.className = 'summary-source';
        from.textContent = `(${source})`;
        text.append(from);
        item.append(name, text);
        return item;
    }));
}

function renderRuleState() {
    $('ruleCount').textContent = Object.keys(rules).length;
    showAccessNote();
    if (!pageKeys) return;
    updatePageLabel();
    for (const scope of ['page', 'site']) {
        const has = !!(pageKeys[scope] && rules[pageKeys[scope]]);
        const name = scope === 'page' ? 'Page' : 'Site';
        $(scope + 'Chip').hidden = !pageKeys[scope];
        $(scope + 'Chip').classList.toggle('active', has);
        $(scope + 'Chip').classList.toggle('selected', customizing && $('ruleScope').value === scope);
        $(scope + 'ChipText').textContent = has ? `${name} rule` : `No ${scope} rule`;
        $(scope + 'Reset').hidden = !has;
    }
    updateEffectiveRule();
}

async function manageRules() {
    // Otherwise the rotation would switch away from the settings tab.
    if (timerRunning) await chrome.runtime.sendMessage({ command: 'stopTimer', windowId: currentWindowId });
    await chrome.runtime.openOptionsPage();
    window.close();
}

// ---------- Form state ----------

function updateVisibility() {
    $('ruleFields').hidden = !customizing;
    $('ruleMinutesWrap').hidden = !MINUTE_MODES.includes($('ruleMode').value);
    $('ruleMinutesLabel').textContent = refreshMinutesLabel($('ruleMode').value).replace(/ \(min\):$/, '');
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
