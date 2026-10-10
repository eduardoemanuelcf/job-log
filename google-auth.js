const googleRedirectUri = () => {
    const redirect = new URL(chrome.identity.getRedirectURL());
    return chrome.runtime.getManifest().browser_specific_settings?.gecko
        ? `http://127.0.0.1/mozoauth2/${redirect.hostname.split('.')[0]}`
        : redirect.href;
};

const usesGoogleWebFlow = async () => {
    const cached = await new Promise(resolve => chrome.storage.local.get(['google_use_web_flow'], resolve));
    return cached.google_use_web_flow || !chrome.identity.getAuthToken ||
        !!(navigator.brave && await navigator.brave.isBrave());
};

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
        google_token_expires_at: Date.now() + expiresIn * 1000,
        google_token_scope: GOOGLE_OAUTH_SCOPES.join(' ')
    }, resolve));
    await new Promise(resolve => chrome.storage.local.remove(['user_disconnected'], resolve));
    return token;
};

const launchGoogleWebAuth = (params, interactive) => new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        interactive
    }, (redirectUrl) => {
        if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
        }
        try {
            const redirect = new URL(redirectUrl);
            const expected = new URL(params.get('redirect_uri'));
            const result = new URLSearchParams([...redirect.searchParams, ...new URLSearchParams(redirect.hash.slice(1))]);
            if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname || result.get('state') !== params.get('state')) {
                throw new Error('No se pudo validar la respuesta de Google. Volvé a iniciar sesión.');
            }
            if (result.has('error')) {
                throw new Error(`Google: ${result.get('error')}`);
            }
            resolve(result);
        } catch (error) {
            reject(error);
        }
    });
});

const cacheGoogleWebToken = async (result) => {
    if (result.has('scope') && !GOOGLE_OAUTH_SCOPES.every(scope => result.get('scope').split(' ').includes(scope))) {
        throw new Error('Google no autorizó el acceso a la planilla. Volvé a autorizarla desde Configuración.');
    }
    const token = await cacheGoogleToken(result.get('access_token'), Number(result.get('expires_in') || 3600));
    const email = await fetchGoogleEmail(token);
    await new Promise(resolve => chrome.storage.local.set({ google_account_email: email, google_use_web_flow: true }, resolve));
    return token;
};

const getAccessTokenViaWebFlow = async (interactive, forceSelectAccount = false) => {
    const params = new URLSearchParams({
        client_id: WEB_OAUTH_CLIENT_ID,
        redirect_uri: googleRedirectUri(),
        response_type: 'token',
        scope: [...GOOGLE_OAUTH_SCOPES, 'email'].join(' '),
        state: crypto.randomUUID()
    });
    const launch = async (prompt, isInteractive) => {
        params.set('prompt', prompt);
        return cacheGoogleWebToken(await launchGoogleWebAuth(params, isInteractive));
    };
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

const pickGoogleSpreadsheet = async (spreadsheetId = '') => {
    if (spreadsheetId && !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
        throw new Error('Ingresá una URL o ID válido de Google Sheets.');
    }
    const params = new URLSearchParams({
        client_id: WEB_OAUTH_CLIENT_ID,
        redirect_uri: googleRedirectUri(),
        response_type: 'token',
        scope: GOOGLE_OAUTH_SCOPES.join(' '),
        state: crypto.randomUUID(),
        prompt: 'consent',
        trigger_onepick: 'true',
        mimetypes: 'application/vnd.google-apps.spreadsheet',
        include_granted_scopes: 'false'
    });
    if (spreadsheetId) params.set('file_ids', spreadsheetId);
    const result = await launchGoogleWebAuth(params, true);
    const selectedId = result.get('picked_file_ids') || '';
    if (!/^[a-zA-Z0-9_-]+$/.test(selectedId) || (spreadsheetId && selectedId !== spreadsheetId)) {
        throw new Error('No se autorizó la planilla indicada. Volvé a seleccionarla en Google.');
    }
    await cacheGoogleWebToken(result);
    await new Promise(resolve => chrome.storage.local.set({ google_authorized_spreadsheet_id: selectedId }, resolve));
    return selectedId;
};

const getGoogleAccessToken = async (interactive = true) => {
    const cached = await new Promise(resolve => chrome.storage.local.get(
        ['google_access_token', 'google_token_expires_at', 'google_token_scope', 'user_disconnected'], resolve));
    if (!interactive && cached.user_disconnected) throw new Error('No hay sesión de Google');
    if (cached.google_access_token && cached.google_token_scope !== GOOGLE_OAUTH_SCOPES.join(' ')) {
        await clearGoogleToken(cached.google_access_token);
    } else if (cached.google_access_token && cached.google_token_expires_at > Date.now() + 120000) {
        return cached.google_access_token;
    }
    if (await usesGoogleWebFlow()) return getAccessTokenViaWebFlow(interactive);
    for (const allowPrompt of interactive ? [false, true] : [false]) {
        try {
            const token = await new Promise((resolve, reject) => chrome.identity.getAuthToken(
                { interactive: allowPrompt, scopes: GOOGLE_OAUTH_SCOPES }, result => {
                    const token = typeof result === 'string' ? result : result?.token;
                    if (chrome.runtime.lastError || !token ||
                        (result?.grantedScopes && !GOOGLE_OAUTH_SCOPES.every(scope => result.grantedScopes.includes(scope)))) {
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
    await new Promise(resolve => chrome.storage.local.remove(['google_access_token', 'google_token_expires_at', 'google_token_scope'], resolve));
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
    await new Promise(resolve => chrome.storage.local.remove(['google_account_email', 'google_authorized_spreadsheet_id'], resolve));
    await clearGoogleToken(cached.google_access_token);
};
