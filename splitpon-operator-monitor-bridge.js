'use strict';

const net = require('node:net');

const DEFAULT_RETRY_INTERVAL_MS = 2000;
const MAX_TEXT_LENGTH = 64;
const MAX_EVENT_BUFFER_BYTES = 4096;
const CLOSE_REQUEST_TYPE = 'operator-monitor.close-requested';
const ALLOWED_REMAIN_COLORS =
    new Set(['green', 'orange', 'red', 'white']);

function normalizeText(value, fallback = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    return (text || fallback).slice(0, MAX_TEXT_LENGTH);
}

function normalizeRemainColor(value) {
    const color = normalizeText(value, 'orange').toLowerCase();
    return ALLOWED_REMAIN_COLORS.has(color)
        ? color
        : 'orange';
}

function normalizeOperatorMonitorState(state, revision) {
    const source = state && typeof state === 'object' ? state : {};
    return {
        schemaVersion: 2,
        type: 'operator-monitor.state',
        revision,
        enabled: source.enabled === true,
        remain: normalizeText(source.remain, '00:00:00:00'),
        duration: normalizeText(source.duration, '00:00:00:00'),
        startMode: normalizeText(source.startMode, '-'),
        endMode: normalizeText(source.endMode, '-'),
        remainColor: normalizeRemainColor(source.remainColor),
        ftbActive: source.ftbActive === true,
        dskActive: source.dskActive === true
    };
}

function parseOperatorMonitorEvent(line) {
    let message;
    try {
        message = JSON.parse(line);
    } catch (_) {
        return null;
    }
    if (
        !message ||
        message.schemaVersion !== 1 ||
        message.type !== CLOSE_REQUEST_TYPE ||
        message.reason !== 'window-close'
    ) {
        return null;
    }
    return {
        schemaVersion: 1,
        type: CLOSE_REQUEST_TYPE,
        reason: 'window-close'
    };
}

class SplitPonOperatorMonitorBridge {
    constructor({
        pipeName = process.env.VTRPON2_SPLITPON_OPERATOR_MONITOR_PIPE || '',
        retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
        netModule = net
    } = {}) {
        this.pipeName = String(pipeName || '').trim();
        this.retryIntervalMs = retryIntervalMs;
        this.netModule = netModule;
        this.socket = null;
        this.closed = false;
        this.connected = false;
        this.writeBlocked = false;
        this.nextConnectAttemptAt = 0;
        this.revision = 0;
        this.lastSentRevision = 0;
        this.connectAttemptCount = 0;
        this.connectCount = 0;
        this.disconnectCount = 0;
        this.droppedStateCount = 0;
        this.closeRequestCount = 0;
        this.invalidEventCount = 0;
        this.eventHandlerErrorCount = 0;
        this.eventBuffer = '';
        this.closeRequestHandlers = new Set();
    }

    get enabled() {
        return this.pipeName.length > 0;
    }

    publish(state) {
        if (!this.enabled || this.closed) {
            return false;
        }
        this.revision += 1;
        if (!this.connected) {
            this.droppedStateCount += 1;
            this.ensureConnected();
            return false;
        }
        if (!this.socket || this.writeBlocked) {
            this.droppedStateCount += 1;
            return false;
        }

        const snapshot = normalizeOperatorMonitorState(
            state,
            this.revision
        );
        try {
            this.writeBlocked = !this.socket.write(
                `${JSON.stringify(snapshot)}\n`,
                'utf8'
            );
            this.lastSentRevision = snapshot.revision;
            return true;
        } catch (_) {
            this.droppedStateCount += 1;
            this.socket.destroy();
            return false;
        }
    }

    ensureConnected() {
        const now = Date.now();
        if (
            !this.enabled ||
            this.closed ||
            this.connected ||
            this.socket ||
            now < this.nextConnectAttemptAt
        ) {
            return false;
        }
        this.nextConnectAttemptAt = now + this.retryIntervalMs;
        this.connectAttemptCount += 1;

        let socket;
        try {
            socket = this.netModule.createConnection(this.pipeName);
        } catch (_) {
            return false;
        }
        this.socket = socket;
        socket.setNoDelay?.(true);
        socket.unref?.();
        socket.setEncoding?.('utf8');

        socket.on('connect', () => {
            if (this.closed || this.socket !== socket) {
                socket.destroy();
                return;
            }
            this.connected = true;
            this.writeBlocked = false;
            this.connectCount += 1;
        });
        socket.on('data', (chunk) => {
            if (this.socket !== socket || this.closed) return;
            this.acceptEventData(String(chunk || ''));
        });
        socket.on('drain', () => {
            if (this.socket !== socket || this.closed) return;
            this.writeBlocked = false;
        });
        socket.on('error', () => {
            socket.destroy();
        });
        socket.on('close', () => {
            if (this.socket !== socket) return;
            const wasConnected = this.connected;
            this.socket = null;
            this.connected = false;
            this.writeBlocked = false;
            this.eventBuffer = '';
            if (wasConnected) this.disconnectCount += 1;
            this.nextConnectAttemptAt =
                Date.now() + this.retryIntervalMs;
        });
        return true;
    }

    reconnectNow() {
        if (!this.enabled || this.closed) return false;
        if (this.connected) return true;
        const staleSocket = this.socket;
        if (staleSocket) {
            this.socket = null;
            staleSocket.destroy();
        }
        this.nextConnectAttemptAt = 0;
        return this.ensureConnected();
    }

    acceptEventData(chunk) {
        this.eventBuffer += chunk;
        if (
            Buffer.byteLength(this.eventBuffer, 'utf8') >
            MAX_EVENT_BUFFER_BYTES
        ) {
            this.eventBuffer = '';
            this.invalidEventCount += 1;
            return;
        }
        for (;;) {
            const newline = this.eventBuffer.indexOf('\n');
            if (newline < 0) return;
            let line = this.eventBuffer.slice(0, newline);
            this.eventBuffer = this.eventBuffer.slice(newline + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line) continue;
            const event = parseOperatorMonitorEvent(line);
            if (!event) {
                this.invalidEventCount += 1;
                continue;
            }
            this.closeRequestCount += 1;
            for (const handler of this.closeRequestHandlers) {
                try {
                    handler(event);
                } catch (_) {
                    this.eventHandlerErrorCount += 1;
                }
            }
        }
    }

    onCloseRequested(handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('close request handler must be a function');
        }
        this.closeRequestHandlers.add(handler);
        return () => {
            this.closeRequestHandlers.delete(handler);
        };
    }

    getStats() {
        return {
            enabled: this.enabled,
            connected: this.connected,
            closed: this.closed,
            revision: this.revision,
            lastSentRevision: this.lastSentRevision,
            retryIntervalMs: this.retryIntervalMs,
            connectAttemptCount: this.connectAttemptCount,
            connectCount: this.connectCount,
            disconnectCount: this.disconnectCount,
            droppedStateCount: this.droppedStateCount,
            closeRequestCount: this.closeRequestCount,
            invalidEventCount: this.invalidEventCount,
            eventHandlerErrorCount: this.eventHandlerErrorCount
        };
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        const socket = this.socket;
        this.socket = null;
        this.connected = false;
        this.writeBlocked = false;
        this.eventBuffer = '';
        this.closeRequestHandlers.clear();
        socket?.destroy();
    }
}

function createSplitPonOperatorMonitorBridge(options) {
    return new SplitPonOperatorMonitorBridge(options);
}

module.exports = {
    SplitPonOperatorMonitorBridge,
    createSplitPonOperatorMonitorBridge,
    normalizeOperatorMonitorState,
    parseOperatorMonitorEvent
};
