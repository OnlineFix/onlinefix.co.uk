// One-off helper page (/admin/seed-availability.html) that writes the
// availability/settings document. This code used to sit in a <script> block
// in the page; it lives here so the staff pages need no 'unsafe-inline'
// in their content policy.
        const firebaseConfig = {
            apiKey: "AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU",
            authDomain: "onlinefix-repair.firebaseapp.com",
            projectId: "onlinefix-repair",
            storageBucket: "onlinefix-repair.firebasestorage.app",
            messagingSenderId: "382934797751",
            appId: "1:382934797751:web:5ac8a9c87d68a17b4cec32"
        };

        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        const auth = firebase.auth();
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

        const $ = (id) => document.getElementById(id);

        function showStatus(message, kind) {
            const el = $('status');
            el.className = 'status show' + (kind ? ' ' + kind : '');
            el.textContent = message;
        }

        function clearStatus() {
            $('status').className = 'status';
            $('status').textContent = '';
        }

        // Must match DEFAULT_AVAILABILITY in book/booking.js: 7 days,
        // 10:00-22:00, last slot 21:30. If availability/settings exists, the
        // booking page uses it instead of its own defaults.
        const DEFAULTS = {
            workingHours: {
                mon: { open: '10:00', close: '22:00', closed: false },
                tue: { open: '10:00', close: '22:00', closed: false },
                wed: { open: '10:00', close: '22:00', closed: false },
                thu: { open: '10:00', close: '22:00', closed: false },
                fri: { open: '10:00', close: '22:00', closed: false },
                sat: { open: '10:00', close: '22:00', closed: false },
                sun: { open: '10:00', close: '22:00', closed: false }
            },
            blockedDates: [],
            minNoticeHours: 4,
            maxFutureDays: 60,
            slotIntervalMinutes: 30
        };

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try { await user.getIdToken(true); } catch (_) {}
                $('user-email').textContent = user.email || '(no email)';
                $('login-view').classList.add('hidden');
                $('auth-view').classList.remove('hidden');
            } else {
                $('login-view').classList.remove('hidden');
                $('auth-view').classList.add('hidden');
            }
        });

        $('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            clearStatus();
            $('login-btn').disabled = true;
            try {
                await auth.signInWithEmailAndPassword($('email').value, $('password').value);
            } catch (err) {
                // This page has no 6-digit code step. The dashboard does, and
                // its sign-in carries over here.
                if (err.code === 'auth/multi-factor-auth-required') {
                    showStatus('This account asks for a 6-digit login code. Sign in on the dashboard (/admin/) first, then reload this page.', 'warn');
                } else {
                    showStatus('Sign-in failed: ' + err.message, 'err');
                }
            } finally {
                $('login-btn').disabled = false;
            }
        });

        $('signout-btn').addEventListener('click', async () => {
            await auth.signOut();
            clearStatus();
        });

        $('read-btn').addEventListener('click', async () => {
            clearStatus();
            try {
                const snap = await db.collection('availability').doc('settings').get();
                if (!snap.exists) {
                    showStatus('Doc does not exist yet. Click "Write Defaults" to create it.', 'warn');
                    return;
                }
                const data = snap.data();
                showStatus('Current availability/settings:\n\n' + JSON.stringify(data, null, 2), 'ok');
            } catch (err) {
                showStatus('Read failed: ' + err.message, 'err');
            }
        });

        $('seed-btn').addEventListener('click', async () => {
            clearStatus();
            const overwrite = $('overwrite').checked;
            $('seed-btn').disabled = true;
            try {
                const ref = db.collection('availability').doc('settings');
                const snap = await ref.get();
                if (snap.exists && !overwrite) {
                    showStatus('Doc already exists. Tick "Overwrite" and click again to replace it, or click "Read Current Doc" to see what is there.', 'warn');
                    return;
                }
                const payload = Object.assign({}, DEFAULTS, {
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                await ref.set(payload);
                showStatus((snap.exists ? 'Overwrote' : 'Created') + ' availability/settings. You can close this page now.', 'ok');
            } catch (err) {
                showStatus('Write failed: ' + err.message + '\n\nCheck that the deployed Firestore rules include the availability/* match block, and that you are signed in with the admin account.', 'err');
            } finally {
                $('seed-btn').disabled = false;
            }
        });
