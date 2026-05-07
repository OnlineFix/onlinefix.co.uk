/* Cookie Consent - OnlineFix
   GDPR & PECR compliant cookie management.

   Order of operations on every page load:
     1. Read stored consent from localStorage.
     2. If no choice yet -> show banner. Do NOT load any analytics.
     3. If previously accepted -> load GA in idle time (non-blocking).
     4. If previously rejected -> stay silent. No GA, no cookies.
   Analytics never load before the user has explicitly opted in. */

(function () {
    'use strict';

    var CONSENT_KEY = 'onlinefix_cookie_consent';
    var GA_ID = 'G-Q0PC3B1W31';
    var GA_DISABLE_KEY = 'ga-disable-' + GA_ID;

    function getConsent() {
        try {
            var raw = localStorage.getItem(CONSENT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function saveConsent(analytics) {
        var consent = {
            necessary: true,
            analytics: analytics,
            timestamp: new Date().toISOString()
        };
        try {
            localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
        } catch (e) {
            // Storage may be blocked (private mode etc.) — fail silently.
        }
    }

    function loadGA() {
        if (document.getElementById('ga-script')) return;
        // Honour any prior opt-out flag set during this session
        if (window[GA_DISABLE_KEY]) return;
        var script = document.createElement('script');
        script.id = 'ga-script';
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(script);
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', GA_ID, { anonymize_ip: true });
    }

    // Defer GA loading to idle time so the script doesn't compete with first paint.
    // Only ever called AFTER consent has been given.
    function loadGAWhenIdle() {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(loadGA, { timeout: 3000 });
        } else {
            setTimeout(loadGA, 1500);
        }
    }

    function removeGACookies() {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var name = cookies[i].split('=')[0].trim();
            if (name.indexOf('_ga') === 0 || name.indexOf('_gid') === 0 || name.indexOf('_gat') === 0) {
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname;
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname;
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            }
        }
    }

    function showBanner() {
        var banner = document.getElementById('cookie-banner');
        if (!banner) return;
        banner.style.display = 'block';
        // Double rAF avoids forced reflow when toggling the transition class
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                banner.classList.add('visible');
            });
        });
    }

    function hideBanner() {
        var banner = document.getElementById('cookie-banner');
        if (!banner) return;
        banner.classList.remove('visible');
        setTimeout(function () { banner.style.display = ''; }, 300);
    }

    function acceptAll() {
        saveConsent(true);
        // Clear any prior opt-out from this session before (re)loading
        window[GA_DISABLE_KEY] = false;
        loadGAWhenIdle();
        hideBanner();
    }

    function rejectNonEssential() {
        saveConsent(false);
        // Disable any GA already loaded in this session so no further hits fire
        window[GA_DISABLE_KEY] = true;
        removeGACookies();
        hideBanner();
    }

    // Expose for the banner buttons and the "Manage Cookies" footer link
    window.cookieConsentAccept = acceptAll;
    window.cookieConsentReject = rejectNonEssential;
    window.cookieManage = function () { showBanner(); };

    // The script is loaded with `defer`, so the DOM is already parsed by the
    // time we run. No need to wait for DOMContentLoaded or load — running
    // immediately means the banner appears as early as possible for new
    // visitors (legally required) without delaying first paint.
    var consent = getConsent();
    if (consent === null) {
        // First-time visitor — banner must appear before any analytics fire.
        showBanner();
    } else if (consent.analytics) {
        // Previously consented — load GA, but only when the browser is idle
        // so it doesn't compete with LCP.
        loadGAWhenIdle();
    } else {
        // Previously rejected — pre-set the GA disable flag so any future
        // gtag() calls in this session are no-ops, even if some other code
        // tries to load it.
        window[GA_DISABLE_KEY] = true;
    }
})();
