/* Cookie Consent - OnlineFix
   GDPR & PECR compliant cookie management */

(function () {
    'use strict';

    var CONSENT_KEY = 'onlinefix_cookie_consent';
    var GA_ID = 'G-Q0PC3B1W31';

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
        localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    }

    function loadGA() {
        if (document.getElementById('ga-script')) return;
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
        if (banner) banner.classList.add('visible');
    }

    function hideBanner() {
        var banner = document.getElementById('cookie-banner');
        if (banner) banner.classList.remove('visible');
    }

    function acceptAll() {
        saveConsent(true);
        loadGA();
        hideBanner();
    }

    function rejectNonEssential() {
        saveConsent(false);
        removeGACookies();
        hideBanner();
    }

    // Expose functions globally for button onclick handlers
    window.cookieConsentAccept = acceptAll;
    window.cookieConsentReject = rejectNonEssential;

    // Initialise on DOM ready
    function init() {
        var consent = getConsent();

        if (consent === null) {
            // No choice made yet - show banner, don't load GA
            showBanner();
        } else if (consent.analytics) {
            // User accepted analytics
            loadGA();
        }
        // If consent.analytics === false, do nothing (GA stays blocked)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
