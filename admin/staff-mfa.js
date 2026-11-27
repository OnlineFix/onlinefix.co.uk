/* Six-digit login codes for the staff dashboard (fix 9 of the security plan).

   Once a staff account has a code app linked (Okta Verify, Google
   Authenticator or any other TOTP app), Firebase asks for the app's code
   after the password on every new sign-in, so a stolen password alone no
   longer opens the dashboard.

   The dashboard runs on Firebase's "compat" SDK, which has no TOTP class:
   Firebase ships TotpMultiFactorGenerator only in the modular SDK. So the
   modular build of the same version is loaded on demand, for that one
   class. Its objects work with the compat ones because compat is the same
   9.22.0 code underneath: compat's sign-in error carries a resolver,
   user.multiFactor is the modular MultiFactorUser, and both accept the
   assertions this class makes. Keep the version below equal to the one in
   the compat <script> tags when upgrading. */
(function () {
    'use strict';

    const MODULAR_AUTH = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
    const ISSUER = 'OnlineFix';
    const APP_NAME = 'Okta Verify';

    let generator = null;

    function loadGenerator() {
        if (!generator) {
            generator = import(MODULAR_AUTH).then((m) => m.TotpMultiFactorGenerator);
            // A failed download (offline, blocked) must not stick for the
            // rest of the session: the next try loads it again.
            generator.catch(() => { generator = null; });
        }
        return generator;
    }

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function cleanCode(raw) {
        return String(raw || '').replace(/\D/g, '');
    }

    function totpHint(resolver) {
        const hints = (resolver && resolver.hints) || [];
        return hints.find((hint) => hint.factorId === 'totp') || null;
    }

    function needsCode(error) {
        return !!error && error.code === 'auth/multi-factor-auth-required' && !!totpHint(error.resolver);
    }

    async function finishSignIn(resolver, code) {
        const hint = totpHint(resolver);
        if (!hint) throw Object.assign(new Error('No login code is linked to this account.'), { code: 'staff/no-totp' });
        const Totp = await loadGenerator();
        return resolver.resolveSignIn(Totp.assertionForSignIn(hint.uid, code));
    }

    function enrolledCodes(user) {
        const factors = (user && user.multiFactor && user.multiFactor.enrolledFactors) || [];
        return factors.filter((factor) => factor.factorId === 'totp');
    }

    /* The error code Google actually sent. A refusal answered to a call the
       modular file made (a wrong code, "sign in again") reaches us as
       auth/network-request-failed: that file checks errors against its own
       copy of Firebase's error class, the compat SDK built the error with
       another copy, so the check fails and the error is relabelled. The
       original stays in customData.message, e.g.
       "FirebaseError: Firebase: Error (auth/invalid-verification-code)." */
    function realCode(error) {
        const code = error && error.code;
        if (code === 'auth/network-request-failed') {
            const inner = /\((auth\/[a-z0-9-]+)\)/.exec(String((error.customData && error.customData.message) || ''));
            if (inner) return inner[1];
        }
        return code;
    }

    // The sign-in has to start again from the password: the few minutes
    // Firebase allows for typing the code have run out.
    function isExpired(error) {
        return ['auth/invalid-multi-factor-session', 'auth/missing-multi-factor-session',
            'auth/code-expired', 'auth/totp-challenge-timeout'].indexOf(realCode(error)) !== -1;
    }

    function describe(error) {
        if (!error) return '';
        if (isExpired(error)) return 'That took too long. Sign in again with your password.';
        switch (realCode(error)) {
            case 'auth/invalid-verification-code':
                return 'That code did not work. Type the newest code from the app. If it keeps failing, check the phone sets its clock automatically.';
            case 'auth/missing-verification-code':
                return 'Type the 6-digit code from the app.';
            case 'auth/too-many-requests':
                return 'Too many tries. Wait a few minutes, then try again.';
            case 'auth/network-request-failed':
                return 'No connection to Google. Check the internet and try again.';
            case 'auth/operation-not-allowed':
                return 'Login codes are not switched on in Firebase yet.';
            case 'auth/unverified-email':
                return 'Firebase needs the email address confirmed first. Close this window and open Login code again.';
            case 'auth/wrong-password':
            case 'auth/invalid-login-credentials':
            case 'auth/invalid-credential':
                return 'That password is not right.';
            case 'staff/no-totp':
                return error.message;
            default:
                break;
        }
        // import() failing has no Firebase code: the modular file did not load.
        if (!error.code) return 'Could not load the login-code check. Check the internet and try again.';
        return '';
    }

    // ------------------------------------------------------------------
    // Setup window, opened from "Login code" in the dashboard menu
    // ------------------------------------------------------------------

    function auth() {
        return firebase.auth();
    }

    function groupKey(key) {
        return String(key || '').replace(/(.{4})/g, '$1 ').trim();
    }

    function qrImage(uri) {
        // Type 0 picks the smallest size that fits; M survives a smudged screen.
        const qr = qrcode(0, 'M');
        qr.addData(uri);
        qr.make();
        return qr.createDataURL(5, 4);
    }

    function openSetup() {
        const user = auth().currentUser;
        if (!user || document.getElementById('mfa-modal')) return;

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'mfa-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'mfa-modal-title');
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 520px;">
                <div class="modal-header">
                    <h2 class="modal-title" id="mfa-modal-title">Login code</h2>
                    <button type="button" class="close-btn" data-mfa-close aria-label="Close">&times;</button>
                </div>
                <div id="mfa-body"></div>
                <div class="alert alert-error hidden" id="mfa-error" style="margin-top: 1rem;"></div>
            </div>`;
        document.body.appendChild(modal);
        // Not closed by a tap outside it, like the other dashboard windows:
        // halfway through linking the app that would throw the QR code away.
        modal.addEventListener('click', (e) => {
            if (!modal.dataset.busy && e.target.closest('[data-mfa-close]')) modal.remove();
        });

        const body = modal.querySelector('#mfa-body');
        const errorBox = modal.querySelector('#mfa-error');

        function showError(message) {
            errorBox.textContent = message;
            errorBox.classList.toggle('hidden', !message);
        }

        function busy(on) {
            if (on) modal.dataset.busy = '1';
            else delete modal.dataset.busy;
            modal.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
        }

        async function run(task) {
            showError('');
            busy(true);
            try {
                await task();
            } catch (error) {
                console.warn('Login code:', error);
                showError(describe(error) || error.message || String(error));
            } finally {
                if (modal.isConnected) busy(false);
            }
        }

        function show(html, focusSelector) {
            body.innerHTML = html;
            showError('');
            const focus = focusSelector && body.querySelector(focusSelector);
            if (focus) focus.focus();
        }

        // Linking or removing a code needs a fresh sign-in. Rather than
        // sending everyone back to the login screen, ask for the password
        // (and the current code, when one is linked) here, then carry on.
        async function withRecentLogin(task) {
            try {
                return await task();
            } catch (error) {
                if (realCode(error) !== 'auth/requires-recent-login') throw error;
                askPassword(task);
                return undefined;
            }
        }

        function askPassword(task) {
            show(`
                <p style="margin-bottom: 1rem;">For safety, type the dashboard password again.</p>
                <form id="mfa-password-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="mfa-password">Password</label>
                        <input type="password" class="form-input" id="mfa-password" autocomplete="current-password" required>
                    </div>
                    <div class="modal-actions">
                        <span class="modal-actions__spacer"></span>
                        <button type="button" class="btn btn-secondary" data-mfa-close>Cancel</button>
                        <button type="submit" class="btn btn-primary">Continue</button>
                    </div>
                </form>`, '#mfa-password');
            body.querySelector('#mfa-password-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const password = body.querySelector('#mfa-password').value;
                run(async () => {
                    const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
                    try {
                        await user.reauthenticateWithCredential(credential);
                    } catch (error) {
                        if (!needsCode(error)) throw error;
                        askCode(error.resolver, task);
                        return;
                    }
                    await task();
                });
            });
        }

        function askCode(resolver, task) {
            show(`
                <p style="margin-bottom: 1rem;">Type the 6-digit code from ${esc(APP_NAME)}.</p>
                <form id="mfa-recheck-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="mfa-recheck-code">6-digit code</label>
                        <input type="text" class="form-input" id="mfa-recheck-code" inputmode="numeric"
                            autocomplete="one-time-code" maxlength="7" placeholder="123456" required>
                    </div>
                    <div class="modal-actions">
                        <span class="modal-actions__spacer"></span>
                        <button type="button" class="btn btn-secondary" data-mfa-close>Cancel</button>
                        <button type="submit" class="btn btn-primary">Continue</button>
                    </div>
                </form>`, '#mfa-recheck-code');
            body.querySelector('#mfa-recheck-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const code = cleanCode(body.querySelector('#mfa-recheck-code').value);
                run(async () => {
                    if (code.length !== 6) throw Object.assign(new Error(), { code: 'auth/missing-verification-code' });
                    await finishSignIn(resolver, code);
                    await task();
                });
            });
        }

        function showStatus() {
            const linked = enrolledCodes(user);
            if (linked.length) {
                const factor = linked[0];
                const added = factor.enrollmentTime ? new Date(factor.enrollmentTime).toLocaleDateString('en-GB') : '';
                show(`
                    <p style="margin-bottom: 0.75rem;"><strong style="color: var(--success);">On.</strong>
                        Signing in asks for the 6-digit code from ${esc(factor.displayName || 'the code app')}${added ? ` (linked ${esc(added)})` : ''}.</p>
                    <p style="color: var(--text-muted); font-size: 0.9rem;">New phone? Remove the code here, then link it again on the new phone.</p>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" id="mfa-remove">Remove code</button>
                        <span class="modal-actions__spacer"></span>
                        <button type="button" class="btn btn-primary" data-mfa-close>Close</button>
                    </div>`);
                body.querySelector('#mfa-remove').addEventListener('click', () => confirmRemove(factor));
                return;
            }

            if (!user.emailVerified) {
                show(`
                    <p style="margin-bottom: 0.75rem;">Firebase links a login code only to a confirmed email address, and ${esc(user.email)} is not confirmed yet.</p>
                    <p style="color: var(--text-muted); font-size: 0.9rem;">Send the email, click the link in it, then sign out and back in and open Login code again.</p>
                    <div class="modal-actions">
                        <span class="modal-actions__spacer"></span>
                        <button type="button" class="btn btn-secondary" data-mfa-close>Close</button>
                        <button type="button" class="btn btn-primary" id="mfa-verify">Send confirmation email</button>
                    </div>`);
                body.querySelector('#mfa-verify').addEventListener('click', () => run(async () => {
                    await user.sendEmailVerification();
                    show(`
                        <p>Sent to ${esc(user.email)}. Click the link in it, then sign out and back in.</p>
                        <div class="modal-actions">
                            <span class="modal-actions__spacer"></span>
                            <button type="button" class="btn btn-primary" data-mfa-close>Close</button>
                        </div>`);
                }));
                return;
            }

            show(`
                <p style="margin-bottom: 0.75rem;">Add a 6-digit code to the dashboard sign-in. After the password, it asks for the code that ${esc(APP_NAME)} shows on your phone.</p>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Have your phone ready with ${esc(APP_NAME)} installed. Any authenticator app works too.</p>
                <div class="modal-actions">
                    <span class="modal-actions__spacer"></span>
                    <button type="button" class="btn btn-secondary" data-mfa-close>Cancel</button>
                    <button type="button" class="btn btn-primary" id="mfa-start">Start setup</button>
                </div>`);
            body.querySelector('#mfa-start').addEventListener('click', () => run(startLinking));
        }

        async function startLinking() {
            await withRecentLogin(async () => {
                const Totp = await loadGenerator();
                const session = await user.multiFactor.getSession();
                const secret = await Totp.generateSecret(session);
                showScan(secret);
            });
        }

        function showScan(secret) {
            const uri = secret.generateQrCodeUrl(encodeURIComponent(user.email), ISSUER);
            show(`
                <ol style="padding-left: 1.25rem; display: grid; gap: 0.9rem; margin-bottom: 1.25rem;">
                    <li>In ${esc(APP_NAME)}, tap <strong>+</strong>, choose <strong>Other</strong>, then <strong>Scan a QR code</strong>.</li>
                    <li>Scan this:
                        <div style="margin: 0.75rem 0;"><img src="${esc(qrImage(uri))}" alt="QR code to link ${esc(APP_NAME)}"
                            style="display: block; max-width: 100%; height: auto; border-radius: 8px;"></div>
                        Can't scan? Choose <strong>Enter key manually</strong>, with account name <strong>${esc(ISSUER)}</strong> and this key:
                        <div style="font-family: monospace; font-size: 1.05rem; letter-spacing: 0.05em; margin-top: 0.4rem; word-break: break-all;">${esc(groupKey(secret.secretKey))}</div>
                    </li>
                    <li>Save that key in a safe place, such as a password manager. If the phone is lost, it puts the code on a new phone. Anyone with the key can make codes, so keep it private.</li>
                    <li>Type the 6-digit code ${esc(APP_NAME)} now shows for ${esc(ISSUER)}:</li>
                </ol>
                <form id="mfa-link-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="mfa-link-code">6-digit code</label>
                        <input type="text" class="form-input" id="mfa-link-code" inputmode="numeric"
                            autocomplete="one-time-code" maxlength="7" placeholder="123456" required>
                    </div>
                    <div class="modal-actions">
                        <span class="modal-actions__spacer"></span>
                        <button type="button" class="btn btn-secondary" data-mfa-close>Cancel</button>
                        <button type="submit" class="btn btn-primary">Turn on</button>
                    </div>
                </form>`, '#mfa-link-code');
            body.querySelector('#mfa-link-form').addEventListener('submit', (e) => {
                e.preventDefault();
                const code = cleanCode(body.querySelector('#mfa-link-code').value);
                run(async () => {
                    if (code.length !== 6) throw Object.assign(new Error(), { code: 'auth/missing-verification-code' });
                    const Totp = await loadGenerator();
                    await user.multiFactor.enroll(Totp.assertionForEnrollment(secret, code), APP_NAME);
                    refreshLink();
                    show(`
                        <p style="margin-bottom: 0.75rem;"><strong style="color: var(--success);">Done.</strong>
                            From now on, signing in asks for the 6-digit code from ${esc(APP_NAME)}.</p>
                        <p style="color: var(--text-muted); font-size: 0.9rem;">Devices that are already signed in stay signed in until they sign out.</p>
                        <div class="modal-actions">
                            <span class="modal-actions__spacer"></span>
                            <button type="button" class="btn btn-primary" data-mfa-close>Close</button>
                        </div>`);
                });
            });
        }

        function confirmRemove(factor) {
            show(`
                <p style="margin-bottom: 0.75rem;">Remove the login code? Until you link one again, signing in only needs the password.</p>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Firebase signs this device out afterwards, so you sign in again with the password.</p>
                <div class="modal-actions">
                    <span class="modal-actions__spacer"></span>
                    <button type="button" class="btn btn-secondary" data-mfa-close>Keep it</button>
                    <button type="button" class="btn btn-danger" id="mfa-remove-yes">Remove code</button>
                </div>`);
            body.querySelector('#mfa-remove-yes').addEventListener('click', () => run(() => withRecentLogin(async () => {
                try {
                    await user.multiFactor.unenroll(factor);
                } catch (error) {
                    // Removing the factor ends this sign-in; that is the
                    // expected outcome, not a failure.
                    if (realCode(error) !== 'auth/user-token-expired') throw error;
                }
                show('<p>Removed. Reloading so you can sign in again…</p>');
                setTimeout(() => window.location.reload(), 1500);
            })));
        }

        showStatus();
    }

    // ------------------------------------------------------------------
    // "Login code" entry in the dashboard menu
    // ------------------------------------------------------------------

    function refreshLink() {
        const badge = document.getElementById('login-code-badge');
        if (!badge) return;
        const user = auth().currentUser;
        badge.classList.toggle('hidden', !user || enrolledCodes(user).length > 0);
    }

    function init() {
        const link = document.getElementById('login-code-link');
        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                openSetup();
            });
        }
        if (window.firebase && firebase.apps && firebase.apps.length) {
            auth().onAuthStateChanged(refreshLink);
        }
    }

    window.StaffMfa = { needsCode, finishSignIn, cleanCode, isExpired, describe, enrolledCodes, openSetup };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
