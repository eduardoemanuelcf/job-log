let configuredSpreadsheetId = '';
let setupConfig = {};
let editingStep = 0;

const setSetupBusy = busy => {
    for (const id of ['btnSave', 'btnSaveGoal', 'btnConnectGoogle', 'btnDisconnectGoogle', 'btnEditAI', 'btnEditSheet', 'btnEditGoal', 'btnShowGoogle', 'btnCancelEdit']) {
        document.getElementById(id).disabled = busy;
    }
};

const saveConfig = async (values) => {
    const previous = await loadConfig();
    if (Object.hasOwn(values, 'spreadsheet_id') && previous.spreadsheet_id !== values.spreadsheet_id) {
        await new Promise((resolve, reject) => chrome.storage.local.remove(['cached_weeks'], () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        }));
        await new Promise((resolve, reject) => chrome.storage.sync.remove(['current_week'], () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        }));
    }
    await new Promise((resolve, reject) => chrome.storage.sync.set(values, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
    }));
};

const syncSpreadsheetGoal = async (spreadsheetId, cvGoal) => {
    const token = await getGoogleAccessTokenSilently();
    const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResponse.ok) throw await sheetsError(metaResponse, 'Error al acceder a la planilla');
    const metaData = await metaResponse.json();
    await new Promise(resolve => chrome.storage.local.set({ google_authorized_spreadsheet_id: spreadsheetId }, resolve));
    const title = metaData.sheets?.find(s => ['progreso', 'progreso semanal'].includes(s.properties?.title?.trim().toLowerCase()))?.properties.title;
    if (!title) throw new Error('No se encontró la pestaña Progreso o Progreso semanal en la planilla.');
    const range = `'${title.replace(/'/g, "''")}'!I2`;
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ range, majorDimension: 'ROWS', values: [[Number(cvGoal)]] })
        }
    );
    if (!response.ok) throw await sheetsError(response, 'Error al actualizar objetivo en la planilla');
};

let googleAuthorizedSpreadsheetId = '';

const updateGoogleSpreadsheetAction = () => {
    const authorized = !!googleAuthorizedSpreadsheetId && configuredSpreadsheetId === googleAuthorizedSpreadsheetId;
    const button = document.getElementById('btnConnectGoogle');
    button.textContent = authorized ? 'Cambiar planilla' : 'Autorizar planilla';
    button.className = authorized ? 'btn-save secondary' : 'btn-save';
    document.getElementById('googleTemplateHelp').hidden = authorized;
    document.getElementById('googleAccountHelp').textContent = authorized
        ? 'La planilla está autorizada. Podés cambiarla cuando lo necesites.'
        : 'Pulsá Autorizar planilla y elegí tu copia en Google. La selección se guarda automáticamente.';
    const link = document.getElementById('googleSpreadsheetLink');
    link.style.display = /^[a-zA-Z0-9_-]+$/.test(configuredSpreadsheetId) ? 'inline-block' : 'none';
    link.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(configuredSpreadsheetId)}/edit`;
    document.getElementById('googleSummaryLink').href = link.href;
};

const renderSetup = () => {
    const aiReady = hasConfiguredAI(setupConfig);
    const sheetReady = aiReady && /^[a-zA-Z0-9_-]+$/.test(configuredSpreadsheetId) && configuredSpreadsheetId === googleAuthorizedSpreadsheetId;
    const goalReady = sheetReady && hasConfiguredGoal(setupConfig);
    const pendingStep = !aiReady ? 1 : !sheetReady ? 2 : !goalReady ? 3 : 0;
    const activeStep = editingStep || pendingStep;
    document.getElementById('aiStepContent').hidden = activeStep !== 1;
    document.getElementById('aiStepSummary').hidden = !aiReady || activeStep === 1;
    document.getElementById('aiSummaryText').textContent = `Claves guardadas · ${setupConfig.ai_provider === 'groq' ? 'Groq' : 'Gemini'}`;
    document.getElementById('googleAccountCard').hidden = !aiReady || (activeStep === 1 && !sheetReady);
    document.getElementById('googleStepContent').hidden = activeStep !== 2;
    document.getElementById('googleStepSummary').hidden = !sheetReady || activeStep === 2;
    document.getElementById('goalCard').hidden = !sheetReady;
    document.getElementById('goalStepContent').hidden = activeStep !== 3;
    document.getElementById('goalStepSummary').hidden = !goalReady || activeStep === 3;
    document.getElementById('goalSummaryText').textContent = `Objetivo guardado · ${setupConfig.cv_goal} CVs por semana`;
    document.getElementById('weeksCard').hidden = !goalReady || activeStep !== 0;
    document.getElementById('setupComplete').hidden = !goalReady || activeStep !== 0;
    document.getElementById('btnCancelEdit').hidden = !editingStep || editingStep === pendingStep;
    document.getElementById('setupProgress').textContent = activeStep
        ? `Paso ${activeStep} de 3 · ${['', 'Configurá la IA', 'Conectá tu planilla', 'Elegí tu objetivo semanal'][activeStep]}`
        : 'Configuración completa';
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await loadConfig();
        setupConfig = data;

        if (data.gemini_api_key) {
            document.getElementById('geminiApiKey').value = data.gemini_api_key;
        }
        if (data.groq_api_key) {
            document.getElementById('groqApiKey').value = data.groq_api_key;
        }
        document.getElementById(data.ai_provider === 'groq' ? 'aiGroq' : 'aiGemini').checked = true;
        const savedSheet = typeof data.spreadsheet_id === 'string' ? data.spreadsheet_id.trim() : '';
        configuredSpreadsheetId = savedSheet.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || savedSheet;
        if (data.cv_goal) {
            document.getElementById('cvGoal').value = data.cv_goal;
        } else {
            document.getElementById('cvGoal').value = '25';
        }

        document.getElementById('privacyConsent').checked = data.privacy_consent === true;
        document.getElementById('privacyDisclosure').open = data.privacy_consent !== true;
        renderSetup();
        if (hasConfiguredAI(data)) await updateGoogleAccountUI();
        else updateGoogleSpreadsheetAction();

    } catch (err) {
        const status = document.getElementById('status');
        status.className = 'status-msg error';
        status.textContent = 'No se pudo cargar la configuración. Cerrá esta página y volvé a abrirla.';
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
        } else {
            input.type = 'password';
        }
        button.replaceChildren(new DOMParser().parseFromString(input.type === 'password' ? eyeOffSvg : eyeSvg, 'image/svg+xml').documentElement);
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
    const aiProvider = document.querySelector('input[name="aiProvider"]:checked').value;
    const status = document.getElementById('status');

    if (!document.getElementById('privacyConsent').checked) {
        status.className = 'status-msg error';
        status.textContent = 'Aceptá el uso de datos antes de guardar las claves.';
        return;
    }
    if (!geminiApiKey && !groqApiKey) {
        status.className = 'status-msg error';
        status.textContent = 'Ingresá al menos una clave API de Gemini o Groq.';
        return;
    }
    if (!(aiProvider === 'groq' ? groqApiKey : geminiApiKey)) {
        status.className = 'status-msg error';
        status.textContent = `Ingresá la clave API de ${aiProvider === 'groq' ? 'Groq' : 'Gemini'}, la IA que elegiste como principal.`;
        return;
    }

    setSetupBusy(true);
    btnSave.textContent = 'Guardando claves...';
    try {
        await saveConfig({ gemini_api_key: geminiApiKey, groq_api_key: groqApiKey, ai_provider: aiProvider, privacy_consent: true });
        setupConfig = await loadConfig();
        document.getElementById('privacyDisclosure').open = false;
        status.className = 'status-msg';
        status.textContent = '';
        editingStep = 0;
        renderSetup();
        if (!googleAuthorizedSpreadsheetId) document.getElementById('googleStepHeading').focus();
    } catch (err) {
        console.error('[Job Log Options] No se pudieron guardar las claves:', err);
        status.className = 'status-msg error';
        status.textContent = 'No se pudieron guardar las claves. Volvé a intentarlo.';
    } finally {
        setSetupBusy(false);
        btnSave.textContent = 'Guardar claves';
    }
});

document.getElementById('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = document.getElementById('btnSaveGoal');
    const status = document.getElementById('goalStatus');
    const goal = document.getElementById('cvGoal').value.trim();
    if (!/^\d+$/.test(goal) || !Number.isSafeInteger(Number(goal)) || Number(goal) < 1) {
        status.className = 'status-msg error';
        status.textContent = 'Ingresá un objetivo entero mayor que cero.';
        return;
    }
    if (!hasConfiguredAI(setupConfig) || !/^[a-zA-Z0-9_-]+$/.test(configuredSpreadsheetId) || configuredSpreadsheetId !== googleAuthorizedSpreadsheetId) {
        status.className = 'status-msg error';
        status.textContent = 'Conectá tu planilla antes de guardar el objetivo.';
        return;
    }
    setSetupBusy(true);
    button.textContent = 'Guardando objetivo...';
    status.className = 'status-msg';
    status.textContent = '';
    try {
        await syncSpreadsheetGoal(configuredSpreadsheetId, goal);
        await saveConfig({ spreadsheet_id: configuredSpreadsheetId, cv_goal: goal, cv_goal_spreadsheet_id: configuredSpreadsheetId });
        setupConfig = await loadConfig();
        editingStep = 0;
        renderSetup();
        document.getElementById('setupComplete').focus();
    } catch (err) {
        console.warn('[Job Log Options] No se pudo guardar el objetivo:', err);
        status.className = 'status-msg warning';
        status.textContent = err.message.includes('pestaña Progreso')
            ? 'La planilla no tiene la pestaña Progreso o Progreso semanal. Elegí una copia de la plantilla de Job Log y volvé a guardar el objetivo.'
            : 'No se pudo guardar el objetivo. Tus claves y la planilla siguen guardadas. Revisá la conexión y pulsá Guardar objetivo para reintentar.';
    } finally {
        setSetupBusy(false);
        button.textContent = 'Guardar objetivo';
    }
});

document.getElementById('btnEditAI').addEventListener('click', () => {
    editingStep = 1;
    renderSetup();
    document.getElementById('geminiApiKey').focus();
});
document.getElementById('btnEditGoal').addEventListener('click', () => {
    editingStep = 3;
    renderSetup();
    document.getElementById('cvGoal').focus();
});

document.getElementById('btnCancelEdit').addEventListener('click', () => {
    document.getElementById('geminiApiKey').value = setupConfig.gemini_api_key || '';
    document.getElementById('groqApiKey').value = setupConfig.groq_api_key || '';
    document.getElementById(setupConfig.ai_provider === 'groq' ? 'aiGroq' : 'aiGemini').checked = true;
    document.getElementById('privacyConsent').checked = setupConfig.privacy_consent === true;
    document.getElementById('cvGoal').value = setupConfig.cv_goal || '25';
    for (const id of ['status', 'googleStatus', 'goalStatus']) {
        document.getElementById(id).className = 'status-msg';
        document.getElementById(id).textContent = '';
    }
    editingStep = 0;
    renderSetup();
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
            throw new Error('Pulsá Autorizar planilla para elegir tu copia de Google Sheets.');
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
                [newWeekName.replace(/^([=+\-@])/, "'$1"), countifFormula, goalFormula, diffFormula, complianceFormula, statusFormula, enProcesoFormula, noAvanzaronFormula, entrevistaFormula]
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
    const local = await new Promise(resolve => chrome.storage.local.get(['google_authorized_spreadsheet_id'], resolve));
    googleAuthorizedSpreadsheetId = auth.isConnected ? local.google_authorized_spreadsheet_id || '' : '';
    updateGoogleSpreadsheetAction();
    renderSetup();

    if (auth.isConnected) {
        if (btnConnect) btnConnect.style.display = 'inline-flex';
        if (btnDisconnect) {
            btnDisconnect.style.display = 'inline-flex';
            btnDisconnect.disabled = false;
            btnDisconnect.textContent = 'Cerrar sesión';
        }

        if (badge) {
            const authorized = configuredSpreadsheetId && configuredSpreadsheetId === googleAuthorizedSpreadsheetId;
            badge.className = authorized ? 'badge success' : 'badge';
            badge.textContent = authorized ? 'Conectada' : 'Pendiente';
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
        }
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (infoDiv) infoDiv.style.display = 'none';

        if (badge) {
            badge.className = 'badge';
            badge.textContent = 'Pendiente';
            badge.style.display = 'inline-flex';
        }
    }
};

const connectGoogleSpreadsheet = async () => {
    const btn = document.getElementById('btnConnectGoogle');
    const status = document.getElementById('googleStatus');
    setSetupBusy(true);
    btn.textContent = 'Autorizando planilla...';
    status.className = 'status-msg';
    status.textContent = '';
    try {
        if (!hasConfiguredAI(setupConfig)) throw new Error('Guardá tus claves API antes de conectar la planilla.');
        const selectedId = await pickGoogleSpreadsheet();
        const previous = await loadConfig();
        try {
            await saveConfig({
                spreadsheet_id: selectedId,
                cv_goal_spreadsheet_id: previous.spreadsheet_id === selectedId ? previous.cv_goal_spreadsheet_id ?? selectedId : '',
                privacy_consent: true
            });
        } catch (error) {
            throw new Error('La planilla se autorizó, pero no se pudo guardar. Volvé a seleccionarla para reintentar.');
        }
        configuredSpreadsheetId = selectedId;
        setupConfig = await loadConfig();
        editingStep = 0;
        document.getElementById('goalStatus').className = 'status-msg';
        document.getElementById('goalStatus').textContent = '';
        await updateGoogleAccountUI();
        if (!hasConfiguredGoal(setupConfig)) document.getElementById('goalStepHeading').focus();
    } catch (err) {
        console.error('[Job Log Options] No se pudo conectar la planilla:', err);
        status.className = 'status-msg error';
        status.textContent = err.message.includes('no se pudo guardar') || err.message.includes('Guardá tus claves')
            ? err.message
            : 'No se pudo completar la autorización. Volvé a seleccionar la planilla para intentarlo de nuevo.';
        editingStep = hasConfiguredAI(setupConfig) ? 2 : 1;
        await updateGoogleAccountUI();
    } finally {
        setSetupBusy(false);
    }
};

document.getElementById('btnConnectGoogle').addEventListener('click', connectGoogleSpreadsheet);
document.getElementById('btnEditSheet').addEventListener('click', connectGoogleSpreadsheet);
document.getElementById('btnShowGoogle').addEventListener('click', () => {
    editingStep = 2;
    renderSetup();
    document.getElementById('googleStepHeading').focus();
});

document.getElementById('btnDisconnectGoogle').addEventListener('click', async () => {
    const btn = document.getElementById('btnDisconnectGoogle');
    const status = document.getElementById('googleStatus');
    setSetupBusy(true);
    btn.textContent = 'Cerrando sesión...';
    status.className = 'status-msg';
    status.textContent = '';

    try {
        await disconnectGoogle();

        status.className = 'status-msg success';
        status.textContent = 'Sesión cerrada. Tus claves y preferencias siguen guardadas.';
        editingStep = 0;
        await updateGoogleAccountUI();
    } catch (err) {
        console.error('Error closing session:', err);
        status.className = 'status-msg error';
        status.textContent = 'No se pudo cerrar la sesión. Volvé a intentarlo.';
        await updateGoogleAccountUI();
    } finally {
        setSetupBusy(false);
        btn.textContent = 'Cerrar sesión';
        setTimeout(() => {
            status.className = 'status-msg';
            status.textContent = '';
        }, 4000);
    }
});
