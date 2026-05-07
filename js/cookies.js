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

    // Pre-set the rejected disable flag synchronously so any code that
    // somehow tries to fire gtag() during early load is a no-op for users
    // who previously rejected. This needs no DOM access and no paint.
    var consent = getConsent();
    if (consent && consent.analytics === false) {
        window[GA_DISABLE_KEY] = true;
    }

    // Defer the rest (banner show, GA load) until after first paint so the
    // initial render isn't blocked. GDPR is preserved because GA is NEVER
    // loaded before the user explicitly accepts; this only delays *showing*
    // the banner by a few hundred ms (industry standard for consent UIs).
    function init() {
        if (consent === null) {
            // First-time visitor — show banner. No analytics loaded.
            showBanner();
        } else if (consent.analytics) {
            // Previously consented — load GA in idle time.
            loadGAWhenIdle();
        }
        // consent.analytics === false: nothing to do (disable flag set above).
    }

    if ('requestIdleCallback' in window) {
        requestIdleCallback(init, { timeout: 1500 });
    } else {
        setTimeout(init, 200);
    }
})();
