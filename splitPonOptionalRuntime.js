'use strict';

const { EventEmitter } = require('node:events');

const AUDIO_PIPE_ENV = 'VTRPON2_SPLITPON_AUDIO_PIPE';
const AUDIO_MANAGED_ENV = 'VTRPON2_SPLITPON_AUDIO_MANAGED';
const OPERATOR_MONITOR_PIPE_ENV =
    'VTRPON2_SPLITPON_OPERATOR_MONITOR_PIPE';
const CAPTURE_BORDER_SETTINGS_URI =
    'ms-settings:privacy-graphicscapturewithoutborder';

function unavailableStatus(reason, installed = false) {
    return {
        installed: installed === true,
        available: false,
        unavailableReason: reason,
        hostRunning: false,
        hostPid: null,
        state: 'unavailable',
        generation: 0,
        pid: null,
        lastPid: null,
        lastExitCode: null,
        lastStopForced: false,
        manifestVersion: null,
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

function addonUnavailableError(reason) {
    return {
        scope: 'addon_initialization',
        component: 'addon_initialization',
        code: reason,
        nativeCode: 0,
        message: `SPLIT-PON Addon is unavailable: ${reason}`
    };
}

class UnavailableSplitPonAddonController extends EventEmitter {
    constructor(reason, installed = false) {
        super();
        this.reason = reason;
        this.status = unavailableStatus(reason, installed);
    }

    getStatus() {
        return structuredClone(this.status);
    }

    async refresh() {
        return {
            ok: true,
            status: this.getStatus(),
            error: null
        };
    }

    async unavailable() {
        const error = addonUnavailableError(this.reason);
        return {
            ok: false,
            status: this.getStatus(),
            error
        };
    }

    start() {
        return this.unavailable();
    }

    setOutputs() {
        return this.unavailable();
    }

    updatePresentation() {
        return this.unavailable();
    }

    async checkCaptureBorderAccess() {
        return {
            ...(await this.unavailable()),
            access: null
        };
    }

    async stop() {
        return {
            ok: true,
            status: this.getStatus(),
            error: null
        };
    }

    shutdown() {
        return this.stop();
    }
}

class DisabledOperatorMonitorBridge {
    get enabled() {
        return false;
    }

    publish() {
        return false;
    }

    onCloseRequested() {
        return () => {};
    }

    reconnectNow() {
        return false;
    }

    getStats() {
        return {
            enabled: false,
            connected: false,
            closed: false,
            revision: 0,
            lastSentRevision: 0,
            retryIntervalMs: 0,
            connectAttemptCount: 0,
            connectCount: 0,
            disconnectCount: 0,
            droppedStateCount: 0,
            closeRequestCount: 0,
            invalidEventCount: 0,
            eventHandlerErrorCount: 0
        };
    }

    close() {}
}

function clearPipeEnvironment(env) {
    delete env[AUDIO_PIPE_ENV];
    delete env[AUDIO_MANAGED_ENV];
    delete env[OPERATOR_MONITOR_PIPE_ENV];
}

function preparePipeEnvironment(env, platform, pid, available) {
    const configuredAudioPipe = env[AUDIO_PIPE_ENV];
    const configuredOperatorMonitorPipe =
        env[OPERATOR_MONITOR_PIPE_ENV];
    clearPipeEnvironment(env);
    if (!available || platform !== 'win32') return;
    const suffix = String(pid);
    env[AUDIO_PIPE_ENV] =
        configuredAudioPipe ||
        `\\\\.\\pipe\\vtrpon2-splitpon-audio-${suffix}`;
    env[OPERATOR_MONITOR_PIPE_ENV] =
        configuredOperatorMonitorPipe ||
        `\\\\.\\pipe\\vtrpon2-splitpon-operator-monitor-${suffix}`;
    env[AUDIO_MANAGED_ENV] = '1';
}

function fallbackCaptureDialogOptions(labels = {}) {
    return {
        type: 'warning',
        title:
            labels['dialog-splitpon-capture-border-title'] ||
            'SPLIT-PON Output',
        message:
            labels['dialog-splitpon-capture-border-message'] ||
            'Windows capture permission is required.',
        buttons: ['OK']
    };
}

function fallbackRuntime(reason, error, env, config = null) {
    clearPipeEnvironment(env);
    const installed = config?.installed === true;
    return {
        config: {
            installed,
            available: false,
            reason,
            mode: 'formal',
            manifestVersion: null
        },
        controller:
            new UnavailableSplitPonAddonController(reason, installed),
        operatorMonitorBridge:
            new DisabledOperatorMonitorBridge(),
        captureBorderSettingsUri: CAPTURE_BORDER_SETTINGS_URI,
        buildCapturePermissionDialogOptions:
            fallbackCaptureDialogOptions,
        initializationError: error || null
    };
}

function loadSplitPonOptionalRuntime(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const pid = options.pid || process.pid;
    const requireModule =
        options.requireModule || ((request) => require(request));

    if (platform !== 'win32') {
        return fallbackRuntime(
            'unsupported_platform',
            null,
            env
        );
    }

    let addonModule;
    let monitorModule;
    let permissionModule;
    try {
        addonModule = requireModule('./splitPonAddonController');
        monitorModule =
            requireModule('./splitpon-operator-monitor-bridge');
        permissionModule =
            requireModule('./splitPonCapturePermission');
    } catch (error) {
        return fallbackRuntime(
            'connector_unavailable',
            error,
            env
        );
    }

    let config;
    try {
        const resolveOptions = {
            platform,
            env,
            allowDevelopmentOverrides:
                options.allowDevelopmentOverrides === true
        };
        if (options.existsSync) {
            resolveOptions.existsSync = options.existsSync;
        }
        if (options.readFileSync) {
            resolveOptions.readFileSync = options.readFileSync;
        }
        config =
            addonModule.resolveSplitPonAddonConfig(resolveOptions);
    } catch (error) {
        return fallbackRuntime(
            'initialization_failed',
            error,
            env,
            config
        );
    }

    preparePipeEnvironment(
        env,
        platform,
        pid,
        Boolean(config.available)
    );

    try {
        const controller =
            new addonModule.SplitPonAddonController({
                config,
                clientVersion: options.clientVersion
            });
        const operatorMonitorBridge =
            monitorModule.createSplitPonOperatorMonitorBridge({
                pipeName:
                    config.available
                        ? env[OPERATOR_MONITOR_PIPE_ENV]
                        : ''
            });
        return {
            config,
            controller,
            operatorMonitorBridge,
            captureBorderSettingsUri:
                permissionModule.CAPTURE_BORDER_SETTINGS_URI ||
                CAPTURE_BORDER_SETTINGS_URI,
            buildCapturePermissionDialogOptions:
                permissionModule.buildCapturePermissionDialogOptions ||
                fallbackCaptureDialogOptions,
            initializationError: null
        };
    } catch (error) {
        return fallbackRuntime(
            'initialization_failed',
            error,
            env
        );
    }
}

module.exports = {
    AUDIO_MANAGED_ENV,
    AUDIO_PIPE_ENV,
    CAPTURE_BORDER_SETTINGS_URI,
    DisabledOperatorMonitorBridge,
    OPERATOR_MONITOR_PIPE_ENV,
    UnavailableSplitPonAddonController,
    clearPipeEnvironment,
    loadSplitPonOptionalRuntime,
    preparePipeEnvironment
};
