// -----------------------
//     fullscreen.js
//     ver 2.3.8
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

// ----------------------------------------
// フルスクリーンエリアの初期化
// ----------------------------------------
function initializeFullscreenArea() {
    const videoElement = document.getElementById('fullscreen-video');

    if (videoElement) {
        videoElement.pause();
        videoElement.src = '';
        videoElement.currentTime = 0;

        // UVC デバイスのストリームをリセット
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    }

    // グローバル状態をリセット
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

    // フェードキャンバスの初期化
    initializeFadeCanvas();

    // 音声チェーンを再初期化させるためのフラグリセット
    setupFullscreenAudio.initialized = false;

    logInfo('[fullscreen.js] Fullscreen area has been reset.');
}

// ------------------------------------
// フェードキャンバスの初期化
// ------------------------------------
function initializeFadeCanvas() {
    const existingCanvas = document.getElementById('fadeCanvas');
    if (existingCanvas) {
        existingCanvas.style.opacity = '0';
        existingCanvas.style.display = 'none';
        return existingCanvas;
    }

    // 新しいキャンバスを作成
    const fadeCanvas = document.createElement('div');
    fadeCanvas.id = 'fadeCanvas';
    fadeCanvas.style.position = 'absolute';
    fadeCanvas.style.top = '0';
    fadeCanvas.style.left = '0';
    fadeCanvas.style.width = '100vw';
    fadeCanvas.style.height = '100vh';
    fadeCanvas.style.backgroundColor = 'black';
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.pointerEvents = 'none';

    document.body.appendChild(fadeCanvas);
    return fadeCanvas;
}

// ---------------------------------------
// オンエアデータを受け取るイベントリスナー
// ---------------------------------------
window.electronAPI.onReceiveFullscreenData((itemData) => {
    logInfo(`[fullscreen.js] Received On-Air data in fullscreen: ${JSON.stringify(itemData)}`);

    // 既存のストリームや動画を初期化
    resetFullscreenState();

    // メインプロセスを開始
    handleOnAirData(itemData);
});

// --------------------------------------------
// 受け取った時点のデータを初期値として設定
// --------------------------------------------
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
        inPoint: parseFloat(itemData.inPoint || 0),
        outPoint: parseFloat(itemData.outPoint || 0),
        startMode: itemData.startMode || 'PAUSE',
        endMode: itemData.endMode || 'PAUSE',
        defaultVolume: defVol,
        masterVolume: masterVol,
        ftbRate: itemData.ftbRate || 1.0,
        volume: (typeof itemData.volume === 'number') ? itemData.volume : computedVolume
    };
    logInfo(`[fullscreen.js] Global state initialized with On-Air data: ${JSON.stringify(globalState)}`);
}



// ------------------------------------
// オーバーレイキャンバスの初期化
// ------------------------------------
function initializeOverlayCanvas() {
    const canvas = document.getElementById('overlay-canvas');
    if (!canvas) {
        logInfo('[fullscreen.js] overlay-canvas element not found.');
        return null;
    }
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    return canvas;
}

// ------------------------------------
// エンドモード NEXT：最後のフレームをオーバーレイに固定
// ------------------------------------
function handleEndModeNEXT() {
    logInfo('[fullscreen.js] Called endmode:NEXT - capturing last frame');
    const videoElement   = document.getElementById('fullscreen-video');
    const overlayCanvas  = initializeOverlayCanvas();
    if (!videoElement || !overlayCanvas) {
        logInfo('[fullscreen.js] Cannot execute handleEndModeNEXT due to missing element.');
        return;
    }
    const ctx = overlayCanvas.getContext('2d');
    // 最終フレームを描画
    ctx.drawImage(videoElement, 0, 0, overlayCanvas.width, overlayCanvas.height);
    // オーバーレイ表示
    overlayCanvas.style.display = 'block';
    // 次動画再生時にオーバーレイ解除
    videoElement.addEventListener('loadeddata', function hideOverlay() {
        overlayCanvas.style.display = 'none';
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        videoElement.removeEventListener('loadeddata', hideOverlay);
    });
}

// ---------------------------------------
// オンエアデータを処理して再生する
// ---------------------------------------

// フェード中の音声処理をキャンセルする補助関数
function cancelAudioFade() {
    if (fullscreenGainNode) {
        const audioContext = FullscreenAudioManager.getContext();
        const currentTime = audioContext.currentTime;
        fullscreenGainNode.gain.cancelScheduledValues(currentTime);
    }
}

// オンエアデータを処理して再生する
function handleOnAirData(itemData) {
    if (!itemData) {
        logInfo('[fullscreen.js] No On-Air data received.');
        return;
    }
    stopMonitoringPlayback();
    cancelAudioFade();
    setInitialData(itemData);

    // 動画とUVCの振り分け
    if (globalState.deviceId) {
        logInfo('[fullscreen.js] Detected UVC device. Setting up UVC device stream.');
        setupUVCDevice();
    } else if (globalState.path) {
        logInfo('[fullscreen.js] Detected video file. Setting up video player.');
        setupVideoPlayer();
    } else {
        logInfo('[fullscreen.js] No valid video file or UVC device detected. Skipping setup.');
    }

    // スタートモードに沿って再生を開始
    handleStartMode();
}

// ----------------------------------------
// ビデオプレーヤーに動画をセットする関数
// ----------------------------------------
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

    // UVCデバイスでない場合は、安全なURLに変換してセットする
    if (typeof globalState.path === 'string' && !globalState.path.startsWith("UVC_DEVICE")) {
        videoElement.src = getSafeFileURL(globalState.path);
    } else {
        videoElement.src = globalState.path;
    }

    // IN点から再生を開始する準備
    videoElement.currentTime = globalState.inPoint;

    // ビデオの音量を設定（オンエア側で計算された最終出力音量を適用）
    const initialVolume = (globalState.volume !== undefined ? globalState.volume : (globalState.defaultVolume / 100));
    videoElement.volume = initialVolume;

    // 動画メタデータがロードされた後に音声を初期化
    videoElement.addEventListener('loadedmetadata', () => {
        if (!setupFullscreenAudio.initialized) {
            setupFullscreenAudio(videoElement);
            logDebug('[fullscreen.js] Audio initialized during setupVideoPlayer.');
        }

        // メタデータ確定後に再確認して音量を適用
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


// ----------------------------------------
// UVC デバイスストリームをビデオプレーヤーにセット
// ----------------------------------------
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
        // デバイスストリームを取得
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });

        // ビデオ要素にストリームを設定
        videoElement.srcObject = stream;
        videoElement.addEventListener('canplay', function handleCanPlay() {
            fullscreenFadeFromBlack(0.3, isFillKeyMode);
            videoElement.removeEventListener('canplay', handleCanPlay);
        });
        await videoElement.play();
        globalState.stream = stream;
        logInfo('[fullscreen.js] UVC device stream initialized successfully.');
        logDebug(`[fullscreen.js] Device ID: ${deviceId}`);
    } catch (error) {
        logInfo('[fullscreen.js] Failed to initialize UVC device stream.');
        logDebug(`[fullscreen.js] Error: ${error.message}`);
    }
}


// ---------------------------------------
// スタートモードにそって再生を開始
// ---------------------------------------
function handleStartMode() {
    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found.');
        return;
    }

    // リピートモードが有効な場合
    if (globalState.repeatFlag) {
        logInfo('[fullscreen.js] Repeat mode triggered. Ignoring startMode and restarting from IN point.');

        // IN 点から再生を開始
        videoElement.currentTime = globalState.inPoint;
        videoElement.play()
            .then(() => {
                logInfo('[fullscreen.js] Repeat playback started successfully.');
                globalState.repeatFlag = false;
            })
            .catch(error => logDebug(`[fullscreen.js] Repeat playback failed to start: ${error.message}`));

        // 再生監視の更新
        monitorVideoPlayback();
        return;
    }

    // スタートモードが PLAY の場合
    if (globalState.startMode === 'PLAY') {
        logInfo('[fullscreen.js] Start mode is PLAY. Starting playback.');

        // IN 点から再生を開始
        videoElement.currentTime = globalState.inPoint;
        videoElement.play()
            .then(() => {
                logInfo('[fullscreen.js] Playback started successfully.');
                startVolumeMeasurement();
                window.electronAPI.sendControlToFullscreen({ command: 'play' });
            })
            .catch(error => logDebug(`[fullscreen.js] Playback failed to start: ${error.message}`));

        // 再生監視を開始
        monitorVideoPlayback();

    } else if (globalState.startMode === 'PAUSE') {
        logInfo('[fullscreen.js] Start mode is PAUSE. Video is ready to play.');

        // IN 点にシークするだけで再生しない
        videoElement.currentTime = globalState.inPoint;
        stopVolumeMeasurement();

    } else if (globalState.startMode === 'FADEIN') {
        logInfo('[fullscreen.js] Start mode is FADEIN. Initiating fade in playback.');

        // IN 点にシークし、初期音量を 0 に設定
        videoElement.currentTime = globalState.inPoint;
        videoElement.volume = 0;
        
        // 画面側のフェードイン処理を実施（FTBレートを duration として使用）
        const ftbRate = globalState.ftbRate || 1.0;
        fullscreenFadeFromBlack(ftbRate, isFillKeyMode);
        logInfo('[fullscreen.js] FADEIN: Fade from black initiated.');

        // 再生開始
        videoElement.play()
            .then(() => {
                // 音声フェードイン処理を実施
                audioFadeIn(ftbRate);
                startVolumeMeasurement();
                logInfo('[fullscreen.js] Playback started with FADEIN effect.');
                window.electronAPI.sendControlToFullscreen({
                    command: 'fadein',
                    ftbRate: ftbRate,
                    fillKeyMode: isFillKeyMode,
                    currentTime: videoElement.currentTime
                });
            })
            .catch(error => logDebug(`[fullscreen.js] Playback failed to start in FADEIN mode: ${error.message}`));

        monitorVideoPlayback();

    } else {
        logInfo(`[fullscreen.js] Unknown start mode: ${globalState.startMode}. No action taken.`);
    }
}

// ------------------------------------
// スタートモードFADEINの処理
// ------------------------------------

// もし fadeCanvas (fullscreen-fade-canvas) が存在しない場合は動的に作成
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

// Fullscreen 側のフェードイン処理（映像）
function fullscreenFadeFromBlack(duration, fillKeyMode) {
    // キャンバスをフェードイン処理用に設定
    fadeCanvas.style.visibility = 'visible';
    fadeCanvas.style.opacity = '1';
    // FILLKEY モードの場合、グローバルに保存した fillKeyBgColor を使用。なければ黒
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

// onair.js から送信された指令を受け取る
window.electronAPI.ipcRenderer.on('control', (event, data) => {
    if (data.command === 'cancel-fadeout') {
        cancelFadeOut();
        return;
    }
    if (data.command === 'fadein') {
        const ftbRate = data.ftbRate || 1.0;
        const fillKeyMode = data.fillKeyMode || false;
        logInfo('[fullscreen.js] Received fadein command with ftbRate:', ftbRate, 'fillKeyMode:', fillKeyMode);
        fullscreenFadeFromBlack(ftbRate, fillKeyMode);
    }
});

// ------------------------------------
// IN点からOUT点までの動画監視
// ------------------------------------
let playbackMonitor = null;

function monitorVideoPlayback() {
    const videoElement = document.getElementById('fullscreen-video');

    if (!videoElement) {
        logInfo('[fullscreen.js] Video player element not found. Cannot monitor playback.');
        return;
    }

    // 監視を開始
    clearInterval(playbackMonitor);
    playbackMonitor = setInterval(() => {
        if (!globalState.outPoint || globalState.outPoint <= 0) {
            logDebug('[fullscreen.js] Invalid OUT point. Stopping playback monitor.');
            clearInterval(playbackMonitor);
            playbackMonitor = null;
            return;
        }

        if (videoElement.currentTime >= globalState.outPoint) {
            logInfo(`[fullscreen.js] OUT point reached: ${globalState.outPoint}s`);
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

// ------------------------
// 操作情報の受信
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
                logDebug(`[fullscreen.js] Fullscreen fillkey background set to: ${value}`);
                break;
            case 'trigger-endMode':
                const receivedEndMode = value || 'PAUSE';
                logInfo(`[fullscreen.js]  Triggering end mode: ${receivedEndMode}`);

                // 受信したエンドモードが現在のものと異なる場合、更新
                if (globalState.endMode !== receivedEndMode) {
                    logDebug(`[fullscreen.js] Updating globalState.endMode from ${globalState.endMode} to ${receivedEndMode}`);
                    globalState.endMode = receivedEndMode;
                }
                handleEndMode(receivedEndMode);
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
 // エンドモードの処理
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

    // フェードキャンバスの初期化
    let fadeCanvas = document.getElementById('fadeCanvas');
    if (!fadeCanvas) {
        logInfo('[fullscreen.js] Fade canvas not found. Reinitializing canvas.');
        fadeCanvas = initializeFadeCanvas();
    }

    // フェードキャンバスの設定
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.display = 'block';
    // FILL-KEY モードの場合は、グローバル変数 fillKeyBgColor（ユーザー選択の色）を使用し、それ以外は黒に設定する
    fadeCanvas.style.backgroundColor = isFillKeyMode && fillKeyBgColor ? fillKeyBgColor : "black";


    let opacity = 0;
    const frameRate = 60;
    const step = 1 / (fadeDuration * frameRate);

    // 既存のフェードアウトタイマーがあればクリア
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
    }
    fadeCancelled = false;

    ftbFadeInterval = setInterval(() => {
        if (fadeCancelled) {
            clearInterval(ftbFadeInterval);
            ftbFadeInterval = null;
            logInfo('[fullscreen.js] FTB fadeout aborted due to cancellation.');
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.display = 'none';
            return;
        }
        opacity += step;
        fadeCanvas.style.opacity = opacity.toFixed(2);

        if (opacity >= 1) {
            clearInterval(ftbFadeInterval);
            ftbFadeInterval = null;
            logInfo('[fullscreen.js] FTB complete: Fade ended.');
            initializeFullscreenArea();
            fadeCanvas.style.opacity = '0';
            fadeCanvas.style.display = 'none';
            logInfo('[fullscreen.js] FTB complete: Canvas hidden.');
        }
    }, 1000 / frameRate); 
    stopVolumeMeasurement();
}

// フェードアウトアニメーションの中断処理
function cancelFadeOut() {
    fadeCancelled = true;
    const fadeCanvas = document.getElementById('fadeCanvas');
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
        logInfo('[fullscreen.js] FTB fadeout canceled.');
    }
    if (fadeCanvas) {
        fadeCanvas.style.opacity = '0';
        fadeCanvas.style.display = 'none';
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

    globalState.repeatFlag = true; 
    logInfo('[fullscreen.js] End Mode: REPEAT - Setting repeat flag and restarting playback.');

    handleStartMode();
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
let fullscreenAnalyser = null;
let fullscreenGainNode = null;
let fullscreenSourceNode = null;
let animationFrameId = null;

// 音声初期化フラグ
setupFullscreenAudio.initialized = false;

// 音声の初期化関数
function setupFullscreenAudio(videoElement) {
    if (setupFullscreenAudio.initialized) return;

    const audioContext = FullscreenAudioManager.getContext();

    // AnalyserNode と GainNode のセットアップ
    if (!fullscreenAnalyser) {
        fullscreenAnalyser = audioContext.createAnalyser();
        fullscreenAnalyser.fftSize = 128;
    }
    if (!fullscreenGainNode) {
        fullscreenGainNode = audioContext.createGain();
    }

    // MediaElementSource の再接続
    if (!fullscreenSourceNode || fullscreenSourceNode.mediaElement !== videoElement) {
        if (fullscreenSourceNode) {
            fullscreenSourceNode.disconnect();
        }
        try {
            fullscreenSourceNode = audioContext.createMediaElementSource(videoElement);
            fullscreenSourceNode.connect(fullscreenGainNode);
            fullscreenGainNode.connect(fullscreenAnalyser);
        } catch (error) {
            if (error.name === 'InvalidStateError') {
                logInfo('MediaElementSourceNode already exists. Skipping creation.');
            } else {
                logInfo('Error creating MediaElementSourceNode:', error);
            }
        }
    }

    // MediaStreamDestination を作成し、隠しの audio 要素で出力する
    const mediaStreamDest = audioContext.createMediaStreamDestination();
    // fullscreenGainNode から MediaStreamDestination に接続する
    fullscreenGainNode.connect(mediaStreamDest);

    // 隠しの audio 要素を作成
    let hiddenAudio = document.getElementById('fullscreen-hidden-audio');
    if (!hiddenAudio) {
        hiddenAudio = document.createElement('audio');
        hiddenAudio.id = 'fullscreen-hidden-audio';
        hiddenAudio.style.display = 'none';
        document.body.appendChild(hiddenAudio);
    }
    // audio 要素に MediaStreamDestination の stream をセット
    hiddenAudio.srcObject = mediaStreamDest.stream;

    // 音声ストリームをグローバル変数に保存
    window.fullscreenAudioStream = mediaStreamDest.stream;

    window.electronAPI.getDeviceSettings().then(settings => {
        const outputDeviceId = settings.onairAudioOutputDevice;
        if (hiddenAudio.setSinkId) {
            hiddenAudio.setSinkId(outputDeviceId)
                .then(() => {
                    logDebug('[fullscreen.js] Hidden audio output routed to device: ' + outputDeviceId);
                })
                .catch(err => {
                    logInfo('[fullscreen.js] Failed to set hidden audio output device: ' + err);
                });
        } else {
            logInfo('[fullscreen.js] hiddenAudio.setSinkId is not supported.');
        }
        // 再生開始
        hiddenAudio.play().catch(err => {
            logInfo('[fullscreen.js] Hidden audio play failed: ' + err);
        });
    });

    setupFullscreenAudio.initialized = true;

    logDebug('[fullscreen.js] Fullscreen audio setup completed with MediaStreamDestination.');
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

// 音声のリセット関数
function resetFullscreenAudio() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (fullscreenSourceNode) {
        fullscreenSourceNode.disconnect();
        fullscreenSourceNode = null;
    }
    FullscreenAudioManager.resetContext();
    logDebug('[fullscreen.js] Fullscreen audio reset completed.');
}

// Fullscreen 用音声フェードイン処理の実装
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

// 音量測定
function startVolumeMeasurement(updateInterval = 60) {
    if (isVolumeMeasurementActive || !fullscreenAnalyser) return;

    isVolumeMeasurementActive = true;
    const dataArray = new Uint8Array(fullscreenAnalyser.frequencyBinCount);
    let smoothedDbFS = -30;
    let skipFrames = 10;

    const intervalId = setInterval(() => {
        if (!isVolumeMeasurementActive) {
            clearInterval(intervalId);
            return;
        }

        fullscreenAnalyser.getByteFrequencyData(dataArray);

        // Raw Max Amplitude の取得
        const rawMaxAmplitude = Math.max(...dataArray);

        // スケーリング (低音量を広げる)
        const scaledAmplitude = rawMaxAmplitude / 255;
        const adjustedAmplitude = Math.pow(scaledAmplitude, 1.5);

        // dBFS 計算
        let dbFS = 20 * Math.log10(adjustedAmplitude || 1);

        // 初期フレームスキップ
        if (skipFrames > 0) {
            skipFrames--;
            dbFS = -30;
        }

        // ノイズ除去: 極端な値を制限
        if (rawMaxAmplitude < 5) dbFS = -30;

        // スムージング処理
        smoothedDbFS = 0.7 * dbFS + 0.3 * smoothedDbFS;

        // クランプ (-30 ～ 0 dBFS)
        dbFS = Math.max(-30, Math.min(smoothedDbFS, 0));

        // メインプロセスに送信
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level', dbFS);
    }, updateInterval);
}

// 音量測定を停止する関数
function stopVolumeMeasurement() {
    if (!isVolumeMeasurementActive) return;

    isVolumeMeasurementActive = false;
    logDebug('[fullscreen.js] Volume measurement paused.');
}

// ----------------------------------------
// スクリーンショット機能
// ----------------------------------------

// Shift+S キーでキャプチャを取得し、保存依頼する処理
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
        logInfo('[fullscreen.js] フルスクリーン用DSKオーバーレイ コンテナが見つかりません。');
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

    // <video> 要素を生成
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
        // 動画の停止とクリア
        videoElement.pause();
        videoElement.src = '';
        videoElement.currentTime = 0;

        // UVC デバイスのストリームを解除
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    }

    logInfo('[fullscreen.js] Fullscreen state has been reset.');
}