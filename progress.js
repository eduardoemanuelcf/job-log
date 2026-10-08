const parseProgressRows = (rows) => {
    const result = [];
    for (const row of rows) {
        const week = String(row[0] ?? '').trim();
        if (!week || week.toUpperCase() === 'TOTAL') continue;
        const count = Number(row[1] ?? 0);
        const goal = row[2] === undefined || row[2] === '' ? null : Number(row[2]);
        if (!Number.isSafeInteger(count) || count < 0 || (goal !== null && (!Number.isSafeInteger(goal) || goal < 0))) {
            throw new Error(`Revisá las postulaciones y la meta de ${week} en tu planilla: deben ser números enteros, sin errores de fórmula.`);
        }
        result.push({ week, count, goal });
    }
    return result;
};

document.addEventListener('DOMContentLoaded', async () => {
    const refresh = document.getElementById('refreshProgress');
    const status = document.getElementById('progressStatus');
    const chart = document.getElementById('progressChart');
    const rows = document.getElementById('progressRows');
    const recovery = document.getElementById('progressRecovery');
    const updated = document.getElementById('progressUpdated');
    const previous = document.getElementById('previousWeeks');
    const next = document.getElementById('nextWeeks');
    let weeks = [];
    let endIndex = 0;
    let pageSize = 12;
    let loading = false;

    const openOptions = (event) => {
        event.preventDefault();
        chrome.runtime.openOptionsPage();
    };
    document.getElementById('openOptions').addEventListener('click', openOptions);
    document.getElementById('configureProgress').addEventListener('click', openOptions);

    const render = () => {
        const plot = document.getElementById('progressPlot');
        const width = plot.parentElement.clientWidth || 864;
        pageSize = Math.max(1, Math.min(12, Math.floor((width - 68) / 64)));
        const startIndex = Math.max(0, endIndex - pageSize);
        const visible = weeks.slice(startIndex, endIndex);
        const highest = weeks.reduce((max, week) => Math.max(max, week.count, week.goal ?? 0), 1);
        const magnitude = 10 ** Math.floor(Math.log10(highest / 4));
        const step = Math.max(1, [1, 2, 5, 10].find(value => value * magnitude >= highest / 4) * magnitude);
        const scale = step * 4;
        const left = 48, right = width - 20, top = 28, bottom = 288;
        const slot = (right - left) / visible.length;
        const barWidth = Math.min(76, slot * 0.55);
        const y = value => bottom - value / scale * (bottom - top);
        const graphics = document.getElementById('progressGraphics');
        plot.setAttribute('viewBox', `0 0 ${width} 336`);
        graphics.replaceChildren();
        rows.replaceChildren();
        const draw = (tag, attributes, text) => {
            const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
            for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
            if (text !== undefined) element.textContent = text;
            graphics.appendChild(element);
            return element;
        };
        for (let i = 0; i <= 4; i++) {
            const value = i * step;
            draw('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: i === 0 ? 'axis-line' : 'grid-line' });
            draw('text', { x: left - 12, y: y(value) + 4, 'text-anchor': 'end' }, value.toLocaleString('es-AR'));
        }
        draw('line', { x1: left, x2: left, y1: top, y2: bottom, class: 'axis-line' });
        const commonGoal = visible[0].goal;
        const sameGoal = commonGoal !== null && commonGoal > 0 && visible.every(week => week.goal === commonGoal);
        for (const [index, week] of visible.entries()) {
            const x = left + slot * (index + 0.5);
            const bar = draw('rect', { x: x - barWidth / 2, y: y(week.count), width: barWidth, height: bottom - y(week.count), rx: 2, class: 'bar-fill' });
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${week.week}: ${week.count} postulaciones${week.goal === null ? '' : `, meta ${week.goal}`}`;
            bar.appendChild(title);
            draw('text', { x, y: y(week.count) - 10, 'text-anchor': 'middle', class: 'count-label' }, week.count.toLocaleString('es-AR'));
            const limit = Math.max(4, Math.floor((slot - 14) / 7));
            let lines = [week.week];
            if (week.week.length > limit) {
                const space = week.week.slice(0, limit + 1).lastIndexOf(' ');
                const split = space > 0 ? space : limit;
                const rest = week.week.slice(split).trim();
                lines = [week.week.slice(0, split), rest.length > limit ? `${rest.slice(0, limit - 1)}…` : rest];
            }
            const label = draw('text', { x, y: bottom + 24, 'text-anchor': 'middle', class: 'week-label' });
            for (const [lineIndex, text] of lines.entries()) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                line.setAttribute('x', String(x));
                line.setAttribute('dy', lineIndex === 0 ? '0' : '16');
                line.textContent = text;
                label.appendChild(line);
            }
            const fullLabel = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            fullLabel.textContent = week.week;
            label.appendChild(fullLabel);
            if (!sameGoal && week.goal !== null && week.goal > 0) {
                draw('line', { x1: x - slot * 0.4, x2: x + slot * 0.4, y1: y(week.goal), y2: y(week.goal), class: 'goal-marker' });
            }
            const row = document.createElement('tr');
            const weekCell = document.createElement('th');
            weekCell.scope = 'row';
            weekCell.textContent = week.week;
            const count = document.createElement('td');
            count.textContent = week.count.toLocaleString('es-AR');
            const goal = document.createElement('td');
            goal.textContent = week.goal === null ? '—' : week.goal.toLocaleString('es-AR');
            row.append(weekCell, count, goal);
            rows.appendChild(row);
        }
        if (sameGoal) draw('line', { x1: left, x2: right, y1: y(commonGoal), y2: y(commonGoal), class: 'goal-marker' });
        document.getElementById('chartFooter').hidden = weeks.length <= pageSize;
        previous.disabled = startIndex === 0;
        next.disabled = endIndex === weeks.length;
        document.getElementById('weekRange').textContent = visible.length === 1
            ? `Semana ${endIndex} de ${weeks.length}`
            : `Semanas ${startIndex + 1}–${endIndex} de ${weeks.length}`;
    };

    const load = async () => {
        if (loading) return;
        loading = true;
        refresh.disabled = true;
        chart.hidden = true;
        document.getElementById('chartFooter').hidden = true;
        document.getElementById('progressLoading').hidden = false;
        chart.setAttribute('aria-busy', 'true');
        recovery.hidden = true;
        updated.hidden = true;
        status.hidden = false;
        status.className = 'sr-only';
        status.textContent = 'Cargando tu progreso…';
        try {
            const config = await loadConfig();
            if (!config.privacy_consent || !config.spreadsheet_id) {
                recovery.hidden = false;
                throw new Error('Configurá tu planilla y aceptá el uso de datos para ver tu progreso.');
            }
            let spreadsheetId = config.spreadsheet_id.trim();
            const match = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (match) spreadsheetId = match[1];
            if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) {
                recovery.hidden = false;
                throw new Error('Revisá la URL de tu planilla en Configuración.');
            }
            let token;
            try {
                token = await withTimeout(getGoogleAccessTokenSilently(), 20000, 'Tiempo de espera agotado al conectar con Google.');
            } catch (_) {
                recovery.hidden = false;
                throw new Error('Conectá tu cuenta de Google desde Configuración y volvé a actualizar.');
            }
            let renewed = false;
            const read = async (path) => {
                const fetchData = () => fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
                    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000)
                });
                let response = await fetchData();
                if (response.status === 401 && !renewed) {
                    renewed = true;
                    recovery.hidden = false;
                    token = await withTimeout(forceNewGoogleToken(token, false), 20000, 'Volvé a conectar tu cuenta de Google desde Configuración.');
                    recovery.hidden = true;
                    response = await fetchData();
                }
                if (!response.ok) {
                    if ([401, 403].includes(response.status)) recovery.hidden = false;
                    throw await sheetsError(response, 'No se pudo leer tu progreso');
                }
                return response.json();
            };
            const metadata = await read('?fields=sheets(properties(title))');
            const titles = (metadata.sheets || []).map(sheet => sheet.properties?.title).filter(Boolean);
            const title = titles.find(value => value.trim().toLowerCase() === 'progreso semanal') ||
                titles.find(value => value.trim().toLowerCase() === 'progreso');
            if (!title) throw new Error('No se encontró la hoja Progreso o Progreso semanal. Revisá tu planilla.');
            const data = await read(`/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A5:C`)}?valueRenderOption=UNFORMATTED_VALUE`);
            weeks = parseProgressRows(data.values || []);
            if (!weeks.length) {
                status.className = 'status';
                status.textContent = 'Todavía no hay semanas. Agregá una desde Configuración para empezar.';
                recovery.hidden = false;
                return;
            }
            chart.hidden = false;
            endIndex = weeks.length;
            render();
            status.hidden = true;
            updated.textContent = `Actualizado a las ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
            updated.hidden = false;
        } catch (error) {
            status.className = 'status error';
            status.textContent = ['TimeoutError', 'AbortError'].includes(error.name)
                ? 'La planilla tardó demasiado en responder. Volvé a actualizar.'
                : error.name === 'TypeError' ? 'No se pudo conectar con tu planilla. Revisá tu conexión y volvé a actualizar.' : error.message;
        } finally {
            document.getElementById('progressLoading').hidden = true;
            chart.setAttribute('aria-busy', 'false');
            loading = false;
            refresh.disabled = false;
        }
    };

    previous.addEventListener('click', () => {
        if (loading || previous.disabled) return;
        endIndex = Math.max(1, endIndex - pageSize);
        render();
    });
    next.addEventListener('click', () => {
        if (loading || next.disabled) return;
        endIndex = Math.min(weeks.length, endIndex + pageSize);
        render();
    });
    refresh.addEventListener('click', load);
    window.addEventListener('resize', () => { if (!chart.hidden && weeks.length) render(); });
    await load();
});
