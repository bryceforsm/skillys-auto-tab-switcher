const $ = (id) => document.getElementById(id);
const MINUTE_MODES = ['stale', 'background'];

let settings = normalizeSettings({});
let editingKey = null;

init();

async function init() {
    for (const [value, label] of Object.entries(REFRESH_MODES)) $('editRefresh').add(new Option(label, value));

    $('filter').addEventListener('input', render);
    $('editRefresh').addEventListener('change', updateEditorVisibility);
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
    const rule = settings.pageRules[key];
    if (!rule) return;
    editingKey = key;
    $('editTarget').textContent = (key.startsWith('host:') ? 'Whole site: ' : 'Page: ') + key.slice(5);

    $('editRefresh').value = rule.refresh ? rule.refresh.mode : 'default';
    $('editMinutes').value = (rule.refresh || settings.defaultRefresh).minutes;

    const scroll = rule.scroll || settings.defaultScroll;
    $('editScroll').value = rule.scroll ? (rule.scroll.autoScroll ? 'on' : 'off') : 'default';
    $('editToTop').checked = scroll.scrollToTop;
    $('editDelay').value = scroll.scrollDelay;
    $('editSpeed').value = scroll.scrollSpeed;
    $('editSpeedDisplay').textContent = scroll.scrollSpeed;

    updateEditorVisibility();
    $('editor').showModal();
}

function updateEditorVisibility() {
    $('editMinutesWrap').hidden = !MINUTE_MODES.includes($('editRefresh').value);
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
    const key = editingKey;
    const rule = {};
    const mode = $('editRefresh').value;
    if (mode !== 'default') {
        rule.refresh = { mode, minutes: clampInt($('editMinutes').value, 1, 1440, 5) };
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
    await updateRules((rules) => {
        if (rule.refresh || rule.scroll) rules[key] = rule; else delete rules[key];
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
