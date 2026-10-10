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

const sheetsError = async (response, contexto) => {
    const body = await response.json().catch(() => null);
    const detalle = body?.error?.message || '';
    const codigo = body?.error?.status || '';
    const ayuda = response.status === 403 || response.status === 404
        ? ' Revisá la cuenta y pulsá Autorizar planilla desde Configuración.' : '';
    return new Error(`${contexto} (${response.status}${codigo ? ' ' + codigo : ''}): ${detalle}${ayuda}`);
};


const CONFIG_KEYS = ['gemini_api_key', 'groq_api_key', 'ai_provider', 'spreadsheet_id', 'cv_goal', 'current_week', 'privacy_consent'];

const loadConfig = async () => {
    const synced = await new Promise((resolve) => {
        chrome.storage.sync.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    const local = await new Promise((resolve) => {
        chrome.storage.local.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    return { ...local, ...synced };
};
