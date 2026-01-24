// -----------------------
//     fullscreen.js
//     ver 2.5.6
// -----------------------

// -----------------------
// 初期設定
// -----------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
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
let holdBlackUntilFadeIn = false;
let seamlessGuardActive = false;
let suppressFadeUntilPlaying = false;
let pendingUvcFadeInSec = 0;
let overlayForceBlack = false;
let fullscreenSeamlessCleanup = null;
let fullscreenApplySeq = 0;
let fullscreenApplyRafId = null;


// ----------------------------------------
// フルスクリーン初期化
// ----------------------------------------
function initializeFullscreenArea() {
    // シームレス切替オーバレイが残っている場合は確実に掃除（offAir→次オンエアで前フレーム混入を防ぐ）
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

    // offAir 直後に残っている「前フレームオーバレイ（残像）」を確実に消す
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

    // オフエア中に保留中の onReceive 適用が走ってオーバレイが復活しないよう無効化
    try {
        fullscreenApplySeq += 1;
        if (fullscreenApplyRafId !== null) {
            cancelAnimationFrame(fullscreenApplyRafId);
            fullscreenApplyRafId = null;
        }
    } catch (_) {
        // ignore
    }

    // offAir / OFF は「黒（またはFILLKEY背景）」を保持して、次映像が出るまで前フレームを見せない

    holdBlackUntilFadeIn = true;
    const fc = initializeFadeCanvas();
    if (fc) {
        fc.style.backgroundColor = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
        fc.style.display = 'block';
        fc.style.visibility = 'visible';
        fc.style.opacity = '1';
    }

    const videoElement = document.getElementById('fullscreen-video');

    if (videoElement) {
        videoElement.pause();

        // UVC デバイスのストリームをリセット
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }

        // offAir 時にブラウザ側の最終フレーム保持を断つ（src クリア + 空ロード）
        try {
            videoElement.removeAttribute('src');
            videoElement.src = '';
            videoElement.load();
        } catch (_) {
            // ignore
        }
    }

    // fullscreen 側で保持しているストリーム停止
    if (globalState && globalState.stream && typeof globalState.stream.getTracks === 'function') {
        try {
            const gsTracks = globalState.stream.getTracks();
            gsTracks.forEach(track => track.stop());
            logInfo('[fullscreen.js] Stopped all tracks from globalState.stream.');
        } catch (e) {
            logInfo('[fullscreen.js] Failed to stop tracks from globalState.stream: ' + e);
        }
    }

    // オーディオチェーン側のゲインミュート
    try {
        if (typeof FullscreenAudioManager !== 'undefined' && fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(0, audioContext.currentTime);
            logDebug('[fullscreen.js] Fullscreen gain node muted during reset.');
        }
    } catch (e) {
        logInfo('[fullscreen.js] Failed to mute fullscreen gain node during reset: ' + e);
    }

    // グローバル状態リセット
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

    // フェードキャンバス初期化
    initializeFadeCanvas();

    // 音声チェーン再初期化
    setupFullscreenAudio.initialized = false;

    logInfo('[fullscreen.js] Fullscreen area has been reset.');
}

// ------------------------------------
// フェードキャンバスの初期化
// ------------------------------------
function initializeFadeCanvas() {
    const existingCanvas = document.getElementById('fadeCanvas');
    if (existingCanvas) {
        if (!holdBlackUntilFadeIn) {
            existingCanvas.style.opacity = '0';
            existingCanvas.style.display = 'none';
        }
        return existingCanvas;
    }

    // キャンバス作成
    const fadeCanvas = document.createElement('div');
    fadeCanvas.id = 'fadeCanvas';
    fadeCanvas.style.position = 'absolute';
    fadeCanvas.style.top = '0';
    fadeCanvas.style.left = '0';
    fadeCanvas.style.width = '100vw';
    fadeCanvas.style.height = '100vh';
    fadeCanvas.style.backgroundColor = 'black';
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.zIndex = '1000';
    fadeCanvas.style.pointerEvents = 'none';

    document.body.appendChild(fadeCanvas);
    return fadeCanvas;
}

// -------------------
// オンエアデータ受信
// -------------------
window.electronAPI.onReceiveFullscreenData((itemData) => {
    logInfo(`[fullscreen.js] Received On-Air data in fullscreen: ${JSON.stringify(itemData)}`);

    const nextIsUVC = isUVCItem(itemData);

    // 切替直前フェードレイヤー解除
    cancelPreFTB();
    cancelFadeOut();
    const ffCanvas = document.getElementById('fullscreen-fade-canvas');
    if (ffCanvas) {
        ffCanvas.style.opacity = '0';
        ffCanvas.style.visibility = 'hidden';
    }

    // スタートモードフォーマット
    const nextStartModeUpper = String(itemData.startMode || 'PAUSE').toUpperCase();
    const nextIsPause  = (nextStartModeUpper === 'PAUSE');
    const nextIsFadeIn = (nextStartModeUpper === 'FADEIN');

    // 次ソースが音声ファイルの場合は、前フレームオーバーレイを即時クリア（数秒残る問題の対策）
    const nextPath = (itemData && typeof itemData.path === 'string') ? itemData.path : '';
    const nextIsAudio = !!nextPath && !nextPath.startsWith('UVC_DEVICE') && (
        /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aif|aiff)(\?.*)?$/i.test(nextPath) ||
        /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aif|aiff)(#.*)?$/i.test(nextPath)
    );
    if (nextIsAudio) {
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

    // 次ソースがUVCの場合
    suppressFadeUntilPlaying = nextIsUVC;
    pendingUvcFadeInSec = (nextIsUVC && nextIsFadeIn && Number(itemData.startFadeInSec) > 0)
        ? Number(itemData.startFadeInSec)
        : 0;
    if (nextIsUVC) {
        const fc = initializeFadeCanvas();
        if (fc) {
            holdBlackUntilFadeIn = true;
            fc.style.display = 'block';
            fc.style.opacity = '1';
        }
    }

    // 前ソースオーバーレイキャプチャをスキップ
    const skipOverlayCapture = isCurrentSourceUVC() || nextIsUVC || nextIsFadeIn || nextIsAudio
        || (typeof holdBlackUntilFadeIn !== 'undefined' && holdBlackUntilFadeIn);

    if (!skipOverlayCapture) {
        try {
            captureLastFrameAndHoldUntilNextReady(true);
        } catch (e) {
            logDebug(`[fullscreen.js] overlay capture skipped: ${e && e.message ? e.message : String(e)}`);
        }
    } else {
        if (typeof holdBlackUntilFadeIn !== 'undefined' && holdBlackUntilFadeIn) {
            logInfo('[fullscreen.js] Overlay capture skipped because holdBlackUntilFadeIn is active.');
        } else if (isCurrentSourceUVC()) {
            logInfo('[fullscreen.js] Overlay capture skipped because current source is UVC.');
        } else if (nextIsUVC) {
            logInfo('[fullscreen.js] Overlay capture skipped because next source is UVC.');
        } else if (nextIsPause) {
            logInfo('[fullscreen.js] Overlay capture skipped because next startMode is PAUSE.');
        } else if (nextIsFadeIn) {
            logInfo('[fullscreen.js] Overlay capture skipped because next startMode is FADEIN.');
        }
    }

    // ビデオ要素のミュート状態更新
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

// UVCソース判定：itemData判定
function isUVCItem(itemData) {
    if (!itemData) return false;
    if (itemData.path && typeof itemData.path === 'string' && itemData.path.startsWith('UVC_DEVICE')) return true;
    if (itemData.deviceId && itemData.deviceId !== null) return true;
    return false;
}

// UVCソース判定：グローバルステート判定
function isCurrentSourceUVC() {
    if (!globalState) return false;
    if (typeof globalState.path === 'string' && globalState.path.startsWith('UVC_DEVICE')) return true;
    if (globalState.deviceId && globalState.deviceId !== null) return true;
    return false;
}

// ビデオ要素のミュート状態更新
function applyMuteStateForNextSource(itemData) {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) return;

    const shouldMute = isUVCItem(itemData);

    videoElement.muted = shouldMute;

    logDebug(`[fullscreen.js] applyMuteStateForNextSource: isUVC=${shouldMute}, muted=${videoElement.muted}`);
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
    globalState = {
        playlistItemId: itemData.playlistItem_id || null,
        path: itemData.path || '',
        deviceId: itemData.deviceId || null,
        uvcAudioDeviceId: itemData.uvcAudioDeviceId || null,
        inPoint: parseFloat(itemData.inPoint || 0),
        outPoint: parseFloat(itemData.outPoint || 0),
        startMode: itemData.startMode || 'PAUSE',
        endMode: itemData.endMode || 'PAUSE',
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
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    try {
        const fc = document.getElementById('fadeCanvas');
        const baseZ = fc && fc.style && fc.style.zIndex ? (parseInt(fc.style.zIndex, 10) || 1000) : 1000;
        canvas.style.zIndex = String(baseZ + 1);
    } catch (_) {
        canvas.style.zIndex = '1001';
    }
    canvas.style.pointerEvents = 'none';
    if (!canvas.style.display) {
        canvas.style.display = 'none';
        canvas.style.opacity = '1';
    }
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
// オーバレイキャプチャ固定
// ------------------------------------
function captureLastFrameAndHoldUntilNextReady(respectBlackHold) {
    if (respectBlackHold) {
        const fc = document.getElementById('fadeCanvas');
        const fcBlackHold = !!(fc && fc.style.display !== 'none' && parseFloat(fc.style.opacity || '0') > 0.9);
        if (typeof holdBlackUntilFadeIn !== 'undefined' && holdBlackUntilFadeIn && fcBlackHold) {
            logInfo('[fullscreen.js] Overlay capture skipped due to black hold.');
            return;
        }
    }
    const videoElement = document.getElementById('fullscreen-video');
    const overlayCanvas = initializeOverlayCanvas();
    if (!videoElement || !overlayCanvas) {
        logInfo('[fullscreen.js] Overlay capture skipped due to missing element.');
        return;
    }

    // 前ソースが「何も出ていない（src空 & srcObjectなし）」場合は、
    // オーバレイ保持が黒のまま残り「遅れて出たように見える」原因になるためキャプチャをスキップする
    const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
    const hasSrcObject = !!videoElement.srcObject;
    if (!hasSrcObject && !nowSrc) {
        return;
    }

    if (typeof fullscreenSeamlessCleanup === 'function') {
        try { fullscreenSeamlessCleanup(); } catch (_) {}
        fullscreenSeamlessCleanup = null;
    }
    overlayForceBlack = false;

    const captureToken = `${Date.now()}-${Math.random()}`;
    try { overlayCanvas.dataset.seamlessToken = captureToken; } catch (_) {}
    const isCurrentToken = () => {
        try { return overlayCanvas.dataset.seamlessToken === captureToken; } catch (_) { return true; }
    };

    const capturedSrc = String(videoElement.currentSrc || videoElement.src || '');
    const capturedTime = Number(videoElement.currentTime || 0);
    const capturedAt = performance.now();

    const isReadyToRelease = (nowSrc) => {
        if (!nowSrc) return false;
        if (nowSrc !== capturedSrc) return true;
        const nowTime = Number(videoElement.currentTime || 0);
        if (nowTime <= 0.12 && capturedTime > 0.30) return true;
        if (nowTime + 0.25 < capturedTime) return true;
        const elapsed = performance.now() - capturedAt;
        if (
            elapsed >= 1500 &&
            (videoElement.readyState >= 2) &&
            !videoElement.paused &&
            (Math.abs(nowTime - capturedTime) >= 0.30 || nowTime >= 0.25)
        ) {
            return true;
        }
        return false;
    };

    const ctx = overlayCanvas.getContext('2d');

    try {
        if (typeof pendingUvcFadeInSec !== 'undefined' && pendingUvcFadeInSec > 0) {
            overlayForceBlack = true;
            overlayCanvas.style.opacity = '1';
            overlayCanvas.style.display = 'block';
            ctx.save();
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.restore();
        } else {
            (function () {
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
            })();

            overlayCanvas.style.opacity = '1';
            overlayCanvas.style.display = 'block';
            overlayCanvas.style.visibility = 'visible';
            seamlessGuardActive = true;

            // 音声アイテムから映像アイテムへの復帰時
            if (videoElement.getAttribute('data-hide-due-to-audio') === '1' &&
                (videoElement.videoWidth | 0) > 0 && (videoElement.videoHeight | 0) > 0) {
                videoElement.style.display = '';
                videoElement.removeAttribute('data-hide-due-to-audio');
                logDebug('[fullscreen.js] Video display restored (entering video item).');
            }
        }

        // 先出し黒フェード
        if (overlayForceBlack && typeof preFtbActive !== 'undefined' && preFtbActive) {
            overlayCanvas.style.display = 'block';
            overlayCanvas.style.opacity = '1';
            let p = 0;
            try {
                const now = performance.now();
                const elapsed = now - (preFtbStartTime || now);
                p = preFtbDuration > 0 ? Math.min(elapsed / preFtbDuration, 1) : 1;
            } catch (_) {}
            overlayCanvas.style.opacity = String(1 - p);
            if (p >= 1) {
                overlayCanvas.style.display = 'none';
                overlayCanvas.style.opacity = '1';
                overlayForceBlack = false;
            }
        }
    } catch (e) {
        try {
            ctx.save();
            ctx.fillStyle = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
            ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.restore();
            overlayCanvas.style.display = 'none';
        } catch (_) {}
    }

    const useRVFC = !!(videoElement && typeof videoElement.requestVideoFrameCallback === 'function');
    let rvfcCount = 0;
    let rvfcArmed = false;
    let rvfcArmedAt = 0;
    let rvfcLastPresentedFrames = 0;
    let rvfcHandle = null;
    let safetyTimerId = null;

    const onLoadedData = () => {
        if (!isCurrentToken()) return;
        if (useRVFC && !videoElement.paused) return;
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (isReadyToRelease(nowSrc)) clearOverlay('loadeddata');
    };
    const onCanPlay = () => {
        if (!isCurrentToken()) return;
        if (useRVFC && !videoElement.paused) return;
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (isReadyToRelease(nowSrc)) clearOverlay('canplay');
    };
    const onSeeked = () => {
        if (!isCurrentToken()) return;
        if (useRVFC && !videoElement.paused) return;
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (isReadyToRelease(nowSrc)) clearOverlay('seeked');
    };
    const onTimeUpdate = () => {
        if (!isCurrentToken()) return;
        if (useRVFC && !videoElement.paused) return;
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (isReadyToRelease(nowSrc)) clearOverlay('timeupdate');
    };

    const detach = () => {
        videoElement.removeEventListener('playing', onPlaying);
        videoElement.removeEventListener('loadeddata', onLoadedData);
        videoElement.removeEventListener('canplay', onCanPlay);
        videoElement.removeEventListener('seeked', onSeeked);
        videoElement.removeEventListener('timeupdate', onTimeUpdate);
    };

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

    fullscreenSeamlessCleanup = cleanup;

    const clearOverlay = (reason) => {
        const RELEASE_DELAY_MS = 50;
        setTimeout(() => {
            if (!isCurrentToken()) {
                cleanup();
                if (fullscreenSeamlessCleanup === cleanup) fullscreenSeamlessCleanup = null;
                return;
            }

            try {
                overlayCanvas.style.display = 'none';
                try { ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); } catch (_) {}
            } catch (_) {}

            seamlessGuardActive = false;
            overlayForceBlack = false;

            logDebug(`[fullscreen.js] Overlay cleared after smal... (${RELEASE_DELAY_MS}ms)${reason ? ' [' + reason + ']' : ''}.`);

            cleanup();
            if (fullscreenSeamlessCleanup === cleanup) fullscreenSeamlessCleanup = null;
        }, RELEASE_DELAY_MS);
    };

    const rvfc = useRVFC ? (ts, md) => {
        if (!isCurrentToken()) {
            cleanup();
            if (fullscreenSeamlessCleanup === cleanup) fullscreenSeamlessCleanup = null;
            return;
        }
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (!isReadyToRelease(nowSrc)) {
            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
            return;
        }
        const pf = (md && typeof md.presentedFrames === 'number') ? md.presentedFrames : null;
        if (!rvfcArmed) {
            rvfcArmed = true;
            rvfcArmedAt = performance.now();
            rvfcCount = 0;
            rvfcLastPresentedFrames = (pf !== null) ? pf : 0;

            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
            return;
        }
        if ((performance.now() - rvfcArmedAt) < 120) {
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

        // スタートモードPAUSEの場合
        const requiredFrames = videoElement.paused ? 1 : 2;

        if (rvfcCount >= requiredFrames) {
            clearOverlay('rvfc');
        } else {
            try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
        }

    } : null;

    function onPlaying() {
        if (!isCurrentToken()) {
            cleanup();
            if (fullscreenSeamlessCleanup === cleanup) fullscreenSeamlessCleanup = null;
            return;
        }
        const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
        if (!isReadyToRelease(nowSrc)) return;

        if (!useRVFC) {
            clearOverlay('playing');
        }
    }

    videoElement.addEventListener('playing', onPlaying);
    videoElement.addEventListener('loadeddata', onLoadedData);
    videoElement.addEventListener('canplay', onCanPlay);
    videoElement.addEventListener('seeked', onSeeked);
    videoElement.addEventListener('timeupdate', onTimeUpdate);

    if (useRVFC) {
        try { rvfcHandle = videoElement.requestVideoFrameCallback(rvfc); } catch (_) {}
    }

    // セーフティ
    const SAFETY_TIMEOUT_MS = 5000;
    const SAFETY_POLL_MS = 100;
    const safetyStart = performance.now();
    let safetyLogged = false;

    const safetyPoll = () => {
        if (!isCurrentToken()) {
            cleanup();
            if (fullscreenSeamlessCleanup === cleanup) fullscreenSeamlessCleanup = null;
            return;
        }
        if (!seamlessGuardActive) return;

        const elapsed = performance.now() - safetyStart;
        if (elapsed >= SAFETY_TIMEOUT_MS) {
            const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
            if (isReadyToRelease(nowSrc)) {
                clearOverlay('safety');
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

    const isUvc = !!(globalState.deviceId || (typeof globalState.path === 'string' && globalState.path.startsWith('UVC_DEVICE:')));

    // 動画とUVCの振り分け
    if (isUvc) {
        if (!globalState.deviceId && typeof globalState.path === 'string') {
            const id = globalState.path.substring('UVC_DEVICE:'.length);
            if (id) {
                globalState.deviceId = id;
                logInfo(`[fullscreen.js] deviceId complemented from path: ${id}`);
            }
        }
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

    // UVCパス
    if (typeof globalState.path === 'string' && globalState.path.startsWith("UVC_DEVICE")) {
        logInfo('[fullscreen.js] UVC path detected in setupVideoPlayer; skipping file URL.');
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

        // ソース切替時再バインド
        setupFullscreenAudio(videoElement);
        logDebug('[fullscreen.js] Audio (re)initialized during setupVideoPlayer.');

        // 音量適用
        videoElement.volume = initialVolume;
        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(initialVolume, audioContext.currentTime);
        }

        logInfo(`[fullscreen.js] Fullscreen video started with default volume: ${initialVolume}`);
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

    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    if (!deviceId) {
        logInfo('[fullscreen.js] No UVC device ID available in global state.');
        return;
    }

    try {
        // UVC 用音声デバイス取得
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

        // 初期音量設定
        let initialVolume = (globalState.volume !== undefined ? globalState.volume : (globalState.defaultVolume / 100));
        if (typeof initialVolume !== 'number' || isNaN(initialVolume)) {
            initialVolume = 1.0;
        }
        const maxStreamGain = 1.0;
        initialVolume = Math.max(0.0, Math.min(maxStreamGain, initialVolume));
        videoElement.volume = initialVolume;

        // ストリームセット
        videoElement.srcObject = stream;

        // 音声入力チャンネル
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

        // ソース切替時再バインド
        setupFullscreenAudio(videoElement);
        logDebug('[fullscreen.js] Audio (re)initialized during setupUVCDevice.');

        // 初期音量
        if (fullscreenGainNode) {
            const audioContext = FullscreenAudioManager.getContext();
            fullscreenGainNode.gain.setValueAtTime(initialVolume, audioContext.currentTime);
        }

        const smUpper = String(globalState.startMode || 'PLAY').toUpperCase();

        // スタートモードPAUSEの場合
        if (smUpper === 'PAUSE') {
            globalState.stream = stream;
            stopVolumeMeasurement();
            logInfo('[fullscreen.js] UVC startMode=PAUSE: stream set, awaiting manual play.');
            return;
        }

        const fadeSec = (typeof pendingUvcFadeInSec !== 'undefined' && pendingUvcFadeInSec > 0)
            ? pendingUvcFadeInSec
            : 0.3;

        // ストリームスタート確認
        const handlePlaying = () => {
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
        await videoElement.play();
        globalState.stream = stream;
        try {
            if (!isVolumeMeasurementActive) {
                startVolumeMeasurement(60);
                logDebug('[fullscreen.js] Volume measurement started from setupUVCDevice (post-play).');
            }
        } catch (_e) {}
        logInfo('[fullscreen.js] UVC device stream initialized successfully.');
        logDebug(`[fullscreen.js] Device ID: ${deviceId}`);
    } catch (error) {
        logInfo('[fullscreen.js] Failed to initialize UVC device stream.');
        logDebug(`[fullscreen.js] Error: ${error.message}`);
    }
}

// -------------------------
// スタートモードPLAY/PAUSE
// -------------------------
function handleStartMode() {
    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    // リピートの場合のスタートモード分岐処理
    if (globalState.repeatFlag) {
        const sm = (globalState.startMode || 'PAUSE').toUpperCase();

        if (sm === 'OFF') {
            logInfo('[fullscreen.js] Repeat requested but startMode=OFF -> do not repeat; going Off-Air.');
            globalState.repeatFlag = false;
            handleEndModeOFF();
            return;
        }
        if (sm === 'PAUSE') {
            logInfo('[fullscreen.js] Repeat with startMode=PAUSE -> auto-play from IN on repeat.');
            const initialVol = (typeof globalState.volume === 'number') ? Math.max(0, Math.min(1, globalState.volume)) : (typeof globalState.defaultVolume === 'number' ? Math.max(0, Math.min(1, globalState.defaultVolume / 100)) : 1);
            videoElement.currentTime = globalState.inPoint;
            videoElement.volume = initialVol;
            videoElement.play()
                .then(() => {
                    startVolumeMeasurement();
                    logInfo('[fullscreen.js] Repeat playback started (PAUSE overridden to PLAY on repeat).');
                })
                .catch(error => logDebug(`[fullscreen.js] Repeat playback (PAUSE->PLAY) failed: ${error.message}`));
            monitorVideoPlayback();
            globalState.repeatFlag = false;
            return;
        }

        // PLAY/FADEIN のときのみリピート再生開始
        if (sm === 'PLAY') {
            logInfo('[fullscreen.js] Repeat with startMode=PLAY.');
            videoElement.currentTime = globalState.inPoint;
            videoElement.play()
                .then(() => {
                    logInfo('[fullscreen.js] Repeat playback started successfully.');
                    startVolumeMeasurement();
                })
                .catch(error => logDebug(`[fullscreen.js] Repeat playback failed to start: ${error.message}`));
            monitorVideoPlayback();
            globalState.repeatFlag = false;
            return;
        }

        if (sm === 'FADEIN') {
            logInfo('[fullscreen.js] Repeat with startMode=FADEIN.');
            videoElement.currentTime = globalState.inPoint;
            videoElement.volume = 0;
            const preCanvas = document.getElementById('fadeCanvas');
            if (preCanvas) {
                preCanvas.style.backgroundColor = (isFillKeyMode && fillKeyBgColor) ? fillKeyBgColor : 'black';
                preCanvas.style.opacity = '1';
                preCanvas.style.display = 'block';
                preCanvas.style.visibility = 'visible';
                holdBlackUntilFadeIn = true;
            }

            // フェードイン
            const fadeDur = (typeof globalState.startFadeInSec === 'number' && !isNaN(globalState.startFadeInSec))
                ? globalState.startFadeInSec
                : 1.0;
            fullscreenFadeFromBlack(fadeDur, isFillKeyMode);

            videoElement.play()
                .then(() => {
                    audioFadeIn(fadeDur);
                    startVolumeMeasurement();
                    logInfo('[fullscreen.js] Repeat playback started with FADEIN.');
                })
                .catch(error => logDebug(`[fullscreen.js] Repeat FADEIN failed to start: ${error.message}`));
            monitorVideoPlayback();
            globalState.repeatFlag = false;
            return;
        }
        logInfo(`[fullscreen.js] Repeat requested but unknown startMode=${sm}. No action taken.`);
        globalState.repeatFlag = false;
        return;
    }

    // 通常のスタートモード処理
    if (globalState.startMode === 'PLAY') {
        logInfo('[fullscreen.js] Start mode is PLAY. Starting playback.');

        videoElement.currentTime = globalState.inPoint;

        // offAir/OFF で黒保持している場合：
        // 「新しいソースの最初の映像フレームがデコードされた瞬間」に黒を外す（動画1最終フレーム混入を確実に防ぐ）
        if (holdBlackUntilFadeIn) {
            const expectedSrc = String(videoElement.src || '');
            let releaseStarted = false;

            const releaseHeldBlackOnce = () => {
                if (releaseStarted) return;
                releaseStarted = true;
                try {
                    fullscreenFadeFromBlack(0.06, isFillKeyMode);
                } catch (_) {
                    const fc = document.getElementById('fadeCanvas');
                    if (fc) {
                        fc.style.opacity = '0';
                        fc.style.display = 'none';
                        fc.style.visibility = 'hidden';
                    }
                    holdBlackUntilFadeIn = false;
                }
            };

            const tryRelease = () => {
                if (releaseStarted) return;

                // 旧フレーム（動画1）で黒解除されないよう、src が新ソースであることを確認
                const nowSrc = String(videoElement.currentSrc || videoElement.src || '');
                if (expectedSrc && nowSrc && nowSrc !== expectedSrc) return;

                // 「映像フレームが利用可能」になってから解除する
                if ((videoElement.readyState | 0) < 2) return;
                if ((videoElement.videoWidth | 0) <= 0 || (videoElement.videoHeight | 0) <= 0) return;

                releaseHeldBlackOnce();
            };

            // loadeddata は「最初の映像フレームがデコード済み」なので、ここで解除するのが最も安全
            videoElement.addEventListener('loadeddata', tryRelease, { once: true });

            // 念のため保険（loadeddata 前後で条件が揃った瞬間に解除）
            let tries = 0;
            const rafTry = () => {
                if (releaseStarted) return;
                tries++;
                if (tries > 180) return; // 約3秒で打ち切り（黒のまま維持）
                tryRelease();
                if (!releaseStarted) requestAnimationFrame(rafTry);
            };
            requestAnimationFrame(rafTry);
        }

        videoElement.play()
            .then(() => {
                logInfo('[fullscreen.js] Playback started successfully.');
                startVolumeMeasurement();
                window.electronAPI.sendControlToFullscreen({ command: 'play' });
            })
            .catch(error => logDebug(`[fullscreen.js] Playback failed to start: ${error.message}`));

        monitorVideoPlayback();

    } else if (globalState.startMode === 'PAUSE') {
        logInfo('[fullscreen.js] Start mode is PAUSE. Video is ready to play.');
        videoElement.currentTime = globalState.inPoint;
        stopVolumeMeasurement();

    } else if (globalState.startMode === 'FADEIN') {
        logInfo('[fullscreen.js] Start mode is FADEIN. Initiating fade in playback.');

        videoElement.currentTime = globalState.inPoint;
        videoElement.volume = 0;

        const fadeDur = (typeof globalState.startFadeInSec === 'number' && !isNaN(globalState.startFadeInSec))
            ? globalState.startFadeInSec
            : 1.0;

        fullscreenFadeFromBlack(fadeDur, isFillKeyMode);

        videoElement.play()
            .then(() => {
                audioFadeIn(fadeDur);
                startVolumeMeasurement();
                logInfo('[fullscreen.js] Playback started with FADEIN effect.');
            })
            .catch(error => logDebug(`[fullscreen.js] Playback failed to start in FADEIN mode: ${error.message}`));

        monitorVideoPlayback();

    } else {
        logInfo(`[fullscreen.js] Unknown start mode: ${globalState.startMode}. No action taken.`);
    }
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
    fadeCanvas.style.zIndex = '9999';
    fadeCanvas.style.pointerEvents = 'none';
    fadeCanvas.style.backgroundColor = 'black';
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.visibility = 'hidden';
    document.body.appendChild(fadeCanvas);
}

// 映像フェードイン処理
function fullscreenFadeFromBlack(duration, fillKeyMode) {

    // 黒保持中だった場合
    if (holdBlackUntilFadeIn) {
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
                holdBlackUntilFadeIn = false;
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
            logInfo('[fullscreen.js] Fade in completed.');
        }
    }
    requestAnimationFrame(fadeStep);
}

// 映像事前フェードアウト処理
function startPreFTB(durationSec, fillKeyMode) {
    let fadeCanvas = document.getElementById('fadeCanvas');
    if (!fadeCanvas) fadeCanvas = initializeFadeCanvas();

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
            holdBlackUntilFadeIn = true; 
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
    holdBlackUntilFadeIn = false;
    const fadeCanvas = document.getElementById('fadeCanvas');
    if (fadeCanvas) {
        fadeCanvas.style.opacity = '0';
        fadeCanvas.style.display = 'none';
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
        if (suppressFadeUntilPlaying) {
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

function fullscreenStopPendingEndModeWatcher() {
    if (fullscreenPendingEndModeRafId !== null) {
        cancelAnimationFrame(fullscreenPendingEndModeRafId);
        fullscreenPendingEndModeRafId = null;
    }
}

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

            // フレーム精度で OUT 到達を検知（intervalだと周回ごとに遅延が乗って累積しやすい）
            if (videoElement.ended || currentTime >= effectiveOutPoint) {
                const mode = fullscreenPendingEndMode;
                fullscreenPendingEndMode = null;
                fullscreenStopPendingEndModeWatcher();

                try { stopVolumeMeasurement(); } catch (_) {}

                if (mode === 'REPEAT') {
                    if ((globalState.startMode || '').toUpperCase() === 'OFF') {
                        handleEndModeOFF();
                    } else {
                        handleEndMode();
                    }
                } else {
                    handleEndMode();
                }
                return;
            }
        }

        fullscreenPendingEndModeRafId = requestAnimationFrame(tick);
    };

    fullscreenPendingEndModeRafId = requestAnimationFrame(tick);
}

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

        // duration が取れていて、OUT点が 0 以下または duration より長い場合は duration を優先
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

function stopMonitoringPlayback() {
    clearInterval(playbackMonitor);
    playbackMonitor = null;
    logInfo('[fullscreen.js] Playback monitoring stopped.');
}


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

    if (!fullscreenVideoElement) {
        logInfo("[fullscreen.js] videoElement not found, ignoring control command.");
        return;
    }

    try {
        const { command, value } = commandData;
        logDebug(`[fullscreen.js] Received control command: ${command}, value: ${value}`);

        switch (command) {
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
            case 'set-volume':
                if (value >= 0 && value <= 1) {
                    fullscreenVideoElement.volume = Math.min(1, Math.max(0, value));
                    if (fullscreenGainNode) {
                        const audioContext = FullscreenAudioManager.getContext();
                        fullscreenGainNode.gain.setValueAtTime(value, audioContext.currentTime);
                    }
                    logDebug(`[fullscreen.js] Fullscreen volume set to: ${value}`);
                } else {
                    logInfo(`[fullscreen.js] Invalid volume value: ${value}. Must be between 0 and 1.`);
                }
                break;
            case 'set-playback-speed':
                fullscreenVideoElement.playbackRate = value;
                logDebug(`[fullscreen.js] Fullscreen playback speed set to: ${value}`);
                break;
            case 'offAir':
                logInfo('[fullscreen.js]  Received offAir command.');
                initializeFullscreenArea();
                stopMonitoringPlayback();
                stopVolumeMeasurement();
                break;
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
                fullscreenPendingEndMode = receivedEndMode;
                fullscreenStartPendingEndModeWatcher();
                break;
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
            case 'fade-from-black':
                {
                    const dur = (value && typeof value.duration === 'number') ? value.duration : (globalState.ftbRate || 0.3);
                    const fk  = (value && !!value.fillKeyMode) ? true : false;
                    if (seamlessGuardActive) {
                        logInfo('[fullscreen.js] fade-from-black skipped due to seamless guard.');
                        break;
                    }
                    if (suppressFadeUntilPlaying) {
                        logInfo('[fullscreen.js] fade-from-black skipped due to incoming UVC.');
                        break;
                    }
                    logInfo(`[fullscreen.js] fade-from-black: duration=${dur}s, fillKeyMode=${fk}`);
                    cancelPreFTB();
                    fullscreenFadeFromBlack(dur, fk);
                }
                break;
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
            case 'DSK_PAUSE':
                pauseFullscreenDSK();
                logDebug('[fullscreen.js] Fullscreen DSK paused.');
                break;
            case 'DSK_PLAY':
                playFullscreenDSK();
                logDebug('[fullscreen.js] Fullscreen DSK playing.');
                break;
            default:
                logInfo(`[fullscreen.js] Unknown command received: ${command}`);
        }
    } catch (error) {
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
    initializeFullscreenArea();
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
// エンドモードFTB
// ------------------------------------
function handleEndModeFTB() {
    const fadeDuration = globalState.ftbRate || 1;

    logInfo(`[fullscreen.js] Starting FTB: Fade duration is ${fadeDuration} seconds.`);

    // フェードキャンバス初期化
    let fadeCanvas = document.getElementById('fadeCanvas');
    if (!fadeCanvas) {
        logInfo('[fullscreen.js] Fade canvas not found. Reinitializing canvas.');
        fadeCanvas = initializeFadeCanvas();
    }

    // 事前FTBが既に完了している場合
    if (preFtbActive || (fadeCanvas && parseFloat(fadeCanvas.style.opacity) >= 0.99)) {
        preFtbActive = false;
        if (preFtbRaf) {
            cancelAnimationFrame(preFtbRaf);
            preFtbRaf = null;
        }
        initializeFullscreenArea();
        fadeCanvas.style.opacity = '0';
        fadeCanvas.style.display = 'none';
        fadeCanvas.style.visibility = 'hidden';
        stopVolumeMeasurement();
        logInfo('[fullscreen.js] FTB complete: Pre-FTB already at black. Finalized immediately.');
        return;
    }

    // FTB開始前に既存のフェードタイマー停止
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
    }
    fadeCancelled = false;

    // フェードキャンバス設定
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.display = 'block';
    fadeCanvas.style.visibility = 'visible';

    // FILL-KEY モードの場合
    fadeCanvas.style.backgroundColor = isFillKeyMode && fillKeyBgColor ? fillKeyBgColor : "black";

    // FTB は他のオーバーレイより前面
    fadeCanvas.style.zIndex = '9999';

    // フェード
    const durationMs = Math.max(fadeDuration, 0.05) * 1000;
    const startTime = performance.now();
    const frameInterval = 1000 / 60;

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

            // フルスクリーンエリア初期化
            initializeFullscreenArea();

            // FTB 完了後フェードキャンバス非表示
            // ※ initializeFullscreenArea() が holdBlackUntilFadeIn=true の間は fadeCanvas を黒表示のまま保持する
            if (!holdBlackUntilFadeIn) {
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

// フェードアウトアニメーション中断処理
function cancelFadeOut() {
    fadeCancelled = true;
    const fadeCanvas = document.getElementById('fadeCanvas');
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
        logInfo('[fullscreen.js] FTB fadeout canceled.');
    }
    if (fadeCanvas) {
        // offAir/OFF の「黒保持」中は fadeCanvas を消さない（次オンエア時の前フレーム混入を防ぐ）
        const keepBlackHold = !!(
            typeof holdBlackUntilFadeIn !== 'undefined' &&
            holdBlackUntilFadeIn &&
            fadeCanvas.style.display !== 'none' &&
            parseFloat(fadeCanvas.style.opacity || '0') > 0.9
        );

        if (!keepBlackHold) {
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.display = 'none';
        }
    }
}

// ------------------------------------
// エンドモード REPEAT
// ------------------------------------
function handleEndModeREPEAT() {
    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video element not found. Cannot handle REPEAT mode.');
        return;
    }
    captureLastFrameAndHoldUntilNextReady(true);

    globalState.repeatFlag = true; 
    logInfo('[fullscreen.js] End Mode: REPEAT - Setting repeat flag and restarting playback.');
    
    handleStartMode();
}

// ------------------------------------
// エンドモード NEXT/GOTO
// ------------------------------------
function handleEndModeNEXT() {
    logInfo('[fullscreen.js] Called endmode:NEXT - capturing last frame');
    const fc = document.getElementById('fadeCanvas');
    if (holdBlackUntilFadeIn || (fc && fc.style.display !== 'none' && parseFloat(fc.style.opacity || '0') > 0.9)) {
        logInfo('[fullscreen.js] NEXT skipped overlay capture due to black hold.');
        return;
    }
    try {
        captureLastFrameAndHoldUntilNextReady(true);
    } catch (e) {
        logDebug(`[fullscreen.js] handleEndModeNEXT overlay capture skipped: ${e && e.message ? e.message : String(e)}`);
    }
}

// ------------------------------------
// 音声処理
// ------------------------------------

// Fullscreen Audio Context Manager
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

// 音声処理のフラグ
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

// 音声初期化：analyser は常に原音 L/R を計測。mono 時の出力のみ dual-mono。
function setupFullscreenAudio(videoElement) {
    const audioContext = FullscreenAudioManager.getContext();

    // ソース切替のたびに必ず再バインド
    // （initialized で return すると旧ストリームを見続け、メーターが無音固定になる）
    if (setupFullscreenAudio.initialized) {
        try { if (fullscreenSourceNode) fullscreenSourceNode.disconnect(); } catch (_e) {}
        try { if (fullscreenGainNode) fullscreenGainNode.disconnect(); } catch (_e) {}
        try { if (fullscreenUpmixNode) fullscreenUpmixNode.disconnect(); } catch (_e) {}
        try { if (fullscreenSplitter) fullscreenSplitter.disconnect(); } catch (_e) {}
        try { if (fullscreenMerger) fullscreenMerger.disconnect(); } catch (_e) {}
    }

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

    // UVC を含め、videoElement の音声を必ず Analyser に流し込む
    // - srcObject に MediaStream が入っている場合: MediaStreamSource を使用（都度作成）
    // - それ以外（通常ファイル再生など）   : MediaElementSource を一度だけ作って再利用
    if (fullscreenSourceNode) {
        try {
            fullscreenSourceNode.disconnect();
        } catch (_e) {}
        fullscreenSourceNode = null;
    }

    try {
        if (videoElement.srcObject instanceof MediaStream) {
            // UVC / getUserMedia 系: MediaStreamSource はストリームごとに作り直す
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
            // AudioContext をリセットするたびに MediaElementSource も作り直す
            if (!fullscreenElementSourceNode) {
                fullscreenElementSourceNode = audioContext.createMediaElementSource(videoElement);
            }
            fullscreenSourceNode = fullscreenElementSourceNode;
            fullscreenSourceKind = 'element';
            logDebug('[fullscreen.js] Using MediaElementSource for fullscreen audio.');
        }

        // analyser 用経路
        fullscreenSourceNode.connect(fullscreenGainNode);

        // 明示的に 2ch にアップミックスしてから Split
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

    const mediaStreamDest = audioContext.createMediaStreamDestination();
    fullscreenMediaDest = mediaStreamDest;

    // 出力のみ切替（mono は merger、stereo/多ch は upmix(2ch強制)）
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
        // 必ず 2ch 化したものを出力へ流す
        if (fullscreenUpmixNode) {
            try { fullscreenUpmixNode.connect(mediaStreamDest); } catch (_e) {}
        } else {
            // フォールバック
            try { fullscreenGainNode.connect(mediaStreamDest); } catch (_e) {}
        }
    }

    let hiddenAudio = document.getElementById('fullscreen-hidden-audio');
    if (!hiddenAudio) {
        hiddenAudio = document.createElement('audio');
        hiddenAudio.id = 'fullscreen-hidden-audio';
        hiddenAudio.style.display = 'none';
        document.body.appendChild(hiddenAudio);
    }
    hiddenAudio.srcObject = mediaStreamDest.stream;

    window.fullscreenAudioStream = mediaStreamDest.stream;

    window.electronAPI.getDeviceSettings().then(async settings => {
        const outputDeviceId = (settings && settings.onairAudioOutputDevice) ? settings.onairAudioOutputDevice : 'default';

        // 念のため AudioContext を起こす（suspended のまま進む個体差を避ける）
        try {
            const ctx = FullscreenAudioManager.getContext();
            if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                await ctx.resume();
            }
        } catch (_e) {}

        // まず出力先を確定させてから play
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

        // play が失敗する個体があるため、失敗時は隠し audio を作り直して 1 回だけリトライ
        try {
            await hiddenAudio.play();
        } catch (err) {
            logInfo('[fullscreen.js] Hidden audio play failed: ' + err);

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

    setupFullscreenAudio.initialized = true;

    const video = document.getElementById('fullscreen-video');
    if (video && !video.__vtrponAudioResumeBound) {
        // 初回のみリスナを張る（再バインドのたびに増殖させない）
        video.__vtrponAudioResumeBound = true;

        const resumeMeasure = () => {
            try {
                if (typeof fullscreenLingerTimerId !== 'undefined' && fullscreenLingerTimerId) {
                    clearTimeout(fullscreenLingerTimerId);
                    fullscreenLingerTimerId = null;
                }
                const ctx = FullscreenAudioManager.getContext();
                if (fullscreenGainNode) {
                    const t = ctx.currentTime;
                    const rawGain = (typeof globalState.volume === 'number')
                        ? globalState.volume
                        : (globalState?.defaultVolume ?? 100) / 100;

                    // ストリームソース（UVC/NDI）はゲイン 0.35（約 -9 dB）を上限とし、
                    // それ以外は従来どおりゲイン 4.0（約 +12 dB）まで許容する
                    const maxGain = (fullscreenSourceKind === 'stream') ? 0.5 : 4.0;
                    const targetGain = Math.max(0.001, Math.min(maxGain, rawGain));

                    // いきなりステップさせるとノイズが出る
                    // ごく小さな値から 30ms かけて滑らかに目標ゲインまでフェードさせる
                    fullscreenGainNode.gain.cancelScheduledValues(t);
                    fullscreenGainNode.gain.setValueAtTime(0.0001, t);
                    fullscreenGainNode.gain.linearRampToValueAtTime(targetGain, t + 0.03);
                }
            } catch (_e) {}
            try { startVolumeMeasurement(60); } catch (_e) {}
        };

        video.addEventListener('playing',  resumeMeasure, { passive: true });
        video.addEventListener('canplay',  resumeMeasure, { passive: true });
        video.addEventListener('seeked',   resumeMeasure, { passive: true });
    }

    // 音声チェーン初期化直後に計測ループ起動
    try {
        if (!isVolumeMeasurementActive && fullscreenAnalyserL && fullscreenAnalyserR) {
            startVolumeMeasurement(60);
            logDebug('[fullscreen.js] Volume measurement started from setupFullscreenAudio.');
        }
    } catch (_e) {}
}

// Device Settings 更新時に隠し audio 要素の出力先を更新するリスナー
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

// 音声リセット関数
function resetFullscreenAudio() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // ソースノードの切断と破棄
    if (fullscreenSourceNode) {
        try {
            fullscreenSourceNode.disconnect();
        } catch (_e) {}
        fullscreenSourceNode = null;
    }
    if (fullscreenElementSourceNode) {
        try {
            fullscreenElementSourceNode.disconnect();
        } catch (_e) {}
        fullscreenElementSourceNode = null;
    }
    if (fullscreenStreamSourceNode) {
        try {
            fullscreenStreamSourceNode.disconnect();
        } catch (_e) {}
        fullscreenStreamSourceNode = null;
    }

    // 解析・ゲイン・ルーティング系ノードもすべて切断して破棄
    try { if (fullscreenAnalyserL) fullscreenAnalyserL.disconnect(); } catch (_e) {}
    try { if (fullscreenAnalyserR) fullscreenAnalyserR.disconnect(); } catch (_e) {}
    try { if (fullscreenGainNode)   fullscreenGainNode.disconnect(); } catch (_e) {}
    try { if (fullscreenSplitter)   fullscreenSplitter.disconnect(); } catch (_e) {}
    try { if (fullscreenMerger)     fullscreenMerger.disconnect(); } catch (_e) {}
    try { if (fullscreenUpmixNode)  fullscreenUpmixNode.disconnect(); } catch (_e) {}

    fullscreenAnalyserL = null;
    fullscreenAnalyserR = null;
    fullscreenGainNode   = null;
    fullscreenSplitter   = null;
    fullscreenMerger     = null;
    fullscreenUpmixNode  = null;
    fullscreenMediaDest  = null;

    // メーター関連フラグのリセット
    if (fullscreenLingerTimerId) {
        clearTimeout(fullscreenLingerTimerId);
        fullscreenLingerTimerId = null;
    }
    isVolumeMeasurementActive = false;

    // mono 判定などのフラグもリセット
    if (typeof isMonoSource !== 'undefined') {
        isMonoSource = false;
    }
    fullscreenSourceKind = null;

    // AudioContext のリセット
    FullscreenAudioManager.resetContext();

    // 初期化フラグを戻して、次回 setupFullscreenAudio で完全再構築させる
    setupFullscreenAudio.initialized = false;

    logDebug('[fullscreen.js] Fullscreen audio reset completed.');
}

// 音声フェードイン処理
function audioFadeIn(duration) {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) return;
    if (!fullscreenGainNode) {
        videoElement.volume = globalState.defaultVolume / 100;
        return;
    }
    const audioContext = FullscreenAudioManager.getContext();
    const currentTime = audioContext.currentTime;
    const targetGain = globalState.defaultVolume / 100;

    // targetGain が 0 の場合、ゲインを直接 0 に設定する
    if (targetGain <= 0) {
        fullscreenGainNode.gain.cancelScheduledValues(currentTime);
        fullscreenGainNode.gain.setValueAtTime(0, currentTime);
        return;
    }

    // 初期値は 0 ではなく非常に小さい値にする
    const initialGain = 0.001;
    fullscreenGainNode.gain.cancelScheduledValues(currentTime);
    fullscreenGainNode.gain.setValueAtTime(initialGain, currentTime);
    fullscreenGainNode.gain.exponentialRampToValueAtTime(targetGain, currentTime + duration);
}

// ------------------------------------
// 音量測定とデータ送信
// ------------------------------------
// 音量測定ループフラグ
let isVolumeMeasurementActive = false;

// メーター計測
function startVolumeMeasurement(updateInterval = 60) {
    const audioContext = FullscreenAudioManager.getContext();

    if (!fullscreenAnalyserL) {
        fullscreenAnalyserL = audioContext.createAnalyser();
        fullscreenAnalyserL.fftSize = 2048;
    }
    if (!fullscreenAnalyserR) {
        fullscreenAnalyserR = audioContext.createAnalyser();
        fullscreenAnalyserR.fftSize = 2048;
    }

    // すでにループが動いていれば新しくは起動しない
    if (isVolumeMeasurementActive) {
        return;
    }

    isVolumeMeasurementActive = true;
    logDebug('[fullscreen.js] Volume measurement loop started.');

    // stopVolumeMeasurement の linger で Gain が極小に落ちたままになるのを防ぐ
    try {
        const t = audioContext.currentTime;
        const rawGain = (typeof globalState.volume === 'number')
            ? globalState.volume
            : (globalState.defaultVolume ?? 100) / 100;

        // ストリームソース（UVC/NDI）は 0dB（1.0）まで、それ以外は従来どおり最大 4.0 まで許容
        const maxGain = (fullscreenSourceKind === 'stream') ? 1.0 : 4.0;
        const targetGain = Math.max(0.001, Math.min(maxGain, rawGain));

        if (fullscreenGainNode) {
            fullscreenGainNode.gain.cancelScheduledValues(t);
            fullscreenGainNode.gain.setValueAtTime(targetGain, t);
        }
    } catch (_e) {}

    try { fullscreenAnalyserL.fftSize = 2048; } catch (_e) {}
    try { fullscreenAnalyserR.fftSize = 2048; } catch (_e) {}

    const bufL = new Float32Array(fullscreenAnalyserL.fftSize);
    const bufR = new Float32Array(fullscreenAnalyserR.fftSize);

    // 再生速度に応じてメーター更新間隔を補正（2.0x以上なら少し間隔を空ける）
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

    // mono 判定→未使用ロジック
    // const DETECT_WINDOW_FRAMES = Math.max(8, Math.floor(800 / Math.max(1, effectiveInterval)));
    // let monoLikeFrames = 0;

    // デバッグ用：最初の数フレームは必ずピーク値をログ
    let debugFrameCount = 0;
    const DEBUG_MAX_FRAMES = 20;

    const intervalId = setInterval(() => {
        if (!isVolumeMeasurementActive) {
            clearInterval(intervalId);
            return;
        }

        // analyser が何らかの理由で消えていたら即停止
        if (!fullscreenAnalyserL || !fullscreenAnalyserR) {
            clearInterval(intervalId);
            isVolumeMeasurementActive = false;
            logInfo('[fullscreen.js] Analyser nodes missing. Volume measurement loop aborted.');
            return;
        }

        fullscreenAnalyserL.getFloatTimeDomainData(bufL);
        let peakL = 0.0;
        for (let i = 0; i < bufL.length; i++) {
            const v = Math.abs(bufL[i]);
            if (v > peakL) peakL = v;
        }

        fullscreenAnalyserR.getFloatTimeDomainData(bufR);
        let peakR = 0.0;
        for (let i = 0; i < bufR.length; i++) {
            const v = Math.abs(bufR[i]);
            if (v > peakR) peakR = v;
        }

        let dbL = 20 * Math.log10(Math.max(peakL, 1e-9));
        let dbR = 20 * Math.log10(Math.max(peakR, 1e-9));

        if (skipFrames > 0) {
            skipFrames--;
            dbL = minDb;
            dbR = minDb;
        }

        dbL = Math.min(maxDb, Math.max(minDb, dbL));
        dbR = Math.min(maxDb, Math.max(minDb, dbR));

        // モノラル検出：mono ソースなら L を R にも流用
        const reportR = isMonoSource ? dbL : dbR;

        // fullscreen → main へ送信
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level-lr', { L: dbL, R: reportR });
        const dbMax = Math.max(dbL, reportR);
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level', dbMax);

    }, effectiveInterval);
}

// 音量測定停止
function stopVolumeMeasurement(lingerMs = 200) {
    if (fullscreenLingerTimerId) {
        clearTimeout(fullscreenLingerTimerId);
        fullscreenLingerTimerId = null;
    }
    if (!isVolumeMeasurementActive) return;

    const ctx = FullscreenAudioManager.getContext();
    try {
        if (fullscreenGainNode) {
            const t = ctx.currentTime;
            fullscreenGainNode.gain.cancelScheduledValues(t);
            fullscreenGainNode.gain.linearRampToValueAtTime(0.0001, t + Math.min(lingerMs, 300) / 1000);
        }
    } catch (_e) {}

    fullscreenLingerTimerId = setTimeout(() => {
        fullscreenLingerTimerId = null;
        isVolumeMeasurementActive = false;
        logDebug('[fullscreen.js] Volume measurement stopped after linger.');
    }, Math.max(0, lingerMs));
}

// ----------------------------------------
// スクリーンショット機能
// ----------------------------------------

// Shift+S キーでキャプチャを取得し、保存依頼
window.electronAPI.ipcRenderer.on('capture-screenshot', () => {
    captureScreenshot();
});

function captureScreenshot() {
    const videoElement = document.getElementById('fullscreen-video');
    if (!videoElement) {
        logInfo('[fullscreen.js] Video element not found for screenshot capture.');
        return;
    }
    // キャンバスを作成して動画の現在フレームを描画
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // キャンバスの内容を PNG 形式の Blob に変換
    canvas.toBlob((blob) => {
        if (!blob) {
            logInfo('[fullscreen.js] Failed to capture screenshot blob.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function() {
            const arrayBuffer = reader.result;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `screenshot-${timestamp}.png`;
            window.electronAPI.saveScreenshot(arrayBuffer, fileName, globalState.path)
                .then((savedPath) => {
                    logInfo(`[fullscreen.js] Screenshot saved: ${savedPath}`);
                    window.electronAPI.notifyScreenshotSaved(savedPath);
                })
                .catch((err) => {
                    logInfo(`[fullscreen.js] Screenshot save failed: ${err}`);
                });
        };
        reader.readAsArrayBuffer(blob);
    }, 'image/png');
}

// ----------------------------------------
// DSK機能
// ----------------------------------------

// DSK表示状態を管理するグローバル変数
window.fsDSKActive = window.fsDSKActive || false;

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

// DSKオーバーレイの初期化と表示関数
let fsDSKOverlay = null;

function initFsDSKOverlay() {
    const container = document.getElementById('fullscreen-video')?.parentElement;
    if (!container) {
        logInfo('[fullscreen.js] Full-screen DSK overlay container cannot be found.');
        return;
    }
    // 既存のオーバーレイがあれば再利用
    fsDSKOverlay = container.querySelector('#fs-dsk-overlay');
    if (!fsDSKOverlay) {
        fsDSKOverlay = document.createElement('div');
        fsDSKOverlay.id = 'fs-dsk-overlay';
        fsDSKOverlay.style.position = 'absolute';
        fsDSKOverlay.style.top = '0';
        fsDSKOverlay.style.left = '0';
        fsDSKOverlay.style.width = '100%';
        fsDSKOverlay.style.height = '100%';
        fsDSKOverlay.style.opacity = '0';
        fsDSKOverlay.style.visibility = 'hidden';
        fsDSKOverlay.style.zIndex = '5';
        fsDSKOverlay.style.backgroundColor = 'transparent';
        container.appendChild(fsDSKOverlay);
    }
}

function showFullscreenDSK(itemData) {
    if (!fsDSKOverlay) {
        initFsDSKOverlay();
        if (!fsDSKOverlay) return;
    }
    fsDSKOverlay.innerHTML = '';
    fsDSKOverlay.style.visibility = 'visible';
    fsDSKOverlay.style.opacity    = '0';
    fsDSKOverlay.style.backgroundColor = 'transparent';

    if (!itemData) {
        return;
    }
    currentDSKItem = itemData;

    // video要素を生成
    const video = document.createElement('video');
    video.src = getSafeFileURL(itemData.path);
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.setProperty('background-color', 'transparent', 'important');
    video.muted = true;
    video.setAttribute('playsinline', 'true');

    // IN～OUT を秒に変換
    const inSec  = parseTimecode(itemData.inPoint);
    const outSec = parseTimecode(itemData.outPoint);

    // EndMode に従って一度だけエンド処理を発動
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
        // NEXT／OFF は再生完了(ended)のみ、PAUSE／FTB は timeupdate+ended
        if (mode === 'NEXT' || mode === 'OFF') {
            video.addEventListener('ended', onFsEnd);
        } else {
            video.addEventListener('timeupdate', onFsTimeUpdate);
            video.addEventListener('ended',      onFsEnd);
        }
    }

    // 再生開始
    video.addEventListener('loadeddata', function() {
        video.play().catch(err => logInfo('[fullscreen.js] fsDSK video.play() error:', err));
    });

    fsDSKOverlay.appendChild(video);
    // 再度可視化
    fsDSKOverlay.style.visibility = 'visible';

    // フェードイン
    const fadeDuration = itemData.ftbRate * 1000;
    fadeIn(fsDSKOverlay, fadeDuration);
}

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

function hideFullscreenDSK() {
    if (!fsDSKOverlay) return;

    // OFF/NEXT は即時クリア＆非表示
    const mode = currentDSKItem?.endMode || 'OFF';
    if (mode === 'OFF' || mode === 'NEXT') {
        fsDSKOverlay.innerHTML   = '';
        fsDSKOverlay.style.opacity    = '0';
        fsDSKOverlay.style.visibility = 'hidden';
        window.fsDSKActive = false;
        return;
    }

    // その他（FTB/PAUSE/REPEAT）は既存通りフェードアウト
    const fadeDuration = (currentDSKItem && currentDSKItem.ftbRate ? currentDSKItem.ftbRate * 1000 : DEFAULT_FADE_DURATION);
    fadeOut(fsDSKOverlay, fadeDuration, () => {
        fsDSKOverlay.innerHTML = '';
    });
}

// フルスクリーンDSK映像の一時停止処理
function pauseFullscreenDSK() {
    if (!fsDSKOverlay) return;
    const video = fsDSKOverlay.querySelector('video');
    if (video && !video.paused) {
        video.pause();
    }
}

// フルスクリーンDSK映像の再生処理
function playFullscreenDSK() {
    if (!fsDSKOverlay) return;
    const video = fsDSKOverlay.querySelector('video');
    if (!video) return;

    // 確実に可視化
    fsDSKOverlay.style.visibility = 'visible';

    if (video.paused) {
        video.play().catch(err => logInfo('[fullscreen.js] fsDSK video.play() error:', err));
    }

    // PAUSE モード時は終了検知リスナを再登録
    if (currentDSKItem?.endMode === 'PAUSE') {
        if (video._onFsTimeUpdate) video.addEventListener('timeupdate', video._onFsTimeUpdate);
        if (video._onFsEnd)        video.addEventListener('ended',      video._onFsEnd);
    }
}

// DSK終了時の EndMode 分岐処理
function handleFullscreenDskEnd(videoEl) {
    if (!videoEl || !currentDSKItem || !fsDSKOverlay) return;

    const inSec  = parseTimecode(currentDSKItem.inPoint);
    const outSec = parseTimecode(currentDSKItem.outPoint);
    const mode   = currentDSKItem.endMode || 'OFF';

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
    // 進行中のフェードアウト処理があればキャンセル
    cancelFadeOut();
    const videoElement = document.getElementById('fullscreen-video');

    if (videoElement) {
        // 動画の停止（src は次の setupVideoPlayer() で上書きされるので、ここでは空にしない）
        // src を空にするとデコード/レンダリングが毎回リセットされ、StartMode=PLAY の立ち上がりが遅く見えることがある
        videoElement.pause();

        // UVC デバイスのストリームを解除
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    }

    logInfo('[fullscreen.js] Fullscreen state has been reset.');
}
