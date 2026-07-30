'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const labels = require('../labels');
const {
    deriveOutputButtonClass,
    deriveOutputButtonText,
    derivePendingVisualState,
    deriveOutputVisualState,
    isTransitionState
} = require('../splitpon-output-control');

const repoRoot = path.resolve(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(repoRoot, name), 'utf8');
}

test('main window keeps output controls but moves the NDI link to the menu', () => {
    const html = read('index.html');
    const style = read('style.css');
    const preload = read('preload.js');

    assert.match(
        html,
        /id="splitpon-output-control"[^>]*hidden/
    );
    assert.match(html, /output-control-operator-window-toggle/);
    assert.match(html, /output-control-osd-toggle/);
    assert.match(html, /output-control-ndi-toggle/);
    assert.match(html, /splitpon-output-control\.js/);
    assert.doesNotMatch(html, /output-control-ndi-info|ndi\.video/);
    assert.match(style, /\.output-control-section/);
    assert.match(preload, /splitPonOutputControl/);
    assert.match(
        preload,
        /splitPonAddonPlatformSupported\s*&&\s*!isFullscreenRenderer/
    );
    assert.match(preload, /splitpon-output-control-get-status/);
    assert.match(preload, /splitpon-output-control-set-output/);
    assert.match(preload, /splitpon-output-control-set-osd/);
    assert.equal(
        fs.existsSync(path.join(repoRoot, 'splitpon-output-control.js')),
        true
    );
});

test('OTHER SOURCE keeps the UVC panel and selector vertically compact', () => {
    const html = read('index.html');
    const style = read('style.css');

    assert.match(
        html,
        /class="other-source-heading" data-label-id="other-source-title"/
    );
    assert.match(
        html,
        /class="control-area other-source-uvc-panel"/
    );
    assert.match(
        style,
        /\.other-source-heading\s*\{[^}]*margin-bottom:\s*-0\.25rem/s
    );
    assert.match(
        style,
        /\.other-source-uvc-panel p\s*\{[^}]*margin-bottom:\s*0/s
    );
    assert.match(
        style,
        /#device-selection-container\s*\{[^}]*margin-top:\s*0/s
    );
    assert.match(
        style,
        /h2\s*\{[^}]*line-height:\s*1\.15/s
    );
    assert.match(
        style,
        /\.end-mode-area p\s*\{[^}]*line-height:\s*1\.15/s
    );
});

test('Tools menu owns installed-only output controls and nearby NDI link', () => {
    const main = read('main.js');
    const ndiOutputIndex = main.indexOf(
        'label: labels["menu-tools-splitpon-output-ndi"]'
    );
    const ndiInfoIndex = main.indexOf(
        'label: labels["menu-tools-splitpon-ndi-info"]'
    );

    assert.match(
        main,
        /!SPLITPON_ADDON_PLATFORM_SUPPORTED\s*\|\|\s*splitPonAddonStatus\.installed !== true/
    );
    assert.match(
        main,
        /labels\["menu-tools-splitpon-output-operator-window"\]/
    );
    assert.match(main, /labels\["menu-tools-splitpon-output-osd"\]/);
    assert.match(main, /type:\s*'checkbox'/);
    assert.match(
        main,
        /checked:\s*splitPonAddonStatus\.outputs\.ndi\.desired/
    );
    assert.equal(ndiOutputIndex >= 0, true);
    assert.equal(ndiInfoIndex > ndiOutputIndex, true);
    assert.match(main, /shell\.openExternal\('https:\/\/ndi\.video\/'\)/);
    assert.equal(
        labels.ja['menu-tools-splitpon-ndi-info'],
        'NDI®について（ndi.video）'
    );
    assert.equal(
        labels.en['menu-tools-splitpon-ndi-info'],
        'About NDI® (ndi.video)'
    );
});

test('main-window output IPC is bounded to the primary renderer', () => {
    const main = read('main.js');
    const view = read('splitpon-output-control.js');

    assert.match(
        main,
        /event\.sender !== mainWindow\.webContents/
    );
    assert.match(
        main,
        /if \(SPLITPON_ADDON_PLATFORM_SUPPORTED\) \{\s*ipcMain\.handle\('splitpon-output-control-get-status'/s
    );
    assert.match(
        main,
        /\['ndi', 'operatorMonitor'\]\.includes\(payload\.output\)/
    );
    assert.match(main, /typeof payload\.enabled !== 'boolean'/);
    assert.match(view, /elements\.section\.hidden = !installed/);
    assert.match(view, /pending\.set\(output, nextEnabled\)/);
});

test('main-window output buttons keep independent transition states', () => {
    assert.equal(
        deriveOutputVisualState(
            { desired: false, observedState: 'stopped' },
            'stopped'
        ),
        'off'
    );
    assert.equal(
        deriveOutputVisualState(
            { desired: true, observedState: 'starting' },
            'starting'
        ),
        'starting'
    );
    assert.equal(
        deriveOutputVisualState(
            { desired: true, observedState: 'running' },
            'running'
        ),
        'on'
    );
    assert.equal(
        deriveOutputVisualState(
            { desired: true, observedState: 'crashed' },
            'failed'
        ),
        'error'
    );
    assert.equal(deriveOutputButtonClass('off'), 'button-gray');
    assert.equal(deriveOutputButtonClass('on'), 'button-green');
    assert.equal(deriveOutputButtonClass('starting'), 'button-orange');
    assert.equal(deriveOutputButtonClass('error'), 'button-red');
    assert.equal(isTransitionState('stopping'), true);
    assert.equal(derivePendingVisualState('off', true), 'starting');
    assert.equal(
        deriveOutputButtonText('NDI® OUT', 'starting', '起動中…'),
        '起動中…'
    );
});

test('Tools menu keeps status, repair state, and trademark attribution', () => {
    const main = read('main.js');

    assert.equal(labels.ja['menu-tools-splitpon-addon'], '出力コントロール');
    assert.equal(labels.en['menu-tools-splitpon-addon'], 'Output Control');
    assert.equal(
        labels.ja['menu-tools-splitpon-addon-state-stopped'],
        '準備完了'
    );
    assert.equal(
        labels.ja['menu-tools-splitpon-addon-state-running'],
        '出力中'
    );
    assert.equal(
        labels.ja['menu-tools-splitpon-addon-state-repair-required'],
        '修復が必要'
    );
    assert.equal(
        labels.ja['menu-tools-splitpon-addon-status'],
        '出力状態'
    );
    assert.match(
        main,
        /title:\s*labels\["menu-tools-splitpon-status-title"\]/
    );
    assert.match(
        main,
        /NDI® is a registered trademark of Vizrt NDI AB/
    );
    assert.match(
        main,
        /SPLITPON_ADDON_PLATFORM_SUPPORTED\s*\?\s*\['OK', 'Source code', 'NDI® website'\]\s*:\s*\['OK', 'Source code'\]/
    );
    assert.doesNotMatch(main, /splitpon-m8-test|SPLITPON_M8_TEST/);
    assert.doesNotMatch(
        read('preload.js'),
        /splitpon-m8-test|splitPonM8Test/
    );
});
