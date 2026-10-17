// Loaded in <head> of extension pages so the theme is applied before first paint.
(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    let choice = 'system';

    function apply() {
        const theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
        document.documentElement.dataset.theme = theme;
    }

    function setChoice(value) {
        choice = ['light', 'dark'].includes(value) ? value : 'system';
        apply();
    }

    apply();
    media.addEventListener('change', apply);
    chrome.storage.local.get('theme').then(({ theme }) => setChoice(theme));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.theme) setChoice(changes.theme.newValue);
    });
})();
