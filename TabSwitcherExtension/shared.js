// Shared by the service worker (importScripts) and the popup (<script>).

const REFRESH_MODES = {
    never: 'Disable',
    switch: 'Every switch',
    stale: 'On switch, if older than',
    background: 'Periodically, in background'
};

const PAUSE_MODES = ['disable', 'activity', 'hover'];

const DEFAULTS = {
    switchInterval: 30,
    pauseMode: 'disable',
    defaultRefresh: { mode: 'switch', minutes: 5 },
    defaultScroll: { autoScroll: false, scrollToTop: false, scrollDelay: 5, scrollSpeed: 20 },
    // "host:<host>" or "page:<url>" -> { refresh?, scroll?, display? }. A missing section means use the default.
    pageRules: {},
    autoStart: false,
    fullscreenOnStart: false,
    badgeColor: '#32cd32',
    badgeVisible: true,
    theme: 'system'
};

// Keys written by earlier versions, migrated by normalizeSettings.
const LEGACY_KEYS = [
    'pauseOnActivity', 'pauseOnHover', 'autoRefresh', 'activityPaused', 'windowStates',
    'refreshRules', 'autoScroll', 'scrollToTop', 'scrollDelay', 'scrollSpeed'
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
        scrollSpeed: clampInt(scroll.scrollSpeed, 1, 100, DEFAULTS.defaultScroll.scrollSpeed)
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
    for (const [key, rule] of Object.entries(sourceRules)) {
        if (!key.startsWith('host:') && !key.startsWith('page:')) continue;
        const refresh = normalizeRefresh(rule && rule.refresh, null);
        const scroll = normalizeScroll(rule && rule.scroll, null);
        const display = normalizeDisplay(rule && rule.display, null);
        if (!refresh && !scroll && !display) continue;
        pageRules[key] = {};
        if (refresh) pageRules[key].refresh = refresh;
        if (scroll) pageRules[key].scroll = scroll;
        if (display) pageRules[key].display = display;
    }

    return {
        switchInterval: clampInt(raw.switchInterval, 5, 86400, DEFAULTS.switchInterval),
        pauseMode,
        defaultRefresh,
        defaultScroll,
        pageRules,
        autoStart: raw.autoStart === true,
        fullscreenOnStart: raw.fullscreenOnStart === true,
        badgeColor: /^#[0-9a-f]{6}$/i.test(raw.badgeColor) ? raw.badgeColor : DEFAULTS.badgeColor,
        badgeVisible: raw.badgeVisible !== false,
        theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system'
    };
}

// Rule keys for a URL: "host:<host>" for the whole site, "page:<url without query or hash>" for one page.
// The twin keys are the same URL with "www." added or removed, which counts as the same site.
function ruleKeysForUrl(url) {
    let u;
    try {
        u = new URL(url);
    } catch (e) {
        return null;
    }
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
    const twin = u.host.startsWith('www.') ? u.host.slice(4) : 'www.' + u.host;
    return {
        site: u.host ? 'host:' + u.host : null,
        page: 'page:' + u.protocol + '//' + u.host + u.pathname,
        siteTwin: u.host ? 'host:' + twin : null,
        pageTwin: u.host ? 'page:' + u.protocol + '//' + twin + u.pathname : null
    };
}

// Each section is resolved on its own: a page rule beats a site rule, which beats the default.
function ruleSectionFor(settings, url, section) {
    const keys = ruleKeysForUrl(url);
    if (!keys) return null;
    for (const key of [keys.page, keys.pageTwin, keys.site, keys.siteTwin]) {
        const rule = key && settings.pageRules[key];
        if (rule && rule[section]) return rule[section];
    }
    return null;
}

function refreshRuleFor(settings, url) {
    return ruleSectionFor(settings, url, 'refresh') || settings.defaultRefresh;
}

function scrollSettingsFor(settings, url) {
    return ruleSectionFor(settings, url, 'scroll') || settings.defaultScroll;
}

function displaySecondsFor(settings, url) {
    const display = ruleSectionFor(settings, url, 'display');
    return display ? display.seconds : settings.switchInterval;
}

function describeDisplay(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
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
    return `Speed ${scroll.scrollSpeed}${delay}${scroll.scrollToTop ? ', from top' : ''}`;
}
