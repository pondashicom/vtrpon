'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    AUDIO_MANAGED_ENV,
    AUDIO_PIPE_ENV,
    OPERATOR_MONITOR_PIPE_ENV,
    loadSplitPonOptionalRuntime
} = require('../splitPonOptionalRuntime');

const repoRoot = path.resolve(__dirname, '..');

test('macOS returns a dormant runtime before loading Windows ADDON modules', async () => {
    const env = {
        [AUDIO_PIPE_ENV]: 'stale-audio',
        [AUDIO_MANAGED_ENV]: '1',
        [OPERATOR_MONITOR_PIPE_ENV]: 'stale-osd'
    };
    const loadedModules = [];
    const runtime = loadSplitPonOptionalRuntime({
        platform: 'darwin',
        env,
        pid: 2468,
        requireModule(request) {
            loadedModules.push(request);
            throw new Error('Windows ADDON module must not load on macOS');
        }
    });

    assert.deepEqual(loadedModules, []);
    assert.equal(runtime.config.available, false);
    assert.equal(runtime.config.installed, false);
    assert.equal(runtime.config.reason, 'unsupported_platform');
    assert.equal(runtime.controller.getStatus().hostRunning, false);
    assert.equal(runtime.operatorMonitorBridge.enabled, false);
    assert.equal(
        runtime.operatorMonitorBridge.getStats().connectAttemptCount,
        0
    );
    assert.equal(env[AUDIO_PIPE_ENV], undefined);
    assert.equal(env[AUDIO_MANAGED_ENV], undefined);
    assert.equal(env[OPERATOR_MONITOR_PIPE_ENV], undefined);
    assert.equal((await runtime.controller.refresh()).ok, true);
});

function validManifest() {
    return {
        schemaVersion: 2,
        id: 'pondashi.vtrpon2.splitpon-addon',
        version: '0.2.0',
        platform: 'windows',
        architecture: 'x64',
        control: {
            protocolVersion: 3,
            transport: 'named-pipe-json-lines',
            hostExecutable: 'vtrpon2-split-pon-addon-host.exe'
        },
        capabilities: {
            outputs: ['ndi', 'operatorMonitor']
        },
        runtime: {
            input: { executable: 'components\\input.exe' },
            core: { executable: 'components\\core.exe' },
            outputs: {
                ndi: { executable: 'components\\ndi.exe' },
                operatorMonitor: {
                    executable: 'components\\monitor.exe'
                }
            }
        }
    };
}

test('missing addon stays dormant without pipe, polling, audio, or OSD initialization', async () => {
    const env = {
        [AUDIO_PIPE_ENV]: 'stale-audio',
        [AUDIO_MANAGED_ENV]: '1',
        [OPERATOR_MONITOR_PIPE_ENV]: 'stale-osd'
    };
    const runtime = loadSplitPonOptionalRuntime({
        platform: 'win32',
        env,
        resourcesPath: 'C:\\resources',
        existsSync: () => false,
        pid: 2468
    });

    assert.equal(runtime.config.available, false);
    assert.equal(runtime.config.installed, false);
    assert.equal(runtime.config.reason, 'not_installed');
    assert.equal(env[AUDIO_PIPE_ENV], undefined);
    assert.equal(env[AUDIO_MANAGED_ENV], undefined);
    assert.equal(env[OPERATOR_MONITOR_PIPE_ENV], undefined);
    assert.equal(runtime.controller.client, null);
    assert.equal(runtime.controller.pollTimer, null);
    assert.equal(runtime.operatorMonitorBridge.enabled, false);
    assert.equal(runtime.operatorMonitorBridge.publish({}), false);
    assert.equal(
        runtime.operatorMonitorBridge.getStats().connectAttemptCount,
        0
    );
    assert.equal((await runtime.controller.refresh()).ok, true);
});

test('invalid or incomplete addon never prepares media sideband pipes', () => {
    for (const readFileSync of [
        () => '{invalid-json',
        () => JSON.stringify({
            ...validManifest(),
            runtime: {
                ...validManifest().runtime,
                outputs: {
                    ndi: { executable: 'components\\ndi.exe' }
                }
            }
        })
    ]) {
        const env = {
            VTRPON2_SPLITPON_ADDON_MANIFEST:
                'C:\\addon\\addon-manifest.json'
        };
        const runtime = loadSplitPonOptionalRuntime({
            platform: 'win32',
            env,
            allowDevelopmentOverrides: true,
            existsSync: () => true,
            readFileSync,
            pid: 2468
        });
        assert.equal(runtime.config.available, false);
        assert.equal(runtime.config.installed, true);
        assert.equal(runtime.config.reason, 'invalid_manifest');
        assert.equal(env[AUDIO_PIPE_ENV], undefined);
        assert.equal(env[OPERATOR_MONITOR_PIPE_ENV], undefined);
        assert.equal(runtime.operatorMonitorBridge.enabled, false);
    }
});

test('complete addon prepares dormant sideband endpoints but does not start the host', () => {
    const env = {
        VTRPON2_SPLITPON_ADDON_MANIFEST:
            'C:\\addon\\addon-manifest.json'
    };
    const runtime = loadSplitPonOptionalRuntime({
        platform: 'win32',
        env,
        allowDevelopmentOverrides: true,
        existsSync: () => true,
        readFileSync: () => JSON.stringify(validManifest()),
        pid: 2468
    });

    assert.equal(runtime.config.available, true);
    assert.equal(runtime.config.installed, true);
    assert.equal(
        env[AUDIO_PIPE_ENV],
        '\\\\.\\pipe\\vtrpon2-splitpon-audio-2468'
    );
    assert.equal(env[AUDIO_MANAGED_ENV], '1');
    assert.equal(
        env[OPERATOR_MONITOR_PIPE_ENV],
        '\\\\.\\pipe\\vtrpon2-splitpon-operator-monitor-2468'
    );
    assert.equal(runtime.controller.getStatus().hostRunning, false);
    assert.equal(runtime.controller.client, null);
    assert.equal(runtime.controller.pollTimer, null);
    assert.equal(
        runtime.operatorMonitorBridge.getStats().connectAttemptCount,
        0
    );
});

test('connector load and initialization failures remain optional', async () => {
    const cases = [
        () => {
            throw new Error('connector missing');
        },
        (request) => {
            if (request === './splitPonAddonController') {
                return {
                    resolveSplitPonAddonConfig() {
                        throw new Error('initialization failed');
                    },
                    SplitPonAddonController: class {}
                };
            }
            if (request === './splitpon-operator-monitor-bridge') {
                return {
                    createSplitPonOperatorMonitorBridge() {
                        throw new Error('must not be called');
                    }
                };
            }
            return {};
        },
        (request) => {
            if (request === './splitPonAddonController') {
                return {
                    resolveSplitPonAddonConfig() {
                        return {
                            available: true,
                            reason: null,
                            mode: 'formal',
                            manifestVersion: '0.2.0'
                        };
                    },
                    SplitPonAddonController: class {
                        constructor() {
                            throw new Error(
                                'controller constructor failed'
                            );
                        }
                    }
                };
            }
            if (request === './splitpon-operator-monitor-bridge') {
                return {
                    createSplitPonOperatorMonitorBridge() {
                        return {};
                    }
                };
            }
            return {
                CAPTURE_BORDER_SETTINGS_URI:
                    'ms-settings:test',
                buildCapturePermissionDialogOptions() {
                    return {};
                }
            };
        }
    ];

    for (const requireModule of cases) {
        const env = {
            [AUDIO_PIPE_ENV]: 'stale-audio',
            [OPERATOR_MONITOR_PIPE_ENV]: 'stale-osd'
        };
        const runtime = loadSplitPonOptionalRuntime({
            platform: 'win32',
            env,
            requireModule
        });
        assert.equal(runtime.config.available, false);
        assert.equal(runtime.controller.getStatus().hostRunning, false);
        assert.equal(runtime.operatorMonitorBridge.enabled, false);
        assert.equal(env[AUDIO_PIPE_ENV], undefined);
        assert.equal(env[OPERATOR_MONITOR_PIPE_ENV], undefined);
        assert.ok(runtime.initializationError instanceof Error);
        assert.equal((await runtime.controller.refresh()).ok, true);
        assert.equal(
            (await runtime.controller.setOutputs({ ndi: true })).ok,
            false
        );
    }
});

test('VTR-PON2 quit waits at most four seconds and addon failure cannot close presentation windows', () => {
    const main = fs.readFileSync(
        path.join(repoRoot, 'main.js'),
        'utf8'
    );
    const controller = fs.readFileSync(
        path.join(repoRoot, 'splitPonAddonController.js'),
        'utf8'
    );
    const optionalRuntime = fs.readFileSync(
        path.join(repoRoot, 'splitPonOptionalRuntime.js'),
        'utf8'
    );

    assert.match(
        main,
        /SPLITPON_ADDON_QUIT_DEADLINE_MS = 4_000/
    );
    assert.match(
        main,
        /splitPonAddonController\.shutdown\(\s*SPLITPON_ADDON_QUIT_DEADLINE_MS\s*\)/
    );
    assert.doesNotMatch(
        `${controller}\n${optionalRuntime}`,
        /\bapp\.(?:quit|exit)\(|(?:fullscreenWindow|mainWindow)\.(?:close|destroy)\(/
    );
});
