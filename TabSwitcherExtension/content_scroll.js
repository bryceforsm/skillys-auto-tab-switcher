// Wrapped in a function so re-injection does not hit "identifier already declared".
(() => {
    // A previous copy may still be running, for example after an extension update. Replace it.
    if (typeof window.__tabSwitcherCleanup === 'function') window.__tabSwitcherCleanup();

    let autoScroll = false;
    let pauseOnHover = false;
    let speed = 20;
    let delay = 0;
    let atEnd = 'stop'; // what to do at the bottom: stop, next (switch tab), yoyo (scroll back up and repeat) or yoyoNext (back up, then switch tab)
    let endDelay = 0;
    let phase = 'down'; // down, bottom (waiting), up, top (waiting) or done
    let waitLeft = 0; // ms left in a bottom or top wait, only counted while scrolling is running
    let scrollingActive = false; // true once the start delay has passed
    let hovering = false;
    let held = false; // the background says the timer is held (hover delay or popup), so scrolling waits too
    let reportedHover = null;
    let frameId = null;
    let lastFrame = 0;
    let carry = 0; // distance owed but smaller than one device pixel
    let startTimeoutId = null;

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
        const pausedByHover = pauseOnHover && (hovering || held);
        if (scrollingActive && !pausedByHover && phase !== 'done') startLoop(); else stopLoop();

        // The background applies Resume After to the timer and tells us when to resume.
        if (pauseOnHover && hovering !== reportedHover) {
            reportedHover = hovering;
            chrome.runtime.sendMessage({ command: 'hoverStateChange', isHovering: hovering }).catch(() => {});
        }
    }

    // Speed 20 is about 12 px/s and speed 100 is 200 px/s.
    function pixelsPerSecond() {
        return 1000 / Math.max(5, 105 - speed);
    }

    function atBottom() {
        return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    }

    function step(now) {
        if (!contextAlive()) {
            cleanup();
            return;
        }
        // Cap the gap so a frame after a long stall (hidden tab, busy page) doesn't jump.
        const elapsed = Math.min(now - lastFrame, 100);
        lastFrame = now;

        if (phase === 'bottom' || phase === 'top') {
            waitLeft -= elapsed;
            if (waitLeft <= 0) {
                carry = 0;
                if (phase === 'top' && atEnd !== 'yoyoNext') {
                    phase = 'down';
                } else if (phase === 'top' || atEnd === 'next') {
                    // The background decides whether to switch, since the timer takes precedence.
                    phase = 'done';
                    chrome.runtime.sendMessage({ command: 'scrollFinished' }).catch(() => {});
                    stopLoop();
                    return;
                } else {
                    phase = 'up';
                }
            }
            frameId = requestAnimationFrame(step);
            return;
        }

        carry += elapsed * pixelsPerSecond() / 1000;
        // Whole device pixels keep every step the same size, so motion stays even on any display.
        const unit = 1 / (window.devicePixelRatio || 1);
        const move = Math.floor(carry / unit) * unit;
        if (move > 0) {
            // 'instant' overrides pages that set scroll-behavior: smooth, which would animate every step.
            window.scrollBy({ top: phase === 'up' ? -move : move, behavior: 'instant' });
            carry -= move;
        }
        if (phase === 'down' && atEnd !== 'stop' && atBottom()) {
            phase = 'bottom';
            waitLeft = endDelay * 1000;
        } else if (phase === 'up' && window.scrollY <= 0) {
            phase = 'top';
            waitLeft = delay * 1000;
        }
        frameId = requestAnimationFrame(step);
    }

    function startLoop() {
        if (frameId) return;
        lastFrame = performance.now();
        carry = 0;
        frameId = requestAnimationFrame(step);
    }

    function stopLoop() {
        cancelAnimationFrame(frameId);
        frameId = null;
    }

    function reset() {
        scrollingActive = false;
        phase = 'down';
        waitLeft = 0;
        stopLoop();
        clearTimeout(startTimeoutId);
    }

    function onMouseOver() {
        if (hovering) return;
        hovering = true;
        update();
    }

    function onMouseOut(e) {
        // relatedTarget is null only when the pointer leaves the page entirely.
        if (e.relatedTarget !== null) return;
        hovering = false;
        update();
    }

    function onMessage(request, sender, sendResponse) {
        if (request.command === 'startScrolling') {
            reset();
            autoScroll = !!request.autoScroll;
            pauseOnHover = !!request.pauseOnHover;
            held = !!request.paused;
            speed = Number(request.speed) || 20;
            delay = Math.max(0, Number(request.delay) || 0);
            atEnd = ['next', 'yoyo', 'yoyoNext'].includes(request.atEnd) ? request.atEnd : 'stop';
            endDelay = Math.max(0, Number(request.endDelay) || 0);
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
        } else if (request.command === 'pauseState') {
            held = !!request.paused;
            update();
        } else if (request.command === 'stopScrolling') {
            reset();
            // Hover state from an earlier visit is stale, since mouseout does not fire when the tab is hidden.
            hovering = false;
            reportedHover = null;
            held = false;
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
