'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
    NamedPipeHostClient,
    SplitPonAddonController,
    buildHostArguments,
    resolveSplitPonAddonConfig
} = require('../splitPonAddonController');

class FakeHostClient extends EventEmitter {
    constructor() {
        super();
        this.child = { pid: 3001 };
        this.observedState = 'stopped';
        this.desiredState = 'stopped';
        this.generation = 0;
        this.pid = null;
        this.lastPid = null;
        this.lastExitCode = null;
        this.lastStopForced = false;
        this.workerError = null;
        this.closed = false;
        this.exitWaiters = [];
    }

    state() {
        return {
            type: 'state.changed',
            stateRevision: this.generation + 1,
            hostState: 'active',
            presentation: {
                revision: 0,
                fullscreenHwnd: '',
                rendererPid: 0
            },
            worker: {
                desiredState: this.desiredState,
                observedState: this.observedState,
                generation: this.generation,
                pid: this.pid,
                lastPid: this.lastPid,
                lastExitCode: this.lastExitCode,
                lastStopForced: this.lastStopForced,
                error: this.workerError
            }
        };
    }

    response(ok = true, error = null) {
        return {
            type: 'response',
            requestId: 'fake',
            ok,
            state: this.state(),
            error
        };
    }

    async send(type) {
        if (type === 'system.start') {
            if (this.observedState === 'running') {
                return this.response(false, {
                    component: 'worker',
                    code: 'already_running',
                    nativeCode: 0,
                    message: 'already running',
                    attempt: this.generation,
                    timestamp: '2026-07-26T00:00:00.000Z'
                });
            }
            this.desiredState = 'running';
            this.generation += 1;
            this.pid = 4000 + this.generation;
            this.lastPid = this.pid;
            this.lastExitCode = null;
            this.workerError = null;
            this.observedState = 'running';
            return this.response();
        }
        if (type === 'status.get') {
            return this.response();
        }
        if (type === 'capture.borderless.check') {
            return {
                ...this.response(),
                captureBorderAccess: {
                    supported: true,
                    allowed: false,
                    status: 'denied_by_user',
                    error: null,
                    settingsUri:
                        'ms-settings:' +
                        'privacy-graphicscapturewithoutborder'
                }
            };
        }
        if (type === 'system.stop') {
            this.desiredState = 'stopped';
            this.pid = null;
            this.lastExitCode = 0;
            this.observedState = 'stopped';
            return this.response();
        }
        if (type === 'shutdown') {
            const result = this.response();
            queueMicrotask(() => this.exit(0, null));
            return result;
        }
        throw new Error(`unsupported fake command: ${type}`);
    }

    simulateWorkerCrash(exitCode = 9) {
        this.pid = null;
        this.lastExitCode = exitCode;
        this.observedState = 'failed';
        this.workerError = {
            component: 'worker',
            code: 'child_exited',
            nativeCode: exitCode,
            message: 'child exited without a STOP command',
            attempt: this.generation,
            timestamp: '2026-07-26T00:00:01.000Z'
        };
    }

    exit(code, signal) {
        if (this.closed) return;
        this.closed = true;
        const info = { code, signal, stderr: '' };
        this.emit('exit', info);
        for (const resolve of this.exitWaiters.splice(0)) resolve(info);
    }

    waitForExit() {
        if (this.closed) {
            return Promise.resolve({ code: 0, signal: null, stderr: '' });
        }
        return new Promise((resolve) => this.exitWaiters.push(resolve));
    }

    forceClose() {
        this.exit(1, null);
    }
}

class FakeFormalHostClient extends EventEmitter {
    constructor() {
        super();
        this.child = { pid: 3101 };
        this.closed = false;
        this.exitWaiters = [];
        this.outputs = {
            ndi: false,
            operatorMonitor: false
        };
        this.presentationRevision = 0;
        this.nextPid = 5000;
        this.requests = [];
        this.onRequest = null;
        this.components = Object.fromEntries(
            ['input', 'core', 'ndi', 'operatorMonitor'].map(
                (name) => [
                    name,
                    {
                        component: name,
                        desiredState: 'stopped',
                        observedState: 'stopped',
                        generation: 0,
                        pid: null,
                        error: null
                    }
                ]
            )
        );
    }

    componentState(name, running) {
        const component = this.components[name];
        if (running && component.observedState !== 'running') {
            component.generation += 1;
            component.pid = ++this.nextPid;
        }
        if (!running) component.pid = null;
        component.desiredState = running ? 'running' : 'stopped';
        component.observedState = running ? 'running' : 'stopped';
    }

    state() {
        const shared = this.outputs.ndi ||
            this.outputs.operatorMonitor;
        return {
            type: 'state.changed',
            stateRevision: this.nextPid,
            hostState: 'active',
            presentation: {
                revision: this.presentationRevision,
                fullscreenHwnd:
                    this.presentationRevision ? '0x1234' : '',
                rendererPid:
                    this.presentationRevision ? 5678 : 0
            },
            components: structuredClone(this.components),
            worker: structuredClone(this.components.input),
            outputs: {
                ndi: {
                    desired: this.outputs.ndi,
                    observedState:
                        this.components.ndi.observedState,
                    pid: this.components.ndi.pid
                },
                operatorMonitor: {
                    desired: this.outputs.operatorMonitor,
                    observedState:
                        this.components.operatorMonitor
                            .observedState,
                    pid: this.components.operatorMonitor.pid
                },
                sharedCaptureDesired: shared,
                sharedCaptureObservedState:
                    shared ? 'running' : 'stopped'
            }
        };
    }

    response() {
        return {
            type: 'response',
            requestId: 'formal-fake',
            ok: true,
            state: this.state()
        };
    }

    async send(type, fields = {}, timeoutMs) {
        const request = { type, timeoutMs };
        this.requests.push(request);
        this.onRequest?.(request);
        if (type === 'status.get') return this.response();
        if (type === 'capture.borderless.check') {
            return {
                ...this.response(),
                captureBorderAccess: {
                    supported: true,
                    allowed: true,
                    status: 'allowed',
                    error: null,
                    settingsUri:
                        'ms-settings:' +
                        'privacy-graphicscapturewithoutborder'
                }
            };
        }
        if (type === 'presentation.update') {
            this.presentationRevision =
                fields.presentationRevision;
            return this.response();
        }
        if (type === 'outputs.set') {
            this.outputs = { ...fields.outputs };
            const shared = this.outputs.ndi ||
                this.outputs.operatorMonitor;
            this.componentState('input', shared);
            this.componentState('core', shared);
            this.componentState('ndi', this.outputs.ndi);
            this.componentState(
                'operatorMonitor',
                this.outputs.operatorMonitor
            );
            return this.response();
        }
        if (type === 'system.stop') {
            this.outputs = {
                ndi: false,
                operatorMonitor: false
            };
            for (const name of Object.keys(this.components)) {
                this.componentState(name, false);
            }
            return this.response();
        }
        if (type === 'shutdown') {
            const result = this.response();
            queueMicrotask(() => this.exit(0, null));
            return result;
        }
        throw new Error(`unsupported formal fake command: ${type}`);
    }

    exit(code, signal) {
        if (this.closed) return;
        this.closed = true;
        const info = { code, signal, stderr: '' };
        this.emit('exit', info);
        for (const resolve of this.exitWaiters.splice(0)) resolve(info);
    }

    waitForExit() {
        if (this.closed) {
            return Promise.resolve({ code: 0, signal: null, stderr: '' });
        }
        return new Promise((resolve) => this.exitWaiters.push(resolve));
    }

    forceClose() {
        this.exit(1, null);
    }
}

test('non-Windows keeps the addon unavailable without changing VTR-PON2', () => {
    const config = resolveSplitPonAddonConfig({
        platform: 'darwin',
        env: {},
        resourcesPath: '/Applications/VTR-PON2.app/Contents/Resources',
        existsSync: () => true
    });

    assert.equal(config.available, false);
    assert.equal(config.installed, false);
    assert.equal(config.reason, 'unsupported_platform');
    assert.equal(config.hostPath, null);
    assert.equal(config.workerPath, null);
});

test('Windows config and host arguments use the unified named-pipe host', () => {
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        allowDevelopmentOverrides: true,
        env: {
            VTRPON2_SPLITPON_ADDON_HOST: 'C:\\addon\\host.exe',
            VTRPON2_SPLITPON_ADDON_WORKER: 'C:\\addon\\dummy.exe',
            VTRPON2_SPLITPON_ADDON_ALLOW_DUMMY_CRASH: '1'
        },
        resourcesPath: 'C:\\resources',
        existsSync: () => true
    });

    assert.equal(config.available, true);
    assert.equal(config.installed, false);
    assert.equal(config.allowDummyCrash, true);
    assert.equal(config.hostPath, path.resolve('C:\\addon\\host.exe'));
    assert.deepEqual(
        buildHostArguments(
            config,
            750,
            '\\\\.\\pipe\\vtrpon2-addon-test',
            2468
        ),
        [
            '--pipe-name',
            '\\\\.\\pipe\\vtrpon2-addon-test',
            '--controller-pid',
            '2468',
            '--worker',
            config.workerPath,
            '--worker-arg',
            '--run-ms',
            '--worker-arg',
            '2147483647',
            '--stop-timeout-ms',
            '750',
            '--exit-on-disconnect'
        ]
    );
});

test('formal manifest enables only a complete M6 runtime', () => {
    const manifest = {
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
            input: {
                executable: 'components\\input.exe',
                arguments: ['--input']
            },
            core: {
                executable: 'components\\core.exe',
                arguments: []
            },
            outputs: {
                ndi: {
                    executable: 'components\\ndi.exe',
                    arguments: []
                },
                operatorMonitor: {
                    executable: 'components\\monitor.exe',
                    arguments: []
                }
            }
        }
    };
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        allowDevelopmentOverrides: true,
        env: {
            VTRPON2_SPLITPON_ADDON_MANIFEST:
                'C:\\addon\\addon-manifest.json'
        },
        existsSync: () => true,
        readFileSync: () => JSON.stringify(manifest)
    });

    assert.equal(config.available, true);
    assert.equal(config.installed, true);
    assert.equal(config.mode, 'formal');
    assert.equal(config.protocolVersion, 3);
    assert.deepEqual(config.outputs, ['ndi', 'operatorMonitor']);
    const args = buildHostArguments(
        config,
        750,
        '\\\\.\\pipe\\vtrpon2-addon-formal',
        2468
    );
    assert.deepEqual(args.slice(0, 4), [
        '--pipe-name',
        '\\\\.\\pipe\\vtrpon2-addon-formal',
        '--controller-pid',
        '2468'
    ]);
    assert.ok(args.includes('--input-worker'));
    assert.ok(args.includes('--core-worker'));
    assert.ok(args.includes('--ndi-worker'));
    assert.ok(args.includes('--operator-monitor-worker'));
    assert.ok(args.includes('--input-worker-arg'));
    const readyTimeoutIndex = args.indexOf('--ready-timeout-ms');
    assert.deepEqual(
        args.slice(readyTimeoutIndex, readyTimeoutIndex + 4),
        [
            '--ready-timeout-ms',
            '45000',
            '--heartbeat-timeout-ms',
            '5000'
        ]
    );

    const invalid = resolveSplitPonAddonConfig({
        platform: 'win32',
        allowDevelopmentOverrides: true,
        env: {
            VTRPON2_SPLITPON_ADDON_MANIFEST:
                'C:\\addon\\addon-manifest.json'
        },
        existsSync: () => true,
        readFileSync: () => JSON.stringify({
            ...manifest,
            control: {
                ...manifest.control,
                protocolVersion: 2
            }
        })
    });
    assert.equal(invalid.available, false);
    assert.equal(invalid.installed, true);
    assert.equal(invalid.reason, 'invalid_manifest');
});

test('missing install marker leaves the formal UI dormant', () => {
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {},
        existsSync: () => false
    });
    assert.equal(config.available, false);
    assert.equal(config.installed, false);
    assert.equal(config.reason, 'not_installed');
    assert.deepEqual(config.outputs, []);
});

test('packaged resolution ignores development overrides and bundled resources', () => {
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {
            VTRPON2_SPLITPON_ADDON_HOST: 'C:\\addon\\host.exe',
            VTRPON2_SPLITPON_ADDON_WORKER: 'C:\\addon\\dummy.exe',
            VTRPON2_SPLITPON_ADDON_MANIFEST:
                'C:\\resources\\vtrpon2-splitpon-addon\\addon-manifest.json'
        },
        resourcesPath: 'C:\\resources',
        existsSync: (candidate) =>
            String(candidate).includes('vtrpon2-splitpon-addon')
    });

    assert.equal(config.available, false);
    assert.equal(config.installed, false);
    assert.equal(config.reason, 'not_installed');
    assert.equal(config.manifestPath, null);
});

test('machine install marker resolves the formal addon package', () => {
    const markerPath =
        'C:\\ProgramData\\Pondashi\\VTR-PON2\\addons\\' +
        'pondashi.vtrpon2.splitpon-addon.json';
    const installLocation =
        'C:\\Program Files\\Pondashi\\VTR-PON2 SPLIT-PON ADDON';
    const manifestPath = path.join(
        installLocation,
        'addon-manifest.json'
    );
    const marker = {
        schemaVersion: 1,
        id: 'pondashi.vtrpon2.splitpon-addon',
        version: '0.2.0',
        installLocation
    };
    const manifest = {
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
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {},
        programDataPath: 'C:\\ProgramData',
        existsSync: () => true,
        readFileSync: (candidate) => {
            if (path.resolve(candidate) === path.resolve(markerPath)) {
                return JSON.stringify(marker);
            }
            if (path.resolve(candidate) === path.resolve(manifestPath)) {
                return JSON.stringify(manifest);
            }
            throw new Error(`unexpected read: ${candidate}`);
        }
    });

    assert.equal(config.installed, true);
    assert.equal(config.available, true);
    assert.equal(config.manifestPath, manifestPath);
    assert.equal(config.manifestVersion, '0.2.0');
});

test('broken machine install remains visible as repair required', () => {
    const markerPath =
        'C:\\ProgramData\\Pondashi\\VTR-PON2\\addons\\' +
        'pondashi.vtrpon2.splitpon-addon.json';
    const marker = {
        schemaVersion: 1,
        id: 'pondashi.vtrpon2.splitpon-addon',
        version: '0.2.0',
        installLocation:
            'C:\\Program Files\\Pondashi\\VTR-PON2 SPLIT-PON ADDON'
    };
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {},
        programDataPath: 'C:\\ProgramData',
        existsSync: (candidate) =>
            path.resolve(candidate) === path.resolve(markerPath),
        readFileSync: () => JSON.stringify(marker)
    });

    assert.equal(config.installed, true);
    assert.equal(config.available, false);
    assert.equal(config.reason, 'missing_manifest');
    assert.equal(config.manifestVersion, '0.2.0');
});

test('invalid machine install marker is isolated as broken install', () => {
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {},
        programDataPath: 'C:\\ProgramData',
        existsSync: () => true,
        readFileSync: () => JSON.stringify({
            schemaVersion: 1,
            id: 'pondashi.vtrpon2.splitpon-addon',
            version: '0.2.0',
            installLocation: '..\\untrusted'
        })
    });

    assert.equal(config.installed, true);
    assert.equal(config.available, false);
    assert.equal(config.reason, 'invalid_install_marker');
});

test('install marker and manifest version mismatch requires repair', () => {
    const markerPath =
        'C:\\ProgramData\\Pondashi\\VTR-PON2\\addons\\' +
        'pondashi.vtrpon2.splitpon-addon.json';
    const marker = {
        schemaVersion: 1,
        id: 'pondashi.vtrpon2.splitpon-addon',
        version: '0.2.0',
        installLocation:
            'C:\\Program Files\\Pondashi\\VTR-PON2 SPLIT-PON ADDON'
    };
    const manifest = {
        schemaVersion: 2,
        id: 'pondashi.vtrpon2.splitpon-addon',
        version: '0.3.0',
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
    const config = resolveSplitPonAddonConfig({
        platform: 'win32',
        env: {},
        programDataPath: 'C:\\ProgramData',
        existsSync: () => true,
        readFileSync: (candidate) =>
            path.resolve(candidate) === path.resolve(markerPath)
                ? JSON.stringify(marker)
                : JSON.stringify(manifest)
    });

    assert.equal(config.installed, true);
    assert.equal(config.available, false);
    assert.equal(config.reason, 'invalid_manifest');
});

test('formal host launch failure is contained in addon state', async () => {
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => {
            throw new Error('host startup failed');
        },
        pollIntervalMs: 60_000
    });

    const result = await controller.setOutputs({
        ndi: true,
        operatorMonitor: false
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.hostRunning, false);
    assert.equal(result.status.state, 'failed');
    assert.equal(result.error.scope, 'host');
});

test('formal outputs share Input/Core and stop them after the last output', async () => {
    const fake = new FakeFormalHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });
    let outputTransitionObserved = false;
    fake.onRequest = (request) => {
        if (request.type !== 'outputs.set') return;
        outputTransitionObserved = true;
        assert.equal(controller.pollTimer, null);
    };

    const presentation = await controller.updatePresentation({
        fullscreenHwnd: '0x1234',
        rendererPid: 5678,
        presentationRevision: 1
    });
    assert.equal(presentation.ok, true);

    const ndi = await controller.setOutputs({
        ndi: true,
        operatorMonitor: false
    });
    assert.equal(ndi.ok, true);
    assert.equal(ndi.status.state, 'running');
    assert.equal(ndi.status.sharedCaptureDesired, true);
    assert.equal(ndi.status.outputs.ndi.observedState, 'running');
    assert.equal(outputTransitionObserved, true);
    assert.equal(
        fake.requests.find(
            (request) => request.type === 'outputs.set'
        ).timeoutMs,
        95_000
    );
    const inputPid = ndi.status.components.input.pid;
    const corePid = ndi.status.components.core.pid;

    const both = await controller.setOutputs({
        ndi: true,
        operatorMonitor: true
    });
    assert.equal(both.ok, true);
    assert.equal(both.status.components.input.pid, inputPid);
    assert.equal(both.status.components.core.pid, corePid);
    assert.equal(
        both.status.outputs.operatorMonitor.observedState,
        'running'
    );

    const monitorOnly = await controller.setOutputs({
        ndi: false,
        operatorMonitor: true
    });
    assert.equal(monitorOnly.status.components.input.pid, inputPid);
    assert.equal(monitorOnly.status.components.core.pid, corePid);
    assert.equal(
        monitorOnly.status.outputs.ndi.observedState,
        'stopped'
    );

    const off = await controller.setOutputs({
        ndi: false,
        operatorMonitor: false
    });
    assert.equal(off.ok, true);
    assert.equal(off.status.state, 'stopped');
    assert.equal(off.status.sharedCaptureDesired, false);
    assert.equal(
        off.status.sharedCaptureObservedState,
        'stopped'
    );

    await controller.stop();
});

test('late response after a command timeout does not kill the host pipe', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stdout.resume = () => {};
    child.stderr.setEncoding = () => {};

    const client = new NamedPipeHostClient(child, 1_000);
    let writtenRequestId = null;
    client.socket = {
        writable: true,
        write(payload, encoding, callback) {
            writtenRequestId = JSON.parse(payload).requestId;
            callback(null);
        }
    };
    let protocolError = null;
    client.on('protocolError', (error) => {
        protocolError = error;
    });

    await assert.rejects(
        client.send('status.get', {}, 5),
        /ADDON host command timeout: status\.get/
    );
    client.handleLine(JSON.stringify({
        type: 'response',
        requestId: writtenRequestId,
        ok: true
    }));

    assert.equal(client.protocolFailed, false);
    assert.equal(protocolError, null);
});

test('worker failure is visible, restartable, and does not exit the controller', async () => {
    const fake = new FakeHostClient();
    const killedPids = [];
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            hostPath: 'C:\\addon\\host.exe',
            workerPath: 'C:\\addon\\vtrpon2-addon-dummy.exe',
            workerArguments: [],
            allowDummyCrash: true
        },
        clientFactory: async () => fake,
        processKill: (pid) => killedPids.push(pid),
        pollIntervalMs: 60_000
    });

    const first = await controller.start();
    assert.equal(first.ok, true);
    assert.equal(first.status.state, 'running');
    assert.equal(first.status.generation, 1);
    assert.equal(first.status.hostPid, 3001);

    const duplicate = await controller.start();
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error.component, 'worker');
    assert.equal(duplicate.error.code, 'already_running');
    assert.equal(duplicate.error.attempt, 1);
    assert.equal(
        duplicate.error.timestamp,
        '2026-07-26T00:00:00.000Z'
    );
    assert.equal(controller.getStatus().generation, 1);

    const diagnostic = await controller.crashDummyForTest();
    assert.equal(diagnostic.ok, true);
    assert.deepEqual(killedPids, [4001]);

    fake.simulateWorkerCrash(37);
    const failed = await controller.refresh();
    assert.equal(failed.status.state, 'failed');
    assert.equal(failed.status.error.component, 'worker');
    assert.equal(failed.status.error.code, 'child_exited');
    assert.equal(failed.status.error.attempt, 1);
    assert.equal(
        failed.status.error.timestamp,
        '2026-07-26T00:00:01.000Z'
    );
    assert.equal(failed.status.lastExitCode, 37);

    const restarted = await controller.start();
    assert.equal(restarted.ok, true);
    assert.equal(restarted.status.state, 'running');
    assert.equal(restarted.status.generation, 2);

    const stopped = await controller.stop();
    assert.equal(stopped.ok, true);
    assert.equal(stopped.status.state, 'stopped');
    assert.equal(stopped.status.hostRunning, false);
});

test('capture border access is checked without starting the worker', async () => {
    const fake = new FakeHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            hostPath: 'C:\\addon\\host.exe',
            workerPath: 'C:\\addon\\vtrpon2-addon-dummy.exe',
            workerArguments: [],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });

    const checked = await controller.checkCaptureBorderAccess();
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.access, {
        supported: true,
        allowed: false,
        status: 'denied_by_user',
        settingsUri:
            'ms-settings:privacy-graphicscapturewithoutborder',
        error: null
    });
    assert.equal(fake.observedState, 'stopped');
    assert.equal(fake.generation, 0);

    await controller.stop();
});

test('unexpected host exit becomes a host-scoped failure', async () => {
    const fake = new FakeHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            hostPath: 'C:\\addon\\host.exe',
            workerPath: 'C:\\addon\\vtrpon2-addon-dummy.exe',
            workerArguments: [],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });

    await controller.start();
    fake.exit(22, null);

    const status = controller.getStatus();
    assert.equal(status.hostRunning, false);
    assert.equal(status.state, 'failed');
    assert.equal(status.error.scope, 'host');
    assert.equal(status.error.code, 'host_exited');
});

test('host loss preserves desired outputs but moves every observed path to safe state', async () => {
    const fake = new FakeFormalHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });

    const running = await controller.setOutputs({
        ndi: true,
        operatorMonitor: true
    });
    assert.equal(running.ok, true);
    fake.exit(27, null);

    const status = controller.getStatus();
    assert.equal(status.hostRunning, false);
    assert.equal(status.state, 'failed');
    assert.equal(status.outputs.ndi.desired, true);
    assert.equal(status.outputs.operatorMonitor.desired, true);
    assert.equal(status.outputs.ndi.observedState, 'stopped');
    assert.equal(
        status.outputs.operatorMonitor.observedState,
        'stopped'
    );
    assert.equal(status.sharedCaptureDesired, true);
    assert.equal(status.sharedCaptureObservedState, 'stopped');
    for (const component of Object.values(status.components)) {
        assert.equal(component.observedState, 'stopped');
        assert.equal(component.pid, null);
    }
});

test('protocol loss immediately detaches the optional host and enters safe state', async () => {
    const fake = new FakeFormalHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });

    await controller.setOutputs({
        ndi: false,
        operatorMonitor: true
    });
    fake.emit(
        'protocolError',
        new Error('control pipe disappeared')
    );

    const status = controller.getStatus();
    assert.equal(status.hostRunning, false);
    assert.equal(status.state, 'failed');
    assert.equal(status.error.scope, 'host_protocol');
    assert.equal(status.outputs.operatorMonitor.desired, true);
    assert.equal(
        status.outputs.operatorMonitor.observedState,
        'stopped'
    );
    assert.equal(status.sharedCaptureObservedState, 'stopped');
    assert.equal(controller.client, null);
    assert.equal(controller.pollTimer, null);
});

test('application shutdown is graceful when the optional host responds', async () => {
    const fake = new FakeFormalHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });
    await controller.setOutputs({
        ndi: true,
        operatorMonitor: false
    });

    const result = await controller.shutdown(250);
    assert.equal(result.ok, true);
    assert.equal(result.status.hostRunning, false);
    assert.equal(result.status.state, 'stopped');
    assert.equal(result.status.outputs.ndi.desired, false);
    assert.equal(
        result.status.sharedCaptureObservedState,
        'stopped'
    );
});

test('application shutdown force-detaches a hung control command at its hard deadline', async () => {
    const fake = new FakeFormalHostClient();
    const controller = new SplitPonAddonController({
        config: {
            available: true,
            reason: null,
            mode: 'formal',
            protocolVersion: 3,
            hostPath: 'C:\\addon\\host.exe',
            manifestVersion: '0.2.0',
            components: {},
            outputs: ['ndi', 'operatorMonitor'],
            allowDummyCrash: false
        },
        clientFactory: async () => fake,
        pollIntervalMs: 60_000
    });
    await controller.setOutputs({
        ndi: true,
        operatorMonitor: true
    });
    let forceCloseCount = 0;
    fake.send = async () => new Promise(() => {});
    fake.forceClose = () => {
        forceCloseCount += 1;
        fake.exit(1, null);
    };

    const startedAt = Date.now();
    const result = await controller.shutdown(30);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'shutdown_deadline');
    assert.ok(elapsedMs >= 20);
    assert.ok(elapsedMs < 500);
    assert.equal(forceCloseCount, 1);
    assert.equal(result.status.hostRunning, false);
    assert.equal(result.status.outputs.ndi.desired, false);
    assert.equal(result.status.outputs.ndi.observedState, 'stopped');
    assert.equal(
        result.status.outputs.operatorMonitor.observedState,
        'stopped'
    );
    assert.equal(result.status.sharedCaptureObservedState, 'stopped');
});
