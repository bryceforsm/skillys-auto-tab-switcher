// Shared by the service worker (importScripts) and the popup (<script>).

const REFRESH_MODES = {
    never: 'Disable',
    switch: 'On switch',
    preload: 'Before switch',
    stale: 'On switch, if older than',
    background: 'Periodically, in background'
};

const PAUSE_MODES = ['disable', 'activity', 'hover'];
const PINNED_MODES = ['include', 'skip', 'only'];
const SCROLL_END_MODES = ['stop', 'next', 'yoyo', 'yoyoNext'];

const DEFAULTS = {
    switchInterval: 30,
    pauseMode: 'disable',
    resumeDelay: 15,
    defaultRefresh: { mode: 'switch', minutes: 5 },
    defaultScroll: { autoScroll: false, scrollToTop: false, scrollDelay: 5, scrollSpeed: 20, atEnd: 'stop', endDelay: 5 },
    // "host:<host>" or "page:<url>" -> { refresh?, scroll?, display?, skip?, scheme? }. A missing section means use the default.
    // scheme is only kept on site rules, for opening the site from the rules page.
    pageRules: {},
    autoStart: false,
    fullscreenOnStart: false,
    keepFullscreen: false,
    pinnedTabs: 'include',
    skipInternalPages: false,
    badgeColor: '#32cd32',
    badgeVisible: true,
    theme: 'system'
};

// Keys written by earlier versions, migrated by normalizeSettings.
const LEGACY_KEYS = [
    'pauseOnActivity', 'pauseOnHover', 'autoRefresh', 'activityPaused', 'windowStates',
    'refreshRules', 'autoScroll', 'scrollToTop', 'scrollDelay', 'scrollSpeed', 'skipPinned'
];

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalizeRefresh(rule, fallback) {
    if (!rule || !Object.hasOwn(REFRESH_MODES, rule.mode)) return fallback;
    return { mode: rule.mode, minutes: clampInt(rule.minutes, 1, 1440, 5) };
}

function normalizeScroll(scroll, fallback) {
    if (!scroll || typeof scroll !== 'object') return fallback;
    return {
        autoScroll: scroll.autoScroll === true,
        scrollToTop: scroll.scrollToTop === true,
        scrollDelay: clampInt(scroll.scrollDelay, 0, 3600, DEFAULTS.defaultScroll.scrollDelay),
        scrollSpeed: clampInt(scroll.scrollSpeed, 1, 100, DEFAULTS.defaultScroll.scrollSpeed),
        atEnd: SCROLL_END_MODES.includes(scroll.atEnd) ? scroll.atEnd : 'stop',
        endDelay: clampInt(scroll.endDelay, 0, 3600, DEFAULTS.defaultScroll.endDelay)
    };
}

function normalizeDisplay(display, fallback) {
    if (!display || typeof display !== 'object') return fallback;
    return { seconds: clampInt(display.seconds, 5, 86400, DEFAULTS.switchInterval) };
}

function normalizeSettings(raw) {
    const pauseMode = PAUSE_MODES.includes(raw.pauseMode)
        ? raw.pauseMode
        : raw.pauseOnActivity ? 'activity' : raw.pauseOnHover ? 'hover' : 'disable';

    const defaultRefresh = raw.defaultRefresh
        ? normalizeRefresh(raw.defaultRefresh, DEFAULTS.defaultRefresh)
        : { mode: raw.autoRefresh === false ? 'never' : 'switch', minutes: 5 };

    // Older versions kept the scroll settings as top-level keys with the same names.
    const defaultScroll = normalizeScroll(raw.defaultScroll || raw, DEFAULTS.defaultScroll);

    const sourceRules = raw.pageRules || Object.fromEntries(
        Object.entries(raw.refreshRules || {}).map(([key, refresh]) => [key, { refresh }])
    );
    const pageRules = {};
    for (const [rawKey, rule] of Object.entries(sourceRules)) {
        if (!rawKey.startsWith('host:') && !rawKey.startsWith('page:')) continue;
        const refresh = normalizeRefresh(rule && rule.refresh, null);
        const scroll = normalizeScroll(rule && rule.scroll, null);
        const display = normalizeDisplay(rule && rule.display, null);
        // true leaves the tab out. false (page rules only) keeps it in even when its site is skipped.
        const skip = !rule ? undefined : rule.skip === true ? true : rule.skip === false && rawKey.startsWith('page:') ? false : undefined;
        if (!refresh && !scroll && !display && skip === undefined) continue;
        const key = normalizeKey(rawKey);
        const entry = {};
        if (refresh) entry.refresh = refresh;
        if (scroll) entry.scroll = scroll;
        if (display) entry.display = display;
        if (skip !== undefined) entry.skip = skip;
        if (key.startsWith('host:') && ['http', 'https'].includes(rule.scheme)) entry.scheme = rule.scheme;
        // Older versions could save two forms of the same key. The one already in normal form wins per section.
        pageRules[key] = key === rawKey ? { ...pageRules[key], ...entry } : { ...entry, ...pageRules[key] };
    }

    return {
        switchInterval: clampInt(raw.switchInterval, 5, 86400, DEFAULTS.switchInterval),
        pauseMode,
        resumeDelay: clampInt(raw.resumeDelay, 1, 3600, DEFAULTS.resumeDelay),
        defaultRefresh,
        defaultScroll,
        pageRules,
        autoStart: raw.autoStart === true,
        fullscreenOnStart: raw.fullscreenOnStart === true,
        keepFullscreen: raw.keepFullscreen === true,
        pinnedTabs: PINNED_MODES.includes(raw.pinnedTabs) ? raw.pinnedTabs : raw.skipPinned === true ? 'skip' : 'include',
        skipInternalPages: raw.skipInternalPages === true,
        badgeColor: /^#[0-9a-f]{6}$/i.test(raw.badgeColor) ? raw.badgeColor : DEFAULTS.badgeColor,
        badgeVisible: raw.badgeVisible !== false,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system'
    };
}

// Auto Scroll and Pause On Hover run a content script, which needs the optional site access.
function needsSiteAccess(s) {
    return s.pauseMode === 'hover' || s.defaultScroll.autoScroll
        || Object.values(s.pageRules).some((rule) => rule.scroll && rule.scroll.autoScroll);
}

function hasSiteAccess() {
    return chrome.permissions.contains({ origins: ['<all_urls>'] });
}

// Firefox can open its shortcut manager directly. Chrome needs its settings page opened in a tab.
function openShortcutSettings() {
    if (typeof chrome.commands.openShortcutSettings === 'function') return chrome.commands.openShortcutSettings();
    return chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// Needs a click or change handler. The prompt can close the popup, so callers must not wait on it.
function requestSiteAccess() {
    return chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
}

// Keys drop a leading "www." and, on web pages, a trailing slash, so both forms of an address match.
function normalizeKey(key) {
    const bare = key.replace(/^(host:|page:https?:\/\/)www\.(?=[^/:]+\.)/i, '$1');
    return /^page:https?:/i.test(bare) ? bare.replace(/\/+$/, '') : bare;
}

// Rule keys for a URL: "host:<host>" for the whole site, "page:<url without query or hash>" for one page.
function ruleKeysForUrl(url) {
    let u;
    try {
        u = new URL(url);
    } catch (e) {
        return null;
    }
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
    return {
        site: u.host ? normalizeKey('host:' + u.host) : null,
        page: normalizeKey('page:' + u.protocol + '//' + u.host + u.pathname)
    };
}

// Each section is resolved on its own: a page rule beats a site rule, which beats the default.
function ruleSectionFor(settings, url, section) {
    const keys = ruleKeysForUrl(url);
    if (!keys) return null;
    for (const key of [keys.page, keys.site]) {
        const rule = key && settings.pageRules[key];
        if (rule && rule[section]) return rule[section];
    }
    return null;
}

function refreshRuleFor(settings, url) {
    return (!isSkippedByRule(settings, url) && ruleSectionFor(settings, url, 'refresh')) || settings.defaultRefresh;
}

function scrollSettingsFor(settings, url) {
    return (!isSkippedByRule(settings, url) && ruleSectionFor(settings, url, 'scroll')) || settings.defaultScroll;
}

// A skipped tab ignores its rule's other sections and uses the defaults.
function displaySecondsFor(settings, url) {
    const display = !isSkippedByRule(settings, url) && ruleSectionFor(settings, url, 'display');
    return display ? display.seconds : settings.switchInterval;
}

// The page rule's skip setting wins over the site rule's, including an explicit false.
function isSkippedByRule(settings, url) {
    const keys = ruleKeysForUrl(url);
    if (!keys) return false;
    for (const key of [keys.page, keys.site]) {
        const rule = key && settings.pageRules[key];
        if (rule && typeof rule.skip === 'boolean') return rule.skip;
    }
    return false;
}

// Rotation choices for a rule editor. "Include anyway" only appears when it would matter.
function fillSkipOptions(select, isPage, siteSkipped, current) {
    const choices = isPage
        ? [['default', siteSkipped ? 'Same as site (skipped)' : 'Same as site'], ['skip', 'Skip']]
        : [['default', 'Include'], ['skip', 'Skip']];
    if (isPage && (siteSkipped || current === 'keep')) choices.push(['keep', 'Include anyway']);
    select.replaceChildren(...choices.map(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        return option;
    }));
    select.value = choices.some(([value]) => value === current) ? current : 'default';
}

// Browser pages such as chrome://extensions, edge://settings or about:config. Empty URLs are not treated as internal.
function isInternalUrl(url) {
    return !!url && !/^(https?|file|ftp):/i.test(url);
}

function describeDisplay(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
}

// Label for the minutes box under a Refresh dropdown, which only shows for these two modes.
function refreshMinutesLabel(mode) {
    return mode === 'background' ? 'Refresh Every (min):' : 'If Older Than (min):';
}

function describeRefresh(rule) {
    switch (rule.mode) {
        case 'stale': return `On switch, if older than ${rule.minutes} min`;
        case 'background': return `Every ${rule.minutes} min, in background`;
        default: return REFRESH_MODES[rule.mode];
    }
}

function describeScroll(scroll) {
    if (!scroll.autoScroll) return 'Disable';
    const delay = scroll.scrollDelay ? `, ${scroll.scrollDelay}s delay` : '';
    const end = scroll.atEnd === 'next' ? ', then next tab' : scroll.atEnd === 'yoyo' ? ', yoyo' : scroll.atEnd === 'yoyoNext' ? ', back up, then next tab' : '';
    return `Speed ${scroll.scrollSpeed}${delay}${scroll.scrollToTop ? ', from top' : ''}${end}`;
}

// Page Up and Page Down step number boxes by 5 (the service worker has no document).
if (typeof document !== 'undefined') {
    // Sliders can be adjusted with the mouse wheel while hovered. Not passive, so the page doesn't scroll too.
    document.addEventListener('wheel', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'range' || input.disabled || !e.deltaY) return;
        e.preventDefault();
        const step = Number(input.step) || 1;
        const next = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) + (e.deltaY < 0 ? step : -step)));
        if (next === Number(input.value)) return;
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { passive: false });
    const nonNegative = (input) => input instanceof HTMLInputElement && input.type === 'number'
        && input.min !== '' && Number(input.min) >= 0;
    document.addEventListener('keydown', (e) => {
        if (e.key === '-' && nonNegative(e.target)) e.preventDefault();
    });
    // Capture phase, so a pasted negative is fixed before any page handler saves it.
    document.addEventListener('input', (e) => {
        if (nonNegative(e.target) && Number(e.target.value) < 0) e.target.value = e.target.value.replace('-', '');
    }, true);
    document.addEventListener('keydown', (e) => {
        const input = e.target;
        if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
        if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;
        e.preventDefault();
        if (e.key === 'PageUp') input.stepUp(5); else input.stepDown(5);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}
