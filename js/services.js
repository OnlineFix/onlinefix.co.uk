/* Services page only. Moved out of an inline <script> so the site can drop
   'unsafe-inline' from its Content-Security-Policy. Loaded without defer, at
   the end of the page as before, so the lists collapse before first paint
   where possible. */

// Feature lists ship expanded in the markup (crawlers and no-JS users
// see everything); on small screens they collapse behind the
// "What we fix" toggle to keep cards compact.
(function () {
    if (window.matchMedia('(max-width: 768px)').matches) {
        document.querySelectorAll('.service-features-wrap[open]').forEach(function (d) {
            d.removeAttribute('open');
        });
    }
})();
