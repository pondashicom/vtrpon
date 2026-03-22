// -----------------------
//     onair.js
//     ver 2.6.1
// -----------------------

// -----------------------
// グローバル変数
// -----------------------
let onairCurrentState = null;
let onairNowOnAir = false;
let onairIsPlaying = false;
let onairRepeatFlag = false;
let onairRemainingTimer = null;
let onairHighSpeedRemainLastUpdate = 0;
let globalEndedListener;
let isFillKeyMode = false;
let ftbMainTimeout = null;
let ftbOffAirTimeout = null;
let onairMasterVolume = 100;
let onairMasterBaseVolume = 100;
let onairFtbToggleMasterVisualGain = 1;
let fadeOutInProgressMain = false;
let fadeInInProgressMain = false;
let fadeOutInProgressItem = false;
let fadeInInProgressItem = false;
let isOffAirProcessing = false;
let onairPreFtbStarted = false;
let onairSeamlessGuardActive = false; 
let onairOverlayForceBlack = false;
let onairSuppressFadeUntilPlaying = false;
let onairPendingUvcFadeInSec = 0;
let onairFtbToggleHoldActive = false;
let onairFtbToggleRaf = null;
let onairFtbToggleVisualAnimSeq = 0;
let onairFtbToggleShouldKeepPlaying = false;
let onairFtbToggleMasterFadeRaf = null;
let onairFtbToggleMasterFadeAnimSeq = 0;
let onairFtbToggleMasterRestoreValue = null;
let onairPendingTransitionSource = null;
let onairPendingCurrentEndMode = null;
const ONAIR_FTB_SET_VOLUME_EPSILON = 0.01;
const ONAIR_FTB_SET_VOLUME_ENDPOINT_SNAP_EPSILON = 0.005;
let onairLastSentFullscreenGammaVolumeForFtb = null;
let onairSuppressFullscreenVolumeSync = false;
const ONAIR_LAYER_Z_PRE_FTB_BLACK = 8000;
const ONAIR_LAYER_Z_FTB_TOGGLE_HOLD = 10000;
let onairOperatorMonitorWindow = null;
let onairOperatorMonitorLoopRaf = null;
let onairOperatorMonitorStateInterval = null;
let onairOperatorMonitorCanvas = null;
let onairOperatorMonitorCtx = null;
let onairOperatorMonitorStream = null;
const ONAIR_OPERATOR_MONITOR_WIDTH = 1920;
const ONAIR_OPERATOR_MONITOR_HEIGHT = 1080;
const ONAIR_OPERATOR_MONITOR_FPS = 30;


// -----------------------------------------
// Playlist / ONAIR 設定読み込み
// -----------------------------------------

const ONAIR_PLAYLIST_SETTINGS_DEFAULTS = {
    disableFtbButton: false,
    ftbButtonFadeSec: 1,
    dskFadeSec: 1
};

let onairPlaylistOnAirSettings = { ...ONAIR_PLAYLIST_SETTINGS_DEFAULTS };

// Playlist / ONAIR 設定を取得する関数
function onairGetPlaylistOnAirSettings() {
    return {
        ...ONAIR_PLAYLIST_SETTINGS_DEFAULTS,
        ...(onairPlaylistOnAirSettings || {})
    };
}

// Playlist / ONAIR 設定を画面へ反映する関数
function onairApplyPlaylistOnAirSettings() {
    const settings = onairGetPlaylistOnAirSettings();
    const ftbButton = document.getElementById('ftb-off-button');
    const disableFtbButtonCheckbox = document.getElementById('disableFtbButton');
    const ftbButtonFadeSecInput = document.getElementById('ftbButtonFadeSec');
    const dskFadeSecInput = document.getElementById('dskFadeSec');

    if (ftbButton) {
        ftbButton.disabled = settings.disableFtbButton === true;
        ftbButton.style.pointerEvents = settings.disableFtbButton === true ? 'none' : '';
        ftbButton.style.opacity = settings.disableFtbButton === true ? '0.45' : '';
    }

    if (disableFtbButtonCheckbox) {
        disableFtbButtonCheckbox.checked = settings.disableFtbButton === true;
    }

    if (ftbButtonFadeSecInput) {
        ftbButtonFadeSecInput.value = String(settings.ftbButtonFadeSec ?? 1);
    }

    if (dskFadeSecInput) {
        dskFadeSecInput.value = String(settings.dskFadeSec ?? 1);
    }
}

// Playlist / ONAIR 設定を読み込む関数
async function onairLoadPlaylistOnAirSettings() {
    try {
        const settings = await window.electronAPI.getPlaylistOnAirSettings();
        onairPlaylistOnAirSettings = {
            ...ONAIR_PLAYLIST_SETTINGS_DEFAULTS,
            ...(settings || {})
        };
    } catch (_) {
        onairPlaylistOnAirSettings = { ...ONAIR_PLAYLIST_SETTINGS_DEFAULTS };
    }

    onairApplyPlaylistOnAirSettings();
}

// Playlist / ONAIR 設定を保存する関数
function onairSavePlaylistOnAirTimingSettings() {
    const disableFtbButtonCheckbox = document.getElementById('disableFtbButton');
    const ftbButtonFadeSecInput = document.getElementById('ftbButtonFadeSec');
    const dskFadeSecInput = document.getElementById('dskFadeSec');

    const nextSettings = {
        ...onairGetPlaylistOnAirSettings(),
        disableFtbButton: disableFtbButtonCheckbox ? disableFtbButtonCheckbox.checked === true : false,
        ftbButtonFadeSec: Math.max(0, Number(ftbButtonFadeSecInput ? ftbButtonFadeSecInput.value : 1) || 1),
        dskFadeSec: Math.max(0, Number(dskFadeSecInput ? dskFadeSecInput.value : 1) || 1)
    };

    onairPlaylistOnAirSettings = nextSettings;
    window.electronAPI.setPlaylistOnAirSettings(nextSettings);
    onairApplyPlaylistOnAirSettings();
}

// -----------------------
// 共通補助関数
// -----------------------

// 時間文字列化
function onairFormatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100); 
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${centiseconds.toString().padStart(2, '0')}`;
}

// 時間文字列解析
function onairParseTimeToSeconds(timeString) {
    if (!timeString) return 0;
    const parts = timeString.split(':').map(parseFloat);
    let hours = 0, minutes = 0, seconds = 0;
    if (parts.length === 3) { // hh:mm:ss
        [hours, minutes, seconds] = parts;
    } else if (parts.length === 4) { // hh:mm:ss:cs
        [hours, minutes, seconds] = parts.slice(0, 3);
        seconds += parts[3] / 100; 
    }
    return (hours * 3600) + (minutes * 60) + seconds;
}

// ------------
//    初期化
// ------------

// 初回起動
document.addEventListener('DOMContentLoaded', () => {
    onairInitialize();

    if (window.dskModule && typeof window.dskModule.initDSKOverlay === 'function') {
        window.dskModule.initDSKOverlay();
    }

    onairLoadPlaylistOnAirSettings();

    const disableFtbButtonCheckbox = document.getElementById('disableFtbButton');
    const ftbButtonFadeSecInput = document.getElementById('ftbButtonFadeSec');
    const dskFadeSecInput = document.getElementById('dskFadeSec');

    if (disableFtbButtonCheckbox) {
        disableFtbButtonCheckbox.addEventListener('change', onairSavePlaylistOnAirTimingSettings);
    }

    if (ftbButtonFadeSecInput) {
        ftbButtonFadeSecInput.addEventListener('change', onairSavePlaylistOnAirTimingSettings);
    }

    if (dskFadeSecInput) {
        dskFadeSecInput.addEventListener('change', onairSavePlaylistOnAirTimingSettings);
    }

    if (window.electronAPI.onPlaylistOnAirSettingsUpdated) {
        window.electronAPI.onPlaylistOnAirSettingsUpdated((settings) => {
            onairPlaylistOnAirSettings = {
                ...ONAIR_PLAYLIST_SETTINGS_DEFAULTS,
                ...(settings || {})
            };
            onairApplyPlaylistOnAirSettings();
        });
    }
});

// UI要素取得
function onairGetElements() {
    return {
        onairVideoElement: document.getElementById('on-air-video'),
        onairFadeCanvas: document.getElementById('fade-canvas'),
        onairVolumeBarL: document.getElementById('on-air-volume-bar-L'),
        onairVolumeBarR: document.getElementById('on-air-volume-bar-R'),
        onairFileNameDisplay: document.getElementById('on-air-filename'),
        onairProgressSlider: document.getElementById('on-air-progress-slider'),
        onairStartTimeDisplay: document.getElementById('on-air-start-time'),
        onairEndTimeDisplay: document.getElementById('on-air-end-time'),
        onairInPointDisplay: document.getElementById('on-air-in-point-time'),
        onairOutPointDisplay: document.getElementById('on-air-out-point-time'),
        onairRemainTimeDisplay: document.getElementById('on-air-remain-time'),
        onairEndModeDisplay: document.getElementById('on-air-endmode'),
        onairPlayButton: document.getElementById('on-air-play-button'),
        onairPauseButton: document.getElementById('on-air-pause-button'),
        onairOffAirButton: document.getElementById('off-air-button'),
        onairItemVolumeSlider: document.getElementById('on-air-item-volume-slider'),
        onairItemVolumeValueDisplay: document.getElementById('on-air-item-volume-value'),
        onairMasterVolumeSlider: document.getElementById('on-air-master-volume-slider'),
        onairMasterVolumeValueDisplay: document.getElementById('on-air-master-volume-value'),
        onairFadeOutButton: document.getElementById('on-air-fo-button'),
        onairFadeInButton: document.getElementById('on-air-fi-button'),
        onairFTBButton: document.getElementById('ftb-off-button')
    };
}

// FTBトグルレイヤー
function onairInitFtbToggleLayer() {
    let layer = document.getElementById('onair-ftb-toggle-layer');
    const isNew = !layer;

    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'onair-ftb-toggle-layer';
        document.body.appendChild(layer);
    } else if (layer.parentElement !== document.body) {
        document.body.appendChild(layer);
    }

    layer.style.position = 'fixed';
    layer.style.margin = '0';
    layer.style.border = '0';
    layer.style.padding = '0';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = String(ONAIR_LAYER_Z_FTB_TOGGLE_HOLD);

    if (isNew) {
        layer.style.top = '0';
        layer.style.left = '0';
        layer.style.width = '0px';
        layer.style.height = '0px';
        layer.style.backgroundColor = 'black';
        layer.style.opacity = '0';
        layer.style.visibility = 'hidden';
        layer.style.display = 'block';
    }

    onairSyncFtbToggleLayerRect();

    return layer;
}

// FTBトグル位置同期
function onairSyncFtbToggleLayerRect() {
    const layer = document.getElementById('onair-ftb-toggle-layer');
    const els = onairGetElements();
    const videoEl = els?.onairVideoElement;
    if (!layer || !videoEl) return;

    const rect = videoEl.getBoundingClientRect();
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
}

// FTBトグル表示制御
function onairSetFtbToggleHoldVisual(active, durationSec) {
    const layer = onairInitFtbToggleLayer();
    if (!layer) return;

    onairSyncFtbToggleLayerRect();

    if (onairFtbToggleRaf !== null) {
        cancelAnimationFrame(onairFtbToggleRaf);
        onairFtbToggleRaf = null;
    }

    onairFtbToggleVisualAnimSeq += 1;
    const animSeq = onairFtbToggleVisualAnimSeq;

    const dur = Math.max(0, Number(durationSec) || 0);
    const startOpacity = Math.max(0, Math.min(1, parseFloat(layer.style.opacity || '0') || 0));
    const targetOpacity = active ? 1 : 0;

    // 表示色設定
    const fillKeyColorPicker = document.getElementById('fillkey-color-picker');
    const fillKeySelectedColor = fillKeyColorPicker ? fillKeyColorPicker.value : "#00FF00";
    layer.style.backgroundColor = (isFillKeyMode && fillKeySelectedColor) ? fillKeySelectedColor : 'black';
    layer.style.display = 'block';
    layer.style.visibility = 'visible';

    // 即時反映
    if (dur <= 0) {
        layer.style.opacity = String(targetOpacity);
        if (!active) {
            layer.style.visibility = 'hidden';
        }
        return;
    }

    // アニメーション更新
    const startTs = performance.now();
    const animate = (now) => {
        if (animSeq !== onairFtbToggleVisualAnimSeq) {
            return;
        }

        const t = Math.min(1, (now - startTs) / (dur * 1000));
        const next = startOpacity + ((targetOpacity - startOpacity) * t);
        layer.style.opacity = String(next);

        if (t < 1) {
            onairFtbToggleRaf = requestAnimationFrame(animate);
            return;
        }

        if (animSeq !== onairFtbToggleVisualAnimSeq) {
            return;
        }

        onairFtbToggleRaf = null;
        layer.style.opacity = String(targetOpacity);
        if (!active) {
            layer.style.visibility = 'hidden';
        }
    };

    onairFtbToggleRaf = requestAnimationFrame(animate);
}
// オーバーレイキャンバス初期化
function initializeOverlayCanvasOnAir() {
    // 既存キャンバス取得
    let canvas = document.getElementById('onair-overlay-canvas');
    const els = onairGetElements();
    const videoEl = els?.onairVideoElement;
    const fade   = els?.onairFadeCanvas;

    // 親要素確認
    if (!videoEl || !videoEl.parentElement) {
        logInfo('[onair.js] on-air-video parent not found.');
        return null;
    }

    // 親要素位置基準
    const parent = videoEl.parentElement;
    const cs = window.getComputedStyle(parent);
    if (!cs || cs.position === 'static') {
        parent.style.position = 'relative';
    }

    // キャンバス生成
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'onair-overlay-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.visibility = 'hidden';
        canvas.style.opacity = 0;
        parent.appendChild(canvas);
    }

    canvas.style.zIndex = '1500';

    // サイズ同期
    try {
        adjustFadeCanvasSize(videoEl, canvas);
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));

        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
    } catch (_) {}

    return canvas;
}

// Operator Monitor 出力canvasを初期化する関数
function onairEnsureOperatorMonitorCanvas() {
    if (onairOperatorMonitorCanvas && onairOperatorMonitorCtx) {
        return onairOperatorMonitorCanvas;
    }

    let canvas = document.getElementById('onair-operator-monitor-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'onair-operator-monitor-canvas';
        canvas.style.display = 'none';
        document.body.appendChild(canvas);
    }

    canvas.width = ONAIR_OPERATOR_MONITOR_WIDTH;
    canvas.height = ONAIR_OPERATOR_MONITOR_HEIGHT;

    onairOperatorMonitorCanvas = canvas;
    onairOperatorMonitorCtx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: true
    });

    return onairOperatorMonitorCanvas;
}

// 既存の OnAir DSK オーバーレイを Operator Monitor 出力へ描画する関数
function onairDrawExistingDskOverlayToOperatorMonitor(ctx, outputCanvas) {
    const dskOverlay = document.getElementById('onair-dsk-overlay');
    const dskVideo = dskOverlay ? dskOverlay.querySelector('video') : null;
    const onAirVideo = document.getElementById('on-air-video');

    if (!ctx || !outputCanvas || !dskOverlay || !dskVideo || !onAirVideo) {
        return;
    }

    const overlayStyle = window.getComputedStyle(dskOverlay);
    if (!overlayStyle || overlayStyle.display === 'none' || overlayStyle.visibility === 'hidden') {
        return;
    }

    const overlayOpacity = Math.max(0, Math.min(1, parseFloat(overlayStyle.opacity || '0') || 0));
    if (overlayOpacity <= 0.001) {
        return;
    }

    if (!(dskVideo.readyState >= 2 && dskVideo.videoWidth > 0 && dskVideo.videoHeight > 0)) {
        return;
    }

    const videoRect = onAirVideo.getBoundingClientRect();
    const overlayRect = dskOverlay.getBoundingClientRect();

    if (!videoRect || !overlayRect || videoRect.width <= 0 || videoRect.height <= 0) {
        return;
    }

    const dx = Math.round(((overlayRect.left - videoRect.left) / videoRect.width) * outputCanvas.width);
    const dy = Math.round(((overlayRect.top - videoRect.top) / videoRect.height) * outputCanvas.height);
    const dw = Math.round((overlayRect.width / videoRect.width) * outputCanvas.width);
    const dh = Math.round((overlayRect.height / videoRect.height) * outputCanvas.height);

    if (dw <= 0 || dh <= 0) {
        return;
    }

    try {
        ctx.save();
        ctx.globalAlpha = overlayOpacity;
        ctx.drawImage(dskVideo, dx, dy, dw, dh);
        ctx.restore();
    } catch (_) {}
}

// Operator Monitor 出力に現在フレームを描画する関数
function onairRenderOperatorMonitorFrame() {
    const canvas = onairEnsureOperatorMonitorCanvas();
    const ctx = onairOperatorMonitorCtx;
    const els = onairGetElements();
    const videoElement = els?.onairVideoElement;
    const fadeCanvas = els?.onairFadeCanvas;
    const overlayCanvas = document.getElementById('onair-overlay-canvas');
    const ftbToggleLayer = document.getElementById('onair-ftb-toggle-layer');

    if (!canvas || !ctx) {
        return;
    }

    ctx.save();
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!onairNowOnAir && !onairCurrentState) {
        ctx.restore();
        return;
    }

    if (videoElement && videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        const srcW = videoElement.videoWidth;
        const srcH = videoElement.videoHeight;
        const srcAspect = srcW / srcH;
        const dstAspect = canvas.width / canvas.height;

        let drawW;
        let drawH;
        let drawX;
        let drawY;

        if (srcAspect > dstAspect) {
            drawW = canvas.width;
            drawH = Math.round(drawW / srcAspect);
            drawX = 0;
            drawY = Math.round((canvas.height - drawH) / 2);
        } else {
            drawH = canvas.height;
            drawW = Math.round(drawH * srcAspect);
            drawX = Math.round((canvas.width - drawW) / 2);
            drawY = 0;
        }

        try {
            ctx.drawImage(videoElement, drawX, drawY, drawW, drawH);
        } catch (_) {}
    }

    if (overlayCanvas) {
        const overlayStyle = window.getComputedStyle(overlayCanvas);
        const overlayVisible = overlayStyle.visibility !== 'hidden' && overlayStyle.display !== 'none';
        const overlayOpacity = Math.max(0, Math.min(1, parseFloat(overlayStyle.opacity || '0') || 0));

        if (overlayVisible && overlayOpacity > 0.001) {
            ctx.save();
            ctx.globalAlpha = overlayOpacity;
            try {
                ctx.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);
            } catch (_) {}
            ctx.restore();
        }
    }

    onairDrawExistingDskOverlayToOperatorMonitor(ctx, canvas);

    if (fadeCanvas) {
        const fadeStyle = window.getComputedStyle(fadeCanvas);
        const fadeVisible = fadeStyle.visibility !== 'hidden' && fadeStyle.display !== 'none';
        const fadeOpacity = Math.max(0, Math.min(1, parseFloat(fadeStyle.opacity || '0') || 0));

        if (fadeVisible && fadeOpacity > 0.001) {
            ctx.save();
            ctx.globalAlpha = fadeOpacity;
            ctx.fillStyle = fadeStyle.backgroundColor || 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    }

    if (ftbToggleLayer) {
        const ftbStyle = window.getComputedStyle(ftbToggleLayer);
        const ftbVisible = ftbStyle.visibility !== 'hidden' && ftbStyle.display !== 'none';
        const ftbOpacity = Math.max(0, Math.min(1, parseFloat(ftbStyle.opacity || '0') || 0));

        if (ftbVisible && ftbOpacity > 0.001) {
            ctx.save();
            ctx.globalAlpha = ftbOpacity;
            ctx.fillStyle = ftbStyle.backgroundColor || 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
    }

    ctx.restore();
}

// Operator Monitor 出力streamを取得する関数
function onairEnsureOperatorMonitorStream() {
    const canvas = onairEnsureOperatorMonitorCanvas();
    if (!canvas) {
        return null;
    }

    if (onairOperatorMonitorStream) {
        return onairOperatorMonitorStream;
    }

    if (typeof canvas.captureStream !== 'function') {
        logInfo('[onair.js] captureStream is not available on operator monitor canvas.');
        return null;
    }

    onairOperatorMonitorStream = canvas.captureStream(ONAIR_OPERATOR_MONITOR_FPS);
    return onairOperatorMonitorStream;
}

// Operator Monitor 表示状態を取得する関数
function onairGetOperatorMonitorState() {
    const elements = onairGetElements();
    const fileNameText = (elements.onairFileNameDisplay && elements.onairFileNameDisplay.textContent)
        ? elements.onairFileNameDisplay.textContent
        : 'No file loaded';
    const remainText = (elements.onairRemainTimeDisplay && elements.onairRemainTimeDisplay.textContent)
        ? elements.onairRemainTimeDisplay.textContent
        : '00:00:00:00';

    let durationText = '00:00:00:00';
    if (onairCurrentState) {
        if (onairIsUvcItemData(onairCurrentState)) {
            durationText = 'LIVE';
        } else {
            const durationSec = Math.max(0, (Number(onairCurrentState.outPoint) || 0) - (Number(onairCurrentState.inPoint) || 0));
            durationText = onairFormatTime(durationSec);
        }
    }

    const startModeText = onairCurrentState
        ? String(onairCurrentState.startMode || 'PAUSE').toUpperCase()
        : '';

    let endModeText = '';
    if (elements.onairEndModeDisplay && elements.onairEndModeDisplay.textContent) {
        endModeText = String(elements.onairEndModeDisplay.textContent)
            .replace(/^ENDMODE:\s*/i, '')
            .trim();
    }
    if (endModeText === 'ENDMODE') {
        endModeText = '';
    }

    return {
        fileName: fileNameText,
        remain: remainText,
        duration: durationText,
        startMode: startModeText,
        endMode: endModeText
    };
}

// Operator Monitor 子窓へ stream を接続する関数
function onairAttachOperatorMonitorStream() {
    if (!onairOperatorMonitorWindow || onairOperatorMonitorWindow.closed) {
        return false;
    }

    const stream = onairEnsureOperatorMonitorStream();
    if (!stream) {
        return false;
    }

    try {
        if (typeof onairOperatorMonitorWindow.setOperatorMonitorStream === 'function') {
            onairOperatorMonitorWindow.setOperatorMonitorStream(stream);
            return true;
        }
    } catch (_) {}

    return false;
}

// Operator Monitor 子窓へ状態を送る関数
function onairPushOperatorMonitorState() {
    if (!onairOperatorMonitorWindow || onairOperatorMonitorWindow.closed) {
        return false;
    }

    try {
        if (typeof onairOperatorMonitorWindow.setOperatorMonitorState === 'function') {
            onairOperatorMonitorWindow.setOperatorMonitorState(onairGetOperatorMonitorState());
            return true;
        }
    } catch (_) {}

    return false;
}

// Operator Monitor 出力を開始する関数
function onairOpenOperatorMonitorOutput() {
    if (onairOperatorMonitorWindow && !onairOperatorMonitorWindow.closed) {
        onairOperatorMonitorWindow.focus();
        onairAttachOperatorMonitorStream();
        onairPushOperatorMonitorState();
        return;
    }

    const operatorMonitorUrl = new URL('operator_monitor.html', window.location.href).toString();
    onairOperatorMonitorWindow = window.open(
        operatorMonitorUrl,
        'vtrpon-operator-monitor-output',
        'popup=yes,resizable=yes,width=480,height=270'
    );

    if (!onairOperatorMonitorWindow) {
        logInfo('[onair.js] Failed to open operator monitor output window.');
        return;
    }

    try {
        onairOperatorMonitorWindow.resizeTo(480, 270);
    } catch (_) {}

    if (onairOperatorMonitorLoopRaf === null) {
        const renderStep = () => {
            if (!onairOperatorMonitorWindow || onairOperatorMonitorWindow.closed) {
                onairCloseOperatorMonitorOutput();
                return;
            }

            onairRenderOperatorMonitorFrame();
            onairOperatorMonitorLoopRaf = requestAnimationFrame(renderStep);
        };

        onairOperatorMonitorLoopRaf = requestAnimationFrame(renderStep);
    }

    if (onairOperatorMonitorStateInterval === null) {
        onairOperatorMonitorStateInterval = setInterval(() => {
            if (!onairOperatorMonitorWindow || onairOperatorMonitorWindow.closed) {
                onairCloseOperatorMonitorOutput();
                return;
            }

            onairPushOperatorMonitorState();
        }, 100);
    }

    const tryAttach = () => {
        if (!onairOperatorMonitorWindow || onairOperatorMonitorWindow.closed) {
            return;
        }

        const streamReady = onairAttachOperatorMonitorStream();
        const stateReady = onairPushOperatorMonitorState();

        if (!streamReady || !stateReady) {
            setTimeout(tryAttach, 100);
        }
    };

    tryAttach();
}

// Operator Monitor 出力を停止する関数
function onairCloseOperatorMonitorOutput() {
    if (onairOperatorMonitorWindow && !onairOperatorMonitorWindow.closed) {
        onairOperatorMonitorWindow.close();
    }
    onairOperatorMonitorWindow = null;

    if (onairOperatorMonitorLoopRaf !== null) {
        cancelAnimationFrame(onairOperatorMonitorLoopRaf);
        onairOperatorMonitorLoopRaf = null;
    }

    if (onairOperatorMonitorStateInterval !== null) {
        clearInterval(onairOperatorMonitorStateInterval);
        onairOperatorMonitorStateInterval = null;
    }

    if (onairOperatorMonitorStream) {
        try {
            onairOperatorMonitorStream.getTracks().forEach(track => track.stop());
        } catch (_) {}
        onairOperatorMonitorStream = null;
    }
}

// Operator Monitor 出力をトグルする関数
function onairToggleOperatorMonitorOutput() {
    if (onairOperatorMonitorWindow && !onairOperatorMonitorWindow.closed) {
        onairCloseOperatorMonitorOutput();
    } else {
        onairOpenOperatorMonitorOutput();
    }
}

// ビデオ要素初期化
function onairInitializeVideo(elements) {
    const { onairVideoElement } = elements;
    if (!onairVideoElement) return;

    onairVideoElement.pause();
    onairVideoElement.currentTime = 0;

    if (onairVideoElement.srcObject) {
        onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        onairVideoElement.srcObject = null;
    }

    try {
        onairVideoElement.removeAttribute('src');
    } catch (_) {
        onairVideoElement.src = '';
    }

    onairVideoElement.src = '';
    onairVideoElement.load();
}

// UVCストリーム停止
async function onairStopUVCStream(elements) {
    const { onairVideoElement } = elements;
    if (!onairVideoElement) return;

    if (onairVideoElement.srcObject) {
        onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        onairVideoElement.srcObject = null;
    }
}

// ボタン状態初期化
function onairInitializeButtons(elements) {
    const buttonClass = 'button important-button';
    if (elements.onairPlayButton) {
        elements.onairPlayButton.className = buttonClass;
    }
    if (elements.onairPauseButton) {
        elements.onairPauseButton.className = buttonClass;
    }
    if (elements.onairOffAirButton) {
        elements.onairOffAirButton.className = buttonClass;
    }
    if (elements.onairFadeOutButton) {
        elements.onairFadeOutButton.className = buttonClass;
    }
    if (elements.onairFadeInButton) {
        elements.onairFadeInButton.className = buttonClass;
    }
    if (elements.onairFTBButton) {
        elements.onairFTBButton.className = buttonClass;
        if (onairFtbToggleHoldActive) {
            elements.onairFTBButton.classList.add('button-recording');
        }
    }
}

// 音量メーター初期化
function onairInitializeVolumeMeter(elements) {
    const { onairVolumeBarL, onairVolumeBarR } = elements;
    if (!onairVolumeBarL || !onairVolumeBarR) return;

    // メーター要素生成
    onairVolumeBarL.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.className = 'volume-segment';
        onairVolumeBarL.appendChild(segment);
    }

    onairVolumeBarR.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.className = 'volume-segment';
        onairVolumeBarR.appendChild(segment);
    }
}

// 音量スライダー初期化
function onairInitializeVolumeSlider(elements, forcedDefaultVolume) {
    const { onairItemVolumeSlider, onairItemVolumeValueDisplay, onairMasterVolumeSlider, onairMasterVolumeValueDisplay } = elements;
    if (!onairItemVolumeSlider || !onairItemVolumeValueDisplay || !onairMasterVolumeSlider || !onairMasterVolumeValueDisplay) return;

    // 初期音量計算
    let defaultItemVolume = forcedDefaultVolume !== undefined ? forcedDefaultVolume : (onairCurrentState?.defaultVolume ?? 100);
    if (onairCurrentState && onairCurrentState.startMode === 'FADEIN') {
        defaultItemVolume = 0;
    }
    onairItemVolumeSlider.value = defaultItemVolume;
    onairItemVolumeValueDisplay.textContent = `${defaultItemVolume}%`;
    onairItemVolumeSlider.style.setProperty('--value', `${defaultItemVolume}%`);
    const useFtbVisualGain = onairFtbToggleHoldActive;
    const effectiveVisualGain = useFtbVisualGain
        ? (Number(onairFtbToggleMasterVisualGain) || 0)
        : 1;

    const masterDisplayValue = Math.max(
        0,
        Math.min(100, Math.round((Number(onairMasterBaseVolume) || 0) * effectiveVisualGain))
    );

    onairMasterVolume = masterDisplayValue;
    onairMasterVolumeSlider.value = masterDisplayValue;
    onairUpdateMasterVolumeDisplay(masterDisplayValue);
    onairMasterVolumeSlider.style.setProperty('--value', `${masterDisplayValue}%`);

    // 最終出力音量算出
    const finalVolume = (defaultItemVolume / 100) * (masterDisplayValue / 100);
    if (!onairSuppressFullscreenVolumeSync) {
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });
    } else {
        logInfo(
            `[onair.js] Volume slider init skipped fullscreen sync during reset: item=${defaultItemVolume}%, master=${masterDisplayValue}%, finalGamma=${Math.pow(finalVolume, 2.2).toFixed(4)}`
        );
    }

    logDebug(`[onair.js] Item volume slider initialized to ${defaultItemVolume}% and Master volume slider initialized to ${onairMasterVolume}%`);
}
// シークバー初期化
function onairInitializeSeekBar(elements) {
    const { onairProgressSlider, onairStartTimeDisplay, onairEndTimeDisplay, onairVideoElement } = elements;

    if (!onairProgressSlider || !onairStartTimeDisplay || !onairEndTimeDisplay || !onairVideoElement) return;

    // 初期値設定
    onairProgressSlider.value = 0;
    onairProgressSlider.max = 0;
    onairProgressSlider.step = "0.01";
    onairStartTimeDisplay.textContent = '00:00:00:00';
    onairEndTimeDisplay.textContent = '00:00:00:00';

    // メタデータ監視
    if (!onairVideoElement.__vtrponLoadedMetadataBound) {
        onairVideoElement.__vtrponLoadedMetadataBound = true;

        onairVideoElement.addEventListener('loadedmetadata', () => {
            if (onairIsUvcItemData(onairCurrentState)) {
                return;
            }
            const duration = onairVideoElement.duration || 0;
            onairProgressSlider.max = duration.toFixed(2);
            onairEndTimeDisplay.textContent = onairFormatTime(duration);
        });
    }

    // マーカー初期化
    const inMarker = document.getElementById('on-air-in-marker');
    const outMarker = document.getElementById('on-air-out-marker');

    if (inMarker) inMarker.style.display = "none";
    if (outMarker) outMarker.style.display = "none";
    logDebug('[onair.js] Seek bar initialized.');
}

// 各種状態表示初期化
function onairInitializeStatusDisplays(elements) {
    const { onairFileNameDisplay, onairInPointDisplay, onairOutPointDisplay, onairRemainTimeDisplay, onairEndModeDisplay } = elements;
    if (onairFileNameDisplay) onairFileNameDisplay.textContent = 'No file loaded';
    if (onairInPointDisplay) onairInPointDisplay.textContent = '00:00:00:00';
    if (onairOutPointDisplay) onairOutPointDisplay.textContent = '00:00:00:00';
    if (onairRemainTimeDisplay) onairRemainTimeDisplay.textContent = '00:00:00:00';
    if (onairEndModeDisplay) onairEndModeDisplay.textContent = 'End Mode';
}

// フェードキャンバス初期化
function onairInitializeFadeCanvas(elements) {
    const { onairFadeCanvas, onairVideoElement } = elements;
    if (!onairFadeCanvas || !onairVideoElement) return;
    adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas);
    onairFadeCanvas.style.position = 'absolute';
    onairFadeCanvas.style.pointerEvents = 'none';
    onairFadeCanvas.style.margin = '0';
    onairFadeCanvas.style.border = '0';
    onairFadeCanvas.style.padding = '0';
    onairFadeCanvas.style.opacity = 0;
    onairFadeCanvas.style.visibility = 'hidden';
    window.addEventListener('resize', () => adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas));
    logDebug('[onair.js] Fade canvas initialized.');
}

// リソース解放
function onairReleaseResources(elements) {
    onairInitializeVideo(elements);
    onairStopUVCStream(elements);
}

// 初期化状態
let onairInitialized = false;

// オンエア初期化
function onairInitialize() {
    if (onairInitialized) {
        logDebug('[onair.js] onairInitialize called again, but it is already initialized. Skipping.');
        return;
    }

    // 初期化フラグ更新
    onairInitialized = true;

    // 要素取得
    const elements = onairGetElements();

    // 初期状態反映
    onairReset(elements);
    if (elements && elements.onairFadeCanvas) {
        elements.onairFadeCanvas.style.zIndex = String(ONAIR_LAYER_Z_PRE_FTB_BLACK);
        elements.onairFadeCanvas.style.pointerEvents = 'none';
    }
    onairInitFtbToggleLayer();
    window.addEventListener('resize', onairSyncFtbToggleLayerRect);

    // ボタンハンドラ設定
    onairSetupButtonHandlers();

    // 音量スライダー設定
    onairInitializeVolumeSlider(elements);

    // シークバーハンドラ設定
    onairSetupSeekBarHandlers(elements);

    // タイマーハンドラ設定
    onairResetRemainingTimer(elements);

    // 音量スライダーハンドラ設定
    onairSetupVolumeSliderHandler(elements);

    // 再生速度コントローラー初期化
    setupPlaybackSpeedController();

    // 倍速プリセットボタン初期化
    setupPlaybackSpeedPresetButtons();

    // モーダル状態変更監視リスナー登録
    if (!onairModalListenerRegistered) {
        window.electronAPI.onModalStateChange((event, { isActive }) => {
            isOnAirModalActive = isActive;
            if (lastLoggedOnAirModalState !== isActive) {
                logDebug(`[onair.js] OnAir Modal state changed: ${isOnAirModalActive}`);
                lastLoggedOnAirModalState = isActive;
            }
        });
        onairModalListenerRegistered = true;
    }

    // 初期モーダル状態取得
    window.electronAPI.getModalState().then((state) => {
        isOnAirModalActive = state.isActive;
        lastLoggedOnAirModalState = isOnAirModalActive;
        logDebug(`[onair.js] OnAir Initial modal state: ${isOnAirModalActive}`);
    });

    // FillKeyモード反映
    updateFillKeyModeState();

    logDebug('[onair.js] On-Air area Initialization complete.');
}

// ----------------------------------------
// 映像ブリッジオーバーレイ制御
// ----------------------------------------

// 前フレーム保持開始
function captureLastFrameAndHoldUntilNextReadyOnAir(respectBlackHold) {
    // 要素確認
    const els = onairGetElements();
    const videoElement = els?.onairVideoElement;
    const overlayCanvas = initializeOverlayCanvasOnAir();
    if (!videoElement || !overlayCanvas) {
        logInfo('[onair.js] Overlay capture skipped due to missing element.');
        return;
    }

    if (videoElement.srcObject) {
        logInfo('[onair.js] Overlay capture skipped for live srcObject source.');
        return;
    }

    // 背景色決定
    const ctx = overlayCanvas.getContext('2d');
    overlayCanvas.style.visibility = 'visible';
    overlayCanvas.style.opacity = 1;
    const fillKeyColorPicker = document.getElementById('fillkey-color-picker');
    const fillKeySelectedColor = fillKeyColorPicker ? fillKeyColorPicker.value : "#00FF00";
    const fillKeyEnabled = !!isFillKeyMode || !!(onairCurrentState && onairCurrentState.fillKeyMode === true);
    const getEffectiveBgColor = () => {
        try {
            const bg1 = window.getComputedStyle(videoElement).backgroundColor;
            if (bg1 && bg1 !== 'rgba(0, 0, 0, 0)' && bg1 !== 'transparent') return bg1;
            let p = videoElement.parentElement;
            for (let i = 0; i < 5 && p; i++) {
                const bgp = window.getComputedStyle(p).backgroundColor;
                if (bgp && bgp !== 'rgba(0, 0, 0, 0)' && bgp !== 'transparent') return bgp;
                p = p.parentElement;
            }
        } catch (_) {}
        return null;
    };

    const effectiveBg = getEffectiveBgColor();
    const overlayBgColor = fillKeyEnabled ? (fillKeySelectedColor || effectiveBg || "#00FF00") : 'black';

    // 黒保持描画
    if (onairOverlayForceBlack) {
        ctx.save();
        ctx.fillStyle = overlayBgColor;
        ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        ctx.restore();
    } else {
        // 前フレーム描画
        try {
            const vw = videoElement.videoWidth;
            const vh = videoElement.videoHeight;
            ctx.save();
            ctx.fillStyle = overlayBgColor;
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            if (vw && vh && vw > 0 && vh > 0) {
                const srcAR = vw / vh;
                const dstAR = overlayCanvas.width / overlayCanvas.height;

                let dw, dh, dx, dy;
                if (srcAR > dstAR) {
                    dw = overlayCanvas.width;
                    dh = Math.round(dw / srcAR);
                    dx = 0;
                    dy = Math.round((overlayCanvas.height - dh) / 2);
                } else {
                    dh = overlayCanvas.height;
                    dw = Math.round(dh * srcAR);
                    dx = Math.round((overlayCanvas.width - dw) / 2);
                    dy = 0;
                }

                ctx.drawImage(videoElement, dx, dy, dw, dh);
            } else {
                ctx.drawImage(videoElement, 0, 0, overlayCanvas.width, overlayCanvas.height);
            }

            if (respectBlackHold && els?.onairFadeCanvas) {
                const fadeStyle = window.getComputedStyle(els.onairFadeCanvas);
                const fadeVisible = fadeStyle.visibility !== 'hidden' && fadeStyle.display !== 'none';
                const fadeOpacity = Math.max(0, Math.min(1, parseFloat(fadeStyle.opacity || '0')));

                if (fadeVisible && fadeOpacity > 0.01) {
                    ctx.save();
                    ctx.globalAlpha = fadeOpacity;
                    ctx.fillStyle = fadeStyle.backgroundColor || overlayBgColor;
                    ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                    ctx.restore();
                }
            }

            ctx.restore();
        } catch (e) {
            ctx.save();
            ctx.fillStyle = overlayBgColor;
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.restore();
        }
    }
    onairSeamlessGuardActive = true;

    let rvcHandle = null;
    let frameCount = 0;
    const useRVC = typeof videoElement.requestVideoFrameCallback === 'function';

    let safetyTimer = null;

    // オーバーレイ解除
    const clearOverlay = () => {
        try {
            overlayCanvas.style.opacity = 0;
            overlayCanvas.style.visibility = 'hidden';
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        } catch (_) {}
        onairSeamlessGuardActive = false;

        if (safetyTimer) {
            try { clearTimeout(safetyTimer); } catch (_) {}
            safetyTimer = null;
        }
    };

    // セーフティ監視
    safetyTimer = setTimeout(() => {
        if (onairSeamlessGuardActive) {
            clearOverlay();
        }
    }, 5000);

    // requestVideoFrameCallback監視
    if (useRVC) {
        const tick = () => {
            rvcHandle = videoElement.requestVideoFrameCallback(() => {
                frameCount += 1;

                const requiredFrames = videoElement.paused ? 1 : 2;

                if (frameCount >= requiredFrames) {
                    clearOverlay();
                } else {
                    tick();
                }
            });
        };
        setTimeout(tick, 0);
        return;
    }
    // イベント監視
    const once = (type) => {
        const handler = () => {
            ['playing', 'canplay', 'seeked', 'timeupdate'].forEach(ev => videoElement.removeEventListener(ev, handler));
            clearOverlay();
        };
        videoElement.addEventListener(type, handler, { once: true });
    };
    ['playing', 'canplay', 'seeked', 'timeupdate'].forEach(once);
}

// シームレス用オーバーレイ解除
function onairCancelSeamlessOverlay(reason) {
    try {
        const overlayCanvas = document.getElementById('onair-overlay-canvas');
        if (overlayCanvas) {
            overlayCanvas.style.opacity = 0;
            overlayCanvas.style.visibility = 'hidden';
            try {
                const ctx = overlayCanvas.getContext('2d');
                ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            } catch (_) {}
        }
    } catch (_) {}

    // 関連フラグ初期化
    onairSeamlessGuardActive = false;
    onairOverlayForceBlack = false;
    onairSuppressFadeUntilPlaying = false;
    onairPendingUvcFadeInSec = 0;

    if (reason) logInfo('[onair.js] Seamless overlay cancelled:', reason);
}

// -----------------------------------------------
// オンエア・オフエア情報受信
// -----------------------------------------------

// UVCパス判定
function onairIsUvcPath(path) {
    return typeof path === 'string' && path.startsWith('UVC_DEVICE:');
}

// UVCアイテム判定
function onairIsUvcItemData(itemData) {
    if (!itemData || typeof itemData !== 'object') {
        return false;
    }

    if (onairIsUvcPath(itemData.path)) {
        return true;
    }

    if ((itemData.endMode === 'UVC') && onairGetUvcDeviceId(itemData)) {
        return true;
    }

    return false;
}

// UVCデバイスID取得
function onairGetUvcDeviceId(itemData) {
    if (!itemData || typeof itemData !== 'object') {
        return null;
    }

    if (typeof itemData.deviceId === 'string' && itemData.deviceId) {
        return itemData.deviceId;
    }

    if (onairIsUvcPath(itemData.path)) {
        return itemData.path.substring('UVC_DEVICE:'.length);
    }

    return null;
}

// 開始モード正規化
function onairResolveIncomingStartMode(itemData) {
    if (onairIsUvcItemData(itemData)) {
        return 'PLAY';
    }

    if (itemData && typeof itemData.startMode === 'string' && itemData.startMode) {
        return itemData.startMode;
    }

    return 'PAUSE';
}

// 遷移計画生成
function onairBuildTransitionPlan(itemId, itemData) {

    // 現在状態取得
    const currentPath =
        (onairCurrentState && typeof onairCurrentState.path === 'string')
            ? onairCurrentState.path
            : '';

    const currentIsUvc = onairIsUvcPath(currentPath);

    const currentEndMode =
        (typeof onairPendingCurrentEndMode === 'string' && onairPendingCurrentEndMode)
            ? onairPendingCurrentEndMode
            : ((onairCurrentState && typeof onairCurrentState.endMode === 'string')
                ? onairCurrentState.endMode
                : '');

    // 次アイテム取得
    const nextPath =
        (itemData && typeof itemData.path === 'string')
            ? itemData.path
            : '';

    const nextIsUvc = onairIsUvcItemData(itemData);

    const nextStartMode = onairResolveIncomingStartMode(itemData);

    const nextEndMode =
        (itemData && typeof itemData.endMode === 'string')
            ? itemData.endMode
            : 'PAUSE';

    const nextTransitionSource =
        (typeof onairPendingTransitionSource === 'string' && onairPendingTransitionSource)
            ? onairPendingTransitionSource
            : ((itemData && typeof itemData.transitionSource === 'string' && itemData.transitionSource)
                ? itemData.transitionSource
                : 'auto');

    // 次メディア種別判定
    const nextIsAudio = !!nextPath && !nextIsUvc &&
        /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aif|aiff)(\?.*)?$/i.test(nextPath);

    const nextMediaKind = nextIsAudio
        ? 'audioOnly'
        : (nextIsUvc ? 'uvc' : 'video');

    // UVC同一アイテム判定
    const sameUvcItem =
        !!onairNowOnAir &&
        !!onairCurrentState &&
        onairCurrentState.itemId === itemId &&
        onairIsUvcItemData(onairCurrentState);

    // 後段へ渡す判断材料
    return {
        itemId,
        currentPath,
        currentEndMode,
        currentIsUvc,
        currentFtbActive: !!(
            onairFtbToggleHoldActive ||
            (onairCurrentState && onairCurrentState.ftbEnabled === true)
        ),
        nextPath,
        nextStartMode,
        nextEndMode,
        nextTransitionSource,
        nextIsUvc,
        nextIsAudio,
        nextMediaKind,
        sameUvcItem,
        shouldPrepareOverlayBeforeReset: false,
        shouldResetCurrentOnAir: !!onairNowOnAir,
        bridgeMode: null,
        transitionSource: nextTransitionSource
    };
}

// ブリッジモード判定
function onairResolveBridgeMode(transitionPlan) {

    // 入力確認
    if (!transitionPlan) {
        return {
            bridgeMode: null,
            transitionSource: null
        };
    }

    // 判定用正規化
    const nextStartMode = String(transitionPlan.nextStartMode || 'PAUSE').toUpperCase();
    const currentEndMode = String(transitionPlan.currentEndMode || '').toUpperCase();
    const transitionSource = transitionPlan.transitionSource || 'auto';
    const isManual = transitionSource === 'manual';
    const currentFtbActive = !!transitionPlan.currentFtbActive;
    const nextMediaKind = transitionPlan.nextMediaKind ||
        (transitionPlan.nextIsAudio ? 'audioOnly' : (transitionPlan.nextIsUvc ? 'uvc' : 'video'));

    // 音声のみ遷移
    if (nextMediaKind === 'audioOnly') {
        return {
            bridgeMode: 'NONE',
            transitionSource: isManual ? 'manual' : 'auto'
        };
    }

    // リセット不要
    if (!transitionPlan.shouldResetCurrentOnAir) {
        return {
            bridgeMode: 'NONE',
            transitionSource: isManual ? 'manual' : 'auto'
        };
    }

    // manual遷移
    if (isManual) {
        if (currentFtbActive) {
            return {
                bridgeMode: 'BLACK',
                transitionSource: 'manual'
            };
        }

        if (nextStartMode === 'PAUSE') {
            return {
                bridgeMode: 'OVERLAY',
                transitionSource: 'manual'
            };
        }

        if (nextStartMode === 'FADEIN') {
            return {
                bridgeMode: 'BLACK',
                transitionSource: 'manual'
            };
        }

        if (nextStartMode === 'PLAY') {
            return {
                bridgeMode: 'OVERLAY',
                transitionSource: 'manual'
            };
        }

        return {
            bridgeMode: null,
            transitionSource: 'manual'
        };
    }

    // auto + OFF
    if (currentEndMode === 'OFF') {
        return {
            bridgeMode: 'BLACK',
            transitionSource: 'auto'
        };
    }

    // auto + FTB中
    if (currentFtbActive) {
        return {
            bridgeMode: 'BLACK',
            transitionSource: 'auto'
        };
    }

    // auto + FADEIN開始
    if (nextStartMode === 'FADEIN') {
        return {
            bridgeMode: 'BLACK',
            transitionSource: 'auto'
        };
    }

    // auto + 連続遷移
    if (currentEndMode === 'REPEAT' || currentEndMode === 'NEXT' || currentEndMode === 'GOTO') {
        if (nextStartMode === 'PLAY' || nextStartMode === 'PAUSE') {
            return {
                bridgeMode: 'OVERLAY',
                transitionSource: 'auto'
            };
        }

        return {
            bridgeMode: 'NONE',
            transitionSource: 'auto'
        };
    }

    // auto + PAUSE開始
    if (nextStartMode === 'PAUSE') {
        return {
            bridgeMode: 'NONE',
            transitionSource: 'auto'
        };
    }

    // 判定なし
    return {
        bridgeMode: null,
        transitionSource: 'auto'
    };
}

// オンエア開始情報受信
window.electronAPI.onReceiveOnAirData((itemId) => {
    logDebug(`[onair.js] Received On-Air data for item ID: ${itemId}`);

    // Off-Air 状態解除
    isOffAir = false;

    // Off-Air判定
    if (!itemId) {
        logDebug('[onair.js] Received empty On-Air data (no next item). Triggering Off-Air.');
        onairHandleOffAirButton();
        return;
    }

    // 状態情報取得
    const itemData = onairGetStateData(itemId);
    if (!itemData) {
        logDebug(`[onair.js] No valid state data found for item ID: ${itemId}`);
        return;
    }

    // 遷移計画生成
    const transitionPlan = onairBuildTransitionPlan(itemId, itemData);
    onairPendingTransitionSource = null;
    onairPendingCurrentEndMode = null;

    // ブリッジ判定反映
    const bridgeDecision = onairResolveBridgeMode(transitionPlan);

    transitionPlan.bridgeMode = bridgeDecision.bridgeMode;
    transitionPlan.transitionSource = bridgeDecision.transitionSource;
    transitionPlan.shouldPrepareOverlayBeforeReset =
        !!transitionPlan.shouldResetCurrentOnAir &&
        transitionPlan.bridgeMode === 'OVERLAY';
    itemData.transitionSource = transitionPlan.transitionSource;

    // リセット判定
    if (transitionPlan.sameUvcItem) {
        logDebug('[onair.js] Same UVC itemId received while already on-air. Skipping reset/reload to prevent device disconnect.');
        return;
    }

    // リセット実行
    if (transitionPlan.shouldResetCurrentOnAir) {
        try {
            if (transitionPlan.shouldPrepareOverlayBeforeReset) {
                captureLastFrameAndHoldUntilNextReadyOnAir(true);
                logInfo('[onair.js] (onReceiveOnAirData) overlay prepared before reset/source swap.');
            } else {
                logInfo(`[onair.js] (onReceiveOnAirData) overlay skipped. bridgeMode=${transitionPlan.bridgeMode || 'null'}`);
            }
        } catch (_) {}

        logDebug('[onair.js] An item is currently on-air. Resetting before loading the new one.');
        onairReset();
    }

    // 音声のみ遷移時の後処理
    if (transitionPlan.nextIsAudio) {
        onairCancelSeamlessOverlay('next-is-audio');
    }

    // nowonairフラグ管理
    onairNowOnAir = true;

    // フルスクリーン送信前の明示クリア
    if (transitionPlan.shouldResetCurrentOnAir) {
        window.electronAPI.sendControlToFullscreen({ command: 'clear-current-source' });
    }

    // フルスクリーン送信
    onairSendToFullscreen(itemData, transitionPlan);

    // UI更新
    onairUpdateUI(itemData);

    // 再生開始
    onairStartPlayback(itemData);
});

// ----------------------------------
// オンエアエリアリセット
// ----------------------------------
function onairReset() {
    const elements = onairGetElements();
    try {
        if (elements.onairVideoElement) {
            elements.onairVideoElement.style.visibility = 'visible';
            elements.onairVideoElement.style.opacity = '1';
        }
    } catch (_) {
        // ignore
    }

    logInfo(
        `[onair.js] onairReset start: currentPath="${onairCurrentState?.path || ''}", currentName="${onairCurrentState?.name || ''}", mainFadeOut=${fadeOutInProgressMain}, mainFadeIn=${fadeInInProgressMain}, itemFadeOut=${fadeOutInProgressItem}, itemFadeIn=${fadeInInProgressItem}, ftbHold=${onairFtbToggleHoldActive}, masterBase=${onairMasterBaseVolume}, masterVisual=${onairMasterVolume}, keepPlaying=${onairFtbToggleShouldKeepPlaying}`
    );

    // 前アイテム状態クリア
    onairCurrentState = null;

    // ビデオ初期化
    onairInitializeVideo(elements);
    onairStopUVCStream(elements);

    // UI初期化
    onairInitializeButtons(elements);
    onairInitializeVolumeMeter(elements);
    onairInitializeSeekBar(elements);
    onairInitializeStatusDisplays(elements);
    onairInitializeFadeCanvas(elements);

    // 音量スライダー初期化
    onairSuppressFullscreenVolumeSync = true;
    try {
        onairInitializeVolumeSlider(elements);
    } finally {
        onairSuppressFullscreenVolumeSync = false;
    }

    // 状態フラグリセット
    onairNowOnAir = false;
    onairIsPlaying = false;

    // 再生速度コントローラー同期
    const speedSlider = document.getElementById('playback-speed-slider');
    const speedInput = document.getElementById('playback-speed-input');
    const video = document.getElementById('on-air-video');

    // グローバル変数リセット
    isPlaybackSpeedDragging = false;
    if (playbackSpeedAnimationFrame) {
        cancelAnimationFrame(playbackSpeedAnimationFrame);
        playbackSpeedAnimationFrame = null;
    }

    if (isPlaybackSpeedFixed) {
        // 固定モード
        if (speedSlider) {
            speedSlider.value = "0"; 
            speedSlider.disabled = true;
        }
        if (speedInput) {
            speedInput.value = "1.00";
            speedInput.disabled = true;
        }
        if (video) {
            video.playbackRate = 1.00;
        }
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: 1.00
        });
        // 固定モード解除
        isPlaybackSpeedFixed = false;
    } else {
        // スライダー操作
        if (speedSlider) {
            speedSlider.disabled = false;
            const sRaw = parseFloat(speedSlider.value);
            const s = isNaN(sRaw) ? 0 : Math.max(-10, Math.min(10, sRaw));
            let newRate = Math.pow(5, s / 10);
            if (Math.abs(newRate - 1.0) < 0.02) {
                newRate = 1.0;
            }
            const step = 0.5;
            newRate = Math.max(0.5, Math.min(3.0, Math.round(newRate / step) * step));
            if (video) {
                video.playbackRate = newRate;
            }
            window.electronAPI.sendControlToFullscreen({
                command: 'set-playback-speed',
                value: newRate
            });
        }
        if (speedInput) {
            speedInput.disabled = false;
            if (video) {
                speedInput.value = video.playbackRate.toFixed(2);
            }
        }
    }

    // フェード処理中断
    stopFade();

    // FTBタイマーキャンセル
    if (ftbMainTimeout) {
        clearTimeout(ftbMainTimeout);
        ftbMainTimeout = null;
    }
    if (ftbOffAirTimeout) {
        clearTimeout(ftbOffAirTimeout);
        ftbOffAirTimeout = null;
    }

    // 残り時間タイマーリセット
    onairResetRemainingTimer(elements);

    // リソース解放
    onairReleaseResources(elements);

    // FTBボタン表示はトグル保持状態に合わせる
    onairSetFtbButtonRecordingBlink(!!onairFtbToggleHoldActive);

    logDebug('[onair.js] On-Air area reset completed.');
}

// ----------------------------------
// アイテム状態情報取得
// ----------------------------------

// 状態情報取得
function onairGetStateData(itemId) {
    const playlist = stateControl.getPlaylistState();
    if (!playlist || !Array.isArray(playlist)) {
        logInfo('[onair.js] Invalid playlist state.');
        return null;
    }

    const itemData = playlist.find(item => item.playlistItem_id === itemId);
    if (!itemData) {
        logInfo(`[onair.js] No data found for item ID: ${itemId}`);
        return null;
    }

    const prevState = onairCurrentState;

    // REPEAT設定の取り込み
    let repeatCount;
    if (itemData.repeatCount !== undefined && itemData.repeatCount !== null) {
        const parsed = parseInt(itemData.repeatCount, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            repeatCount = parsed;
        }
    }

    let repeatEndMode;
    if (itemData.repeatEndMode === 'PAUSE' || itemData.repeatEndMode === 'OFF' || itemData.repeatEndMode === 'NEXT') {
        repeatEndMode = itemData.repeatEndMode;
    }

    let repeatRemaining;
    if (typeof repeatCount === 'number') {
        const prevRemaining = (prevState && prevState.itemId === itemId) ? prevState.repeatRemaining : undefined;
        if (typeof prevRemaining === 'number' && prevRemaining >= 0) {
            repeatRemaining = prevRemaining;
        } else {
            repeatRemaining = repeatCount;
        }
    }

    // データ型調整のみ行い、この時点では onairCurrentState を上書きしない
    const normalizedItemData = {
        itemId: itemId,
        path: itemData.path || '',
        name: itemData.name || (itemData.path ? itemData.path.split('/').pop() : 'Unknown'),
        deviceId: itemData.deviceId || null,
        inPoint: onairParseTimeToSeconds(itemData.inPoint || '00:00:00:00'),
        outPoint: onairParseTimeToSeconds(itemData.outPoint || '00:00:00:00'),
        startMode: itemData.startMode || 'PAUSE',
        endMode: itemData.endMode || 'PAUSE',
        transitionSource: itemData.transitionSource || 'auto',
        defaultVolume: itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100,
        ftbEnabled: !!itemData.ftbEnabled,
        ftbRate: parseFloat(itemData.ftbRate || 1.0),
        startFadeInSec: (itemData.startFadeInSec !== undefined && !isNaN(parseFloat(itemData.startFadeInSec)))
            ? parseFloat(itemData.startFadeInSec) : undefined,
        fillKeyMode: typeof itemData.fillKeyMode !== 'undefined' ? itemData.fillKeyMode : false,
        repeatCount: repeatCount,
        repeatEndMode: repeatEndMode,
        repeatRemaining: repeatRemaining,
        repeatPlayedCount: (typeof repeatCount === 'number' && typeof repeatRemaining === 'number')
            ? Math.max(0, repeatCount - repeatRemaining)
            : undefined
    };

    logDebug('[onair.js] State data updated:', normalizedItemData);
    return normalizedItemData;
}

// ---------------------------
// フルスクリーンデータ送信
// ---------------------------
async function onairSendToFullscreen(itemData, transitionPlan = null) {
    if (!itemData) {
        logDebug('[onair.js] No item data available to send to fullscreen.');
        return;
    }
    try {
        // 新規アイテムは規定音量を使用
        const itemVal = itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100;

        // 送出時は表示途中値ではなく保持値を使う
        let masterVal;
        const baseVal = (onairMasterBaseVolume !== undefined && onairMasterBaseVolume !== null && !isNaN(Number(onairMasterBaseVolume)))
            ? Number(onairMasterBaseVolume)
            : 100;

        if (onairFtbToggleHoldActive) {
            masterVal = 0;
        } else {
            masterVal = baseVal;
        }

        masterVal = Math.max(0, Math.min(100, Number(masterVal) || 0));

        const combinedVolume = (itemVal / 100) * (masterVal / 100);
        const finalVolume = Math.pow(combinedVolume, 2.2);
        const fullscreenInitialVolume = onairFtbToggleHoldActive ? 0 : finalVolume;
        const fullscreenStartMode = onairResolveIncomingStartMode(itemData);

        const fullscreenData = {
            playlistItem_id: itemData.playlistItem_id,
            deviceId: itemData.deviceId || null,
            path: itemData.path || '',
            startMode: fullscreenStartMode,
            endMode: itemData.endMode || 'PAUSE',
            volume: fullscreenInitialVolume,
            inPoint: itemData.inPoint,
            outPoint: itemData.outPoint,
            ftbRate: itemData.ftbRate,
            startFadeInSec: itemData.startFadeInSec,
            fillKeyMode: itemData.fillKeyMode,
            ftbEnabled: !!itemData.ftbEnabled,
            transitionPlan: transitionPlan ? {
                itemId: transitionPlan.itemId,
                currentPath: transitionPlan.currentPath,
                currentEndMode: transitionPlan.currentEndMode,
                currentIsUvc: transitionPlan.currentIsUvc,
                currentFtbActive: transitionPlan.currentFtbActive,
                nextPath: transitionPlan.nextPath,
                nextStartMode: transitionPlan.nextStartMode,
                nextEndMode: transitionPlan.nextEndMode,
                nextIsUvc: transitionPlan.nextIsUvc,
                nextIsAudio: transitionPlan.nextIsAudio,
                nextMediaKind: transitionPlan.nextMediaKind,
                sameUvcItem: transitionPlan.sameUvcItem,
                shouldPrepareOverlayBeforeReset: transitionPlan.shouldPrepareOverlayBeforeReset,
                shouldResetCurrentOnAir: transitionPlan.shouldResetCurrentOnAir,
                bridgeMode: transitionPlan.bridgeMode,
                transitionSource: transitionPlan.transitionSource
            } : null
        };

        logInfo(
            `[onair.js] SendToFullscreen: name="${itemData.name || ''}", path="${itemData.path || ''}", startMode=${fullscreenStartMode}, endMode=${itemData.endMode || 'PAUSE'}, itemDefault=${itemVal}%, masterBase=${baseVal}%, masterSend=${masterVal}%, combinedLinear=${combinedVolume.toFixed(4)}, finalGamma=${fullscreenInitialVolume.toFixed(4)}, ftbHold=${onairFtbToggleHoldActive}, mainFadeOut=${fadeOutInProgressMain}, mainFadeIn=${fadeInInProgressMain}, itemFadeOut=${fadeOutInProgressItem}, itemFadeIn=${fadeInInProgressItem}`
        );

        logDebug('[onair.js] Sending video data to fullscreen:', fullscreenData);
        window.electronAPI.sendToFullscreenViaMain(fullscreenData);

        if (onairFtbToggleHoldActive) {
            const fillKeyColorPicker = document.getElementById('fillkey-color-picker');
            const ftbFillKeyColor = !!isFillKeyMode
                ? ((fillKeyColorPicker && fillKeyColorPicker.value) ? fillKeyColorPicker.value : "#00FF00")
                : "";

            window.electronAPI.sendControlToFullscreen({
                command: 'ftb-toggle-hold',
                value: {
                    active: true,
                    duration: 0,
                    fillKeyMode: !!isFillKeyMode,
                    fillKeyColor: ftbFillKeyColor,
                    keepPlaying: !!onairFtbToggleShouldKeepPlaying,
                    audioTargetLinear: 0
                }
            });
        }
    } catch (error) {
        logDebug('[onair.js] Error while sending video data to fullscreen:', error);
    }
}

// ---------------------------
// 動画プレーヤーセットアップ
// ---------------------------
function onairSetupPlayer(itemData) {
    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found in On-Air area.');
        return;
    }

	// マウスホイール／キー操作バインド
    setupMouseWheelControl(onairVideoElement);
    
    // FILLKEYモード状態反映
    updateFillKeyModeState();

    // UVCデバイス判定
    if (onairIsUvcItemData(itemData)) {
        const uvcDeviceId = onairGetUvcDeviceId(itemData);

        if (!uvcDeviceId) {
            logInfo('[onair.js] UVC item detected but deviceId could not be resolved.');
            return;
        }

        logInfo(`[onair.js] Setting up UVC stream for device ID: ${uvcDeviceId}`);
        onairSetupUVCStream(onairVideoElement, uvcDeviceId)
            .then(() => {
                // UVC再生開始後フェードイン
                onairFadeFromBlack(0.3);
            })
            .catch(error => {
                logInfo(`[onair.js] UVC stream setup failed: ${error.message}`);
            });
        return;
    }

    // 動画ファイル処理
    if (itemData.path) {
        logInfo(`[onair.js] Setting up video file: ${itemData.path}`);
        onairSetupVideoFile(onairVideoElement, itemData.path);
        return;
    }

    // データ不正
    logInfo('[onair.js] Invalid On-Air item data: Missing path or deviceId.');
}

// 動画ファイルセットアップ
function onairSetupVideoFile(onairVideoElement, path) {
    onairVideoElement.pause();
    if (typeof path === 'string' && path.startsWith("UVC_DEVICE")) {
        try {
            onairVideoElement.removeAttribute('src');
            onairVideoElement.src = '';
            onairVideoElement.load();
        } catch (_e) {}
        logDebug(`[onair.js] UVC path detected. Skipping file setup: ${path}`);
        return;
    }

    // URL変換
    if (typeof path === 'string' && !path.startsWith("UVC_DEVICE")) {
        onairVideoElement.src = getSafeFileURL(path);
    } else {
        onairVideoElement.src = path;
    }
    // IN点シーク
    onairVideoElement.addEventListener('loadedmetadata', function onMetadata() {
        if (onairCurrentState && onairCurrentState.inPoint > 0) {
            onairVideoElement.currentTime = onairCurrentState.inPoint;
            logDebug(`[onair.js] Video metadata loaded. Seeking immediately to IN point: ${onairCurrentState.inPoint}s`);
        }
        onairVideoElement.removeEventListener('loadedmetadata', onMetadata);
    });

    onairVideoElement.load();
    logDebug(`[onair.js] Video file set: ${path}`);
}

// UVCデバイスセットアップ
async function onairSetupUVCStream(onairVideoElement, deviceId) {
    try {
        const elements = onairGetElements();

        // 既存ストリーム停止
        if (onairVideoElement.srcObject) {
            onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        }

        // 一時ストリーム取得
        const tempStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });
        const capabilities = tempStream.getVideoTracks()[0].getCapabilities();
        const widthIdeal = (capabilities.width && capabilities.width.max) ? capabilities.width.max : 1280;
        const heightIdeal = (capabilities.height && capabilities.height.max) ? capabilities.height.max : 720;

        // 一時ストリーム停止
        tempStream.getTracks().forEach(track => track.stop());

        // Device Settings から UVC 用の音声デバイス紐付けを取得
        let audioConstraints = false;
        try {
            const deviceSettings = await window.electronAPI.getDeviceSettings();
            const bindings = deviceSettings?.uvcAudioBindings || {};
            const boundAudioDeviceId = bindings[deviceId];

            if (boundAudioDeviceId) {
                audioConstraints = {
                    deviceId: { exact: boundAudioDeviceId }
                };
                logDebug(`[onair.js] UVC audio binding found for video device ${deviceId}: audio device ${boundAudioDeviceId}`);
            } else {
                logDebug(`[onair.js] No UVC audio binding for video device ${deviceId}. Using video-only.`);
            }
        } catch (e) {
            logDebug('[onair.js] Failed to load UVC audio binding from device settings:', e);
            audioConstraints = false;
        }

        // 再度、カメラネイティブ解像度を理想値として指定してストリーム取得
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                width: { ideal: widthIdeal },
                height: { ideal: heightIdeal },
                frameRate: { ideal: 30 }
            },
            audio: audioConstraints
        });

        // 再生開始
        onairVideoElement.srcObject = stream;
        onairVideoElement.autoplay = true;
        onairVideoElement.playsInline = true;
        await onairVideoElement.play();

        // 設定取得
        const settings = stream.getVideoTracks()[0].getSettings();
        logDebug(`[onair.js] UVC stream set for device ID: ${deviceId} with native resolution ${settings.width}x${settings.height}, frameRate: ${settings.frameRate}`);

        // 再生ボタン
        const { onairPlayButton, onairPauseButton } = elements;
        if (onairPlayButton && onairPauseButton) {
            onairPlayButton.classList.add('important-button-orange');
            onairPlayButton.classList.remove('important-button-gray');
            onairPauseButton.classList.add('important-button-gray');
            onairPauseButton.classList.remove('important-button-blue');
        }

        // 残り時間タイマー開始
        onairStartRemainingTimer(elements, onairCurrentState);

        logDebug(`[onair.js] UVC stream successfully set for device ID: ${deviceId}`);
    } catch (error) {
        logInfo(`[onair.js] Failed to start UVC stream for device ID: ${deviceId}: ${error.message}`);
        showMessage(`${getMessage('failed-to-start-uvc-stream')} ${error.message}`, 5000, 'error');

        // ストリーム失敗時
        onairReset();
    }
}

// -----------------------
// UI更新
// -----------------------

// UI更新
function onairUpdateUI(itemData) {
    const elements = onairGetElements();
    const isUvcItem = onairIsUvcItemData(itemData);

    // 再生ボタン状態更新
    if (!isUvcItem) {
        onairUpdatePlayPauseButtons(elements);
    } else {
        logDebug('[onair.js] Skipping play/pause button update for UVC device.');
    }

    // シークバー更新
    onairUpdateSeekBar(elements, itemData);

    // ファイル名表示更新
    if (elements.onairFileNameDisplay) {
        elements.onairFileNameDisplay.textContent = itemData.name || 'No file loaded';
    }

    // エンドモード表示更新
    if (elements.onairEndModeDisplay) {
        if (itemData.endMode) {
            onairCurrentState = itemData;
            updateEndModeDisplayLabel();
        } else {
            elements.onairEndModeDisplay.textContent = 'ENDMODE';
        }
    }

    // 音量スライダーと音量表示更新
    if (elements.onairItemVolumeSlider && elements.onairItemVolumeValueDisplay) {
        elements.onairItemVolumeSlider.value = itemData.defaultVolume;
        elements.onairItemVolumeValueDisplay.textContent = `${itemData.defaultVolume}%`;
        elements.onairItemVolumeSlider.style.setProperty('--value', `${elements.onairItemVolumeSlider.value}%`);
    }

    // イン点・アウト点表示更新
    if (elements.onairInPointDisplay) {
        elements.onairInPointDisplay.textContent = onairFormatTime(itemData.inPoint);
    }
    if (elements.onairOutPointDisplay) {
        elements.onairOutPointDisplay.textContent = onairFormatTime(itemData.outPoint);
    }

    // 残り時間タイマー更新
    onairUpdateRemainingTime(elements, itemData);

    logDebug('[onair.js] UI updated with the latest item data.');
}

// 残り時間タイマー更新
function onairUpdateRemainingTime(elements, itemData) {
    const { onairVideoElement, onairRemainTimeDisplay } = elements;

    if (!onairVideoElement || !onairRemainTimeDisplay) return;

    // UVCの場合
    if (onairIsUvcItemData(itemData)) {
        onairRemainTimeDisplay.textContent = 'LIVE';
        onairRemainTimeDisplay.style.color = 'green';
        return;
    }

    // 高速再生時
    const rate = onairVideoElement.playbackRate || 1;
    if (rate >= 2) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (onairHighSpeedRemainLastUpdate && (now - onairHighSpeedRemainLastUpdate) < 200) {
            return;
        }
        onairHighSpeedRemainLastUpdate = now;
    }

    // 実時間ベース残り時間
    const rawRemaining = Math.max(0, itemData.outPoint - onairVideoElement.currentTime);
    const remainingTime = rawRemaining / rate;

    onairRemainTimeDisplay.textContent = onairFormatTime(remainingTime);

    // 残り時間減少警告
    if (remainingTime < 5) {
        onairRemainTimeDisplay.style.color = 'red';
    } else {
        onairRemainTimeDisplay.style.color = 'orange';
    }
}

// 再生・一時停止ボタン更新
function onairUpdatePlayPauseButtons(elements) {
    const { onairPlayButton, onairPauseButton } = elements;
    if (!onairPlayButton || !onairPauseButton) return;

    if (onairIsPlaying) {
        onairPlayButton.classList.add('important-button-orange');
        onairPlayButton.classList.remove('important-button-gray');
        onairPauseButton.classList.add('important-button-gray');
        onairPauseButton.classList.remove('important-button-blue');
    } else {
        onairPlayButton.classList.add('important-button-gray');
        onairPlayButton.classList.remove('important-button-orange');
        onairPauseButton.classList.add('important-button-blue');
        onairPauseButton.classList.remove('important-button-gray');
    }
}

// シークバー更新
function onairUpdateSeekBar(elements, itemData) {
    const { onairVideoElement, onairProgressSlider, onairStartTimeDisplay, onairEndTimeDisplay } = elements;
    if (!onairVideoElement || !onairProgressSlider || !onairStartTimeDisplay || !onairEndTimeDisplay) return;

    const inMarker = document.getElementById('on-air-in-marker');
    const outMarker = document.getElementById('on-air-out-marker');

    // 動画ファイルパス不正な場合
    if (!itemData.path || itemData.path.trim() === "" || !onairVideoElement.src || onairVideoElement.src.trim() === "") {
        if (inMarker) inMarker.style.display = "none";
        if (outMarker) outMarker.style.display = "none";
        return;
    }

    // UVCデバイスの場合
    if (onairIsUvcItemData(itemData)) {
        logDebug('[onair.js] Seek bar update for UVC device.');
        onairProgressSlider.value = 0;
        onairProgressSlider.disabled = true;
        onairStartTimeDisplay.textContent = 'LIVE';
        onairEndTimeDisplay.textContent = 'UVC';
        return;
    }

    onairProgressSlider.disabled = false;

    // メタデータが読み込まれない場合
    if (onairVideoElement.readyState < 1) {
        if (inMarker) inMarker.style.display = "none";
        if (outMarker) outMarker.style.display = "none";
        logDebug('[onair.js] Video metadata not loaded. Hiding markers.');
        return;
    }

    const duration = onairVideoElement.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
        if (inMarker) inMarker.style.display = "none";
        if (outMarker) outMarker.style.display = "none";
        logDebug('[onair.js] Invalid duration. Hiding markers.');
        return;
    }

    // 正常な動画ロード
    if (inMarker) inMarker.style.display = "block";
    if (outMarker) outMarker.style.display = "block";

    const currentTime = onairVideoElement.currentTime || 0;
    onairProgressSlider.value = currentTime;
    onairProgressSlider.max = duration.toFixed(2);
    onairStartTimeDisplay.textContent = onairFormatTime(currentTime);
    onairEndTimeDisplay.textContent = onairFormatTime(duration);

    // マーカー位置更新
    updateSeekBarMarkers(elements, onairCurrentState.inPoint, onairCurrentState.outPoint);
}

// IN/OUTマーカー位置更新関数
function updateSeekBarMarkers(elements, inPoint, outPoint) {
    const slider = elements.onairProgressSlider;
    if (!slider) return;
    const duration = parseFloat(slider.max);
    if (!duration || duration <= 0) return;

    // スライダー要素取得
    const sliderRect = slider.getBoundingClientRect();
    const containerRect = slider.parentElement.getBoundingClientRect();
    const sliderWidth = sliderRect.width;
    const sliderLeftOffset = sliderRect.left - containerRect.left;

    const inPositionRatio = inPoint / duration;
    const outPositionRatio = outPoint / duration;
    const inLeft = sliderLeftOffset + (inPositionRatio * sliderWidth);
    const outLeft = sliderLeftOffset + (outPositionRatio * sliderWidth);

    const inMarker = document.getElementById('on-air-in-marker');
    const outMarker = document.getElementById('on-air-out-marker');
    if (!inMarker || !outMarker) return;
    inMarker.style.left = `${inLeft - 0}px`;
    outMarker.style.left = `${outLeft - 6}px`;
}

// -----------------------
// 再生プロセス
// -----------------------
function onairStartPlayback(itemData) {
    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found.');
        return;
    }
    try {
        onairVideoElement.style.visibility = 'visible';
        onairVideoElement.style.opacity = '1';
    } catch (_) {
        // ignore
    }

    const sameItem =
        !!onairCurrentState &&
        !!itemData &&
        (
            (onairCurrentState.itemId === itemData.itemId) ||
            (onairCurrentState.itemId === itemData.playlistItem_id)
        );

    const sameItemAutoReplay =
        sameItem &&
        String(itemData?.transitionSource || '').toLowerCase() === 'auto';

    // 倍速ボタン初期化
    if (!sameItemAutoReplay) {
        try { if (typeof window.onairResetSpeedTo1x === 'function') window.onairResetSpeedTo1x(); } catch (_) {}
        try { if (typeof window.onairSetSpeedButtonsEnabled === 'function') window.onairSetSpeedButtonsEnabled(true); } catch (_) {}

        // REPEAT指定回数のカウンタ初期化
        try {
            const endModeUpper = String(itemData?.endMode || '').toUpperCase();

            let repeatCount;
            if (itemData && itemData.repeatCount !== undefined && itemData.repeatCount !== null) {
                const parsed = parseInt(itemData.repeatCount, 10);
                if (!isNaN(parsed) && parsed >= 1) {
                    repeatCount = parsed;
                }
            }

            if (endModeUpper === 'REPEAT' && typeof repeatCount === 'number') {
                itemData.repeatCount = repeatCount;
                itemData.repeatRemaining = repeatCount;
                itemData.repeatPlayedCount = 0;

                if (sameItem) {
                    onairCurrentState.repeatCount = repeatCount;
                    onairCurrentState.repeatRemaining = repeatCount;
                    onairCurrentState.repeatPlayedCount = 0;
                }
            } else {
                itemData.repeatRemaining = undefined;
                itemData.repeatPlayedCount = undefined;

                if (sameItem) {
                    onairCurrentState.repeatRemaining = undefined;
                    onairCurrentState.repeatPlayedCount = undefined;
                }
            }
        } catch (_) {}
    }

    // 直前FTB黒
    try {
        const elsFTB = onairGetElements();
        const canvas = elsFTB?.onairFadeCanvas;
        if (canvas) {
            canvas.style.opacity = 0;
            canvas.style.visibility = 'hidden';
        }
    } catch (_) {}

    // 既存監視停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
        onairPlaybackMonitor = null;
        logDebug('[onair.js] Existing playback monitor cleared.');
    }

    // 再生状態定義
    onairIsPlaying = false;

    // UVC処理振分
    if (itemData.deviceId) {
        // UVC
        logInfo('[onair.js] Starting UVC stream.');

        // 他遷移影響クリア
        onairCancelSeamlessOverlay('before-start-UVC');

        // FADEIN(秒数>0)
        const startModeUpper = String(itemData?.startMode || 'PAUSE').toUpperCase();
        const fadeInSec = Number(itemData?.startFadeInSec || 0);
        const useBlackOverlay = (startModeUpper === 'FADEIN' && fadeInSec > 0);

        onairOverlayForceBlack = useBlackOverlay;
        onairPendingUvcFadeInSec = useBlackOverlay ? fadeInSec : 0;
        onairSuppressFadeUntilPlaying = useBlackOverlay;

        let uvcMaxWaitTimer = null;

        // UVC用黒オーバーレイ準備
        if (useBlackOverlay) {
            const overlayCanvas = initializeOverlayCanvasOnAir();
            if (overlayCanvas) {
                const els = onairGetElements();
                const videoEl = els?.onairVideoElement;
                if (videoEl) {
                    adjustFadeCanvasSize(videoEl, overlayCanvas);
                    overlayCanvas.width  = overlayCanvas.clientWidth;
                    overlayCanvas.height = overlayCanvas.clientHeight;
                }
                const ctx = overlayCanvas.getContext('2d');
                ctx.save();
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                ctx.restore();
                overlayCanvas.style.visibility = 'visible';
                overlayCanvas.style.opacity = 1;

                // 解除処理
                const clearBlackOverlaySmooth = () => {
                    try {
                        const oc = document.getElementById('onair-overlay-canvas');
                        if (!oc) return;
                        const duration = onairPendingUvcFadeInSec || 0.05;
                        const start = performance.now();
                        const step = (now) => {
                            const t = Math.min(1, (now - start) / (duration * 1000));
                            oc.style.opacity = String(1 - t);
                            if (t < 1) {
                                requestAnimationFrame(step);
                            } else {
                                oc.style.visibility = 'hidden';
                                try { oc.getContext('2d').clearRect(0, 0, oc.width, oc.height); } catch (_) {}
                                onairOverlayForceBlack = false;
                                onairSuppressFadeUntilPlaying = false;
                                onairPendingUvcFadeInSec = 0;
                            }
                        };
                        requestAnimationFrame(step);
                    } catch (_) {
                        onairCancelSeamlessOverlay('fallback-clear');
                    }
                };

                const handleEarlyReady = () => {
                    clearBlackOverlaySmooth();

                    // fullscreen側黒保持解除（UVC+FADEIN）
                    try {
                        window.electronAPI.sendControlToFullscreen({
                            command: 'fade-from-black',
                            value: { duration: fadeInSec, fillKeyMode: isFillKeyMode }
                        });
                    } catch (_) {}
                };
                onairVideoElement.addEventListener('playing',        handleEarlyReady, { once: true });
                onairVideoElement.addEventListener('loadeddata',     handleEarlyReady, { once: true });
                onairVideoElement.addEventListener('loadedmetadata', handleEarlyReady, { once: true });

                // デバイス遅延吸収
                uvcMaxWaitTimer = setTimeout(() => {
                    logInfo('[onair.js] UVC early-timeout: clearing black overlay as a safety.');
                    clearBlackOverlaySmooth();
                }, 30);

                const cleanup = () => {
                    if (uvcMaxWaitTimer) {
                        clearTimeout(uvcMaxWaitTimer);
                        uvcMaxWaitTimer = null;
                    }
                    onairVideoElement.removeEventListener('playing',        handleEarlyReady);
                    onairVideoElement.removeEventListener('loadeddata',     handleEarlyReady);
                    onairVideoElement.removeEventListener('loadedmetadata', handleEarlyReady);
                };
                onairVideoElement.addEventListener('playing',        cleanup, { once: true });
                onairVideoElement.addEventListener('loadeddata',     cleanup, { once: true });
                onairVideoElement.addEventListener('loadedmetadata', cleanup, { once: true });
            }
        } else {
            // 黒オーバーレイは使わない
            onairOverlayForceBlack = false;
            onairSuppressFadeUntilPlaying = false;
            onairPendingUvcFadeInSec = 0;
        }

        // UVC再生開始
        onairSetupUVCStream(onairVideoElement, itemData.deviceId);

        return;
    }

    if (itemData.path) {
        logInfo('[onair.js] Starting video playback.');
        onairSetupVideoFile(onairVideoElement, itemData.path);
        // 再生速度コントローラー適用
        const currentSpeed = parseFloat(document.getElementById('playback-speed-input').value) || 1.00;
        onairVideoElement.playbackRate = currentSpeed;
        logDebug(`[onair.js] Applied playback speed: ${currentSpeed}`);
        // フルスクリーン側に再生速度送信
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: currentSpeed
        });
    }

    // IN点とOUT点取得
    const inPoint = itemData.inPoint || 0;
    const outPoint = itemData.outPoint || onairVideoElement.duration;

    // IN点シーク
    onairSeekToInPoint(onairVideoElement, inPoint);

    // 進行中FADE状態リセット
    if (typeof stopItemFade === 'function') {
        try { stopItemFade(); } catch (_) {}
    }

    // 規定音量算出
    const targetVolPct = (typeof itemData.defaultVolume === 'number') ? itemData.defaultVolume : 100;

    const applySliderValue = (pct) => {
        const itemSlider = document.getElementById('on-air-item-volume-slider');
        if (!itemSlider) return;
        itemSlider.value = String(pct);
        const valEl = document.getElementById('on-air-item-volume-value');
        if (valEl) valEl.textContent = `${pct}%`;
        itemSlider.style.setProperty('--value', `${pct}%`);

        try { itemSlider.dispatchEvent(new Event('input')); } catch (_) {}
    };

    // スタートモード処理分岐
    if (itemData.startMode === 'PLAY') {
        // PLAY
        onairVideoElement.volume = targetVolPct / 100;
        applySliderValue(targetVolPct);

        onairIsPlaying = true;
        onairVideoElement.play()
            .then(() => {
                onairRepeatFlag = false;
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData);
                logOpe('[onair.js] Playback started via PLAY start mode.');
            })
            .catch(error => {
                onairIsPlaying = false;
                logInfo(`[onair.js] Playback failed: ${error.message}`);
                onairUpdatePlayPauseButtons(elements);
            });
    } else if (itemData.startMode === 'FADEIN') {
        // FADEIN開始
        onairVideoElement.volume = 0;
        applySliderValue(0);

        let fadeDuration = (itemData.startFadeInSec !== undefined && !isNaN(parseFloat(itemData.startFadeInSec))) ? parseFloat(itemData.startFadeInSec) : (itemData.ftbRate || 1.0);
        const totalSpan = Math.max(0, (itemData.outPoint || 0) - (itemData.inPoint || 0));
        const maxFade = Math.max(0.05, totalSpan - 0.1);
        fadeDuration = Math.min(fadeDuration, maxFade);

        // フェードイン前黒オーバーレイ準備
        try {
            const elsFTB = onairGetElements();
            const canvas = elsFTB?.onairFadeCanvas;
            if (canvas) {
                const selectedColor = isFillKeyMode ? (document.getElementById('fillkey-color-picker')?.value || "#00FF00") : "black";
                canvas.style.backgroundColor = selectedColor;
                canvas.style.visibility = 'visible';
                canvas.style.opacity = 1;
            }
        } catch (_) {}

        onairIsPlaying = true;
        onairVideoElement.play()
            .then(() => {
                // 映像フェードイン処理
                onairFadeFromBlack(fadeDuration);

                // 音声フェードイン処理
                audioFadeInItem(fadeDuration);
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData);
                logOpe('[onair.js] Playback started via FADEIN start mode with fade in effect.');
            })
            .catch(error => {
                onairIsPlaying = false;
                logInfo(`[onair.js] Playback failed: ${error.message}`);
                onairUpdatePlayPauseButtons(elements);
            });

    } else {

        // PAUSE
        onairVideoElement.pause();
        onairVideoElement.volume = targetVolPct / 100;
        applySliderValue(targetVolPct);

        onairIsPlaying = false;
        onairUpdatePlayPauseButtons(elements);
        onairStopRemainingTimer();
        logOpe('[onair.js] Playback paused via start mode.');

        try {
            window.electronAPI.sendControlToFullscreen({ command: 'pause' });
        } catch (_) {}
    }
    // 再生監視
    onairMonitorPlayback(onairVideoElement, outPoint);
}

// IN点シーク
function onairSeekToInPoint(onairVideoElement, inPoint) {
    if (!onairVideoElement) return;
    onairVideoElement.currentTime = inPoint;
    logDebug(`[onair.js] Seeked to IN point: ${inPoint}s`);
}

// ---------------
// OUT点到達監視
// ---------------
function onairMonitorPlayback(onairVideoElement, outPoint) {
    if (!onairVideoElement) return;

    if (onairIsUvcItemData(onairCurrentState)) {
        logDebug('[onair.js] UVC device detected. Skipping playback monitoring.');
        return;
    }

    // 許容誤差調整
    const tolerance = 0.05 * onairVideoElement.playbackRate;
    const completionTolerance = 0.01 * onairVideoElement.playbackRate;

    // エンドモード発火
    function handleRemainingTimeTimerComplete() {
        const currentTime = onairVideoElement.currentTime;
        logInfo(`[onair.js] Remaining time timer reached OUT point. currentTime=${currentTime.toFixed(2)}s, outPoint=${outPoint}`);

        const currentEndMode = onairCurrentState?.endMode || "PAUSE";
        logInfo(`[onair.js] Triggering End Mode: ${currentEndMode}`);
        onairHandleEndMode(currentEndMode);
    }

    // 既存監視停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
    }

    // 再生監視設定
    onairPreFtbStarted = false;
    onairPlaybackMonitor = setInterval(() => {
        if (!onairIsPlaying) {
            clearInterval(onairPlaybackMonitor);
            return;
        }

        const currentTime = onairVideoElement.currentTime;

        // 実際の動画の尺
        const duration = (typeof onairVideoElement.duration === 'number'
            && !Number.isNaN(onairVideoElement.duration)
            && onairVideoElement.duration > 0)
            ? onairVideoElement.duration
            : null;

        // 有効なOUT点
        let effectiveOutPoint = outPoint;
        if (duration !== null) {
            if (!effectiveOutPoint || effectiveOutPoint <= 0 || effectiveOutPoint > duration) {
                // OUT未指定 or durationを超えている場合は、実際の尺を優先
                effectiveOutPoint = duration;
            }
        }

        const remainingTime = effectiveOutPoint - currentTime;
        const remainingByDuration = (duration !== null) ? (duration - currentTime) : remainingTime;

        // 実際の動画終了との誤差吸収
        if (
            remainingTime <= completionTolerance ||
            remainingByDuration <= completionTolerance ||
            onairVideoElement.ended
        ) {
            clearInterval(onairPlaybackMonitor);
            handleRemainingTimeTimerComplete();
            return;
        }

        // 事前FTBが進行中にFTB付加が外れた場合
        if (onairPreFtbStarted
            && (!onairCurrentState?.ftbEnabled)
            && (remainingTime > (tolerance + 0.10))) {

            const els2 = onairGetElements();
            let currentOpacity = 0;
            try {
                if (els2?.onairFadeCanvas) {
                    currentOpacity = parseFloat(window.getComputedStyle(els2.onairFadeCanvas).opacity) || 0;
                }
            } catch (_) { currentOpacity = 0; }
            const ftbRateForBack = onairCurrentState?.ftbRate || 1.0;
            const backDur = Math.max(Math.min(currentOpacity * ftbRateForBack, 0.4), 0.2);

            if (els2?.onairFadeCanvas) onairFadeFromBlack(backDur);
            audioFadeInItem(backDur);

            // フルスクリーンにも逆フェード指示
            window.electronAPI.sendControlToFullscreen({
                command: 'fade-from-black',
                value: { duration: backDur, fillKeyMode: isFillKeyMode }
            });

            onairPreFtbStarted = false;
            logInfo(`[onair.js] Pre-FTB reversed due to ftbEnabled=false (duration=${backDur.toFixed(2)}s).`);
        }

        // 事前FTB開始
        const ftbRate = onairCurrentState?.ftbRate || 1.0;
        if (!onairPreFtbStarted
            && (onairCurrentState?.ftbEnabled === true)
            && (ftbRate > 0)
            && (remainingTime <= ftbRate)
            && (remainingTime > tolerance)
            && !fadeInInProgressItem
            && !fadeInInProgressMain) {

            const fadeDur = Math.max(remainingTime, 0.05);
            const els = onairGetElements();

            if (els?.onairFadeCanvas && els?.onairVideoElement) {
                const vRect = els.onairVideoElement.getBoundingClientRect();
                const pRect = (els.onairFadeCanvas.offsetParent
                    ? els.onairFadeCanvas.offsetParent.getBoundingClientRect()
                    : document.body.getBoundingClientRect());
                els.onairFadeCanvas.style.position = 'absolute';
                els.onairFadeCanvas.style.pointerEvents = 'none';
                els.onairFadeCanvas.style.margin = '0';
                els.onairFadeCanvas.style.border = '0';
                els.onairFadeCanvas.style.padding = '0';
                els.onairFadeCanvas.style.width  = `${vRect.width}px`;
                els.onairFadeCanvas.style.height = `${vRect.height}px`;
                els.onairFadeCanvas.style.left   = `${vRect.left - pRect.left}px`;
                els.onairFadeCanvas.style.top    = `${vRect.top  - pRect.top }px`;

                onairFadeToBlack(els.onairFadeCanvas, fadeDur); 
            }

            audioFadeOutItem(fadeDur);

            window.electronAPI.sendControlToFullscreen({
                command: 'start-pre-ftb',
                value: { duration: fadeDur, fillKeyMode: isFillKeyMode }
            });

            onairPreFtbStarted = true;
            logDebug(`[onair.js] Pre-FTB started: remaining=${remainingTime.toFixed(2)}s, duration=${fadeDur.toFixed(2)}s`);
        }

        // 残り時間タイマー更新
        onairUpdateRemainingTime(onairGetElements(), {
            outPoint: effectiveOutPoint,
            currentTime,
        });
    }, 30);

    logDebug(`[onair.js] Playback monitoring started with OUT point (tolerance=${tolerance}s).`);
}

// 誤OUT点通過フォールバック
function handleGlobalEndedEvent(videoElement) {
    const currentEndMode = onairCurrentState?.endMode || "PAUSE";
    logInfo(`[onair.js] Global ended event fired. Triggering end mode. Current endMode=${currentEndMode}`);

    // エンドモード発火
    onairHandleEndMode(currentEndMode);

    // リスナー削除
    if (videoElement && globalEndedListener) {
        videoElement.removeEventListener('ended', globalEndedListener);
        globalEndedListener = null;
    }
}

// -----------------------
// エンドモード
// -----------------------
function onairHandleEndMode() {
    const endMode = onairCurrentState?.endMode || 'PAUSE';

    // エンドモード
    let effectiveEndMode = endMode;

    // REPEAT指定回数（有限）の場合は OUT到達ごとに残り回数を減らし、最終回でrepeatEndModeへ切替
    if (endMode === 'REPEAT' && onairCurrentState) {
        const rc = onairCurrentState.repeatCount;
        if (typeof rc === 'number' && rc >= 1) {
            if (typeof onairCurrentState.repeatRemaining !== 'number' || isNaN(onairCurrentState.repeatRemaining)) {
                onairCurrentState.repeatRemaining = rc;
            }

            // 1回の再生終了（OUT到達）＝残り回数を1減らす
            onairCurrentState.repeatRemaining = Math.max(0, onairCurrentState.repeatRemaining - 1);

            // 完了した回数
            onairCurrentState.repeatPlayedCount = Math.max(0, rc - onairCurrentState.repeatRemaining);

            // 残りが尽きたら repeatEndMode を発動
            if (onairCurrentState.repeatRemaining <= 0) {
                const rem = onairCurrentState.repeatEndMode;
                if (rem === 'PAUSE' || rem === 'OFF' || rem === 'NEXT') {
                    effectiveEndMode = rem;
                } else {
                    effectiveEndMode = 'PAUSE';
                }
            } else {
                effectiveEndMode = 'REPEAT';
            }
        }
        // repeatCount が未設定（∞扱い）の場合は従来どおり REPEAT のまま
    }

    const wasGotoEndMode = (effectiveEndMode === 'GOTO');

    // GOTO は NEXT 完了通知経路を流用するため、実行系は NEXT として扱う
    if (effectiveEndMode === 'GOTO') {
        effectiveEndMode = 'NEXT';
    }

    logDebug(`[onair.js] Calling handleEndMode with endMode: ${endMode}, effectiveEndMode: ${effectiveEndMode}`);

    // FTB付加フラグ
    if (onairCurrentState?.ftbEnabled === true) {
        const elsFTB = onairGetElements();
        const canvas = elsFTB?.onairFadeCanvas;
        const video  = elsFTB?.onairVideoElement;
        if (canvas && video) {
            try {
                const selectedColor = isFillKeyMode
                    ? (document.getElementById('fillkey-color-picker')?.value || "#00FF00")
                    : "black";
                canvas.style.backgroundColor = selectedColor;
                canvas.style.visibility = 'visible';
                canvas.style.opacity = 1;
            } catch (_) {}
        }
    }
    
    // フルスクリーン通知
    const currentTime = onairGetElements().onairVideoElement?.currentTime || 0;
    const fullscreenEndModeStartMode = (onairCurrentState?.startMode || 'PAUSE');

    window.electronAPI.sendControlToFullscreen({
        command: 'trigger-endMode',
        value: effectiveEndMode,
        currentTime: currentTime,
        startMode: fullscreenEndModeStartMode
    });
    logDebug(`[onair.js] EndMode command sent to fullscre... }, startMode: ${fullscreenEndModeStartMode} }`);

    onairExecuteEndMode(effectiveEndMode, { wasGotoEndMode });
}

// エンドモード振分
function onairExecuteEndMode(endMode, options = {}) {
    logInfo(`[onair.js] Executing End Mode: ${endMode}`);

    switch (endMode) {
        case 'OFF':
            onairHandleEndModeOff();
            break;
        case 'PAUSE':
            onairHandleEndModePause();
            break;
        case 'REPEAT':
            onairHandleEndModeRepeat();
            break;
        case 'NEXT':
            onairHandleEndModeNext(options);
            break;
        default:
            logInfo(`[onair.js] Unknown End Mode: ${endMode}`);
    }
}

// エンドモードOFF
function onairHandleEndModeOff() {
    logInfo('[onair.js] End Mode: OFF - Triggering Off-Air button click.');

    onairPendingTransitionSource = null;
    onairPendingCurrentEndMode = null;

    const elements = onairGetElements();
    const { onairOffAirButton } = elements;

    if (onairOffAirButton) {
        triggerOnAirMouseDown('off-air-button');
        logInfo('[onair.js] Off-Air button click triggered.');
    } else {
        logInfo('[onair.js] Off-Air button not found. Resetting manually.');
        onairReset();
    }
}

// エンドモードPAUSE
function onairHandleEndModePause() {
    logInfo('[onair.js] End Mode: PAUSE - Pausing at the last frame.');

    onairPendingTransitionSource = null;
    onairPendingCurrentEndMode = null;

    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (onairVideoElement) {
        onairVideoElement.pause();
        onairVideoElement.currentTime = onairCurrentState.outPoint || onairVideoElement.duration;
    }

    onairIsPlaying = false;
    onairUpdatePlayPauseButtons(elements);
    resetOnAirVolumeMeter();
    lastVolumeUpdateTime = null;

    // フルスクリーンエリア停止通知
    window.electronAPI.sendControlToFullscreen({
        command: 'pause',
        value: onairVideoElement.currentTime,
    });

    logDebug('[onair.js] End Mode PAUSE: Play/Pause buttons updated.');
}

// エンドモードREPEAT
function onairHandleEndModeRepeat() {
    logInfo('[onair.js] End Mode: REPEAT - Replaying the same item.');

    if (typeof stopMainFade === 'function') {
        stopMainFade();
    }

    // 残存オーバーレイクリア
    onairCancelSeamlessOverlay('before-REPEAT');

    const repeatItemId = onairCurrentState?.itemId;
    if (!repeatItemId) {
        onairHandleEndModeOff();
        return;
    }

    onairPendingTransitionSource = 'auto';
    onairPendingCurrentEndMode =
        (onairCurrentState && typeof onairCurrentState.endMode === 'string')
            ? onairCurrentState.endMode
            : 'REPEAT';

    // 現在再生はここで止めるが、状態本体は再送完了まで保持する
    onairIsPlaying = false;

    const repeatItemData = {
        ...onairCurrentState,
        transitionSource: 'auto'
    };
    const transitionPlan = onairBuildTransitionPlan(repeatItemId, repeatItemData);
    const bridgeDecision = onairResolveBridgeMode(transitionPlan);

    transitionPlan.bridgeMode = bridgeDecision.bridgeMode;
    transitionPlan.transitionSource = bridgeDecision.transitionSource;
    transitionPlan.shouldPrepareOverlayBeforeReset =
        !!transitionPlan.shouldResetCurrentOnAir &&
        transitionPlan.bridgeMode === 'OVERLAY';
    repeatItemData.transitionSource = transitionPlan.transitionSource;

    onairPendingTransitionSource = null;
    onairPendingCurrentEndMode = null;

    onairCurrentState = repeatItemData;
    onairRepeatFlag = true;
    window.onairPreserveSpeed = true;

    if (transitionPlan.shouldResetCurrentOnAir) {
        window.electronAPI.sendControlToFullscreen({ command: 'clear-current-source' });
    }

    onairSendToFullscreen(repeatItemData, transitionPlan);

    updateEndModeDisplayLabel();
    onairStartPlayback(repeatItemData);

    logInfo('[onair.js] REPEAT mode processing completed.');
}

// キャンバスサイズ調整
function adjustFadeCanvasSize(videoElement, fadeCanvas) {
    if (!videoElement || !fadeCanvas) return;

    const vRect = videoElement.getBoundingClientRect();
    const pRect = (fadeCanvas.offsetParent
        ? fadeCanvas.offsetParent.getBoundingClientRect()
        : document.body.getBoundingClientRect());

    const left   = Math.round(vRect.left - pRect.left);
    const top    = Math.round(vRect.top  - pRect.top);
    const width  = Math.round(vRect.width);
    const height = Math.round(vRect.height);

    fadeCanvas.style.position = 'absolute';
    fadeCanvas.style.left = `${left}px`;
    fadeCanvas.style.top = `${top}px`;
    fadeCanvas.style.width = `${width}px`;
    fadeCanvas.style.height = `${height}px`;
}

// フェードアウト処理
function onairFadeToBlack(fadeCanvas, duration) {
    // FILL-KEYモード時は色にフェード
    const selectedColor = isFillKeyMode ? (document.getElementById('fillkey-color-picker')?.value || "#00FF00") : "black";
    fadeCanvas.style.backgroundColor = selectedColor;
    fadeCanvas.style.visibility = 'visible';
    fadeCanvas.style.opacity = 0;

    let startTime = null;

    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const opacity = Math.min(elapsed / (duration * 1000), 1);

        fadeCanvas.style.opacity = opacity;

        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            fadeCanvas.style.opacity = 1;
            logInfo(`[onair.js] Fade to ${selectedColor} completed.`);
        }
    }
    requestAnimationFrame(fadeStep);
}

// エンドモードNEXT
function onairHandleEndModeNext() {
    logInfo('[onair.js] End Mode: NEXT - Requesting next item.');
    if (typeof stopMainFade === 'function') {
        stopMainFade();
    }

    // 残存オーバーレイクリア
    onairCancelSeamlessOverlay('before-NEXT');

    const currentItemId = onairCurrentState?.itemId;
    if (!currentItemId) {
        onairHandleEndModeOff();
        return;
    }

    onairPendingTransitionSource = 'auto';
    onairPendingCurrentEndMode =
        (onairCurrentState && typeof onairCurrentState.endMode === 'string')
            ? onairCurrentState.endMode
            : 'NEXT';

    // 現在再生はここで止めるが、状態本体は次アイテム受信まで保持する
    onairIsPlaying = false;

    // 次アイテムリクエスト
    window.electronAPI.notifyNextModeComplete(currentItemId);

    logInfo('[onair.js] NEXT mode processing completed.');
}

// -------------------------------
// 再生、一時停止、オフエアボタン
// -------------------------------

// 再生ボタン
function onairHandlePlayButton() {
    logOpe('[onair.js] Play button invoked');
    if (!onairNowOnAir) {
        logDebug('[onair.js] Play button clicked, but On-Air is not active.');
        return;
    }

    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found.');
        return;
    }

    // 「OUT到達→FTB+PAUSE」で停止している場合
    const nearOut =
        Math.abs(onairVideoElement.currentTime - (onairCurrentState.outPoint || onairVideoElement.duration)) <
        (0.05 * (onairVideoElement.playbackRate || 1));

    const ftbEnabled = (onairCurrentState.ftbEnabled === true);

    // フェードキャンバスが黒(FTB状態)かどうかを確認
    let overlayOpacity = 0;
    try {
        const canvas = onairGetElements().onairFadeCanvas;
        if (canvas) {
            overlayOpacity = parseFloat(window.getComputedStyle(canvas).opacity) || 0;
        }
    } catch (_) { overlayOpacity = 0; }

    const isBlackOverlay = (onairPreFtbStarted === true) || (overlayOpacity >= 0.90);

    const isFtbStopAtOut = (!onairIsPlaying) && nearOut && ftbEnabled && isBlackOverlay;

    if (isFtbStopAtOut) {
        logDebug('[onair.js] Resuming from FTB stop at OUT: delegate to onairStartPlayback() only.');
        try {
            onairStartPlayback(onairCurrentState);
        } catch (e) {
            logInfo(`[onair.js] Failed to delegate start playback: ${e?.message || e}`);
        }
        return;
    }

    // 短尺ファイルの場合、動画の総尺が3秒未満なら再初期化
    if ((onairCurrentState.outPoint < 3) &&
        Math.abs(onairVideoElement.currentTime - (onairCurrentState.outPoint || onairVideoElement.duration)) < (0.05 * onairVideoElement.playbackRate)) {
        logDebug('[onair.js] Short file detected: resetting video element.');
        onairVideoElement.load();
        // IN点シーク
        onairSeekToInPoint(onairVideoElement, onairCurrentState.inPoint);
        logDebug(`[onair.js] For short file, seeked to IN point: ${onairCurrentState.inPoint}s`);
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: onairCurrentState.inPoint,
        });
        logDebug(`[onair.js] IN point seek command sent to fullscreen: ${onairCurrentState.inPoint}s`);
    }

    else if (Math.abs(onairVideoElement.currentTime - (onairCurrentState.outPoint || onairVideoElement.duration)) < 0.05) {
        // 通常ファイルIN点シーク
        onairSeekToInPoint(onairVideoElement, onairCurrentState.inPoint);
        logDebug(`[onair.js] Play button pressed: Current time is at OUT point, seeking to IN point: ${onairCurrentState.inPoint}s`);
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: onairCurrentState.inPoint,
        });
        logDebug(`[onair.js] IN point seek command sent to fullscreen: ${onairCurrentState.inPoint}s`);
    }

    // 再生開始
    onairVideoElement.play()
        .then(() => {
            onairIsPlaying = true;
            onairUpdatePlayPauseButtons(elements);
            onairStartRemainingTimer(elements, onairCurrentState);
            logOpe('[onair.js] Playback started.');
            window.electronAPI.sendControlToFullscreen({ command: 'play' });
        })
        .catch(error => {
            logInfo(`[onair.js] Playback failed: ${error.message}`);
        });

    onairRepeatFlag = false;
    onairMonitorPlayback(onairVideoElement, onairCurrentState.outPoint);
}

// 一時停止ボタン
function onairHandlePauseButton() {
    if (!onairNowOnAir) {
        logDebug('[onair.js] Pause button clicked, but On-Air is not active.');
        return;
    }

    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found.');
        return;
    }

    // 再生停止
    onairVideoElement.pause();
    onairIsPlaying = false;
    onairFtbToggleShouldKeepPlaying = false;
    onairUpdatePlayPauseButtons(elements); 
    onairStopRemainingTimer(); 
    logOpe('[onair.js] Playback paused.');
    resetOnAirVolumeMeter();
    lastVolumeUpdateTime = null;

    // フェード中即時停止
    if (fadeInInProgressMain || fadeOutInProgressMain || fadeInInProgressItem || fadeOutInProgressItem) {
        logDebug('[onair.js] Pause button pressed during fade ? stopping fade process.');
        stopFade();
        fadeInInProgressMain = false;
        fadeOutInProgressMain = false;
        fadeInInProgressItem = false;
        fadeOutInProgressItem = false;
    }

    // フルスクリーン通知
    window.electronAPI.sendControlToFullscreen({ command: 'pause' });
}

// オフエアボタン
function onairHandleOffAirButton() {
    logOpe('[onair.js] OffAir button invoked');
    if (isOffAir || isOffAirProcessing) {
        logDebug('[onair.js] Already in off-air state or processing; skipping new off-air processing.');
        return;
    }
    isOffAirProcessing = true;
    logInfo('[onair.js] Executing off-air processing.');
    onairNowOnAir = false;
    window.onairWasOffAir = true;

    // FTBフェードを中断
    try {
        window.electronAPI.sendControlToFullscreen({ command: 'cancel-fadeout' });
    } catch (_) {
        // ignore
    }

    if (onairFtbToggleMasterFadeRaf !== null) {
        cancelAnimationFrame(onairFtbToggleMasterFadeRaf);
        onairFtbToggleMasterFadeRaf = null;
    }
    if (onairFtbToggleRaf !== null) {
        cancelAnimationFrame(onairFtbToggleRaf);
        onairFtbToggleRaf = null;
    }

    if (onairFtbToggleHoldActive) {
        onairFtbToggleMasterVisualGain = 0;
        onairSetFtbButtonRecordingBlink(true);
        onairSetFtbToggleHoldVisual(true, 0);
    } else {
        onairFtbToggleMasterVisualGain = 1;
        onairSetFtbButtonRecordingBlink(false);
        onairSetFtbToggleHoldVisual(false, 0);
    }

    onairReset();
    const elements = onairGetElements();
    onairInitializeVolumeSlider(elements, 100);
    window.electronAPI.sendControlToFullscreen({ command: 'offAir' });
    window.electronAPI.stateControl.resetOnAirState();
    logDebug('[onair.js] resetOnAirState executed.');
    window.electronAPI.sendOffAirEvent();
    logDebug('[onair.js] sendOffAirEvent executed.');
    isOffAirProcessing = false;
    isOffAir = true;
}

// イベントリスナー
function onairSetupButtonHandlers() {
    const elements = onairGetElements();
    const { onairPlayButton, onairPauseButton, onairOffAirButton, onairFTBButton } = elements;

    // マウス左ボタン押下時ヘルパー
    const attachImmediateHandler = (buttonElement, handler) => {
        if (!buttonElement) return;
        buttonElement.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            handler();
        });
    };

    attachImmediateHandler(onairPlayButton, onairHandlePlayButton);
    attachImmediateHandler(onairPauseButton, onairHandlePauseButton);
    attachImmediateHandler(onairOffAirButton, onairHandleOffAirButton);
    attachImmediateHandler(onairFTBButton, onairHandleFTBButton);

    logDebug('[onair.js] Button handlers set up.');
}

// -----------------------
// マウスホイールコマ送り
// -----------------------
function setupMouseWheelControl(videoElement) {
    videoElement.tabIndex = 0;

    // 動画ロード完了判定
    let isVideoLoaded = false;
    videoElement.addEventListener('loadedmetadata', () => {
        isVideoLoaded = true;
    });

    // ホイール操作シーク
    videoElement.addEventListener('wheel', (event) => {
        if (!isVideoLoaded) {
            logInfo('[onair.js] Mouse wheel jog ignored because video is not loaded.');
            return;
        }
        event.preventDefault();
        const frameStep = 0.033;
        const delta = event.deltaY > 0 ? frameStep : -frameStep;
        const newTime = Math.max(0,
            Math.min(videoElement.duration, videoElement.currentTime + delta)
        );
        videoElement.currentTime = newTime;
        logOpe('[onair.js] Mouse wheel jog moved.');
        // フルスクリーン通知
        window.electronAPI.sendControlToFullscreen({ command: 'seek', value: newTime });
    });
}

// --------------
// シークバー
// --------------

// シーク操作ハンドラ
function onairHandleSeekBarChange(event, elements) {
    const { onairVideoElement, onairProgressSlider } = elements;
    if (!onairVideoElement || !onairProgressSlider) return;
    const newTime = parseFloat(onairProgressSlider.value);
    if (!isNaN(newTime)) {
        onairVideoElement.currentTime = newTime;
        logOpe(`[onair.js] Video seeked to time: ${newTime}`);
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: newTime,
        });
        logDebug('[onair.js] Seek command sent to Fullscreen.');

        // 事前FTBキャンセル
        if (onairPreFtbStarted) {
            window.electronAPI.sendControlToFullscreen({ command: 'cancel-pre-ftb' });
            onairFadeFromBlack(0.2);
            audioFadeInItem(0.2);
            onairPreFtbStarted = false;
            logDebug('[onair.js] Pre-FTB canceled due to seek.');
        }
    }
}

// シークバーハンドラ
function onairSetupSeekBarHandlers(elements) {
    const { onairProgressSlider, onairVideoElement } = elements;

    if (!onairProgressSlider || !onairVideoElement) return;

    // シークバー操作
    onairProgressSlider.addEventListener('input', (event) => {
        if (!onairCurrentState || onairIsUvcItemData(onairCurrentState)) {
            logDebug('[onair.js] Seek bar operation disabled for UVC device or invalid state.');
            onairProgressSlider.value = 0;
            return;
        }
        onairHandleSeekBarChange(event, elements);
    });

    // シークバー更新
    onairVideoElement.addEventListener('timeupdate', () => {
        if (!onairCurrentState) return;

        // UVCデバイス
        if (onairIsUvcItemData(onairCurrentState)) return;

        // 通常動画
        onairUpdateSeekBar(elements, onairCurrentState);
    });

    // 矢印キー動作無効化
    onairProgressSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            logDebug(`[onair.js] Key "${event.key}" input disabled on seek bar.`);
        }
    });

    logDebug('[onair.js] Seek bar handlers set up.');
}

// -----------------------
// 再生速度コントローラー
// -----------------------
let playbackSpeedAnimationFrame = null;
let isPlaybackSpeedDragging = false;
let isPlaybackSpeedFixed = false;

function setupPlaybackSpeedController() {
    logOpe('[onair.js] setupPlaybackSpeedController invoked');

    const slider = document.getElementById('playback-speed-slider');
    const inputField = document.getElementById('playback-speed-input');
    const video = document.getElementById('on-air-video');

    if (!slider || !inputField || !video) {
        logInfo('[onair.js] Playback speed controller element not found.');
        return;
    }

    // 再生速度スライダー初期化
    const SLIDER_BASE = 3;
    const SLIDER_MIN_RATE = 0.5;
    const SLIDER_MAX_RATE = 3.0;
    const sliderMin = 10 * Math.log(SLIDER_MIN_RATE) / Math.log(SLIDER_BASE);
    const sliderMax = 10 * Math.log(SLIDER_MAX_RATE) / Math.log(SLIDER_BASE);
    slider.min = sliderMin.toFixed(2);
    slider.max = sliderMax.toFixed(2);
    slider.step = "0.1";
    if (!slider.value) {
        slider.value = "0";
    }

    // 操作無効化
    if (!onairNowOnAir) {
        slider.disabled = true;
        inputField.disabled = true;
    } else {
        slider.disabled = false;
        inputField.disabled = false;
    }

    // 操作有効化
    video.addEventListener('loadedmetadata', () => {
        if (onairNowOnAir) {
            slider.disabled = false;
            inputField.disabled = false;
            logDebug('[onair.js] Speed control enabled after video loaded.');
        }
    });

    // スライダー更新
    slider.addEventListener('input', () => {
        logOpe(`[onair.js] Playback speed slider input: ${slider.value}`);
        if (!onairNowOnAir) {
            logDebug('[onair.js] Speed control input ignored: On-Air is not active.');
            return;
        }
        if (isPlaybackSpeedFixed) {
            isPlaybackSpeedFixed = false;
        }
        isPlaybackSpeedDragging = true;

        const sRaw = parseFloat(slider.value);
        const minVal = parseFloat(slider.min);
        const maxVal = parseFloat(slider.max);
        const s = isNaN(sRaw) ? 0 : Math.max(minVal, Math.min(maxVal, sRaw));

        let newRate = Math.pow(3, s / 10);

        // 実効レンジクランプ
        if (newRate < 0.5) newRate = 0.5;
        if (newRate > 3.0) newRate = 3.0;

        if (video) {
            video.playbackRate = newRate;
        }
        inputField.value = newRate.toFixed(2);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: newRate
        });
    });

    // スライダー操作終了
    const releaseHandler = () => {
        logOpe('[onair.js] Playback speed slider release');
        if (!onairNowOnAir) {
            logDebug('[onair.js] Speed control release ignored: On-Air is not active.');
            return;
        }
        if (!isPlaybackSpeedDragging) return;
        if (isPlaybackSpeedFixed) {
            isPlaybackSpeedDragging = false;
            return;
        }
        isPlaybackSpeedDragging = false;

        if (!video) {
            logDebug('[onair.js] Speed control release ignored because video element is missing.');
            return;
        }

        // アニメーション停止
        if (playbackSpeedAnimationFrame) {
            cancelAnimationFrame(playbackSpeedAnimationFrame);
            playbackSpeedAnimationFrame = null;
        }

        // 再生速度リセット
        const baseRate = 1.0;
        slider.value = "0";
        video.playbackRate = baseRate;
        inputField.value = baseRate.toFixed(2);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: baseRate
        });

        // 同期シーク送信
        const syncTime = video.currentTime;
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: syncTime
        });

        logDebug(`[onair.js] Speed dragging ended. Reset rate to 1.0x and synced fullscreen to ${syncTime}.`);
    };

    slider.addEventListener('mouseup', releaseHandler);
    slider.addEventListener('mouseleave', releaseHandler);
    slider.addEventListener('touchend', releaseHandler);

    // 入力欄手動変更時
    inputField.addEventListener('change', () => {
        logOpe(`[onair.js] Playback speed input changed: ${inputField.value}`);
        if (!onairNowOnAir) {
            logDebug('[onair.js] Speed control change ignored: On-Air is not active.');
            return;
        }
        let manualRate = parseFloat(inputField.value);
        if (isNaN(manualRate) || manualRate <= 0) {
            manualRate = 1.0;
        }
        if (manualRate < 0.5) manualRate = 0.5;
        if (manualRate > 3.0) manualRate = 3.0;
        isPlaybackSpeedFixed = true;
        const newS = 10 * Math.log(manualRate) / Math.log(3);
        slider.value = newS.toFixed(2);
        inputField.value = manualRate.toFixed(2);
        video.playbackRate = manualRate;
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: manualRate
        });
    });

    // スライダークリック
    slider.addEventListener('mousedown', () => {
        logOpe('[onair.js] Playback speed slider mousedown ? fixed mode disabled');
        isPlaybackSpeedFixed = false;
    });

    logDebug('[onair.js] Playback speed controller initialization complete.');
}

// 倍速プリセットボタン
function setupPlaybackSpeedPresetButtons() {
    try {
        const controlArea = document.getElementById('playback-speed-control');
        const slider = document.getElementById('playback-speed-slider');
        const inputField = document.getElementById('playback-speed-input');
        const video = document.getElementById('on-air-video');

        if (!controlArea || !slider || !inputField || !video) {
            logInfo('[onair.js] Speed preset: required elements not found.');
            return;
        }
        let group = document.getElementById('playback-speed-buttons');
        if (!group) {
            group = document.createElement('div');
            group.id = 'playback-speed-buttons';
            group.className = 'controls';
            controlArea.appendChild(group);

            const rates = [0.5, 1, 1.25, 1.5, 2, 3];
            for (const r of rates) {
                const btn = document.createElement('button');
                btn.className = 'button button-gray speed-btn';
                btn.dataset.rate = String(r);
                btn.textContent = 'x' + r;
                group.appendChild(btn);
            }
        }

        const buttons = Array.from(group.querySelectorAll('.speed-btn'));
        const toSliderVal = (rate) => 10 * Math.log(rate) / Math.log(3);
        const applyRate = (rate) => {
            // スライダーと数値表示同期
            const s = toSliderVal(rate);
            slider.value = s.toFixed(2);
            inputField.value = rate.toFixed(2);

            video.playbackRate = rate;
            window.electronAPI.sendControlToFullscreen({
                command: 'set-playback-speed',
                value: rate
            });
        };

        const setHighlight = (rate, lit) => {
            for (const btn of buttons) {
                const r = parseFloat(btn.dataset.rate);
                btn.classList.remove('button-green');
                if (lit && r !== 1 && Math.abs(r - rate) < 1e-6) {
                    btn.classList.add('button-green');
                }
            }
        };

        // 有効/無効制御/初期化
        const setButtonsEnabled = (enabled) => {
            buttons.forEach(b => { b.disabled = !enabled; });
        };

        const resetSpeedTo1x = () => {
            applyRate(1);
            setHighlight(1, false);
        };

        // 外部呼出公開
        window.onairSetSpeedButtonsEnabled = setButtonsEnabled;
        window.onairResetSpeedTo1x = resetSpeedTo1x;

        // 初期状態
        const resetSpeedUITo1x = () => {
            const s = toSliderVal(1);
            slider.value = s.toFixed(2);
            inputField.value = '1.00';
        };
        resetSpeedUITo1x();
        setButtonsEnabled(false);
        setHighlight(1, false);

        // 有効化
            const onLoadedMeta = () => {
                // REPEAT直後（2周目以降）は初期化スキップ
                if (window.onairPreserveSpeed) {
                    window.onairPreserveSpeed = false;   // 使い切り
                } else if (window.onairWasOffAir && typeof window.onairPresetSpeedRate === 'number' && window.onairPresetSpeedRate !== 1) {
                    // 直前がオフエアだった場合のみ、事前プリセットを一度だけ適用して即解除
                    applyRate(window.onairPresetSpeedRate);
                    setHighlight(window.onairPresetSpeedRate, true);
                    if (window.onairPresetSpeedRate === 1) setHighlight(1, false);
                    window.onairPresetSpeedRate = undefined;
                    window.onairWasOffAir = false;
                } else {
                    // 指定がなければ通常どおり
                    resetSpeedTo1x();
                    window.onairWasOffAir = false;
                }
                setButtonsEnabled(true);
            };

        video.addEventListener('loadedmetadata', onLoadedMeta);

        // 無効化
        const onEmptied = () => {
            // REPEAT2周目以降初期化スキップ
            if (window.onairPreserveSpeed || onairRepeatFlag) {
                return;
            }

            // リセット
            resetSpeedUITo1x();
            try { video.playbackRate = 1; } catch (_) {}
            try {
                window.electronAPI.sendControlToFullscreen({
                    command: 'set-playback-speed',
                    value: 1
                });
            } catch (_) {}

            setButtonsEnabled(true);
            setHighlight(1, false);
        };

        video.addEventListener('emptied', onEmptied);
        video.addEventListener('abort', onEmptied);
        video.addEventListener('error', onEmptied);

        // ボタン押下
        group.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();

            const btn = e.target.closest('.speed-btn');
            if (!btn) return;

            const rate = parseFloat(btn.dataset.rate);
            const active = btn.classList.contains('button-green');

            if (active) {
                // 同じプリセット再押下 = 1.00x に戻す
                resetSpeedTo1x();
                window.onairPresetSpeedRate = 1;
                return;
            }

            // 消灯
            setHighlight(1, false);

            // レート反映
            applyRate(rate);
            setHighlight(rate, true);
            if (rate === 1) setHighlight(1, false);

            // プリセット保持
            window.onairPresetSpeedRate = rate;
        });

        // スライダー／数値入力の手動操作
        const clearOnManualEdit = () => setHighlight(1, false);
        slider.addEventListener('input', clearOnManualEdit);
        inputField.addEventListener('input', clearOnManualEdit);
    } catch (err) {
        try { logInfo('[onair.js] setupPlaybackSpeedPresetButtons error:', err); } catch (_) {}
    }
}

// -----------------------
// 残り時間タイマー
// -----------------------

// タイマー開始
function onairStartRemainingTimer(elements, itemData) {
    const { onairVideoElement } = elements;

    if (!onairVideoElement || !itemData) return;

    // タイマーリセット
    if (onairRemainingTimer) clearInterval(onairRemainingTimer);

    onairRemainingTimer = setInterval(() => {
        // タイマー更新
        if (onairIsPlaying) {
            onairUpdateRemainingTime(elements, itemData);
        }
    }, 100);

    logDebug('[onair.js] Remaining time timer started.');
}

// タイマー停止
function onairStopRemainingTimer() {
    if (onairRemainingTimer) {
        clearInterval(onairRemainingTimer);
        onairRemainingTimer = null;
        logDebug('[onair.js] Remaining time timer stopped.');
    }
}

// 初期化
function onairResetRemainingTimer(elements) {
    const { onairRemainTimeDisplay } = elements;

    // リセット
    if (onairRemainTimeDisplay) {
        onairRemainTimeDisplay.textContent = '00:00:00:00';
        onairRemainTimeDisplay.style.color = 'orange';
    }

    // 停止
    onairStopRemainingTimer();

    logDebug('[onair.js] Remaining time timer reset.');
}

// ------------------------------
// 音量スライダー
// ------------------------------

// 音量スライダーイベント設定
function onairSetupVolumeSliderHandler(elements) {
    logOpe('[onair.js] setupVolumeSliderHandler invoked');
    const { onairItemVolumeSlider, onairMasterVolumeSlider, onairItemVolumeValueDisplay, onairMasterVolumeValueDisplay } = elements;

    if (!onairItemVolumeSlider || !onairMasterVolumeSlider) {
        logInfo('[onair.js] On-Air item or master volume slider element not found.');
        return;
    }

    function updateCombinedVolume() {
        const itemVal = parseInt(onairItemVolumeSlider.value, 10);
        const masterVal = parseInt(onairMasterVolumeSlider.value, 10);
        if (onairItemVolumeValueDisplay) {
            onairItemVolumeValueDisplay.textContent = `${itemVal}%`;
        }
        if (onairMasterVolumeValueDisplay) {
            onairUpdateMasterVolumeDisplay(masterVal);
        }
        const visualFinalVolume = (itemVal / 100) * (masterVal / 100);
        const actualFinalVolume = onairFtbToggleHoldActive ? 0 : visualFinalVolume;
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(actualFinalVolume, 2.2)
        });
        const videoElement = document.getElementById('on-air-video');
        if (videoElement) {
            videoElement.volume = actualFinalVolume;
        }
        logInfo(`[onair.js] Combined volume updated: Item ${itemVal}%, Master ${masterVal}% -> Final ${(actualFinalVolume * 100).toFixed(0)}%`);
    }

    // アイテムスライダー
    onairItemVolumeSlider.addEventListener("input", () => {
        if (fadeInInProgressItem || fadeOutInProgressItem) {
            stopItemFade(); // ITEM側だけ停止
        }
        updateCombinedVolume();
        updateVolumeSliderAppearance();
    });

    // マスターフェーダー
    onairMasterVolumeSlider.addEventListener("input", () => {
        if (fadeInInProgressMain || fadeOutInProgressMain) {
            stopMainFade(); // MAIN側だけ停止
        }
        const masterVal = parseInt(onairMasterVolumeSlider.value, 10);
        onairMasterVolume = masterVal;

        // 手動操作時
        if (onairFtbToggleMasterFadeRaf === null) {
            if (!onairFtbToggleHoldActive) {
                onairMasterBaseVolume = masterVal;
                onairFtbToggleMasterVisualGain = 1;
            }
        }

        updateCombinedVolume();
        onairMasterVolumeSlider.style.setProperty('--value', `${onairMasterVolumeSlider.value}%`);
    });

    // 矢印キー無効化
    onairItemVolumeSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            logDebug(`[onair.js] Key "${event.key}" input disabled on Item Volume Slider.`);
        }
    });
    onairMasterVolumeSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            logDebug(`[onair.js] Key "${event.key}" input disabled on Master Volume Slider.`);
        }
    });
    logDebug('[onair.js] Volume slider handlers for item and master set up.');
}

// ------------------------------
// 音声フェードイン・フェードアウト
// ------------------------------

function audioFadeOut(duration) {

    // 多重開始防止
    if (fadeOutInProgressMain || fadeInInProgressMain) return;
    fadeOutInProgressMain = true;

    const masterSlider = document.getElementById('on-air-master-volume-slider');
    let startTime = null;
    let currentValue = masterSlider.value;
    let targetValue = 0; 

    logInfo(
        `[onair.js] Main fade-out start: duration=${duration}, startValue=${currentValue}, itemSlider=${document.getElementById('on-air-item-volume-slider')?.value}, currentPath="${onairCurrentState?.path || ''}", currentName="${onairCurrentState?.name || ''}"`
    );

    // スライダー反映
    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        const masterVolumeDisplay = document.getElementById('on-air-master-volume-value');
        masterVolumeDisplay.textContent = `${roundedValue}%`;
        masterSlider.style.setProperty('--value', `${roundedValue}%`);

        if (roundedValue <= 10) {
            masterVolumeDisplay.classList.add('neon-warning');
        } else {
            masterVolumeDisplay.classList.remove('neon-warning');
        }

        const itemVal = parseInt(document.getElementById('on-air-item-volume-slider').value, 10);
        const masterVal = parseInt(masterSlider.value, 10);
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        const finalGamma = Math.pow(finalVolume, 2.2);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: finalGamma
        });

        if (roundedValue === 0 || roundedValue === 100 || roundedValue <= 5) {
            logInfo(
                `[onair.js] Main fade-out set-volume: item=${itemVal}%, master=${masterVal}%, finalLinear=${finalVolume.toFixed(4)}, finalGamma=${finalGamma.toFixed(4)}, currentPath="${onairCurrentState?.path || ''}"`
            );
        }
    }

    // フェード更新
    function fadeStep(timestamp) {
        if (!fadeOutInProgressMain) {
            logInfo('[onair.js] Main fade-out aborted before completion');
            return;
        }

        if (startTime === null) {
            startTime = timestamp;
            requestAnimationFrame(fadeStep);
            return;
        }

        const elapsed = timestamp - startTime;
        const newValue = Math.max(targetValue, currentValue - (elapsed / (duration * 1000)) * currentValue);

        setSliderValue(newValue);

        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            // 終了処理
            setSliderValue(targetValue);
            onairMasterVolume = targetValue;
            fadeOutInProgressMain = false;
            logInfo('[onair.js] Main fade-out completed');
            stopFadeButtonBlink(document.getElementById('on-air-fo-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// メインフェードイン
function audioFadeIn(duration) {

    // 多重開始防止
    if (fadeInInProgressMain || fadeOutInProgressMain) return;
    fadeInInProgressMain = true;

    const masterSlider = document.getElementById('on-air-master-volume-slider');
    if (!masterSlider) {
        logInfo('[onair.js] Error: on-air-master-volume-slider not found. Aborting fadeIn.');
        fadeInInProgressMain = false;
        return;
    }
    const masterValueElement = document.getElementById('on-air-master-volume-value');
    if (!masterValueElement) {
        logInfo('[onair.js] Error: on-air-master-volume-value not found. Aborting fadeIn.');
        fadeInInProgressMain = false;
        return;
    }
    const itemSlider = document.getElementById('on-air-item-volume-slider');
    const videoElement = document.getElementById('on-air-video');

    let startTime = null;
    const currentValue = parseFloat(masterSlider.value);
    const targetValue = 100;

    // スライダー反映
    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        masterValueElement.textContent = `${roundedValue}%`;
        masterSlider.style.setProperty('--value', `${roundedValue}%`);
        if (roundedValue <= 10) masterValueElement.classList.add('neon-warning');
        else masterValueElement.classList.remove('neon-warning');

        const itemVal = itemSlider ? parseInt(itemSlider.value, 10) : 100;
        const finalLinear = (itemVal / 100) * (roundedValue / 100);
        const finalGamma = Math.pow(finalLinear, 2.2);

        window.electronAPI.sendControlToFullscreen({ command: 'set-volume', value: finalGamma });
        if (videoElement) videoElement.volume = finalLinear;
    }

    // フェード更新
    function fadeStep(ts) {
        if (!fadeInInProgressMain) return;
        if (!startTime) startTime = ts;
        const elapsed = ts - startTime;
        const p = Math.min(elapsed / (duration * 1000), 1);
        const newValue = currentValue + (targetValue - currentValue) * p;
        setSliderValue(newValue);
        if (p < 1) {
            requestAnimationFrame(fadeStep);
        } else {
            // 終了処理
            setSliderValue(targetValue);
            onairMasterVolume = targetValue;
            fadeInInProgressMain = false;
            stopFadeButtonBlink(document.getElementById('on-air-fi-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// アイテムフェードアウト
function audioFadeOutItem(duration) {

    // 多重開始防止
    if (fadeOutInProgressItem || fadeInInProgressItem) return;
    fadeOutInProgressItem = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    let startTime = null;
    let currentValue = itemSlider.value;
    let targetValue = 0;

    logInfo(
        `[onair.js] Item fade-out start: duration=${duration}, startValue=${currentValue}, masterSlider=${document.getElementById('on-air-master-volume-slider')?.value}, currentPath="${onairCurrentState?.path || ''}", currentName="${onairCurrentState?.name || ''}"`
    );

    // スライダー反映
    function setSliderValue(value) {
        itemSlider.value = value;
        const roundedValue = Math.round(value);
        const itemVolumeDisplay = document.getElementById('on-air-item-volume-value');
        itemVolumeDisplay.textContent = `${roundedValue}%`;
        itemSlider.style.setProperty('--value', `${roundedValue}%`);

        const masterVal = parseInt(document.getElementById('on-air-master-volume-slider').value, 10);
        const finalVolume = (roundedValue / 100) * (masterVal / 100);
        const finalGamma = Math.pow(finalVolume, 2.2);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: finalGamma
        });
        const videoElement = document.getElementById('on-air-video');
        if (videoElement) {
            videoElement.volume = finalVolume;
        }

        if (roundedValue === 0 || roundedValue === 100 || roundedValue <= 5) {
            logInfo(
                `[onair.js] Item fade-out set-volume: item=${roundedValue}%, master=${masterVal}%, finalLinear=${finalVolume.toFixed(4)}, finalGamma=${finalGamma.toFixed(4)}, currentPath="${onairCurrentState?.path || ''}"`
            );
        }
    }

    // フェード更新
    function fadeStep(timestamp) {
        if (!fadeOutInProgressItem) {
            logInfo('[onair.js] Item fade-out aborted before completion');
            return;
        }

        if (startTime === null) {
            startTime = timestamp;
            requestAnimationFrame(fadeStep);
            return;
        }

        const elapsed = timestamp - startTime;
        const newValue = Math.max(targetValue, currentValue - (elapsed / (duration * 1000)) * currentValue);
        setSliderValue(newValue);

        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            // 終了処理
            setSliderValue(targetValue);
            fadeOutInProgressItem = false;
            logInfo('[onair.js] Item fade-out completed');
            stopFadeButtonBlink(document.getElementById('on-air-item-fo-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// アイテムフェードイン
function audioFadeInItem(duration) {

    // 多重開始防止
    if (fadeInInProgressItem || fadeOutInProgressItem) return;
    fadeInInProgressItem = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    if (!itemSlider) {
        logInfo('[onair.js] Error: on-air-item-volume-slider not found. Aborting fadeInItem.');
        fadeInInProgressItem = false;
        return;
    }
    const targetValue = onairCurrentState?.defaultVolume !== undefined ? onairCurrentState.defaultVolume : 100;
    let startTime = null;
    const currentValue = parseFloat(itemSlider.value);

    // スライダー反映
    function setSliderValue(value) {
        itemSlider.value = value;
        const roundedValue = Math.round(value);
        const itemVolumeDisplay = document.getElementById('on-air-item-volume-value');
        itemVolumeDisplay.textContent = `${roundedValue}%`;
        itemSlider.style.setProperty('--value', `${roundedValue}%`);
        const masterVal = parseInt(document.getElementById('on-air-master-volume-slider').value, 10);
        const finalVolume = (roundedValue / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });
        const videoElement = document.getElementById('on-air-video');
        if (videoElement) {
            videoElement.volume = finalVolume;
        }
    }

    // フェード更新
    function fadeStep(timestamp) {
        if (!fadeInInProgressItem) return;
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / (duration * 1000), 1);
        const newValue = currentValue + (targetValue - currentValue) * progress;
        setSliderValue(newValue);
        if (progress < 1) {
            requestAnimationFrame(fadeStep);
        } else {
            // 終了処理
            setSliderValue(targetValue);
            fadeInInProgressItem = false;
            stopFadeButtonBlink(document.getElementById('on-air-item-fi-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// メインフェードイン、フェードアウトボタンイベントリスナー
document.getElementById('on-air-fo-button').addEventListener('mousedown', (event) => {
    // 左クリック限定
    if (event.button !== 0) return;
    event.preventDefault();

    logOpe('[onair.js] Fade Out button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 再生可能状態確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade out operation canceled.');
        return;
    }

    // フェード開始
    const fioRate = parseFloat(document.getElementById('mainFioRate').value);
    stopMainFade();
    fadeButtonBlink(document.getElementById('on-air-fo-button'));
    audioFadeOut(fioRate);
});

document.getElementById('on-air-fi-button').addEventListener('mousedown', (event) => {

    // 左クリック限定
    if (event.button !== 0) return;
    event.preventDefault();

    logOpe('[onair.js] Fade In button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 再生可能状態確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade in operation canceled.');
        return;
    }

    // フェード開始
    const fioRate = parseFloat(document.getElementById('mainFioRate').value);
    stopMainFade();
    fadeButtonBlink(document.getElementById('on-air-fi-button')); 
    audioFadeIn(fioRate); 
});

// アイテムフェードイン・フェードアウトボタン
document.getElementById('on-air-item-fo-button').addEventListener('mousedown', (event) => {

    // 左クリック限定
    if (event.button !== 0) return;
    event.preventDefault();

    logOpe('[onair.js] Item Fade Out button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 再生可能状態確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-out operation canceled.');
        return;
    }

    // フェード時間決定
    const itemFioRateEl = document.getElementById('itemFioRate');
    const fadeDuration = (itemFioRateEl && !isNaN(parseFloat(itemFioRateEl.value)))
        ? parseFloat(itemFioRateEl.value)
        : (onairCurrentState?.ftbRate || 1.0);

    // フェード開始
    stopItemFade(); 
    fadeButtonBlink(document.getElementById('on-air-item-fo-button'));
    audioFadeOutItem(fadeDuration);
});

// アイテムフェードインボタン
document.getElementById('on-air-item-fi-button').addEventListener('mousedown', (event) => {

    // 左クリック限定
    if (event.button !== 0) return;
    event.preventDefault();

    logOpe('[onair.js] Item Fade In button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 再生可能状態確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-in operation canceled.');
        return;
    }

    // フェード時間決定
    const itemFioRateEl = document.getElementById('itemFioRate');
    const fadeDuration = (itemFioRateEl && !isNaN(parseFloat(itemFioRateEl.value)))
        ? parseFloat(itemFioRateEl.value)
        : (onairCurrentState?.ftbRate || 1.0);

    // フェード開始
    stopItemFade();
    fadeButtonBlink(document.getElementById('on-air-item-fi-button'));
    audioFadeInItem(fadeDuration); 
});

// フェードイン・フェードアウト中断
function stopFade() {
    // メイン・アイテム両方を止める
    fadeInInProgressMain = false;
    fadeOutInProgressMain = false;
    fadeInInProgressItem = false;
    fadeOutInProgressItem = false;
    logInfo('[onair.js] All fades stopped');

    // ボタン点滅を止める
    stopFadeButtonBlink(document.getElementById('on-air-fi-button'));
    stopFadeButtonBlink(document.getElementById('on-air-fo-button'));
    stopFadeButtonBlink(document.getElementById('on-air-item-fi-button'));
    stopFadeButtonBlink(document.getElementById('on-air-item-fo-button'));
}

// メインだけ止める
function stopMainFade() {
    const wasRunning = fadeInInProgressMain || fadeOutInProgressMain;
    fadeInInProgressMain = false;
    fadeOutInProgressMain = false;
    if (wasRunning) logInfo('[onair.js] Main fade stopped');
    stopFadeButtonBlink(document.getElementById('on-air-fi-button'));
    stopFadeButtonBlink(document.getElementById('on-air-fo-button'));
}

// アイテムだけ止める
function stopItemFade() {
    const wasRunning = fadeInInProgressItem || fadeOutInProgressItem;
    fadeInInProgressItem = false;
    fadeOutInProgressItem = false;
    if (wasRunning) logInfo('[onair.js] Item fade stopped');
    stopFadeButtonBlink(document.getElementById('on-air-item-fi-button'));
    stopFadeButtonBlink(document.getElementById('on-air-item-fo-button'));
}

// 点滅アニメーション
function fadeButtonBlink(button) {
    if (button) {
        button.classList.add('button-blink-orange');
    }
}

// 点滅停止
function stopFadeButtonBlink(button) {
    if (button) {
        button.classList.remove('button-blink-orange'); 
    }
}

// 数値表示警告色更新
function updateVolumeSliderAppearance() {
    const elements = onairGetElements();
    if (elements.onairItemVolumeSlider) {
        elements.onairItemVolumeSlider.style.setProperty('--value', `${elements.onairItemVolumeSlider.value}%`);
    }
}

// -----------------------
// スタートモードFADEIN
// -----------------------

// 映像フェードイン処理
function onairFadeFromBlack(duration) {
    const elements = onairGetElements();
    const { onairFadeCanvas } = elements;
    if (!onairFadeCanvas) return;
    
    // FILL-KEY確認
    const selectedColor = isFillKeyMode ? (document.getElementById('fillkey-color-picker')?.value || "#00FF00") : "black";
    onairFadeCanvas.style.backgroundColor = selectedColor;
    
    // 初期状態
    onairFadeCanvas.style.opacity = 1;
    onairFadeCanvas.style.visibility = 'visible';
    
    let startTime = null;
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const newOpacity = Math.max(1 - (elapsed / (duration * 1000)), 0);
        onairFadeCanvas.style.opacity = newOpacity;
        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            onairFadeCanvas.style.opacity = 0;
            onairFadeCanvas.style.visibility = 'hidden';
            logInfo(`[onair.js] Fade from ${selectedColor} completed.`);
        }
    }
    requestAnimationFrame(fadeStep);
}

// -----------------------
// アイテム状態情報更新
// -----------------------

// リストエディットからの更新通知受診
window.electronAPI.onListeditUpdated(() => {
    logDebug('[onair.js]  Listedit update received.');

    if (!onairCurrentState?.itemId) {
        logInfo('[onair.js] No current item. Ignoring listedit update.');
        return;
    }

    const updatedState = stateControl.getPlaylistState();
    if (!Array.isArray(updatedState)) {
        logInfo('[onair.js] Failed to retrieve updated playlist state.');
        return;
    }

    const updated = updatedState.find(it => it.playlistItem_id === onairCurrentState.itemId);
    if (!updated) {
        logDebug('[onair.js] Listedit update is for a different item. Ignored.');
        return;
    }

    compareAndUpdateState(updated, { source: 'listedit' });
});

// 状態更新
function compareAndUpdateState(updatedItem, { source } = {}) {
    if (!onairCurrentState) {
        logInfo('[onair.js] Current state is not set. Skipping comparison.');
        return;
    }
    logDebug('[onair.js] Comparing current state with updated item.');

    // 正規化
    const normIn  = typeof updatedItem.inPoint  === 'string' ? onairParseTimeToSeconds(updatedItem.inPoint)  : (updatedItem.inPoint  ?? 0);
    const normOut = typeof updatedItem.outPoint === 'string' ? onairParseTimeToSeconds(updatedItem.outPoint) : (updatedItem.outPoint ?? 0);
    const normEnd = (updatedItem.endMode || '').toString().toUpperCase() || 'PAUSE';
    const normFtb = parseFloat(updatedItem.ftbRate ?? onairCurrentState.ftbRate ?? 1.0);
    const normStartFi = (updatedItem.startFadeInSec !== undefined && !isNaN(parseFloat(updatedItem.startFadeInSec))) ? parseFloat(updatedItem.startFadeInSec) : onairCurrentState.startFadeInSec;
    const normStart = (updatedItem.startMode || onairCurrentState.startMode || 'PAUSE').toString().toUpperCase();
    const normFtbEnabled = !!updatedItem.ftbEnabled;

    // REPEAT設定正規化：未設定は∞扱い
    let normRepeatCount;
    if (updatedItem.repeatCount !== undefined && updatedItem.repeatCount !== null) {
        const parsed = parseInt(updatedItem.repeatCount, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            normRepeatCount = parsed;
        }
    }
    const tmpRepeatEnd = (updatedItem.repeatEndMode || '').toString().toUpperCase();
    const normRepeatEndMode = (tmpRepeatEnd === 'PAUSE' || tmpRepeatEnd === 'OFF' || tmpRepeatEnd === 'NEXT') ? tmpRepeatEnd : undefined;

    // イン点
    if (Number(onairCurrentState.inPoint) !== Number(normIn)) {
        logInfo(`IN point updated: ${onairCurrentState.inPoint} → ${normIn}`);
        onairCurrentState.inPoint = normIn;
        handleInPointUpdate(normIn, { source }); // ← transportしない分岐へ
    }

    // アウト点
    if (Number(onairCurrentState.outPoint) !== Number(normOut)) {
        logInfo(`OUT point updated: ${onairCurrentState.outPoint} → ${normOut}`);
        onairCurrentState.outPoint = normOut;
        handleOutPointUpdate(normOut, { source });
    }

    // スタートモード
    if ((onairCurrentState.startMode || '').toString().toUpperCase() !== normStart) {
        logInfo(`Start mode updated: ${onairCurrentState.startMode} → ${normStart}`);
        onairCurrentState.startMode = normStart;
        handleStartModeUpdate(normStart, { source });
    }

    // エンドモード
    if ((onairCurrentState.endMode || '').toString().toUpperCase() !== normEnd) {
        logInfo(`End mode updated: ${onairCurrentState.endMode} → ${normEnd}`);
        onairCurrentState.endMode = normEnd;
        handleEndModeUpdate(normEnd, { source });
    }

    // REPEAT設定
    const curRc = (typeof onairCurrentState.repeatCount === 'number' && !isNaN(onairCurrentState.repeatCount)) ? onairCurrentState.repeatCount : undefined;
    const curRe = (onairCurrentState.repeatEndMode || '').toString().toUpperCase();
    const curRepeatEndMode = (curRe === 'PAUSE' || curRe === 'OFF' || curRe === 'NEXT') ? curRe : undefined;

    const rcChanged = curRc !== normRepeatCount;
    const reChanged = curRepeatEndMode !== normRepeatEndMode;

    if (rcChanged || reChanged) {
        handleRepeatConfigUpdate(normRepeatCount, normRepeatEndMode, { source });
    }

    // FTBレート
    if (Number(onairCurrentState.ftbRate) !== Number(normFtb)) {
        logInfo(`FTB rate updated: ${onairCurrentState.ftbRate} → ${normFtb}`);
        onairCurrentState.ftbRate = normFtb;
        handleFtbRateUpdate(normFtb);
    }

    // FTBフラグ
    if (Boolean(onairCurrentState.ftbEnabled) !== Boolean(normFtbEnabled)) {
        logInfo(`FTB enabled updated: ${onairCurrentState.ftbEnabled} → ${normFtbEnabled}`);
        handleFtbEnabledUpdate(normFtbEnabled, { source });
    }

    // フェードインレート
    if (Number(onairCurrentState.startFadeInSec ?? NaN) !== Number(normStartFi ?? NaN)) {
        logInfo(`Start Fade-in sec updated: ${onairCurrentState.startFadeInSec} → ${normStartFi}`);
        onairCurrentState.startFadeInSec = normStartFi;
        handleStartFadeInSecUpdate(normStartFi);
    }

    logDebug('[onair.js] State comparison and update completed.');
}

// スタートモード更新
function handleStartModeUpdate(newStartMode, { source } = {}) {
    if (!onairCurrentState) return;
    const mode = (newStartMode || 'PAUSE').toUpperCase();
    onairCurrentState.startMode = mode;
    onairPushOperatorMonitorState();
    logDebug(`[onair.js] startMode updated to: ${mode} (source=${source || 'unknown'})`);
}

// エンドモード表示ラベル更新
function updateEndModeDisplayLabel() {
    const elements = onairGetElements();
    const { onairEndModeDisplay } = elements;
    if (!onairEndModeDisplay) return;

    const baseEnd = String(onairCurrentState?.endMode || 'PAUSE').toUpperCase();
    let label = baseEnd;

    // 回数表示を付加
    if (baseEnd === 'REPEAT') {
        const rc = onairCurrentState?.repeatCount;

        // 有限回数
        if (typeof rc === 'number' && rc >= 1) {
            const rem = onairCurrentState?.repeatRemaining;

            // 現在の再生回数
            let current = 1;
            if (typeof rem === 'number' && !isNaN(rem)) {
                if (rem <= 0) {
                    current = rc;
                } else {
                    current = Math.min(rc, Math.max(1, (rc - rem) + 1));
                }
            }

            // エンドモード
            const remMode = onairCurrentState?.repeatEndMode;
            const after = (remMode === 'PAUSE' || remMode === 'OFF' || remMode === 'NEXT') ? remMode : 'PAUSE';

            label = `REPEAT(${rc}/${current})→${after}`;
        } else {
            // ∞扱い
            label = 'REPEAT(∞)';
        }
    }

    // GOTO時はとび先表示を付加
    if (baseEnd === 'GOTO') {
        const pl = onairCurrentState?.endGotoPlaylist;
        const targetId = onairCurrentState?.endGotoItemId;
        let itemNo = '?';

        if (typeof pl === 'number' && pl >= 1 && pl <= 9 && typeof targetId === 'string' && targetId) {
            try {
                const raw = localStorage.getItem(`vtrpon_playlist_store_${pl}`);
                if (raw) {
                    const stored = JSON.parse(raw);
                    const data = stored?.data;
                    if (Array.isArray(data)) {
                        const idx = data.findIndex(it => String(it?.playlistItem_id || '') === targetId);
                        if (idx >= 0) {
                            const ord = data[idx]?.order;
                            if (typeof ord === 'number' && !isNaN(ord)) {
                                itemNo = String(ord >= 1 ? ord : (ord + 1));
                            } else {
                                itemNo = String(idx + 1);
                            }
                        }
                    }
                }
            } catch (_) {}
        }

        if (typeof pl === 'number' && pl >= 1 && pl <= 9) {
            label = `GOTO→${pl}-${itemNo}`;
        } else {
            label = 'GOTO';
        }
    }

    // FTB付加は先頭に付ける
    if (onairCurrentState?.ftbEnabled) {
        label = `FADEOUT_${label}`;
    }

    onairEndModeDisplay.textContent = `ENDMODE: ${label}`;
    onairPushOperatorMonitorState();
}

// FTB有効フラグ更新
function handleFtbEnabledUpdate(enabled, { source } = {}) {
    if (!onairCurrentState) return;
    onairCurrentState.ftbEnabled = !!enabled;

    updateEndModeDisplayLabel();

    if (source === 'listedit') {
        logDebug(`[onair.js] ftbEnabled updated (visual/state only) by listedit: ${onairCurrentState.ftbEnabled}`);
        return;
    }

    logDebug(`[onair.js] ftbEnabled updated: ${onairCurrentState.ftbEnabled}`);
}

// イン点更新
function handleInPointUpdate(newInPointSeconds, { source } = {}) {
    if (!onairCurrentState) return;

    const elements = onairGetElements();
    const { onairInPointDisplay, onairVideoElement } = elements;

    const inSec = Number(newInPointSeconds) || 0;
    onairCurrentState.inPoint = inSec;

    if (onairInPointDisplay) {
        onairInPointDisplay.textContent = onairFormatTime(inSec);
    }
    onairUpdateSeekBar(elements, onairCurrentState);

    if (source === 'listedit') {
        logDebug('[onair.js] IN updated (visual only, no transport) by listedit.');
        return;
    }

    if (onairVideoElement && onairVideoElement.currentTime < inSec) {
        onairVideoElement.currentTime = inSec;
        logDebug(`[onair.js] IN point applied to preview video: ${inSec}s`);
    }
}

// アウト点更新
function handleOutPointUpdate(newOutPointSeconds, { source } = {}) {
    if (!onairCurrentState) return;

    const elements = onairGetElements();
    const { onairOutPointDisplay, onairVideoElement } = elements;

    const outSecRaw = Number(newOutPointSeconds) || 0;
    onairCurrentState.outPoint = outSecRaw;

    if (onairOutPointDisplay) {
        onairOutPointDisplay.textContent = onairFormatTime(outSecRaw);
    }
    onairUpdateSeekBar(elements, onairCurrentState);

    let effectiveOut = outSecRaw;
    if (source === 'listedit' && onairIsPlaying && onairVideoElement) {
        const tol = 0.05 * (onairVideoElement.playbackRate || 1);
        effectiveOut = Math.max(outSecRaw, onairVideoElement.currentTime + tol);
        logDebug(`[onair.js] OUT updated by listedit. effectiveOut=${effectiveOut} (raw=${outSecRaw})`);
    }

    if (onairIsPlaying && onairVideoElement) {
        clearInterval(onairPlaybackMonitor);
        onairMonitorPlayback(onairVideoElement, effectiveOut);
    }
}

// エンドモード更新
function handleEndModeUpdate(newEndMode, { source } = {}) {
    if (onairCurrentState) {
        onairCurrentState.endMode = newEndMode;
    }

    updateEndModeDisplayLabel();

    if (source === 'listedit') {
        logDebug(`[onair.js] End mode updated (visual/state only) by listedit: ${newEndMode}`);
        return;
    }

    logDebug(`[onair.js] End mode updated: ${newEndMode}`);
}

// REPEAT設定更新
function handleRepeatConfigUpdate(newRepeatCount, newRepeatEndMode, { source } = {}) {
    if (!onairCurrentState) return;

    const isRepeat = String(onairCurrentState.endMode || '').toUpperCase() === 'REPEAT';

    // 進捗（完了回数）を確保
    const oldCount = (typeof onairCurrentState.repeatCount === 'number' && !isNaN(onairCurrentState.repeatCount)) ? onairCurrentState.repeatCount : undefined;
    const oldRem = (typeof onairCurrentState.repeatRemaining === 'number' && !isNaN(onairCurrentState.repeatRemaining)) ? onairCurrentState.repeatRemaining : undefined;

    if (!(typeof onairCurrentState.repeatPlayedCount === 'number' && !isNaN(onairCurrentState.repeatPlayedCount))) {
        let played = 0;
        if (typeof oldCount === 'number' && typeof oldRem === 'number') {
            played = Math.max(0, oldCount - oldRem);
        }
        onairCurrentState.repeatPlayedCount = played;
    }

    const played = Math.max(0, Number(onairCurrentState.repeatPlayedCount) || 0);
    const currentLoop = played + 1;

    // 状態反映
    onairCurrentState.repeatCount = (typeof newRepeatCount === 'number' && newRepeatCount >= 1) ? newRepeatCount : undefined;
    onairCurrentState.repeatEndMode = (newRepeatEndMode === 'PAUSE' || newRepeatEndMode === 'OFF' || newRepeatEndMode === 'NEXT') ? newRepeatEndMode : undefined;

    // REPEAT動作中でなければ、表示更新だけで終える
    if (!isRepeat) {
        updateEndModeDisplayLabel();
        return;
    }

    // ∞へ変更
    if (onairCurrentState.repeatCount === undefined) {
        onairCurrentState.repeatRemaining = undefined;
        updateEndModeDisplayLabel();
        return;
    }

    // 有限回数
    const rc = onairCurrentState.repeatCount;

    if (rc >= currentLoop) {
        onairCurrentState.repeatRemaining = Math.max(1, rc - played);
    } else {
        onairCurrentState.repeatRemaining = 1;
    }

    updateEndModeDisplayLabel();

    if (source === 'listedit') {
        logDebug(`[onair.js] repeat config updated by listedit: repeatCount=${onairCurrentState.repeatCount}, repeatEndMode=${onairCurrentState.repeatEndMode}, repeatRemaining=${onairCurrentState.repeatRemaining}`);
        return;
    }

    logDebug(`[onair.js] repeat config updated: repeatCount=${onairCurrentState.repeatCount}, repeatEndMode=${onairCurrentState.repeatEndMode}, repeatRemaining=${onairCurrentState.repeatRemaining}`);
}

// プレイリストモード更新時のエンドモード更新
if (window?.electronAPI?.ipcRenderer?.on) {
    window.electronAPI.ipcRenderer.on('sync-onair-endmode', (_e, payload) => {
        if (!onairCurrentState) return;
        const id = payload?.editingItemId;
        if (id && onairCurrentState.itemId !== id) return;
        const endMode = String(payload.endMode).toUpperCase();
        if (!endMode) return;
        handleEndModeUpdate(endMode, { source: 'ipc' });
    });
}

// FTBレート更新
function handleFtbRateUpdate(newFtbRate) {
    if (!onairCurrentState) {
        logDebug('[onair.js] No current state available for updating FTB rate.');
        return;
    }
    onairCurrentState.ftbRate = parseFloat(newFtbRate);
    logDebug(`[onair.js] FTB rate updated to: ${onairCurrentState.ftbRate}`);
}

// フェードインレート更新
function handleStartFadeInSecUpdate(newSec) {
    if (!onairCurrentState) return;
    const v = (newSec !== undefined && !isNaN(parseFloat(newSec))) ? parseFloat(newSec) : undefined;
    onairCurrentState.startFadeInSec = v;
    logDebug(`[onair.js] startFadeInSec updated to: ${v}`);
}

// -----------------------
// 音量メーターセットアップ
// -----------------------

// 受信停止監視
let onAirVolumeWatchdogId = null;

function setupOnAirVolumeMeter() {
    const volumeBarL = document.getElementById('on-air-volume-bar-L');
    const volumeBarR = document.getElementById('on-air-volume-bar-R');

    if (!volumeBarL || !volumeBarR) {
        logDebug('On-Air Volume Bar elements (L/R) not found.');
        return;
    }

    // 初期化
    volumeBarL.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.classList.add('volume-segment');
        volumeBarL.appendChild(segment);
    }

    volumeBarR.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.classList.add('volume-segment');
        volumeBarR.appendChild(segment);
    }

    // 受信停止監視
    if (onAirVolumeWatchdogId !== null) {
        clearInterval(onAirVolumeWatchdogId);
    }
    onAirVolumeWatchdogId = setInterval(() => {
        if (lastVolumeUpdateTime === null) return;
        if (Date.now() - lastVolumeUpdateTime >= volumeResetThreshold) {
            resetOnAirVolumeMeter();
        }
    }, volumeResetThreshold);
}

// -----------------------
// 音量メーター更新
// -----------------------

let lastVolumeUpdateTime = null; 
const volumeResetThreshold = 100; 

// スムージング状態
let displayedDbFSL = -60;
let displayedDbFSR = -60;
let redHoldUntilTsL = 0;
let redHoldUntilTsR = 0;

// スムージング設定
const ATTACK_MS  = 240;            // 上がる速さ（小さいほど速い）
const RELEASE_MS = 360;           // 下がる速さ（大きいほどゆっくり）
const RED_HOLD_MS = 180;          // 赤域に入った後の保持時間

// ピークホールド
let peakHoldDbFSL = -60;
let peakHoldUntilTsL = 0;
let peakHoldDbFSR = -60;
let peakHoldUntilTsR = 0;
const PEAK_HOLD_MS = 1200;

function updateOnAirVolumeMeter(dbFSL, dbFSR, isMono) {
    const volumeBarL = document.getElementById('on-air-volume-bar-L');
    const volumeBarR = document.getElementById('on-air-volume-bar-R');
    if (!volumeBarL || !volumeBarR) return;

    const segmentsL = Array.from(volumeBarL.querySelectorAll('.volume-segment'));
    const segmentsR = Array.from(volumeBarR.querySelectorAll('.volume-segment'));
    const totalSegments = segmentsL.length;

    const itemSliderEl = document.getElementById('on-air-item-volume-slider');
    const masterSliderEl = document.getElementById('on-air-master-volume-slider');
    const itemSliderValue = itemSliderEl ? parseFloat(itemSliderEl.value) : 100;
    const masterSliderValue = masterSliderEl ? parseFloat(masterSliderEl.value) : 100;
    const sliderNormalized = Math.max(0.01, (itemSliderValue / 100) * (masterSliderValue / 100));

    const now = Date.now();
    const dtMs = lastVolumeUpdateTime ? (now - lastVolumeUpdateTime) : 16;
    const upPerMs   = 60 / Math.max(1, ATTACK_MS);
    const downPerMs = 60 / Math.max(1, RELEASE_MS);

    const readout = document.getElementById('on-air-volume-readout');

    const processChannel = (side, rawDb, segments, displayedRef, redHoldRef, peakHoldDbRef, peakHoldUntilRef) => {
        if (rawDb === -Infinity || rawDb < -100) {
            segments.forEach(s => { s.style.backgroundColor = '#555'; s.style.boxShadow = 'none'; });
            if (side === 'L') {
                displayedDbFSL = -60;
                redHoldUntilTsL = 0;
                peakHoldDbFSL = -60;
                peakHoldUntilTsL = 0;
                if (readout) readout.textContent = '-∞ dBFS';
            } else {
                displayedDbFSR = -60;
                redHoldUntilTsR = 0;
                peakHoldDbFSR = -60;
                peakHoldUntilTsR = 0;
            }
            return;
        }

        let adjustedDb = rawDb + 20 * Math.log10(sliderNormalized);
        if (adjustedDb > 0) adjustedDb = 0;
        if (adjustedDb < -60) adjustedDb = -60;

        if (side === 'L') {
            if (adjustedDb > displayedDbFSL) {
                displayedDbFSL = Math.min(adjustedDb, displayedDbFSL + upPerMs * dtMs);
            } else {
                displayedDbFSL = Math.max(adjustedDb, displayedDbFSL - downPerMs * dtMs);
            }
            if (displayedDbFSL >= -9) redHoldUntilTsL = now + RED_HOLD_MS;
            const redHoldActive = now < redHoldUntilTsL;

            if (adjustedDb > peakHoldDbFSL + 0.1) {
                peakHoldDbFSL = adjustedDb;
                peakHoldUntilTsL = now + PEAK_HOLD_MS;
            } else if (now >= peakHoldUntilTsL) {
                peakHoldDbFSL = Math.max(-60, peakHoldDbFSL - downPerMs * dtMs);
            }
            if (readout) readout.textContent = `${adjustedDb.toFixed(1)} dBFS (pk ${peakHoldDbFSL.toFixed(1)})`;

            const fillRatioDb = (displayedDbFSL + 60) / 60;
            const activeSegments = Math.round(fillRatioDb * totalSegments);

            segments.forEach((segment, index) => {
                if (index >= totalSegments - activeSegments) {
                    const posTopToBottom = index / (totalSegments - 1);
                    const segmentDb = 0 - posTopToBottom * 60;
                    if (segmentDb >= -9 || (redHoldActive && segmentDb >= -9)) {
                        segment.style.backgroundColor = '#c05050';
                    } else if (segmentDb >= -20) {
                        segment.style.backgroundColor = 'rgb(210,160,120)';
                    } else {
                        segment.style.backgroundColor = 'rgb(90,130,90)';
                    }
                } else {
                    segment.style.backgroundColor = '#555';
                    segment.style.boxShadow = 'none';
                }
            });

        } else {
            if (adjustedDb > displayedDbFSR) {
                displayedDbFSR = Math.min(adjustedDb, displayedDbFSR + upPerMs * dtMs);
            } else {
                displayedDbFSR = Math.max(adjustedDb, displayedDbFSR - downPerMs * dtMs);
            }
            if (displayedDbFSR >= -9) redHoldUntilTsR = now + RED_HOLD_MS;
            const redHoldActive = now < redHoldUntilTsR;

            if (adjustedDb > peakHoldDbFSR + 0.1) {
                peakHoldDbFSR = adjustedDb;
                peakHoldUntilTsR = now + PEAK_HOLD_MS;
            } else if (now >= peakHoldUntilTsR) {
                peakHoldDbFSR = Math.max(-60, peakHoldDbFSR - downPerMs * dtMs);
            }

            const fillRatioDb = (displayedDbFSR + 60) / 60;
            const activeSegments = Math.round(fillRatioDb * totalSegments);

            segments.forEach((segment, index) => {
                if (index >= totalSegments - activeSegments) {
                    const posTopToBottom = index / (totalSegments - 1);
                    const segmentDb = 0 - posTopToBottom * 60;
                    if (segmentDb >= -9 || (redHoldActive && segmentDb >= -9)) {
                        segment.style.backgroundColor = '#c05050';
                    } else if (segmentDb >= -20) {
                        segment.style.backgroundColor = 'rgb(210,160,120)';
                    } else {
                        segment.style.backgroundColor = 'rgb(90,130,90)';
                    }
                } else {
                    segment.style.backgroundColor = '#555';
                    segment.style.boxShadow = 'none';
                }
            });

        }
    };

    if (isMono) {
        processChannel('L', dbFSL, segmentsL);
        segmentsR.forEach(s => { s.style.backgroundColor = '#555'; s.style.boxShadow = 'none'; });
        displayedDbFSR = -60;
        redHoldUntilTsR = 0;
        peakHoldDbFSR = -60;
        peakHoldUntilTsR = 0;
    } else {
        processChannel('L', dbFSL, segmentsL);
        processChannel('R', dbFSR, segmentsR);
    }

    lastVolumeUpdateTime = now;

    setTimeout(() => {
        if (Date.now() - lastVolumeUpdateTime >= volumeResetThreshold) {
            resetOnAirVolumeMeter();
        }
    }, volumeResetThreshold);
}

// -----------------------
// 音量メーターリセット
// -----------------------
function resetOnAirVolumeMeter() {
    const volumeBarL = document.getElementById('on-air-volume-bar-L');
    const volumeBarR = document.getElementById('on-air-volume-bar-R');

    if (volumeBarL) {
        Array.from(volumeBarL.querySelectorAll('.volume-segment')).forEach(s => {
            s.style.backgroundColor = '#555';
            s.style.boxShadow = 'none';
        });
    }
    if (volumeBarR) {
        Array.from(volumeBarR.querySelectorAll('.volume-segment')).forEach(s => {
            s.style.backgroundColor = '#555';
            s.style.boxShadow = 'none';
        });
    }

    // 内部状態初期化
    displayedDbFSL = -60;
    displayedDbFSR = -60;
    redHoldUntilTsL = 0;
    redHoldUntilTsR = 0;
    peakHoldDbFSL = -60;
    peakHoldDbFSR = -60;
    peakHoldUntilTsL = 0;
    peakHoldUntilTsR = 0;

    // 無音表示
    const readout = document.getElementById('on-air-volume-readout');
    if (readout) readout.textContent = '-∞ dBFS';
    lastVolumeUpdateTime = null;
}
// -----------------------
// フルスクリーンからの音量データ受信
// -----------------------
window.electronAPI.onReceiveFullscreenVolumeLR((L, R) => {
    const l = (typeof L === 'number') ? L : (L && typeof L.dbFS === 'number' ? L.dbFS : -Infinity);
    const r = (typeof R === 'number') ? R : (R && typeof R.dbFS === 'number' ? R.dbFS : -Infinity);
    updateOnAirVolumeMeter(l, r, false);
});

// -----------------------
// スクリーンショット
// -----------------------
document.addEventListener('DOMContentLoaded', () => {
    const captureBtn = document.getElementById('capture-button');
    if (captureBtn) {
        captureBtn.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();

            logOpe('[screenshot.js] Capture button clicked');
            window.electronAPI.ipcRenderer.send('request-capture-screenshot');
        });
    }
});

// -----------------------
// 録画
// -----------------------

// 録画ボタン
document.addEventListener('DOMContentLoaded', () => {
    const recBtn = document.getElementById('rec-button');
    if (recBtn) {
        recBtn.addEventListener('mousedown', async (event) => {
            // 左クリック限定
            if (event.button !== 0) return;
            event.preventDefault();

            if (!window.recorderIsActive) {
                // 録画開始
                window.electronAPI.sendControlToFullscreen({ command: 'start-recording' });
                window.recorderIsActive = true;
                recBtn.classList.add('button-recording');
                logOpe('[onair.js] REC mode started (command sent).');
            } else {
                // 録画停止
                window.electronAPI.sendControlToFullscreen({ command: 'stop-recording' });
                window.recorderIsActive = false;
                recBtn.classList.remove('button-recording');
                logOpe('[onair.js] REC mode ended (command sent).');
            }
        });
    }
});



// -----------------------
// FTBボタン
// -----------------------
function onairHandleFTBButton() {
    const settings = onairGetPlaylistOnAirSettings();

    if (settings.disableFtbButton === true) {
        return;
    }

    logOpe('[onair.js] FTB button clicked');

    const elements = onairGetElements();

    // FTBボタントグル保持
    const nextActive = !onairFtbToggleHoldActive;

    // 秒数参照元
    const startFadeInInputEl = document.getElementById('startFadeInSec');
    const ftbButtonFadeSecInput = document.getElementById('ftbButtonFadeSec');

    const ftbOutSecRaw = (ftbButtonFadeSecInput && !isNaN(parseFloat(ftbButtonFadeSecInput.value)))
        ? parseFloat(ftbButtonFadeSecInput.value)
        : Number(settings.ftbButtonFadeSec ?? 1.0);

    const startFadeInSecRaw = (startFadeInInputEl && !isNaN(parseFloat(startFadeInInputEl.value)))
        ? parseFloat(startFadeInInputEl.value)
        : Number(onairCurrentState?.startFadeInSec || 0);

    const ftbOutSec = Math.max(0, ftbOutSecRaw);
    const startFadeInSec = Math.max(0, startFadeInSecRaw);
    const fadeSec = ftbOutSec;
    const masterSlider = document.getElementById('on-air-master-volume-slider');

    // FTB ON時点で再生中だったかを保存
    if (nextActive) {
        onairFtbToggleShouldKeepPlaying = !!(elements.onairVideoElement && !elements.onairVideoElement.paused);

        const baseMasterValue = (onairMasterBaseVolume !== undefined && onairMasterBaseVolume !== null && !isNaN(Number(onairMasterBaseVolume)))
            ? Math.max(0, Math.min(100, Number(onairMasterBaseVolume) || 0))
            : (masterSlider
                ? Math.max(0, Math.min(100, Number(masterSlider.value) || 0))
                : 100);

        onairFtbToggleMasterRestoreValue = baseMasterValue;
    }

    // トグル状態を保存
    onairFtbToggleHoldActive = nextActive;

    onairSetFtbButtonRecordingBlink(nextActive);
    logInfo(`[onair.js] FTB toggle hold ${nextActive ? 'ON' : 'OFF'} (visual+audio, step3). duration=${fadeSec}s`);

    // OnAir映像レイヤー
    onairSetFtbToggleHoldVisual(nextActive, fadeSec);
    if (nextActive) {
        onairAnimateMasterFaderForFtb(0, fadeSec);
    } else {
        const restoreValue = (typeof onairFtbToggleMasterRestoreValue === 'number' && !isNaN(onairFtbToggleMasterRestoreValue))
            ? Math.max(0, Math.min(100, Number(onairFtbToggleMasterRestoreValue) || 0))
            : 0;

        onairAnimateMasterFaderForFtb(restoreValue, fadeSec);
    }

    // FTB OFF時
    if (!nextActive && onairFtbToggleShouldKeepPlaying && elements.onairVideoElement) {
        try {
            const p = elements.onairVideoElement.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {});
            }
        } catch (_) {
            // ignore
        }
    }

    // 映像FTB
    const fillKeyColorPicker = document.getElementById('fillkey-color-picker');
    const ftbFillKeyColor = !!isFillKeyMode
        ? ((fillKeyColorPicker && fillKeyColorPicker.value) ? fillKeyColorPicker.value : "#00FF00")
        : "";

    window.electronAPI.sendControlToFullscreen({
        command: 'ftb-toggle-hold',
        value: {
            active: nextActive,
            duration: fadeSec,
            fillKeyMode: !!isFillKeyMode,
            fillKeyColor: ftbFillKeyColor,
            keepPlaying: onairFtbToggleShouldKeepPlaying,
            audioTargetLinear: nextActive ? 0 : 1
        }
    });
}

// FTBボタン点滅表示
function onairSetFtbButtonRecordingBlink(isActive) {
    const ftbBtn = document.getElementById('ftb-off-button');
    if (!ftbBtn) return;

    if (isActive) {
        ftbBtn.classList.add('button-recording');
    } else {
        ftbBtn.classList.remove('button-recording');
    }
}

// マスター音量表示更新
function onairUpdateMasterVolumeDisplay(masterValue) {
    const masterVolumeDisplay = document.getElementById('on-air-master-volume-value');
    if (!masterVolumeDisplay) return;

    if (onairFtbToggleHoldActive) {
        masterVolumeDisplay.textContent = 'MUTE';
        masterVolumeDisplay.classList.add('button-recording');
        masterVolumeDisplay.classList.remove('neon-warning');
        return;
    }

    const roundedValue = Math.round(Math.max(0, Math.min(100, Number(masterValue) || 0)));
    masterVolumeDisplay.textContent = `${roundedValue}%`;
    masterVolumeDisplay.classList.remove('button-recording');

    if (roundedValue <= 10) {
        masterVolumeDisplay.classList.add('neon-warning');
    } else {
        masterVolumeDisplay.classList.remove('neon-warning');
    }
}

// -----------------------
// フィルキーモード
// -----------------------

// 初期化
(function setupFillKeyMode() {
    isFillKeyMode = false;
    const fillKeyButton = document.getElementById('fillkey-mode-button');
    if (!fillKeyButton) {
        logInfo('[onair.js] FILL-KEY mode button not found.');
        return;
    }

    // SHIFT+ENTER抑止
    fillKeyButton.addEventListener('keydown', (event) => {
        if (event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            logDebug('[onair.js] Prevented SHIFT+ENTER default behavior on FILL-KEY button.');
        }
    });

    // ボタン操作
    fillKeyButton.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();

        logOpe('[onair.js] FillKey button clicked');
        
        if (!isFillKeyMode) {
            // モード有効化
            isFillKeyMode = true;
            fillKeyButton.classList.add('button-green');
            fillKeyButton.style.backgroundColor = "";
            const colorPicker = document.getElementById('fillkey-color-picker');
            const selectedColor = colorPicker ? colorPicker.value : "#00FF00";
            const onAirVideo = document.getElementById('on-air-video');
            if (onAirVideo) {
                onAirVideo.style.backgroundColor = selectedColor;
            }
            window.electronAPI.sendControlToFullscreen({
                command: 'set-fillkey-bg',
                value: selectedColor
            });
            logDebug('[onair.js] FILL-KEY mode enabled with color: ' + selectedColor);
        } else {
            // モード解除
            isFillKeyMode = false;
            fillKeyButton.style.backgroundColor = "";
            fillKeyButton.classList.remove('button-green');
            const onAirVideo = document.getElementById('on-air-video');
            if (onAirVideo) {
                onAirVideo.style.backgroundColor = "";
            }
            window.electronAPI.sendControlToFullscreen({
                command: 'set-fillkey-bg',
                value: ''
            });
            logDebug('[onair.js] FILL-KEY mode disabled.');
        }
        fillKeyButton.blur();
    });
})();

// FILLKEYモード状態反映
function updateFillKeyModeState() {
    const fillKeyButton = document.getElementById('fillkey-mode-button');
    const onAirVideo = document.getElementById('on-air-video');
    
    if (isFillKeyMode) {
        // 有効時表示
        if (fillKeyButton) {
            fillKeyButton.classList.add('button-green');
            fillKeyButton.style.backgroundColor = "";
        }
        if (onAirVideo) {
            onAirVideo.classList.add('fillkey-enabled');
            const colorPicker = document.getElementById('fillkey-color-picker');
            const selectedColor = colorPicker ? colorPicker.value : "#00FF00";
            onAirVideo.style.backgroundColor = selectedColor;
        }
        logDebug('[onair.js] FillKey mode updated: ENABLED with color ' + (document.getElementById('fillkey-color-picker') ? document.getElementById('fillkey-color-picker').value : "#00FF00"));
    } else {
        // 無効時表示
        if (fillKeyButton) {
            fillKeyButton.classList.remove('button-green');
            fillKeyButton.style.backgroundColor = "";
        }
        if (onAirVideo) {
            onAirVideo.classList.remove('fillkey-enabled');
            onAirVideo.style.backgroundColor = "";
        }
        logDebug('[onair.js] FillKey mode updated: DISABLED');
    }
}

// IPC受信
window.electronAPI.ipcRenderer.on('fillkey-mode-update', (event, fillKeyMode) => {
    logDebug(`[onair.js] Received fillkey-mode-update: ${fillKeyMode}`);
    if (typeof fillKeyMode === 'boolean') {
        isFillKeyMode = fillKeyMode;
        updateFillKeyModeState(); 
        logDebug(`[onair.js] FillKey mode switched to: ${isFillKeyMode}`);
    }
});

// モード解除受信
window.electronAPI.ipcRenderer.on('clear-modes', (event, newFillKeyMode) => {
    logDebug('[onair.js] Received clear-modes notification with value:', newFillKeyMode);
    isFillKeyMode = newFillKeyMode; 
    updateFillKeyModeState();

    // フルスクリーン側フィルキー解除
    window.electronAPI.sendControlToFullscreen({ command: 'set-fillkey-bg', value: '' });
    logDebug('[onair.js] FillKey mode has been updated to:', isFillKeyMode);
});

// Operator Monitor 出力トグル受信
window.electronAPI.ipcRenderer.on('toggle-operator-monitor-output', () => {
    onairToggleOperatorMonitorOutput();
});

window.addEventListener('beforeunload', () => {
    onairCloseOperatorMonitorOutput();
});

// -----------------------
// ショートカットキー管理
// -----------------------

// -----------------------
// ショートカットキー管理
// -----------------------

// モーダル状態
let isOnAirModalActive = false;

// モーダル状態ログ
let lastLoggedOnAirModalState = null;
let onairModalListenerRegistered = false;

// 音量フェード補助
function animateSliderTo(slider, targetValue, {
    durationMs = 120,
    syncCombinedVolume,
    updateAppearance,
    onStep,
    onComplete
} = {}) {
    if (!slider) return;
    const startValue = parseFloat(slider.value) || 0;
    const endValue   = Math.max(0, Math.min(100, targetValue));
    if (startValue === endValue) {
        if (typeof onComplete === 'function') onComplete(endValue);
        return;
    }
    const startTime = performance.now();

    // フェード更新
    function frame(now) {
        const t = Math.min((now - startTime) / durationMs, 1);
        const v = startValue + (endValue - startValue) * t;
        slider.value = v;
        if (typeof updateAppearance === 'function') updateAppearance(slider, v);
        if (typeof onStep === 'function') onStep(v);
        if (typeof syncCombinedVolume === 'function') syncCombinedVolume();
        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            // 終了反映
            slider.value = endValue;
            if (typeof updateAppearance === 'function') updateAppearance(slider, endValue);
            if (typeof syncCombinedVolume === 'function') syncCombinedVolume();
            if (typeof onComplete === 'function') onComplete(endValue);
        }
    }
    requestAnimationFrame(frame);
}

// FTB音量同期
function onairSyncCombinedVolumeFromSlidersForFtb() {
    const itemSlider = document.getElementById('on-air-item-volume-slider');
    const masterSlider = document.getElementById('on-air-master-volume-slider');
    const videoElement = document.getElementById('on-air-video');
    if (!itemSlider || !masterSlider) return;

    // スライダー値取得
    const itemValRaw = Number.parseFloat(itemSlider.value);
    const masterValRaw = Number.parseFloat(masterSlider.value);

    const itemVal = Number.isFinite(itemValRaw) ? Math.max(0, Math.min(100, itemValRaw)) : 0;
    const masterVal = Number.isFinite(masterValRaw) ? Math.max(0, Math.min(100, masterValRaw)) : 0;

    const itemDisp = document.getElementById('on-air-item-volume-value');
    const masterDisp = document.getElementById('on-air-master-volume-value');

    const itemDispInt = Math.round(itemVal);
    const masterDispInt = Math.round(masterVal);

    // 表示更新
    if (itemDisp) {
        itemDisp.textContent = `${itemDispInt}%`;
    }
    if (masterDisp) {
        onairUpdateMasterVolumeDisplay(masterDispInt);
    }

    itemSlider.style.setProperty('--value', `${itemVal}%`);
    masterSlider.style.setProperty('--value', `${masterVal}%`);

    onairMasterVolume = masterVal;

    // 最終音量算出
    let finalVolume = (itemVal / 100) * (masterVal / 100);
    if (finalVolume <= ONAIR_FTB_SET_VOLUME_ENDPOINT_SNAP_EPSILON) {
        finalVolume = 0;
    } else if (finalVolume >= (1 - ONAIR_FTB_SET_VOLUME_ENDPOINT_SNAP_EPSILON)) {
        finalVolume = 1;
    }

    let gammaVolume = Math.pow(finalVolume, 2.2);
    if (gammaVolume <= ONAIR_FTB_SET_VOLUME_ENDPOINT_SNAP_EPSILON) {
        gammaVolume = 0;
    } else if (gammaVolume >= (1 - ONAIR_FTB_SET_VOLUME_ENDPOINT_SNAP_EPSILON)) {
        gammaVolume = 1;
    }

    const isEndpoint = (gammaVolume === 0 || gammaVolume === 1);

    // Fullscreen送信
    // FTB専用マスターフェード中は、Fullscreen側のローカル音声フェードを優先する
    if (onairFtbToggleMasterFadeRaf === null) {
        if (
            isEndpoint ||
            onairLastSentFullscreenGammaVolumeForFtb === null ||
            Math.abs(gammaVolume - onairLastSentFullscreenGammaVolumeForFtb) >= ONAIR_FTB_SET_VOLUME_EPSILON
        ) {
            window.electronAPI.sendControlToFullscreen({
                command: 'set-volume',
                value: gammaVolume
            });
            onairLastSentFullscreenGammaVolumeForFtb = gammaVolume;
        }
    }

    // プレビュー反映
    if (videoElement) {
        videoElement.volume = finalVolume;
    }
}

// FTBマスターフェード
function onairAnimateMasterFaderForFtb(targetValue, durationSec) {
    const masterSlider = document.getElementById('on-air-master-volume-slider');
    if (!masterSlider) {
        logInfo('[onair.js] FTB master fade skipped: master slider not found.');
        return;
    }

    // 既存フェード停止
    if (typeof stopMainFade === 'function') {
        stopMainFade();
    }

    if (onairFtbToggleMasterFadeRaf !== null) {
        cancelAnimationFrame(onairFtbToggleMasterFadeRaf);
        onairFtbToggleMasterFadeRaf = null;
    }

    onairFtbToggleMasterFadeAnimSeq += 1;
    const animSeq = onairFtbToggleMasterFadeAnimSeq;

    const startValue = Math.max(0, Math.min(100, Number(masterSlider.value) || 0));
    const endValue = Math.max(0, Math.min(100, Number(targetValue) || 0));
    const durMs = Math.max(0, (Number(durationSec) || 0) * 1000);

    // 送信状態初期化
    onairLastSentFullscreenGammaVolumeForFtb = null;

    // FTB表示ゲイン更新
    const updateFtbMasterVisualGain = (currentMasterValue) => {
        const base = Math.max(0, Math.min(100, Number(onairMasterBaseVolume) || 0));
        const current = Math.max(0, Math.min(100, Number(currentMasterValue) || 0));

        if (base <= 0) {
            onairFtbToggleMasterVisualGain = 1;
            return;
        }

        onairFtbToggleMasterVisualGain = Math.max(0, Math.min(1, current / base));
    };

    // 即時反映
    if (durMs <= 0) {
        masterSlider.value = endValue;
        updateFtbMasterVisualGain(endValue);

        if (Math.abs(endValue - (Number(onairMasterBaseVolume) || 0)) <= 0.05) {
            onairFtbToggleMasterVisualGain = 1;
        }

        onairSyncCombinedVolumeFromSlidersForFtb();
        return;
    }

    const startTs = performance.now();

    // フェード更新
    const step = (now) => {
        if (animSeq !== onairFtbToggleMasterFadeAnimSeq) {
            return;
        }

        const t = Math.min(1, (now - startTs) / durMs);
        let v = startValue + ((endValue - startValue) * t);

        if (Math.abs(v - endValue) <= 0.05) {
            v = endValue;
        }

        masterSlider.value = v;
        updateFtbMasterVisualGain(v);
        onairSyncCombinedVolumeFromSlidersForFtb();

        if (t < 1) {
            onairFtbToggleMasterFadeRaf = requestAnimationFrame(step);
            return;
        }

        if (animSeq !== onairFtbToggleMasterFadeAnimSeq) {
            return;
        }

        // 終了反映
        onairFtbToggleMasterFadeRaf = null;
        masterSlider.value = endValue;
        updateFtbMasterVisualGain(endValue);

        if (Math.abs(endValue - (Number(onairMasterBaseVolume) || 0)) <= 0.05) {
            onairFtbToggleMasterVisualGain = 1;
        }

        onairSyncCombinedVolumeFromSlidersForFtb();
    };

    onairFtbToggleMasterFadeRaf = requestAnimationFrame(step);
}

// ボタン発火補助
function triggerOnAirMouseDown(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) {
        logInfo(`[onair.js] Button not found for shortcut. id=${buttonId}`);
        return;
    }
    const mouseDownEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
    });
    btn.dispatchEvent(mouseDownEvent);
}

// ショートカット処理
function handleShortcut(action) {

    // モーダル中は無効
    if (isOnAirModalActive) {
        logDebug('[onair.js] Shortcut ignored because OnAir modal is active.');
        return;
    }

    // playlist.js側処理
    if (action === 'Shift+Alt+S') {
        return;
    }

    // 音量同期
    function syncCombinedVolume() {
        const itemSlider   = document.getElementById('on-air-item-volume-slider');
        const masterSlider = document.getElementById('on-air-master-volume-slider');
        const videoElement = document.getElementById('on-air-video');
        if (!itemSlider || !masterSlider) return;

        const itemVal   = parseInt(itemSlider.value, 10)   || 0;
        const masterVal = parseInt(masterSlider.value, 10) || 0;

        // 表示更新
        const itemDisp   = document.getElementById('on-air-item-volume-value');
        const masterDisp = document.getElementById('on-air-master-volume-value');
        if (itemDisp)   itemDisp.textContent   = `${itemVal}%`;
        if (masterDisp) {
            masterDisp.textContent = `${masterVal}%`;
            if (masterVal <= 10) masterDisp.classList.add('neon-warning');
            else masterDisp.classList.remove('neon-warning');
        }

        // スライダー表示更新
        itemSlider.style.setProperty('--value',   `${itemVal}%`);
        masterSlider.style.setProperty('--value', `${masterVal}%`);

        // 現在状態反映
        if (onairCurrentState && typeof onairCurrentState === 'object') {
            onairCurrentState.defaultVolume = itemVal;
        }

        // Fullscreen送信
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });

        // プレビュー反映
        if (videoElement) videoElement.volume = finalVolume;
    }

    // 0-100補正
    function clampPercent(v) {
        return Math.max(0, Math.min(100, Math.round(v)));
    }

    // アクション分岐
    switch (action) {
            case 'Escape':
            case 'Esc':
                logOpe('[onair.js] Shortcut: ESC pressed.');
                onairHandleOffAirButton();
                break;

        case 'Space':
            logOpe('[onair.js] Shortcut: Space pressed.');
            if (onairIsPlaying) {
                onairHandlePauseButton();
            } else {
                onairHandlePlayButton();
            }
            break;

        case 'Ctrl+,':
            logOpe('[onair.js] Shortcut: CTRL+, (fade in) triggered.');
            triggerOnAirMouseDown('on-air-fi-button');
            break;

        case 'Ctrl+.':
            logOpe('[onair.js] Shortcut: CTRL+. (fade out) triggered.');
            triggerOnAirMouseDown('on-air-fo-button');
            break;

        case 'Shift+Alt+F':
            logOpe('[onair.js] Shortcut: Shift+Alt+F triggered.');
            triggerOnAirMouseDown('fillkey-mode-button');
            break;

        case 'Shift+F':
            logOpe('[onair.js] Shortcut: Shift+F triggered.');
            onairHandleFTBButton();
            break;

        case 'Shift+R':
            logOpe('[onair.js] Shortcut: Shift+R (recording toggle) triggered.');
            triggerOnAirMouseDown('rec-button');
            break;

        // ITEM音量
        case 'Alt+]': {
            const s = document.getElementById('on-air-item-volume-slider');
            if (s) {
                const before = parseInt(s.value, 10) || 0;
                const after  = clampPercent(before + 3);
                animateSliderTo(s, after, {
                    durationMs: 120,
                    updateAppearance: (slider, v) => {
                        if (typeof updateVolumeSliderAppearance === 'function') {
                            updateVolumeSliderAppearance();
                        } else {
                            slider.style.setProperty('--value', `${Math.round(v)}%`);
                        }
                    },
                    syncCombinedVolume: () => syncCombinedVolume(),
                    onComplete: (v) => logOpe(`[onair.js] ITEM volume +3% -> ${Math.round(v)}% (Alt+])`)
                });
            }
            break;
        }
        case 'Alt+[': {
            const s = document.getElementById('on-air-item-volume-slider');
            if (s) {
                const before = parseInt(s.value, 10) || 0;
                const after  = clampPercent(before - 3);
                animateSliderTo(s, after, {
                    durationMs: 120,
                    updateAppearance: (slider, v) => {
                        if (typeof updateVolumeSliderAppearance === 'function') {
                            updateVolumeSliderAppearance();
                        } else {
                            slider.style.setProperty('--value', `${Math.round(v)}%`);
                        }
                    },
                    syncCombinedVolume: () => syncCombinedVolume(),
                    onComplete: (v) => logOpe(`[onair.js] ITEM volume -3% -> ${Math.round(v)}% (Alt+[)`)
                });
            }
            break;
        }

        // MAIN音量
        case 'Ctrl+Alt+]': {
            const s = document.getElementById('on-air-master-volume-slider');
            if (s) {
                const before = parseInt(s.value, 10) || 0;
                const after  = clampPercent(before + 3);
                animateSliderTo(s, after, {
                    durationMs: 120,
                    updateAppearance: (slider, v) => {
                        slider.style.setProperty('--value', `${Math.round(v)}%`);
                    },
                    onStep: (v) => { onairMasterVolume = Math.round(v); },
                    syncCombinedVolume: () => syncCombinedVolume(),
                    onComplete: (v) => {
                        onairMasterVolume = Math.round(v);
                        logOpe(`[onair.js] MAIN volume +3% -> ${Math.round(v)}% (Ctrl+Alt+])`);
                    }
                });
            }
            break;
        }
        case 'Ctrl+Alt[': {
            const s = document.getElementById('on-air-master-volume-slider');
            if (s) {
                const before = parseInt(s.value, 10) || 0;
                const after  = clampPercent(before - 3);
                animateSliderTo(s, after, {
                    durationMs: 120,
                    updateAppearance: (slider, v) => {
                        slider.style.setProperty('--value', `${Math.round(v)}%`);
                    },
                    onStep: (v) => { onairMasterVolume = Math.round(v); },
                    syncCombinedVolume: () => syncCombinedVolume(),
                    onComplete: (v) => {
                        onairMasterVolume = Math.round(v);
                        logOpe(`[onair.js] MAIN volume -3% -> ${Math.round(v)}% (Ctrl+Alt+[)`);
                    }
                });
            }
            break;
        }

        default:
            logDebug(`[onair.js] Unknown shortcut: ${action}`);
            break;
    }
}

// キーボード入力監視
document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        handleShortcut('Space');
        event.preventDefault();
        return;
    }

    let action = null;
    const isMod   = event.ctrlKey || event.metaKey;
    const isCtrl  = event.ctrlKey;
    const isMeta  = event.metaKey;
    const isAlt   = event.altKey;
    const isShift = event.shiftKey;

    // ショートカット判定
    if ((isMod || isAlt) && event.key === '.') {
        action = 'Ctrl+.';
    } else if ((isMod || isAlt) && event.key === ',') {
        action = 'Ctrl+,';
    } else if (isShift && isAlt && event.key.toLowerCase() === 'f') {
        action = 'Shift+Alt+F';
    } else if (isShift && event.key.toLowerCase() === 'f') {
        action = 'Shift+F';
    } else if (isShift && event.key.toLowerCase() === 'r') {
        action = 'Shift+R';
    }

    // ITEM音量判定
    if (!action && isAlt && !isShift && !isMod && event.key === ']') {
        action = 'Alt+]';
    } else if (!action && isAlt && !isShift && !isMod && event.key === '[') {
        action = 'Alt+[';
    }

    // MAIN音量判定
    if (!action && isAlt && !isShift && ( (isCtrl && !isMeta) || (!isCtrl && isMeta) ) && event.key === ']') {
        action = 'Ctrl+Alt+]';
    } else if (!action && isAlt && !isShift && ( (isCtrl && !isMeta) || (!isCtrl && isMeta) ) && event.key === '[') {
        action = 'Ctrl+Alt[';
    }

    // 実行
    if (action) {
        handleShortcut(action);
        event.preventDefault();
    }
});

// メニュー通知受信
window.electronAPI.onShortcutTrigger((event, action) => {
    logDebug(`[onair.js] Shortcut triggered from menu: ${action}`);
    handleShortcut(action);
});