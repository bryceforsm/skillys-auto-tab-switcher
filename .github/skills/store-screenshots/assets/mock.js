// Stands in for the chrome.* APIs so the extension pages render with sample data outside the extension.
(() => {
    const params = new URLSearchParams(location.search);
    const store = {
        switchInterval: 30,
        pauseMode: 'hover',
        defaultRefresh: { mode: 'stale', minutes: 10 },
        defaultScroll: { autoScroll: true, scrollToTop: true, scrollDelay: 5, scrollSpeed: 20 },
        pageRules: {
            'page:https://github.com/bryceforsm/skillys-auto-tab-switcher': { display: { seconds: 60 }, refresh: { mode: 'background', minutes: 5 } },
            'host:grafana.example.com': { refresh: { mode: 'switch', minutes: 5 } },
            'host:status.example.com': { display: { seconds: 15 }, scroll: { autoScroll: false, scrollToTop: false, scrollDelay: 5, scrollSpeed: 20 } },
            'host:homeassistant.local:8123': { display: { seconds: 45 }, refresh: { mode: 'never', minutes: 5 } },
            'page:https://en.wikipedia.org/wiki/Main_Page': { scroll: { autoScroll: true, scrollToTop: true, scrollDelay: 3, scrollSpeed: 35 } },
            'host:example.com': { display: { seconds: 120 } },
            'page:https://sales.example.com/reports/weekly': { display: { seconds: 90 }, refresh: { mode: 'stale', minutes: 30 } }
        },
        autoStart: true,
        fullscreenOnStart: true,
        badgeColor: '#32cd32',
        badgeVisible: true,
        theme: params.get('theme') || 'light'
    };

    const outOfBox = params.get('defaults') === '1';
    // theme.js reads storage before shared.js (and DEFAULTS) has loaded, and only needs the theme.
    const settings = () => {
        if (!outOfBox) return structuredClone(store);
        if (typeof DEFAULTS === 'undefined') return { theme: store.theme };
        return { ...structuredClone(DEFAULTS), theme: store.theme };
    };

    window.chrome = {
        storage: {
            local: { get: async () => settings(), set: async () => {}, remove: async () => {}, clear: async () => {} },
            onChanged: { addListener() {} }
        },
        windows: { getCurrent: async () => ({ id: 1 }) },
        commands: { getAll: async () => [{ name: 'toggle-timer', shortcut: 'Alt+Shift+S' }] },
        tabs: { query: async () => [{ id: 1, url: 'https://github.com/bryceforsm/skillys-auto-tab-switcher' }], create() {} },
        runtime: { getManifest: () => ({ version: '2.1.2' }), sendMessage: async () => ({ running: !outOfBox, seconds: 12, paused: false, loading: false }), connect: () => ({ postMessage() {} }), openOptionsPage() {} }
    };

    document.addEventListener('DOMContentLoaded', () => {
        // Headless capture can land mid-transition (Stop Timer still fading from green), so skip them.
        const still = document.createElement('style');
        still.textContent = '*, *::before, *::after { transition: none !important; }';
        document.head.append(still);
        // Centres the popup on a backdrop for the 1280x800 store screenshots.
        if (params.get('frame')) {
            const dark = store.theme === 'dark';
            const style = document.createElement('style');
            style.textContent = `
                html { height: 100%; display: flex; align-items: center; justify-content: center;
                       background: ${dark ? 'linear-gradient(135deg, #0f1115, #2a2d34)' : 'linear-gradient(135deg, #dfe7f5, #f5f7fb)'} !important; }
                body { margin: 0 !important; box-shadow: 0 12px 40px rgba(0, 0, 0, ${dark ? 0.6 : 0.25}); }`;
            document.head.append(style);
        }
        if (params.get('edit')) setTimeout(() => openEditor(params.get('edit')), 300);
        // A magenta backdrop lets the script find where the popup ends in a tall screenshot.
        if (params.get('measure')) {
            const style = document.createElement('style');
            style.textContent = 'html { background: #ff00ff !important; } body { margin: 0 !important; }';
            document.head.append(style);
        }
    });
})();
