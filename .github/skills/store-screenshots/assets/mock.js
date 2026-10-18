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
            'host:www.example.com': { display: { seconds: 120 } },
            'page:https://sales.example.com/reports/weekly': { display: { seconds: 90 }, refresh: { mode: 'stale', minutes: 30 } }
        },
        autoStart: true,
        fullscreenOnStart: true,
        badgeColor: '#32cd32',
        badgeVisible: true,
        theme: params.get('theme') || 'light'
    };

    window.chrome = {
        storage: {
            local: { get: async () => structuredClone(store), set: async () => {}, remove: async () => {}, clear: async () => {} },
            onChanged: { addListener() {} }
        },
        windows: { getCurrent: async () => ({ id: 1 }) },
        tabs: { query: async () => [{ id: 1, url: 'https://github.com/bryceforsm/skillys-auto-tab-switcher' }], create() {} },
        runtime: { sendMessage: async () => ({ running: true }), openOptionsPage() {} }
    };

    document.addEventListener('DOMContentLoaded', () => {
        // Centres the popup on a backdrop for the 1280x800 store screenshots.
        if (params.get('frame')) {
            const dark = store.theme === 'dark';
            const style = document.createElement('style');
            style.textContent = `
                html { height: 100%; display: flex; align-items: center; justify-content: center;
                       background: ${dark ? 'linear-gradient(135deg, #0f1115, #2a2d34)' : 'linear-gradient(135deg, #dfe7f5, #f5f7fb)'} !important; }
                body { margin: 0 !important; border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, ${dark ? 0.6 : 0.25}); }`;
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
