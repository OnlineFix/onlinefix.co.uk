---
name: verify
description: How to run and visually verify this static site locally
---

# Verifying onlinefix.co.uk changes

Static HTML site, no build step. CSS lives in `css/core.css` / `css/icons.css`;
pages load the **minified** copies (`css/*.min.css?v=YYYYMMDD`).

## After editing CSS

1. Regenerate minified files: `node scripts/minify-css.mjs`
2. Bump the `?v=` cache-buster on `core.min.css`/`icons.min.css` in **all**
   `*.html` and `*/*.html` files AND in `sw.js` (`SHELL_URLS`), and bump
   `SW_VERSION` in `sw.js` — otherwise repeat visitors keep the stale cached CSS.

## Run + screenshot

```bash
python3 -m http.server 8931 &          # repo root; no build needed
```

Drive with Playwright using the pre-installed Chromium
(`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`,
install `playwright-core` in the scratchpad, not the repo).

## Gotchas

- Stylesheets load deferred (`media="print" onload="this.media='all'"`) —
  wait ~1s after `load` before reading computed styles or screenshotting.
- `.fade-in` content is invisible until scrolled into view (IntersectionObserver);
  `scrollIntoView` + ~800ms wait before screenshots.
- On mobile widths the whole `.cta-section` is `display: none`
  (`body:has(.mobile-contact-bar) .cta-section`) — the fixed quick-contact
  bar replaces it. Don't chase "missing" CTA on phones.
- Font Awesome glyphs come from cdnjs and don't load in the sandbox — icon
  boxes render empty. Check computed styles instead of pixels for icon links.
- Footer LINKS column is `.footer-column:nth-child(2)`; it splits into two
  columns on mobile (nth-child rule) and desktop (`.footer-links--two-col`).
