const googleRedirectUri = () => {
    const redirect = new URL(chrome.identity.getRedirectURL());
    return chrome.runtime.getManifest().browser_specific_settings?.gecko
        ? `http://127.0.0.1/mozoauth2/${redirect.hostname.split('.')[0]}`
        : redirect.href;
};

const usesGoogleWebFlow = async () => !chrome.identity.getAuthToken ||
    !!(navigator.brave && await navigator.brave.isBrave());

const fetchGoogleEmail = async (token) => {
    try {
        const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
        if (!response.ok) return '';
        return (await response.json()).email || '';
    } catch (_) {
        return '';
    }
};

const cacheGoogleToken = async (token, expiresIn = 3500) => {
    if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('Google no devolvió un token válido. Volvé a conectar tu cuenta.');
    }
    await new Promise(resolve => chrome.storage.local.set({
        google_access_token: token,
        google_token_expires_at: Date.now() + expiresIn * 1000
    }, resolve));
    await new Promise(resolve => chrome.storage.local.remove(['user_disconnected'], resolve));
    return token;
};

const getAccessTokenViaWebFlow = async (interactive, forceSelectAccount = false) => {
    const redirectUri = googleRedirectUri();
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
        client_id: WEB_OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'token',
        scope: [...GOOGLE_OAUTH_SCOPES, 'email'].join(' '),
        state
    });
    const launch = (prompt, isInteractive) => new Promise((resolve, reject) => {
        params.set('prompt', prompt);
        chrome.identity.launchWebAuthFlow({
            url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
            interactive: isInteractive
        }, async (redirectUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            try {
                const redirect = new URL(redirectUrl);
                const expected = new URL(redirectUri);
                const result = new URLSearchParams(redirect.hash.slice(1));
                if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname || result.get('state') !== state) {
                    throw new Error('No se pudo validar la respuesta de Google. Volvé a iniciar sesión.');
                }
                if (result.has('error')) {
                    throw new Error(`Google: ${result.get('error')}`);
                }
                if (result.has('scope') && !GOOGLE_OAUTH_SCOPES.every(scope => result.get('scope').split(' ').includes(scope))) {
                    throw new Error('Google no autorizó el acceso a Sheets. Volvé a conectar y aceptá ese permiso.');
                }
                const token = await cacheGoogleToken(result.get('access_token'), Number(result.get('expires_in') || 3600));
                const email = await fetchGoogleEmail(token);
                await new Promise(resolve => chrome.storage.local.set({ google_account_email: email }, resolve));
                resolve(token);
            } catch (error) {
                reject(error);
            }
        });
    });
    if (forceSelectAccount) return launch('select_account', true);
    const cached = await new Promise(resolve => chrome.storage.local.get(['google_account_email'], resolve));
    if (cached.google_account_email) params.set('login_hint', cached.google_account_email);
    try {
        return await launch('none', false);
    } catch (error) {
        if (!interactive) throw error;
        return launch('consent', true);
    }
};

const getGoogleAccessToken = async (interactive = true) => {
    const cached = await new Promise(resolve => chrome.storage.local.get(
        ['google_access_token', 'google_token_expires_at', 'user_disconnected'], resolve));
    if (!interactive && cached.user_disconnected) throw new Error('No hay sesión de Google');
    if (cached.google_access_token && cached.google_token_expires_at > Date.now() + 120000) {
        return cached.google_access_token;
    }
    if (await usesGoogleWebFlow()) return getAccessTokenViaWebFlow(interactive);
    for (const allowPrompt of interactive ? [false, true] : [false]) {
        try {
            const token = await new Promise((resolve, reject) => chrome.identity.getAuthToken(
                { interactive: allowPrompt }, result => {
                    const token = typeof result === 'string' ? result : result?.token;
                    if (chrome.runtime.lastError || !token) {
                        reject(new Error(chrome.runtime.lastError?.message || 'Sin token'));
                    } else resolve(token);
                }));
            return await cacheGoogleToken(token);
        } catch (_) {
        }
    }
    return getAccessTokenViaWebFlow(interactive);
};

const getGoogleAccessTokenSilently = () => getGoogleAccessToken(false);

const checkGoogleAuthStatus = async () => {
    try {
        const token = await getGoogleAccessTokenSilently();
        const cached = await new Promise(resolve => chrome.storage.local.get(['google_account_email'], resolve));
        return { isConnected: true, token, email: cached.google_account_email || '' };
    } catch (_) {
        return { isConnected: false };
    }
};

const clearGoogleToken = async (token) => {
    await new Promise(resolve => chrome.storage.local.remove(['google_access_token', 'google_token_expires_at'], resolve));
    if (token && chrome.identity.removeCachedAuthToken) {
        await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
        await new Promise(resolve => chrome.identity.clearAllCachedAuthTokens(resolve));
    }
};

const forceNewGoogleToken = async (token, interactive = true) => {
    await clearGoogleToken(token);
    return getGoogleAccessToken(interactive);
};

const disconnectGoogle = async () => {
    const cached = await new Promise(resolve => chrome.storage.local.get(['google_access_token'], resolve));
    await new Promise(resolve => chrome.storage.local.set({ user_disconnected: true }, resolve));
    await new Promise(resolve => chrome.storage.local.remove(['google_account_email'], resolve));
    await clearGoogleToken(cached.google_access_token);
};
