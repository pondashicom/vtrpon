'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const CONTROL_PROTOCOL_VERSION = 3;
const ADDON_ID = 'pondashi.vtrpon2.splitpon-addon';
const INSTALL_MARKER_SCHEMA_VERSION = 1;
const FORMAL_OUTPUTS = ['ndi', 'operatorMonitor'];
const FORMAL_READY_TIMEOUT_MS = 45_000;
const FORMAL_HEARTBEAT_TIMEOUT_MS = 5_000;
const FORMAL_STOP_TIMEOUT_MS = 15_000;
const FORMAL_TRANSITION_MARGIN_MS = 5_000;
const MAX_EXPIRED_REQUEST_IDS = 64;
const DEFAULT_SHUTDOWN_DEADLINE_MS = 4_000;
const MAX_SHUTDOWN_DEADLINE_MS = 5_000;

function unavailableConfig(reason, fields = {}) {
    return {
        installed: fields.installed === true,
        available: false,
        reason,
        mode: fields.mode || 'formal',
        protocolVersion: fields.protocolVersion || CONTROL_PROTOCOL_VERSION,
        hostPath: fields.hostPath || null,
        manifestPath: fields.manifestPath || null,
        manifestVersion: fields.manifestVersion || null,
        workerPath: fields.workerPath || null,
        workerArguments: fields.workerArguments || [],
        components: fields.components || null,
        outputs: fields.outputs || [],
        allowDummyCrash: false
    };
}

function hasExactKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const allowed = new Set([...required, ...optional]);
    const keys = Object.keys(value);
    return (
        required.every((key) =>
            Object.prototype.hasOwnProperty.call(value, key)
        ) &&
        keys.every((key) => allowed.has(key))
    );
}

function resolveRelativePath(root, relativePath) {
    if (
        typeof relativePath !== 'string' ||
        relativePath.length === 0 ||
        relativePath.length > 240 ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error('manifest path must be relative');
    }
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    const relative = path.relative(resolvedRoot, resolved);
    if (
        !relative ||
        relative.startsWith('..') ||
        path.isAbsolute(relative)
    ) {
        throw new Error('manifest path escapes the addon directory');
    }
    return resolved;
}

function parseRuntimeComponent(root, value) {
    if (
        !hasExactKeys(
            value,
            ['executable'],
            ['arguments', 'workingDirectory']
        ) ||
        (
            value.arguments != null &&
            !Array.isArray(value.arguments)
        ) ||
        (value.arguments || []).length > 128 ||
        (value.arguments || []).some((item) =>
            typeof item !== 'string' || item.length > 4096
        )
    ) {
        throw new Error('invalid runtime component');
    }
    if (!/\.exe$/i.test(value.executable)) {
        throw new Error('runtime executable must be an exe');
    }
    return {
        executable: resolveRelativePath(root, value.executable),
        arguments: (value.arguments || []).map(String),
        workingDirectory:
            value.workingDirectory == null
                ? null
                : resolveRelativePath(root, value.workingDirectory)
    };
}

function resolveInstallMarkerPath(options, env) {
    const programDataPath =
        options.programDataPath ||
        env.PROGRAMDATA ||
        env.ProgramData ||
        '';
    if (!programDataPath) return null;
    return path.resolve(
        programDataPath,
        'Pondashi',
        'VTR-PON2',
        'addons',
        `${ADDON_ID}.json`
    );
}

function parseInstallMarker(markerPath, readFileSync) {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (
        !hasExactKeys(marker, [
            'schemaVersion',
            'id',
            'version',
            'installLocation'
        ]) ||
        marker.schemaVersion !== INSTALL_MARKER_SCHEMA_VERSION ||
        marker.id !== ADDON_ID ||
        !/^\d+\.\d+\.\d+$/.test(String(marker.version)) ||
        typeof marker.installLocation !== 'string' ||
        marker.installLocation.length === 0 ||
        marker.installLocation.length > 240 ||
        !path.isAbsolute(marker.installLocation)
    ) {
        throw new Error('install marker contract mismatch');
    }
    return {
        version: String(marker.version),
        manifestPath: path.resolve(
            marker.installLocation,
            'addon-manifest.json'
        )
    };
}

function resolveSplitPonAddonConfig(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const allowDevelopmentOverrides =
        options.allowDevelopmentOverrides === true;
    const existsSync = options.existsSync || fs.existsSync;
    const readFileSync = options.readFileSync || fs.readFileSync;

    if (platform !== 'win32') {
        return unavailableConfig('unsupported_platform');
    }

    if (
        allowDevelopmentOverrides &&
        env.VTRPON2_SPLITPON_ADDON_HOST &&
        env.VTRPON2_SPLITPON_ADDON_WORKER &&
        !env.VTRPON2_SPLITPON_ADDON_MANIFEST
    ) {
        const hostPath = path.resolve(
            env.VTRPON2_SPLITPON_ADDON_HOST
        );
        const workerPath = path.resolve(
            env.VTRPON2_SPLITPON_ADDON_WORKER
        );
        const missing = [];
        if (!existsSync(hostPath)) missing.push('host');
        if (!existsSync(workerPath)) missing.push('worker');
        return {
            installed: false,
            available: missing.length === 0,
            reason:
                missing.length === 0
                    ? null
                    : `missing_${missing.join('_and_')}`,
            mode: 'diagnostic',
            protocolVersion: 1,
            hostPath,
            manifestPath: null,
            manifestVersion: null,
            workerPath,
            workerArguments: ['--run-ms', '2147483647'],
            components: null,
            outputs: [],
            allowDummyCrash:
                env.VTRPON2_SPLITPON_ADDON_ALLOW_DUMMY_CRASH === '1'
        };
    }

    const explicitManifestPath = allowDevelopmentOverrides
        ? env.VTRPON2_SPLITPON_ADDON_MANIFEST || null
        : null;
    const installMarkerPath = resolveInstallMarkerPath(options, env);
    const markerExists =
        !explicitManifestPath &&
        installMarkerPath &&
        existsSync(installMarkerPath);
    let manifestPath;
    let markerVersion = null;
    if (explicitManifestPath) {
        manifestPath = path.resolve(explicitManifestPath);
    } else if (markerExists) {
        try {
            const marker = parseInstallMarker(
                installMarkerPath,
                readFileSync
            );
            manifestPath = marker.manifestPath;
            markerVersion = marker.version;
        } catch {
            return unavailableConfig('invalid_install_marker', {
                installed: true,
                manifestPath: null,
                manifestVersion: null
            });
        }
    } else {
        return unavailableConfig('not_installed');
    }
    if (!existsSync(manifestPath)) {
        return unavailableConfig('missing_manifest', {
            installed: Boolean(markerExists),
            manifestPath,
            manifestVersion: markerVersion
        });
    }

    try {
        const manifest = JSON.parse(
            readFileSync(manifestPath, 'utf8')
        );
        if (
            !hasExactKeys(manifest, [
                'schemaVersion',
                'id',
                'version',
                'platform',
                'architecture',
                'control',
                'capabilities',
                'runtime'
            ]) ||
            manifest.schemaVersion !== 2 ||
            manifest.id !== ADDON_ID ||
            !/^\d+\.\d+\.\d+$/.test(String(manifest.version)) ||
            (
                markerVersion !== null &&
                String(manifest.version) !== markerVersion
            ) ||
            manifest.platform !== 'windows' ||
            manifest.architecture !== 'x64' ||
            !hasExactKeys(manifest.control, [
                'protocolVersion',
                'transport',
                'hostExecutable'
            ]) ||
            manifest.control.protocolVersion !== CONTROL_PROTOCOL_VERSION ||
            manifest.control.transport !== 'named-pipe-json-lines' ||
            manifest.control.hostExecutable !==
                'vtrpon2-split-pon-addon-host.exe' ||
            !hasExactKeys(manifest.capabilities, ['outputs']) ||
            !Array.isArray(manifest.capabilities.outputs) ||
            JSON.stringify(manifest.capabilities.outputs) !==
                JSON.stringify(FORMAL_OUTPUTS) ||
            !hasExactKeys(manifest.runtime, [
                'input',
                'core',
                'outputs'
            ]) ||
            !hasExactKeys(manifest.runtime.outputs, [
                'ndi',
                'operatorMonitor'
            ])
        ) {
            throw new Error('manifest contract mismatch');
        }

        const addonDirectory = path.dirname(manifestPath);
        const hostPath = resolveRelativePath(
            addonDirectory,
            manifest.control.hostExecutable
        );
        const components = {
            input: parseRuntimeComponent(
                addonDirectory,
                manifest.runtime.input
            ),
            core: parseRuntimeComponent(
                addonDirectory,
                manifest.runtime.core
            ),
            ndi: parseRuntimeComponent(
                addonDirectory,
                manifest.runtime.outputs.ndi
            ),
            operatorMonitor: parseRuntimeComponent(
                addonDirectory,
                manifest.runtime.outputs.operatorMonitor
            )
        };
        const missing = [];
        if (!existsSync(hostPath)) missing.push('host');
        for (const [name, component] of Object.entries(components)) {
            if (!existsSync(component.executable)) {
                missing.push(name);
            }
            if (
                component.workingDirectory &&
                !existsSync(component.workingDirectory)
            ) {
                missing.push(`${name}_working_directory`);
            }
        }
        return {
            installed: true,
            available: missing.length === 0,
            reason:
                missing.length === 0
                    ? null
                    : `missing_${missing.join('_and_')}`,
            mode: 'formal',
            protocolVersion: CONTROL_PROTOCOL_VERSION,
            hostPath,
            manifestPath,
            manifestVersion: String(manifest.version),
            workerPath: null,
            workerArguments: [],
            components,
            outputs: [...FORMAL_OUTPUTS],
            allowDummyCrash: false
        };
    } catch {
        return unavailableConfig('invalid_manifest', {
            installed: true,
            manifestPath
        });
    }
}

function createControlPipePath() {
    return (
        '\\\\.\\pipe\\vtrpon2-split-pon-addon-control-' +
        `${process.pid}-${randomUUID()}`
    );
}

function buildHostArguments(
    config,
    stopTimeoutMs,
    pipePath,
    controllerPid = process.pid,
    workerTimeouts = {}
) {
    const args = [
        '--pipe-name',
        pipePath,
        '--controller-pid',
        String(controllerPid)
    ];
    if (config.mode === 'formal') {
        for (const [name, option] of [
            ['input', 'input'],
            ['core', 'core'],
            ['ndi', 'ndi'],
            ['operatorMonitor', 'operator-monitor']
        ]) {
            const component = config.components[name];
            args.push(
                `--${option}-worker`,
                component.executable
            );
            for (const argument of component.arguments || []) {
                args.push(
                    `--${option}-worker-arg`,
                    String(argument)
                );
            }
            if (component.workingDirectory) {
                args.push(
                    `--${option}-worker-working-directory`,
                    component.workingDirectory
                );
            }
        }
        args.push(
            '--ready-timeout-ms',
            String(
                workerTimeouts.readyTimeoutMs ||
                FORMAL_READY_TIMEOUT_MS
            ),
            '--heartbeat-timeout-ms',
            String(
                workerTimeouts.heartbeatTimeoutMs ||
                FORMAL_HEARTBEAT_TIMEOUT_MS
            )
        );
    } else {
        args.push('--worker', config.workerPath);
        for (const argument of config.workerArguments || []) {
            args.push('--worker-arg', String(argument));
        }
    }
    args.push(
        '--stop-timeout-ms',
        String(stopTimeoutMs),
        '--exit-on-disconnect'
    );
    return args;
}

function normalizeError(error, scope = 'controller') {
    if (!error) return null;
    if (typeof error === 'string') {
        return {
            scope,
            component: scope,
            code: 'error',
            nativeCode: 0,
            message: error
        };
    }
    const component = String(error.component || error.scope || scope);
    const normalized = {
        scope: component,
        component,
        code: String(error.code || 'error'),
        nativeCode: Number(error.native_code ?? error.nativeCode ?? 0),
        message: String(error.message || error)
    };
    if (error.attempt != null) {
        normalized.attempt = Number(error.attempt);
    }
    if (error.timestamp != null) {
        normalized.timestamp = String(error.timestamp);
    }
    return normalized;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectPipeOnce(pipePath, timeoutMs = 250) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            socket.destroy();
            reject(new Error(`ADDON host pipe connect timeout: ${pipePath}`));
        }, timeoutMs);
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        socket.once('connect', () => finish(resolve, socket));
        socket.once('error', (error) => finish(reject, error));
    });
}

async function connectPipeWithRetry(client, pipePath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        if (client.processClosed) {
            const detail = client.stderr.trim();
            throw new Error(
                'ADDON host exited before the control pipe was ready' +
                (detail ? `: ${detail}` : '')
            );
        }
        try {
            return await connectPipeOnce(pipePath);
        } catch (error) {
            lastError = error;
            await delay(25);
        }
    }
    throw new Error(
        `ADDON host pipe ready timeout: ${pipePath}` +
        (lastError ? ` (${lastError.message})` : '')
    );
}

class NamedPipeHostClient extends EventEmitter {
    constructor(child, commandTimeoutMs) {
        super();
        this.child = child;
        this.commandTimeoutMs = commandTimeoutMs;
        this.socket = null;
        this.lines = null;
        this.pending = new Map();
        this.expiredRequestIds = new Set();
        this.requestSequence = 0;
        this.stderr = '';
        this.processClosed = false;
        this.protocolFailed = false;
        this.exitInfo = null;

        child.stdout.setEncoding('utf8');
        child.stdout.resume();
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            this.stderr = (this.stderr + chunk).slice(-8192);
        });
        child.once('error', (error) => this.handleFatal(error));
        child.once('exit', (code, signal) => this.handleExit(code, signal));
    }

    static async launch(config, options = {}) {
        const spawnImpl = options.spawnImpl || spawn;
        const commandTimeoutMs = options.commandTimeoutMs || 3000;
        const pipePath = options.pipePath || createControlPipePath();
        const child = spawnImpl(
            config.hostPath,
            buildHostArguments(
                config,
                options.stopTimeoutMs || 1500,
                pipePath,
                process.pid,
                {
                    readyTimeoutMs: options.readyTimeoutMs,
                    heartbeatTimeoutMs: options.heartbeatTimeoutMs
                }
            ),
            {
                windowsHide: true,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );
        const client = new NamedPipeHostClient(child, commandTimeoutMs);
        try {
            const socket = await connectPipeWithRetry(
                client,
                pipePath,
                commandTimeoutMs
            );
            client.attachSocket(socket);
            const hello = await client.send('hello', {
                protocolVersion:
                    Number(config.protocolVersion) ||
                    CONTROL_PROTOCOL_VERSION,
                client: {
                    product: 'VTR-PON2',
                    version: String(options.clientVersion || 'development'),
                    pid: process.pid
                }
            });
            if (
                !hello.ok ||
                Number(hello.protocolVersion) !==
                    (
                        Number(config.protocolVersion) ||
                        CONTROL_PROTOCOL_VERSION
                    )
            ) {
                throw new Error('ADDON host rejected the control handshake');
            }
            return client;
        } catch (error) {
            client.forceClose();
            throw error;
        }
    }

    attachSocket(socket) {
        this.socket = socket;
        this.lines = readline.createInterface({
            input: socket,
            crlfDelay: Infinity
        });
        this.lines.on('line', (line) => this.handleLine(line));
        this.lines.on('error', (error) => this.handleFatal(error));
        socket.once('error', (error) => this.handleFatal(error));
        socket.once('close', () => {
            if (!this.processClosed && !this.protocolFailed) {
                this.handleFatal(
                    new Error('ADDON host control pipe closed unexpectedly')
                );
            }
        });
    }

    handleLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (error) {
            this.handleFatal(
                new Error(`ADDON host emitted invalid JSON: ${error.message}`)
            );
            return;
        }

        if (message.type === 'state.changed') {
            this.emit('state', message);
            return;
        }
        if (message.type !== 'response' || !message.requestId) {
            this.handleFatal(
                new Error(`Unexpected ADDON host message type: ${message.type}`)
            );
            return;
        }

        const request = this.pending.get(message.requestId);
        if (!request) {
            if (this.expiredRequestIds.delete(message.requestId)) {
                return;
            }
            this.handleFatal(
                new Error(
                    `Unexpected ADDON host response: ${message.requestId}`
                )
            );
            return;
        }
        this.pending.delete(message.requestId);
        clearTimeout(request.timer);
        request.resolve(message);
    }

    send(type, fields = {}, timeoutMs = this.commandTimeoutMs) {
        if (
            this.processClosed ||
            !this.socket ||
            !this.socket.writable
        ) {
            return Promise.reject(
                new Error('ADDON host control pipe is not writable')
            );
        }
        const requestId = `vtr-${process.pid}-${++this.requestSequence}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                this.expiredRequestIds.add(requestId);
                while (
                    this.expiredRequestIds.size >
                    MAX_EXPIRED_REQUEST_IDS
                ) {
                    const oldest =
                        this.expiredRequestIds.values().next().value;
                    this.expiredRequestIds.delete(oldest);
                }
                reject(new Error(`ADDON host command timeout: ${type}`));
            }, timeoutMs);
            this.pending.set(requestId, {
                type,
                resolve,
                reject,
                timer
            });
            const payload = JSON.stringify({
                type,
                requestId,
                ...fields
            });
            this.socket.write(`${payload}\n`, 'utf8', (error) => {
                if (error) this.handleFatal(error);
            });
        });
    }

    handleFatal(error) {
        if (this.protocolFailed) return;
        this.protocolFailed = true;
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        this.pending.clear();
        this.emit('protocolError', error);
    }

    handleExit(code, signal) {
        if (this.processClosed) return;
        this.processClosed = true;
        this.exitInfo = { code, signal, stderr: this.stderr };
        const detail = this.stderr.trim();
        const error = new Error(
            `ADDON host exited (${code ?? 'null'}/${signal || 'none'})` +
            (detail ? `: ${detail}` : '')
        );
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        this.pending.clear();
        this.emit('exit', this.exitInfo);
    }

    waitForExit(timeoutMs = 3000) {
        if (this.processClosed) return Promise.resolve(this.exitInfo);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('ADDON host exit timeout')),
                timeoutMs
            );
            this.once('exit', (info) => {
                clearTimeout(timer);
                resolve(info);
            });
        });
    }

    forceClose() {
        this.socket?.destroy();
        if (this.processClosed) return;
        try {
            this.child.kill();
        } catch {
            // The child exit/error events remain the final host state source.
        }
    }
}

class SplitPonAddonController extends EventEmitter {
    constructor(options = {}) {
        super();
        this.config = options.config || resolveSplitPonAddonConfig(options);
        this.pollIntervalMs = options.pollIntervalMs || 250;
        this.readyTimeoutMs =
            options.readyTimeoutMs ||
            (
                this.config.mode === 'formal'
                    ? FORMAL_READY_TIMEOUT_MS
                    : 2_000
            );
        this.heartbeatTimeoutMs =
            options.heartbeatTimeoutMs ||
            (
                this.config.mode === 'formal'
                    ? FORMAL_HEARTBEAT_TIMEOUT_MS
                    : 1_000
            );
        this.stopTimeoutMs =
            options.stopTimeoutMs ||
            (
                this.config.mode === 'formal'
                    ? FORMAL_STOP_TIMEOUT_MS
                    : 1_500
            );
        this.commandTimeoutMs = options.commandTimeoutMs || 3000;
        this.transitionCommandTimeoutMs =
            options.transitionCommandTimeoutMs ||
            (
                2 * Math.max(
                    this.readyTimeoutMs,
                    this.stopTimeoutMs
                ) +
                FORMAL_TRANSITION_MARGIN_MS
            );
        this.clientFactory =
            options.clientFactory ||
            ((config) => NamedPipeHostClient.launch(config, {
                stopTimeoutMs: this.stopTimeoutMs,
                commandTimeoutMs: this.commandTimeoutMs,
                readyTimeoutMs: this.readyTimeoutMs,
                heartbeatTimeoutMs: this.heartbeatTimeoutMs,
                clientVersion: options.clientVersion
            }));
        this.processKill = options.processKill || process.kill.bind(process);
        this.client = null;
        this.pollTimer = null;
        this.pollBusy = false;
        this.pollGeneration = 0;
        this.operation = Promise.resolve();
        this.expectingHostExit = false;
        this.shutdownRequested = false;
        this.shutdownPromise = null;
        this.snapshot = {
            installed: Boolean(this.config.installed),
            available: Boolean(this.config.available),
            unavailableReason: this.config.reason || null,
            hostRunning: false,
            hostPid: null,
            state: this.config.available ? 'stopped' : 'unavailable',
            generation: 0,
            pid: null,
            lastPid: null,
            lastExitCode: null,
            lastStopForced: false,
            manifestVersion: this.config.manifestVersion || null,
            outputs: {
                ndi: {
                    desired: false,
                    observedState: 'stopped',
                    pid: null
                },
                operatorMonitor: {
                    desired: false,
                    observedState: 'stopped',
                    pid: null
                }
            },
            sharedCaptureDesired: false,
            sharedCaptureObservedState: 'stopped',
            components: {},
            error: null
        };
    }

    getStatus() {
        return {
            ...this.snapshot,
            outputs: {
                ndi: { ...this.snapshot.outputs.ndi },
                operatorMonitor: {
                    ...this.snapshot.outputs.operatorMonitor
                }
            },
            components: Object.fromEntries(
                Object.entries(this.snapshot.components).map(
                    ([name, component]) => [
                        name,
                        {
                            ...component,
                            error:
                                component.error &&
                                { ...component.error }
                        }
                    ]
                )
            ),
            error: this.snapshot.error && { ...this.snapshot.error }
        };
    }

    publish(next) {
        const normalized = {
            ...this.snapshot,
            ...next
        };
        if (
            JSON.stringify(normalized) ===
            JSON.stringify(this.snapshot)
        ) {
            return;
        }
        this.snapshot = normalized;
        this.emit('status', this.getStatus());
    }

    enterHostSafeState({
        state = 'failed',
        error = null,
        clearDesired = false,
        lastStopForced = false
    } = {}) {
        const outputs = Object.fromEntries(
            Object.entries(this.snapshot.outputs).map(
                ([name, output]) => [
                    name,
                    {
                        ...output,
                        desired:
                            clearDesired
                                ? false
                                : Boolean(output.desired),
                        observedState: 'stopped',
                        pid: null
                    }
                ]
            )
        );
        const components = Object.fromEntries(
            Object.entries(this.snapshot.components).map(
                ([name, component]) => [
                    name,
                    {
                        ...component,
                        desiredState:
                            clearDesired
                                ? 'stopped'
                                : component.desiredState,
                        observedState: 'stopped',
                        pid: null
                    }
                ]
            )
        );
        this.publish({
            hostRunning: false,
            hostPid: null,
            state,
            pid: null,
            lastStopForced:
                lastStopForced ||
                Boolean(this.snapshot.lastStopForced),
            outputs,
            sharedCaptureDesired:
                outputs.ndi.desired ||
                outputs.operatorMonitor.desired,
            sharedCaptureObservedState: 'stopped',
            components,
            error
        });
        return this.getStatus();
    }

    failHostClient(client, error, scope = 'host') {
        if (!client || client !== this.client) {
            return this.getStatus();
        }
        this.client = null;
        this.stopPolling();
        this.expectingHostExit = false;
        try {
            client.forceClose();
        } catch {
            // The VTR-PON2 side is already detached from the optional host.
        }
        return this.enterHostSafeState({
            state: 'failed',
            error: normalizeError(error, scope)
        });
    }

    applyState(state) {
        const worker = state?.worker || {};
        if (state?.outputs && state?.components) {
            const outputs = {
                ndi: {
                    desired: Boolean(
                        state.outputs.ndi?.desired
                    ),
                    observedState: String(
                        state.outputs.ndi?.observedState ||
                        'stopped'
                    ),
                    pid:
                        state.outputs.ndi?.pid == null
                            ? null
                            : Number(state.outputs.ndi.pid)
                },
                operatorMonitor: {
                    desired: Boolean(
                        state.outputs.operatorMonitor?.desired
                    ),
                    observedState: String(
                        state.outputs.operatorMonitor
                            ?.observedState ||
                        'stopped'
                    ),
                    pid:
                        state.outputs.operatorMonitor?.pid == null
                            ? null
                            : Number(
                                state.outputs.operatorMonitor.pid
                            )
                }
            };
            const components = Object.fromEntries(
                Object.entries(state.components).map(
                    ([name, component]) => [
                        name,
                        {
                            ...component,
                            error: normalizeError(
                                component.error,
                                name
                            )
                        }
                    ]
                )
            );
            const componentErrors = Object.values(components)
                .map((component) => component.error)
                .filter(Boolean);
            const observedStates = [
                String(
                    state.outputs.sharedCaptureObservedState ||
                    'stopped'
                ),
                outputs.ndi.observedState,
                outputs.operatorMonitor.observedState
            ];
            let aggregateState = 'stopped';
            if (
                componentErrors.length > 0 ||
                observedStates.some((value) =>
                    [
                        'startup_failed',
                        'crashed',
                        'hung',
                        'stop_timeout',
                        'failed',
                        'unavailable'
                    ].includes(value)
                )
            ) {
                aggregateState = 'failed';
            } else if (
                observedStates.includes('stopping')
            ) {
                aggregateState = 'stopping';
            } else if (
                observedStates.includes('starting') ||
                (
                    (
                        outputs.ndi.desired ||
                        outputs.operatorMonitor.desired
                    ) &&
                    (
                        state.outputs
                            .sharedCaptureObservedState !==
                            'running' ||
                        (
                            outputs.ndi.desired &&
                            outputs.ndi.observedState !==
                                'running'
                        ) ||
                        (
                            outputs.operatorMonitor.desired &&
                            outputs.operatorMonitor
                                .observedState !==
                                'running'
                        )
                    )
                )
            ) {
                aggregateState = 'starting';
            } else if (
                outputs.ndi.desired ||
                outputs.operatorMonitor.desired
            ) {
                aggregateState = 'running';
            }
            this.publish({
                hostRunning: true,
                state: aggregateState,
                generation: Number(worker.generation || 0),
                pid: worker.pid == null ? null : Number(worker.pid),
                lastPid:
                    worker.lastPid == null
                        ? null
                        : Number(worker.lastPid),
                lastExitCode:
                    worker.lastExitCode == null
                        ? null
                        : Number(worker.lastExitCode),
                lastStopForced: Boolean(worker.lastStopForced),
                outputs,
                sharedCaptureDesired: Boolean(
                    state.outputs.sharedCaptureDesired
                ),
                sharedCaptureObservedState: String(
                    state.outputs.sharedCaptureObservedState ||
                    'stopped'
                ),
                components,
                error:
                    componentErrors[0] ||
                    normalizeError(worker.error, 'worker')
            });
            return this.getStatus();
        }
        this.publish({
            hostRunning: true,
            state: String(worker.observedState || 'stopped'),
            generation: Number(worker.generation || 0),
            pid: worker.pid == null ? null : Number(worker.pid),
            lastPid:
                worker.lastPid == null ? null : Number(worker.lastPid),
            lastExitCode:
                worker.lastExitCode == null
                    ? null
                    : Number(worker.lastExitCode),
            lastStopForced: Boolean(worker.lastStopForced),
            error: normalizeError(worker.error, 'worker')
        });
        return this.getStatus();
    }

    applyHostResponse(response) {
        if (response.state) this.applyState(response.state);
        return {
            ok: Boolean(response.ok),
            status: this.getStatus(),
            error: normalizeError(response.error, 'command')
        };
    }

    runExclusive(operation) {
        const run = this.operation.then(operation, operation);
        this.operation = run.catch(() => {});
        return run;
    }

    async ensureHost() {
        if (this.shutdownRequested) {
            throw new Error('SPLIT-PON Addon shutdown is in progress');
        }
        if (this.client) return this.client;
        if (!this.config.available) {
            throw new Error(
                `SPLIT-PON Addon is unavailable: ${this.config.reason}`
            );
        }

        this.publish({ state: 'starting', error: null });
        let client = null;
        try {
            client = await this.clientFactory(this.config);
            if (this.shutdownRequested) {
                client.forceClose();
                throw new Error('SPLIT-PON Addon shutdown is in progress');
            }
            this.client = client;
            this.expectingHostExit = false;
            client.on('state', (state) => {
                if (client !== this.client) return;
                this.applyState(state);
            });
            client.on('exit', (info) => this.onHostExit(client, info));
            client.on('protocolError', (error) => {
                if (client !== this.client || this.expectingHostExit) return;
                this.failHostClient(
                    client,
                    error,
                    'host_protocol'
                );
            });
            this.publish({
                hostRunning: true,
                hostPid:
                    client.child && Number.isInteger(client.child.pid)
                        ? client.child.pid
                        : null,
                state: 'stopped',
                error: null
            });
            this.startPolling();
            return client;
        } catch (error) {
            if (client && client === this.client) {
                this.client = null;
            }
            try {
                client?.forceClose();
            } catch {
                // Initialization failure remains contained in addon state.
            }
            throw error;
        }
    }

    onHostExit(client, info) {
        if (client !== this.client) return;
        this.client = null;
        this.stopPolling();
        const expected = this.expectingHostExit;
        this.expectingHostExit = false;
        if (expected) {
            this.enterHostSafeState({
                state: 'stopped',
                error: null,
                clearDesired: true
            });
            return;
        }
        this.enterHostSafeState({
            state: 'failed',
            error: {
                scope: 'host',
                component: 'host',
                code: 'host_exited',
                nativeCode: Number(info.code ?? 0),
                message:
                    `ADDON host exited unexpectedly ` +
                    `(${info.code ?? 'null'}/${info.signal || 'none'})`
            }
        });
    }

    startPolling() {
        if (this.pollTimer) return;
        const generation = ++this.pollGeneration;
        this.pollTimer = setInterval(() => {
            if (this.pollBusy || !this.client) return;
            const client = this.client;
            this.pollBusy = true;
            client.send('status.get')
                .then((response) => {
                    if (
                        generation === this.pollGeneration &&
                        client === this.client
                    ) {
                        this.applyHostResponse(response);
                    }
                })
                .catch((error) => {
                    if (
                        generation === this.pollGeneration &&
                        client === this.client &&
                        !this.expectingHostExit
                    ) {
                        this.failHostClient(client, error, 'host');
                    }
                })
                .finally(() => {
                    if (generation === this.pollGeneration) {
                        this.pollBusy = false;
                    }
                });
        }, this.pollIntervalMs);
        this.pollTimer.unref?.();
    }

    stopPolling() {
        ++this.pollGeneration;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.pollBusy = false;
    }

    start() {
        return this.runExclusive(async () => {
            let client = null;
            try {
                client = await this.ensureHost();
                const response = await client.send('system.start');
                if (client !== this.client) {
                    throw new Error(
                        'ADDON host detached during system.start'
                    );
                }
                return this.applyHostResponse(response);
            } catch (error) {
                if (client && client === this.client) {
                    this.failHostClient(client, error, 'host');
                } else {
                    this.publish({
                        hostRunning: Boolean(this.client),
                        state: 'failed',
                        error: normalizeError(error, 'host')
                    });
                }
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    setOutputs(outputs) {
        return this.runExclusive(async () => {
            const desired = {
                ndi: outputs?.ndi === true,
                operatorMonitor:
                    outputs?.operatorMonitor === true
            };
            if (
                this.config.mode !== 'formal' ||
                Number(this.config.protocolVersion) < 3
            ) {
                const error = {
                    scope: 'command',
                    component: 'command',
                    code: 'outputs_unsupported',
                    nativeCode: 0,
                    message:
                        'The installed ADDON does not support M6 outputs'
                };
                return {
                    ok: false,
                    status: this.getStatus(),
                    error
                };
            }
            let client = null;
            try {
                client = await this.ensureHost();
                const pollingWasActive = Boolean(this.pollTimer);
                this.stopPolling();
                try {
                    const response = await client.send(
                        'outputs.set',
                        { outputs: desired },
                        this.transitionCommandTimeoutMs
                    );
                    if (client !== this.client) {
                        throw new Error(
                            'ADDON host detached during outputs.set'
                        );
                    }
                    return this.applyHostResponse(response);
                } finally {
                    if (
                        pollingWasActive &&
                        this.client === client &&
                        !this.expectingHostExit
                    ) {
                        this.startPolling();
                    }
                }
            } catch (error) {
                if (client && client === this.client) {
                    this.failHostClient(client, error, 'host');
                } else {
                    this.publish({
                        hostRunning: Boolean(this.client),
                        state: 'failed',
                        error: normalizeError(error, 'host')
                    });
                }
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    updatePresentation(presentation) {
        return this.runExclusive(async () => {
            const fullscreenHwnd = String(
                presentation?.fullscreenHwnd || ''
            );
            const rendererPid = Number(
                presentation?.rendererPid || 0
            );
            const presentationRevision = Number(
                presentation?.presentationRevision || 0
            );
            if (
                !/^0x[0-9a-f]{1,16}$/i.test(fullscreenHwnd) ||
                !Number.isSafeInteger(rendererPid) ||
                rendererPid <= 0 ||
                !Number.isSafeInteger(presentationRevision) ||
                presentationRevision <= 0
            ) {
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: {
                        scope: 'presentation',
                        component: 'presentation',
                        code: 'invalid_presentation',
                        nativeCode: 0,
                        message:
                            'Fullscreen presentation is not available'
                    }
                };
            }
            let client = null;
            try {
                client = await this.ensureHost();
                const response = await client.send(
                    'presentation.update',
                    {
                        fullscreenHwnd,
                        rendererPid,
                        presentationRevision
                    }
                );
                if (client !== this.client) {
                    throw new Error(
                        'ADDON host detached during presentation.update'
                    );
                }
                return this.applyHostResponse(response);
            } catch (error) {
                if (client && client === this.client) {
                    this.failHostClient(
                        client,
                        error,
                        'presentation'
                    );
                } else {
                    this.publish({
                        hostRunning: Boolean(this.client),
                        state: 'failed',
                        error: normalizeError(
                            error,
                            'presentation'
                        )
                    });
                }
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    checkCaptureBorderAccess() {
        return this.runExclusive(async () => {
            let client = null;
            try {
                client = await this.ensureHost();
                const response =
                    await client.send('capture.borderless.check');
                if (client !== this.client) {
                    throw new Error(
                        'ADDON host detached during capture permission check'
                    );
                }
                const access = response.captureBorderAccess || {};
                return {
                    ok: Boolean(response.ok),
                    access: {
                        supported: Boolean(access.supported),
                        allowed: Boolean(access.allowed),
                        status: String(access.status || 'unknown'),
                        settingsUri: String(
                            access.settingsUri ||
                            'ms-settings:' +
                            'privacy-graphicscapturewithoutborder'
                        ),
                        error:
                            access.error == null
                                ? null
                                : String(access.error)
                    },
                    status: this.getStatus(),
                    error: normalizeError(
                        response.error,
                        'capture_permission'
                    )
                };
            } catch (error) {
                if (client && client === this.client) {
                    this.failHostClient(
                        client,
                        error,
                        'capture_permission'
                    );
                } else {
                    this.publish({
                        hostRunning: Boolean(this.client),
                        state: 'failed',
                        error: normalizeError(
                            error,
                            'capture_permission'
                        )
                    });
                }
                return {
                    ok: false,
                    access: null,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    refresh() {
        return this.runExclusive(async () => {
            if (!this.client) {
                return {
                    ok: true,
                    status: this.getStatus(),
                    error: null
                };
            }
            const client = this.client;
            try {
                const response = await client.send('status.get');
                if (client !== this.client) {
                    throw new Error(
                        'ADDON host detached during status.get'
                    );
                }
                return this.applyHostResponse(response);
            } catch (error) {
                if (client === this.client) {
                    this.failHostClient(client, error, 'host');
                }
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    stop() {
        return this.runExclusive(async () => {
            if (!this.client) {
                this.enterHostSafeState({
                    state: 'stopped',
                    error: null,
                    clearDesired: true
                });
                return {
                    ok: true,
                    status: this.getStatus(),
                    error: null
                };
            }

            const client = this.client;
            this.stopPolling();
            this.publish({ state: 'stopping' });
            try {
                const stopResponse =
                    await client.send(
                        'system.stop',
                        {},
                        this.transitionCommandTimeoutMs
                    );
                const stopResult =
                    this.applyHostResponse(stopResponse);
                this.expectingHostExit = true;
                const shutdownResponse =
                    await client.send('shutdown');
                const shutdownResult =
                    this.applyHostResponse(shutdownResponse);
                await client.waitForExit(this.commandTimeoutMs);
                this.client = null;
                this.enterHostSafeState({
                    state: 'stopped',
                    error: null,
                    clearDesired: true
                });
                return {
                    ok: stopResult.ok && shutdownResult.ok,
                    status: this.getStatus(),
                    error: stopResult.error || shutdownResult.error
                };
            } catch (error) {
                this.expectingHostExit = true;
                client.forceClose();
                try {
                    await client.waitForExit(this.commandTimeoutMs);
                } catch {
                    // VTR-PON2 must continue if host teardown is unhealthy.
                }
                if (this.client === client) {
                    this.client = null;
                }
                this.enterHostSafeState({
                    state: 'failed',
                    error: normalizeError(error, 'host_stop'),
                    clearDesired: true,
                    lastStopForced: true
                });
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: this.snapshot.error
                };
            }
        });
    }

    shutdown(timeoutMs = DEFAULT_SHUTDOWN_DEADLINE_MS) {
        if (this.shutdownPromise) return this.shutdownPromise;
        const deadlineMs = Math.min(
            MAX_SHUTDOWN_DEADLINE_MS,
            Math.max(1, Number(timeoutMs) || DEFAULT_SHUTDOWN_DEADLINE_MS)
        );
        this.shutdownRequested = true;
        this.stopPolling();

        this.shutdownPromise = (async () => {
            const client = this.client;
            if (!client) {
                const status = this.enterHostSafeState({
                    state: 'stopped',
                    error: null,
                    clearDesired: true
                });
                return { ok: true, status, error: null };
            }

            this.expectingHostExit = true;
            const deadlineAt = Date.now() + deadlineMs;
            let deadlineTimer = null;
            let deadlineExpired = false;
            const deadlineResult = new Promise((resolve) => {
                deadlineTimer = setTimeout(() => {
                    deadlineExpired = true;
                    this.expectingHostExit = false;
                    if (this.client === client) {
                        this.client = null;
                    }
                    try {
                        client.forceClose();
                    } catch {
                        // The hard deadline still releases VTR-PON2.
                    }
                    const error = {
                        scope: 'host_stop',
                        component: 'host_stop',
                        code: 'shutdown_deadline',
                        nativeCode: 0,
                        message:
                            `ADDON shutdown exceeded ${deadlineMs} ms`
                    };
                    const status = this.enterHostSafeState({
                        state: 'failed',
                        error,
                        clearDesired: true,
                        lastStopForced: true
                    });
                    resolve({ ok: false, status, error });
                }, deadlineMs);
            });

            const remaining = () =>
                Math.max(1, deadlineAt - Date.now());
            const gracefulResult = (async () => {
                try {
                    const stopResponse = await client.send(
                        'system.stop',
                        {},
                        remaining()
                    );
                    if (deadlineExpired) {
                        return {
                            ok: false,
                            status: this.getStatus(),
                            error: this.snapshot.error
                        };
                    }
                    const stopResult =
                        this.applyHostResponse(stopResponse);
                    const shutdownResponse = await client.send(
                        'shutdown',
                        {},
                        remaining()
                    );
                    if (deadlineExpired) {
                        return {
                            ok: false,
                            status: this.getStatus(),
                            error: this.snapshot.error
                        };
                    }
                    const shutdownResult =
                        this.client === client
                            ? this.applyHostResponse(shutdownResponse)
                            : {
                                ok: Boolean(shutdownResponse.ok),
                                error: normalizeError(
                                    shutdownResponse.error,
                                    'host_stop'
                                )
                            };
                    await client.waitForExit(remaining());
                    if (deadlineExpired) {
                        return {
                            ok: false,
                            status: this.getStatus(),
                            error: this.snapshot.error
                        };
                    }
                    if (this.client === client) {
                        this.client = null;
                    }
                    this.expectingHostExit = false;
                    const status = this.enterHostSafeState({
                        state: 'stopped',
                        error: null,
                        clearDesired: true
                    });
                    return {
                        ok: stopResult.ok && shutdownResult.ok,
                        status,
                        error:
                            stopResult.error ||
                            shutdownResult.error
                    };
                } catch (error) {
                    if (deadlineExpired) {
                        return {
                            ok: false,
                            status: this.getStatus(),
                            error: this.snapshot.error
                        };
                    }
                    if (this.client === client) {
                        this.client = null;
                    }
                    this.expectingHostExit = false;
                    try {
                        client.forceClose();
                    } catch {
                        // Job Object close remains the host cleanup boundary.
                    }
                    const normalized =
                        normalizeError(error, 'host_stop');
                    const status = this.enterHostSafeState({
                        state: 'failed',
                        error: normalized,
                        clearDesired: true,
                        lastStopForced: true
                    });
                    return {
                        ok: false,
                        status,
                        error: normalized
                    };
                }
            })();

            const result = await Promise.race([
                gracefulResult,
                deadlineResult
            ]);
            if (deadlineTimer) clearTimeout(deadlineTimer);
            return result || {
                ok: false,
                status: this.getStatus(),
                error: this.snapshot.error
            };
        })();
        return this.shutdownPromise;
    }

    crashDummyForTest() {
        return this.runExclusive(async () => {
            const isDummy =
                /vtrpon2-addon-dummy\.exe$/i.test(
                    this.config.workerPath || ''
                );
            if (!this.config.allowDummyCrash || !isDummy) {
                const error = {
                    scope: 'command',
                    code: 'diagnostic_disabled',
                    nativeCode: 0,
                    message: 'Dummy crash diagnostic is disabled'
                };
                return {
                    ok: false,
                    status: this.getStatus(),
                    error
                };
            }
            if (
                this.snapshot.state !== 'running' ||
                !this.snapshot.pid
            ) {
                const error = {
                    scope: 'command',
                    code: 'worker_not_running',
                    nativeCode: 0,
                    message: 'No running dummy worker'
                };
                return {
                    ok: false,
                    status: this.getStatus(),
                    error
                };
            }
            try {
                this.processKill(this.snapshot.pid);
                return {
                    ok: true,
                    status: this.getStatus(),
                    error: null
                };
            } catch (error) {
                return {
                    ok: false,
                    status: this.getStatus(),
                    error: normalizeError(error, 'diagnostic')
                };
            }
        });
    }
}

module.exports = {
    ADDON_ID,
    CONTROL_PROTOCOL_VERSION,
    DEFAULT_SHUTDOWN_DEADLINE_MS,
    INSTALL_MARKER_SCHEMA_VERSION,
    MAX_SHUTDOWN_DEADLINE_MS,
    NamedPipeHostClient,
    SplitPonAddonController,
    buildHostArguments,
    createControlPipePath,
    resolveSplitPonAddonConfig
};
