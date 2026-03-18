/**
 * supabase-client.js
 *
 * Supabase integration: auth (magic-link), profiles, and leaderboard.
 *
 * REQUIRES (loaded before this script in HTML):
 *   1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js
 *   2. scripts/supabase-config.js  (gitignored — see supabase-config.example.js)
 *
 * Exposes:
 *   window.SupabaseClient   — public API object
 *   window.initLeaderboardSubmit(difficulty, elapsedMs)  — called by app.js
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Client initialisation                                              */
    /* ------------------------------------------------------------------ */

    let db = null;

    if (
        window.SUPABASE_URL &&
        window.SUPABASE_ANON_KEY &&
        window.SUPABASE_URL !== 'https://your-project-id.supabase.co' &&
        window.supabase
    ) {
        try {
            db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
                auth: {
                    // Replace the Web Locks API with a no-op to prevent the
                    // "lock not released within 5000ms" stall on live-reload.
                    // The lock serialises token refreshes; without it, concurrent
                    // refreshes are possible but harmless for a single-user game.
                    lock: (_name, _timeout, fn) => fn()
                }
            });
        } catch (e) {
            console.warn('[SupabaseClient] Failed to initialise:', e);
        }
    }

    function logError(context, error, meta) {
        const suffix = meta ? ' ' + JSON.stringify(meta) : '';
        console.error('[SupabaseClient] ' + context + suffix, error);
    }

    function logWarn(context, error, meta) {
        const suffix = meta ? ' ' + JSON.stringify(meta) : '';
        console.warn('[SupabaseClient] ' + context + suffix, error);
    }

    function installGlobalErrorHooks() {
        if (window.__SUPABASE_CLIENT_GLOBAL_ERRORS__) return;
        window.__SUPABASE_CLIENT_GLOBAL_ERRORS__ = true;

        window.addEventListener('error', function (event) {
            const err = event && (event.error || event.message);
            logError('Unhandled window error', err || event);
        });

        window.addEventListener('unhandledrejection', function (event) {
            logError('Unhandled promise rejection', event && event.reason ? event.reason : event);
        });
    }

    installGlobalErrorHooks();

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function t(key, vars) {
        return window.i18n ? window.i18n.t(key, vars) : key;
    }

    const DIFFICULTIES = ['easy', 'medium', 'hard'];

    function getAuthErrorMessage(error) {
        const status = Number(error && error.status);
        const raw = [
            error && error.message,
            error && error.error_description,
            error && error.code,
            error && error.error,
            error && error.name
        ]
            .filter(Boolean)
            .map(String)
            .join(' ')
            .toLowerCase();

        const isRateLimit =
            status === 429 ||
            raw.includes('rate') ||
            raw.includes('too many') ||
            raw.includes('too_many') ||
            raw.includes('over_email_send_rate_limit') ||
            raw.includes('retry after') ||
            raw.includes('troppi tentativi') ||
            raw.includes('attendi un minuto');

        if (isRateLimit) {
            return t('auth.magicLinkRateLimit');
        }

        if (
            status >= 500 ||
            raw.includes('failed to fetch') ||
            raw.includes('network') ||
            raw.includes('timeout') ||
            raw.includes('internal')
        ) {
            return t('auth.magicLinkTemporaryError');
        }

        return t('auth.magicLinkGenericError');
    }

    function buildSignupUsername(email) {
        const localPart = String(email || '')
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '_')
            .replace(/^[_\-.]+|[_\-.]+$/g, '');
        const base = (localPart || 'player').slice(0, 18);
        const suffix = (
            typeof crypto !== 'undefined' &&
            crypto.randomUUID
        )
            ? crypto.randomUUID().slice(0, 8)
            : Math.floor(1000 + Math.random() * 9000);
        return `${base}_${suffix}`;
    }

    function getLeaderboardResultMessage(result) {
        const rankNum = Number(result && result.rank);
        const hasRank = Number.isFinite(rankNum) && rankNum > 0;

        if (result && result.improved) {
            return hasRank
                ? t('stats.submittedWithRank', { rank: rankNum })
                : t('stats.submitted');
        }

        return hasRank
            ? t('stats.notImprovedWithRank', { rank: rankNum })
            : t('stats.notImproved');
    }

    function getLocalBestTime(diff) {
        const raw = localStorage.getItem('bestTime_' + diff);
        if (!raw) return null;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function setLocalBestTime(diff, timeMs) {
        if (!Number.isFinite(timeMs) || timeMs <= 0) return;
        localStorage.setItem('bestTime_' + diff, String(Math.floor(timeMs)));
    }

    /* ------------------------------------------------------------------ */
    /*  Guest identity                                                     */
    /* ------------------------------------------------------------------ */

    function getGuestIdentity() {
        try {
            const stored = localStorage.getItem('guestIdentity');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.id && parsed.name) return parsed;
            }
        } catch (_) {}

        const id   = crypto.randomUUID();
        const num  = String(Math.floor(1000 + Math.random() * 9000));
        const name = 'Guest_' + num;
        const identity = { id, name };
        try { localStorage.setItem('guestIdentity', JSON.stringify(identity)); } catch (_) {}
        return identity;
    }

    /* ------------------------------------------------------------------ */
    /*  Auth                                                               */
    /* ------------------------------------------------------------------ */

    /** Reject a promise after ms milliseconds */
    function withTimeout(promise, ms) {
        const timer = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), ms)
        );
        return Promise.race([promise, timer]);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function getCurrentUser() {
        if (!db) return null;
        try {
            const { data, error } = await withTimeout(db.auth.getUser(), 10000);
            if (error) {
                logWarn('getCurrentUser: getUser returned error', error);
            }
            if (data && data.user) {
                return data.user;
            }

            const { data: sessionData, error: sessionError } = await withTimeout(db.auth.getSession(), 10000);
            if (sessionError) {
                logWarn('getCurrentUser: getSession returned error', sessionError);
            }
            return (sessionData && sessionData.session && sessionData.session.user) || null;
        } catch (e) {
            logError('getCurrentUser failed', e);
            return null;
        }
    }

    async function signInWithMagicLink(email) {
        if (!db) {
            const error = { message: 'Supabase not configured' };
            return { error, message: getAuthErrorMessage(error) };
        }

        const signupUsername = buildSignupUsername(email);

        // Determine the base redirect URL for magic links
        // Use APP_DOMAIN if configured (for production email links), otherwise use current domain
        const appDomain = window.APP_DOMAIN || window.location.origin;
        const currentPath = window.location.pathname || '/';
        const baseRedirect = appDomain + currentPath;
        
        const preferredLang = (
            (window.i18n && window.i18n.currentLang) ||
            (document.documentElement.lang || 'en')
        ).slice(0, 2).toLowerCase();

        let redirectTo = baseRedirect;
        try {
            const redirectUrl = new URL(baseRedirect);
            redirectUrl.searchParams.set('lang', preferredLang);
            redirectTo = redirectUrl.toString();
        } catch (_) {}

        try {
            const { error } = await db.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: true,
                    emailRedirectTo: redirectTo,
                    // Include fallback username metadata for projects that create
                    // profiles from auth.users metadata in a DB trigger.
                    data: {
                        preferred_lang: preferredLang,
                        username: signupUsername,
                        display_name: signupUsername,
                        full_name: signupUsername,
                        name: signupUsername,
                        user_name: signupUsername,
                        nickname: signupUsername
                    }
                }
            });

            if (error) {
                logWarn('signInWithMagicLink returned error', error);
            }

            return { error, message: error ? getAuthErrorMessage(error) : null };
        } catch (e) {
            logError('signInWithMagicLink failed', e);
            return { error: e, message: getAuthErrorMessage(e) };
        }
    }

    async function signOut() {
        if (!db) return;
        await db.auth.signOut();
    }

    function onAuthStateChange(callback) {
        if (!db) return () => {};
        const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
            Promise.resolve(callback(event, session)).catch((e) => {
                logError('onAuthStateChange callback failed', e, { event });
            });
        });
        return () => subscription.unsubscribe();
    }

    /* ------------------------------------------------------------------ */
    /*  Profiles                                                           */
    /* ------------------------------------------------------------------ */

    async function getProfile(userId) {
        if (!db || !userId) return null;
        try {
            const { data, error } = await withTimeout(db
                .from('profiles')
                .select('id, username, player_country')
                .eq('id', userId)
                .maybeSingle(), 10000);
            if (error) {
                logWarn('getProfile query failed', error, { userId });
                return null;
            }
            return data;
        } catch (e) {
            logError('getProfile failed', e, { userId });
            return null;
        }
    }

    async function upsertProfile(userId, username, playerCountry) {
        if (!db) return { error: { message: 'Supabase not configured' } };
        try {
            const { data, error } = await db
                .from('profiles')
                .upsert(
                    { id: userId, username: username.trim(), player_country: playerCountry || null },
                    { onConflict: 'id' }
                );
            if (error) {
                logWarn('upsertProfile query failed', error, { userId });
            }
            return { data, error };
        } catch (e) {
            logError('upsertProfile failed', e, { userId });
            return { data: null, error: e };
        }
    }

    async function isUsernameTaken(username) {
        if (!db) return false;
        try {
            const { data, error } = await db
                .from('profiles')
                .select('id')
                .ilike('username', username.trim())
                .maybeSingle();
            if (error) {
                logWarn('isUsernameTaken query failed', error, { username });
                return false;
            }
            return data !== null;
        } catch (e) {
            logError('isUsernameTaken failed', e, { username });
            return false;
        }
    }

    async function ensureProfileForUser(user, maxAttempts) {
        if (!db || !user || !user.id) {
            return { profile: null, created: false, error: null };
        }

        const attempts = Number.isFinite(maxAttempts) ? maxAttempts : 3;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const existingProfile = await getProfile(user.id);
            if (existingProfile && existingProfile.username) {
                return { profile: existingProfile, created: false, error: null };
            }

            const baseUsername = buildSignupUsername(user.email || ('player_' + String(user.id).slice(0, 8)));
            const taken = await isUsernameTaken(baseUsername);
            const usernameToUse = taken
                ? (baseUsername + '_' + String(Date.now()).slice(-4))
                : baseUsername;

            const { error } = await upsertProfile(user.id, usernameToUse, null);
            if (!error) {
                const insertedProfile = await getProfile(user.id);
                if (insertedProfile && insertedProfile.username) {
                    return { profile: insertedProfile, created: true, error: null };
                }
            } else {
                logWarn('ensureProfileForUser upsert attempt failed', error, { userId: user.id, attempt });
            }

            if (attempt < attempts) {
                await delay(250 * attempt);
            }
        }

        const fallbackProfile = await getProfile(user.id);
        if (fallbackProfile && fallbackProfile.username) {
            return { profile: fallbackProfile, created: false, error: null };
        }

        const finalError = new Error('Could not ensure profile for signed-in user');
        logError('ensureProfileForUser failed', finalError, { userId: user.id });
        return { profile: null, created: false, error: finalError };
    }

    async function ensureProfileForCurrentUser() {
        const user = await getCurrentUser();
        if (!user) {
            return { profile: null, created: false, error: { message: 'not_logged_in' } };
        }
        return ensureProfileForUser(user, 4);
    }

    /* ------------------------------------------------------------------ */
    /*  Leaderboard                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Submit a score via the upsert_score DB function.
     * Returns { improved, rank } or { improved: false, rank: null, error }
     */
    async function submitScore(difficulty, timeMs) {
        if (!db) return { improved: false, rank: null, error: 'not_configured' };

        const user = await getCurrentUser();
        let userId       = null;
        let guestId      = null;
        let displayName  = '';
        let playerCountry = null;

        if (user) {
            const profile  = await getProfile(user.id);
            displayName    = profile?.username || user.email.split('@')[0];
            playerCountry  = profile?.player_country || null;
            userId         = user.id;
        } else {
            const guest   = getGuestIdentity();
            displayName   = guest.name;
            guestId       = guest.id;
        }

        try {
            const { data, error } = await withTimeout(db.rpc('upsert_score', {
                p_user_id:        userId,
                p_guest_id:       guestId,
                p_display_name:   displayName,
                p_player_country: playerCountry,
                p_difficulty:     difficulty,
                p_time_ms:        timeMs
            }), 15000);
            if (error) {
                console.error('[SupabaseClient] upsert_score error:', error);
                return { improved: false, rank: null, error };
            }
            return data; // { improved, rank }
        } catch (e) {
            console.error('[SupabaseClient] submitScore failed:', e);
            return { improved: false, rank: null, error: e };
        }
    }

    /**
     * Fetch leaderboard rows.
     * Returns array of { display_name, player_country, time_ms, created_at }
     */
    async function fetchLeaderboard(difficulty, limit, offset) {
        if (!db) {
            throw new Error('Supabase not configured');
        }
        limit  = limit  || 50;
        offset = offset || 0;
        try {
            const { data, error } = await withTimeout(db
                .from('leaderboard')
                .select('display_name, player_country, time_ms, created_at')
                .eq('difficulty', difficulty)
                .order('time_ms', { ascending: true })
                .range(offset, offset + limit - 1), 12000);
            if (error) {
                logError('fetchLeaderboard query failed', error, { difficulty, limit, offset });
                throw error;
            }
            return data || [];
        } catch (e) {
            logError('fetchLeaderboard failed', e, { difficulty, limit, offset });
            throw e;
        }
    }

    async function fetchUserBestTimes(userId) {
        if (!db || !userId) return {};
        try {
            const { data, error } = await withTimeout(db
                .from('leaderboard')
                .select('difficulty, time_ms')
                .eq('user_id', userId), 12000);
            if (error || !Array.isArray(data)) {
                if (error) {
                    logWarn('fetchUserBestTimes query failed', error, { userId });
                }
                return {};
            }

            const bests = {};
            data.forEach(row => {
                if (!row || !DIFFICULTIES.includes(row.difficulty)) return;
                const current = bests[row.difficulty];
                if (current === undefined || row.time_ms < current) {
                    bests[row.difficulty] = row.time_ms;
                }
            });
            return bests;
        } catch (e) {
            logError('fetchUserBestTimes failed', e, { userId });
            return {};
        }
    }

    async function syncPersonalBestsForCurrentUser() {
        if (!db) return { synced: false, reason: 'not_configured' };

        const user = await getCurrentUser();
        if (!user) return { synced: false, reason: 'not_logged_in' };

        const remoteBests = await fetchUserBestTimes(user.id);

        for (const diff of DIFFICULTIES) {
            const localBest = getLocalBestTime(diff);
            const remoteBest = Number.isFinite(remoteBests[diff]) ? remoteBests[diff] : null;

            if (remoteBest !== null && (localBest === null || remoteBest < localBest)) {
                setLocalBestTime(diff, remoteBest);
            }

            if (localBest !== null && (remoteBest === null || localBest < remoteBest)) {
                await submitScore(diff, localBest);
            }
        }

        const bests = {};
        DIFFICULTIES.forEach(diff => {
            bests[diff] = getLocalBestTime(diff);
        });

        document.dispatchEvent(new CustomEvent('personalbestsynced', { detail: bests }));
        return { synced: true, bests };
    }

    async function deleteCurrentUser() {
        if (!db) return { error: { message: 'Supabase not configured' } };

        const user = await getCurrentUser();
        if (!user) return { error: { message: 'No user is currently signed in' } };

        try {
            const { error } = await withTimeout(db.rpc('delete_my_account'), 15000);
            if (error) {
                logWarn('deleteCurrentUser rpc error', error);
                return { error };
            }

            await db.auth.signOut();
            return { error: null };
        } catch (e) {
            logError('deleteCurrentUser failed', e);
            return { error: e };
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Completion Overlay Widget  (called by app.js)                     */
    /* ------------------------------------------------------------------ */

    /**
     * Render a leaderboard submit widget inside #leaderboard-submit-widget.
     * Called by showCompletionOverlay() in app.js.
     */
    window.initLeaderboardSubmit = async function (difficulty, elapsedMs) {
        const container = document.getElementById('leaderboard-submit-widget');
        if (!container) return;

        if (!db) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = '<div class="lb-widget lb-loading"><span class="lb-spinner"></span></div>';

        const user = await getCurrentUser();

        if (user) {
            const profile = await getProfile(user.id);
            if (!profile) {
                container.innerHTML = _renderUsernameSetup();
                _attachWidgetListeners(container, difficulty, elapsedMs);
            } else {
                container.innerHTML = _renderAutoSubmitting(profile.username);
                const result = await submitScore(difficulty, elapsedMs);
                container.innerHTML = result.error ? _renderError(result.error) : _renderResult(result);
            }
        } else {
            const guest = getGuestIdentity();
            container.innerHTML = _renderAutoSubmitting(guest.name);
            const result = await submitScore(difficulty, elapsedMs);
            container.innerHTML = result.error ? _renderError(result.error) : _renderGuestResult(result);
        }

        _attachWidgetListeners(container, difficulty, elapsedMs);
    };

    /* --- widget templates --- */

    function _renderAutoSubmitting(username) {
        return `<div class="lb-widget">
            <span class="lb-result-msg">${escHtml(t('stats.submitting'))}</span>
            <span class="lb-as">${escHtml(t('stats.asUser', { name: username }))}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
        </div>`;
    }

    function _renderGuestResult(result) {
        const msg = getLeaderboardResultMessage(result);
        const cls = result.improved ? 'lb-success' : 'lb-neutral';
        return `<div class="lb-widget ${cls}">
            <span class="lb-result-msg">${escHtml(msg)}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
            <a href="login.html?ref=game" class="lb-btn lb-btn-ghost">${escHtml(t('auth.signInForRecord'))}</a>
        </div>`;
    }

    function _renderLoginForm() {
        return `<div class="lb-widget lb-neutral">
            <span class="lb-result-msg">${escHtml(t('auth.signInHint'))}</span>
            <a href="login.html?ref=game" class="lb-btn lb-btn-primary">${escHtml(t('auth.sendMagicLink'))}</a>
        </div>`;
    }

    function _renderUsernameSetup() {
        return `<div class="lb-widget lb-setup">
            <p class="lb-setup-label">${escHtml(t('auth.setUsername'))}</p>
            <input type="text" id="lb-username-input" class="lb-input"
                placeholder="${escHtml(t('auth.usernamePlaceholder'))}" maxlength="30" autocomplete="off">
            <button class="lb-btn lb-btn-primary" data-action="setup-submit">${escHtml(t('auth.saveAndSubmit'))}</button>
        </div>`;
    }

    function _renderResult(result) {
        const msg = getLeaderboardResultMessage(result);
        const cls = result.improved ? 'lb-success' : 'lb-neutral';
        return `<div class="lb-widget ${cls}">
            <span class="lb-result-msg">${escHtml(msg)}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
        </div>`;
    }

    function _renderError(err) {
        const msg = (err && err.message) ? err.message : String(err);
        return `<div class="lb-widget lb-error"><span>${escHtml(t('stats.submitError'))}: ${escHtml(msg)}</span></div>`;
    }

    /* --- event wiring --- */

    function _attachWidgetListeners(container, difficulty, elapsedMs) {
        container.addEventListener('click', async function handler(e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;

            if (action === 'setup-submit') {
                const input = container.querySelector('#lb-username-input');
                if (!input || !input.value.trim()) return;
                const username = input.value.trim();
                btn.disabled = true;
                btn.textContent = t('auth.saving');

                const taken = await isUsernameTaken(username);
                if (taken) {
                    btn.disabled = false;
                    btn.textContent = t('auth.saveAndSubmit');
                    input.value = '';
                    input.placeholder = t('auth.usernameTaken');
                    return;
                }

                const user = await getCurrentUser();
                if (!user) {
                    container.removeEventListener('click', handler);
                    container.innerHTML = _renderLoginForm();
                    _attachWidgetListeners(container, difficulty, elapsedMs);
                    return;
                }

                const { error: profileError } = await upsertProfile(user.id, username, null);
                if (profileError) {
                    btn.disabled = false;
                    btn.textContent = t('auth.saveAndSubmit');
                    container.innerHTML = _renderError(profileError);
                    return;
                }
                const result = await submitScore(difficulty, elapsedMs);
                container.removeEventListener('click', handler);
                container.innerHTML = result.error ? _renderError(result.error) : _renderResult(result);
            }
        });
    }

    if (db) {
        getCurrentUser().then(async user => {
            if (!user) return;
            await ensureProfileForUser(user, 4);
            await syncPersonalBestsForCurrentUser();
        });

        onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
                const user = session?.user || await getCurrentUser();
                if (user && event === 'SIGNED_IN') {
                    const ensured = await ensureProfileForUser(user, 4);
                    if (ensured.error) {
                        logWarn('SIGNED_IN profile ensure failed', ensured.error, { userId: user.id });
                    }
                }
                await syncPersonalBestsForCurrentUser();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */

    window.SupabaseClient = {
        isConfigured:        () => db !== null,
        getGuestIdentity,
        getCurrentUser,
        signInWithMagicLink,
        getAuthErrorMessage,
        signOut,
        onAuthStateChange,
        getProfile,
        upsertProfile,
        isUsernameTaken,
        ensureProfileForCurrentUser,
        fetchUserBestTimes,
        syncPersonalBestsForCurrentUser,
        deleteCurrentUser,
        submitScore,
        fetchLeaderboard
    };

    document.dispatchEvent(new CustomEvent('supabaseclientready'));

})();
