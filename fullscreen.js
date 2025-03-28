﻿// -----------------------
//     fullscreen.js
//     ver 2.2.5
// -----------------------

// -----------------------
// 初期設定
// -----------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
const logDebug = window.electronAPI.logDebug;


// グローバル変数
let isFillKeyMode = false;// FILL-KEY モード判定用フラグ
let fillKeyBgColor = "#00FF00"; // フィルキーのデフォルトの背景色
let ftbFadeInterval = null;  // FTBのフェードアウト用タイマーID
let fadeCancelled = false;// フェードアウトキャンセルフラグ

// ----------------------------------------
// フルスクリーンエリアの初期化
// ----------------------------------------
function initializeFullscreenArea() {
    const videoElement = document.getElementById('fullscreen-video');

    if (videoElement) {
        videoElement.pause(); // 動画を停止
        videoElement.src = ''; // ソースをクリア
        videoElement.currentTime = 0; // 再生位置をリセット

        // UVC デバイスのストリームをリセット
        if (videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop()); // ストリームのトラックを停止
            videoElement.srcObject = null; // ストリームを解除
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
        stream: null, // UVC デバイスのストリームを解除
        volume: 1     // 追加: 初期音量は defaultVolume=100 により 1（100%）とする
    };

    // フェードキャンバスの初期化
    initializeFadeCanvas();

    logInfo('[fullscreen.js] Fullscreen area has been reset.');
}

// ------------------------------------
// フェードキャンバスの初期化
// ------------------------------------
function initializeFadeCanvas() {
    const existingCanvas = document.getElementById('fadeCanvas');
    if (existingCanvas) {
        // 既存のキャンバスがあれば透明度をリセット
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
let globalState = {}; // グローバルな状態管理オブジェクト

function setInitialData(itemData) {
    if (!itemData) {
        logInfo('[fullscreen.js] No On-Air data received to initialize.');
        return;
    }

    // 規定音量およびマスターボリュームは、0も有効な値として扱う
    const defVol = (itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100);
    const masterVol = (itemData.masterVolume !== undefined ? itemData.masterVolume : 100);
    // volume が明示的に設定されていればそれを使用、なければ規定音量とマスターボリュームの掛け算で算出
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

    // 既存の再生監視をリセット
    stopMonitoringPlayback();

    // 既存のフェード処理（ゲインのスケジュール）をキャンセル
    cancelAudioFade();

    // データセット
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
    const videoElement = document.getElementById('fullscreen-video'); // IDに合わせて修正

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
        // Audio 初期化
        if (!setupFullscreenAudio.initialized) {
            setupFullscreenAudio(videoElement);
            logDebug('[fullscreen.js] Audio initialized during setupVideoPlayer.');
        }

        // メタデータ確定後に再確認して音量を適用
        videoElement.volume = initialVolume;

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
    // Windowsの場合、バックスラッシュをスラッシュに変換
    let normalizedPath = filePath.replace(/\\/g, '/');
    // 既に file:// で始まっていない場合は付加
    if (!/^file:\/\//.test(normalizedPath)) {
        normalizedPath = 'file:///' + normalizedPath;
    }
    // encodeURI() でエンコードした後、"#" を手動で "%23" に置換
    let encoded = encodeURI(normalizedPath);
    encoded = encoded.replace(/#/g, '%23');
    return encoded;
}


// ----------------------------------------
// UVC デバイスストリームをビデオプレーヤーにセット
// ----------------------------------------
async function setupUVCDevice() {
    const videoElement = document.getElementById('fullscreen-video'); // HTML と統一
    const deviceId = globalState.deviceId; // グローバル状態からデバイス ID を取得

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
        // 「canplay」イベントでストリームが再生可能になったタイミングにフェードイン処理を実施
        videoElement.addEventListener('canplay', function handleCanPlay() {
            // 0.3秒で黒からフェードイン
            fullscreenFadeFromBlack(0.3, isFillKeyMode);
            videoElement.removeEventListener('canplay', handleCanPlay);
        });
        await videoElement.play();

        // ストリームをグローバル状態に保存（必要に応じて停止で使用）
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
                
                // リピートフラグ解除の処理
                globalState.repeatFlag = false;  // 再生後にリピートフラグを解除

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
                startVolumeMeasurement(); // 再生開始時に測定を開始
                // Fullscreen 側へ PLAY 指令を送信
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
        // （必要なら音量UIも更新）
        
        // 画面側のフェードイン処理を実施（FTBレートを duration として使用）
        const ftbRate = globalState.ftbRate || 1.0;
        fullscreenFadeFromBlack(ftbRate, isFillKeyMode);
        console.log('[fullscreen.js] FADEIN: Fade from black initiated.');

        // 再生開始
        videoElement.play()
            .then(() => {
                // 音声フェードイン処理を実施（既存の audioFadeIn 関数を利用）
                audioFadeIn(ftbRate);
                startVolumeMeasurement();
                logInfo('[fullscreen.js] Playback started with FADEIN effect.');
                // Fullscreen 側へ FADEIN 指令を送信
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
    // 以下、画面全体に配置するためのスタイル設定
    fadeCanvas.style.position = 'fixed';
    fadeCanvas.style.top = '0';
    fadeCanvas.style.left = '0';
    fadeCanvas.style.width = '100vw';
    fadeCanvas.style.height = '100vh';
    fadeCanvas.style.zIndex = '9999';
    fadeCanvas.style.pointerEvents = 'none';
    fadeCanvas.style.backgroundColor = 'black'; // 初期背景：黒
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
            console.log('[fullscreen.js] Fade in completed.');
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
        console.log('[fullscreen.js] Received fadein command with ftbRate:', ftbRate, 'fillKeyMode:', fillKeyMode);
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
    clearInterval(playbackMonitor); // 既存の監視をクリア
    playbackMonitor = setInterval(() => {
        if (!globalState.outPoint || globalState.outPoint <= 0) {
            logDebug('[fullscreen.js] Invalid OUT point. Stopping playback monitor.');
            clearInterval(playbackMonitor);
            playbackMonitor = null;
            return;
        }

        if (videoElement.currentTime >= globalState.outPoint) {
            logInfo(`[fullscreen.js] OUT point reached: ${globalState.outPoint}s`);
            clearInterval(playbackMonitor); // 監視を停止
            stopVolumeMeasurement();
            playbackMonitor = null;

        }
    }, 100); // 100ms ごとにチェック
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
    const fullscreenVideoElement = document.getElementById('fullscreen-video'); // 明示的に要素を取得

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
                monitorVideoPlayback(); // 再生時に監視を開始
                startVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video playing and monitoring started.');
                break;
            case 'pause':
                fullscreenVideoElement.pause();
                stopMonitoringPlayback(); // 一時停止時に監視を停止
                stopVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video paused and monitoring stopped.');
                break;
            case 'stop':
                fullscreenVideoElement.pause();
                fullscreenVideoElement.currentTime = 0;
                stopMonitoringPlayback(); // 停止時に監視も停止
                stopVolumeMeasurement();
                logDebug('[fullscreen.js] Fullscreen video stopped and monitoring stopped.');
                break;
            case 'seek':
                fullscreenVideoElement.currentTime = value;
                logDebug(`[fullscreen.js] Fullscreen video seeked to: ${value}`);

                if (value >= globalState.outPoint) {
                    fullscreenVideoElement.pause();
                    stopMonitoringPlayback(); // OUT点を超えた場合に再生停止
                    logInfo('[fullscreen.js] Seeked beyond OUT point. Playback and monitoring stopped.');
                } else if (!fullscreenVideoElement.paused) {
                    monitorVideoPlayback(); // 再生中であれば監視を再開
                }
                break;
            case 'set-volume':
                if (value >= 0 && value <= 1) {
                    fullscreenVideoElement.volume = Math.min(1, Math.max(0, value));
                    // GainNode が存在すれば、そのゲインも更新する
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
                initializeFullscreenArea(); // 初期化処理を実行
                stopMonitoringPlayback(); // オフエア時に監視も停止
                stopVolumeMeasurement();
                break;
            case 'set-fillkey-bg':
                if (value && value.trim() !== "") {
                    isFillKeyMode = true;
                    fillKeyBgColor = value;  // 選択された色を保存
                    fullscreenVideoElement.style.setProperty("background-color", value, "important");
                } else {
                    isFillKeyMode = false;
                    fillKeyBgColor = "";
                    fullscreenVideoElement.style.removeProperty("background-color");
                }
                logDebug(`[fullscreen.js] Fullscreen fillkey background set to: ${value}`);
                break;
            case 'trigger-endMode': // エンドモード発動コマンド
                const receivedEndMode = value || 'PAUSE'; // value を使用
                logInfo(`[fullscreen.js]  Triggering end mode: ${receivedEndMode}`);

                // 受信したエンドモードが現在のものと異なる場合、更新
                if (globalState.endMode !== receivedEndMode) {
                    logDebug(`[fullscreen.js] Updating globalState.endMode from ${globalState.endMode} to ${receivedEndMode}`);
                    globalState.endMode = receivedEndMode;
                }

                handleEndMode(receivedEndMode); // エンドモードを発動
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
    initializeFullscreenArea(); // 初期化
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

    videoElement.pause(); // 一時停止する
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
        fadeCanvas = initializeFadeCanvas(); // サイズ調整
    }

    // フェードキャンバスの設定
    fadeCanvas.style.opacity = '0';
    fadeCanvas.style.display = 'block'; // キャンバスを表示
    // FILL-KEY モードの場合は、グローバル変数 fillKeyBgColor（ユーザー選択の色）を使用し、
    // それ以外は黒に設定する
    fadeCanvas.style.backgroundColor = isFillKeyMode && fillKeyBgColor ? fillKeyBgColor : "black";


    let opacity = 0;
    const frameRate = 60; // フェードのFPS
    const step = 1 / (fadeDuration * frameRate); // FTBRateの呼び出し

    // 既存のフェードアウトタイマーがあればクリア
    if (ftbFadeInterval) {
        clearInterval(ftbFadeInterval);
        ftbFadeInterval = null;
    }
    // キャンセルフラグをリセット（フェード開始時はキャンセルされていない状態にする）
    fadeCancelled = false;

    // Fade animation（キャンセルチェック付き）
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
        fadeCanvas.style.opacity = opacity.toFixed(2); // 2ピクセル調整

        if (opacity >= 1) {
            clearInterval(ftbFadeInterval);
            ftbFadeInterval = null;
            logInfo('[fullscreen.js] FTB complete: Fade ended.');

            // フェードが終わった後
            initializeFullscreenArea(); // 初期化
            fadeCanvas.style.opacity = '0'; // フェードキャンバスの初期化
            fadeCanvas.style.display = 'none'; // フェードキャンバスを非表示
            logInfo('[fullscreen.js] FTB complete: Canvas hidden.');
        }
    }, 1000 / frameRate); // 60fps
    stopVolumeMeasurement();
}

// フェードアウトアニメーションの中断処理
function cancelFadeOut() {
    // キャンセルフラグを立てる（これにより進行中のフェードアウト処理を中断する）
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

    globalState.repeatFlag = true; //フラグリセット（※重要）
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
    if (setupFullscreenAudio.initialized) return; // 初期化済みならスキップ

    const audioContext = FullscreenAudioManager.getContext();

    // AnalyserNode と GainNode のセットアップ
    if (!fullscreenAnalyser) {
        fullscreenAnalyser = audioContext.createAnalyser();
        fullscreenAnalyser.fftSize = 128; // 解像度設定
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
            // ※従来は fullscreenAnalyser.connect(audioContext.destination) していた部分
        } catch (error) {
            if (error.name === 'InvalidStateError') {
                console.warn('MediaElementSourceNode already exists. Skipping creation.');
            } else {
                console.error('Error creating MediaElementSourceNode:', error);
            }
        }
    }

    // MediaStreamDestination を作成し、隠しの audio 要素で出力する
    const mediaStreamDest = audioContext.createMediaStreamDestination();
    // fullscreenAnalyser から mediaStreamDest へ接続
    fullscreenAnalyser.connect(mediaStreamDest);

    // 隠しの audio 要素を作成（存在しなければ）
    let hiddenAudio = document.getElementById('fullscreen-hidden-audio');
    if (!hiddenAudio) {
        hiddenAudio = document.createElement('audio');
        hiddenAudio.id = 'fullscreen-hidden-audio';
        hiddenAudio.style.display = 'none';
        document.body.appendChild(hiddenAudio);
    }
    // audio 要素に MediaStreamDestination の stream をセット
    hiddenAudio.srcObject = mediaStreamDest.stream;

    // Device Settings から選択された音声出力先に切替
    window.electronAPI.getDeviceSettings().then(settings => {
        const outputDeviceId = settings.onairAudioOutputDevice; // ONAIR AUDIO OUTPUT DEVICE の値
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

    setupFullscreenAudio.initialized = true; // 初期化完了フラグを設定

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
    
    // 初期値は 0 ではなく非常に小さい値にする（指数ランプは0を扱えない）
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
    let smoothedDbFS = -30; // 初期値
    let skipFrames = 10; // 初期フレームスキップ

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
            dbFS = -30; // 初期フレームは静音値を送信
        }

        // ノイズ除去: 極端な値を制限
        if (rawMaxAmplitude < 5) dbFS = -30;

        // スムージング処理
        smoothedDbFS = 0.7 * dbFS + 0.3 * smoothedDbFS;

        // クランプ (-30 ～ 0 dBFS)
        dbFS = Math.max(-30, Math.min(smoothedDbFS, 0));

        // デバッグ用ログ
        // console.log(`Raw: ${rawMaxAmplitude}, dBFS: ${dbFS}, Smoothed: ${smoothedDbFS}`);

        // メインプロセスに送信
        window.electronAPI.ipcRenderer.send('fullscreen-audio-level', dbFS);
    }, updateInterval);
}

// 音量測定を停止する関数
function stopVolumeMeasurement() {
    if (!isVolumeMeasurementActive) return; // 既に停止中ならスキップ

    isVolumeMeasurementActive = false; // フラグをオフ
    logDebug('[fullscreen.js] Volume measurement paused.'); // 停止ログ
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
        // Blob を ArrayBuffer に変換
        const reader = new FileReader();
        reader.onload = function() {
            const arrayBuffer = reader.result;
            // タイムスタンプを付与したユニークなファイル名を生成
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `screenshot-${timestamp}.png`;
            // メインプロセスに保存依頼（グローバル状態の動画パスを利用）
            window.electronAPI.saveScreenshot(arrayBuffer, fileName, globalState.path)
                .then((savedPath) => {
                    logInfo(`[fullscreen.js] Screenshot saved: ${savedPath}`);
                    // 追加: メインウィンドウへ通知
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
