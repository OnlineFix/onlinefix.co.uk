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

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.addEventListener('DOMContentLoaded', () => {
    const fadeElements = document.querySelectorAll('.fade-in');
    fadeElements.forEach(el => observer.observe(el));
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

// PWA install prompt — surface an "Install app" button when the browser offers one.
// Buttons with [data-install-app] opt in to this behaviour; if none exist, we do nothing.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.querySelectorAll('[data-install-app]').forEach((btn) => {
        btn.hidden = false;
        btn.setAttribute('aria-hidden', 'false');
    });
});

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-install-app]');
    if (!btn || !deferredInstallPrompt) return;
    e.preventDefault();
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
        deferredInstallPrompt = null;
        document.querySelectorAll('[data-install-app]').forEach((b) => { b.hidden = true; });
    });
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.querySelectorAll('[data-install-app]').forEach((b) => { b.hidden = true; });
});

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
