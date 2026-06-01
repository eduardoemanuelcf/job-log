const withTimeout = (promise, ms, errorMessage) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(errorMessage));
        }, ms);
        promise
            .then((res) => {
                clearTimeout(timer);
                resolve(res);
            })
            .catch((err) => {
                clearTimeout(timer);
                reject(err);
            });
    });
};

const getGoogleAccessToken = async () => {
    const cached = await new Promise((resolve) => {
        chrome.storage.local.get(['google_access_token', 'google_token_expires_at'], (result) => {
            resolve(result || {});
        });
    });

    if (cached.google_access_token && cached.google_token_expires_at && cached.google_token_expires_at > Date.now() + 120000) {
        return cached.google_access_token;
    }

    const isBrave = navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave();
    
    if (isBrave) {
        return getAccessTokenViaWebFlow(true);
    }

    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (t) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(t);
                }
            });
        });
        return token;
    } catch (err) {
        return getAccessTokenViaWebFlow(true);
    }
};

const getGoogleAccessTokenSilently = async () => {
    const cached = await new Promise((resolve) => {
        chrome.storage.local.get(['google_access_token', 'google_token_expires_at'], (result) => {
            resolve(result || {});
        });
    });

    if (cached.google_access_token && cached.google_token_expires_at && cached.google_token_expires_at > Date.now() + 120000) {
        return cached.google_access_token;
    }

    const isBrave = navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave();
    if (isBrave) {
        return getAccessTokenViaWebFlow(false);
    }

    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(t);
                }
            });
        });
        return token;
    } catch (err) {
        return getAccessTokenViaWebFlow(false);
    }
};

const getAccessTokenViaWebFlow = async (interactive) => {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2.client_id;
    const scopes = manifest.oauth2.scopes.join(' ');
    const redirectUri = chrome.identity.getRedirectURL();

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=token&` +
        `scope=${encodeURIComponent(scopes)}`;

    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: interactive
        }, (redirectUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!redirectUrl) {
                reject(new Error('No se recibio la URL de redireccion.'));
                return;
            }
            resolve(extractAndCacheToken(redirectUrl));
        });
    });
};

const extractAndCacheToken = async (redirectUrl) => {
    try {
        const params = new URLSearchParams(redirectUrl.split('#')[1]);
        const accessToken = params.get('access_token');
        const expiresIn = params.get('expires_in') || '3600';
        
        if (accessToken) {
            const expiresAt = Date.now() + parseInt(expiresIn, 10) * 1000;
            await new Promise((res) => {
                chrome.storage.local.set({
                    google_access_token: accessToken,
                    google_token_expires_at: expiresAt
                }, res);
            });
            return accessToken;
        } else {
            throw new Error('No se pudo extraer el token de acceso.');
        }
    } catch (e) {
        throw new Error(`Error al procesar la respuesta: ${e.message}`);
    }
};

const CONFIG_KEYS = ['gemini_api_key', 'spreadsheet_id', 'cv_goal', 'current_week'];

const loadConfig = async () => {
    const synced = await new Promise((resolve) => {
        chrome.storage.sync.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    if (synced.gemini_api_key || synced.spreadsheet_id) {
        return synced;
    }
    const local = await new Promise((resolve) => {
        chrome.storage.local.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    if (local.gemini_api_key || local.spreadsheet_id) {
        const toSync = {};
        CONFIG_KEYS.forEach((k) => {
            if (local[k] !== undefined) toSync[k] = local[k];
        });
        chrome.storage.sync.set(toSync);
        return local;
    }
    return synced;
};

const renderWeeks = (weeks, selected) => {
    const select = document.getElementById('semanaSelect');
    if (!Array.isArray(weeks) || weeks.length === 0) return false;

    const current = select.value;
    const desired = (selected && weeks.includes(selected))
        ? selected
        : (weeks.includes(current) ? current : weeks[weeks.length - 1]);

    select.innerHTML = '';
    for (const w of weeks) {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = w;
        select.appendChild(opt);
    }
    select.value = desired;
    return true;
};

const loadWeeksFromSheets = async (spreadsheetId, token, selected) => {
    try {
        const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!metaResponse.ok) return false;
        const metaData = await metaResponse.json();

        let exactProgresoTitle = '';
        for (const s of metaData.sheets || []) {
            if (s.properties && s.properties.title && s.properties.title.trim().toLowerCase() === 'progreso semanal') {
                exactProgresoTitle = s.properties.title;
                break;
            }
            if (s.properties && s.properties.title && s.properties.title.trim().toLowerCase() === 'progreso') {
                exactProgresoTitle = s.properties.title;
            }
        }

        if (!exactProgresoTitle) return false;

        const getResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${exactProgresoTitle}'!A5:A`)}`,
            {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!getResponse.ok) return false;
        const data = await getResponse.json();
        const rows = data.values || [];

        const weeks = [];
        for (const row of rows) {
            if (row && row[0] && row[0].trim() !== '' && row[0].trim().toUpperCase() !== 'TOTAL') {
                weeks.push(row[0].trim());
            }
        }

        if (weeks.length === 0) return false;

        chrome.storage.local.set({ cached_weeks: weeks });

        const ok = renderWeeks(weeks, selected);
        if (ok) {
            chrome.storage.sync.set({ current_week: document.getElementById('semanaSelect').value });
        }
        return ok;
    } catch (e) {
        console.warn('[Job Log] Error al cargar semanas:', e);
        return false;
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    const normalArea = document.getElementById('normalArea');
    const configRequiredArea = document.getElementById('configRequiredArea');
    const btnConfigurar = document.getElementById('btnConfigurar');
    const btnPostular = document.getElementById('btnPostular');
    const status = document.getElementById('status');

    btnConfigurar.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    document.getElementById('openOptions').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    document.getElementById('semanaSelect').addEventListener('change', (e) => {
        chrome.storage.sync.set({ current_week: e.target.value });
    });

    btnPostular.addEventListener('click', handlePostular);

    try {
        const config = await loadConfig();
        const cache = await new Promise((resolve) => {
            chrome.storage.local.get(['cached_weeks'], (result) => resolve(result || {}));
        });
        const credentials = { ...config, cached_weeks: cache.cached_weeks };

        if (!credentials.gemini_api_key || !credentials.spreadsheet_id) {
            normalArea.style.display = 'none';
            configRequiredArea.style.display = 'flex';
            return;
        }

        let spreadsheetId = credentials.spreadsheet_id.trim();
        const sheetIdMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetIdMatch) {
            spreadsheetId = sheetIdMatch[1];
        }

        const hasCache = renderWeeks(credentials.cached_weeks, credentials.current_week);
        if (hasCache) {
            btnPostular.disabled = false;
        }

        try {
            const token = hasCache
                ? await getGoogleAccessTokenSilently()
                : await getGoogleAccessToken();
            if (token) {
                const ok = await loadWeeksFromSheets(spreadsheetId, token, credentials.current_week);
                if (ok) {
                    btnPostular.disabled = false;
                }
            }
        } catch (e) {
            console.log('[Job Log] No se pudieron actualizar las semanas.');
            if (!hasCache) {
                document.getElementById('semanaSelect').innerHTML = '<option value="" disabled selected>No se pudieron cargar las semanas</option>';
            }
        }

    } catch (err) {
        console.error('[Job Log] Error al cargar:', err);
        normalArea.style.display = 'none';
        configRequiredArea.style.display = 'flex';
        return;
    }

    async function handlePostular() {
        if (!document.getElementById('semanaSelect').value) {
            status.className = 'status-text error';
            status.textContent = 'Las semanas aún se están cargando.';
            return;
        }
        btnPostular.disabled = true;
        status.className = 'status-text loading';
        status.innerHTML = '<span class="spinner"></span> Leyendo pagina...';

        try {
            const credentials = await new Promise((resolve) => {
                chrome.storage.sync.get(['gemini_api_key', 'spreadsheet_id'], (result) => {
                    resolve(result || {});
                });
            });

            if (!credentials.gemini_api_key || !credentials.spreadsheet_id) {
                throw new Error('Falta configurar la API Key de Gemini o la URL de Google Sheets');
            }

            let spreadsheetId = credentials.spreadsheet_id.trim();
            const sheetIdMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (sheetIdMatch) {
                spreadsheetId = sheetIdMatch[1];
            }

            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true
            });

            if (!tab || !tab.id) {
                throw new Error('No se pudo detectar la pestaña activa');
            }

            const results = await withTimeout(
                new Promise((resolve, reject) => {
                    chrome.scripting.executeScript(
                        {
                            target: { tabId: tab.id },
                            func: async () => {
                                try {
                                    let url = window.location.href;
                                    let jobId = null;
                                    const currentJobIdMatch = url.match(/currentJobId=(\d+)/);
                                    const viewJobIdMatch = url.match(/\/jobs\/view\/(\d+)/);
                                    if (currentJobIdMatch) {
                                        jobId = currentJobIdMatch[1];
                                    } else if (viewJobIdMatch) {
                                        jobId = viewJobIdMatch[1];
                                    }
                                    if (jobId) {
                                        url = `https://www.linkedin.com/jobs/view/${jobId}/`;
                                    }

                                    const host = window.location.hostname.replace(/^www\./, '');
                                    const COMPOUND_TLD = ['com.ar', 'com.br', 'com.mx', 'co.uk', 'com.co', 'com.pe', 'com.uy'];
                                    let withoutTld = host;
                                    for (const tld of COMPOUND_TLD) {
                                        if (withoutTld.endsWith('.' + tld)) {
                                            withoutTld = withoutTld.slice(0, -(tld.length + 1));
                                            break;
                                        }
                                    }
                                    const labels = withoutTld.split('.');
                                    const brand = (labels.length > 1 ? labels[labels.length - 2] : labels[0]) || host;

                                    const BRAND_MAP = {
                                        'linkedin': 'LinkedIn',
                                        'bumeran': 'Bumeran',
                                        'empleosit': 'Empleos IT',
                                        'computrabajo': 'Computrabajo',
                                        'indeed': 'Indeed'
                                    };
                                    const source = BRAND_MAP[brand] || (brand.charAt(0).toUpperCase() + brand.slice(1));

                                    const getVisibleElement = (selector) => {
                                        const elements = document.querySelectorAll(selector);
                                        for (const el of elements) {
                                            const rect = el.getBoundingClientRect();
                                            if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden') {
                                                return el;
                                            }
                                        }
                                        return null;
                                    };

                                    const DETAIL_SELECTORS = '.jobs-search__job-details--wrapper, .jobs-search__job-details, .jobs-details__main-content, .scaffold-layout__detail, .jobs-search-two-pane__job-details, .job-details-jobs-unified-top-card, .jobs-unified-top-card, .jobs-details, .job-view-layout, .jobs-description';

                                    const firstLine = (s) => {
                                        if (!s) return '';
                                        const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
                                        return lines.length ? lines[0] : s.trim();
                                    };

                                    const pickIn = (scope, sel) => {
                                        if (!scope) return '';
                                        const selectors = sel.split(',').map(s => s.trim());
                                        for (const selector of selectors) {
                                            const elements = scope.querySelectorAll(selector);
                                            for (const el of elements) {
                                                const rect = el.getBoundingClientRect();
                                                if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none') {
                                                    const t = el.innerText.trim();
                                                    if (t) return t;
                                                }
                                            }
                                        }
                                        for (const selector of selectors) {
                                            const el = scope.querySelector(selector);
                                            if (el && el.innerText.trim()) return el.innerText.trim();
                                        }
                                        return '';
                                    };

                                    const detailPanel =
                                        getVisibleElement('.jobs-search__job-details--wrapper') ||
                                        getVisibleElement('.jobs-search__job-details') ||
                                        getVisibleElement('.jobs-details__main-content') ||
                                        getVisibleElement('.scaffold-layout__detail') ||
                                        getVisibleElement('.jobs-search-two-pane__job-details') ||
                                        getVisibleElement('.jobs-details') ||
                                        getVisibleElement('.job-view-layout') ||
                                        getVisibleElement('.jobs-description');

                                    let jobAnchor = null;
                                    if (jobId) {
                                        jobAnchor =
                                            getVisibleElement(`a[href*="/jobs/view/${jobId}"]`) ||
                                            getVisibleElement(`[data-job-id="${jobId}"]`) ||
                                            getVisibleElement(`[data-occludable-job-id="${jobId}"]`);
                                    }

                                    let titleEl =
                                        getVisibleElement('.job-details-jobs-unified-top-card__job-title') ||
                                        getVisibleElement('.jobs-unified-top-card__job-title');
                                    if (!titleEl && detailPanel) {
                                        titleEl = detailPanel.querySelector('h1') || detailPanel.querySelector('h2');
                                    }
                                    if (!titleEl) {
                                        titleEl = getVisibleElement('h1');
                                    }

                                    let domTitle = titleEl ? firstLine(titleEl.innerText || titleEl.getAttribute('aria-label') || '') : '';
                                    if (!domTitle && jobAnchor) {
                                        domTitle = firstLine(jobAnchor.innerText || '') || firstLine(jobAnchor.getAttribute('aria-label') || '');
                                    }

                                    let companyScope = detailPanel;
                                    if (!companyScope && titleEl) {
                                        let node = titleEl;
                                        for (let i = 0; i < 6 && node; i++) {
                                            if (node.querySelector && node.querySelector('a[href*="/company/"]')) {
                                                companyScope = node;
                                                break;
                                            }
                                            node = node.parentElement;
                                        }
                                        if (!companyScope) {
                                            companyScope = titleEl.closest(DETAIL_SELECTORS) || titleEl.parentElement;
                                        }
                                    }

                                    let domCompany = firstLine(pickIn(
                                        companyScope,
                                        '.job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__primary-description-container a[href*="/company/"], .artdeco-entity-lockup__subtitle, a[href*="/company/"]'
                                    ));

                                    const textScope = detailPanel || document.querySelector('main') || document.body;
                                    const fullText = textScope ? textScope.innerText : '';
                                    let text = fullText.substring(0, 6000);

                                    let verified = false;
                                    if (source === 'LinkedIn' && jobId) {
                                        try {
                                            const csrf = (document.cookie.match(/JSESSIONID="?([^";]+)"?/) || [])[1];
                                            if (csrf) {
                                                const apiGet = async (apiUrl) => {
                                                    const ctrl = new AbortController();
                                                    const abortTimer = setTimeout(() => ctrl.abort(), 6000);
                                                    try {
                                                        const r = await fetch(apiUrl, {
                                                            headers: { 'csrf-token': csrf, 'accept': 'application/json' },
                                                            credentials: 'include',
                                                            signal: ctrl.signal
                                                        });
                                                        clearTimeout(abortTimer);
                                                        return r.ok ? await r.json() : null;
                                                    } catch (e) {
                                                        clearTimeout(abortTimer);
                                                        return null;
                                                    }
                                                };
                                                const j = await apiGet(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}`);
                                                if (j && j.title) {
                                                    domTitle = String(j.title).trim();
                                                    verified = true;
                                                    let comp = '';
                                                    if (j.urlPathSegment) {
                                                        const seg = String(j.urlPathSegment).replace(new RegExp('-' + jobId + '$'), '');
                                                        const at = seg.lastIndexOf('-at-');
                                                        if (at !== -1) {
                                                            comp = seg.substring(at + 4).replace(/-/g, ' ').trim();
                                                        }
                                                    }
                                                    if (comp) domCompany = comp;
                                                    let companyId = '';
                                                    try {
                                                        const cm = JSON.stringify(j.companyDetails || {}).match(/fs_normalized_company:(\d+)/);
                                                        if (cm) companyId = cm[1];
                                                    } catch (_) {}
                                                    if (companyId) {
                                                        const cj = await apiGet(`https://www.linkedin.com/voyager/api/organization/companies/${companyId}`);
                                                        const name = cj ? ((cj.data && cj.data.name) || cj.name) : '';
                                                        if (name) domCompany = String(name).trim();
                                                    }
                                                    let desc = '';
                                                    if (j.description) {
                                                        desc = typeof j.description === 'string' ? j.description : (j.description.text || '');
                                                    }
                                                    text = `${domTitle}\n${domCompany}\n${desc}`.substring(0, 6000);
                                                }
                                            }
                                        } catch (_) {}
                                    }

                                    if (!verified) {
                                        const bodyText = (document.body && document.body.innerText) || fullText || '';
                                        const rawLines = bodyText.split('\n').map((l) => l.trim());
                                        const BADGE = /^(empresa\s+)?(verificad[ao]s?|confidencial)$/i;
                                        const cleanVal = (v) => v.replace(/\s+logo$/i, '').trim();
                                        const takeAfter = (re) => {
                                            for (let i = 0; i < rawLines.length; i++) {
                                                const m = rawLines[i].match(re);
                                                if (!m) continue;
                                                let val = (m[1] || '').trim();
                                                if (!val || BADGE.test(val)) {
                                                    val = '';
                                                    for (let k = i + 1; k < rawLines.length; k++) {
                                                        if (rawLines[k] && !BADGE.test(rawLines[k])) { val = rawLines[k]; break; }
                                                    }
                                                }
                                                val = cleanVal(val);
                                                if (val && !BADGE.test(val) && val.length >= 2 && val.length <= 80) return val;
                                            }
                                            return '';
                                        };
                                        const labelCompany = takeAfter(/^acerca de\s+(.+)$/i) || takeAfter(/^empresa\b\s*:?\s*(.*)$/i);
                                        if (labelCompany) domCompany = labelCompany;
                                    }

                                    if (!verified && /(^|\.)computrabajo\./i.test(window.location.hostname)) {
                                        const bd = getVisibleElement('.box_detail') || document.querySelector('.box_detail');
                                        if (bd) {
                                            const bdLines = bd.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
                                            if (bdLines.length) {
                                                domTitle = bdLines[0];
                                                text = bd.innerText.substring(0, 6000);
                                                const strip = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\b(vista|postulado|nuevo|destacado)\b/g, '').trim();
                                                const key = strip(domTitle);
                                                if (key) {
                                                    const links = document.querySelectorAll('a[href*="/ofertas-de-trabajo/"], a[href*="oferta-de-"]');
                                                    for (const a of links) {
                                                        const t = strip(a.innerText);
                                                        if (t && (t === key || t.indexOf(key) === 0 || key.indexOf(t) === 0)) {
                                                            let href = a.getAttribute('href');
                                                            if (href) {
                                                                if (href.charAt(0) === '/') href = window.location.origin + href;
                                                                url = href.split('?')[0];
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                                if (domCompany) verified = true;
                                            }
                                        }
                                    }

                                    if (!text && (domTitle || domCompany)) {
                                        text = `${domTitle} ${domCompany}`.trim();
                                    }

                                    if (!domTitle && !domCompany && !text) {
                                        return {
                                            error: 'No se pudieron leer los datos de la oferta. Recargá la página (F5) y registrala de nuevo.'
                                        };
                                    }

                                    return { url, text, domTitle, domCompany, source, verified };
                                } catch (e) {
                                    return { error: e.message };
                                }
                            }
                        },
                        (resultArray) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (!resultArray || !resultArray[0]) {
                                reject(new Error('No se pudo extraer el contenido de la página'));
                            } else {
                                resolve(resultArray[0].result);
                            }
                        }
                    );
                }),
                10000,
                'Tiempo de espera agotado al extraer datos de la página.'
            );

            if (results.error) {
                throw new Error(`Error en el contenido de la página: ${results.error}`);
            }

            const { url, text, domTitle, domCompany } = results;
            const detectedSource = results.source || 'LinkedIn';
            const source = detectedSource;
            let company;
            let title;

            if (results.verified && domTitle && domCompany) {
                company = domCompany;
                title = domTitle;
            } else {

            status.innerHTML = '<span class="spinner"></span> Analizando con Gemini...';

            const hintBlock = (domTitle || domCompany)
                ? `\nDatos detectados de la oferta principal (referencia PRINCIPAL; no los reemplaces por otra oferta del listado o sidebar):\n- Título: ${domTitle || '(no detectado)'}\n- Empresa: ${domCompany || '(no detectado)'}\n`
                : '';

            const promptText = `Analiza el siguiente texto de una oferta de empleo y extrae los datos en un formato JSON estructurado. El texto puede incluir menús, barras laterales y secciones de "Trabajos Similares" u "Ofertas Guardadas" con OTRAS ofertas y empresas: ignoralas por completo y extraé solo los datos de la oferta principal (la de la descripción del puesto). La empresa contratante suele figurar junto a una etiqueta "Empresa". El JSON debe contener exactamente tres campos de tipo string:
- "company": el nombre de la empresa contratante de la oferta principal.
- "title": el título del puesto de la oferta principal.
- "source": debe ser el string exacto "${detectedSource}".
${hintBlock}
Texto a analizar:
${text}`;

            const geminiBody = {
                contents: [
                    {
                        parts: [
                            { text: promptText }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            company: { type: 'STRING' },
                            title: { type: 'STRING' },
                            source: { type: 'STRING' }
                        },
                        required: ['company', 'title', 'source']
                    }
                }
            };

            const GEMINI_MODELS = [
                'gemini-2.5-flash-lite',
                'gemini-2.5-flash',
                'gemini-2.0-flash-lite'
            ];

            let geminiData = null;
            let quotaHint = '';
            let lastError = null;
            let had429 = false;

            for (let i = 0; i < GEMINI_MODELS.length; i++) {
                const model = GEMINI_MODELS[i];
                if (i > 0) {
                    status.innerHTML = `<span class="spinner"></span> Reintentando con ${model}...`;
                }

                let response;
                try {
                    response = await withTimeout(
                        fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.gemini_api_key}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(geminiBody)
                            }
                        ),
                        20000,
                        'Tiempo de espera agotado al conectar con Gemini'
                    );
                } catch (e) {
                    lastError = e.message;
                    continue;
                }

                if (response.status === 429) {
                    try {
                        const errData = await response.json();
                        const retryDetail = (errData.error?.details || []).find(
                            (d) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
                        );
                        if (retryDetail?.retryDelay) {
                            const secs = Math.ceil(parseFloat(retryDetail.retryDelay));
                            if (secs >= 3600) {
                                quotaHint = ' Probá de nuevo mañana.';
                            } else if (secs >= 60) {
                                quotaHint = ` Probá de nuevo en ${Math.ceil(secs / 60)} min.`;
                            } else {
                                quotaHint = ` Probá de nuevo en ${secs} s.`;
                            }
                        }
                    } catch (_) {
                    }
                    lastError = 429;
                    had429 = true;
                    continue;
                }

                if (!response.ok) {
                    lastError = `status ${response.status}`;
                    continue;
                }

                const data = await response.json();
                if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
                    lastError = 'respuesta inválida';
                    continue;
                }

                let parsedData;
                try {
                    parsedData = JSON.parse(data.candidates[0].content.parts[0].text);
                } catch (_) {
                    lastError = 'respuesta inválida';
                    continue;
                }

                if (!parsedData.company || !parsedData.title) {
                    lastError = 'incompletos';
                    continue;
                }

                company = parsedData.company;
                title = parsedData.title;
                geminiData = data;
                break;
            }

            if (!geminiData) {
                if (had429) {
                    throw new Error(`Se agotó la cuota gratuita de Gemini por hoy.${quotaHint}`);
                }
                if (lastError === 'incompletos') {
                    throw new Error('Gemini no pudo extraer la empresa y el título de la oferta.');
                }
                throw new Error('No se pudo obtener una respuesta válida de Gemini.');
            }

            }

            if (domCompany) {
                company = domCompany;
            }

            if (!company || !title || !source) {
                throw new Error('No se pudieron determinar los datos de la oferta.');
            }

            status.innerHTML = '<span class="spinner"></span> Solicitando permisos de Google...';

            const token = await withTimeout(
                getGoogleAccessToken(),
                90000,
                'Tiempo de espera agotado en la autenticación de Google.'
            );

            status.innerHTML = '<span class="spinner"></span> Conectando con Google Sheets...';

            const metaPromise = fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            const metaResponse = await withTimeout(
                metaPromise,
                15000,
                'Tiempo de espera agotado al leer la estructura de tu Google Sheet.'
            );

            if (!metaResponse.ok) {
                throw new Error(`Error al conectar con Google Sheets (Status: ${metaResponse.status}).`);
            }

            const metaData = await metaResponse.json();
            const sheetList = metaData.sheets || [];
            
            let exactSheetTitle = '';
            const targetNameClean = 'postulaciones';
            const availableSheets = [];

            for (const s of sheetList) {
                if (s.properties && s.properties.title) {
                    const title = s.properties.title;
                    availableSheets.push(title);
                    if (title.trim().toLowerCase() === targetNameClean) {
                        exactSheetTitle = title;
                    }
                }
            }

            if (!exactSheetTitle) {
                throw new Error(`No se encontró la pestaña Postulaciones.`);
            }

            const semana = document.getElementById('semanaSelect').value;

            status.innerHTML = '<span class="spinner"></span> Registrando en Google Sheets...';

            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const fecha = `${dd}/${mm}/${yyyy}`;

            const escapedTitle = title.replace(/"/g, '""');
            const formula_link = `=HYPERLINK("${url}"; "${escapedTitle}")`;

            const appendBody = {
                range: `'${exactSheetTitle}'!A:A`,
                majorDimension: 'ROWS',
                values: [
                    [fecha, company, semana, title, formula_link, 'En proceso', '', source]
                ]
            };

            const postPromise = fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${exactSheetTitle}'!A:A`)}:append?valueInputOption=USER_ENTERED`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(appendBody)
                }
            );

            const postResponse = await withTimeout(
                postPromise,
                15000,
                'Tiempo de espera agotado al guardar en Google Sheets.'
            );

            if (!postResponse.ok) {
                throw new Error(`Error al guardar en Google Sheets (Status: ${postResponse.status})`);
            }

            status.className = 'status-text success';
            status.textContent = 'Postulación registrada con éxito';
        } catch (err) {
            status.className = 'status-text error';
            if (err.message.includes('403') || err.message.toLowerCase().includes('permission')) {
                status.innerHTML = `Error de permisos (403). <a href="#" id="errorLinkOptions" style="color: inherit; text-decoration: underline; font-weight: bold;">Haz clic aquí para cambiar de cuenta</a>.`;
                const link = document.getElementById('errorLinkOptions');
                if (link) {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        chrome.runtime.openOptionsPage();
                    });
                }
            } else {
                status.textContent = err.message;
            }
        } finally {
            btnPostular.disabled = false;
        }
    }
});