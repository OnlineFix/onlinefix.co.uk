/* =====================================================================
   OnlineFix — the look of the emails the site sends
   ---------------------------------------------------------------------
   Draws the HTML part of every email queued in the Firestore `mail`
   collection (the "Trigger Email" extension sends them). It copies the
   site's own design (css/core.css): a concrete page with a faint grid, a
   white card with a 2px black border, the blue gradient ONLINEFIX
   wordmark, a black footer with a gradient band and a hazard stripe,
   square corners, Helvetica with Courier New for labels.

   Mail apps are far pickier than browsers, so everything is tables with
   inline styles, one column, and nothing that needs the <style> block:
   Gmail often throws that away, and the email must still look right. It
   is also drawn phone first and reads the same at 320px.

   Safety: every helper escapes every value it is given. A plain string is
   always treated as text; only markup made by this file (which a caller
   cannot make by hand) goes in as HTML. So a name, model or fault typed by
   a customer can never add markup to an email. Links must be http(s),
   mailto or tel, or the helper throws.

   Shared by the intake page (new-repair/intake.js) and the dashboard
   (admin/index.html); each builds its own emails, with its own words, out
   of these pieces. Kept in /new-repair/ with the other shared files: that
   folder is never cached stale (see _headers and sw.js), which /js/ is.
   Loaded by a plain <script> tag (sets window.OnlineFixEmail) or by
   require() in tests. No dependencies, plain ES5.
   ===================================================================== */

(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.OnlineFixEmail = api;
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // ------------------------------------------------------------------
    // Colours and fonts (css/core.css "INDUSTRIAL BRUTALISM v2.5")
    // ------------------------------------------------------------------
    var C = Object.freeze({
        blue: '#0033FF',       // buttons, links, key facts
        cyan: '#00C6FF',       // gradient end; the only blue readable on black
        black: '#111111',
        concrete: '#F2F2F2',
        white: '#FFFFFF',
        grid: '#DCDCDC',
        grey: '#555555',       // labels and notes (7.5:1 on white, 6.7:1 on concrete)
        footText: '#CCCCCC'    // footer text (11.8:1 on black)
    });
    var GRADIENT = 'linear-gradient(135deg,#0033FF 0%,#00C6FF 100%)';
    var SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
    var MONO = "'Courier New',Courier,monospace";
    var TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

    // ------------------------------------------------------------------
    // Escaping
    // ------------------------------------------------------------------
    function escapeHTML(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // Markup made by this file. Not exported, so a caller cannot wrap a
    // string of its own in it to skip the escaping.
    function Html(markup) { this.markup = markup; }

    function trusted(markup) { return new Html(markup); }

    function isHtml(value) { return value instanceof Html; }

    // Anything -> HTML. Helpers' output goes in as it is, arrays are joined,
    // everything else is escaped. null, undefined and false give ''.
    function h(value) {
        if (value === null || value === undefined || value === false) return '';
        if (value instanceof Html) return value.markup;
        if (Object.prototype.toString.call(value) === '[object Array]') {
            var out = '';
            for (var i = 0; i < value.length; i++) out += h(value[i]);
            return out;
        }
        return escapeHTML(value);
    }

    // Only web, mail and phone links. Anything else (javascript:, data:, a
    // relative path, a malformed phone number) is a bug in the caller, so
    // this throws rather than send a dead or dangerous button; the caller
    // then reports that the email could not be drawn.
    function href(url) {
        var s = String(url === null || url === undefined ? '' : url).replace(/^\s+|\s+$/g, '');
        if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:\+?[0-9]{6,15})$/i.test(s)) {
            throw new Error('OnlineFixEmail: refused link "' + s.slice(0, 60) + '"');
        }
        return escapeHTML(s);
    }

    // ------------------------------------------------------------------
    // Inline pieces
    // ------------------------------------------------------------------
    function join() {
        return trusted(h(Array.prototype.slice.call(arguments)));
    }

    function br() { return trusted('<br>'); }

    function strong(content) {
        return trusted('<strong style="font-weight:700;">' + h(content) + '</strong>');
    }

    // opts: color, underline (default true), bold (default true), breakAll
    // (long URLs shown as text), tap (a 26px tall hit area, for the footer).
    function link(url, content, opts) {
        opts = opts || {};
        var style = 'color:' + (opts.color || C.blue) + ';' +
            'text-decoration:' + (opts.underline === false ? 'none' : 'underline') + ';' +
            'font-weight:' + (opts.bold === false ? '400' : '700') + ';' +
            (opts.breakAll ? 'word-break:break-all;' : 'word-break:break-word;') +
            (opts.tap ? 'display:inline-block;padding:5px 0;line-height:16px;' : '');
        return trusted('<a href="' + href(url) + '" style="' + style + '">' + h(content === undefined ? url : content) + '</a>');
    }

    // ------------------------------------------------------------------
    // Blocks. Each carries its own space underneath (opts.gap, in px):
    // mail apps ignore margins in too many places to rely on them.
    // ------------------------------------------------------------------
    function textStyle(o) {
        var size = o.size || (o.mono ? 14 : 16);
        var lineHeight = o.lineHeight || Math.round(size * 1.6);
        return 'font-family:' + (o.mono ? MONO : SANS) + ';font-size:' + size + 'px;line-height:' + lineHeight + 'px;' +
            'mso-line-height-rule:exactly;font-weight:' + (o.bold ? '700' : '400') + ';' +
            'color:' + (o.muted ? C.grey : C.black) + ';';
    }

    // opts: muted, mono, bold, size, lineHeight, gap (default 16)
    function paragraph(content, opts) {
        opts = opts || {};
        var gap = opts.gap === undefined ? 16 : opts.gap;
        return trusted('<p' + (opts.mono ? ' class="of-mono"' : '') + ' style="margin:0 0 ' + gap + 'px;' +
            textStyle(opts) + 'word-break:break-word;">' + h(content) + '</p>');
    }

    // Small print, like the site's .confirmation-note.
    function note(content, opts) {
        opts = opts || {};
        return paragraph(content, { mono: true, muted: true, size: 14, lineHeight: 22, gap: opts.gap === undefined ? 16 : opts.gap });
    }

    // Black label chip, like the site's page subtitle. One per email at most.
    // A "//" in the text is decoration, hidden from screen readers as in
    // subheading().
    function chip(text) {
        var inner = h(text);
        if (typeof text === 'string') {
            var parts = text.split('//');
            inner = '';
            for (var i = 0; i < parts.length; i++) inner += (i ? '<span aria-hidden="true">//</span>' : '') + escapeHTML(parts[i]);
        }
        return trusted(
            '<table ' + TABLE + ' style="border-collapse:collapse;"><tr>' +
            '<td class="of-mono" bgcolor="' + C.black + '" style="background-color:' + C.black + ';padding:5px 8px;font-family:' + MONO + ';' +
            'font-size:13px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:1px;' +
            'text-transform:uppercase;color:' + C.white + ';">' + inner + '</td></tr></table>' +
            spacerMarkup(14)
        );
    }

    // The email's one H1. opts.accent: a part of the text to show in blue.
    // opts.size in px (default 30). Capitals come from CSS, so the words
    // themselves stay as written (and the text part matches).
    function heading(text, opts) {
        opts = opts || {};
        var size = opts.size || 30;
        var s = String(text === null || text === undefined ? '' : text);
        var inner = escapeHTML(s);
        var at = opts.accent ? s.indexOf(opts.accent) : -1;
        if (at !== -1) {
            inner = escapeHTML(s.slice(0, at)) +
                '<span style="color:' + C.blue + ';">' + escapeHTML(opts.accent) + '</span>' +
                escapeHTML(s.slice(at + opts.accent.length));
        }
        return trusted(
            '<h1 style="margin:0 0 ' + (opts.gap === undefined ? 18 : opts.gap) + 'px;font-family:' + SANS + ';font-size:' + size + 'px;' +
            'line-height:' + Math.round(size * 1.08) + 'px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-1px;' +
            'text-transform:uppercase;color:' + C.black + ';word-break:break-word;">' + inner + '</h1>'
        );
    }

    // H2 with the site's "// " in front (decoration, hidden from screen readers).
    function subheading(text) {
        return trusted(
            '<h2 style="margin:0 0 10px;font-family:' + SANS + ';font-size:18px;line-height:22px;mso-line-height-rule:exactly;' +
            'font-weight:700;letter-spacing:-0.5px;text-transform:uppercase;color:' + C.black + ';">' +
            '<span aria-hidden="true" style="color:' + C.blue + ';">//&nbsp;</span>' + h(text) + '</h2>'
        );
    }

    // A list with small blue square bullets. Empty items are skipped.
    function list(items, opts) {
        opts = opts || {};
        var rows = '';
        for (var i = 0; i < items.length; i++) {
            if (!items[i]) continue;
            rows += '<tr>' +
                '<td valign="top" width="20" style="width:20px;padding:9px 0 0;">' +
                '<table ' + TABLE + '><tr><td width="8" height="8" bgcolor="' + C.blue + '" style="width:8px;height:8px;' +
                'font-size:0;line-height:0;background-color:' + C.blue + ';">&nbsp;</td></tr></table></td>' +
                '<td valign="top" style="padding:0 0 12px;' + textStyle({}) + 'word-break:break-word;">' + h(items[i]) + '</td>' +
                '</tr>';
        }
        return trusted('<table ' + TABLE + ' width="100%" style="width:100%;">' + rows + '</table>' +
            spacerMarkup(opts.gap === undefined ? 12 : opts.gap));
    }

    function spacerMarkup(px) {
        if (!px) return '';
        return '<table ' + TABLE + ' width="100%"><tr><td height="' + px + '" style="height:' + px + 'px;font-size:0;' +
            'line-height:' + px + 'px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>';
    }

    function spacer(px) { return trusted(spacerMarkup(px)); }

    // ------------------------------------------------------------------
    // Detail rows (like the review step of the booking page): a small grey
    // label over its value, rows split by a grey rule. A falsy row is
    // skipped, so a caller can write `cond && row(...)`.
    //   opts.kind: 'text' (default), 'strong', or 'ref' (blue Courier, for
    //   references; long ones such as REP_ + 16 characters are set smaller,
    //   with no letter-spacing, so they fit one line on a 320px phone).
    // ------------------------------------------------------------------
    function row(label, value, opts) {
        opts = opts || {};
        return { label: label, value: value, kind: opts.kind || 'text' };
    }

    var VALUE_STYLES = {
        text: 'font-family:' + SANS + ';font-size:16px;line-height:24px;font-weight:400;color:' + C.black + ';',
        strong: 'font-family:' + SANS + ';font-size:18px;line-height:24px;font-weight:700;color:' + C.black + ';',
        ref: 'font-family:' + MONO + ';font-size:26px;line-height:30px;font-weight:700;letter-spacing:3px;color:' + C.blue + ';',
        refLong: 'font-family:' + MONO + ';font-size:17px;line-height:24px;font-weight:700;letter-spacing:0;color:' + C.blue + ';'
    };

    function rowsMarkup(rows, bg) {
        var clean = [];
        for (var i = 0; i < rows.length; i++) if (rows[i]) clean.push(rows[i]);
        var out = '';
        for (var j = 0; j < clean.length; j++) {
            var r = clean[j];
            var kind = r.kind === 'ref' && !isHtml(r.value) && String(r.value).length > 12 ? 'refLong' : r.kind;
            var mono = kind === 'ref' || kind === 'refLong';
            out += '<tr><td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:14px 16px 15px;' +
                (j === clean.length - 1 ? '' : 'border-bottom:1px solid ' + C.grid + ';') + '">' +
                '<div class="of-mono" style="font-family:' + MONO + ';font-size:13px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;' +
                'letter-spacing:1px;text-transform:uppercase;color:' + C.grey + ';padding:0 0 5px;">' + h(r.label) + '</div>' +
                '<div' + (mono ? ' class="of-mono"' : '') + ' style="' + (VALUE_STYLES[kind] || VALUE_STYLES.text) +
                'mso-line-height-rule:exactly;word-break:break-word;overflow-wrap:anywhere;">' + h(r.value) + '</div>' +
                '</td></tr>';
        }
        return out;
    }

    // A plain detail box: concrete fill, 2px black border.
    function details(rows, opts) {
        opts = opts || {};
        return trusted(
            '<table ' + TABLE + ' width="100%" style="width:100%;border:2px solid ' + C.black + ';border-collapse:separate;">' +
            rowsMarkup(rows, C.concrete) + '</table>' + spacerMarkup(opts.gap === undefined ? 24 : opts.gap)
        );
    }

    // The key facts as one white card with the site's hard 6px shadow. The
    // shadow is built from table cells, because mail apps drop box-shadow.
    function factCard(rows, opts) {
        opts = opts || {};
        var S = 6;
        var px = 'font-size:0;line-height:0;mso-line-height-rule:exactly;';
        var card = '<table ' + TABLE + ' width="100%" style="width:100%;border-collapse:separate;">' +
            rowsMarkup(rows, C.white) + '</table>';
        return trusted(
            '<table ' + TABLE + ' width="100%" style="width:100%;border-collapse:collapse;">' +
            // Row 1: the card, then a black column with a white notch on top.
            '<tr>' +
            '<td valign="top" bgcolor="' + C.white + '" style="background-color:' + C.white + ';border:2px solid ' + C.black + ';">' + card + '</td>' +
            '<td width="' + S + '" valign="top" bgcolor="' + C.black + '" style="width:' + S + 'px;min-width:' + S + 'px;background-color:' + C.black + ';' + px + '">' +
            '<table ' + TABLE + ' width="' + S + '"><tr><td width="' + S + '" height="' + S + '" bgcolor="' + C.white + '" style="width:' + S + 'px;height:' + S + 'px;background-color:' + C.white + ';' + px + '">&nbsp;</td></tr></table>' +
            '</td>' +
            '</tr>' +
            // Row 2: the bottom edge, notched on the left.
            '<tr>' +
            '<td height="' + S + '" style="height:' + S + 'px;padding:0 0 0 ' + S + 'px;' + px + '">' +
            '<table ' + TABLE + ' width="100%"><tr><td height="' + S + '" bgcolor="' + C.black + '" style="height:' + S + 'px;background-color:' + C.black + ';' + px + '">&nbsp;</td></tr></table>' +
            '</td>' +
            '<td width="' + S + '" height="' + S + '" bgcolor="' + C.black + '" style="width:' + S + 'px;height:' + S + 'px;background-color:' + C.black + ';' + px + '">&nbsp;</td>' +
            '</tr></table>' + spacerMarkup(opts.gap === undefined ? 24 : opts.gap)
        );
    }

    // A date over a big blue time, as the value of a fact card row.
    function when(dateText, timeText) {
        return trusted(
            '<div style="font-family:' + SANS + ';font-size:22px;line-height:28px;mso-line-height-rule:exactly;font-weight:700;color:' + C.black + ';">' + h(dateText) + '</div>' +
            '<div style="font-family:' + SANS + ';font-size:44px;line-height:48px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-1px;color:' + C.blue + ';">' + h(timeText) + '</div>'
        );
    }

    // A full-width square button, about 60px tall. opts.variant: 'primary'
    // (solid blue, white text, 7.2:1) or 'secondary' (white, black text).
    // Solid blue rather than the gradient: white text on its cyan end is
    // only 2.0:1. mso-padding-alt gives Outlook the same height.
    function button(url, label, opts) {
        opts = opts || {};
        var primary = opts.variant !== 'secondary';
        var bg = primary ? C.blue : C.white;
        var fg = primary ? C.white : C.black;
        return trusted(
            '<table ' + TABLE + ' width="100%" style="width:100%;border-collapse:separate;"><tr>' +
            '<td align="center" bgcolor="' + bg + '" style="background-color:' + bg + ';border:2px solid ' + C.black + ';mso-padding-alt:18px 16px;">' +
            '<a href="' + href(url) + '" style="display:block;padding:18px 16px;font-family:' + SANS + ';font-size:17px;line-height:20px;' +
            'mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;text-align:center;' +
            'color:' + fg + ';text-decoration:none;">' + h(label) + '</a>' +
            '</td></tr></table>' + spacerMarkup(opts.gap === undefined ? 24 : opts.gap)
        );
    }

    // ------------------------------------------------------------------
    // Footer (like the site's: gradient band, black block, light Courier)
    // ------------------------------------------------------------------

    // shop: {name, address, phone, email}. Gives the two footer lines the
    // emails have always had, "OnlineFix · address" and "phone · email",
    // with the phone and email as links (otherwise mail apps link them
    // themselves, in a blue that cannot be read on black). extra: more
    // lines underneath.
    function shopFooter(shop, extra) {
        var lines = [
            join(trusted('<span class="of-sans" style="font-family:' + SANS + ';font-weight:700;letter-spacing:-0.5px;text-transform:uppercase;color:' + C.cyan + ';">' +
                escapeHTML(shop.name || 'OnlineFix') + '</span>'), ' \u00b7 ', keepPostcode(shop.address)),
            join(link(telHref(shop.phone), shop.phone, { color: C.footText, bold: false, underline: false, tap: true }), ' \u00b7 ',
                link('mailto:' + shop.email, shop.email, { color: C.footText, bold: false, tap: true }))
        ];
        return lines.concat(extra || []);
    }

    function footerMarkup(lines) {
        var body = '';
        for (var i = 0; i < lines.length; i++) body += (i ? '<br>' : '') + h(lines[i]);
        return '<tr><td height="10" bgcolor="' + C.blue + '" style="height:10px;font-size:0;line-height:10px;mso-line-height-rule:exactly;' +
            'background-color:' + C.blue + ';background-image:linear-gradient(90deg,#0033FF 0%,#00C6FF 100%);">&nbsp;</td></tr>' +
            '<tr><td class="of-pad of-mono" bgcolor="' + C.black + '" style="background-color:' + C.black + ';padding:22px 20px 24px;' +
            'font-family:' + MONO + ';font-size:14px;line-height:26px;mso-line-height-rule:exactly;color:' + C.footText + ';word-break:break-word;">' +
            body + '</td></tr>' +
            // Hazard stripe. Where repeating gradients are not supported
            // (Gmail, Outlook) it is a plain black strip under the footer.
            '<tr><td height="10" bgcolor="' + C.black + '" style="height:10px;font-size:0;line-height:10px;mso-line-height-rule:exactly;' +
            'background-color:' + C.black + ';background-image:repeating-linear-gradient(135deg,#111111 0,#111111 7px,#FFFFFF 7px,#FFFFFF 14px);">&nbsp;</td></tr>';
    }

    // ------------------------------------------------------------------
    // The whole email
    // ------------------------------------------------------------------

    // Filler after the preview text, so the inbox preview stops there
    // rather than running on into the header.
    var PREHEADER_FILL = new Array(40).join('&#847;&zwnj;&nbsp;');

    // opts:
    //   subject      the <title> and the screen-reader label (required)
    //   preheader    inbox preview text (optional)
    //   headerLabel  shown right of the wordmark (none of the site's emails
    //                use it: the owner asked for the reference to show only
    //                in the body, where every email already has it)
    //   body         helper output, or an array of it
    //   footer       footer lines (see shopFooter)
    function layout(opts) {
        opts = opts || {};
        var subject = String(opts.subject || '');
        var pre = opts.preheader ?
            '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:' + C.concrete + ';">' +
            escapeHTML(opts.preheader) + PREHEADER_FILL + '</div>' : '';

        // Like the site's top bar: the gradient wordmark block with a black
        // edge, then white. A label there would repeat what is in the email
        // body, so screen readers skip it.
        var header =
            '<tr><td style="border-bottom:2px solid ' + C.black + ';">' +
            '<table ' + TABLE + ' width="100%" style="width:100%;"><tr>' +
            '<td bgcolor="' + C.blue + '" valign="middle" style="background-color:' + C.blue + ';background-image:' + GRADIENT + ';' +
            'border-right:2px solid ' + C.black + ';padding:17px 16px 16px;white-space:nowrap;width:1%;">' +
            '<span style="font-family:' + SANS + ';font-size:22px;line-height:24px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-1px;' +
            'text-transform:uppercase;color:' + C.white + ';">OnlineFix</span>' +
            '<span aria-hidden="true" style="font-family:Arial,sans-serif;font-size:9px;line-height:9px;font-weight:700;color:' + C.white + ';vertical-align:top;">&trade;</span>' +
            '</td>' +
            '<td class="of-mono" bgcolor="' + C.white + '" align="right" valign="middle" style="background-color:' + C.white + ';padding:8px 14px 8px 10px;' +
            'font-family:' + MONO + ';font-size:13px;line-height:18px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.5px;' +
            'text-transform:uppercase;color:' + C.black + ';word-break:break-all;">' +
            (opts.headerLabel ? '<span aria-hidden="true">' + h(opts.headerLabel) + '</span>' : '&nbsp;') +
            '</td></tr></table></td></tr>';

        var body = '<tr><td class="of-pad" bgcolor="' + C.white + '" style="background-color:' + C.white + ';padding:26px 20px 10px;">' +
            h(opts.body) + '</td></tr>';

        return '<!doctype html>\n' +
            '<html lang="en-GB" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
            '<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
            '<meta name="x-apple-disable-message-reformatting">\n' +
            // Light only: Apple Mail keeps it as designed. Apps that force a
            // dark mode anyway (Gmail, Outlook) get black, white and blue,
            // which still read when they are inverted.
            '<meta name="color-scheme" content="light only">\n<meta name="supported-color-schemes" content="light only">\n' +
            '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">\n' +
            '<title>' + escapeHTML(subject) + '</title>\n' +
            '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->\n' +
            // Outlook for Windows does not walk a font list and would fall
            // back to Times New Roman: give it Arial, and Courier New for
            // the labels (.of-mono).
            '<!--[if mso]><style>body,table,td,p,a,span,div,h1,h2{font-family:Arial,sans-serif !important;}' +
            '.of-mono,.of-mono span,.of-mono a{font-family:\'Courier New\',Courier,monospace !important;}' +
            '.of-mono .of-sans{font-family:Arial,sans-serif !important;}</style><![endif]-->\n' +
            // Two blocks: a mail app that throws one away may keep the
            // other. Neither is needed for the email to look right.
            '<style>\n' +
            ':root{color-scheme:light only;supported-color-schemes:light only;}\n' +
            'a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important;}\n' +
            '</style>\n' +
            '<style>\n' +
            'body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}\n' +
            '@media only screen and (min-width:560px){.of-pad{padding-left:32px !important;padding-right:32px !important;}.of-outer{padding:32px 16px !important;}}\n' +
            '</style>\n</head>\n' +
            '<body style="margin:0;padding:0;background-color:' + C.concrete + ';" bgcolor="' + C.concrete + '">\n' +
            '<div role="article" aria-roledescription="email" aria-label="' + escapeHTML(subject) + '" lang="en-GB" dir="ltr" ' +
            'style="background-color:' + C.concrete + ';background-image:linear-gradient(' + C.grid + ' 1px,transparent 1px),linear-gradient(90deg,' + C.grid + ' 1px,transparent 1px);background-size:40px 40px;">\n' +
            pre +
            '<table ' + TABLE + ' width="100%" style="width:100%;"><tr><td class="of-outer" align="center" style="padding:16px 10px 24px;">\n' +
            '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n' +
            '<table ' + TABLE + ' width="100%" bgcolor="' + C.white + '" style="width:100%;max-width:600px;background-color:' + C.white + ';border:2px solid ' + C.black + ';border-collapse:separate;">\n' +
            header + '\n' + body + '\n' + footerMarkup(opts.footer || []) + '\n' +
            '</table>\n' +
            '<!--[if mso]></td></tr></table><![endif]-->\n' +
            '</td></tr></table>\n</div>\n</body>\n</html>\n';
    }

    // ------------------------------------------------------------------
    // Data helpers
    // ------------------------------------------------------------------

    // A moment as a clock and calendar in the UK show it, whatever the
    // zone of the device doing the sending: {date, time, full}, e.g. date
    // "Friday 2 October", time "11:30", full "Friday 2 October at 11:30"
    // (the same shape as ukWhen in book/booking.js). Takes a Date, a
    // Firestore Timestamp or anything Date() takes; null if it is not a
    // real date.
    function ukWhen(value) {
        var d = value && typeof value.toDate === 'function' ? value.toDate() : (value instanceof Date ? value : (value ? new Date(value) : null));
        if (!d || isNaN(d.getTime())) return null;
        var p = {};
        var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(d);
        for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
        var date = p.weekday + ' ' + p.day + ' ' + p.month;
        var time = p.hour + ':' + p.minute;
        return { date: date, time: time, full: date + ' at ' + time };
    }

    // Google Maps search for an address (opens the Maps app on phones).
    function mapsUrl(address) {
        return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(address || ''));
    }

    // "07940 730537" -> "tel:+447940730537". Anything that is not plainly a
    // phone number gives '', which link() and button() refuse.
    function telHref(phone) {
        var s = String(phone === null || phone === undefined ? '' : phone).replace(/[^0-9+]/g, '');
        s = s.charAt(0) + s.slice(1).replace(/\+/g, '');
        if (/^00[0-9]/.test(s)) s = '+' + s.slice(2);
        else if (/^0[0-9]/.test(s)) s = '+44' + s.slice(1);
        return /^\+?[0-9]{6,15}$/.test(s) ? 'tel:' + s : '';
    }

    // Keeps a UK postcode on one line ("GU1 3UY"). For the HTML only; the
    // text part keeps an ordinary space.
    function keepPostcode(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/\b([A-Z]{1,2}[0-9][A-Z0-9]?) ([0-9][A-Z]{2})\b/g, '$1\u00a0$2');
    }

    return Object.freeze({
        colors: C,
        escapeHTML: escapeHTML,
        isHtml: isHtml,
        toHtml: function (value) { return h(value); },
        join: join,
        br: br,
        strong: strong,
        link: link,
        paragraph: paragraph,
        note: note,
        chip: chip,
        heading: heading,
        subheading: subheading,
        list: list,
        spacer: spacer,
        row: row,
        details: details,
        factCard: factCard,
        when: when,
        button: button,
        shopFooter: shopFooter,
        layout: layout,
        ukWhen: ukWhen,
        mapsUrl: mapsUrl,
        telHref: telHref,
        keepPostcode: keepPostcode
    });
});
