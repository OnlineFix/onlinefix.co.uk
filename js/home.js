/* Homepage only: floating particles on the service tiles. Moved out of an
   inline <script> so the site can drop 'unsafe-inline' from its
   Content-Security-Policy. */

// Hover-triggered floating particles inside .service-card tiles
(function() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    function attach(card) {
        var interval = null;
        function spawn() {
            var el = document.createElement('div');
            var size = Math.random() * 2 + 3;
            el.style.cssText = 'position:absolute;width:' + size + 'px;height:' + size + 'px;background:#0033FF;pointer-events:none;animation:float-up-card 2.6s linear forwards;left:' + (Math.random() * 100) + '%;top:100%;z-index:0;opacity:0.7;will-change:transform,opacity';
            card.appendChild(el);
            setTimeout(function() { if (el.parentNode) el.remove(); }, 2600);
        }
        card.addEventListener('mouseenter', function() {
            if (!interval) { spawn(); interval = setInterval(spawn, 220); }
        });
        card.addEventListener('mouseleave', function() {
            if (interval) { clearInterval(interval); interval = null; }
        });
    }

    function init() {
        document.querySelectorAll('.services-grid .service-card').forEach(attach);
    }

    if ('requestIdleCallback' in window) {
        requestIdleCallback(init, { timeout: 3000 });
    } else {
        setTimeout(init, 1500);
    }
})();
