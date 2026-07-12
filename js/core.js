/* Shared JavaScript - OnlineFix */

// Mobile menu toggle
const mobileToggle = document.getElementById('mobile-toggle');
const navMenu = document.getElementById('nav-menu');

if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = navMenu.classList.toggle('active');
        mobileToggle.setAttribute('aria-expanded', isExpanded.toString());
        const icon = mobileToggle.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-bars');
            icon.classList.toggle('fa-times');
        }
    });

    document.addEventListener('click', (e) => {
        const isClickInsideMenu = navMenu.contains(e.target);
        const isClickOnToggle = mobileToggle.contains(e.target);
        const isLink = e.target.tagName === 'A' || e.target.closest('a');

        if ((!isClickInsideMenu && !isClickOnToggle && navMenu.classList.contains('active')) ||
            (isLink && navMenu.classList.contains('active'))) {
            navMenu.classList.remove('active');
            mobileToggle.setAttribute('aria-expanded', 'false');
            const icon = mobileToggle.querySelector('i');
            if (icon) {
                icon.classList.add('fa-bars');
                icon.classList.remove('fa-times');
            }
        }
    });
}

// Conversion event tracking — phone, WhatsApp and email link clicks.
// window.gtag only exists after analytics consent (see cookies.js), so for
// users who rejected cookies this is a silent no-op.
document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link || typeof window.gtag !== 'function') return;
    const href = link.getAttribute('href');
    let eventName = null;
    if (href.startsWith('tel:')) eventName = 'phone_click';
    else if (href.indexOf('wa.me/') !== -1) eventName = 'whatsapp_click';
    else if (href.startsWith('mailto:')) eventName = 'email_click';
    if (eventName) {
        window.gtag('event', eventName, {
            link_location: link.className || 'unstyled',
            page_path: location.pathname
        });
    }
});

// FAQ accordion (for pages with .faq-item elements)
document.addEventListener('DOMContentLoaded', () => {
    const faqQuestions = document.querySelectorAll('.faq-item .faq-question');
    faqQuestions.forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            if (!item) return;
            const wasActive = item.classList.contains('active');
            // Close all
            document.querySelectorAll('.faq-item.active').forEach(a => {
                a.classList.remove('active');
                const q = a.querySelector('.faq-question');
                if (q) q.setAttribute('aria-expanded', 'false');
            });
            // Toggle clicked
            if (!wasActive) {
                item.classList.add('active');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
});

// Service Worker registration — PWA / offline shell
// Registered after load so it never competes with LCP.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Silently ignore — SW is a progressive enhancement
        });
    });
}

// Animated stat counters (e.g. reviews page: 1000+, 5.0, 90%, 150+)
const initStatCounters = () => {
    const counters = document.querySelectorAll('.stat-number[data-target]');
    if (counters.length === 0) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const format = (value, isDecimal, suffix) =>
        (isDecimal ? value.toFixed(1) : Math.round(value).toLocaleString()) + suffix;

    const animate = (el) => {
        const target = parseFloat(el.dataset.target);
        if (Number.isNaN(target)) return;
        const suffix = el.dataset.suffix || '';
        const isDecimal = el.dataset.decimal === 'true';

        if (reduceMotion) {
            el.textContent = format(target, isDecimal, suffix);
            return;
        }

        const duration = 1500;
        const start = performance.now();
        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = format(target * eased, isDecimal, suffix);
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    const triggered = new WeakSet();
    const fire = (el) => {
        if (triggered.has(el)) return;
        triggered.add(el);
        animate(el);
    };

    const inViewport = (el) => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        return rect.top < vh && rect.bottom > 0;
    };

    // Wait one frame so deferred CSS has settled before measuring positions,
    // then fire any counter already in view. iOS Safari has historically
    // been unreliable about firing IntersectionObserver for already-visible
    // elements, so this is the primary trigger.
    requestAnimationFrame(() => {
        counters.forEach(c => { if (inViewport(c)) fire(c); });
    });

    // For anything still below the fold, observe and fire on first pixel of intersection.
    if ('IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    fire(entry.target);
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0 });
        counters.forEach(c => obs.observe(c));
    } else {
        // No IO support — fall back to a scroll listener.
        const onScroll = () => {
            counters.forEach(c => { if (!triggered.has(c) && inViewport(c)) fire(c); });
            if ([...counters].every(c => triggered.has(c))) {
                window.removeEventListener('scroll', onScroll);
            }
        };
        window.addEventListener('scroll', onScroll, { passive: true });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStatCounters);
} else {
    initStatCounters();
}

// Mobile scroll nudge (for pages with horizontal-scrolling grids)
// Use matchMedia instead of innerWidth to avoid forced reflow
if (window.matchMedia('(max-width: 767px)').matches) {
    document.addEventListener('DOMContentLoaded', () => {
        const scrollGrids = document.querySelectorAll('[data-scroll-nudge]');
        if (scrollGrids.length === 0) return;

        const nudgeObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    setTimeout(() => {
                        target.scrollBy({ left: 50, behavior: 'smooth' });
                        setTimeout(() => {
                            target.scrollBy({ left: -50, behavior: 'smooth' });
                        }, 800);
                    }, 500);
                    nudgeObserver.unobserve(target);
                }
            });
        }, { threshold: 0.6 });

        scrollGrids.forEach(grid => nudgeObserver.observe(grid));
    });
}

// Empty touchstart listener so iOS Safari applies :active pressed states
document.addEventListener('touchstart', function () {}, { passive: true });

// Floating accent dots inside the homepage hero and the grid-background
// page headers. Deferred until idle so spawning never competes with LCP;
// skipped entirely under prefers-reduced-motion.
(function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var interval = null;
    var targets = [];

    function spawn() {
        targets.forEach(function (target) {
            var el = document.createElement('div');
            var size = Math.random() * 2 + 3;
            el.className = 'float-dot';
            el.style.width = size + 'px';
            el.style.height = size + 'px';
            el.style.left = (Math.random() * 100) + '%';
            target.appendChild(el);
            setTimeout(function () { if (el.parentNode) el.remove(); }, 8000);
        });
    }

    function start() {
        if (!interval && targets.length) interval = setInterval(spawn, 150);
    }
    function stop() {
        if (interval) { clearInterval(interval); interval = null; }
    }

    function init() {
        targets = [].slice.call(document.querySelectorAll('.hero, .page-header'));
        if (!targets.length) return;
        start();
        document.addEventListener('visibilitychange', function () {
            document.hidden ? stop() : start();
        });
    }

    if ('requestIdleCallback' in window) {
        requestIdleCallback(init, { timeout: 3000 });
    } else {
        setTimeout(init, 2000);
    }
})();
