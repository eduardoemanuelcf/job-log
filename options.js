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
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(t);
                }
            });
        });
        if (token) {
            chrome.storage.local.set({
                google_access_token: token,
                google_token_expires_at: Date.now() + 3500 * 1000
            });
            chrome.storage.local.remove(['user_disconnected']);
        }
        return token;
    } catch (err) {
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
            if (token) {
                chrome.storage.local.set({
                    google_access_token: token,
                    google_token_expires_at: Date.now() + 3500 * 1000
                });
                chrome.storage.local.remove(['user_disconnected']);
            }
            return token;
        } catch (interactiveErr) {
            return getAccessTokenViaWebFlow(true);
        }
    }
};

const loginHintParam = async () => {
    const stored = await new Promise((resolve) => {
        chrome.storage.local.get(['google_account_email'], (result) => resolve(result || {}));
    });
    return stored.google_account_email
        ? `&login_hint=${encodeURIComponent(stored.google_account_email)}`
        : '';
};

const getAccessTokenViaWebFlow = async (interactive, forceSelectAccount = false) => {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2.client_id;
    const scopes = [...manifest.oauth2.scopes, 'email'].join(' ');
    const redirectUri = chrome.identity.getRedirectURL();

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=token&` +
        `scope=${encodeURIComponent(scopes)}`;

    const launch = (url, isInteractive) => new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url, interactive: isInteractive }, (redirectUrl) => {
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

    if (forceSelectAccount) {
        return launch(`${authUrl}&prompt=select_account`, true);
    }

    try {
        return await launch(`${authUrl}&prompt=none${await loginHintParam()}`, false);
    } catch (e) {
        if (!interactive) {
            throw e;
        }
        return launch(authUrl, true);
    }
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
            chrome.storage.local.remove(['user_disconnected']);
            const email = await fetchGoogleEmail(accessToken);
            if (email) {
                chrome.storage.local.set({ google_account_email: email });
            }
            return accessToken;
        } else {
            throw new Error('No se pudo extraer el token.');
        }
    } catch (e) {
        throw new Error(`Error al procesar la respuesta: ${e.message}`);
    }
};

const sheetsError = async (response, contexto) => {
    const body = await response.json().catch(() => null);
    const detalle = body?.error?.message || '';
    const codigo = body?.error?.status || '';
    return new Error(`${contexto} (${response.status}${codigo ? ' ' + codigo : ''}): ${detalle}`);
};

const fetchGoogleEmail = async (token) => {
    try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
        if (!res.ok) return '';
        const data = await res.json().catch(() => ({}));
        return data.email || '';
    } catch (_) {
        return '';
    }
};

const checkGoogleAuthStatus = async () => {
    const storage = await new Promise((resolve) => {
        chrome.storage.local.get(
            ['user_disconnected', 'google_access_token', 'google_token_expires_at', 'google_account_email'],
            (result) => resolve(result || {})
        );
    });

    if (storage.user_disconnected) {
        return { isConnected: false };
    }

    if (storage.google_access_token && storage.google_token_expires_at && storage.google_token_expires_at > Date.now() + 120000) {
        return {
            isConnected: true,
            token: storage.google_access_token,
            email: storage.google_account_email || ''
        };
    }

    const isBrave = navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave();
    if (isBrave) {
        try {
            const token = await getAccessTokenViaWebFlow(false);
            return { isConnected: true, token, email: storage.google_account_email || '' };
        } catch (_) {
            return { isConnected: false };
        }
    }

    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
                if (chrome.runtime.lastError || !t) {
                    reject(chrome.runtime.lastError || new Error('Sin token'));
                } else {
                    resolve(t);
                }
            });
        });
        if (token) {
            chrome.storage.local.set({
                google_access_token: token,
                google_token_expires_at: Date.now() + 3500 * 1000
            });
            return { isConnected: true, token, email: storage.google_account_email || '' };
        }
        return { isConnected: false };
    } catch (_) {
        return { isConnected: false };
    }
};

const CONFIG_KEYS = ['gemini_api_key', 'groq_api_key', 'spreadsheet_id', 'cv_goal', 'current_week'];

const loadConfig = async () => {
    const synced = await new Promise((resolve) => {
        chrome.storage.sync.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    const local = await new Promise((resolve) => {
        chrome.storage.local.get(CONFIG_KEYS, (r) => resolve(r || {}));
    });
    return { ...local, ...synced };
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await loadConfig();

        if (data.gemini_api_key) {
            document.getElementById('geminiApiKey').value = data.gemini_api_key;
        }
        if (data.groq_api_key) {
            document.getElementById('groqApiKey').value = data.groq_api_key;
        }
        if (data.spreadsheet_id) {
            document.getElementById('spreadsheetId').value = data.spreadsheet_id;
        }
        if (data.cv_goal) {
            document.getElementById('cvGoal').value = data.cv_goal;
        } else {
            document.getElementById('cvGoal').value = '25';
        }

        updateGoogleAccountUI();

    } catch (err) {
        const status = document.getElementById('status');
        status.className = 'status-msg error';
        status.textContent = 'Error al cargar la configuración';
    }
});

const eyeOffSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 5c7 0 10 7 10 7a19.5 19.5 0 0 1-5.07 5.94M1 1l22 22"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

const setupTogglePassword = (inputId, buttonId) => {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;
    button.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    button.addEventListener('click', () => {
        if (input.type === 'password') {
            input.type = 'text';
            button.innerHTML = eyeSvg;
        } else {
            input.type = 'password';
            button.innerHTML = eyeOffSvg;
        }
    });
};

setupTogglePassword('geminiApiKey', 'toggleApiKey');
setupTogglePassword('groqApiKey', 'toggleGroqApiKey');

document.getElementById('btnMinus').addEventListener('click', () => {
    const input = document.getElementById('cvGoal');
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = 25;
    if (val > 1) {
        input.value = val - 1;
    }
});

document.getElementById('btnPlus').addEventListener('click', () => {
    const input = document.getElementById('cvGoal');
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = 25;
    input.value = val + 1;
});

document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSave = document.getElementById('btnSave');
    const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
    const groqApiKey = document.getElementById('groqApiKey').value.trim();
    const spreadsheetIdInput = document.getElementById('spreadsheetId').value.trim();
    const cvGoal = document.getElementById('cvGoal').value.trim() || '25';
    const status = document.getElementById('status');

    if (!geminiApiKey && !groqApiKey) {
        status.className = 'status-msg error';
        status.textContent = 'Debes ingresar al menos una API Key (Gemini o Groq)';
        return;
    }

    const match = spreadsheetIdInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = match ? match[1].trim() : spreadsheetIdInput.trim();

    btnSave.disabled = true;
    btnSave.textContent = 'Guardando...';

    try {
        await new Promise((resolve, reject) => {
            chrome.storage.sync.set({
                gemini_api_key: geminiApiKey,
                groq_api_key: groqApiKey,
                spreadsheet_id: spreadsheetId,
                cv_goal: cvGoal
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });

        let sheetWarning = null;
        try {
            const token = await getGoogleAccessToken();
            if (token) {
                const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!metaResponse.ok) {
                    throw await sheetsError(metaResponse, 'Error al acceder a la planilla');
                }
                const metaData = await metaResponse.json();
                let exactProgresoTitle = '';
                for (const s of metaData.sheets || []) {
                    if (s.properties && s.properties.title && (s.properties.title.trim().toLowerCase() === 'progreso' || s.properties.title.trim().toLowerCase() === 'progreso semanal')) {
                        exactProgresoTitle = s.properties.title;
                        break;
                    }
                }
                if (exactProgresoTitle) {
                    const updateGoalBody = {
                        range: `'${exactProgresoTitle}'!I2`,
                        majorDimension: 'ROWS',
                        values: [[parseInt(cvGoal, 10)]]
                    };
                    const updateGoalResp = await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${exactProgresoTitle}'!I2`)}?valueInputOption=USER_ENTERED`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(updateGoalBody)
                        }
                    );
                    if (!updateGoalResp.ok) {
                        throw await sheetsError(updateGoalResp, 'Error al actualizar objetivo en la planilla');
                    }
                }
            }
        } catch (sheetsErr) {
            console.warn('[Job Log Options] No se pudo acceder a Sheets:', sheetsErr);
            sheetWarning = sheetsErr.message;
        }

        if (sheetWarning) {
            btnSave.className = 'btn-save';
            btnSave.textContent = 'Guardado con advertencias';

            status.className = 'status-msg warning';
            status.textContent = `Configuración guardada, pero no se pudo acceder a la planilla: ${sheetWarning}`;

            setTimeout(() => {
                btnSave.className = 'btn-save';
                btnSave.textContent = 'Guardar configuración';
                btnSave.disabled = false;
            }, 5000);
        } else {
            btnSave.className = 'btn-save success';
            btnSave.textContent = 'Configuración guardada';

            status.className = 'status-msg success';
            status.textContent = 'Configuración guardada correctamente';

            setTimeout(() => {
                btnSave.className = 'btn-save';
                btnSave.textContent = 'Guardar configuración';
                btnSave.disabled = false;

                status.className = 'status-msg';
                status.textContent = '';
            }, 2000);
        }
    } catch (err) {
        btnSave.className = 'btn-save';
        btnSave.textContent = 'Guardar configuración';
        btnSave.disabled = false;

        status.className = 'status-msg error';
        status.textContent = 'Error al guardar la configuración';
    }
});

document.getElementById('weekForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnCreateWeek = document.getElementById('btnCreateWeek');
    const newWeekName = document.getElementById('newWeekName').value.trim();
    const weekStatus = document.getElementById('weekStatus');

    btnCreateWeek.disabled = true;
    btnCreateWeek.textContent = 'Procesando...';
    weekStatus.className = 'status-msg';
    weekStatus.textContent = '';

    try {
        const credentials = await new Promise((resolve) => {
            chrome.storage.sync.get(['spreadsheet_id'], (result) => {
                resolve(result || {});
            });
        });

        if (!credentials.spreadsheet_id) {
            throw new Error('Falta configurar y guardar la URL de Google Sheets.');
        }

        let spreadsheetId = credentials.spreadsheet_id.trim();
        const sheetIdMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetIdMatch) {
            spreadsheetId = sheetIdMatch[1];
        }

        weekStatus.className = 'status-msg success';
        weekStatus.textContent = 'Solicitando permisos de Google...';

        const token = await withTimeout(
            getGoogleAccessToken(),
            90000,
            'Tiempo de espera agotado al conectar con Google.'
        );

        weekStatus.textContent = 'Conectando con Google Sheets...';

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
            throw await sheetsError(metaResponse, 'Error al leer el Google Sheet');
        }

        const metaData = await metaResponse.json();
        const sheetList = metaData.sheets || [];

        let exactPostulacionesTitle = 'Postulaciones';
        let exactProgresoTitle = '';
        let progresoSheetId = null;
        let postulacionesSheetId = null;
        
        for (const s of sheetList) {
            if (s.properties && s.properties.title) {
                const title = s.properties.title;
                const clean = title.trim().toLowerCase();
                if (clean === 'postulaciones') {
                    exactPostulacionesTitle = title;
                    postulacionesSheetId = s.properties.sheetId;
                }
                if (clean === 'progreso' || clean === 'progreso semanal') {
                    exactProgresoTitle = title;
                    progresoSheetId = s.properties.sheetId;
                }
            }
        }

        if (!exactProgresoTitle) {
            throw new Error('No se encontro la pestaña llamada progreso en tu documento de Google Sheets.');
        }

        weekStatus.textContent = 'Buscando posicion para insertar la nueva semana...';

        const getValuesPromise = fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${exactProgresoTitle}'!A1:A100`)}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        const getValuesResponse = await withTimeout(
            getValuesPromise,
            15000,
            'Tiempo de espera agotado al consultar la columna de semanas.'
        );

        if (!getValuesResponse.ok) {
            throw new Error('Error al obtener las filas de progreso.');
        }

        const getValuesData = await getValuesResponse.json();
        const rows = getValuesData.values || [];

        let totalRowIdx = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && rows[i][0].toString().trim().toUpperCase() === 'TOTAL') {
                totalRowIdx = i;
                break;
            }
        }

        if (totalRowIdx === -1) {
            throw new Error('No se pudo encontrar la fila TOTAL en la pestaña de progreso.');
        }

        weekStatus.textContent = 'Insertando fila y actualizando reglas de validacion...';

        const rowNumber = totalRowIdx + 1;

        const batchRequests = [
            {
                insertDimension: {
                    range: {
                        sheetId: progresoSheetId,
                        dimension: 'ROWS',
                        startIndex: totalRowIdx,
                        endIndex: totalRowIdx + 1
                    },
                    inheritFromBefore: true
                }
            }
        ];

        if (postulacionesSheetId !== null) {
            batchRequests.push({
                repeatCell: {
                    range: {
                        sheetId: postulacionesSheetId,
                        startColumnIndex: 2,
                        endColumnIndex: 3,
                        startRowIndex: 1
                    },
                    cell: {
                        dataValidation: {
                            condition: {
                                type: 'ONE_OF_RANGE',
                                values: [
                                    {
                                        userEnteredValue: `='${exactProgresoTitle}'!$A$5:$A$${rowNumber}`
                                    }
                                ]
                            },
                            showCustomUi: true
                        }
                    },
                    fields: 'dataValidation'
                }
            });
        }

        const batchUpdateBody = {
            requests: batchRequests
        };

        const batchPromise = fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(batchUpdateBody)
            }
        );

        const batchResponse = await withTimeout(
            batchPromise,
            15000,
            'Tiempo de espera agotado al insertar la nueva fila.'
        );

        if (!batchResponse.ok) {
            let detalle = '';
            try {
                const errData = await batchResponse.json();
                detalle = errData.error && errData.error.message ? `: ${errData.error.message}` : '';
            } catch (e) {
                detalle = '';
            }
            throw new Error(`Error al insertar la nueva fila en Google Sheets (Status: ${batchResponse.status})${detalle}`);
        }

        weekStatus.textContent = 'Rellenando los datos y formulas de la semana...';

        const countifFormula = `=CONTAR.SI('${exactPostulacionesTitle}'!$C:$C; A${rowNumber})`;
        const goalFormula = `=$I$2`;
        const diffFormula = `=B${rowNumber}-C${rowNumber}`;
        const complianceFormula = `=SI(C${rowNumber}>0; B${rowNumber}/C${rowNumber}; 0)`;
        const statusFormula = `=SI(B${rowNumber}=0;"— sin postulaciones";SI(B${rowNumber}>=C${rowNumber};"Objetivo cumplido";"Faltan "&(C${rowNumber}-B${rowNumber})&" CVs"))`;
        const enProcesoFormula = `=CONTAR.SI.CONJUNTO('${exactPostulacionesTitle}'!$C:$C; $A${rowNumber}; '${exactPostulacionesTitle}'!$F:$F; "En proceso")`;
        const noAvanzaronFormula = `=CONTAR.SI.CONJUNTO('${exactPostulacionesTitle}'!$C:$C; $A${rowNumber}; '${exactPostulacionesTitle}'!$F:$F; "No avanzó")`;
        const entrevistaFormula = `=CONTAR.SI.CONJUNTO('${exactPostulacionesTitle}'!$C:$C; $A${rowNumber}; '${exactPostulacionesTitle}'!$G:$G; "Si")`;

        const updateBody = {
            range: `'${exactProgresoTitle}'!A${rowNumber}:I${rowNumber}`,
            majorDimension: 'ROWS',
            values: [
                [newWeekName, countifFormula, goalFormula, diffFormula, complianceFormula, statusFormula, enProcesoFormula, noAvanzaronFormula, entrevistaFormula]
            ]
        };

        const updatePromise = fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${exactProgresoTitle}'!A${rowNumber}:I${rowNumber}`)}?valueInputOption=USER_ENTERED`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateBody)
            }
        );

        const updateResponse = await withTimeout(
            updatePromise,
            15000,
            'Tiempo de espera agotado al rellenar los datos de la nueva semana.'
        );

        if (!updateResponse.ok) {
            throw new Error('Error al rellenar los datos de la nueva semana.');
        }

        const isEvenRow = (rowNumber - 5) % 2 === 1;
        const rowColor = isEvenRow
            ? { red: 0.918, green: 0.945, blue: 0.984 }
            : { red: 1, green: 1, blue: 1 };

        const colorRequest = {
            requests: [
                {
                    repeatCell: {
                        range: {
                            sheetId: progresoSheetId,
                            startRowIndex: rowNumber - 1,
                            endRowIndex: rowNumber,
                            startColumnIndex: 1,
                            endColumnIndex: 9
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: rowColor
                            }
                        },
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                }
            ]
        };

        await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(colorRequest)
            }
        );

        const totalRow = rowNumber + 1;
        const totalBody = {
            data: [
                {
                    range: `'${exactProgresoTitle}'!B${totalRow}`,
                    values: [[`=SUMA(B5:B${rowNumber})`]]
                },
                {
                    range: `'${exactProgresoTitle}'!C${totalRow}`,
                    values: [[`=SUMA(C5:C${rowNumber})`]]
                },
                {
                    range: `'${exactProgresoTitle}'!D${totalRow}`,
                    values: [[`=SUMA(D5:D${rowNumber})`]]
                },
                {
                    range: `'${exactProgresoTitle}'!G${totalRow}`,
                    values: [[`=SUMA(G5:G${rowNumber})`]]
                },
                {
                    range: `'${exactProgresoTitle}'!H${totalRow}`,
                    values: [[`=SUMA(H5:H${rowNumber})`]]
                },
                {
                    range: `'${exactProgresoTitle}'!I${totalRow}`,
                    values: [[`=SUMA(I5:I${rowNumber})`]]
                }
            ],
            valueInputOption: 'USER_ENTERED'
        };

        await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(totalBody)
            }
        );

        weekStatus.className = 'status-msg success';
        weekStatus.textContent = `${newWeekName} agregada con éxito`;
        document.getElementById('newWeekName').value = '';

        setTimeout(() => {
            weekStatus.className = 'status-msg';
            weekStatus.textContent = '';
        }, 5000);

    } catch (err) {
        console.error('[Job Log Options] Error:', err);
        weekStatus.className = 'status-msg error';
        weekStatus.textContent = err.message;
    } finally {
        btnCreateWeek.disabled = false;
        btnCreateWeek.textContent = 'Añadir semana a Google Sheets';
    }
});

const updateGoogleAccountUI = async () => {
    const btnConnect = document.getElementById('btnConnectGoogle');
    const btnDisconnect = document.getElementById('btnDisconnectGoogle');
    const infoDiv = document.getElementById('googleAccountInfo');
    const emailEl = document.getElementById('googleAccountEmail');
    const badge = document.getElementById('googleAccountBadge');

    const auth = await checkGoogleAuthStatus();

    if (auth.isConnected) {
        if (btnConnect) btnConnect.style.display = 'none';
        if (btnDisconnect) {
            btnDisconnect.style.display = 'inline-flex';
            btnDisconnect.disabled = false;
            btnDisconnect.textContent = 'Cerrar sesión';
        }

        if (badge) {
            badge.className = 'badge success';
            badge.textContent = 'Conectada';
            badge.style.display = 'inline-flex';
        }

        let email = auth.email;
        if (!email && auth.token) {
            email = await fetchGoogleEmail(auth.token);
            if (email) {
                chrome.storage.local.set({ google_account_email: email });
            }
        }

        if (infoDiv && emailEl) {
            if (email) {
                emailEl.textContent = email;
                infoDiv.style.display = 'block';
            } else {
                infoDiv.style.display = 'none';
            }
        }
    } else {
        if (btnConnect) {
            btnConnect.style.display = 'inline-flex';
            btnConnect.disabled = false;
            btnConnect.textContent = 'Conectar cuenta';
        }
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (infoDiv) infoDiv.style.display = 'none';

        if (badge) {
            badge.className = 'badge';
            badge.textContent = 'No conectada';
            badge.style.display = 'inline-flex';
        }
    }
};

document.getElementById('btnConnectGoogle').addEventListener('click', async () => {
    const btn = document.getElementById('btnConnectGoogle');
    const status = document.getElementById('googleStatus');
    btn.disabled = true;
    btn.textContent = 'Conectando...';
    status.className = 'status-msg';
    status.textContent = '';

    try {
        await new Promise(r => chrome.storage.local.remove(['user_disconnected'], r));
        const token = await getAccessTokenViaWebFlow(true, true);
        if (token) {
            const email = await fetchGoogleEmail(token);
            if (email) {
                await new Promise(r => chrome.storage.local.set({ google_account_email: email }, r));
            }
            status.className = 'status-msg success';
            status.textContent = 'Cuenta conectada correctamente.';
            await updateGoogleAccountUI();
        }
    } catch (err) {
        console.error('Error connecting account:', err);
        status.className = 'status-msg error';
        status.textContent = `Error al conectar cuenta: ${err.message}`;
        await updateGoogleAccountUI();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Conectar cuenta';
        setTimeout(() => {
            status.className = 'status-msg';
            status.textContent = '';
        }, 4000);
    }
});

document.getElementById('btnDisconnectGoogle').addEventListener('click', async () => {
    const btn = document.getElementById('btnDisconnectGoogle');
    const status = document.getElementById('googleStatus');
    btn.disabled = true;
    btn.textContent = 'Cerrando sesión...';
    status.className = 'status-msg';
    status.textContent = '';

    try {
        const cached = await new Promise((resolve) => {
            chrome.storage.local.get(['google_access_token'], resolve);
        });

        await new Promise((resolve) => {
            chrome.storage.local.remove(['google_access_token', 'google_token_expires_at', 'google_account_email'], resolve);
        });
        await new Promise((resolve) => {
            chrome.storage.local.set({ user_disconnected: true }, resolve);
        });

        if (cached && cached.google_access_token) {
            try {
                await new Promise((resolve) => {
                    chrome.identity.removeCachedAuthToken({ token: cached.google_access_token }, resolve);
                });
            } catch (e) {
                console.warn('Error clearing cached web token:', e);
            }
        }

        try {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
                if (t) {
                    chrome.identity.removeCachedAuthToken({ token: t }, () => {});
                }
            });
        } catch (e) {
            console.warn('Error clearing primary profile cached token:', e);
        }

        try {
            await new Promise(r => chrome.identity.clearAllCachedAuthTokens(r));
        } catch (e) {
            console.warn('Error clearing all cached auth tokens:', e);
        }

        status.className = 'status-msg success';
        status.textContent = 'Sesión cerrada correctamente.';
        await updateGoogleAccountUI();
    } catch (err) {
        console.error('Error closing session:', err);
        status.className = 'status-msg error';
        status.textContent = `Error al cerrar sesión: ${err.message}`;
        await updateGoogleAccountUI();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cerrar sesión';
        setTimeout(() => {
            status.className = 'status-msg';
            status.textContent = '';
        }, 4000);
    }
});
