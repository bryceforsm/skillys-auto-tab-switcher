// Wrapped in a function so re-injection does not hit "identifier already declared".
(() => {
    // A previous copy may still be running, for example after an extension update. Replace it.
    if (typeof window.__tabSwitcherCleanup === 'function') window.__tabSwitcherCleanup();

    let autoScroll = false;
    let pauseOnHover = false;
    let speed = 20;
    let delay = 0;
    let scrollingActive = false; // true once the start delay has passed
    let hovering = false;
    let resumeDelaying = false;
    let reportedHover = null;
    let scrollIntervalId = null;
    let startTimeoutId = null;
    let resumeTimeoutId = null;

    function contextAlive() {
        try {
            return !!chrome.runtime?.id;
        } catch (e) {
            return false;
        }
    }

    function update() {
        if (!contextAlive()) {
            cleanup();
            return;
        }
        const pausedByHover = pauseOnHover && (hovering || resumeDelaying);
        if (scrollingActive && !pausedByHover) startInterval(); else stopInterval();

        if (pauseOnHover && pausedByHover !== reportedHover) {
            reportedHover = pausedByHover;
            chrome.runtime.sendMessage({ command: 'hoverStateChange', isHovering: pausedByHover }).catch(() => {});
        }
    }

    function startInterval() {
        if (scrollIntervalId) return;
        scrollIntervalId = setInterval(() => {
            if (!contextAlive()) {
                cleanup();
                return;
            }
            window.scrollBy(0, 1);
        }, Math.max(5, 105 - speed));
    }

    function stopInterval() {
        clearInterval(scrollIntervalId);
        scrollIntervalId = null;
    }

    function reset() {
        scrollingActive = false;
        resumeDelaying = false;
        // Hover state from an earlier visit is stale, since mouseout does not fire when the tab is hidden.
        hovering = false;
        reportedHover = null;
        stopInterval();
        clearTimeout(startTimeoutId);
        clearTimeout(resumeTimeoutId);
    }

    function onMouseOver() {
        if (hovering) return;
        hovering = true;
        resumeDelaying = false;
        clearTimeout(resumeTimeoutId);
        update();
    }

    function onMouseOut(e) {
        // relatedTarget is null only when the pointer leaves the page entirely.
        if (e.relatedTarget !== null) return;
        hovering = false;
        if (pauseOnHover && delay > 0 && scrollingActive) {
            resumeDelaying = true;
            clearTimeout(resumeTimeoutId);
            resumeTimeoutId = setTimeout(() => {
                resumeDelaying = false;
                update();
            }, delay * 1000);
        }
        update();
    }

    function onMessage(request, sender, sendResponse) {
        if (request.command === 'startScrolling') {
            reset();
            autoScroll = !!request.autoScroll;
            pauseOnHover = !!request.pauseOnHover;
            speed = Number(request.speed) || 20;
            delay = Math.max(0, Number(request.delay) || 0);
            if (autoScroll && request.scrollToTop) window.scrollTo(0, 0);
            if (autoScroll && delay > 0) {
                startTimeoutId = setTimeout(() => {
                    scrollingActive = true;
                    update();
                }, delay * 1000);
            } else {
                scrollingActive = autoScroll;
            }
            update();
        } else if (request.command === 'stopScrolling') {
            reset();
            pauseOnHover = false;
        } else {
            return;
        }
        // Responding stops the sender from treating this as a missing content script.
        sendResponse({ ok: true });
    }

    function cleanup() {
        reset();
        document.removeEventListener('mouseover', onMouseOver);
        document.removeEventListener('mouseout', onMouseOut);
        try {
            chrome.runtime.onMessage.removeListener(onMessage);
        } catch (e) {
            // Extension context already invalidated.
        }
        if (window.__tabSwitcherCleanup === cleanup) delete window.__tabSwitcherCleanup;
    }

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    chrome.runtime.onMessage.addListener(onMessage);
    window.__tabSwitcherCleanup = cleanup;
})();
