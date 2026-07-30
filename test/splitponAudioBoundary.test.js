'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(repoRoot, name), 'utf8');
}

async function waitFor(predicate, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('condition did not become true before timeout');
}

test('SPLIT-PON bridge is exposed only to Fullscreen and does not replace the existing AudioContext', () => {
    const main = read('main.js');
    const preload = read('preload.js');
    const fullscreen = read('fullscreen.js');
    const bridge = read('splitpon-audio-bridge.js');
    const optionalRuntime = read('splitPonOptionalRuntime.js');

    assert.equal(
        (main.match(/additionalArguments: \['--vtrpon2-fullscreen-renderer'\]/g) || []).length,
        2,
        'normal and macOS-recreated Fullscreen windows must carry the private preload marker');
    assert.match(
        preload,
        /splitPonAddonPlatformSupported\s*&&\s*isFullscreenRenderer\s*\?\s*require\('\.\/splitpon-audio-bridge'\)\s*:\s*null/);
    assert.match(preload, /if \(splitPonAudioBridge\) \{\s*electronAPI\.splitPonAudio =/);
    assert.doesNotMatch(
        fullscreen,
        /new \(window\.AudioContext \|\| window\.webkitAudioContext\)\(\s*\{\s*sampleRate:/);
    assert.match(fullscreen, /function teardownSplitPonAudioTap\(/);
    assert.match(
        fullscreen,
        /splitPonAudio\?\.onEnabled\?\.\(\(enabled\) =>/
    );
    assert.match(
        fullscreen,
        /bridgeState\?\.managed && !bridgeState\.active/
    );
    assert.match(preload, /splitpon-audio-set-enabled/);
    assert.match(
        optionalRuntime,
        /env\[AUDIO_MANAGED_ENV\] = '1'/
    );
    assert.match(
        main,
        /if \(!status\.hostRunning\) \{\s*sendSplitPonAudioEnabled\(false\)/
    );
    assert.match(fullscreen, /function cleanupBeforeSourceApply\(\) \{\s*teardownSplitPonAudioTap\(\)/);
    assert.match(fullscreen, /function initializeFullscreenArea\([^)]*\) \{\s*teardownSplitPonAudioTap\(\)/);
    assert.match(fullscreen, /SPLIT-PON bridge exception isolated/);
    assert.match(bridge, /function stopBridge\(\)/);
    assert.match(bridge, /connectDeadlineTimer = setTimeout\(/);
    assert.match(bridge, /function startIdleSilence\(\)/);
    assert.doesNotMatch(bridge, /child_process|process\.exit|app\.quit/);
    assert.match(read('splitpon-audio-worklet.js'), /channel\.fill\(0\)/);
});

test('renderer audio bridge reconnects after an established sidecar connection is lost', async () => {
    const envName = 'VTRPON2_SPLITPON_AUDIO_PIPE';
    const previous = process.env[envName];
    const pipeName = `\\\\.\\pipe\\vtrpon2-audio-boundary-${process.pid}-${Date.now()}`;
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipeName, resolve);
    });

    const modulePath = require.resolve('../splitpon-audio-bridge');
    delete require.cache[modulePath];
    process.env[envName] = pipeName;
    const bridge = require(modulePath);

    try {
        const pcm = new Float32Array(960 * 2);
        assert.equal(bridge.enabled, true);
        assert.equal(bridge.sendPcm(pcm.buffer, 0, 960, 48000, 2), false);
        await waitFor(() => bridge.getStats().connected);
        assert.equal(bridge.sendPcm(pcm.buffer, 960, 960, 48000, 2), true);

        for (const socket of sockets) socket.destroy();
        await waitFor(() => bridge.getStats().reconnectCount === 1);
        assert.equal(bridge.getStats().stopped, false);
        assert.equal(bridge.getStats().connected, true);
        assert.equal(bridge.getStats().disconnectCount, 1);
        assert.equal(bridge.sendPcm(pcm.buffer, 1920, 960, 48000, 2), true);
    } finally {
        bridge.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        delete require.cache[modulePath];
        if (previous === undefined) {
            delete process.env[envName];
        } else {
            process.env[envName] = previous;
        }
    }
});

test('managed renderer audio bridge stays dormant until an output is requested', async () => {
    const pipeEnv = 'VTRPON2_SPLITPON_AUDIO_PIPE';
    const managedEnv = 'VTRPON2_SPLITPON_AUDIO_MANAGED';
    const previousPipe = process.env[pipeEnv];
    const previousManaged = process.env[managedEnv];
    const pipeName =
        `\\\\.\\pipe\\vtrpon2-audio-managed-${process.pid}-${Date.now()}`;
    let connections = 0;
    const sockets = new Set();
    const server = net.createServer((socket) => {
        connections += 1;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipeName, resolve);
    });

    const modulePath = require.resolve('../splitpon-audio-bridge');
    delete require.cache[modulePath];
    process.env[pipeEnv] = pipeName;
    process.env[managedEnv] = '1';
    const bridge = require(modulePath);

    try {
        const pcm = new Float32Array(960 * 2);
        assert.equal(bridge.getStats().managed, true);
        assert.equal(bridge.getStats().active, false);
        assert.equal(
            bridge.sendPcm(pcm.buffer, 0, 960, 48000, 2),
            false
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(connections, 0);

        assert.equal(bridge.setActive(true), true);
        await waitFor(() => bridge.getStats().connected);
        assert.equal(connections, 1);
        assert.equal(
            bridge.sendPcm(pcm.buffer, 960, 960, 48000, 2),
            true
        );

        assert.equal(bridge.setActive(false), false);
        await waitFor(() => !bridge.getStats().connected);
        assert.equal(bridge.getStats().active, false);
    } finally {
        bridge.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        delete require.cache[modulePath];
        if (previousPipe === undefined) {
            delete process.env[pipeEnv];
        } else {
            process.env[pipeEnv] = previousPipe;
        }
        if (previousManaged === undefined) {
            delete process.env[managedEnv];
        } else {
            process.env[managedEnv] = previousManaged;
        }
    }
});

test('managed renderer audio bridge supplies idle silence without an On Air source', async () => {
    const pipeEnv = 'VTRPON2_SPLITPON_AUDIO_PIPE';
    const managedEnv = 'VTRPON2_SPLITPON_AUDIO_MANAGED';
    const previousPipe = process.env[pipeEnv];
    const previousManaged = process.env[managedEnv];
    const pipeName =
        `\\\\.\\pipe\\vtrpon2-audio-idle-${process.pid}-${Date.now()}`;
    const sockets = new Set();
    let received = Buffer.alloc(0);
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('data', (chunk) => {
            received = Buffer.concat([received, chunk]);
        });
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipeName, resolve);
    });

    const modulePath = require.resolve('../splitpon-audio-bridge');
    delete require.cache[modulePath];
    process.env[pipeEnv] = pipeName;
    process.env[managedEnv] = '1';
    const bridge = require(modulePath);

    try {
        const headerBytes = 64;
        const idleFrames = 960;
        const payloadBytes =
            idleFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
        assert.equal(bridge.setActive(true), true);
        await waitFor(() => bridge.getStats().connected);
        await waitFor(
            () => received.length >= headerBytes + payloadBytes,
            2500
        );

        assert.equal(received.toString('ascii', 0, 4), 'SPA1');
        assert.equal(received.readUInt32LE(8), payloadBytes);
        assert.equal(received.readUInt32LE(12), 48000);
        assert.equal(received.readUInt16LE(16), 2);
        assert.equal(received.readUInt32LE(20), idleFrames);
        assert.equal(
            received
                .subarray(headerBytes, headerBytes + payloadBytes)
                .every((value) => value === 0),
            true
        );
        assert.ok(bridge.getStats().idlePacketsSent >= 1);
    } finally {
        bridge.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        delete require.cache[modulePath];
        if (previousPipe === undefined) {
            delete process.env[pipeEnv];
        } else {
            process.env[pipeEnv] = previousPipe;
        }
        if (previousManaged === undefined) {
            delete process.env[managedEnv];
        } else {
            process.env[managedEnv] = previousManaged;
        }
    }
});

test('renderer audio bridge contains a synchronous socket write failure', async () => {
    const envName = 'VTRPON2_SPLITPON_AUDIO_PIPE';
    const previous = process.env[envName];
    const pipeName = `\\\\.\\pipe\\vtrpon2-audio-write-failure-${process.pid}-${Date.now()}`;
    const sockets = new Set();
    const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipeName, resolve);
    });

    const modulePath = require.resolve('../splitpon-audio-bridge');
    delete require.cache[modulePath];
    process.env[envName] = pipeName;
    const bridge = require(modulePath);
    const originalWrite = net.Socket.prototype.write;

    try {
        const pcm = new Float32Array(960 * 2);
        assert.equal(bridge.sendPcm(pcm.buffer, 0, 960, 48000, 2), false);
        await waitFor(() => bridge.getStats().connected);

        let sendResult = true;
        net.Socket.prototype.write = function forcedWriteFailure() {
            throw new Error('forced synchronous socket write failure');
        };
        assert.doesNotThrow(() => {
            sendResult = bridge.sendPcm(pcm.buffer, 960, 960, 48000, 2);
        });
        net.Socket.prototype.write = originalWrite;

        assert.equal(sendResult, false);
        assert.equal(bridge.getStats().stopped, true);
        assert.doesNotThrow(() => bridge.close());
    } finally {
        net.Socket.prototype.write = originalWrite;
        bridge.close();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
        delete require.cache[modulePath];
        if (previous === undefined) {
            delete process.env[envName];
        } else {
            process.env[envName] = previous;
        }
    }
});
