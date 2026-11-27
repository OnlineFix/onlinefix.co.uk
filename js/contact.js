/* Contact page only: sends the enquiry form to WhatsApp or email. Moved out
   of an inline <script> so the site can drop 'unsafe-inline' from its
   Content-Security-Policy. */

(function () {
    var form = document.getElementById('contact-form');
    if (!form) return;
    function val(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }
    function composeMessage() {
        return 'New repair enquiry (onlinefix.co.uk)\n'
            + 'Name: ' + val('name') + '\n'
            + 'Phone: ' + val('phone') + '\n'
            + (val('email') ? 'Email: ' + val('email') + '\n' : '')
            + 'Device: ' + val('device') + '\n'
            + 'Urgency: ' + val('urgency') + '\n'
            + 'Issue: ' + val('issue');
    }
    function trackSubmit(method) {
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'contact_form_submit', { method: method });
        }
    }
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.reportValidity()) return;
        trackSubmit('whatsapp');
        window.open('https://wa.me/447940730537?text=' + encodeURIComponent(composeMessage()), '_blank', 'noopener');
    });
    var emailBtn = document.getElementById('form-email-btn');
    if (emailBtn) {
        emailBtn.addEventListener('click', function () {
            if (!form.reportValidity()) return;
            trackSubmit('email');
            window.location.href = 'mailto:hello@onlinefix.uk?subject='
                + encodeURIComponent('Repair enquiry - ' + (val('device') || 'device'))
                + '&body=' + encodeURIComponent(composeMessage());
        });
    }
})();
