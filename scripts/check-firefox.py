#!/usr/bin/env python3
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import tempfile
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Test the packaged extension in an isolated Firefox profile with synthetic credentials.')
parser.add_argument('--geckodriver', default=shutil.which('geckodriver'))
parser.add_argument('--headed', action='store_true')
args = parser.parse_args()
if not args.geckodriver:
    parser.error('Install Mozilla geckodriver or pass --geckodriver /path/to/geckodriver')
manifest = json.loads((root / 'dist/firefox/manifest.json').read_text())
archive = root / 'dist' / f"job-log-firefox-{manifest['version']}.zip"
artifacts = root / 'dist/firefox-tests'
artifacts.mkdir(exist_ok=True)


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/oauth?'):
            params = parse_qs(urlparse(self.path).query)
            redirect = params['redirect_uri'][0]
            self.send_response(302)
            picked = params.get('file_ids', ['synthetic-sheet'])[0]
            self.send_header('Location', f"{redirect}#access_token=synthetic-token&expires_in=3600&state={params['state'][0]}&picked_file_ids={picked}&scope={params['scope'][0]}")
            self.end_headers()
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<html><head><title>Software Engineer</title></head><body><main><h1>Software Engineer</h1><p>Example Company is hiring a software engineer. Build accessible web applications.</p></main></body></html>')

    def log_message(self, *unused):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
threading.Thread(target=server.serve_forever, daemon=True).start()
fixture_url = f'http://127.0.0.1:{server.server_port}'
with socket.socket() as reservation:
    reservation.bind(('127.0.0.1', 0))
    port = reservation.getsockname()[1]
driver_url = f'http://127.0.0.1:{port}'
log = (artifacts / 'geckodriver.log').open('w')
driver = subprocess.Popen([args.geckodriver, '--port', str(port), '--allow-system-access', '--log', 'error'], stdout=log, stderr=log)
session = None
profile = tempfile.TemporaryDirectory(prefix='job-log-firefox-check-')
session_options = {'capabilities': {'alwaysMatch': {
    'browserName': 'firefox',
    'moz:firefoxOptions': {'args': ['-profile', profile.name] + ([] if args.headed else ['-headless']),
                         'prefs': {'browser.shell.checkDefaultBrowser': False}}
}}}
mock_fetch = '''window.requests=[];
    window.fetch=async(url,options={})=>{
        window.requests.push({url:String(url),options});
        if(window.delayProgress) await new Promise(resolve=>setTimeout(resolve,500));
        const fail=window.failGemini&&String(url).includes('generateContent');
        return {ok:!fail,status:fail?429:200,text:async()=>JSON.stringify({error:{message:'Synthetic quota exceeded'}}),json:async()=>({
            email:'check@example.invalid',
            values:String(url).endsWith('I2')?[['Notas']]:String(url).includes('UNFORMATTED_VALUE')?(window.progressValues||[['Semana 1',10,25],['Semana 2',30,25],['Semana 3',0,25],['TOTAL',40,75]]):String(url).includes('A1%3AA100')?[[],[],[],[],['Semana 1'],['TOTAL']]:[['Semana 1']],
            sheets:[{properties:{title:'Progreso',sheetId:1}},{properties:{title:'Postulaciones',sheetId:2}}],
            candidates:[{content:{parts:[{text:JSON.stringify({company:'Example Company',title:'Software Engineer'})}]}}],
            choices:[{message:{content:JSON.stringify({company:'Example Company',title:'Software Engineer'})}}]
        })};
    };'''


def request(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    with urlopen(Request(driver_url + path, data=body, method=method, headers={'Content-Type': 'application/json'}), timeout=60) as response:
        return json.load(response)['value']


def command(path, data=None, method='POST'):
    return request(method, f'/session/{session}{path}', data)


def js(script, asynchronous=False):
    return command('/execute/async' if asynchronous else '/execute/sync', {'script': script, 'args': []})


def wait_for(expression):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if js(f'return Boolean({expression});'):
            return
        time.sleep(0.1)
    detail = js('return {url:location.href,status:document.querySelector("#progressStatus")?.textContent,requests:window.requests?.map(request=>request.url)};')
    raise AssertionError(f'Timed out: {expression}; {detail}')


def screenshot(name):
    (artifacts / name).write_bytes(base64.b64decode(command('/screenshot', method='GET')))


try:
    for attempt in range(100):
        try:
            request('GET', '/status')
            break
        except OSError:
            time.sleep(0.1)
    capabilities = request('POST', '/session', session_options)
    session = capabilities['sessionId']
    assert command('/moz/addon/install', {'path': str(archive), 'temporary': True}) == manifest['browser_specific_settings']['gecko']['id']
    command('/moz/context', {'context': 'chrome'})
    uuid = js('return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))["job-log@emanuelcabral.dev"];')
    command('/moz/context', {'context': 'content'})
    extension_url = f'moz-extension://{uuid}'
    command('/url', {'url': extension_url + '/options.html'})
    wait_for('document.querySelector("#googleAccountBadge").textContent === "No conectada"')
    assert js('return document.querySelector("#privacyDisclosure").open;')
    assert js('return typeof chrome.identity.getAuthToken;') == 'undefined'
    redirect = 'http://127.0.0.1/mozoauth2/' + js('return new URL(chrome.identity.getRedirectURL()).hostname.split(".")[0];')
    screenshot('options-first-run.png')

    js('''document.querySelector('#geminiApiKey').value='synthetic-key';
        document.querySelector('#configForm').dispatchEvent(new Event('submit',{cancelable:true}));''')
    wait_for('document.querySelector("#status").textContent.includes("Aceptá")')
    assert js('const done=arguments[arguments.length-1];chrome.storage.sync.get(null,done);', True) == {}

    js(mock_fetch)
    js("document.querySelector('#privacyConsent').checked=true;")
    js(f'''window.nativeLaunch=chrome.identity.launchWebAuthFlow;
        chrome.identity.launchWebAuthFlow=(options,callback)=>{{
            window.googleOAuthUrl=options.url;
            const params=new URL(options.url).searchParams;
            window.nativeLaunch({{url:{json.dumps(fixture_url + '/oauth?')}+params,interactive:options.interactive}},callback);
        }};
        document.querySelector('#btnConnectGoogle').click();''')
    wait_for('document.querySelector("#googleAccountBadge").textContent === "Conectada"')
    stored = js('const done=arguments[arguments.length-1];chrome.storage.local.get(null,done);', True)
    assert stored['google_access_token'] == 'synthetic-token'
    assert stored['google_token_scope'] == 'https://www.googleapis.com/auth/drive.file'
    assert stored['google_account_email'] == 'check@example.invalid'
    assert stored['google_authorized_spreadsheet_id'] == 'synthetic-sheet'
    configured = js('const done=arguments[arguments.length-1];chrome.storage.sync.get(null,done);', True)
    assert configured['spreadsheet_id'] == 'synthetic-sheet' and configured['privacy_consent']
    assert js('return document.querySelector("#spreadsheetId");') is None
    assert js('return document.querySelector("#btnConnectGoogle").textContent;') == 'Cambiar planilla'
    assert not stored.get('user_disconnected')
    google_url = js('return window.googleOAuthUrl;')
    picker_params = parse_qs(urlparse(google_url).query)
    assert picker_params['trigger_onepick'] == ['true']
    assert picker_params['scope'] == ['https://www.googleapis.com/auth/drive.file']
    with urlopen(google_url, timeout=20) as response:
        google_redirect_accepted = 'redirect_uri_mismatch' not in response.read().decode()

    js('''document.querySelector('#privacyConsent').checked=true;
        document.querySelector('#cvGoal').value='30';
        document.querySelector('#configForm').dispatchEvent(new Event('submit',{cancelable:true}));''')
    wait_for('document.querySelector("#status").textContent === "Configuración guardada correctamente"')
    requests = js('return window.requests;')
    goal = next(item for item in requests if item['options'].get('method') == 'PUT')
    assert json.loads(goal['options']['body'])['values'] == [[30]]
    js('''document.querySelector('#newWeekName').value='Semana 2';
        document.querySelector('#weekForm').dispatchEvent(new Event('submit',{cancelable:true}));''')
    wait_for('document.querySelector("#weekStatus").textContent === "Semana 2 agregada con éxito"')
    assert any('Semana 2' in item['options'].get('body', '') for item in js('return window.requests;'))
    js('document.querySelector("#toggleApiKey").click();')
    assert js('return document.querySelector("#geminiApiKey").type;') == 'text'
    js('document.querySelector("#toggleApiKey").click();')
    assert js('return document.querySelector("#geminiApiKey").type;') == 'password'
    screenshot('options-configured.png')
    js('document.querySelector("#btnDisconnectGoogle").click();')
    wait_for('document.querySelector("#googleAccountBadge").textContent === "No conectada"')
    stored = js('const done=arguments[arguments.length-1];chrome.storage.local.get(null,done);', True)
    assert stored['user_disconnected'] and 'google_access_token' not in stored and 'google_account_email' not in stored
    assert 'google_authorized_spreadsheet_id' not in stored
    assert js('return document.querySelector("#btnConnectGoogle").textContent;') == 'Autorizar planilla'

    request('DELETE', f'/session/{session}')
    session = None
    restarted = request('POST', '/session', session_options)
    session = restarted['sessionId']
    command('/moz/addon/install', {'path': str(archive), 'temporary': True})
    command('/url', {'url': extension_url + '/options.html'})
    wait_for('document.querySelector("#googleAccountBadge").textContent === "No conectada"')
    assert js('return document.querySelector("#geminiApiKey").value;') == 'synthetic-key'
    assert not js('return document.querySelector("#privacyDisclosure").open;')
    network = js('''const done=arguments[arguments.length-1];
        const endpoints=[
        ['sheets','https://sheets.googleapis.com/v4/spreadsheets/test',{headers:{Authorization:'Bearer invalid-token'}}],
        ['tokeninfo','https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=invalid-token',{}],
        ['gemini','https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=invalid-key',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}],
        ['groq','https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer invalid-key','Content-Type':'application/json'},body:'{}'}]];
        Promise.all(endpoints.map(async([name,url,options])=>{
            try {const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});return {name,status:response.status};}
            catch(error){return {name,error:error.message};}
        })).then(done);''', True)
    assert all(400 <= item.get('status', 0) < 500 for item in network), network

    command('/url', {'url': fixture_url + '/jobs/1'})
    command('/moz/context', {'context': 'chrome'})
    js('document.querySelector("#unified-extensions-button").click();')
    wait_for('document.querySelector("#job-log_emanuelcabral_dev-BAP")')
    js('document.querySelector("#job-log_emanuelcabral_dev-BAP").click();')
    command('/moz/context', {'context': 'content'})
    time.sleep(0.3)
    command('/moz/context', {'context': 'chrome'})
    js('document.querySelector("#unified-extensions-panel").hidePopup();')
    command('/moz/context', {'context': 'content'})
    command('/window/new', {'type': 'tab'})
    handles = command('/window/handles', method='GET')
    command('/window', {'handle': handles[-1]})
    command('/url', {'url': extension_url + '/popup.html'})
    tab = js(f'''const done=arguments[arguments.length-1];chrome.tabs.query({{}},tabs=>done(tabs.find(tab=>tab.url.startsWith({json.dumps(fixture_url)})).id));''', True)
    js('''const done=arguments[arguments.length-1];chrome.storage.local.set({google_access_token:'synthetic-token',google_token_scope:'https://www.googleapis.com/auth/drive.file',google_token_expires_at:Date.now()+3600000,cached_weeks:['Semana 1']},()=>chrome.storage.local.remove('user_disconnected',done));''', True)
    command('/url', {'url': extension_url + '/popup.html'})
    wait_for('!document.querySelector("#btnPostular").disabled')
    js(mock_fetch)
    screenshot('popup-collapsed.png')
    js('''document.querySelector('#noteSection').open=true;
        document.querySelector('#applicationNote').value='=SUM(1;2)\\nReferencia: contacto personal';
        document.querySelector('#applicationNote').dispatchEvent(new Event('input'));''')
    draft = js('const done=arguments[arguments.length-1];chrome.storage.local.get("application_note_draft",done);', True)
    assert draft['application_note_draft']['text'].startswith('=SUM')
    command('/url', {'url': extension_url + '/popup.html'})
    wait_for('!document.querySelector("#btnPostular").disabled')
    assert js('return document.querySelector("#applicationNote").value;') == draft['application_note_draft']['text']
    assert js('return document.querySelector("#noteSection").open;')
    js(mock_fetch)
    screenshot('popup-note.png')
    js(f'chrome.tabs.query=async()=>[{{id:{tab}}}];document.querySelector("#btnPostular").click();')
    wait_for('document.querySelector("#status").textContent.includes("Postulación registrada con éxito")')
    requests = js('return window.requests;')
    ai = next(item for item in requests if 'generateContent' in item['url'])
    assert 'Example Company is hiring' in ai['options']['body']
    assert 'contacto personal' not in ai['options']['body'], 'Notes must not be sent to the AI provider'
    saved = next(item for item in requests if ':append' in item['url'])
    row = json.loads(saved['options']['body'])['values'][0]
    assert row[1] == 'Example Company' and row[3] == 'Software Engineer' and fixture_url in row[4]
    assert row[8] == "'=SUM(1;2)\nReferencia: contacto personal"
    assert js('return document.querySelector("#applicationNote").value;') == ''
    assert not js('return document.querySelector("#noteSection").open;')
    assert js('const done=arguments[arguments.length-1];chrome.storage.local.get("application_note_draft",done);', True) == {}
    screenshot('popup-registered.png')
    js('''const done=arguments[arguments.length-1];chrome.storage.sync.set({groq_api_key:'synthetic-key'},done);''', True)
    js('window.failGemini=true;window.requests=[];document.querySelector("#btnPostular").click();')
    wait_for('document.querySelector("#status").textContent.includes("Postulación registrada con éxito")')
    requests = js('return window.requests;')
    assert any('generateContent' in item['url'] for item in requests)
    assert any('chat/completions' in item['url'] for item in requests)
    assert any(':append' in item['url'] for item in requests)

    js('const done=arguments[arguments.length-1];chrome.storage.local.set({user_disconnected:true},done);', True)
    js('document.querySelector("a[href=\'progress.html\']").click();')
    handles = command('/window/handles', method='GET')
    command('/window', {'handle': handles[-1]})
    wait_for('document.querySelector("#refreshProgress") && !document.querySelector("#refreshProgress").disabled')
    assert js('return location.pathname;') == '/progress.html'
    js(mock_fetch)
    js('const done=arguments[arguments.length-1];chrome.storage.local.set({google_access_token:"synthetic-token",google_token_scope:"https://www.googleapis.com/auth/drive.file",google_token_expires_at:Date.now()+3600000},()=>chrome.storage.local.remove("user_disconnected",done));', True)
    js('document.querySelector("#refreshProgress").click();')
    wait_for('!document.querySelector("#progressChart").hidden')
    assert js('return document.querySelectorAll("#progressRows tr").length;') == 3
    assert js('return Number(document.querySelectorAll(".bar-fill")[1].getAttribute("height"));') == 3 * js('return Number(document.querySelectorAll(".bar-fill")[0].getAttribute("height"));')
    assert js('return document.querySelectorAll(".bar-fill")[2].getAttribute("height");') == '0'
    assert js('return document.querySelectorAll(".goal-marker").length;') == 1
    assert js('return document.querySelectorAll(".goal-marker")[0].getAttribute("y1");') == '125.5'
    assert all(item['options'].get('method', 'GET') == 'GET' for item in js('return window.requests;'))
    screenshot('progress-desktop.png')
    command('/window/rect', {'width': 400, 'height': 800})
    assert js('return document.documentElement.scrollWidth <= innerWidth;'), 'The graph must not overflow a narrow viewport'
    screenshot('progress-narrow.png')
    command('/window/rect', {'width': 1280, 'height': 900})
    js('window.progressValues=Array.from({length:20},(_,i)=>[`Semana ${i+1}`,i,25]);document.querySelector("#refreshProgress").click();')
    wait_for('document.querySelectorAll("#progressRows tr").length === 12')
    assert js('return document.querySelector("#weekRange").textContent;') == 'Semanas 9–20 de 20'
    navigation_requests = len(js('return window.requests;'))
    js('document.querySelector("#previousWeeks").click();')
    assert js('return document.querySelectorAll("#progressRows tr").length;') == 8
    assert js('return document.querySelector("#previousWeeks").disabled;')
    js('document.querySelector("#nextWeeks").click();')
    assert js('return document.querySelectorAll("#progressRows tr").length;') == 12
    assert len(js('return window.requests;')) == navigation_requests
    command('/window/rect', {'width': 400, 'height': 800})
    wait_for('document.querySelectorAll("#progressRows tr").length < 12')
    assert js('const chart=document.querySelector(".chart-viewport");return chart.scrollWidth <= chart.clientWidth;'), 'No horizontal scrolling in the chart'
    screenshot('progress-pagination-narrow.png')
    command('/window/rect', {'width': 1280, 'height': 900})
    wait_for('document.querySelectorAll("#progressRows tr").length === 12')
    js('window.progressValues=Array.from({length:13},(_,i)=>[i===12?"Semana demo":`Semana ${i+1}`,i===12?3:0,25]);window.delayProgress=true;document.querySelector("#refreshProgress").click();')
    wait_for('!document.querySelector("#progressLoading").hidden')
    assert js('return getComputedStyle(document.querySelector("#progressStatus")).position;') == 'absolute'
    loading_box = js('const box=document.querySelector("#progressLoading").getBoundingClientRect();return {width:box.width,height:box.height};')
    assert js('return document.querySelectorAll("#progressLoading .spinner").length;') == 1
    screenshot('progress-loading.png')
    wait_for('!document.querySelector("#refreshProgress").disabled')
    assert js('const box=document.querySelector("#progressChart").getBoundingClientRect();return {width:box.width,height:box.height};') == loading_box, 'Loading and chart must have identical container dimensions'
    assert 'Datos de tu planilla' not in js('return document.querySelector("#progressUpdated").textContent;')
    assert js('''const labels=[...document.querySelectorAll('.week-label')].map(label=>label.getBBox());
        return labels.every((label,i)=>!i || labels[i-1].x+labels[i-1].width+4 <= label.x);'''), 'Week labels must not overlap'
    assert js('return document.querySelectorAll(".week-label")[11].querySelectorAll("tspan").length;') == 2
    screenshot('progress-many-weeks.png')
    js('window.delayProgress=false;')
    js('window.progressValues=[];document.querySelector("#refreshProgress").click();')
    wait_for('document.querySelector("#progressStatus").textContent.includes("Todavía no hay semanas")')
    assert js('return document.querySelector("#progressChart").hidden;')
    js('window.fetch=async()=>{throw new TypeError("Failed to fetch")};document.querySelector("#refreshProgress").click();')
    wait_for('document.querySelector("#progressStatus").textContent.includes("conexión")')
    screenshot('progress-error.png')
    results = {'firefox': capabilities['capabilities']['browserVersion'], 'version': manifest['version'], 'redirect_uri': redirect,
        'checks': ['temporary installation', 'consent', 'native OAuth loopback interception', 'account UI', 'configuration and goal', 'week creation', 'password visibility',
                   'disconnect', 'configuration persistence after Firefox restart', 'real API reachability', 'activeTab and native script injection', 'AI and Sheets with synthetic responses', 'Gemini to Groq fallback',
                   'note draft after popup reload', 'note write and formula protection', 'notes excluded from AI', 'draft cleanup after success', 'progress opens in a tab', 'progress bars and goals',
                   'progress narrow viewport', 'previous/next periods without network requests', 'responsive pagination without horizontal scrolling', 'week labels without overlap', 'loading spinner', 'matching loading/chart dimensions', 'progress empty and network error states'],
        'network': network, 'google_redirect_accepted': google_redirect_accepted,
        'pending': (['Google Cloud redirect configuration'] if not google_redirect_accepted else []) + ['real Google account and Sheets write', 'real provider credentials', 'AMO signing and review']}
    (artifacts / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))
finally:
    if session:
        request('DELETE', f'/session/{session}')
    driver.terminate()
    driver.wait(timeout=10)
    server.shutdown()
    profile.cleanup()
    log.close()
