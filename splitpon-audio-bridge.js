'use strict';

const net = require('net');

const PIPE_PREFIX = '\\\\.\\pipe\\';
const PIPE_ENV_NAME = 'VTRPON2_SPLITPON_AUDIO_PIPE';
const MANAGED_ENV_NAME = 'VTRPON2_SPLITPON_AUDIO_MANAGED';
const HEADER_BYTES = 64;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const SAMPLE_FORMAT_F32 = 1;
const MAX_WRITABLE_BYTES = 512 * 1024;
const RECONNECT_MS = 250;
const CONNECT_DEADLINE_MS = 10 * 1000;
const IDLE_PACKET_FRAMES = 960;
const IDLE_PACKET_MS = 20;
const IDLE_FALLBACK_AFTER_MS = 100;
const IDLE_PCM = Buffer.alloc(
    IDLE_PACKET_FRAMES * CHANNELS * Float32Array.BYTES_PER_ELEMENT
);

const configuredPipe = String(process.env[PIPE_ENV_NAME] || '');
const pipeName = (
    process.platform === 'win32' &&
    configuredPipe.startsWith(PIPE_PREFIX) &&
    configuredPipe.length > PIPE_PREFIX.length &&
    configuredPipe.length <= 240
) ? configuredPipe : '';
const managed = process.env[MANAGED_ENV_NAME] === '1';

let socket = null;
let connected = false;
let active = !managed && !!pipeName;
let reconnectTimer = null;
let connectDeadlineTimer = null;
let sequence = 0n;
let droppedFrames = 0;
let packetsSent = 0;
let firstAttemptAt = 0;
let everConnected = false;
let stopped = false;
let reconnectCount = 0;
let disconnectCount = 0;
let idleTimer = null;
let idleContextFrame = 0;
let idlePacketsSent = 0;
let lastRendererPcmAt = 0;

function stopIdleSilence() {
    if (!idleTimer) return;
    try {
        clearInterval(idleTimer);
    } catch (_) {}
    idleTimer = null;
}

function startIdleSilence() {
    if (idleTimer || !active || stopped) return;
    lastRendererPcmAt = Date.now();
    idleTimer = setInterval(() => {
        try {
            if (
                !active ||
                stopped ||
                Date.now() - lastRendererPcmAt < IDLE_FALLBACK_AFTER_MS
            ) {
                return;
            }
            if (sendPcmUnsafe(
                IDLE_PCM,
                idleContextFrame,
                IDLE_PACKET_FRAMES,
                SAMPLE_RATE,
                CHANNELS
            )) {
                idleContextFrame += IDLE_PACKET_FRAMES;
                idlePacketsSent += 1;
            }
        } catch (_) {
            stopBridge();
        }
    }, IDLE_PACKET_MS);
    idleTimer.unref?.();
}

function stopBridge() {
    active = false;
    connected = false;
    stopped = true;
    stopIdleSilence();

    if (reconnectTimer) {
        try {
            clearTimeout(reconnectTimer);
        } catch (_) {}
        reconnectTimer = null;
    }
    if (connectDeadlineTimer) {
        try {
            clearTimeout(connectDeadlineTimer);
        } catch (_) {}
        connectDeadlineTimer = null;
    }

    const currentSocket = socket;
    socket = null;
    if (currentSocket) {
        try {
            currentSocket.destroy();
        } catch (_) {}
    }
}

function setActive(enabled) {
    if (!pipeName || stopped) {
        return false;
    }
    const next = enabled === true;
    if (active === next) {
        if (active) {
            startIdleSilence();
            if (!socket) connect();
        }
        return active;
    }
    active = next;
    firstAttemptAt = 0;
    if (connectDeadlineTimer) {
        clearTimeout(connectDeadlineTimer);
        connectDeadlineTimer = null;
    }
    if (!active) {
        stopIdleSilence();
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        const currentSocket = socket;
        socket = null;
        connected = false;
        currentSocket?.destroy();
        return false;
    }
    startIdleSilence();
    connect();
    return true;
}

function scheduleReconnect() {
    try {
        if (!active || !pipeName || reconnectTimer || stopped) {
            return;
        }
        if (
            !managed &&
            firstAttemptAt &&
            Date.now() - firstAttemptAt >= CONNECT_DEADLINE_MS
        ) {
            stopBridge();
            return;
        }
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, RECONNECT_MS);
        reconnectTimer.unref?.();
    } catch (_) {
        stopBridge();
    }
}

function connect() {
    try {
        if (!active || !pipeName || socket || stopped) {
            return;
        }
        if (!firstAttemptAt) {
            firstAttemptAt = Date.now();
            connectDeadlineTimer = setTimeout(() => {
                connectDeadlineTimer = null;
                if (!connected) {
                    if (managed && active) {
                        firstAttemptAt = Date.now();
                        scheduleReconnect();
                    } else {
                        stopBridge();
                    }
                }
            }, CONNECT_DEADLINE_MS);
            connectDeadlineTimer.unref?.();
        }

        const candidate = net.createConnection(pipeName);
        socket = candidate;
        candidate.once('connect', () => {
            if (socket !== candidate) {
                try {
                    candidate.destroy();
                } catch (_) {}
                return;
            }
            const reconnecting = everConnected;
            connected = true;
            everConnected = true;
            firstAttemptAt = 0;
            sequence = 0n;
            droppedFrames = 0;
            if (reconnecting) {
                reconnectCount += 1;
            }
            if (connectDeadlineTimer) {
                try {
                    clearTimeout(connectDeadlineTimer);
                } catch (_) {}
                connectDeadlineTimer = null;
            }
        });
        candidate.on('error', () => {});
        candidate.once('close', () => {
            if (socket === candidate) {
                const wasConnected = connected;
                socket = null;
                connected = false;
                if (wasConnected) {
                    disconnectCount += 1;
                }
                scheduleReconnect();
            }
        });
    } catch (_) {
        stopBridge();
    }
}

function toPayloadBuffer(value) {
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function sendPcmUnsafe(value, contextFrame, frameCount, sampleRate, channels) {
    if (!pipeName || stopped || !active) {
        return false;
    }
    if (!socket) {
        connect();
    }

    const frames = Number(frameCount);
    const rate = Number(sampleRate);
    const channelCount = Number(channels);
    const payload = toPayloadBuffer(value);
    const valid =
        Number.isSafeInteger(frames) &&
        frames > 0 &&
        frames <= SAMPLE_RATE &&
        rate === SAMPLE_RATE &&
        channelCount === CHANNELS &&
        Number.isSafeInteger(Number(contextFrame)) &&
        Number(contextFrame) >= 0 &&
        payload &&
        payload.byteLength === frames * CHANNELS * Float32Array.BYTES_PER_ELEMENT;
    if (!valid) {
        return false;
    }

    const targetSocket = socket;
    if (!connected || !targetSocket || targetSocket.destroyed) {
        return false;
    }
    if (targetSocket.writableLength > MAX_WRITABLE_BYTES) {
        droppedFrames = Math.min(0xffffffff, droppedFrames + frames);
        sequence += 1n;
        // 読み手が停止したpipeを待ち続けず、このaddon経路だけを閉じる。
        stopBridge();
        return false;
    }

    const packet = Buffer.allocUnsafe(HEADER_BYTES + payload.byteLength);
    packet.write('SPA1', 0, 4, 'ascii');
    packet.writeUInt16LE(1, 4);
    packet.writeUInt16LE(HEADER_BYTES, 6);
    packet.writeUInt32LE(payload.byteLength, 8);
    packet.writeUInt32LE(SAMPLE_RATE, 12);
    packet.writeUInt16LE(CHANNELS, 16);
    packet.writeUInt16LE(SAMPLE_FORMAT_F32, 18);
    packet.writeUInt32LE(frames, 20);
    packet.writeUInt32LE(0, 24);
    packet.writeUInt32LE(0, 28);
    packet.writeBigUInt64LE(sequence, 32);
    packet.writeBigUInt64LE(process.hrtime.bigint(), 40);
    packet.writeBigUInt64LE(BigInt(Math.floor(Number(contextFrame))), 48);
    packet.writeUInt32LE(droppedFrames >>> 0, 56);
    packet.writeUInt32LE(0, 60);
    payload.copy(packet, HEADER_BYTES);

    targetSocket.write(packet, (error) => {
        if (error && socket === targetSocket) {
            try {
                targetSocket.destroy();
            } catch (_) {
                stopBridge();
            }
        }
    });
    sequence += 1n;
    droppedFrames = 0;
    packetsSent += 1;
    return true;
}

function sendPcm(value, contextFrame, frameCount, sampleRate, channels) {
    try {
        const sent = sendPcmUnsafe(
            value,
            contextFrame,
            frameCount,
            sampleRate,
            channels
        );
        if (sent) {
            lastRendererPcmAt = Date.now();
        }
        return sent;
    } catch (_) {
        stopBridge();
        return false;
    }
}

function getStats() {
    return {
        enabled: !!pipeName,
        managed,
        active,
        connected,
        stopped,
        reconnectCount,
        disconnectCount,
        packetsSent,
        idlePacketsSent,
        droppedFrames,
    };
}

function close() {
    stopBridge();
}

module.exports = {
    enabled: !!pipeName,
    setActive,
    sendPcm,
    getStats,
    close,
};
