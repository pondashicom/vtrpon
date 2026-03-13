// -----------------------
//     fullscreen.js
//     ver 2.6.0
// -----------------------

// -----------------------
// 初期設定
// -----------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logDebug = window.electronAPI.logDebug;

// グローバル変数
let isFillKeyMode = false;
let fillKeyBgColor = "#00FF00";
let ftbFadeInterval = null; 
let fadeCancelled = false;
let isMonoSource = false;
let preFtbActive = false;
let preFtbRaf = null;
let preFtbStartTime = null;
let preFtbDuration = 0;
let fullscreenBlackHoldActive = false;
let fullscreenBlackHoldKind = null;
let seamlessGuardActive = false;
let suppressIncomingUvcFadeUntilPlaying = false;
let overlayForceBlack = false;
let overlaySuppressedByPreFTB = false;
let fullscreenSeamlessCleanup = null;
let fullscreenApplySeq = 0;
let fullscreenApplyRafId = null;
let fullscreenFtbToggleHoldActive = false;
let fullscreenFtbToggleRaf = null;
let fullscreenFtbToggleVisualAnimSeq = 0;
let fullscreenFtbToggleShouldKeepPlaying = false;
let fullscreenFtbToggleAudioRaf = null;
let fullscreenFtbToggleAudioAnimSeq = 0;
let fullscreenFtbTogglePendingVolume = null;
let fullscreenFtbToggleTransitionUntilMs = 0;
const FULLSCREEN_SET_VOLUME_EPSILON = 0.01;
const FULLSCREEN_SET_VOLUME_ENDPOINT_SNAP_EPSILON = 0.005;
let fullscreenLastControlAppliedVolume = null;
const FS_LAYER_Z_PRE_FTB_BLACK = 8000;
const FS_LAYER_Z_DSK = 9000;
const FS_LAYER_Z_FTB_TOGGLE_HOLD = 10000;

// ----------------------------------------
// フルスクリーン初期化
// ----------------------------------------
function initializeFullscreenArea(blackHoldMode = null) {
    // オーバレイ解除
    try {
        if (typeof fullscreenSeamlessCleanup === 'function') {
            fullscreenSeamlessCleanup();
        }
    } catch (_) {
        // ignore
    }
    fullscreenSeamlessCleanup = null;
    seamlessGuardActive = false;
    overlayForceBlack = false;

    // FTBアニメーション状態リセット
    if (fullscreenFtbToggleAudioRaf !== null) {
        cancelAnimationFrame(fullscreenFtbToggleAudioRaf);
        fullscreenFtbToggleAudioRaf = null;
    }
    if (fullscreenFtbToggleRaf !== null) {
        cancelAnimationFrame(fullscreenFtbToggleRaf);
        fullscreenFtbToggleRaf = null;
    }
    fullscreenFtbToggleAudioAnimSeq += 1;
    fullscreenFtbToggleVisualAnimSeq += 1;
    fullscreenFtbToggleHoldActive = false;
    fullscreenFtbToggleShouldKeepPlaying = false;
    fullscreenFtbTogglePendingVolume = null;
    fullscreenFtbToggleTransitionUntilMs = 0;
    fullscreenLastControlAppliedVolume = null;

    // FTBトグル保持レイヤー非表示化
    try {
        const ftbLayer = document.getElementById('fullscreen-ftb-toggle-layer');
        if (ftbLayer) {
            ftbLayer.style.opacity = '0';
            ftbLayer.style.visibility = 'hidden';
            ftbLayer.style.display = 'block';
        }
    } catch (_) {
        // ignore
    }

    // 前フレームオーバレイクリア
    try {
        const oc = document.getElementById('overlay-canvas');
        if (oc) {
            const ctx = oc.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, oc.width, oc.height);
            oc.style.opacity = '0';
            oc.style.visibility = 'hidden';
            oc.style.display = 'none';
        }
    } catch (_) {
        // ignore
    }

    // 保留中の描画適用無効化
    try {
        fullscreenApplySeq += 1;
        if (fullscreenApplyRafId !== null) {
            cancelAnimationFrame(fullscreenApplyRafId);
            fullscreenApplyRafId = null;
        }
    } catch (_) {
        // ignore
    }

    // 黒保持レイヤー初期化
    const fc = initializeFadeCanvas();
    if (blackHoldMode) {
        fullscreenBlackHoldActive = true;
        fullscreenBlackHoldKind = blackHoldMode;
        if (fc) {
            fc.style.backgroundColor = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
            fc.style.display = 'block';
            fc.style.visibility = 'visible';
            fc.style.opacity = '1';
            // 映像より前、DSKより下
            fc.style.zIndex = '8000';
        }
    } else {
        fullscreenBlackHoldActive = false;
        fullscreenBlackHoldKind = null;
        if (fc) {
            fc.style.opacity = '0';
            fc.style.display = 'none';
            fc.style.visibility = 'hidden';
        }
    }

    // 再生要素を停止して表示ソース解除
    const videoElement = document.getElementById('fullscreen-video');
    if (videoElement) {
        videoElement.pause();

        // UVCストリーム停止
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }

        // 最終フレーム保持解除
        try {
            videoElement.removeAttribute('src');
            videoElement.src = '';
            videoElement.load();
        } catch (_) {
            // ignore
        }
    }

    // 保持中のストリーム停止
    if (globalState && globalState.stream && typeof globalState.stream.getTracks === 'function') {
        try {
            const gsTracks = globalState.stream.getTracks();
            gsTracks.forEach(track => track.stop());
            logInfo('[fullscreen.js] Stopped all tracks from globalState.stream.');
        } catch (e) {
            logInfo('[fullscreen.js] Failed to stop tracks from globalState.stream: ' + e);
        }
    }

    // 音声ゲインミュート
    try {
        if (typeof FullscreenAudioManager !== 'undefined' && fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(0, audioContext.currentTime);
            logDebug('[fullscreen.js] Fullscreen gain node muted during reset.');
        }
    } catch (e) {
        logInfo('[fullscreen.js] Failed to mute fullscreen gain node during reset: ' + e);
    }

    // グローバル状態初期化
    globalState = {
        playlistItemId: null,
        path: '',
        deviceId: null,
        inPoint: 0,
        outPoint: 0,
        startMode: 'PAUSE',
        endMode: 'PAUSE',
        defaultVolume: 100,
        ftbRate: 1.0,
        stream: null,
        volume: 1
    };

    // フェードキャンバス再初期化
    initializeFadeCanvas();

    // 音声チェーン再初期化
    setupFullscreenAudio.initialized = false;

    // FTBトグル保持レイヤー初期化
    initFullscreenFtbToggleLayer();

    logInfo('[fullscreen.js] Fullscreen area has been reset.');
}

// ------------------------------------
// フェードキャンバス初期化
// ------------------------------------
function initializeFadeCanvas() {
    const existingCanvas = document.getElementById('fadeCanvas');
    if (existingCanvas) {
        if (!(fullscreenBlackHoldActive && fullscreenBlackHoldKind)) {
            existingCanvas.style.opacity = '0';
            existingCanvas.style.display = 'none';
        }
        return existingCanvas;
    }

    // フェードキャンバス作成
    const fadeCanvas = document.createElement('div');
    fadeCanvas.id = 'fadeCanvas';
    fadeCanvas.style.position = 'absolute';
    fadeCanvas.style.top = '0';
    fadeCanvas.style.left = '0';
    fadeCanvas.style.width = '100vw';
    fadeCanvas.style.height = '100vh';
    fadeCanvas.style.backgroundColor = 'black';
    fadeCanvas.style.opacity = '0';
    // 映像より前、DSKより下の黒レイヤー
    fadeCanvas.style.zIndex = String(FS_LAYER_Z_PRE_FTB_BLACK);
    fadeCanvas.style.pointerEvents = 'none';

    document.body.appendChild(fadeCanvas);
    return fadeCanvas;
}


// ------------------------------------
// FTB
// ------------------------------------

// FTBトグル保持レイヤー初期化
function initFullscreenFtbToggleLayer() {
    let layer = document.getElementById('fullscreen-ftb-toggle-layer');
    const isNew = !layer;

    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'fullscreen-ftb-toggle-layer';
        document.body.appendChild(layer);
    } else if (layer.parentElement !== document.body) {
        document.body.appendChild(layer);
    }

    layer.style.position = 'fixed';
    layer.style.top = '0';
    layer.style.left = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = String(FS_LAYER_Z_FTB_TOGGLE_HOLD);

    if (isNew) {
        layer.style.backgroundColor = 'black';
        layer.style.opacity = '0';
        layer.style.visibility = 'hidden';
        layer.style.display = 'block';
    }

    return layer;
}

// FTBトグル保持レイヤー表示制御
function setFullscreenFtbToggleHoldVisual(active, durationSec, fillKeyMode, fillKeyColor) {
    const layer = initFullscreenFtbToggleLayer();
    if (!layer) return;

    if (fullscreenFtbToggleRaf !== null) {
        cancelAnimationFrame(fullscreenFtbToggleRaf);
        fullscreenFtbToggleRaf = null;
    }

    // 古いアニメーション無効化
    fullscreenFtbToggleVisualAnimSeq += 1;
    const animSeq = fullscreenFtbToggleVisualAnimSeq;

    const dur = Math.max(0, Number(durationSec) || 0);
    const startOpacity = Math.max(0, Math.min(1, parseFloat(layer.style.opacity || '0') || 0));
    const targetOpacity = active ? 1 : 0;

    // FTB表示色決定
    const effectiveFillKeyColor = (typeof fillKeyColor === 'string' && fillKeyColor.trim() !== '')
        ? fillKeyColor
        : ((fillKeyMode && isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : '');

    layer.style.backgroundColor = (fillKeyMode && effectiveFillKeyColor) ? effectiveFillKeyColor : 'black';
    layer.style.display = 'block';
    layer.style.visibility = 'visible';

    if (dur <= 0) {
        layer.style.opacity = String(targetOpacity);
        if (!active) {
            layer.style.visibility = 'hidden';
        }
        return;
    }

    const startTs = performance.now();
    const animate = (now) => {
        if (animSeq !== fullscreenFtbToggleVisualAnimSeq) {
            return;
        }

        const t = Math.min(1, (now - startTs) / (dur * 1000));
        const next = startOpacity + ((targetOpacity - startOpacity) * t);
        layer.style.opacity = String(next);

        if (t < 1) {
            fullscreenFtbToggleRaf = requestAnimationFrame(animate);
            return;
        }

        if (animSeq !== fullscreenFtbToggleVisualAnimSeq) {
            return;
        }

        fullscreenFtbToggleRaf = null;
        layer.style.opacity = String(targetOpacity);
        if (!active) {
            layer.style.visibility = 'hidden';
        }
    };

    fullscreenFtbToggleRaf = requestAnimationFrame(animate);
}

// FTBトグル用音量値適用
function fullscreenApplyVolumeValueForFtbToggle(value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    const fullscreenVideoElement = document.getElementById('fullscreen-video');
    if (!fullscreenVideoElement) return;

    // FTBトグル用の音量を映像要素へ適用
    try {
        fullscreenVideoElement.volume = v;
    } catch (_) {
        // ignore
    }

    // FTBトグル用の音量をゲインノードへ適用
    try {
        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            const t = audioContext.currentTime;
            fullscreenGainNode.gain.cancelScheduledValues(t);
            fullscreenGainNode.gain.setValueAtTime(v, t);
        }
    } catch (_) {
        // ignore
    }
}

// FTBトグル用音量アニメーション
function fullscreenAnimateFtbToggleAudioTo(targetLinear, durationSec) {
    if (fullscreenFtbToggleAudioRaf !== null) {
        cancelAnimationFrame(fullscreenFtbToggleAudioRaf);
        fullscreenFtbToggleAudioRaf = null;
    }

    // 古いアニメーション無効化
    fullscreenFtbToggleAudioAnimSeq += 1;
    const animSeq = fullscreenFtbToggleAudioAnimSeq;

    const fullscreenVideoElement = document.getElementById('fullscreen-video');
    if (!fullscreenVideoElement) return;

    const targetLinearClamped = Math.max(0, Math.min(1, Number(targetLinear) || 0));
    const target = Math.pow(targetLinearClamped, 2.2);
    const dur = Math.max(0, Number(durationSec) || 0);

    // 現在の適用音量を取得
    let start;
    try {
        if (fullscreenGainNode) {
            start = Math.max(0, Math.min(1, Number(fullscreenGainNode.gain.value) || 0));
        } else {
            start = Math.max(0, Math.min(1, Number(fullscreenVideoElement.volume) || 0));
        }
    } catch (_) {
        start = Math.max(0, Math.min(1, Number(fullscreenVideoElement.volume) || 0));
    }

    if (dur <= 0) {
        fullscreenApplyVolumeValueForFtbToggle(target);
        return;
    }

    const startTs = performance.now();
    const animate = (now) => {
        if (animSeq !== fullscreenFtbToggleAudioAnimSeq) {
            return;
        }

        const t = Math.min(1, (now - startTs) / (dur * 1000));
        const v = start + ((target - start) * t);
        fullscreenApplyVolumeValueForFtbToggle(v);

        if (t < 1) {
            fullscreenFtbToggleAudioRaf = requestAnimationFrame(animate);
            return;
        }

        if (animSeq !== fullscreenFtbToggleAudioAnimSeq) {
            return;
        }

        fullscreenFtbToggleAudioRaf = null;
        fullscreenApplyVolumeValueForFtbToggle(target);
    };

    fullscreenFtbToggleAudioRaf = requestAnimationFrame(animate);
}

// -------------------
// オンエアデータ受信
// -------------------

//データ受信
window.electronAPI.onReceiveFullscreenData((itemData) => {
    logInfo(`[fullscreen.js] Received On-Air data in fullscreen: ${JSON.stringify(itemData)}`);

    const incomingBridgeMode = getIncomingBridgeMode(itemData);

    // 切替直前フェードレイヤー解除
    cancelPreFTB();
    cancelFadeOut();
    const ffCanvas = document.getElementById('fullscreen-fade-canvas');
    if (ffCanvas) {
        ffCanvas.style.opacity = '0';
        ffCanvas.style.visibility = 'hidden';
    }

    executeIncomingBridgeMode(incomingBridgeMode);

    suppressIncomingUvcFadeUntilPlaying = (getIncomingMediaKind(itemData) === 'uvc');

    // UVCミュート状態更新
    applyMuteStateForNextSource(itemData);

    // オーバレイキャプチャリセット
    fullscreenApplySeq += 1;
    const applySeq = fullscreenApplySeq;

    if (fullscreenApplyRafId !== null) {
        try { cancelAnimationFrame(fullscreenApplyRafId); } catch (_) {}
        fullscreenApplyRafId = null;
    }

    fullscreenApplyRafId = requestAnimationFrame(() => {
        if (applySeq !== fullscreenApplySeq) return;

        fullscreenApplyRafId = null;
        resetFullscreenState();
        handleOnAirData(itemData);
    });
});

// UVCミュート状態更新
function applyMuteStateForNextSource(itemData) {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) return;

    const shouldMute = (getIncomingMediaKind(itemData) === 'uvc');

    videoElement.muted = shouldMute;

    logDebug(`[fullscreen.js] applyMuteStateForNextSource: isUVC=${shouldMute}, muted=${videoElement.muted}`);
}

// ---------------------------
// 映像ブリッジ情報受信処理
// ---------------------------

// bridgeMode取得
function getIncomingBridgeMode(itemData) {
    if (!itemData || !itemData.transitionPlan || typeof itemData.transitionPlan !== 'object') {
        logInfo('[fullscreen.js] transitionPlan.bridgeMode is missing. Fallback to NONE.');
        return 'NONE';
    }

    const bridgeMode = itemData.transitionPlan.bridgeMode;
    if (typeof bridgeMode !== 'string' || !bridgeMode) {
        logInfo('[fullscreen.js] transitionPlan.bridgeMode is empty. Fallback to NONE.');
        return 'NONE';
    }

    const normalizedBridgeMode = bridgeMode.toUpperCase();
    if (
        normalizedBridgeMode !== 'BLACK' &&
        normalizedBridgeMode !== 'NONE' &&
        normalizedBridgeMode !== 'OVERLAY'
    ) {
        logInfo(`[fullscreen.js] Unsupported bridgeMode "${bridgeMode}". Fallback to NONE.`);
        return 'NONE';
    }

    return normalizedBridgeMode;
}

// mediaKind取得
function getIncomingMediaKind(itemData) {
    if (!itemData || !itemData.transitionPlan || typeof itemData.transitionPlan !== 'object') {
        logInfo('[fullscreen.js] transitionPlan.nextMediaKind is missing. Fallback to video.');
        return 'video';
    }

    const mediaKind = itemData.transitionPlan.nextMediaKind;
    if (typeof mediaKind !== 'string' || !mediaKind) {
        logInfo('[fullscreen.js] transitionPlan.nextMediaKind is empty. Fallback to video.');
        return 'video';
    }

    const normalizedMediaKind = normalizeMediaKind(mediaKind);

    if (normalizedMediaKind === 'video' && mediaKind.toLowerCase() !== 'video') {
        logInfo(`[fullscreen.js] Unsupported nextMediaKind "${mediaKind}". Fallback to video.`);
    }

    return normalizedMediaKind;
}

// ---------------------------
// 映像ブリッジ黒制御
// ---------------------------

// 遷移用の黒保持中か判定する関数
function isTransitionBlackHoldActive() {
    return !!(fullscreenBlackHoldActive && fullscreenBlackHoldKind === 'transition');
}

// 遷移用の黒保持を解除する関数
function clearTransitionBlackHold() {
    fullscreenBlackHoldActive = false;
    fullscreenBlackHoldKind = null;

    const fc = document.getElementById('fadeCanvas');
    if (fc) {
        fc.style.opacity = '0';
        fc.style.display = 'none';
        fc.style.visibility = 'hidden';
    }

    overlaySuppressedByPreFTB = false;
}

// 遷移用の黒保持を開始する関数
function beginTransitionBlackHold() {
    const fc = initializeFadeCanvas();

    fullscreenBlackHoldActive = true;
    fullscreenBlackHoldKind = 'transition';

    if (fc) {
        fc.style.display = 'block';
        fc.style.visibility = 'visible';
        fc.style.opacity = '1';
    }
}

// 動画が遷移黒解除可能な状態か判定する関数
function isVideoReadyForTransitionBlackRelease(videoElement, expectedSrc) {
    const nowSrc = String(videoElement.currentSrc || videoElement.src || '');

    if (expectedSrc && nowSrc && nowSrc !== expectedSrc) {
        return false;
    }

    if ((videoElement.readyState | 0) < 2) {
        return false;
    }

    if ((videoElement.videoWidth | 0) <= 0 || (videoElement.videoHeight | 0) <= 0) {
        return false;
    }

    return true;
}

// 動画の ready を待って遷移黒を解除する関数
function releaseTransitionBlackOnVideoReady(videoElement, fillKeyMode) {
    if (!videoElement || !isTransitionBlackHoldActive()) {
        return;
    }

    const expectedSrc = String(videoElement.src || '');
    let releaseStarted = false;

    function tryRelease() {
        if (releaseStarted) return;

        if (!isTransitionBlackHoldActive()) {
            cleanupReleaseListeners();
            return;
        }

        if (!isVideoReadyForTransitionBlackRelease(videoElement, expectedSrc)) return;

        releaseStarted = true;
        cleanupReleaseListeners();

        try {
            fullscreenFadeFromBlack(0.06, fillKeyMode);
        } catch (_) {
            clearTransitionBlackHold();
        }
    }

    const cleanupReleaseListeners = () => {
        videoElement.removeEventListener('loadeddata', tryRelease);
        videoElement.removeEventListener('canplay', tryRelease);
    };

    videoElement.addEventListener('loadeddata', tryRelease);
    videoElement.addEventListener('canplay', tryRelease);

    tryRelease();

    let tries = 0;
    const rafTry = () => {
        if (releaseStarted) return;
        tries++;
        if (tries > 30 || !isTransitionBlackHoldActive()) {
            cleanupReleaseListeners();
            return;
        }
        tryRelease();
        if (!releaseStarted) requestAnimationFrame(rafTry);
    };
    requestAnimationFrame(rafTry);
}

// ---------------------------
// 映像ブリッジオーバレイ制御
// ---------------------------
let visualBridgeOverlayClearTimerId = null;
let visualBridgeOverlayClearRequestId = 0;

// 映像ブリッジオーバーレイ解除
function clearVisualBridgeOverlay() {
    if (visualBridgeOverlayClearTimerId) {
        clearTimeout(visualBridgeOverlayClearTimerId);
        visualBridgeOverlayClearTimerId = null;
    }
    visualBridgeOverlayClearRequestId++;

    try {
        if (typeof fullscreenSeamlessCleanup === 'function') {
            fullscreenSeamlessCleanup();
        }
    } catch (_) {
        // ignore
    }
    fullscreenSeamlessCleanup = null;
    seamlessGuardActive = false;
    overlayForceBlack = false;

    try {
        const oc = document.getElementById('overlay-canvas');
        if (oc) {
            const ctx = oc.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, oc.width, oc.height);
            oc.style.opacity = '0';
            oc.style.visibility = 'hidden';
            oc.style.display = 'none';
        }
    } catch (_) {
        // ignore
    }
}

// 映像ブリッジオーバーレイ遅延解除
function runScheduledVisualBridgeOverlayClear(delayMs, isCurrentToken, cleanup, reason) {
    const normalizedDelayMs = Math.max(0, Number(delayMs) || 0);
    const requestId = ++visualBridgeOverlayClearRequestId;

    if (visualBridgeOverlayClearTimerId) {
        clearTimeout(visualBridgeOverlayClearTimerId);
        visualBridgeOverlayClearTimerId = null;
    }

    visualBridgeOverlayClearTimerId = setTimeout(() => {
        visualBridgeOverlayClearTimerId = null;

        if (requestId !== visualBridgeOverlayClearRequestId) {
            return;
        }

        if (typeof isCurrentToken === 'function' && !isCurrentToken()) {
            if (typeof cleanup === 'function') {
                cleanup();
            }
            if (fullscreenSeamlessCleanup === cleanup) {
                fullscreenSeamlessCleanup = null;
            }
            return;
        }

        clearVisualBridgeOverlay();
        logDebug(`[fullscreen.js] Overlay cleared${normalizedDelayMs > 0 ? ' after delay (' + normalizedDelayMs + 'ms)' : ''}${reason ? ' [' + reason + ']' : ''}.`);
    }, normalizedDelayMs);
}

// ---------------------------
// 映像ブリッジモード適用
// ---------------------------

// 映像ブリッジ開始処理
function executeIncomingBridgeMode(incomingBridgeMode) {
    if (incomingBridgeMode === 'OVERLAY') {
        if (overlaySuppressedByPreFTB) {
            logInfo('[fullscreen.js] Overlay capture skipped due to pre-FTB suppression.');
            return;
        }

        if (isTransitionBlackHoldActive()) {
            logInfo('[fullscreen.js] Overlay capture skipped due to transition black hold.');
            return;
        }

        try {
            captureLastFrameAndHoldUntilNextReady();
        } catch (e) {
            logDebug(`[fullscreen.js] overlay capture skipped: ${e && e.message ? e.message : String(e)}`);
        }

        clearTransitionBlackHold();
        return;
    }

    if (incomingBridgeMode === 'BLACK') {
        beginTransitionBlackHold();
        return;
    }

    clearVisualBridgeOverlay();
    clearTransitionBlackHold();

    logInfo(`[fullscreen.js] Overlay capture skipped because incoming bridgeMode is ${incomingBridgeMode}.`);
}

// -------------------------
// グローバルステート初期化
// -------------------------
let globalState = {};

function setInitialData(itemData) {
    if (!itemData) {
        logInfo('[fullscreen.js] No On-Air data received to initialize.');
        return;
    }
    const defVol = (itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100);
    const masterVol = (itemData.masterVolume !== undefined ? itemData.masterVolume : 100);
    const computedVolume = ((defVol) / 100) * ((masterVol) / 100);
    const incomingBridgeMode = getIncomingBridgeMode(itemData);
    const incomingMediaKind = getIncomingMediaKind(itemData);

    globalState = {
        playlistItemId: itemData.playlistItem_id || null,
        path: itemData.path || '',
        deviceId: itemData.deviceId || null,
        uvcAudioDeviceId: itemData.uvcAudioDeviceId || null,
        inPoint: parseFloat(itemData.inPoint || 0),
        outPoint: parseFloat(itemData.outPoint || 0),
        startMode: itemData.startMode || 'PAUSE',
        endMode: itemData.endMode || 'PAUSE',
        bridgeMode: incomingBridgeMode,
        mediaKind: incomingMediaKind,
        transitionFadeOutEnabled: !!itemData.ftbEnabled,
        defaultVolume: defVol,
        masterVolume: masterVol,
        ftbRate: itemData.ftbRate || 1.0,
        startFadeInSec: (itemData.startFadeInSec !== undefined && !isNaN(parseFloat(itemData.startFadeInSec))) ? parseFloat(itemData.startFadeInSec) : undefined,
        volume: (typeof itemData.volume === 'number') ? itemData.volume : computedVolume
    };
    logInfo(`[fullscreen.js] Global state initialized with On-Air data: ${JSON.stringify(globalState)}`);
}

// ------------------------------------
// オーバーレイキャンバス初期化
// ------------------------------------
function initializeOverlayCanvas() {
    const canvas = document.getElementById('overlay-canvas');
    if (!canvas) {
        logInfo('[fullscreen.js] overlay-canvas element not found.');
        return null;
    }

    // ビューポート固定
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.margin = '0';
    canvas.style.padding = '0';

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    // 映像より上、DSKより下
    canvas.style.zIndex = '1500';

    canvas.style.pointerEvents = 'none';
    if (!canvas.style.display) {
        canvas.style.display = 'none';
        canvas.style.opacity = '1';
    }

    // drawImage 安全化
    if (!CanvasRenderingContext2D.prototype.__vtrpon_drawImagePatched) {
        CanvasRenderingContext2D.prototype.__vtrpon_drawImagePatched = true;
        const __origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(...args) {
            try {
                if (overlayForceBlack && this && this.canvas && this.canvas.id === 'overlay-canvas') {
                    return;
                }
            } catch (_) {
                // ignore
            }
            return __origDrawImage.apply(this, args);
        };
        logDebug('[fullscreen.js] drawImage patched for overlay-canvas safety.');
    }
    return canvas;
}

// ------------------------------------
// 次のメディアによるオーバレイ判定
// ------------------------------------

// mediaKind正規化
function normalizeMediaKind(mediaKind) {
    const normalizedMediaKind = String(mediaKind || '').toLowerCase();

    if (normalizedMediaKind === 'audioonly') return 'audioOnly';
    if (normalizedMediaKind === 'uvc' || normalizedMediaKind === 'video') return normalizedMediaKind;

    return 'video';
}

// 現在mediaKind取得
function getCurrentIncomingMediaKind() {
    if (!globalState) return 'video';
    return normalizeMediaKind(globalState.mediaKind);
}

// 現在startMode取得
function getResolvedStartMode() {
    return String(globalState.startMode || 'PAUSE').toUpperCase();
}

// ------------------------------------
// オーバーレイ解除判定
// ------------------------------------

// デコード済み映像フレーム判定
function hasDecodedVisualFrame(videoElement) {
    return !!(
        videoElement &&
        (videoElement.readyState >= 2) &&
        (videoElement.videoWidth | 0) > 0 &&
        (videoElement.videoHeight | 0) > 0
    );
}

// UVC解除判定
function isUvcReadyForOverlayRelease(videoElement, releaseState) {
    if (!videoElement) return false;

    if (hasDecodedVisualFrame(videoElement)) {
        return true;
    }

    const elapsed = performance.now() - releaseState.capturedAt;
    if (elapsed >= 120 && !videoElement.paused) {
        return true;
    }

    return false;
}

// 動画解除判定
function isVideoReadyForOverlayRelease(videoElement, releaseState) {
    if (!videoElement) return false;

    const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
    const nowTime = Number(videoElement.currentTime || 0);
    const inPoint = Number(globalState.inPoint || 0);
    const currentStartMode = getResolvedStartMode();
    const allowPausedReleaseAtInPoint = (currentStartMode === 'PAUSE');
    const decodedFrameReady = hasDecodedVisualFrame(videoElement);

    if (!nowSrc) return false;
    if (nowSrc !== releaseState.capturedSrc) return true;

    if (nowTime <= 0.12 && releaseState.capturedTime > 0.30) return true;

    if (nowTime + 0.25 < releaseState.capturedTime) return true;

    if (!videoElement.paused && nowTime >= inPoint + 0.08) {
        return true;
    }

    if (
        allowPausedReleaseAtInPoint &&
        videoElement.paused &&
        decodedFrameReady &&
        Math.abs(nowTime - inPoint) <= 0.12
    ) {
        return true;
    }

    const elapsed = performance.now() - releaseState.capturedAt;
    if (
        elapsed >= 120 &&
        !videoElement.paused &&
        (decodedFrameReady || nowTime >= inPoint + 0.08)
    ) {
        return true;
    }

    return false;
}

// メディア別解除判定
function isIncomingVisualItemReady(videoElement, releaseState) {
    const mediaKind = getCurrentIncomingMediaKind();

    if (mediaKind === 'audioOnly') {
        return true;
    }

    if (mediaKind === 'uvc') {
        return isUvcReadyForOverlayRelease(videoElement, releaseState);
    }

    return isVideoReadyForOverlayRelease(videoElement, releaseState);
}

// オーバレイキャプチャ可否判定
function shouldSkipOverlayCapture(videoElement, overlayCanvas) {
    if (!videoElement || !overlayCanvas) {
        logInfo('[fullscreen.js] Overlay capture skipped due to missing element.');
        return true;
    }

    const fadeCanvas = document.getElementById('fadeCanvas');
    if (fadeCanvas) {
        const cs = window.getComputedStyle(fadeCanvas);
        const fadeVisible = cs.visibility !== 'hidden' && parseFloat(cs.opacity || '0') > 0.01;
        if (fadeVisible) {
            logInfo('[fullscreen.js] Overlay capture skipped due to visible fade layer.');
            return true;
        }
    }

    const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
    const hasSrcObject = !!videoElement.srcObject;
    if (!hasSrcObject && !nowSrc) {
        return true;
    }

    return false;
}

// オーバレイキャプチャ事前状態初期化
function prepareOverlayCaptureState(overlayCanvas) {
    if (typeof fullscreenSeamlessCleanup === 'function') {
        try { fullscreenSeamlessCleanup(); } catch (_) {}
        fullscreenSeamlessCleanup = null;
    }
    overlayForceBlack = false;

    const captureToken = `${Date.now()}-${Math.random()}`;
    try { overlayCanvas.dataset.seamlessToken = captureToken; } catch (_) {}

    return () => {
        try { return overlayCanvas.dataset.seamlessToken === captureToken; } catch (_) { return true; }
    };
}

// オーバレイ解除判定用状態作成
function createOverlayReleaseState(videoElement) {
    return {
        capturedSrc: String(videoElement.currentSrc || videoElement.src || ''),
        capturedTime: Number(videoElement.currentTime || 0),
        capturedAt: performance.now()
    };
}

// オーバレイキャプチャ描画
function drawCapturedFrameToOverlay(videoElement, overlayCanvas) {
    const ctx = overlayCanvas.getContext('2d');

    try {
        const cw = overlayCanvas.width;
        const ch = overlayCanvas.height;
        const vw = Math.max(1, (videoElement.videoWidth | 0));
        const vh = Math.max(1, (videoElement.videoHeight | 0));
        const scale = Math.min(cw / vw, ch / vh);
        const dw = Math.round(vw * scale);
        const dh = Math.round(vh * scale);
        const dx = Math.floor((cw - dw) / 2);
        const dy = Math.floor((ch - dh) / 2);

        ctx.save();
        ctx.fillStyle = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(videoElement, dx, dy, dw, dh);
        ctx.restore();

        overlayCanvas.style.opacity = '1';
        overlayCanvas.style.display = 'block';
        overlayCanvas.style.visibility = 'visible';
        seamlessGuardActive = true;
    } catch (_) {
        try {
            ctx.save();
            ctx.fillStyle = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.restore();
            overlayCanvas.style.display = 'none';
        } catch (_) {}
    }
}

// オーバレイ解除監視開始
function startOverlayReleaseMonitoring(videoElement, isCurrentToken, isReadyToRelease) {

    // 監視状態
    const useRVFC = !!(videoElement && typeof videoElement.requestVideoFrameCallback === 'function');
    let rvfcCount = 0;
    let rvfcArmed = false;
    let rvfcLastPresentedFrames = 0;
    let rvfcHandle = null;
    let safetyTimerId = null;
    let overlayClearScheduled = false;

    // 解除試行
    const tryReleaseOverlay = (reason) => {
        if (!isCurrentToken()) {
            return;
        }

        if (!isReadyToRelease()) {
            return;
        }

        clearOverlay(reason);
    };

    // イベントハンドラ
    const onLoadedData = () => {
        tryReleaseOverlay('loadeddata');
    };
    const onCanPlay = () => {
        tryReleaseOverlay('canplay');
    };
    const onSeeked = () => {
        tryReleaseOverlay('seeked');
    };
    const onTimeUpdate = () => {
        tryReleaseOverlay('timeupdate');
    };

    function onPlaying() {
        if (stopIfStale()) {
            return;
        }

        if (!useRVFC) {
            tryReleaseOverlay('playing');
        }
    }

    // イベント束縛定義
    const overlayReleaseEventBindings = [
        ['playing', onPlaying],
        ['loadeddata', onLoadedData],
        ['canplay', onCanPlay],
        ['seeked', onSeeked],
        ['timeupdate', onTimeUpdate]
    ];


    // イベント解除
    const detach = () => {
        overlayReleaseEventBindings.forEach(([eventName, handler]) => {
            videoElement.removeEventListener(eventName, handler);
        });
    };

    // 監視解除
    const cleanup = () => {
        try { detach(); } catch (_) {}

        if (useRVFC && rvfcHandle && typeof videoElement.cancelVideoFrameCallback === 'function') {
            try { videoElement.cancelVideoFrameCallback(rvfcHandle); } catch (_) {}
        }
        rvfcHandle = null;

        if (safetyTimerId) {
            try { clearTimeout(safetyTimerId); } catch (_) {}
            safetyTimerId = null;
        }
    };

    // 最終クリーンアップ
    const finalizeCleanup = () => {
        cleanup();
        if (fullscreenSeamlessCleanup === cleanup) {
            fullscreenSeamlessCleanup = null;
        }
    };

    // トークン失効判定
    const stopIfStale = () => {
        if (isCurrentToken()) {
            return false;
        }

        finalizeCleanup();
        return true;
    };

    // オーバレイ解除予約
    const clearOverlay = (reason) => {
        const RELEASE_DELAY_MS = 180;

        if (overlayClearScheduled) {
            return;
        }
        overlayClearScheduled = true;

        runScheduledVisualBridgeOverlayClear(
            RELEASE_DELAY_MS,
            isCurrentToken,
            cleanup,
            reason
        );
    };

    // RVFC監視
    const rvfc = useRVFC ? (_ts, md) => {
        if (stopIfStale()) {
            return;
        }

        if (!isReadyToRelease()) {
            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
            return;
        }

        const pf = (md && typeof md.presentedFrames === 'number') ? md.presentedFrames : null;

        if (!rvfcArmed) {
            rvfcArmed = true;
            rvfcCount = 0;
            rvfcLastPresentedFrames = (pf !== null) ? pf : 0;
            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
            return;
        }

        if (pf !== null) {
            if (pf > rvfcLastPresentedFrames) {
                rvfcCount += (pf - rvfcLastPresentedFrames);
                rvfcLastPresentedFrames = pf;
            }
        } else {
            rvfcCount += 1;
        }

        if (rvfcCount >= 1) {
            tryReleaseOverlay('rvfc');
        } else {
            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
        }
    } : null;

    // 監視登録
    fullscreenSeamlessCleanup = cleanup;

    overlayReleaseEventBindings.forEach(([eventName, handler]) => {
        videoElement.addEventListener(eventName, handler);
    });

    if (useRVFC) {
        try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
    }

    // セーフティ監視
    const SAFETY_TIMEOUT_MS = 5000;
    const SAFETY_POLL_MS = 100;
    const safetyStart = performance.now();
    let safetyLogged = false;

    const safetyPoll = () => {
        if (stopIfStale()) {
            return;
        }
        if (!seamlessGuardActive) return;

        const elapsed = performance.now() - safetyStart;
        if (elapsed >= SAFETY_TIMEOUT_MS) {
            if (isReadyToRelease()) {
                tryReleaseOverlay('safety');
                return;
            }
            if (!safetyLogged) {
                safetyLogged = true;
                logInfo('[fullscreen.js] Overlay still active after safety timeout; keeping it until release condition is met.');
            }

            safetyTimerId = setTimeout(safetyPoll, 250);
            return;
        }
        safetyTimerId = setTimeout(safetyPoll, SAFETY_POLL_MS);
    };
    safetyTimerId = setTimeout(safetyPoll, SAFETY_POLL_MS);
}

// ------------------------------------
// オーバレイキャプチャ固定
// ------------------------------------
// 最終フレーム保持開始
function captureLastFrameAndHoldUntilNextReady() {
    const videoElement = document.getElementById('fullscreen-video');
    const overlayCanvas = initializeOverlayCanvas();

    if (shouldSkipOverlayCapture(videoElement, overlayCanvas)) {
        return;
    }

    const isCurrentToken = prepareOverlayCaptureState(overlayCanvas);
    const releaseState = createOverlayReleaseState(videoElement);
    const isReadyToRelease = () => {
        return isIncomingVisualItemReady(videoElement, releaseState);
    };

    drawCapturedFrameToOverlay(videoElement, overlayCanvas);
    startOverlayReleaseMonitoring(videoElement, isCurrentToken, isReadyToRelease);
}

// ---------------------------------------
// オンエアデータ処理と再生
// ---------------------------------------

// フェード中の音声処理キャンセル
function cancelAudioFade() {
    if (fullscreenGainNode) {
        const audioContext = FullscreenAudioManager.getContext();
        const currentTime = audioContext.currentTime;
        fullscreenGainNode.gain.cancelScheduledValues(currentTime);
    }
}

// オンエアデータ処理
function handleOnAirData(itemData) {
    if (!itemData) {
        logInfo('[fullscreen.js] No On-Air data received.');
        return;
    }
    stopMonitoringPlayback();
    cancelAudioFade();
    setInitialData(itemData);

    const incomingMediaKind = getCurrentIncomingMediaKind();
    const isUvc = (incomingMediaKind === 'uvc');

    if (incomingMediaKind !== 'audioOnly') {
        const videoElement = document.getElementById('fullscreen-video');
        if (videoElement) {
            try {
                videoElement.style.visibility = 'visible';
                videoElement.style.opacity = '1';
                videoElement.style.display = '';
                if (videoElement.getAttribute('data-hide-due-to-audio') === '1') {
                    videoElement.removeAttribute('data-hide-due-to-audio');
                }
            } catch (_) {
                // ignore
            }
        }
    }

    // 動画とUVCの振り分け
    if (isUvc) {
        logInfo('[fullscreen.js] Detected UVC device. Setting up UVC device stream.');
        setupUVCDevice();
        return;
    } else if (globalState.path) {
        logInfo('[fullscreen.js] Detected video file. Setting up video player.');
        setupVideoPlayer();
    } else {
        logInfo('[fullscreen.js] No valid video file or UVC device detected. Skipping setup.');
    }
    handleStartMode();
}
// --------------------------------------------
// 動画・音声ファイルをビデオプレーヤーにセット
// --------------------------------------------
function setupVideoPlayer() {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    if (!globalState.path) {
        logInfo('[fullscreen.js] No video path available in global state.');
        return;
    }

    // 動画・音声ファイルパス
    videoElement.src = getSafeFileURL(globalState.path);

    // IN点読み込み
    videoElement.currentTime = globalState.inPoint;

    // 音量設定
    const initialVolume = (globalState.volume !== undefined ? globalState.volume : (globalState.defaultVolume / 100));
    videoElement.volume = initialVolume;

    // 音声初期化
    videoElement.addEventListener('loadedmetadata', async () => {
        isMonoSource = false;
        try {
            const stream = videoElement.captureStream?.();
            const aTrack = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
            const ch = aTrack && aTrack.getSettings ? (aTrack.getSettings().channelCount || 0) : 0;

            if (ch === 1) {
                isMonoSource = true;
                logInfo('[fullscreen.js] Detected mono source (channelCount=1). Will upmix to dual-mono.');
            } else {
                logInfo('[fullscreen.js] Detected channelCount=' + ch + ' (treat as stereo path).');
            }
        } catch (e) {
            logInfo('[fullscreen.js] channelCount detection failed (fallback to stereo path): ' + e);
        }

        // 音声のみ（video trackなし）の場合は、最終フレーム保持オーバレイを即時クリアして確実に黒にする
        try {
            const vw = (videoElement.videoWidth | 0);
            const vh = (videoElement.videoHeight | 0);
            if (vw === 0 || vh === 0) {
                // 画面は黒のままにして、音だけ再生
                try {
                    videoElement.style.display = 'none';
                    videoElement.setAttribute('data-hide-due-to-audio', '1');
                } catch (_) {
                    // ignore
                }

                clearVisualBridgeOverlay();
            }
        } catch (_) {
            // ignore
        }

        // ソース切替時再バインド
        setupFullscreenAudio(videoElement);
        logDebug('[fullscreen.js] Audio (re)initialized during setupVideoPlayer.');

        // 音量適用
        // FTBトグル保持中/遷移中は「裏の再生」は続けるが、実出力音量は必ず0に固定する
        const nowMsForInitVolume = performance.now();
        const isFtbToggleTransitionActiveForInitVolume =
            nowMsForInitVolume < (fullscreenFtbToggleTransitionUntilMs || 0);
        const shouldForceMuteByFtbForInitVolume =
            fullscreenFtbToggleHoldActive || isFtbToggleTransitionActiveForInitVolume;

        const appliedInitialVolume = shouldForceMuteByFtbForInitVolume ? 0 : initialVolume;

        videoElement.volume = appliedInitialVolume;
        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(appliedInitialVolume, audioContext.currentTime);
        }

        if (shouldForceMuteByFtbForInitVolume) {
            fullscreenFtbTogglePendingVolume = initialVolume;
            fullscreenLastControlAppliedVolume = 0;
        }

        logInfo(`[fullscreen.js] Fullscreen video started with default volume: ${appliedInitialVolume}`);
    }, { once: true });

    logInfo('[fullscreen.js] Video player initialized with the following settings:');
    logDebug(`[fullscreen.js] Path: ${globalState.path}`);
    logDebug(`[fullscreen.js] IN Point: ${globalState.inPoint}`);
    logDebug(`[fullscreen.js] Default Volume: ${globalState.defaultVolume}`);
    logDebug(`[fullscreen.js] Initial Volume Applied: ${initialVolume}`);
}

// ローカルファイルパスを安全なファイルURLに変換する関数
function getSafeFileURL(filePath) {
    let normalizedPath = filePath.replace(/\\/g, '/');
    if (!/^file:\/\//.test(normalizedPath)) {
        normalizedPath = 'file:///' + normalizedPath;
    }
    let encoded = encodeURI(normalizedPath);
    encoded = encoded.replace(/#/g, '%23');
    return encoded;
}

// --------------------------------------------
// UVCストリームをビデオプレーヤーにセット
// --------------------------------------------
async function setupUVCDevice() {
    const videoElement = document.getElementById('fullscreen-video');
    const deviceId = globalState.deviceId; 

    // 要素・デバイス確認
    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    if (!deviceId) {
        logInfo('[fullscreen.js] No UVC device ID available in global state.');
        return;
    }

    try {
        // UVC音声設定取得
        let audioConstraints = false;
        try {
            const deviceSettings = await window.electronAPI.getDeviceSettings();
            const bindings = deviceSettings?.uvcAudioBindings || {};
            const boundAudioDeviceId = bindings[deviceId];

            if (boundAudioDeviceId) {
                audioConstraints = {
                    deviceId: { exact: boundAudioDeviceId },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 2
                };
                logDebug(`[fullscreen.js] UVC audio binding found for video device ${deviceId}: audio device ${boundAudioDeviceId}`);
            } else {
                logDebug(`[fullscreen.js] No UVC audio binding for video device ${deviceId}. Using video-only.`);
            }
        } catch (e) {
            logDebug('[fullscreen.js] Failed to load UVC audio binding from device settings:', e);
            audioConstraints = false;
        }

        // デバイスストリーム取得
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } },
            audio: audioConstraints
        });

        // 初期音量
        let initialVolume = (globalState.volume !== undefined
            ? globalState.volume
            : (globalState.defaultVolume / 100));

        // FTB中初期音量補正
        const nowMsForUvcInitVolume = performance.now();
        const isFtbToggleTransitionActiveForUvcInitVolume =
            nowMsForUvcInitVolume < (fullscreenFtbToggleTransitionUntilMs || 0);
        const shouldForceMuteByFtbForUvcInitVolume =
            fullscreenFtbToggleHoldActive || isFtbToggleTransitionActiveForUvcInitVolume;

        const appliedUvcInitialVolume = shouldForceMuteByFtbForUvcInitVolume ? 0 : initialVolume;

        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(appliedUvcInitialVolume, audioContext.currentTime);
        }

        if (shouldForceMuteByFtbForUvcInitVolume) {
            fullscreenFtbTogglePendingVolume = initialVolume;
            fullscreenLastControlAppliedVolume = 0;
        }
        const maxStreamGain = 1.0;
        initialVolume = Math.max(0.0, Math.min(maxStreamGain, initialVolume));
        videoElement.volume = initialVolume;

        // 既存再生ソース解除
        try {
            videoElement.pause();
        } catch (_) {
            // ignore
        }

        try {
            videoElement.removeAttribute('src');
            videoElement.src = '';
            videoElement.load();
        } catch (_) {
            // ignore
        }

        // UVCストリーム設定
        videoElement.srcObject = stream;

        // 入力音声チャンネル判定
        isMonoSource = false;
        try {
            const capture = videoElement.captureStream?.();
            const aTrack = capture && capture.getAudioTracks ? capture.getAudioTracks()[0] : null;
            const ch = aTrack && aTrack.getSettings ? (aTrack.getSettings().channelCount || 0) : 0;
            if (ch === 1) {
                isMonoSource = true;
                logInfo('[fullscreen.js] (UVC) Detected mono source (channelCount=1). Will upmix to dual-mono.');
            } else {
                logInfo('[fullscreen.js] (UVC) Detected channelCount=' + ch + ' (treat as stereo path).');
            }
        } catch (e) {
            logInfo('[fullscreen.js] (UVC) channelCount detection failed (fallback to stereo path): ' + e);
        }

        // 音声再バインド
        setupFullscreenAudio(videoElement);
        logDebug('[fullscreen.js] Audio (re)initialized during setupUVCDevice.');

        // 初期音量適用
        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(initialVolume, audioContext.currentTime);
        }

        const fadeSec = (typeof globalState.startFadeInSec === 'number' && !isNaN(globalState.startFadeInSec) && globalState.startFadeInSec > 0)
            ? globalState.startFadeInSec
            : 0.3;

        // 再生開始後処理
        const handlePlaying = () => {
            suppressIncomingUvcFadeUntilPlaying = false;
            fullscreenFadeFromBlack(fadeSec, isFillKeyMode);
            videoElement.removeEventListener('playing', handlePlaying);
            try {
                if (!isVolumeMeasurementActive) {
                    startVolumeMeasurement(60);
                    logDebug('[fullscreen.js] Volume measurement started from setupUVCDevice (playing event).');
                }
            } catch (_e) {}
        };
        videoElement.addEventListener('playing', handlePlaying, { once: true });

        // 再生開始
        await videoElement.play();
        globalState.stream = stream;
        try {
            if (!isVolumeMeasurementActive) {
                startVolumeMeasurement(60);
                logDebug('[fullscreen.js] Volume measurement started from setupUVCDevice (post-play).');
            }
        } catch (_e) {}

        // 完了ログ
        logInfo('[fullscreen.js] UVC device stream initialized successfully.');
        logDebug(`[fullscreen.js] Device ID: ${deviceId}`);

    } catch (error) {

        // エラーログ
        logInfo('[fullscreen.js] Failed to initialize UVC device stream.');
        logDebug(`[fullscreen.js] Error: ${error.message}`);
    }
}

// -------------------------
// スタートモードPLAY/PAUSE
// -------------------------
function handleStartMode() {
    const videoElement = document.getElementById('fullscreen-video');

    // 要素確認
    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    // 開始位置設定
    const resolvedStartMode = getResolvedStartMode();
    videoElement.currentTime = globalState.inPoint;

    // PAUSE処理
    if (resolvedStartMode === 'PAUSE') {
        logInfo('[fullscreen.js] Start mode is PAUSE. Video is ready to play.');
        stopVolumeMeasurement();
        return;
    }

    let fadeDur = 0;

    // PLAY処理
    if (resolvedStartMode === 'PLAY') {
        logInfo('[fullscreen.js] Start mode is PLAY. Starting playback.');

        // 遷移黒解除予約
        releaseTransitionBlackOnVideoReady(videoElement, isFillKeyMode);

    // FADEIN処理
    } else if (resolvedStartMode === 'FADEIN') {
        logInfo('[fullscreen.js] Start mode is FADEIN. Initiating fade in playback.');

        // 初期音量設定
        videoElement.volume = 0;

        // フェード時間決定
        fadeDur = (typeof globalState.startFadeInSec === 'number' && !isNaN(globalState.startFadeInSec))
            ? globalState.startFadeInSec
            : 1.0;

        // 黒フェード開始
        fullscreenFadeFromBlack(fadeDur, isFillKeyMode);

    // 不明モード
    } else {
        logInfo(`[fullscreen.js] Unknown start mode: ${resolvedStartMode}. No action taken.`);
        return;
    }

    // 再生開始
    videoElement.play()
        .then(() => {
            // FADEIN後処理
            if (resolvedStartMode === 'FADEIN') {
                audioFadeIn(fadeDur);
                logInfo('[fullscreen.js] Playback started with FADEIN effect.');
            } else {
                logInfo('[fullscreen.js] Playback started successfully.');
                window.electronAPI.sendControlToFullscreen({ command: 'play' });
            }

            // メーター開始
            startVolumeMeasurement();
        })
        .catch(error => logDebug(`[fullscreen.js] Playback failed to start: ${error.message}`));

    // OUT点監視開始
    monitorVideoPlayback();
}

// ------------------------------------------
// フェードキャンバス制御（FADEIN / Pre-FTB）
// ------------------------------------------

// フェードキャンバス作成
let fadeCanvas = document.getElementById('fullscreen-fade-canvas');
if (!fadeCanvas) {
    fadeCanvas = document.createElement('canvas');
    fadeCanvas.id = 'fullscreen-fade-canvas';
    fadeCanvas.style.position = 'fixed';
    fadeCanvas.style.top = '0';
    fadeCanvas.style.left = '0';
    fadeCanvas.style.width = '100vw';
    fadeCanvas.style.height = '100vh';
    // 黒は映像より前、ただし DSK より下
    fadeCanvas.style.zIndex = String(FS_LAYER_Z_PRE_FTB_BLACK);
    fadeCanvas.style.pointerEvents = 'none';
    fadeCanvas.style.backgroundColor = 'black';
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.visibility = 'hidden';
    document.body.appendChild(fadeCanvas);
}

// 映像フェードイン処理
function fullscreenFadeFromBlack(duration, fillKeyMode) {

    // 通常遷移の黒保持中だった場合
    if (isTransitionBlackHoldActive()) {
        let fc = document.getElementById('fadeCanvas');
        if (!fc) fc = initializeFadeCanvas();

        fc.style.visibility = 'visible';
        fc.style.display = 'block';
        fc.style.opacity = '1';
        fc.style.backgroundColor = (fillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';

        let startTime = null;
        function step(ts) {
            if (!startTime) startTime = ts;
            const elapsed = ts - startTime;
            const newOpacity = Math.max(1 - (elapsed / (duration * 1000)), 0);
            fc.style.opacity = newOpacity.toString();
            if (elapsed < duration * 1000) {
                requestAnimationFrame(step);
            } else {
                fc.style.opacity = '0';
                fc.style.display = 'block';
                fc.style.visibility = 'visible';
                clearTransitionBlackHold();

                // フェードイン完了で抑止解除
                overlaySuppressedByPreFTB = false;

                logInfo('[fullscreen.js] Fade in completed (held black released).');
            }
        }
        requestAnimationFrame(step);
        return;
    }

    // 通常時
    fadeCanvas.style.visibility = 'visible';
    fadeCanvas.style.opacity = '1';
    fadeCanvas.style.backgroundColor = (fillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';

    let startTime = null;
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const newOpacity = Math.max(1 - (elapsed / (duration * 1000)), 0);
        fadeCanvas.style.opacity = newOpacity;
        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.visibility = 'hidden';

            // フェードイン完了で抑止解除
            overlaySuppressedByPreFTB = false;

            logInfo('[fullscreen.js] Fade in completed.');
        }
    }
    requestAnimationFrame(fadeStep);
}

// 映像事前フェードアウト処理
function startPreFTB(durationSec, fillKeyMode) {
    let fadeCanvas = document.getElementById('fadeCanvas');
    if (!fadeCanvas) fadeCanvas = initializeFadeCanvas();

    overlaySuppressedByPreFTB = true;
    clearVisualBridgeOverlay();

    // 初期化
    preFtbActive = true;
    preFtbDuration = Math.max(durationSec, 0.05);
    preFtbStartTime = null;

    // 背景色
    fadeCanvas.style.backgroundColor = (fillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.display = 'block';
    fadeCanvas.style.visibility = 'visible';

    // 既存アニメーション停止
    if (preFtbRaf) {
        cancelAnimationFrame(preFtbRaf);
        preFtbRaf = null;
    }

    function step(ts) {
        if (!preFtbActive) return;
        if (!preFtbStartTime) preFtbStartTime = ts;
        const elapsed = ts - preFtbStartTime;
        const progress = Math.min(elapsed / (preFtbDuration * 1000), 1);
        fadeCanvas.style.opacity = progress.toFixed(2);

        if (progress < 1) {
            preFtbRaf = requestAnimationFrame(step);
        } else {
            preFtbRaf = null;
            beginTransitionBlackHold();
            logInfo('[fullscreen.js] Pre-FTB reached full black. Holding until fade-in.');
        }
    }
    preFtbRaf = requestAnimationFrame(step);
}


// 事前FTBのキャンセル
function cancelPreFTB() {
    preFtbActive = false;
    if (preFtbRaf) {
        cancelAnimationFrame(preFtbRaf);
        preFtbRaf = null;
    }
    clearTransitionBlackHold();
    const fadeCanvas = document.getElementById('fadeCanvas');
    if (fadeCanvas) {
        fadeCanvas.style.opacity = '0';
        fadeCanvas.style.display = 'none';
        fadeCanvas.style.visibility = 'hidden';
    }
    logInfo('[fullscreen.js] Pre-FTB canceled.');
}

// onair.jsからの指令受信
window.electronAPI.ipcRenderer.on('control', (event, data) => {
    if (data.command === 'cancel-fadeout') {
        cancelFadeOut();
        return;
    }
    if (data.command === 'fadein') {
        // シームレスガード中は映像フェード禁止
        if (seamlessGuardActive) {
            return;
        }
        // 次ソースがUVCで再生開始前は、フェードを抑止
        if (suppressIncomingUvcFadeUntilPlaying) {
            return;
        }

        let fadeDur = 1.0;
        if (typeof data.startFadeInSec === 'number' && !isNaN(data.startFadeInSec)) {
            fadeDur = data.startFadeInSec;
        } else if (typeof globalState.startFadeInSec === 'number' && !isNaN(globalState.startFadeInSec)) {
            fadeDur = globalState.startFadeInSec;
        }
        const fillKeyMode = !!data.fillKeyMode;
        logInfo('[fullscreen.js] Received fadein command with duration(sec):', fadeDur, 'fillKeyMode:', fillKeyMode);
        fullscreenFadeFromBlack(fadeDur, fillKeyMode);
    }
});

// ------------------------------------
// IN点からOUT点までの動画監視
// ------------------------------------
let playbackMonitor = null;
let fullscreenPendingEndMode = null;
let fullscreenPendingEndModeRafId = null;

// endMode発動待機停止
function fullscreenStopPendingEndModeWatcher() {
    if (fullscreenPendingEndModeRafId !== null) {
        cancelAnimationFrame(fullscreenPendingEndModeRafId);
        fullscreenPendingEndModeRafId = null;
    }
}

// OUT点到達後 endMode発動監視開始
function fullscreenStartPendingEndModeWatcher() {
    fullscreenStopPendingEndModeWatcher();

    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) return;

    const tick = () => {
        if (!fullscreenPendingEndMode) {
            fullscreenPendingEndModeRafId = null;
            return;
        }

        const duration = (typeof videoElement.duration === 'number' && !Number.isNaN(videoElement.duration) && videoElement.duration > 0)
            ? videoElement.duration
            : null;

        let effectiveOutPoint = globalState.outPoint;

        if (duration !== null && (!effectiveOutPoint || effectiveOutPoint <= 0 || effectiveOutPoint > duration)) {
            effectiveOutPoint = duration;
        }

        if (effectiveOutPoint && effectiveOutPoint > 0) {
            const currentTime = videoElement.currentTime;

            // フレーム精度監視
            if (videoElement.ended || currentTime >= effectiveOutPoint) {
                const mode = fullscreenPendingEndMode;
                fullscreenPendingEndMode = null;
                fullscreenStopPendingEndModeWatcher();

                try { stopVolumeMeasurement(); } catch (_) {}

                handleEndMode();
                return;
            }
        }

        fullscreenPendingEndModeRafId = requestAnimationFrame(tick);
    };

    fullscreenPendingEndModeRafId = requestAnimationFrame(tick);
}

// OUT点再生監視開始
function monitorVideoPlayback() {

    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found. Cannot monitor playback.');
        return;
    }

    // 監視開始
    clearInterval(playbackMonitor);
    playbackMonitor = setInterval(() => {
        const duration = (typeof videoElement.duration === 'number' && !Number.isNaN(videoElement.duration) && videoElement.duration > 0)
            ? videoElement.duration
            : null;

        let effectiveOutPoint = globalState.outPoint;

        // duration優先補正
        if (duration !== null && (!effectiveOutPoint || effectiveOutPoint <= 0 || effectiveOutPoint > duration)) {
            effectiveOutPoint = duration;
        }

        if (!effectiveOutPoint || effectiveOutPoint <= 0) {
            logDebug('[fullscreen.js] Invalid OUT point. Stopping playback monitor.');
            clearInterval(playbackMonitor);
            playbackMonitor = null;
            return;
        }

        const currentTime = videoElement.currentTime;

        if (currentTime >= effectiveOutPoint || videoElement.ended) {
            logInfo(`[fullscreen.js] OUT point reached: ${effectiveOutPoint}s (currentTime=${currentTime.toFixed(2)}s, duration=${duration !== null ? duration.toFixed(2) : 'N/A'})`);
            clearInterval(playbackMonitor);
            stopVolumeMeasurement();
            playbackMonitor = null;

        }
    }, 100);
}

// OUT点再生監視停止
function stopMonitoringPlayback() {
    clearInterval(playbackMonitor);
    playbackMonitor = null;
    logInfo('[fullscreen.js] Playback monitoring stopped.');
}

// ------------------------
// 操作情報受信
// ------------------------
window.electronAPI.ipcRenderer.on('control-video', (event, commandData) => {
    const fullscreenVideoElement = document.getElementById('fullscreen-video');

    // 要素確認
    if (!fullscreenVideoElement) {
        logInfo("[fullscreen.js] videoElement not found, ignoring control command.");
        return;
    }

    try {
        // コマンド取得
        const { command, value } = commandData;

        if (command !== 'set-volume') {
            logDebug(`[fullscreen.js] Received control command: ${command}, value: ${value}`);
        }

        // コマンド分岐
        switch (command) {
            // 再生制御
            case 'play':
                fullscreenVideoElement.play();
                monitorVideoPlayback(); 
                startVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video playing and monitoring started.');
                break;
            case 'pause':
                fullscreenVideoElement.pause();
                stopMonitoringPlayback(); 
                stopVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video paused and monitoring stopped.');
                break;
            case 'stop':
                fullscreenVideoElement.pause();
                fullscreenVideoElement.currentTime = 0;
                stopMonitoringPlayback();
                stopVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video stopped and monitoring stopped.');
                break;

            // シーク制御
            case 'seek':
                fullscreenVideoElement.currentTime = value;
                logDebug(`[fullscreen.js] Fullscreen video seeked to: ${value}`);

                if (value >= globalState.outPoint) {
                    fullscreenVideoElement.pause();
                    stopMonitoringPlayback();
                    logInfo('[fullscreen.js] Seeked beyond OUT point. Playback and monitoring stopped.');
                } else if (!fullscreenVideoElement.paused) {
                    monitorVideoPlayback();
                }
                break;

            // 音量制御
            case 'set-volume':
                if (value >= 0 && value <= 1) {
                    let clamped = Math.min(1, Math.max(0, value));
                    if (clamped <= FULLSCREEN_SET_VOLUME_ENDPOINT_SNAP_EPSILON) {
                        clamped = 0;
                    } else if (clamped >= (1 - FULLSCREEN_SET_VOLUME_ENDPOINT_SNAP_EPSILON)) {
                        clamped = 1;
                    }

                    const isEndpoint = (clamped === 0 || clamped === 1);
                    if (
                        !isEndpoint &&
                        fullscreenLastControlAppliedVolume !== null &&
                        Math.abs(clamped - fullscreenLastControlAppliedVolume) < FULLSCREEN_SET_VOLUME_EPSILON
                    ) {
                        fullscreenFtbTogglePendingVolume = null;
                        break;
                    }

                    if (fullscreenVideoElement) {
                        fullscreenVideoElement.volume = clamped;
                    }

                    if (fullscreenGainNode) {
                        const audioContext = FullscreenAudioManager.getContext();
                        const t = audioContext.currentTime;
                        fullscreenGainNode.gain.cancelScheduledValues(t);
                        fullscreenGainNode.gain.setValueAtTime(clamped, t);
                    }

                    fullscreenLastControlAppliedVolume = clamped;
                    fullscreenFtbTogglePendingVolume = null;
                } else {
                    logInfo(`[fullscreen.js] Invalid volume value: ${value}. Must be between 0 and 1.`);
                }
                break;

            // 再生速度制御
            case 'set-playback-speed':
                fullscreenVideoElement.playbackRate = value;
                logDebug(`[fullscreen.js] Fullscreen playback speed set to: ${value}`);
                break;

            // フェード制御
            case 'cancel-fadeout':
                cancelFadeOut();
                break;
            case 'offAir':
                logInfo('[fullscreen.js]  Received offAir command.');
                initializeFullscreenArea(null);
                stopMonitoringPlayback();
                stopVolumeMeasurement();
                break;

            // FillKey制御
            case 'set-fillkey-bg':
                if (value && value.trim() !== "") {
                    isFillKeyMode = true;
                    fillKeyBgColor = value;
                    fullscreenVideoElement.style.setProperty("background-color", value, "important");
                } else {
                    isFillKeyMode = false;
                    fillKeyBgColor = "";
                    fullscreenVideoElement.style.removeProperty("background-color");
                }
                try {
                    const fadeCanvas = document.getElementById('fadeCanvas');
                    if (fadeCanvas) {
                        fadeCanvas.style.backgroundColor = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
                    }
                } catch (_) {
                    // ignore
                }

                logDebug(`[fullscreen.js] Fullscreen fillkey background set to: ${value}`);
                break;

            // EndMode制御
            case 'trigger-endMode':
                const receivedEndMode = value || 'PAUSE';
                logInfo(`[fullscreen.js]  Triggering end mode: ${receivedEndMode}`);

                if (typeof commandData.startMode === 'string' && commandData.startMode.trim() !== '') {
                    const newStart = commandData.startMode.toUpperCase();
                    if ((globalState.startMode || '').toUpperCase() !== newStart) {
                        logDebug(`[fullscreen.js] Updating globalState.startMode to ${newStart} (via trigger-endMode)`);
                        globalState.startMode = newStart;
                    }
                }
                if (globalState.endMode !== receivedEndMode) {
                    logDebug(`[fullscreen.js] Updating globalState.endMode from ${globalState.endMode} to ${receivedEndMode}`);
                    globalState.endMode = receivedEndMode;
                }

                // フェードアウト即時実行
                if (receivedEndMode === 'FTB') {
                    fullscreenPendingEndMode = null;
                    fullscreenStopPendingEndModeWatcher();
                    handleEndModeFTB();
                    break;
                }

                fullscreenPendingEndMode = receivedEndMode;
                fullscreenStartPendingEndModeWatcher();
                break;

            // FTBトグル制御
            case 'ftb-toggle-hold':
                {
                    const active = !!(value && value.active);
                    const dur = (value && typeof value.duration === 'number')
                        ? value.duration
                        : (globalState.ftbRate || 1.0);
                    const fk = !!(value && value.fillKeyMode);
                    const fkColor = (value && typeof value.fillKeyColor === 'string') ? value.fillKeyColor : '';
                    const keepPlaying = !!(value && value.keepPlaying);
                    const audioTargetLinear = (value && typeof value.audioTargetLinear === 'number')
                        ? value.audioTargetLinear
                        : (active ? 0 : 1);

                    fullscreenFtbToggleShouldKeepPlaying = keepPlaying;

                    fullscreenFtbToggleHoldActive = active;
                    fullscreenLastControlAppliedVolume = null;

                    fullscreenFtbToggleTransitionUntilMs = performance.now() + (Math.max(0, Number(dur) || 0) * 1000) + 50;
                    logInfo(`[fullscreen.js] ftb-toggle-hold: active=${active}, duration=${dur}s, fillKeyMode=${fk}, keepPlaying=${keepPlaying}, audioTargetLinear=${audioTargetLinear}`);
                    setFullscreenFtbToggleHoldVisual(active, dur, fk, fkColor);

                    if (fullscreenFtbToggleAudioRaf !== null) {
                        cancelAnimationFrame(fullscreenFtbToggleAudioRaf);
                        fullscreenFtbToggleAudioRaf = null;
                    }
                    fullscreenFtbToggleAudioAnimSeq += 1;

                    if (!active && fullscreenFtbToggleShouldKeepPlaying && fullscreenVideoElement && fullscreenVideoElement.paused) {
                        try {
                            const p = fullscreenVideoElement.play();
                            if (p && typeof p.catch === 'function') {
                                p.catch(() => {});
                            }
                        } catch (_) {
                            // ignore
                        }
                    }
                    if (!active) {
                        fullscreenFtbTogglePendingVolume = null;
                    }
                }
                break;


            // pre-FTB制御
            case 'start-pre-ftb':
                {
                    const dur = (value && typeof value.duration === 'number') ? value.duration : (globalState.ftbRate || 1.0);
                    const fk  = (value && !!value.fillKeyMode) ? true : false;
                    logInfo(`[fullscreen.js] start-pre-ftb: duration=${dur}s, fillKeyMode=${fk}`);
                    startPreFTB(dur, fk);
                }
                break;
            case 'cancel-pre-ftb':
                cancelPreFTB();
                break;

            // 黒フェード制御
            case 'fade-from-black':
                {
                    const dur = (value && typeof value.duration === 'number') ? value.duration : (globalState.ftbRate || 0.3);
                    const fk  = (value && !!value.fillKeyMode) ? true : false;
                    if (seamlessGuardActive) {
                        logInfo('[fullscreen.js] fade-from-black skipped due to seamless guard.');
                        break;
                    }
                    if (suppressIncomingUvcFadeUntilPlaying) {
                        logInfo('[fullscreen.js] fade-from-black skipped due to incoming UVC.');
                        break;
                    }
                    logInfo(`[fullscreen.js] fade-from-black: duration=${dur}s, fillKeyMode=${fk}`);
                    cancelPreFTB();
                    fullscreenFadeFromBlack(dur, fk);
                }
                break;

            // 録画制御
            case 'start-recording':
                {
                    const videoElement = document.getElementById('fullscreen-video');
                    if (videoElement) {
                        window.recorder.startRecording(videoElement);
                        logInfo('[fullscreen.js] Start recording initiated.');
                    } else {
                        logInfo('[fullscreen.js] fullscreen-video element not found.');
                    }
                }
                break;
            case 'stop-recording':
                window.recorder.stopRecording()
                    .then(async () => {
                        const savedPath = await window.recorder.saveRecording();
                        logInfo('[fullscreen.js] Recording saved: ' + savedPath);
                    })
                    .catch(error => {
                        logInfo('[fullscreen.js] Recording stop error: ' + error.message);
                    });
                break;

            // DSK制御
            case 'DSK_PAUSE':
                pauseFullscreenDSK();
                logDebug('[fullscreen.js] Fullscreen DSK paused.');
                break;
            case 'DSK_PLAY':
                playFullscreenDSK();
                logDebug('[fullscreen.js] Fullscreen DSK playing.');
                break;

            // 不明コマンド
            default:
                logInfo(`[fullscreen.js] Unknown command received: ${command}`);
        }
    } catch (error) {
        // 例外処理
        logInfo("[fullscreen.js] Error handling control-video event:", error);
    }
});

// ------------------------------------
 // エンドモード振り分け
// ------------------------------------
function handleEndMode() {
    logInfo(`[fullscreen.js] endmode status: ${globalState.endMode} `);

    switch (globalState.endMode) {
        case 'OFF':
            handleEndModeOFF();
            break;
        case 'PAUSE':
            handleEndModePAUSE();
            break;
        case 'FTB':
            handleEndModeFTB();
            break;
        case 'REPEAT':
            handleEndModeREPEAT();
            break;
        case 'NEXT':
            handleEndModeNEXT();
            break;
        case 'UVC':
            break;
        default:
            logInfo(`[fullscreen.js] Unknown endmode: ${globalState.endMode}`);
    }
}

// ------------------------------------
// エンドモードOFF
// ------------------------------------
function handleEndModeOFF() {
    logInfo('[fullscreen.js] Called endmode:OFF');
    stopVolumeMeasurement();
    initializeFullscreenArea('transition');
    logInfo('[fullscreen.js] Initialized fullscreen area.');
}

// ------------------------------------
// エンドモードPAUSE
// ------------------------------------
function handleEndModePAUSE() {
    logInfo('[fullscreen.js] Called endmode:PAUSE');

    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video element not found. Unable to pause video.');
        return;
    }

    videoElement.pause();
    stopVolumeMeasurement();
    logInfo('[fullscreen.js] Video paused.');
}

// ------------------------------------
// エンドモードFADEOUT
// ------------------------------------
function handleEndModeFTB() {
    const fadeDuration = globalState.ftbRate || 1;

    logInfo(`[fullscreen.js] Starting FTB: Fade duration is ${fadeDuration} seconds.`);

    // DSK表示中背面映像停止
    try {
        const videoElement = document.getElementById('fullscreen-video');
        const dskVisible = !!(
            (typeof window.fsDSKActive !== 'undefined' && window.fsDSKActive) ||
            (fsDSKOverlay && fsDSKOverlay.style && fsDSKOverlay.style.visibility === 'visible')
        );
        if (dskVisible && videoElement) {
            try { videoElement.pause(); } catch (_) {}
            videoElement.style.visibility = 'hidden';
            videoElement.style.opacity = '0';
        }
    } catch (_) {
        // ignore
    }

    // フェードキャンバス取得
    let fadeCanvas = document.getElementById('fadeCanvas');
    if (!fadeCanvas) {
        logInfo('[fullscreen.js] Fade canvas not found. Reinitializing canvas.');
        fadeCanvas = initializeFadeCanvas();
    }

    // 事前フェードアウト完了済み処理
    if (
        preFtbActive ||
        (fullscreenBlackHoldActive && fullscreenBlackHoldKind === 'transition')
    ) {
        preFtbActive = false;
        if (preFtbRaf) {
            cancelAnimationFrame(preFtbRaf);
            preFtbRaf = null;
        }
        initializeFullscreenArea('ftb');
        fadeCanvas.style.opacity = '0';
        fadeCanvas.style.display = 'none';
        fadeCanvas.style.visibility = 'hidden';
        stopVolumeMeasurement();
        logInfo('[fullscreen.js] FTB complete: Pre-FTB already at black. Finalized immediately.');
        return;
    }

    // 既存フェードアウト監視停止
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
    }
    fadeCancelled = false;

    // フェードキャンバス初期化
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.display = 'block';
    fadeCanvas.style.visibility = 'visible';

    // 背景色設定
    fadeCanvas.style.backgroundColor = isFillKeyMode && fillKeyBgColor ? fillKeyBgColor : "black";

    // レイヤー順設定
    fadeCanvas.style.zIndex = '8000';

    // フェード設定
    const durationMs = Math.max(fadeDuration, 0.05) * 1000;
    const startTime = performance.now();
    const frameInterval = 1000 / 60;

    // フェード監視開始
    ftbFadeInterval = setInterval(() => {
        if (fadeCancelled) {
            clearInterval(ftbFadeInterval);
            ftbFadeInterval = null;
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.display = 'none';
            fadeCanvas.style.visibility = 'hidden';
            logInfo('[fullscreen.js] FTB fadeout aborted due to cancellation.');
            return;
        }

        const now = performance.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);

        fadeCanvas.style.opacity = progress.toFixed(2);

        if (progress >= 1) {
            clearInterval(ftbFadeInterval);
            ftbFadeInterval = null;

            logInfo('[fullscreen.js] FTB complete: Fade ended.');

            // フルスクリーン初期化
            initializeFullscreenArea('ftb');

            // フェードキャンバス後処理
            if (!(fullscreenBlackHoldActive && fullscreenBlackHoldKind === 'transition')) {
                fadeCanvas.style.opacity = '0';
                fadeCanvas.style.display = 'none';
                fadeCanvas.style.visibility = 'hidden';
                logInfo('[fullscreen.js] FTB complete: Canvas hidden.');
            } else {
                logInfo('[fullscreen.js] FTB complete: Holding black until next playback.');
            }

            // 音量測定停止
            stopVolumeMeasurement();
        }
    }, frameInterval);
}

// フェードアウト中断
function cancelFadeOut() {
    fadeCancelled = true;
    const fadeCanvas = document.getElementById('fadeCanvas');

    // フェードアウト監視停止
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
        logInfo('[fullscreen.js] FTB fadeout canceled.');
    }
    if (fadeCanvas) {
        // 遷移黒保持判定
        const keepBlackHold = !!(
            typeof fullscreenBlackHoldActive !== 'undefined' &&
            fullscreenBlackHoldActive &&
            fullscreenBlackHoldKind === 'transition'
        );

        // フェードキャンバス非表示
        if (!keepBlackHold) {
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.display = 'none';
        }
    }
}

// REPEATオーバレイブリッジ判定
function shouldUseRepeatOverlayBridge(effectiveRepeatStartMode) {
    if (effectiveRepeatStartMode !== 'PLAY') {
        return false;
    }

    if (globalState.transitionFadeOutEnabled) {
        return false;
    }

    if (preFtbActive) {
        return false;
    }

    if (isTransitionBlackHoldActive()) {
        return false;
    }

    return true;
}

// REPEAT bridgeMode解決
function resolveRepeatBridgeMode(repeatStartMode) {
    if (repeatStartMode === 'FADEIN') {
        return 'BLACK';
    }

    if (shouldUseRepeatOverlayBridge(repeatStartMode)) {
        return 'OVERLAY';
    }

    return 'NONE';
}

// ------------------------------------
// エンドモード REPEAT
// ------------------------------------
function handleEndModeREPEAT() {
    const videoElement = document.getElementById('fullscreen-video');

    // 要素確認
    if (!videoElement) {
        logInfo('[fullscreen.js] Video element not found. Cannot handle REPEAT mode.');
        return;
    }

    // 開始モード取得
    const repeatStartMode = getResolvedStartMode();

    // bridgeMode決定
    const repeatBridgeMode = resolveRepeatBridgeMode(repeatStartMode);
    executeIncomingBridgeMode(repeatBridgeMode);

    // 状態更新
    globalState.startMode = repeatStartMode;
    logInfo(`[fullscreen.js] End Mode: REPEAT - Replaying the same item with startMode=${repeatStartMode}, bridgeMode=${repeatBridgeMode}.`);

    // 再開
    handleStartMode();
}
// ------------------------------------
// エンドモード NEXT/GOTO
// ------------------------------------
function handleEndModeNEXT() {
    logInfo('[fullscreen.js] Called endmode:NEXT - waiting for incoming transitionPlan.');

    return;
}

// ------------------------------------
// 音声処理
// ------------------------------------

// AudioContext管理
const FullscreenAudioManager = (function () {
    let audioContext = null;

    return {
        getContext: function () {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            return audioContext;
        },
        resetContext: function () {
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }
        },
    };
})();

// 音声処理状態
let fullscreenAnalyserL = null;
let fullscreenAnalyserR = null;
let fullscreenSplitter = null;
let fullscreenMerger   = null;
let fullscreenGainNode = null;
let fullscreenUpmixNode = null;
let fullscreenSourceNode = null;
let fullscreenElementSourceNode = null;
let fullscreenStreamSourceNode = null; // UVC/ND
let fullscreenSourceKind = null;
let fullscreenMediaDest = null;
let fullscreenLingerTimerId = null;
setupFullscreenAudio.initialized = false; // 音声初期化フラグ

// 音声初期化
function setupFullscreenAudio(videoElement) {
    const audioContext = FullscreenAudioManager.getContext();

    // 既存音声チェーン解除
    if (setupFullscreenAudio.initialized) {
        try { if (fullscreenSourceNode) fullscreenSourceNode.disconnect(); } catch (_e) {}
        try { if (fullscreenGainNode) fullscreenGainNode.disconnect(); } catch (_e) {}
        try { if (fullscreenUpmixNode) fullscreenUpmixNode.disconnect(); } catch (_e) {}
        try { if (fullscreenSplitter) fullscreenSplitter.disconnect(); } catch (_e) {}
        try { if (fullscreenMerger) fullscreenMerger.disconnect(); } catch (_e) {}
    }

    // 解析・ゲインノード初期化
    if (!fullscreenAnalyserL) {
        fullscreenAnalyserL = audioContext.createAnalyser();
        fullscreenAnalyserL.fftSize = 2048;
    }
    if (!fullscreenAnalyserR) {
        fullscreenAnalyserR = audioContext.createAnalyser();
        fullscreenAnalyserR.fftSize = 2048;
    }
    if (!fullscreenGainNode) {
        fullscreenGainNode = audioContext.createGain();
    }
    if (!fullscreenSplitter) {
        fullscreenSplitter = audioContext.createChannelSplitter(2);
    }
    if (!fullscreenMerger) {
        fullscreenMerger = audioContext.createChannelMerger(2);
    }

    // ソースノード再構築
    if (fullscreenSourceNode) {
        try {
            fullscreenSourceNode.disconnect();
        } catch (_e) {}
        fullscreenSourceNode = null;
    }

    try {
        // 入力ソース選択
        if (videoElement.srcObject instanceof MediaStream) {
            if (fullscreenStreamSourceNode) {
                try {
                    fullscreenStreamSourceNode.disconnect();
                } catch (_e) {}
                fullscreenStreamSourceNode = null;
            }
            fullscreenStreamSourceNode = audioContext.createMediaStreamSource(videoElement.srcObject);
            fullscreenSourceNode = fullscreenStreamSourceNode;
            fullscreenSourceKind = 'stream';
            logDebug('[fullscreen.js] Using MediaStreamSource for fullscreen audio.');
        } else {
            if (!fullscreenElementSourceNode) {
                fullscreenElementSourceNode = audioContext.createMediaElementSource(videoElement);
            }
            fullscreenSourceNode = fullscreenElementSourceNode;
            fullscreenSourceKind = 'element';
            logDebug('[fullscreen.js] Using MediaElementSource for fullscreen audio.');
        }

        // analyser経路接続
        fullscreenSourceNode.connect(fullscreenGainNode);

        // upmix経路初期化
        if (!fullscreenUpmixNode) {
            fullscreenUpmixNode = audioContext.createGain();
            fullscreenUpmixNode.channelCountMode = 'explicit';
            fullscreenUpmixNode.channelCount = 2;
            fullscreenUpmixNode.channelInterpretation = 'speakers';
        }
        fullscreenGainNode.connect(fullscreenUpmixNode);
        fullscreenUpmixNode.connect(fullscreenSplitter);
        fullscreenSplitter.connect(fullscreenAnalyserL, 0);
        fullscreenSplitter.connect(fullscreenAnalyserR, 1);
    } catch (error) {
        logInfo('[fullscreen.js] Error creating fullscreen audio source node:', error);
    }

    // 出力先作成
    const mediaStreamDest = audioContext.createMediaStreamDestination();
    fullscreenMediaDest = mediaStreamDest;

    // 出力経路切替
    try { fullscreenGainNode.disconnect(mediaStreamDest); } catch (_e) {}
    try { fullscreenMerger.disconnect && fullscreenMerger.disconnect(mediaStreamDest); } catch (_e) {}
    try { fullscreenUpmixNode && fullscreenUpmixNode.disconnect(mediaStreamDest); } catch (_e) {}

    if (isMonoSource && fullscreenMerger) {
        try { fullscreenMerger.connect(mediaStreamDest); } catch (_e) {}
        try {
            fullscreenGainNode.connect(fullscreenMerger, 0, 0);
            fullscreenGainNode.connect(fullscreenMerger, 0, 1);
        } catch (_e) {}
    } else {
        if (fullscreenUpmixNode) {
            try { fullscreenUpmixNode.connect(mediaStreamDest); } catch (_e) {}
        } else {
            // フォールバック
            try { fullscreenGainNode.connect(mediaStreamDest); } catch (_e) {}
        }
    }

    // 隠しaudio要素取得
    let hiddenAudio = document.getElementById('fullscreen-hidden-audio');
    if (!hiddenAudio) {
        hiddenAudio = document.createElement('audio');
        hiddenAudio.id = 'fullscreen-hidden-audio';
        hiddenAudio.style.display = 'none';
        document.body.appendChild(hiddenAudio);
    }
    hiddenAudio.srcObject = mediaStreamDest.stream;

    window.fullscreenAudioStream = mediaStreamDest.stream;

    // 出力先設定
    window.electronAPI.getDeviceSettings().then(async settings => {
        const outputDeviceId = (settings && settings.onairAudioOutputDevice) ? settings.onairAudioOutputDevice : 'default';

        // AudioContext再開
        try {
            const ctx = FullscreenAudioManager.getContext();
            if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                await ctx.resume();
            }
        } catch (_e) {}

        // 出力デバイス適用
        try {
            if (hiddenAudio.setSinkId) {
                await hiddenAudio.setSinkId(outputDeviceId);
                logDebug('[fullscreen.js] Hidden audio output routed to device: ' + outputDeviceId);
            } else {
                logInfo('[fullscreen.js] hiddenAudio.setSinkId is not supported.');
            }
        } catch (err) {
            logInfo('[fullscreen.js] Failed to set hidden audio output device: ' + err);
        }

        // 隠しaudio再生
        try {
            await hiddenAudio.play();
        } catch (err) {
            logInfo('[fullscreen.js] Hidden audio play failed: ' + err);

            // 隠しaudio再作成リトライ
            try {
                const old = hiddenAudio;
                const parent = old.parentNode;

                hiddenAudio = document.createElement('audio');
                hiddenAudio.id = 'fullscreen-hidden-audio';
                hiddenAudio.style.display = 'none';
                if (parent) {
                    parent.removeChild(old);
                    parent.appendChild(hiddenAudio);
                } else {
                    document.body.appendChild(hiddenAudio);
                }

                hiddenAudio.srcObject = mediaStreamDest.stream;

                try {
                    if (hiddenAudio.setSinkId) {
                        await hiddenAudio.setSinkId(outputDeviceId);
                        logDebug('[fullscreen.js] Hidden audio output routed to device (retry): ' + outputDeviceId);
                    }
                } catch (e2) {
                    logInfo('[fullscreen.js] Failed to set hidden audio output device (retry): ' + e2);
                }

                await hiddenAudio.play();
            } catch (e3) {
                logInfo('[fullscreen.js] Hidden audio retry failed: ' + e3);
            }
        }
    });

    // 初期化完了
    setupFullscreenAudio.initialized = true;

    const video = document.getElementById('fullscreen-video');
    if (video && !video.__vtrponAudioResumeBound) {
        // 再開イベント登録
        video.__vtrponAudioResumeBound = true;

        const resumeMeasure = () => {
            try {
                // 遅延停止解除
                if (typeof fullscreenLingerTimerId !== 'undefined' && fullscreenLingerTimerId) {
                    clearTimeout(fullscreenLingerTimerId);
                    fullscreenLingerTimerId = null;
                }
                const ctx = FullscreenAudioManager.getContext();
                if (fullscreenGainNode) {
                    const nowMs = performance.now();
                    const isFtbToggleTransitionActive = nowMs < (fullscreenFtbToggleTransitionUntilMs || 0);

                    // ゲイン復元
                    if (!fullscreenFtbToggleHoldActive && !isFtbToggleTransitionActive) {
                        const t = ctx.currentTime;
                        const rawGain = (typeof globalState.volume === 'number')
                            ? globalState.volume
                            : (globalState?.defaultVolume ?? 100) / 100;

                        const maxGain = (fullscreenSourceKind === 'stream') ? 0.5 : 4.0;
                        const targetGain = Math.max(0.001, Math.min(maxGain, rawGain));

                        fullscreenGainNode.gain.cancelScheduledValues(t);
                        fullscreenGainNode.gain.setValueAtTime(0.0001, t);
                        fullscreenGainNode.gain.linearRampToValueAtTime(targetGain, t + 0.03);
                    } else {
                        logDebug('[fullscreen.js] resumeMeasure skipped gain restore due to FTB toggle hold/transition.');
                    }
                }
            } catch (_e) {}

            // メーター再開
            try { startVolumeMeasurement(60); } catch (_e) {}
        };

        video.addEventListener('playing',  resumeMeasure, { passive: true });
        video.addEventListener('canplay',  resumeMeasure, { passive: true });
        video.addEventListener('seeked',   resumeMeasure, { passive: true });
    }

    // 初期メーター開始
    try {
        if (!isVolumeMeasurementActive && fullscreenAnalyserL && fullscreenAnalyserR) {
            startVolumeMeasurement(60);
            logDebug('[fullscreen.js] Volume measurement started from setupFullscreenAudio.');
        }
    } catch (_e) {}
}

// Device Settings更新時出力先更新
window.electronAPI.ipcRenderer.on('device-settings-updated', (event, newSettings) => {
    const newOutputDeviceId = newSettings.onairAudioOutputDevice;
    let hiddenAudio = document.getElementById('fullscreen-hidden-audio');
    if (hiddenAudio && hiddenAudio.setSinkId) {
        hiddenAudio.setSinkId(newOutputDeviceId)
            .then(() => {
                logDebug('[fullscreen.js] Hidden audio output updated to device: ' + newOutputDeviceId);
            })
            .catch(err => {
                logInfo('[fullscreen.js] Failed to update hidden audio output device: ' + err);
            });
    } else {
        logInfo('[fullscreen.js] hiddenAudio.setSinkId is not supported or hidden audio element not found.');
    }
});

// 音声フェードイン
function audioFadeIn(duration) {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) return;

    // FTB競合判定
    const nowMs = performance.now();
    const isFtbToggleTransitionActive = nowMs < (fullscreenFtbToggleTransitionUntilMs || 0);
    if (fullscreenFtbToggleHoldActive || isFtbToggleTransitionActive) {
        logDebug('[fullscreen.js] audioFadeIn skipped due to FTB toggle hold/transition (FTB audio fade takes priority).');
        return;
    }

    // ゲイン未使用時処理
    if (!fullscreenGainNode) {
        videoElement.volume = globalState.defaultVolume / 100;
        return;
    }

    const audioContext = FullscreenAudioManager.getContext();
    const currentTime = audioContext.currentTime;
    const targetGain = globalState.defaultVolume / 100;

    // 無音時処理
    if (targetGain <= 0) {
        fullscreenGainNode.gain.cancelScheduledValues(currentTime);
        fullscreenGainNode.gain.setValueAtTime(0, currentTime);
        return;
    }

    // フェードイン開始
    const initialGain = 0.001;
    fullscreenGainNode.gain.cancelScheduledValues(currentTime);
    fullscreenGainNode.gain.setValueAtTime(initialGain, currentTime);
    fullscreenGainNode.gain.exponentialRampToValueAtTime(targetGain, currentTime + duration);
}

// ------------------------------------
// 音量メータデータ送信
// ------------------------------------

// 音量測定状態
let isVolumeMeasurementActive = false;

// メーター計測開始
function startVolumeMeasurement(updateInterval = 60) {
    const audioContext = FullscreenAudioManager.getContext();

    // analyser初期化
    if (!fullscreenAnalyserL) {
        fullscreenAnalyserL = audioContext.createAnalyser();
        fullscreenAnalyserL.fftSize = 2048;
    }
    if (!fullscreenAnalyserR) {
        fullscreenAnalyserR = audioContext.createAnalyser();
        fullscreenAnalyserR.fftSize = 2048;
    }

    // 多重起動防止
    if (isVolumeMeasurementActive) {
        return;
    }

    isVolumeMeasurementActive = true;
    logDebug('[fullscreen.js] Volume measurement loop started.');

    // ゲイン復元
    try {
        const nowMs = performance.now();
        const isFtbToggleTransitionActive = nowMs < (fullscreenFtbToggleTransitionUntilMs || 0);

        if (!fullscreenFtbToggleHoldActive && !isFtbToggleTransitionActive) {
            const t = audioContext.currentTime;
            const rawGain = (typeof globalState.volume === 'number')
                ? globalState.volume
                : (globalState.defaultVolume ?? 100) / 100;

            // ゲイン上限決定
            const maxGain = (fullscreenSourceKind === 'stream') ? 1.0 : 4.0;
            const targetGain = Math.max(0.001, Math.min(maxGain, rawGain));

            if (fullscreenGainNode) {
                fullscreenGainNode.gain.cancelScheduledValues(t);
                fullscreenGainNode.gain.setValueAtTime(targetGain, t);
            }
        } else {
            logDebug('[fullscreen.js] startVolumeMeasurement skipped gain restore due to FTB toggle hold/transition.');
        }
    } catch (_e) {}

    // analyser設定
    try { fullscreenAnalyserL.fftSize = 2048; } catch (_e) {}
    try { fullscreenAnalyserR.fftSize = 2048; } catch (_e) {}

    const bufL = new Float32Array(fullscreenAnalyserL.fftSize);
    const bufR = new Float32Array(fullscreenAnalyserR.fftSize);

    // 更新間隔補正
    let effectiveInterval = updateInterval;
    try {
        const videoEl = document.getElementById('fullscreen-video');
        if (videoEl && videoEl.playbackRate && videoEl.playbackRate >= 2) {
            effectiveInterval = Math.max(updateInterval, 120);
        }
    } catch (_e) {}

    let skipFrames = 3;
    const minDb = -60;
    const maxDb = 0;


    // 計測ループ
    const intervalId = setInterval(() => {
        if (!isVolumeMeasurementActive) {
            clearInterval(intervalId);
            return;
        }

        // analyser消失時停止
        if (!fullscreenAnalyserL || !fullscreenAnalyserR) {
            clearInterval(intervalId);
            isVolumeMeasurementActive = false;
            logInfo('[fullscreen.js] Analyser nodes missing. Volume measurement loop aborted.');
            return;
        }

        // Lピーク計測
        fullscreenAnalyserL.getFloatTimeDomainData(bufL);
        let peakL = 0.0;
        for (let i = 0; i < bufL.length; i++) {
            const v = Math.abs(bufL[i]);
            if (v > peakL) peakL = v;
        }

        // Rピーク計測
        fullscreenAnalyserR.getFloatTimeDomainData(bufR);
        let peakR = 0.0;
        for (let i = 0; i < bufR.length; i++) {
            const v = Math.abs(bufR[i]);
            if (v > peakR) peakR = v;
        }

        // dB変換
        let dbL = 20 * Math.log10(Math.max(peakL, 1e-9));
        let dbR = 20 * Math.log10(Math.max(peakR, 1e-9));

        // 初期フレーム補正
        if (skipFrames > 0) {
            skipFrames--;
            dbL = minDb;
            dbR = minDb;
        }

        // dB範囲制限
        dbL = Math.min(maxDb, Math.max(minDb, dbL));
        dbR = Math.min(maxDb, Math.max(minDb, dbR));

        // モノラル補正
        const reportR = isMonoSource ? dbL : dbR;

        // main送信
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level-lr', { L: dbL, R: reportR });
        const dbMax = Math.max(dbL, reportR);
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level', dbMax);

    }, effectiveInterval);
}

// 音量測定停止
function stopVolumeMeasurement(lingerMs = 200) {
    // 既存停止タイマー解除
    if (fullscreenLingerTimerId) {
        clearTimeout(fullscreenLingerTimerId);
        fullscreenLingerTimerId = null;
    }
    if (!isVolumeMeasurementActive) return;

    const ctx = FullscreenAudioManager.getContext();
    try {
        // ゲイン減衰
        if (fullscreenGainNode) {
            const t = ctx.currentTime;
            fullscreenGainNode.gain.cancelScheduledValues(t);
            fullscreenGainNode.gain.linearRampToValueAtTime(0.0001, t + Math.min(lingerMs, 300) / 1000);
        }
    } catch (_e) {}

    // 停止タイマー開始
    fullscreenLingerTimerId = setTimeout(() => {
        fullscreenLingerTimerId = null;
        isVolumeMeasurementActive = false;
        logDebug('[fullscreen.js] Volume measurement stopped after linger.');
    }, Math.max(0, lingerMs));
}

// ----------------------------------------
// スクリーンショット機能
// ----------------------------------------

// スクリーンショット要求受信(Shift+S)
window.electronAPI.ipcRenderer.on('capture-screenshot', () => {
    captureScreenshot();
});

// スクリーンショット保存
function captureScreenshot() {
    const videoElement = document.getElementById('fullscreen-video');

    // 要素確認
    if (!videoElement) {
        logInfo('[fullscreen.js] Video element not found for screenshot capture.');
        return;
    }

    // キャプチャ描画
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // PNG変換
    canvas.toBlob((blob) => {
        if (!blob) {
            logInfo('[fullscreen.js] Failed to capture screenshot blob.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function() {
            // 保存データ生成
            const arrayBuffer = reader.result;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `screenshot-${timestamp}.png`;

            // 保存実行
            window.electronAPI.saveScreenshot(arrayBuffer, fileName, globalState.path)
                .then((savedPath) => {
                    logInfo(`[fullscreen.js] Screenshot saved: ${savedPath}`);
                    window.electronAPI.notifyScreenshotSaved(savedPath);
                })
                .catch((err) => {
                    logInfo(`[fullscreen.js] Screenshot save failed: ${err}`);
                });
        };

        // ArrayBuffer変換
        reader.readAsArrayBuffer(blob);
    }, 'image/png');
}

// ----------------------------------------
// DSK機能
// ----------------------------------------

// DSK表示状態
window.fsDSKActive = window.fsDSKActive || false;


// DSK操作受信
window.electronAPI.ipcRenderer.on('dsk-control', (event, dskCommandData) => {
    if (dskCommandData.target && dskCommandData.target !== 'fullscreen') {
        return;
    }
    logInfo('[fullscreen.js] Received dsk-control command:', dskCommandData.command);
    
    if (dskCommandData.command === 'DSK_SHOW') {
        if (dskCommandData.payload) {
            showFullscreenDSK(dskCommandData.payload);
            window.fsDSKActive = true;
            logInfo('[fullscreen.js] Processed DSK_SHOW command.');
        } else {
            logInfo('[fullscreen.js] DSK_SHOW payload is undefined.');
        }
    } else if (dskCommandData.command === 'DSK_CLEAR') {
        hideFullscreenDSK();
        window.fsDSKActive = false;
        logInfo('[fullscreen.js] Processed DSK_CLEAR command.');
    } else if (dskCommandData.command === 'DSK_TOGGLE') {
        if (window.fsDSKActive) {
            hideFullscreenDSK();
            window.fsDSKActive = false;
            logInfo('[fullscreen.js] DSK_TOGGLE: DSK has been hidden.');
        } else {
            if (dskCommandData.payload) {
                showFullscreenDSK(dskCommandData.payload);
                window.fsDSKActive = true;
                logInfo('[fullscreen.js] DSK_TOGGLE: DSK has been shown.');
            } else {
                logInfo('[fullscreen.js] DSK_TOGGLE payload is undefined.');
            }
        }
    } else if (dskCommandData.command === 'DSK_PAUSE') {
        pauseFullscreenDSK();
        logInfo('[fullscreen.js] Processed DSK_PAUSE command.');
    } else if (dskCommandData.command === 'DSK_PLAY') {
        playFullscreenDSK();
        logInfo('[fullscreen.js] Processed DSK_PLAY command.');
    } else {
        logInfo('[fullscreen.js] Unknown DSK command received:', dskCommandData.command);
    }
});

// DSKオーバレイ要素
let fsDSKOverlay = null;

// DSKオーバレイ初期化
function initFsDSKOverlay() {
    // body直下配置
    fsDSKOverlay = document.getElementById('fs-dsk-overlay');
    if (!fsDSKOverlay) {
        fsDSKOverlay = document.createElement('div');
        fsDSKOverlay.id = 'fs-dsk-overlay';
        document.body.appendChild(fsDSKOverlay);
    } else if (fsDSKOverlay.parentElement !== document.body) {
        document.body.appendChild(fsDSKOverlay);
    }

    fsDSKOverlay.style.position = 'fixed';
    fsDSKOverlay.style.top = '0';
    fsDSKOverlay.style.left = '0';
    fsDSKOverlay.style.width = '100vw';
    fsDSKOverlay.style.height = '100vh';
    fsDSKOverlay.style.opacity = '0';
    fsDSKOverlay.style.visibility = 'hidden';
    // DSKレイヤー設定
    fsDSKOverlay.style.zIndex = String(FS_LAYER_Z_DSK);
    fsDSKOverlay.style.pointerEvents = 'none';
    fsDSKOverlay.style.backgroundColor = 'transparent';
}


// DSK表示
function showFullscreenDSK(itemData) {
    if (!fsDSKOverlay) {
        initFsDSKOverlay();
        if (!fsDSKOverlay) return;
    }
    fsDSKOverlay.innerHTML = '';
    fsDSKOverlay.style.visibility = 'visible';
    fsDSKOverlay.style.opacity    = '0';
    fsDSKOverlay.style.backgroundColor = 'transparent';

    // 入力確認
    if (!itemData) {
        return;
    }
    currentDSKItem = itemData;

    // video要素作成
    const video = document.createElement('video');
    video.src = getSafeFileURL(itemData.path);
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.setProperty('background-color', 'transparent', 'important');
    video.muted = true;
    video.setAttribute('playsinline', 'true');

    // IN/OUT変換
    const inSec  = parseTimecode(itemData.inPoint);
    const outSec = parseTimecode(itemData.outPoint);

    // EndMode設定
    const mode = itemData.endMode || 'OFF';
    video.loop = false;
    video.currentTime = inSec;

    if (mode === 'REPEAT') {
        video.addEventListener('timeupdate', function loopRepeat() {
            if (video.currentTime >= outSec) {
                video.currentTime = inSec;
            }
        });
        video.addEventListener('ended', function loopOnEnded() {
            video.currentTime = inSec;
            video.play().catch(err => logInfo('[fullscreen.js] fsDSK repeat error:', err));
        });
    } else {
        function onFsEnd() {
            video.removeEventListener('timeupdate', onFsTimeUpdate);
            video.removeEventListener('ended',      onFsEnd);
            handleFullscreenDskEnd(video);
        }
        function onFsTimeUpdate() {
            if (video.currentTime >= outSec) {
                onFsEnd();
            }
        }

        // EndMode別終了監視
        if (mode === 'NEXT' || mode === 'OFF') {
            video.addEventListener('ended', onFsEnd);
        } else {
            video.addEventListener('timeupdate', onFsTimeUpdate);
            video.addEventListener('ended',      onFsEnd);
        }
    }

    // 再生開始準備
    video.addEventListener('loadeddata', function() {
        video.play().catch(err => logInfo('[fullscreen.js] fsDSK video.play() error:', err));
    });

    fsDSKOverlay.appendChild(video);
    fsDSKOverlay.style.visibility = 'visible';

    // フェードイン
    const fadeDuration = itemData.ftbRate * 1000;
    fadeIn(fsDSKOverlay, fadeDuration);
}

// タイムコード変換
function parseTimecode(timecode) {
    if (typeof timecode === 'number') {
        return timecode;
    }
    if (typeof timecode === 'string') {
        const [timePart, fracPart] = timecode.split('.');
        let hh = 0, mm = 0, ss = 0, cs = 0;
        if (timePart) {
            const parts = timePart.split(':');
            if (parts.length === 3) {
                hh = Number(parts[0]);
                mm = Number(parts[1]);
                ss = Number(parts[2]);
            } else {
                return parseFloat(timecode) || 0;
            }
        }
        cs = Number(fracPart) || 0;
        return hh * 3600 + mm * 60 + ss + (cs / 100);
    }
    return 0;
}


// DSK非表示
function hideFullscreenDSK() {
    if (!fsDSKOverlay) return;

    // 即時非表示
    const mode = currentDSKItem?.endMode || 'OFF';
    if (mode === 'OFF' || mode === 'NEXT') {
        fsDSKOverlay.innerHTML   = '';
        fsDSKOverlay.style.opacity    = '0';
        fsDSKOverlay.style.visibility = 'hidden';
        window.fsDSKActive = false;
        return;
    }

    // フェードアウト
    const fadeDuration = (currentDSKItem && currentDSKItem.ftbRate ? currentDSKItem.ftbRate * 1000 : DEFAULT_FADE_DURATION);
    fadeOut(fsDSKOverlay, fadeDuration, () => {
        fsDSKOverlay.innerHTML = '';
    });
}

// DSK一時停止
function pauseFullscreenDSK() {
    if (!fsDSKOverlay) return;
    const video = fsDSKOverlay.querySelector('video');
    if (video && !video.paused) {
        video.pause();
    }
}

// DSK再生
function playFullscreenDSK() {
    if (!fsDSKOverlay) return;
    const video = fsDSKOverlay.querySelector('video');
    if (!video) return;

    // 可視化
    fsDSKOverlay.style.visibility = 'visible';

    if (video.paused) {
        video.play().catch(err => logInfo('[fullscreen.js] fsDSK video.play() error:', err));
    }

    // PAUSEモード終了監視再登録
    if (currentDSKItem?.endMode === 'PAUSE') {
        if (video._onFsTimeUpdate) video.addEventListener('timeupdate', video._onFsTimeUpdate);
        if (video._onFsEnd)        video.addEventListener('ended',      video._onFsEnd);
    }
}

// DSK終了処理
function handleFullscreenDskEnd(videoEl) {
    if (!videoEl || !currentDSKItem || !fsDSKOverlay) return;

    // 終了情報取得
    const inSec  = parseTimecode(currentDSKItem.inPoint);
    const outSec = parseTimecode(currentDSKItem.outPoint);
    const mode   = currentDSKItem.endMode || 'OFF';

    // EndMode分岐
    switch (mode) {
        case 'REPEAT':
            videoEl.currentTime = inSec;
            videoEl.play().catch(err => logInfo('[fullscreen.js] REPEAT error:', err));
            break;

        case 'PAUSE':
            videoEl.pause();
            videoEl.currentTime = outSec;
            break;

        case 'FTB':
            hideFullscreenDSK();
            break;

        case 'OFF':
        case 'NEXT':
        default:
            fsDSKOverlay.innerHTML   = '';
            fsDSKOverlay.style.opacity    = '0';
            fsDSKOverlay.style.visibility = 'hidden';
            window.fsDSKActive = false;
            break;
    }
}

// ----------------------------------------
// フルスクリーン状態のリセット
// ----------------------------------------
function resetFullscreenState() {
    // フェードアウト中断
    cancelFadeOut();
    const videoElement = document.getElementById('fullscreen-video');

    if (videoElement) {
        // 再生停止
        videoElement.pause();

        // UVCストリーム解除
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    }

    logInfo('[fullscreen.js] Fullscreen state has been reset.');
}
