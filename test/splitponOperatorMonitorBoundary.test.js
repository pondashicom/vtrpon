'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const {
    createSplitPonOperatorMonitorBridge,
    normalizeOperatorMonitorState,
    parseOperatorMonitorEvent
} = require('../splitpon-operator-monitor-bridge');

const repoRoot = path.resolve(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(repoRoot, name), 'utf8');
}

async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('condition did not become true before timeout');
}

test('legacy monitor path is replaced by formal UI and menu output control', () => {
    const main = read('main.js');
    const preload = read('preload.js');
    const onair = read('onair.js');
    const bridge = read('splitpon-operator-monitor-bridge.js');

    assert.equal(fs.existsSync(path.join(repoRoot, 'operator_monitor.html')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'operator_monitor.js')), false);
    assert.doesNotMatch(onair, /captureStream|window\.open|OperatorMonitorStream/);
    assert.match(onair, /publishSplitPonOperatorMonitorState/);
    assert.match(
        onair,
        /onSplitPonOperatorMonitorEnabled\?\.\(/
    );
    assert.match(
        preload,
        /if \(splitPonAddonPlatformSupported\) \{\s*electronAPI\.publishSplitPonOperatorMonitorState/s
    );
    assert.match(preload, /splitpon-output-control-set-osd/);
    assert.match(preload, /splitpon-operator-monitor-state/);
    assert.match(main, /type:\s*'checkbox'/);
    assert.match(
        main,
        /checked:\s*splitPonAddonStatus\.outputs\.ndi\.desired/
    );
    assert.match(
        main,
        /splitPonAddonStatus\.outputs\.operatorMonitor\.desired/
    );
    assert.match(
        main,
        /splitPonAddonController\.checkCaptureBorderAccess\(\)/
    );
    assert.match(
        main,
        /buildCapturePermissionDialogOptions\(labels\)/
    );
    assert.match(main, /shell\.openExternal\(/);
    assert.match(
        main,
        /requestSplitPonOutputEnabled\(\s*'ndi'/
    );
    assert.match(
        main,
        /requestSplitPonOperatorMonitorEnabled\(/
    );
    assert.match(
        main,
        /onCloseRequested\?\.\(\(\)\s*=>\s*\{/
    );
    assert.match(
        main,
        /requestSplitPonOperatorMonitorEnabled\(false\)/
    );
    assert.match(
        main,
        /if \(splitPonCapturePermissionAllowed\) return true/
    );
    assert.match(
        main,
        /splitPonOperatorMonitorBridge\.reconnectNow\?\.\(\)/
    );
    assert.doesNotMatch(
        bridge,
        /latestState|reconnectTimer|scheduleReconnect/
    );

    const windowMenuIndex =
        main.indexOf('label: labels["menu-window"],');
    const toolsMenuIndex =
        main.indexOf('label: labels["menu-tools"],');
    const outputMenuSpreadIndex =
        main.indexOf(
            '...buildSplitPonAddonMenuItems(labels)'
        );
    const clockSyncIndex =
        main.indexOf("label: 'Clock Sync'");
    assert.equal(windowMenuIndex >= 0, true);
    assert.equal(toolsMenuIndex > windowMenuIndex, true);
    assert.equal(outputMenuSpreadIndex > toolsMenuIndex, true);
    assert.equal(outputMenuSpreadIndex < clockSyncIndex, true);
    assert.match(main, /labels\["menu-tools-splitpon-output-osd"\]/);
    assert.match(
        main,
        /setSplitPonOperatorMonitorOsdDesired\(\s*!splitPonOperatorMonitorOsdDesired\s*\)/
    );
});

test('OSD close request accepts only the bounded window-close event', () => {
    assert.deepEqual(
        parseOperatorMonitorEvent(JSON.stringify({
            schemaVersion: 1,
            type: 'operator-monitor.close-requested',
            reason: 'window-close'
        })),
        {
            schemaVersion: 1,
            type: 'operator-monitor.close-requested',
            reason: 'window-close'
        }
    );
    assert.equal(parseOperatorMonitorEvent('{'), null);
    assert.equal(
        parseOperatorMonitorEvent(JSON.stringify({
            schemaVersion: 1,
            type: 'operator-monitor.close-requested',
            reason: 'worker-crash'
        })),
        null
    );
});

test('OSD snapshot contains only bounded sideband fields', () => {
    const state = normalizeOperatorMonitorState({
        enabled: true,
        remain: ' 00:01:02:03 ',
        duration: '00:04:05:06',
        startMode: 'PLAY',
        endMode: 'REPEAT',
        remainColor: 'RED',
        ftbActive: true,
        dskActive: true,
        fileName: 'must not cross the boundary'
    }, 7);

    assert.deepEqual(state, {
        schemaVersion: 2,
        type: 'operator-monitor.state',
        revision: 7,
        enabled: true,
        remain: '00:01:02:03',
        duration: '00:04:05:06',
        startMode: 'PLAY',
        endMode: 'REPEAT',
        remainColor: 'red',
        ftbActive: true,
        dskActive: true
    });
});

test('OSD state reads the authoritative OnAir FTB and DSK activity', () => {
    const onair = read('onair.js');
    const dsk = read('dsk.js');

    assert.match(
        onair,
        /ftbActive:\s*onairFtbToggleHoldActive\s*===\s*true/
    );
    assert.match(
        onair,
        /isOnAirDSKActuallyActive\?\.\(\)\s*===\s*true/
    );
    assert.match(
        dsk,
        /isOnAirDSKActuallyActive:\s*isOnAirDSKActuallyActive/
    );
});

test('OSD sideband drops unavailable states and retries without replay', async () => {
    const pipeName =
        `\\\\.\\pipe\\vtrpon2-operator-monitor-${process.pid}-${Date.now()}`;
    const sockets = new Set();
    const messages = [];
    const server = net.createServer((socket) => {
        sockets.add(socket);
        let pending = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            pending += chunk;
            while (pending.includes('\n')) {
                const newline = pending.indexOf('\n');
                const line = pending.slice(0, newline);
                pending = pending.slice(newline + 1);
                if (line) messages.push(JSON.parse(line));
            }
        });
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipeName, resolve);
    });

    const bridge = createSplitPonOperatorMonitorBridge({
        pipeName,
        retryIntervalMs: 200
    });
    const closeRequests = [];
    const removeCloseHandler = bridge.onCloseRequested(
        (event) => closeRequests.push(event)
    );
    try {
        assert.equal(bridge.publish({
            enabled: true,
            remain: '00:00:10:00',
            duration: '00:01:00:00',
            startMode: 'PLAY',
            endMode: 'PAUSE'
        }), false);
        await waitFor(() => bridge.getStats().connected);
        assert.equal(messages.length, 0);

        assert.equal(bridge.publish({
            enabled: true,
            remain: '00:00:09:00',
            duration: '00:01:00:00',
            startMode: 'PLAY',
            endMode: 'PAUSE'
        }), true);
        await waitFor(() => messages.length === 1);
        assert.equal(messages[0].enabled, true);
        assert.equal(messages[0].remain, '00:00:09:00');

        const firstSocket = [...sockets][0];
        firstSocket.write(
            '{"schemaVersion":1,' +
            '"type":"operator-monitor.close-requested",' +
            '"reason":"window-close"}\n'
        );
        await waitFor(() => closeRequests.length === 1);
        assert.equal(bridge.getStats().closeRequestCount, 1);

        for (const socket of sockets) socket.destroy();
        await waitFor(() => bridge.getStats().disconnectCount === 1);
        assert.equal(bridge.reconnectNow(), true);
        await waitFor(() => bridge.getStats().connectCount === 2);
        assert.equal(messages.length, 1);
        assert.equal(bridge.getStats().connectAttemptCount, 2);

        assert.equal(bridge.publish({
            enabled: true,
            remain: '00:00:06:00',
            duration: '00:01:00:00',
            startMode: 'PLAY',
            endMode: 'REPEAT'
        }), true);
        await waitFor(() => messages.length === 2);
        assert.equal(messages[1].remain, '00:00:06:00');
        assert.equal(bridge.getStats().droppedStateCount, 1);
    } finally {
        removeCloseHandler();
        bridge.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
});
