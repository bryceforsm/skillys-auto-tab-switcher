const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let settings = normalizeSettings({});
let editingKey = null;
let sortColumn = 'target';
let sortDirection = 1;

init();

async function init() {
    for (const [value, label] of Object.entries(REFRESH_MODES)) $('editRefresh').add(new Option(label, value));

    $('filter').addEventListener('input', render);
    for (const header of document.querySelectorAll('button.sort')) {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            sortDirection = column === sortColumn ? -sortDirection : 1;
            sortColumn = column;
            render();
        });
    }
    $('editUrl').addEventListener('input', validateUrl);
    $('editType').addEventListener('change', validateUrl);
    $('addRule').addEventListener('click', () => openEditor(null));
    $('exportRules').addEventListener('click', exportRules);
    $('importRules').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', importRules);
    $('includeDefaults').addEventListener('change', render);
    $('editRefresh').addEventListener('change', updateEditorVisibility);
    $('editDisplay').addEventListener('change', updateEditorVisibility);
    $('editScroll').addEventListener('change', updateEditorVisibility);
    $('editSpeed').addEventListener('input', () => {
        $('editSpeedDisplay').textContent = $('editSpeed').value;
    });
    $('editorForm').addEventListener('submit', saveEdit);
    $('cancelEdit').addEventListener('click', () => $('editor').close());
    $('resetAll').addEventListener('click', resetAll);

    // Keep the table current if the popup saves while this page is open.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') load();
    });
    await load();
}

async function load() {
    settings = normalizeSettings(await chrome.storage.local.get(null));
    render();
}

function cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
}

function button(text, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
}

function plural(n, word) {
    return `${n} ${n === 1 ? word : word + 's'}`;
}

function siteHomeUrl(host) {
    const hostname = host.replace(/:\d+$/, '');
    // Site rules don't store a scheme. Local names and IPs rarely have certificates.
    const local = hostname === 'localhost' || !hostname.includes('.') || /^[\d.]+$/.test(hostname) || hostname.startsWith('[');
    return (local ? 'http://' : 'https://') + host + '/';
}

function targetCell(key) {
    const td = cell('', 'target');
    const text = key.slice(5);
    const url = key.startsWith('host:') ? siteHomeUrl(text) : text;
    // Only link URLs the extension itself would produce, never arbitrary schemes from storage.
    if (!ruleKeysForUrl(url)) {
        td.textContent = text;
        return td;
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open in a new tab';
    a.textContent = text;
    // Extension pages cannot open file:// links directly, but chrome.tabs.create can.
    a.addEventListener('click', (event) => {
        event.preventDefault();
        chrome.tabs.create({ url });
    });
    td.append(a);
    return td;
}

// Sort value for a column, or null for "Default" cells, which always go last.
function sortValue(key, column) {
    const rule = settings.pageRules[key];
    switch (column) {
        case 'type': return key.startsWith('host:') ? 'Whole site' : 'Page';
        case 'display': return rule.display ? rule.display.seconds : null;
        case 'refresh': return rule.refresh ? describeRefresh(rule.refresh) : null;
        case 'scroll': return rule.scroll ? describeScroll(rule.scroll) : null;
        // The scheme and "www." are left out so a site and its pages sort together.
        default: return key.slice(5).replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
    }
}

function compareValues(a, b) {
    return typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sortKeys(keys) {
    return keys.sort((a, b) => {
        const va = sortValue(a, sortColumn);
        const vb = sortValue(b, sortColumn);
        if (va === null || vb === null) {
            if (va !== vb) return va === null ? 1 : -1;
        } else {
            const result = compareValues(va, vb) * sortDirection;
            if (result) return result;
        }
        return compareValues(sortValue(a, 'target'), sortValue(b, 'target'));
    });
}

function render() {
    $('defaults').textContent =
        `Default Show For: ${describeDisplay(settings.switchInterval)}. ` +
        `Default Refresh: ${describeRefresh(settings.defaultRefresh)}. ` +
        `Default Auto Scroll: ${describeScroll(settings.defaultScroll)}.`;

    const allKeys = Object.keys(settings.pageRules);
    const filter = $('filter').value.trim().toLowerCase();
    const keys = sortKeys(allKeys.filter((key) => key.slice(5).toLowerCase().includes(filter)));

    for (const header of document.querySelectorAll('button.sort')) {
        const th = header.parentElement;
        if (header.dataset.sort === sortColumn) {
            th.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
        } else {
            th.removeAttribute('aria-sort');
        }
    }

    $('table').hidden = allKeys.length === 0;
    $('empty').hidden = allKeys.length > 0;
    $('exportRules').disabled = allKeys.length === 0 && !$('includeDefaults').checked;
    $('count').textContent = filter
        ? `${keys.length} of ${allKeys.length} rules`
        : plural(allKeys.length, 'rule');

    const rows = keys.map((key) => {
        const rule = settings.pageRules[key];
        const tr = document.createElement('tr');
        const actions = document.createElement('td');
        actions.className = 'actions';
        actions.append(
            button('Edit', '', () => openEditor(key)),
            ' ',
            button('Remove', 'danger', () => removeRule(key))
        );
        tr.append(
            targetCell(key),
            cell(key.startsWith('host:') ? 'Whole site' : 'Page'),
            cell(rule.display ? describeDisplay(rule.display.seconds) : 'Default', rule.display ? '' : 'muted'),
            cell(rule.refresh ? describeRefresh(rule.refresh) : 'Default', rule.refresh ? '' : 'muted'),
            cell(rule.scroll ? describeScroll(rule.scroll) : 'Default', rule.scroll ? '' : 'muted'),
            actions
        );
        return tr;
    });
    $('rules').replaceChildren(...rows);
}

// ---------- Editing ----------

function openEditor(key) {
    const rule = key ? settings.pageRules[key] : {};
    if (!rule) return;
    editingKey = key;
    $('editTitle').textContent = key ? 'Edit Rule' : 'Add Rule';
    $('editType').value = key && key.startsWith('page:') ? 'page' : 'host';
    $('editUrl').value = key ? key.slice(5) : '';
    validateUrl();

    $('editRefresh').value = rule.refresh ? rule.refresh.mode : 'default';
    $('editMinutes').value = (rule.refresh || settings.defaultRefresh).minutes;

    $('editDisplay').value = rule.display ? 'custom' : 'default';
    $('editDisplaySeconds').value = rule.display ? rule.display.seconds : settings.switchInterval;

    const scroll = rule.scroll || settings.defaultScroll;
    $('editScroll').value = rule.scroll ? (rule.scroll.autoScroll ? 'on' : 'off') : 'default';
    $('editToTop').checked = scroll.scrollToTop;
    $('editDelay').value = scroll.scrollDelay;
    $('editSpeed').value = scroll.scrollSpeed;
    $('editSpeedDisplay').textContent = scroll.scrollSpeed;

    updateEditorVisibility();
    $('editor').showModal();
}

// Returns { key } for a valid entry, or { error } explaining what is wrong.
function parseTarget(text, isSite) {
    const value = text.trim();
    if (!value) return { error: 'Enter a ' + (isSite ? 'site, for example app.example.com.' : 'page URL.') };
    // Bare hosts such as "example.com:8080" have no scheme, so parse them as https.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value;
    let url;
    try {
        url = new URL(withScheme);
    } catch (e) {
        return { error: 'Not a valid URL.' };
    }
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
        return { error: 'Only http, https and file URLs are supported.' };
    }
    // Chromium percent-encodes some invalid host characters (such as spaces) instead of rejecting them.
    if (url.hostname && !/^[a-z0-9._-]+$/i.test(url.hostname) && !/^\[[0-9a-f:.]+\]$/i.test(url.hostname)) {
        return { error: 'Not a valid URL.' };
    }
    const keys = ruleKeysForUrl(url.href);
    const key = isSite ? keys.site : keys.page;
    if (!key) return { error: 'File URLs have no site. Use a page rule instead.' };
    const twin = isSite ? keys.siteTwin : keys.pageTwin;
    const host = url.hostname;
    if (host && !host.includes('.') && !host.startsWith('[') && host !== 'localhost') {
        return { key, twin, warning: ` (no dot, so this only matches a computer on your local network. Did you mean ${host}.com?)` };
    }
    return { key, twin };
}

function validateUrl() {
    const isSite = $('editType').value === 'host';
    $('editUrlLabel').textContent = isSite ? 'Site:' : 'Page URL:';
    const result = parseTarget($('editUrl').value, isSite);
    const { key, error, warning } = result;
    $('editUrl').setCustomValidity(error || '');
    // An empty box on a new rule is not a mistake yet, so show the hint without the error color.
    $('editTarget').classList.toggle('error', !!error && $('editUrl').value.trim() !== '');
    $('editTarget').classList.toggle('warning', !!warning);
    $('editTarget').textContent = error || (isSite ? 'Whole site: ' : 'Page: ') + key.slice(5) + (warning || '');
    return result;
}

function updateEditorVisibility() {
    $('editRefresh').setCustomValidity('');
    $('editMinutesWrap').hidden = !MINUTE_MODES.includes($('editRefresh').value);
    $('editDisplayWrap').hidden = $('editDisplay').value !== 'custom';
    $('editScrollOptions').hidden = $('editScroll').value !== 'on';
}

// Read-modify-write against fresh storage so edits made elsewhere are not overwritten.
async function updateRules(change, extra = {}) {
    const current = normalizeSettings(await chrome.storage.local.get(null));
    change(current.pageRules);
    await chrome.storage.local.set({ ...extra, pageRules: current.pageRules });
}

async function saveEdit(event) {
    event.preventDefault();
    const oldKey = editingKey;
    const { key, twin } = validateUrl();
    if (!key) return;
    const rule = {};
    const mode = $('editRefresh').value;
    if (mode !== 'default') {
        rule.refresh = { mode, minutes: clampInt($('editMinutes').value, 1, 1440, 5) };
    }
    if ($('editDisplay').value === 'custom') {
        rule.display = { seconds: clampInt($('editDisplaySeconds').value, 5, 86400, 30) };
    }
    const scrollMode = $('editScroll').value;
    if (scrollMode !== 'default') {
        rule.scroll = {
            autoScroll: scrollMode === 'on',
            scrollToTop: $('editToTop').checked,
            scrollDelay: clampInt($('editDelay').value, 0, 3600, 5),
            scrollSpeed: clampInt($('editSpeed').value, 1, 100, 20)
        };
    }
    if (!oldKey && !rule.refresh && !rule.scroll && !rule.display) {
        $('editRefresh').setCustomValidity('Set Show For, Refresh or Auto Scroll, otherwise the rule does nothing.');
        $('editRefresh').reportValidity();
        return;
    }
    if (key !== oldKey && twin && twin !== oldKey && settings.pageRules[twin]) {
        const what = key.startsWith('host:') ? 'site' : 'page';
        if (confirm(`A rule for ${twin.slice(5)} already covers this ${what}. Edit that rule instead?`)) {
            $('editor').close();
            openEditor(twin);
        }
        return;
    }
    if (key !== oldKey && settings.pageRules[key]
        && !confirm(`A rule for ${key.slice(5)} already exists. Replace it?`)) return;
    await updateRules((rules) => {
        if (oldKey) delete rules[oldKey];
        if (rule.refresh || rule.scroll || rule.display) rules[key] = rule;
    });
    $('editor').close();
}

async function removeRule(key) {
    await updateRules((rules) => {
        delete rules[key];
    });
}

// ---------- Import and export ----------

const DEFAULT_LABELS = {
    switchInterval: 'Show Each Tab For',
    defaultRefresh: 'Default Refresh',
    defaultScroll: 'Default Auto Scroll'
};

function exportRules() {
    const data = { app: "Skilly's Auto Tab Switcher", version: 1, pageRules: settings.pageRules };
    if ($('includeDefaults').checked) {
        data.defaults = Object.fromEntries(Object.keys(DEFAULT_LABELS).map((name) => [name, settings[name]]));
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tab-switcher-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Re-derives each key from its URL so hand-edited files end up in the same form the extension writes.
function canonicalKey(key) {
    return parseTarget(key.slice(5), key.startsWith('host:')).key || null;
}

// Only the defaults actually present in the file, normalised like stored settings.
function parseDefaults(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const normalized = normalizeSettings(raw);
    return Object.fromEntries(Object.keys(DEFAULT_LABELS)
        .filter((name) => raw[name] !== undefined)
        .map((name) => [name, normalized[name]]));
}

async function importRules(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (e) {
        alert('This file is not a valid rules export.');
        return;
    }
    const imported = {};
    // Also accept a bare map of rules, without the export wrapper.
    const source = data && typeof data === 'object' && data.pageRules ? data.pageRules : data;
    for (const [key, rule] of Object.entries(normalizeSettings({ pageRules: source || {} }).pageRules)) {
        const canonical = canonicalKey(key);
        if (canonical) imported[canonical] = rule;
    }
    const keys = Object.keys(imported);
    const fileDefaults = parseDefaults(data?.defaults);
    const hasDefaults = Object.keys(fileDefaults).length > 0;
    const defaults = $('includeDefaults').checked ? fileDefaults : {};
    const defaultNames = Object.keys(defaults).map((name) => DEFAULT_LABELS[name]);
    if (!keys.length && !defaultNames.length) {
        alert(hasDefaults
            ? 'This file only has default settings. Tick Include Defaults to import them.'
            : 'No rules found in this file.');
        return;
    }
    const replaced = keys.filter((key) => settings.pageRules[key]).length;
    const what = [keys.length && plural(keys.length, 'rule'), defaultNames.length && 'default settings'].filter(Boolean);
    let message = `Import ${what.join(' and ')}?`;
    if (replaced) message += `\n\n${plural(replaced, 'existing rule')} for the same site or page will be replaced.`;
    if (defaultNames.length) message += `\n\nYour current ${defaultNames.join(', ')} will be replaced.`;
    else if (hasDefaults) message += '\n\nThis file also has default settings. Tick Include Defaults to import them too.';
    if (!confirm(message)) return;
    await updateRules((rules) => Object.assign(rules, imported), defaults);
}

async function resetAll() {
    if (!confirm("Reset all Skilly's Auto Tab Switcher settings to their defaults?\n\nThis removes every saved rule and cannot be undone.")) return;
    $('filter').value = '';
    await chrome.storage.local.clear();
    await chrome.storage.local.set(structuredClone(DEFAULTS));
}
