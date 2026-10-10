const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json')));
const googleScope = 'https://www.googleapis.com/auth/drive.file';
assert.deepEqual(manifest.oauth2.scopes, [googleScope]);

function popup(script = 'popup.js', sync = {}, local = {}, firefox = false) {
    const html = readFileSync(resolve(root, script.replace('.js', '.html')), 'utf8');
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, node()]));
    function node() {
        return { value: '', checked: false, disabled: false, style: {}, handlers: {}, children: [], parentElement: { clientWidth: 864 },
            addEventListener(name, fn) { this.handlers[name] = fn; }, focus() { this.focused = true; },
            appendChild(child) { this.children.push(child); },
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            setAttribute(name, value) { this[name] = value; },
            set innerHTML(value) { this.markup = value; }, get innerHTML() { return this.markup; }
        };
    }
    const calls = [], writes = [];
    let optionsOpened = false;
    const store = (data) => ({
        get(keys, callback) { const result = Object.fromEntries([keys].flat().filter(k => k in data).map(k => [k, data[k]])); callback?.(result); return Promise.resolve(result); },
        set(values, callback) { writes.push(values); Object.assign(data, values); callback?.(); },
        remove(keys, callback) { [keys].flat().forEach(k => delete data[k]); callback?.(); }
    });
    let ready;
    const context = vm.createContext({
        console, navigator: {}, crypto: webcrypto, URL, URLSearchParams, AbortSignal,
        window: { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } },
        setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
        document: {
            getElementById(id) { assert(elements.has(id), `Missing DOM node: ${id}`); return elements.get(id); },
            createElement: node,
            createElementNS: node,
            querySelector: () => ({ value: elements.get('aiGroq')?.checked ? 'groq' : 'gemini' }),
            addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }
        },
        chrome: {
            storage: { sync: store(sync), local: store(local) },
            runtime: { getManifest: () => firefox ? { ...manifest, oauth2: undefined, browser_specific_settings: { gecko: { id: 'job-log@emanuelcabral.dev' } } } : manifest, openOptionsPage() { optionsOpened = true; } },
            identity: { getRedirectURL: () => firefox ? 'https://firefox-id.extensions.allizom.org/' : 'https://test.chromiumapp.org/' },
            tabs: { query: async () => [{ id: 1, url: 'https://example.com/jobs/1' }] },
            scripting: { executeScript: (options, callback) => callback([{ result: { url: 'https://example.com/jobs/1', domTitle: '=IMPORTXML("bad")', domCompany: '=SUM(1;2)', source: 'Example', verified: true } }]) }
        },
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            return { ok: true, status: 200, json: async () => String(url).includes('/values/')
                ? { values: String(url).endsWith('I2') ? [['Notas']] : String(url).includes('UNFORMATTED_VALUE') ? [['Semana 1', 10, 25], ['Semana 2', 0, 25], ['TOTAL', 10, 50]] : [['Semana 1']] }
                : { sheets: [{ properties: { title: 'Progreso' } }, { properties: { title: 'Postulaciones' } }] } };
        }
    });
    assert(html.indexOf('oauth-config.js') < html.indexOf(`src="${script}"`), 'OAuth config must load before the application');
    vm.runInContext(readFileSync(resolve(root, 'oauth-config.js'), 'utf8'), context);
    assert(html.indexOf('google-auth.js') > html.indexOf('oauth-config.js'));
    assert(html.indexOf('google-auth.js') < html.indexOf(`src="${script}"`));
    vm.runInContext(readFileSync(resolve(root, 'google-auth.js'), 'utf8'), context);
    assert(html.indexOf('extension.js') < html.indexOf(`src="${script}"`));
    vm.runInContext(readFileSync(resolve(root, 'extension.js'), 'utf8'), context);
    vm.runInContext(readFileSync(resolve(root, script), 'utf8'), context);
    return { context, elements, calls, writes, ready: () => ready(), optionsOpened: () => optionsOpened };
}

(async () => {
    assert(manifest.description.length <= 132);
    assert(!manifest.host_permissions);
    assert(!existsSync(resolve(root, 'notice.json')));
    const config = { gemini_api_key: 'test-key', spreadsheet_id: 'test-sheet', current_week: 'Semana 1', cv_goal: '25' };
    for (const firefox of [false, true]) {
        const firstRun = popup('popup.js', { ...config }, {}, firefox);
        await firstRun.ready();
        assert.equal(firstRun.elements.get('configRequiredArea').style.display, 'flex');
        assert.equal(firstRun.calls.length, 0, 'No background data request before consent');

        const pendingSheet = popup('popup.js', { gemini_api_key: 'saved-key', privacy_consent: true }, {}, firefox);
        await pendingSheet.ready();
        assert.equal(pendingSheet.elements.get('configRequiredArea').style.display, 'flex');
        assert(pendingSheet.elements.get('configRequiredText').textContent.includes('claves están guardadas'));
        assert.equal(pendingSheet.elements.get('btnConfigurar').textContent, 'Autorizar planilla');
        await pendingSheet.elements.get('btnConfigurar').handlers.click();
        assert(pendingSheet.optionsOpened());
        assert.equal(pendingSheet.calls.length, 0, 'Missing a sheet must not trigger data requests');

        const signedIn = popup('popup.js', { ...config, privacy_consent: true }, { google_access_token: 'test-token', google_token_scope: googleScope, google_token_expires_at: Date.now() + 3600000, cached_weeks: ['Semana 1'] }, firefox);
        await signedIn.ready();
        await signedIn.elements.get('btnPostular').handlers.click();
        const saved = signedIn.calls.find(c => c.url.includes(':append'));
        assert(saved, 'Application must be written to Sheets');
        const row = JSON.parse(saved.options.body).values[0];
        assert.equal(row[8], '');
        assert.equal(row[1], "'=SUM(1;2)");
        assert.equal(row[3], "'=IMPORTXML(\"bad\")");
        assert(row[4].startsWith('=HYPERLINK('));
        assert(signedIn.calls.every(c => c.url.startsWith('https://sheets.googleapis.com/')), 'No GitHub/update requests');
        const disconnected = popup('popup.js', { ...config, privacy_consent: true }, { user_disconnected: true }, firefox);
        await disconnected.ready();
        disconnected.elements.get('authBannerAction').onclick();
        assert(disconnected.optionsOpened(), 'Login must open the persistent options page');

        const local = { google_access_token: 'test-token', google_token_scope: googleScope, google_token_expires_at: Date.now() + 3600000, cached_weeks: ['Semana 1'],
            application_note_draft: { url: 'https://example.com/jobs/1', text: '=SUM(1;2)\nSeguimiento personal' } };
        const withNote = popup('popup.js', { ...config, privacy_consent: true }, local, firefox);
        await withNote.ready();
        assert(withNote.elements.get('noteSection').open, 'Restore the draft for this posting');
        await withNote.elements.get('btnPostular').handlers.click();
        const noteRow = JSON.parse(withNote.calls.find(call => call.url.includes(':append')).options.body).values[0];
        assert.equal(noteRow[8], "'=SUM(1;2)\nSeguimiento personal");
        assert.equal(withNote.elements.get('applicationNote').value, '');
        assert(!withNote.elements.get('noteSection').open);
        assert(!local.application_note_draft, 'Clear the saved draft after a successful write');

        local.application_note_draft = { url: 'https://example.com/jobs/other', text: 'Nota de otra oferta' };
        const otherPosting = popup('popup.js', { ...config, privacy_consent: true }, local, firefox);
        await otherPosting.ready();
        await otherPosting.elements.get('btnPostular').handlers.click();
        assert.equal(local.application_note_draft.text, 'Nota de otra oferta', 'An unrelated registration must preserve the draft');
        const failed = popup('popup.js', { ...config, privacy_consent: true }, local, firefox);
        await failed.ready();
        assert.equal(failed.elements.get('applicationNote').value, '', 'Never restore another posting’s note');
        failed.elements.get('applicationNote').value = 'Mi nota';
        failed.elements.get('applicationNote').handlers.input();
        const originalFetch = failed.context.fetch;
        failed.context.fetch = async (url, options) => {
            const response = await originalFetch(url, options);
            return String(url).includes(':append') ? { ok: false, status: 500, json: async () => ({}) } : response;
        };
        await failed.elements.get('btnPostular').handlers.click();
        assert.equal(failed.elements.get('applicationNote').value, 'Mi nota');
        assert.equal(local.application_note_draft.text, 'Mi nota', 'Preserve the draft on a failed write');
        assert(!failed.elements.get('applicationNote').disabled);
        failed.calls.length = 0;
        failed.context.fetch = async (url, options) => {
            const response = await originalFetch(url, options);
            return String(url).endsWith('I2') ? { ...response, json: async () => ({ values: [['Otra columna']] }) } : response;
        };
        await failed.elements.get('btnPostular').handlers.click();
        assert(!failed.calls.some(call => call.url.includes(':append')), 'Do not overwrite a different column');
        assert(failed.elements.get('status').textContent.includes('Notas'));
        failed.elements.get('applicationNote').value = 'x'.repeat(2001);
        failed.calls.length = 0;
        await failed.elements.get('btnPostular').handlers.click();
        assert.equal(failed.calls.length, 0, 'Reject oversized notes before network requests');
        failed.elements.get('applicationNote').value = '';
        failed.elements.get('applicationNote').handlers.input();
        assert(!local.application_note_draft, 'Delete the draft when the note is erased');

        const firstProgress = popup('progress.js', {}, {}, firefox);
        await firstProgress.ready();
        assert.equal(firstProgress.calls.length, 0, 'Progress respects consent');
        assert(!firstProgress.elements.get('progressRecovery').hidden);
        const progress = popup('progress.js', { ...config, privacy_consent: true }, local, firefox);
        await progress.ready();
        assert.equal(progress.elements.get('progressRows').children.length, 2, 'Exclude TOTAL from the chart');
        assert.equal(progress.elements.get('progressRows').children[0].children[1].textContent, '10');
        const bars = progress.elements.get('progressGraphics').children.filter(element => element.class === 'bar-fill');
        assert(Number(bars[0].height) > 0);
        assert.equal(bars[1].height, '0');
        assert.equal(progress.elements.get('progressGraphics').children.filter(element => element.class === 'goal-marker').length, 1, 'One shared goal line');
        assert(progress.elements.get('progressStatus').hidden);
        assert(progress.elements.get('progressLoading').hidden);
        assert(progress.calls.every(call => call.url.startsWith('https://sheets.googleapis.com/')));
        assert(progress.calls.some(call => call.url.includes('UNFORMATTED_VALUE')));
        assert.throws(() => vm.runInContext('parseProgressRows([["Semana 1", "#REF!", 25]])', progress.context), /enteros/);
        assert.throws(() => vm.runInContext('parseProgressRows([["Semana 1", -1, 25]])', progress.context), /enteros/);
        assert.equal(vm.runInContext('parseProgressRows([["Semana 1", 30, 25]])[0].count', progress.context), 30);
        const progressFetch = progress.context.fetch;
        let expired = true;
        progress.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            callback(`${params.get('redirect_uri')}#access_token=renewed-token&state=${params.get('state')}`);
        };
        progress.context.fetch = async (url, options) => {
            const response = await progressFetch(url, options);
            if (expired && String(url).includes('fields=')) { expired = false; return { ok: false, status: 401 }; }
            return String(url).includes('UNFORMATTED_VALUE')
                ? { ...response, json: async () => ({ values: Array.from({ length: 20 }, (_, i) => [`Semana ${i + 1}`, i, 25]) }) } : response;
        };
        await progress.elements.get('refreshProgress').handlers.click();
        assert.equal(progress.elements.get('progressRows').children.length, 12, 'Keep the initial chart compact');
        assert.equal(progress.elements.get('progressRows').children[0].children[0].textContent, 'Semana 9');
        assert(!progress.elements.get('progressChart').hidden, 'Renew an expired token and retry the read');
        assert.equal(progress.elements.get('weekRange').textContent, 'Semanas 9–20 de 20');
        assert(progress.elements.get('nextWeeks').disabled);
        const requestsBeforeNavigation = progress.calls.length;
        progress.elements.get('previousWeeks').handlers.click();
        assert.equal(progress.elements.get('progressRows').children.length, 8);
        assert.equal(progress.elements.get('weekRange').textContent, 'Semanas 1–8 de 20');
        assert(progress.elements.get('previousWeeks').disabled);
        progress.elements.get('previousWeeks').handlers.click();
        assert.equal(progress.elements.get('weekRange').textContent, 'Semanas 1–8 de 20');
        progress.elements.get('nextWeeks').handlers.click();
        assert.equal(progress.elements.get('weekRange').textContent, 'Semanas 9–20 de 20');
        progress.elements.get('progressPlot').parentElement.clientWidth = 304;
        progress.context.window.handlers.resize();
        assert.equal(progress.elements.get('progressRows').children.length, 3);
        assert.equal(progress.elements.get('weekRange').textContent, 'Semanas 18–20 de 20');
        const visited = new Set();
        do {
            for (const row of progress.elements.get('progressRows').children) visited.add(row.children[0].textContent);
            if (progress.elements.get('previousWeeks').disabled) break;
            progress.elements.get('previousWeeks').handlers.click();
        } while (true);
        assert.equal(visited.size, 20, 'Every week remains reachable on narrow screens');
        assert.equal(progress.calls.length, requestsBeforeNavigation, 'Pagination and resizing must not call Sheets');
        progress.elements.get('progressPlot').parentElement.clientWidth = 864;
        progress.context.fetch = async (url, options) => {
            const response = await progressFetch(url, options);
            return { ...response, json: async () => ({ values: [], sheets: [{ properties: { title: 'Progreso' } }] }) };
        };
        await progress.elements.get('refreshProgress').handlers.click();
        assert(progress.elements.get('progressChart').hidden);
        assert(progress.elements.get('progressStatus').textContent.includes('Todavía no hay semanas'));
        progress.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await progress.elements.get('refreshProgress').handlers.click();
        assert(progress.elements.get('progressStatus').textContent.includes('conexión'));
        assert(progress.elements.get('progressLoading').hidden, 'Hide the spinner after a failed load');
        assert(!progress.elements.get('refreshProgress').disabled);
    }

    for (const script of ['popup.js', 'options.js']) for (const firefox of [false, true]) {
        const local = {};
        const flow = popup(script, {}, local, firefox);
        assert.deepEqual(Array.from(vm.runInContext('GOOGLE_OAUTH_SCOPES', flow.context)), manifest.oauth2.scopes);
        let acceptState = false;
        flow.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            assert.equal(params.get('client_id'), vm.runInContext('WEB_OAUTH_CLIENT_ID', flow.context), 'Web flow must use the web OAuth client');
            assert.notEqual(params.get('client_id'), manifest.oauth2.client_id, 'Chrome and web clients must remain separate');
            const redirect = firefox ? 'http://127.0.0.1/mozoauth2/firefox-id' : 'https://test.chromiumapp.org/';
            assert.equal(params.get('redirect_uri'), redirect);
            assert(params.get('scope').includes(manifest.oauth2.scopes[0]));
            const state = new URL(url).searchParams.get('state');
            assert(state, 'OAuth requires state');
            callback(`${redirect}#access_token=test-token&state=${acceptState ? state : 'wrong'}`);
        };
        await assert.rejects(vm.runInContext('getAccessTokenViaWebFlow(true)', flow.context), /validar/);
        assert.equal(flow.writes.length, 0, 'Rejected OAuth response must not be cached');
        acceptState = true;
        assert.equal(await vm.runInContext('getGoogleAccessToken()', flow.context), 'test-token');
        assert.equal(await vm.runInContext('getGoogleAccessTokenSilently()', flow.context), 'test-token');
        local.google_token_expires_at = 0;
        assert.equal((await vm.runInContext('checkGoogleAuthStatus()', flow.context)).isConnected, true);
        assert(local.google_token_expires_at > Date.now());
        assert.equal(await vm.runInContext('forceNewGoogleToken("test-token")', flow.context), 'test-token');
        local.google_authorized_spreadsheet_id = 'test-sheet';
        await vm.runInContext('disconnectGoogle()', flow.context);
        assert(!local.google_access_token && !local.google_account_email && !local.google_authorized_spreadsheet_id);
        assert.equal(local.user_disconnected, true);
        assert.equal((await vm.runInContext('checkGoogleAuthStatus()', flow.context)).isConnected, false);
        assert.equal(await vm.runInContext('getAccessTokenViaWebFlow(true, true)', flow.context), 'test-token');
        assert(!local.user_disconnected);
    }

    const native = popup();
    const prompts = [];
    native.context.chrome.identity.getAuthToken = ({ interactive, scopes }, callback) => {
        assert.deepEqual(Array.from(scopes), [googleScope]);
        prompts.push(interactive);
        callback(interactive ? { token: 'native-token' } : undefined);
    };
    assert.equal(await vm.runInContext('getGoogleAccessToken()', native.context), 'native-token');
    assert.deepEqual(prompts, [false, true]);
    const invalidated = [];
    native.context.chrome.identity.removeCachedAuthToken = ({ token }, callback) => { invalidated.push(token); callback(); };
    native.context.chrome.identity.clearAllCachedAuthTokens = callback => callback();
    assert.equal(await vm.runInContext('forceNewGoogleToken("native-token")', native.context), 'native-token');
    assert.deepEqual(invalidated, ['native-token']);
    await vm.runInContext('disconnectGoogle()', native.context);
    assert.equal((await vm.runInContext('checkGoogleAuthStatus()', native.context)).isConnected, false);

    const brave = popup('options.js');
    brave.context.navigator.brave = { isBrave: async () => true };
    brave.context.chrome.identity.getAuthToken = () => assert.fail('Brave must use web OAuth');
    brave.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
        const params = new URL(url).searchParams;
        callback(`${params.get('redirect_uri')}#access_token=brave-token&state=${params.get('state')}`);
    };
    assert.equal(await vm.runInContext('getGoogleAccessToken()', brave.context), 'brave-token');

    for (const fragment of ['access_token=token&expires_in=invalid', 'access_token=token&expires_in=-1', 'access_token=token&scope=email', 'error=access_denied']) {
        const flow = popup('popup.js', {}, {}, true);
        flow.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            callback(`${params.get('redirect_uri')}#${fragment}&state=${params.get('state')}`);
        };
        await assert.rejects(vm.runInContext('getAccessTokenViaWebFlow(false)', flow.context));
        assert.equal(flow.writes.length, 0);
    }

    for (const firefox of [false, true]) {
        const sync = {}, local = {};
        const preferences = popup('options.js', sync, local, firefox);
        preferences.context.chrome.identity.getAuthToken = ({ interactive }, callback) => { assert(!interactive); callback(undefined); };
        preferences.context.chrome.identity.launchWebAuthFlow = ({ interactive }, callback) => { assert(!interactive); callback(undefined); };
        await preferences.ready();
        assert(!preferences.elements.get('aiStepContent').hidden);
        assert(preferences.elements.get('googleAccountCard').hidden);
        assert(preferences.elements.get('goalCard').hidden);
        preferences.elements.get('geminiApiKey').value = 'saved-key';
        preferences.elements.get('privacyConsent').checked = true;
        preferences.elements.get('cvGoal').value = 'not-a-goal';
        await preferences.elements.get('configForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.gemini_api_key, 'saved-key');
        assert.equal(sync.ai_provider, 'gemini');
        assert.equal(sync.privacy_consent, true);
        assert(!sync.spreadsheet_id && !sync.cv_goal, 'Saving keys must not save a sheet or goal');
        assert.equal(preferences.calls.length, 0, 'Saving keys must not call Google or Sheets');
        assert(preferences.elements.get('aiStepContent').hidden);
        assert(!preferences.elements.get('googleStepContent').hidden);
        assert(preferences.elements.get('goalCard').hidden);

        const reopened = popup('options.js', sync, local, firefox);
        await reopened.ready();
        assert.equal(reopened.elements.get('geminiApiKey').value, 'saved-key');
        assert(!reopened.elements.get('googleStepContent').hidden, 'Resume at the pending step');
        await reopened.elements.get('btnEditAI').handlers.click();
        reopened.elements.get('geminiApiKey').value = 'discarded-key';
        await reopened.elements.get('btnCancelEdit').handlers.click();
        assert.equal(reopened.elements.get('geminiApiKey').value, 'saved-key');
        assert(!reopened.elements.get('googleStepContent').hidden);
        preferences.elements.get('geminiApiKey').value = 'unsaved-key';
        preferences.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            callback(`${params.get('redirect_uri')}#picked_file_ids=first-sheet&access_token=picker-token&scope=${encodeURIComponent(googleScope)}&state=${params.get('state')}`);
        };
        await preferences.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(sync.gemini_api_key, 'saved-key', 'Picker preserves saved AI preferences');
        assert.equal(sync.spreadsheet_id, 'first-sheet');
        assert.equal(sync.cv_goal_spreadsheet_id, '');
        assert(!preferences.calls.some(call => call.options.method === 'PUT'), 'Choosing a sheet must not apply a goal');
        assert(!preferences.elements.get('goalStepContent').hidden);
        assert(preferences.elements.get('setupComplete').hidden);
        assert(!sync.setup_completed, 'A failed goal update must not end onboarding');
        const pendingGoal = popup('popup.js', sync, local, firefox);
        await pendingGoal.ready();
        assert.equal(pendingGoal.elements.get('btnConfigurar').textContent, 'Elegir objetivo');
        assert.equal(pendingGoal.calls.length, 0);
        for (const goal of ['0', '-1', '1.5', '2foo', '9007199254740992']) {
            preferences.elements.get('cvGoal').value = goal;
            await preferences.elements.get('goalForm').handlers.submit({ preventDefault() {} });
            assert(!sync.cv_goal, 'Invalid goals must not be persisted');
            assert(!preferences.calls.some(call => call.options.method === 'PUT'));
        }
        preferences.elements.get('cvGoal').value = '30';
        const originalFetch = preferences.context.fetch;
        preferences.context.fetch = async (url, options) => {
            assert(preferences.elements.get('btnCreateWeek').disabled, 'Goal saving must prevent concurrent week creation');
            const response = await originalFetch(url, options);
            return options?.method === 'PUT' ? { ok: false, status: 503, json: async () => ({}) } : response;
        };
        await preferences.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert(!sync.cv_goal);
        assert.equal(sync.spreadsheet_id, 'first-sheet');
        assert.equal(sync.gemini_api_key, 'saved-key');
        assert.equal(preferences.elements.get('goalStatus').className, 'status-msg warning');
        assert(preferences.elements.get('goalStatus').textContent.includes('Guardar objetivo para reintentar'));
        assert(preferences.elements.get('setupComplete').hidden);
        preferences.context.fetch = originalFetch;
        const originalSet = preferences.context.chrome.storage.sync.set;
        preferences.context.chrome.storage.sync.set = (values, callback) => {
            preferences.context.chrome.runtime.lastError = { message: 'Storage unavailable' };
            callback();
            delete preferences.context.chrome.runtime.lastError;
        };
        await preferences.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert(!sync.cv_goal, 'A failed local save must not complete setup even if Sheets succeeded');
        assert(!sync.setup_completed);
        assert(preferences.elements.get('setupComplete').hidden);
        assert(!preferences.elements.get('btnEditSheet').disabled, 'Unlock setup controls after a failed save');
        preferences.context.chrome.storage.sync.set = originalSet;
        await preferences.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.cv_goal, '30');
        assert.equal(sync.cv_goal_spreadsheet_id, 'first-sheet');
        assert.equal(sync.setup_completed, true);
        assert(!preferences.elements.get('setupComplete').hidden);
        assert(!preferences.elements.get('weeksCard').hidden);
        assert(!preferences.elements.get('aiStepContent').hidden);
        assert(!preferences.elements.get('googleStepContent').hidden);
        assert(!preferences.elements.get('goalStepContent').hidden, 'Completing onboarding expands every section');
        assert(preferences.elements.get('setupProgress').hidden);
        assert.deepEqual(JSON.parse(preferences.calls.find(call => call.options.method === 'PUT').options.body).values, [[30]]);
        const completed = popup('options.js', sync, local, firefox);
        await completed.ready();
        assert(completed.elements.get('setupComplete').hidden, 'The initial success notice disappears when settings are reopened');
        assert(completed.elements.get('setupProgress').hidden);
        assert(!completed.elements.get('aiStepContent').hidden);
        assert(!completed.elements.get('googleStepContent').hidden);
        assert(!completed.elements.get('goalStepContent').hidden);
        completed.elements.get('geminiApiKey').value = 'updated-key';
        await completed.elements.get('configForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.gemini_api_key, 'updated-key');
        assert.equal(completed.elements.get('status').textContent, 'Claves guardadas · Gemini.');
        assert(!completed.elements.get('aiStepContent').hidden, 'Saving preferences must not collapse normal settings');
        completed.elements.get('cvGoal').value = '35';
        await completed.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.cv_goal, '35');
        assert(completed.elements.get('setupComplete').hidden, 'Editing the goal must not repeat the initial success notice');
        assert.equal(completed.elements.get('goalStatus').textContent, 'Objetivo guardado.');
        await completed.elements.get('btnDisconnectGoogle').handlers.click();
        assert.equal(sync.setup_completed, true, 'Signing out must preserve onboarding completion');
        const signedOut = popup('options.js', sync, local, firefox);
        await signedOut.ready();
        assert(signedOut.elements.get('setupProgress').hidden);
        assert(!signedOut.elements.get('googleStepContent').hidden);
        assert(!signedOut.elements.get('goalStepContent').hidden, 'Reopening after logout must keep expanded settings');

        const legacySync = { gemini_api_key: 'legacy-key', privacy_consent: true, spreadsheet_id: 'legacy-sheet', cv_goal: '25' };
        const legacy = popup('options.js', legacySync, {}, firefox);
        await legacy.ready();
        assert.equal(legacySync.setup_completed, true, 'Migrate already configured users even when their session has expired');
        assert(legacy.elements.get('setupComplete').hidden, 'Existing users must not see the first-time completion notice');
        assert(legacy.elements.get('setupProgress').hidden);
        assert(!legacy.elements.get('aiStepContent').hidden);
        assert(!legacy.elements.get('googleStepContent').hidden);
        assert(!legacy.elements.get('goalStepContent').hidden);
    }

    for (const firefox of [false, true]) {
        for (const completed of [false, true]) {
            const sync = completed ? { setup_completed: true } : {};
            const preferences = popup('options.js', sync, {}, firefox);
            await preferences.ready();
            preferences.elements.get('aiGroq').checked = true;
            preferences.elements.get('groqApiKey').value = 'saved-groq-key';
            preferences.elements.get('privacyConsent').checked = true;
            await preferences.elements.get('configForm').handlers.submit({ preventDefault() {} });
            assert.equal(sync.groq_api_key, 'saved-groq-key');
            assert.equal(sync.ai_provider, 'groq');
            assert.equal(preferences.elements.get('aiSummaryText').textContent, 'Claves guardadas · Groq');
            assert.equal(preferences.elements.get(completed ? 'aiStepContent' : 'aiStepSummary').hidden, false);
            if (completed) {
                assert.equal(preferences.elements.get('status').className, 'status-msg success');
                assert.equal(preferences.elements.get('status').textContent, 'Claves guardadas · Groq.');
            }
            preferences.elements.get('geminiApiKey').value = 'saved-gemini-key';
            preferences.elements.get('aiGroq').checked = false;
            await preferences.elements.get('configForm').handlers.submit({ preventDefault() {} });
            assert.equal(sync.ai_provider, 'gemini');
            assert.equal(sync.groq_api_key, 'saved-groq-key');
            assert.equal(preferences.elements.get('aiSummaryText').textContent, 'Claves guardadas · Gemini y Groq', 'Confirm every saved key, including the backup provider');
            if (completed) assert.equal(preferences.elements.get('status').textContent, 'Claves guardadas · Gemini y Groq.');
            assert.equal(preferences.calls.length, 0, 'Saving AI keys must not send them to any API');
        }
    }

    for (const firefox of [false, true]) {
        const sync = { spreadsheet_id: 'old-sheet', current_week: 'Semana 5', gemini_api_key: 'saved-key', cv_goal: '30' };
        const local = { cached_weeks: ['Semana 5'] };
        const picker = popup('options.js', sync, local, firefox);
        await picker.ready();
        assert(!picker.elements.has('spreadsheetId'), 'Choose in Google without a URL input');
        picker.elements.get('geminiApiKey').value = 'unsaved-key';
        let response = 'new-sheet';
        picker.context.chrome.identity.launchWebAuthFlow = ({ url, interactive }, callback) => {
            const params = new URL(url).searchParams;
            assert.equal(interactive, true);
            assert.equal(params.get('scope'), googleScope, 'Picker must request only drive.file');
            assert.equal(params.get('trigger_onepick'), 'true');
            assert.equal(params.get('prompt'), 'consent');
            assert.equal(params.get('include_granted_scopes'), 'false');
            assert.equal(params.get('mimetypes'), 'application/vnd.google-apps.spreadsheet');
            assert(!params.has('file_ids'), 'Always let the user choose a spreadsheet');
            callback(`${params.get('redirect_uri')}?picked_file_ids=${response}#access_token=picker-token&scope=${encodeURIComponent(googleScope)}&state=${params.get('state')}`);
        };
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(picker.writes.length, 0, 'Consent is required before opening Picker');
        assert.equal(picker.elements.get('googleTemplateHelp').hidden, false, 'Show the template link until a spreadsheet is authorized');
        sync.privacy_consent = true;
        await picker.ready();
        const previousWrites = picker.writes.length;
        picker.elements.get('geminiApiKey').value = 'unsaved-key';
        response = 'invalid/id';
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(picker.writes.length, previousWrites, 'An invalid file must not be cached');
        assert.equal(sync.spreadsheet_id, 'old-sheet');
        response = 'new-sheet';
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(sync.spreadsheet_id, 'new-sheet', 'Authorization saves the selection automatically');
        assert.equal(sync.privacy_consent, true);
        assert.equal(sync.gemini_api_key, 'saved-key', 'Authorizing a sheet must preserve the saved preferences');
        assert.equal(sync.cv_goal, '30');
        assert(!picker.calls.some(call => call.options.method === 'PUT'), 'Confirm the goal separately after changing sheets');
        assert.equal(sync.cv_goal_spreadsheet_id, '');
        picker.elements.get('cvGoal').value = '30';
        await picker.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert(!local.cached_weeks && !sync.current_week, 'Authorization must clear the previous spreadsheet weeks');
        assert(picker.elements.get('googleStepSummary').hidden);
        assert(!picker.elements.get('googleStepContent').hidden);
        assert.equal(picker.elements.get('googleSpreadsheetLink').href, 'https://docs.google.com/spreadsheets/d/new-sheet/edit');
        assert.equal(local.google_token_scope, googleScope);
        assert.equal(picker.elements.get('btnConnectGoogle').style.display, 'inline-flex', 'Keep Picker available while connected');
        assert.equal(local.google_authorized_spreadsheet_id, 'new-sheet');
        assert.equal(picker.elements.get('btnConnectGoogle').textContent, 'Cambiar planilla');
        assert.equal(picker.elements.get('btnConnectGoogle').className, 'btn-save secondary');
        assert(picker.elements.get('googleAccountHelp').textContent.includes('está autorizada'));
        assert.equal(picker.elements.get('googleTemplateHelp').hidden, true, 'Hide the first-use template instructions once the spreadsheet is authorized');
        local.google_token_expires_at = 0;
        picker.context.chrome.identity.getAuthToken = () => assert.fail('Renew the selected account through web OAuth');
        picker.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            assert(!params.has('trigger_onepick'), 'Token renewal must not reopen Picker');
            callback(`${params.get('redirect_uri')}#access_token=renewed-token&state=${params.get('state')}`);
        };
        assert.equal(await vm.runInContext('getGoogleAccessTokenSilently()', picker.context), 'renewed-token');
        picker.elements.get('geminiApiKey').value = 'test-key';
        picker.elements.get('cvGoal').value = '25';
        local.cached_weeks = ['Semana 1'];
        sync.current_week = 'Semana 1';
        await picker.elements.get('configForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.spreadsheet_id, 'new-sheet');
        assert.equal(sync.cv_goal, '30', 'Saving keys must preserve the saved goal');
        await picker.elements.get('btnEditGoal').handlers.click();
        await picker.elements.get('goalForm').handlers.submit({ preventDefault() {} });
        assert.equal(sync.cv_goal, '25');
        assert.equal(picker.elements.get('googleStatus').textContent, '', 'Authorization has no redundant save reminder');
        assert.equal(picker.elements.get('googleStatus').className, 'status-msg', 'Hide the cleared confirmation instead of leaving an empty success box');
        assert.equal(local.cached_weeks[0], 'Semana 1', 'Saving other preferences must preserve the selected spreadsheet weeks');
        assert.equal(sync.current_week, 'Semana 1');

        const reopened = popup('options.js', sync, local, firefox);
        await reopened.ready();
        await vm.runInContext('updateGoogleAccountUI()', reopened.context);
        assert.equal(reopened.elements.get('btnConnectGoogle').textContent, 'Cambiar planilla', 'Remember authorization after reopening settings');

        let cancelled = true;
        let selectedSheet = 'next-sheet';
        picker.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            assert(!params.has('file_ids'), 'Change spreadsheet must allow choosing any spreadsheet');
            const result = cancelled ? 'error=access_denied' : `picked_file_ids=${selectedSheet}&access_token=next-token&scope=${encodeURIComponent(googleScope)}`;
            callback(`${params.get('redirect_uri')}#${result}&state=${params.get('state')}`);
        };
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(picker.elements.get('btnConnectGoogle').textContent, 'Cambiar planilla', 'Cancelling a change keeps the existing authorized file');
        assert.equal(local.google_authorized_spreadsheet_id, 'new-sheet');
        assert.equal(sync.spreadsheet_id, 'new-sheet', 'Cancelling must preserve the saved selection');
        cancelled = false;
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(local.google_authorized_spreadsheet_id, 'next-sheet');
        assert.equal(picker.elements.get('googleSpreadsheetLink').href, 'https://docs.google.com/spreadsheets/d/next-sheet/edit');
        assert.equal(sync.spreadsheet_id, 'next-sheet', 'Changing a sheet saves immediately');
        assert(!local.cached_weeks && !sync.current_week);
        const changed = popup('options.js', sync, local, firefox);
        await changed.ready();
        assert(changed.elements.get('setupProgress').hidden, 'Changing sheets must not restart onboarding');
        assert(!changed.elements.get('aiStepContent').hidden);
        assert(!changed.elements.get('googleStepContent').hidden);
        assert(!changed.elements.get('goalStepContent').hidden);
        assert.equal(sync.cv_goal_spreadsheet_id, '', 'The new sheet still requires goal confirmation');

        const nativeSet = picker.context.chrome.storage.sync.set;
        selectedSheet = 'failed-sheet';
        picker.context.chrome.storage.sync.set = (values, callback) => {
            picker.context.chrome.runtime.lastError = { message: 'Storage quota exceeded' };
            callback();
            delete picker.context.chrome.runtime.lastError;
        };
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(sync.spreadsheet_id, 'next-sheet');
        assert(picker.elements.get('googleStatus').textContent.includes('no se pudo guardar'), 'A failed write must not report success');
        assert.equal(picker.elements.get('googleStatus').className, 'status-msg error');
        picker.context.chrome.storage.sync.set = nativeSet;
        await picker.elements.get('btnConnectGoogle').handlers.click();
        assert.equal(picker.elements.get('googleStatus').textContent, '', 'Selecting again retries a failed automatic write');
        assert.equal(sync.spreadsheet_id, 'failed-sheet');

        const nativeRemove = picker.context.chrome.storage.local.remove;
        picker.context.chrome.storage.local.remove = (keys, callback) => {
            picker.context.chrome.runtime.lastError = { message: 'Storage unavailable' };
            callback();
            delete picker.context.chrome.runtime.lastError;
        };
        await assert.rejects(vm.runInContext('saveConfig({ spreadsheet_id: "unsafe-change" })', picker.context));
        assert.equal(sync.spreadsheet_id, 'failed-sheet', 'Do not switch sheets if the old week cache cannot be cleared');
        picker.context.chrome.storage.local.remove = nativeRemove;
        await picker.elements.get('btnDisconnectGoogle').handlers.click();
        assert.equal(picker.elements.get('btnConnectGoogle').textContent, 'Autorizar planilla');
        assert(!local.google_authorized_spreadsheet_id);
    }

    for (const fragment of ['', 'picked_file_ids=one,two', 'picked_file_ids=invalid/id', 'error=access_denied', 'picked_file_ids=sheet&scope=email', 'picked_file_ids=sheet&expires_in=invalid']) {
        const picker = popup('options.js', {}, {}, true);
        picker.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
            const params = new URL(url).searchParams;
            assert(!params.has('file_ids'), 'An empty input opens the full spreadsheet list');
            callback(`${params.get('redirect_uri')}#${fragment}&access_token=picker-token&state=${params.get('state')}`);
        };
        await assert.rejects(vm.runInContext('pickGoogleSpreadsheet()', picker.context));
        assert.equal(picker.writes.length, 0, 'Cancelled or invalid Picker responses must not change storage');
    }

    const untrustedPicker = popup('options.js');
    untrustedPicker.context.chrome.identity.launchWebAuthFlow = ({ url }, callback) => {
        const params = new URL(url).searchParams;
        callback(`${params.get('redirect_uri')}#picked_file_ids=sheet&access_token=token&state=wrong`);
    };
    await assert.rejects(vm.runInContext('pickGoogleSpreadsheet()', untrustedPicker.context), /validar/);
    assert.equal(untrustedPicker.writes.length, 0);
    await assert.rejects(vm.runInContext('pickGoogleSpreadsheet("invalid/id")', untrustedPicker.context), /válido/);

    for (const scope of [undefined, 'https://www.googleapis.com/auth/spreadsheets']) {
        const local = { google_access_token: 'old-token', google_token_expires_at: Date.now() + 3600000, google_token_scope: scope };
        const migration = popup('options.js', {}, local);
        const removed = [];
        migration.context.chrome.identity.removeCachedAuthToken = ({ token }, callback) => { removed.push(token); callback(); };
        migration.context.chrome.identity.getAuthToken = ({ scopes }, callback) => {
            assert.deepEqual(Array.from(scopes), [googleScope]);
            callback('new-token');
        };
        assert.equal(await vm.runInContext('getGoogleAccessToken()', migration.context), 'new-token');
        assert.deepEqual(removed, ['old-token']);
        assert.equal(local.google_token_scope, googleScope);
    }

    const permissionError = await vm.runInContext('sheetsError({ status: 403, json: async () => ({error:{message:"Permission denied"}}) }, "Error al acceder")', popup().context);
    assert(permissionError.message.includes('Autorizar planilla'));

    const firstOptions = popup('options.js');
    await firstOptions.ready();
    assert.equal(firstOptions.elements.get('privacyDisclosure').open, true);
    const returningOptions = popup('options.js', { privacy_consent: true });
    await returningOptions.ready();
    assert.equal(returningOptions.elements.get('privacyDisclosure').open, false);

    const options = popup('options.js', { spreadsheet_id: 'test-sheet' });
    await options.ready();
    options.elements.get('geminiApiKey').value = 'test-key';
    options.elements.get('cvGoal').value = '25';
    await options.elements.get('configForm').handlers.submit({ preventDefault() {} });
    assert.equal(options.writes.length, 0, 'Consent is required before saving');
    options.elements.get('privacyConsent').checked = true;
    options.elements.get('cvGoal').value = '0';
    await options.elements.get('goalForm').handlers.submit({ preventDefault() {} });
    assert.equal(options.writes.length, 0, 'Invalid goals must not be saved');

    const gemini = popup();
    gemini.context.fetch = async (url, options) => {
        gemini.calls.push({ url, options });
        if (url.includes('gemini-3.5-flash-lite:')) {
            return { ok: false, status: 404, text: async () => '{"error":{"message":"Model unavailable"}}' };
        }
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"company":"Example","title":"Engineer","source":"Example"}' }] } }] }) };
    };
    const extracted = await vm.runInContext('runGemini("test-key", "job text", () => {})', gemini.context);
    assert.equal(extracted.company, 'Example');
    assert.equal(extracted.title, 'Engineer');
    assert.equal(gemini.calls.length, 2);
    assert(gemini.calls[1].url.includes('/gemini-3.6-flash:generateContent?'));
    assert.equal(JSON.parse(gemini.calls[1].options.body).generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert(!gemini.calls.some(call => call.url.includes('/gemini-3.5-flash:')), 'Do not use the deprecated Flash model');
    console.log('Checks passed: Chrome/Firefox registration and notes, progress, consent, drive.file migration, one-time guided setup and expanded settings, temporary completion notice, independent keys/goal saving, Picker validation/cancellation/save, OAuth renewal/disconnect, Gemini 3.6 fallback and input validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
