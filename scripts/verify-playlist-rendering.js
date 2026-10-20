'use strict';

// Run with Electron; an optional source root may point to a packaged app.asar.
// Uses a separate profile and a hidden window, never the operator's settings.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vtrpon-playlist-rendering-'));
app.setPath('userData', path.join(temporaryRoot, 'user-data'));
app.setPath('sessionData', path.join(temporaryRoot, 'session-data'));
app.disableHardwareAcceleration();

async function checkInRenderer() {
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    window.__playlistInjected = false;
    const payload = '<img src="data:," onerror="window.__playlistInjected=true">';
    const fields = ['name', 'resolution', 'duration', 'inPoint', 'outPoint',
        'totalRemainDisplay', 'type', 'defaultVolume', 'startMode', 'endMode'];
    let checked = 0;
    for (const mediaOffline of [false, true]) {
        for (const field of fields) {
            // JSON round trip also represents a stored/imported playlist item.
            const file = JSON.parse(JSON.stringify({
                name: '番組 <本編> & "字幕".mp4', path: 'C:/missing/program.mp4',
                resolution: '1920x1080', duration: '00:00:30:00',
                inPoint: '00:00:00:00', outPoint: '00:00:30:00',
                startMode: 'PLAY', endMode: 'OFF', mediaOffline, [field]: payload
            }));
            const info = createFileInfo(file, checked);
            const status = createStatusContainer(file);
            document.body.append(info, status);
            if (field !== 'name' || !mediaOffline) {
                check((info.textContent + status.textContent).includes(payload), `${field}: literal text lost`);
            }
            check(info.querySelectorAll('.file-details-row').length === 5, 'Details layout changed');
            check(status.querySelectorAll('.status-row').length === 2, 'Status layout changed');
            checked += 1;
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    check(document.querySelectorAll('img, svg, iframe, script').length === 0, 'Injected element created');
    check(window.__playlistInjected === false, 'Injected event handler executed');
    return { cases: checked, injectedElements: 0, injectedHandlerExecuted: false };
}

app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true })
    );
    const source = fs.readFileSync(path.join(sourceRoot, 'playlist.js'), 'utf8');
    const start = source.indexOf('function createFileInfo(');
    const end = source.indexOf('function updateItemStateClass(', start);
    assert.ok(start >= 0 && end > start, 'Playlist rendering functions not found');
    const html = fs.readFileSync(path.join(sourceRoot, 'index.html'), 'utf8');
    const csp = html.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
    assert.ok(csp, 'Application CSP not found');
    const fixture = path.join(temporaryRoot, 'rendering.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head>${csp[0]}</head><body></body></html>`);
    const window = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: true }
    });
    await window.loadFile(fixture);
    const result = await window.webContents.executeJavaScript(
        `${source.slice(start, end)}\n(${checkInRenderer.toString()})();`
    );
    console.log('VTRPON2_PLAYLIST_RENDERING_PASS', JSON.stringify({ electron: process.versions.electron, ...result }));
    window.destroy();
    app.exit(0);
}).catch((error) => {
    console.error('VTRPON2_PLAYLIST_RENDERING_FAIL', error);
    app.exit(1);
});
