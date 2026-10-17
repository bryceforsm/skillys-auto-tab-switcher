const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let settings = normalizeSettings({});
let editingKey = null;

init();

async function init() {
    for (const [value, label] of Object.entries(REFRESH_MODES)) $('editRefresh').add(new Option(label, value));

    $('filter').addEventListener('input', render);
    $('editUrl').addEventListener('input', validateUrl);
    $('editType').addEventListener('change', validateUrl);
    $('addRule').addEventListener('click', () => openEditor(null));
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

function render() {
    $('defaults').textContent =
        `Default show for: ${describeDisplay(settings.switchInterval)}. ` +
        `Default refresh: ${describeRefresh(settings.defaultRefresh)}. ` +
        `Default auto scroll: ${describeScroll(settings.defaultScroll)}.`;

    const allKeys = Object.keys(settings.pageRules).sort();
    const filter = $('filter').value.trim().toLowerCase();
    const keys = allKeys.filter((key) => key.slice(5).toLowerCase().includes(filter));

    $('table').hidden = allKeys.length === 0;
    $('empty').hidden = allKeys.length > 0;
    $('count').textContent = filter
        ? `${keys.length} of ${allKeys.length} rules`
        : `${allKeys.length} ${allKeys.length === 1 ? 'rule' : 'rules'}`;

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
            cell(key.slice(5), 'target'),
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
    $('editTitle').textContent = key ? 'Edit rule' : 'Add rule';
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
async function updateRules(change) {
    const current = normalizeSettings(await chrome.storage.local.get(null));
    change(current.pageRules);
    await chrome.storage.local.set({ pageRules: current.pageRules });
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

async function resetAll() {
    if (!confirm("Reset all Skilly's Auto Tab Switcher settings to their defaults?\n\nThis removes every saved rule and cannot be undone.")) return;
    $('filter').value = '';
    await chrome.storage.local.clear();
    await chrome.storage.local.set(structuredClone(DEFAULTS));
}
