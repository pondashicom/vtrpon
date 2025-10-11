// -----------------------
//     onair.js
//     ver 2.4.0
// -----------------------
// -----------------------
// 初期設定
// -----------------------

// 共通補助関数

// 時間のフォーマット
function onairFormatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100); 
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${centiseconds.toString().padStart(2, '0')}`;
}

// 型の変換: 時間文字列を秒数に変換
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

// グローバル変数
let onairCurrentState = null;
let onairNowOnAir = false;
let onairIsPlaying = false;
let onairRepeatFlag = false;
let onairRemainingTimer = null;
let globalEndedListener;
let isFillKeyMode = false;
let ftbMainTimeout = null;
let ftbOffAirTimeout = null;
let onairMasterVolume = 100;
let fadeOutInProgress = false;
let fadeInInProgress = false;
let isOffAirProcessing = false;

// -----------------------
// 初期化
// -----------------------

// 初回読み込み時の初期化実行
document.addEventListener('DOMContentLoaded', () => {
    onairInitialize();
    if (window.dskModule && typeof window.dskModule.initDSKOverlay === 'function') {
        window.dskModule.initDSKOverlay();
    }
});

// UI要素の取得と定義
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

// ビデオ要素の初期化
function onairInitializeVideo(elements) {
    const { onairVideoElement } = elements;
    if (!onairVideoElement) return;

    onairVideoElement.pause();
    onairVideoElement.currentTime = 0;
    if (onairVideoElement.srcObject) {
        onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        onairVideoElement.srcObject = null;
    }
    onairVideoElement.src = '';
}

// UVCのストリーム停止
async function onairStopUVCStream(elements) {
    const { onairVideoElement } = elements;
    if (!onairVideoElement) return;

    if (onairVideoElement.srcObject) {
        onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        onairVideoElement.srcObject = null;
    }
}

// ボタン状態の初期化
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
    }
}

// 音量メーターの初期化
function onairInitializeVolumeMeter(elements) {
    const { onairVolumeBarL, onairVolumeBarR } = elements;
    if (!onairVolumeBarL || !onairVolumeBarR) return;

    // 音量メーターのセットアップ処理
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

// 音量スライダーの初期化
function onairInitializeVolumeSlider(elements, forcedDefaultVolume) {
    const { onairItemVolumeSlider, onairItemVolumeValueDisplay, onairMasterVolumeSlider, onairMasterVolumeValueDisplay } = elements;
    if (!onairItemVolumeSlider || !onairItemVolumeValueDisplay || !onairMasterVolumeSlider || !onairMasterVolumeValueDisplay) return;

    // forcedDefaultVolumeが指定されていればそれを、なければonairCurrentStateの既定値または100を使用（アイテム側）
    // ※スタートモードがFADEINの場合、実際の出力はフェード中となるため、初期表示は0
    let defaultItemVolume = forcedDefaultVolume !== undefined ? forcedDefaultVolume : (onairCurrentState?.defaultVolume ?? 100);
    if (onairCurrentState && onairCurrentState.startMode === 'FADEIN') {
        defaultItemVolume = 0;
    }
    onairItemVolumeSlider.value = defaultItemVolume;
    onairItemVolumeValueDisplay.textContent = `${defaultItemVolume}%`;
    onairItemVolumeSlider.style.setProperty('--value', `${defaultItemVolume}%`);

    // マスターフェーダーはグローバル変数 onairMasterVolume の値を使用
    onairMasterVolumeSlider.value = onairMasterVolume;
    onairMasterVolumeValueDisplay.textContent = `${onairMasterVolume}%`;
    onairMasterVolumeSlider.style.setProperty('--value', `${onairMasterVolume}%`);

    // 最終出力音量の算出： (item / 100) * (master / 100)
    const finalVolume = (defaultItemVolume / 100) * (onairMasterVolume / 100);
    window.electronAPI.sendControlToFullscreen({
        command: 'set-volume',
        value: Math.pow(finalVolume, 2.2)
    });

    logDebug(`[onair.js] Item volume slider initialized to ${defaultItemVolume}% and Master volume slider initialized to ${onairMasterVolume}%`);
}


// シークバーの初期化
function onairInitializeSeekBar(elements) {
    const { onairProgressSlider, onairStartTimeDisplay, onairEndTimeDisplay, onairVideoElement } = elements;

    if (!onairProgressSlider || !onairStartTimeDisplay || !onairEndTimeDisplay || !onairVideoElement) return;

    // 初期値の設定
    onairProgressSlider.value = 0;
    onairProgressSlider.max = 0;
    onairProgressSlider.step = "0.01";
    onairStartTimeDisplay.textContent = '00:00:00:00';
    onairEndTimeDisplay.textContent = '00:00:00:00';

    // 動画のメタデータ読み込み後に最大値を更新
    onairVideoElement.addEventListener('loadedmetadata', () => {
        // UVCデバイスの場合は処理をスキップ
        if (onairCurrentState?.endMode === "UVC") {
            logDebug('[onair.js] loadedmetadata event ignored for UVC device.');
            return;
        }

        const duration = onairVideoElement.duration || 0;
        onairProgressSlider.max = duration.toFixed(2);
        onairEndTimeDisplay.textContent = onairFormatTime(duration);
    });

    // IN点OUT点マーカーの表示を消す
    const inMarker = document.getElementById('on-air-in-marker');
    const outMarker = document.getElementById('on-air-out-marker');

    if (inMarker) inMarker.style.display = "none";
    if (outMarker) outMarker.style.display = "none";


    logDebug('[onair.js] Seek bar initialized.');
}

// 各種状態表示の初期化
function onairInitializeStatusDisplays(elements) {
    const { onairFileNameDisplay, onairInPointDisplay, onairOutPointDisplay, onairRemainTimeDisplay, onairEndModeDisplay } = elements;

    if (onairFileNameDisplay) onairFileNameDisplay.textContent = 'No file loaded';
    if (onairInPointDisplay) onairInPointDisplay.textContent = '00:00:00:00';
    if (onairOutPointDisplay) onairOutPointDisplay.textContent = '00:00:00:00';
    if (onairRemainTimeDisplay) onairRemainTimeDisplay.textContent = '00:00:00:00';
    if (onairEndModeDisplay) onairEndModeDisplay.textContent = 'End Mode';
}

// フェードキャンバスの初期化
function onairInitializeFadeCanvas(elements) {
    const { onairFadeCanvas, onairVideoElement } = elements;

    if (!onairFadeCanvas || !onairVideoElement) return;

    // キャンバスのサイズをビデオに合わせる
    adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas);

    // キャンバスの初期状態を設定
    onairFadeCanvas.style.opacity = 0;
    onairFadeCanvas.style.visibility = 'hidden';

    // リサイズイベントでキャンバスサイズを更新
    window.addEventListener('resize', () => adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas));

    logDebug('[onair.js] Fade canvas initialized.');
}

// キャンバスサイズ調整
function adjustFadeCanvasSize(videoElement, fadeCanvas) {
    if (!videoElement || !fadeCanvas) return;

    const rect = videoElement.getBoundingClientRect();
    fadeCanvas.style.width = `${rect.width}px`;
    fadeCanvas.style.height = `${rect.height}px`;
    fadeCanvas.style.left = `${rect.left}px`;
    fadeCanvas.style.top = `${rect.top}px`;

    logDebug('[onair.js] Fade canvas size adjusted.');
}

// リソースの解放
function onairReleaseResources(elements) {
    onairInitializeVideo(elements);
    onairStopUVCStream(elements);
}

// 初期化の実行
let onairInitialized = false;

function onairInitialize() {
    if (onairInitialized) {
        logDebug('[onair.js] onairInitialize called again, but it is already initialized. Skipping.');
        return;
    }

    // 初期化フラグ管理
    onairInitialized = true;

    const elements = onairGetElements();
    onairReset(elements);

    // ボタンハンドラ設定
    onairSetupButtonHandlers();

    // 音量スライダーの設定
    onairInitializeVolumeSlider(elements);

    // シークバーのハンドラ設定
    onairSetupSeekBarHandlers(elements);

    // タイマーのハンドラ設定
    onairResetRemainingTimer(elements);

    // 音量スライダーのハンドラ設定
    onairSetupVolumeSliderHandler(elements);

    // 再生速度コントローラーの初期化
    setupPlaybackSpeedController();

    // モーダル状態の変更を監視するリスナー登録
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
        lastLoggedOnAirModalState = isOnAirModalActive; // 追加: ベースライン
        logDebug(`[onair.js] OnAir Initial modal state: ${isOnAirModalActive}`);
    });

    // FILLKEYモードの状態を反映
    updateFillKeyModeState();

    logDebug('[onair.js] On-Air area Initialization complete.');
}

// -----------------------------------------------
// オンエア情報の(またはオフエア情報）受け取り
// -----------------------------------------------

// プレイリストからのオンエア開始情報受信リスナー
window.electronAPI.onReceiveOnAirData((itemId) => {
    logDebug(`[onair.js] Received On-Air data for item ID: ${itemId}`);
    // オンエア開始時は Off-Air 状態を解除する
    isOffAir = false;
    // 0 もし受信した itemId が空の場合（＝次の動画が存在しない場合）は Off-Air 処理を実行する
    if (!itemId) {
        logDebug('[onair.js] Received empty On-Air data (no next item). Triggering Off-Air.');
        onairHandleOffAirButton();
        return;
    }
    // 1 リセット処理
    if (onairNowOnAir) {
        logDebug('[onair.js] An item is currently on-air. Resetting before loading the new one.');
        onairReset();
    }

    // 2 状態情報の取得と定義
    const itemData = onairGetStateData(itemId);
    if (!itemData) {
        logDebug(`[onair.js] No valid state data found for item ID: ${itemId}`);
        return;
    }

    // nowonairフラグ管理
    onairNowOnAir = true;

    // 3 フルスクリーンに情報送信
    onairSendToFullscreen(itemData);

    // 4 受け取った情報でUI更新
    onairUpdateUI(itemData);

    // 5 ビデオプレーヤーにセット
    onairSetupPlayer(itemData);

    // UVCデバイスの場合は再生プロセスをスキップ
    if (itemData.endMode === "UVC") {
        logDebug('[onair.js] UVC device detected. Skipping standard playback process.');
        return;
    }

    // 6 再生プロセスの呼び出し
    onairStartPlayback(itemData);
});


// Off-Air通知を受信したら onairHandleOffAirButton を実行する
window.electronAPI.onReceiveOffAirNotify(() => {
    logDebug('[onair.js] Received an off-air notification. Starting off-air processing.');
    onairHandleOffAirButton();
});


// ----------------------------------
// 1 オンエアエリアのリセット
// ----------------------------------
function onairReset() {
    const elements = onairGetElements();

    // 前アイテムの状態をクリアして、新しい状態に影響しないようにする
    onairCurrentState = null;

    // ビデオ初期化
    onairInitializeVideo(elements);
    onairStopUVCStream(elements);

    // UI要素の初期化
    onairInitializeButtons(elements);
    onairInitializeVolumeMeter(elements);
    onairInitializeSeekBar(elements);
    onairInitializeStatusDisplays(elements);
    onairInitializeFadeCanvas(elements);

    // 音量スライダーの初期化（アイテムスライダーは新しい動画の規定音量を反映、マスタースライダーはグローバル値を維持）
    onairInitializeVolumeSlider(elements);

    // 状態フラグをリセット
    onairNowOnAir = false;
    onairIsPlaying = false;

    // 再生速度コントローラーの同期処理（オンエア動画とフルスクリーンの再生速度をモードに応じて設定）
    const speedSlider = document.getElementById('playback-speed-slider');
    const speedInput = document.getElementById('playback-speed-input');
    const video = document.getElementById('on-air-video');

    // グローバル変数のリセット（共通処理）
    isPlaybackSpeedDragging = false;
    if (playbackSpeedAnimationFrame) {
        cancelAnimationFrame(playbackSpeedAnimationFrame);
        playbackSpeedAnimationFrame = null;
    }

    if (isPlaybackSpeedFixed) {
        // 【固定モードの場合】
        // 数値入力で変更された場合は、両側とも1.00にリセットする
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
        // 【スライダー操作の場合】
        // 現在のスライダー値を保持し、その値から算出した再生速度を両側に反映する
        if (speedSlider) {
            speedSlider.disabled = false;
            const s = parseFloat(speedSlider.value) || 0;
            const newRate = Math.pow(16, s / 16);
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

    // フェード処理を中断
    stopFade();

    // FTB用タイマーのキャンセル
    if (ftbMainTimeout) {
        clearTimeout(ftbMainTimeout);
        ftbMainTimeout = null;
    }
    if (ftbOffAirTimeout) {
        clearTimeout(ftbOffAirTimeout);
        ftbOffAirTimeout = null;
    }

    // 残り時間タイマーのリセット（タイマー表示を初期状態（オレンジ）に戻す）
    onairResetRemainingTimer(elements);

    // リソースの解放
    onairReleaseResources(elements);

    logDebug('[onair.js] On-Air area reset completed.');
}

// ----------------------------------
// 2 アイテム情報と状態情報の取得・定義
// ----------------------------------

// 状態情報の取得と定義
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

    // データ型の調整と最新状態に格納
    onairCurrentState = {
        itemId: itemId,
        path: itemData.path || '',
        name: itemData.name || (itemData.path ? itemData.path.split('/').pop() : 'Unknown'),
        deviceId: itemData.deviceId || null,
        inPoint: onairParseTimeToSeconds(itemData.inPoint || '00:00:00:00'),
        outPoint: onairParseTimeToSeconds(itemData.outPoint || '00:00:00:00'),
        startMode: itemData.startMode || 'PAUSE',
        endMode: itemData.endMode || 'PAUSE',
        defaultVolume: itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100,
        ftbRate: parseFloat(itemData.ftbRate || 1.0),
        fillKeyMode: typeof itemData.fillKeyMode !== 'undefined' ? itemData.fillKeyMode : false, // FILLKEYモード状態
    };

    logDebug('[onair.js] State data updated:', onairCurrentState);
    return onairCurrentState;
}

// -----------------------
// 3 フルスクリーンにデータ送信
// -----------------------
async function onairSendToFullscreen(itemData) {
    if (!itemData) {
        logDebug('[onair.js] No item data available to send to fullscreen.');
        return;
    }
    try {
        // 新規アイテムの場合は、受信した itemData の規定音量を使用する
        const itemVal = itemData.defaultVolume !== undefined ? itemData.defaultVolume : 100;
        const masterVal = (onairMasterVolume !== undefined && onairMasterVolume !== null) ? onairMasterVolume : 100;
        const combinedVolume = (itemVal / 100) * (masterVal / 100);
        const finalVolume = Math.pow(combinedVolume, 2.2);

        const fullscreenData = {
            playlistItem_id: itemData.playlistItem_id,
            deviceId: itemData.deviceId || null,
            path: itemData.path || '',
            startMode: itemData.startMode || 'PAUSE',
            endMode: itemData.endMode || 'PAUSE',
            volume: finalVolume,
            inPoint: itemData.inPoint,
            outPoint: itemData.outPoint,
            ftbRate: itemData.ftbRate,
            fillKeyMode: itemData.fillKeyMode
        };

        logDebug('[onair.js] Sending video data to fullscreen:', fullscreenData);
        window.electronAPI.sendToFullscreenViaMain(fullscreenData);
    } catch (error) {
        logDebug('[onair.js] Error while sending video data to fullscreen:', error);
    }
}

// -----------------------
// 5 動画プレーヤーのセットアップ
// -----------------------
function onairSetupPlayer(itemData) {
    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found in On-Air area.');
        return;
    }

	// プレビュー用動画にマウスホイール／キー操作をバインド
    setupMouseWheelControl(onairVideoElement);
    
    // FILLKEYモード状態を反映する
    updateFillKeyModeState();

    // UVCデバイスの判定を `endMode: "UVC"` に設定
    if (itemData.endMode === "UVC" && itemData.deviceId) {
        logInfo(`[onair.js] Setting up UVC stream for device ID: ${itemData.deviceId}`);
        onairSetupUVCStream(onairVideoElement, itemData.deviceId)
            .then(() => {
                // UVC再生開始後に0.3秒でフェードイン実施
                onairFadeFromBlack(0.3);
            })
            .catch(error => {
                logInfo(`[onair.js] UVC stream setup failed: ${error.message}`);
            });
        return;
    }

    // 動画ファイルの処理
    if (itemData.path) {
        logInfo(`[onair.js] Setting up video file: ${itemData.path}`);
        onairSetupVideoFile(onairVideoElement, itemData.path);
        return;
    }

    // データが不正な場合
    logInfo('[onair.js] Invalid On-Air item data: Missing path or deviceId.');
}

// 動画ファイルのセットアップ
function onairSetupVideoFile(onairVideoElement, path) {
    onairVideoElement.pause();
    // UVC デバイスでない場合、必ず安全なURLに変換する
    if (typeof path === 'string' && !path.startsWith("UVC_DEVICE")) {
        onairVideoElement.src = getSafeFileURL(path);
    } else {
        onairVideoElement.src = path;
    }
    // loadedmetadata イベントで、動画が読み込まれたら即座にIN点へシークする
    onairVideoElement.addEventListener('loadedmetadata', function onMetadata() {
        // onairCurrentState が有効で、IN点が設定されている場合はその値にシーク
        if (onairCurrentState && onairCurrentState.inPoint > 0) {
            onairVideoElement.currentTime = onairCurrentState.inPoint;
            logDebug(`[onair.js] Video metadata loaded. Seeking immediately to IN point: ${onairCurrentState.inPoint}s`);
        }
        onairVideoElement.removeEventListener('loadedmetadata', onMetadata);
    });

    onairVideoElement.load();
    logDebug(`[onair.js] Video file set: ${path}`);
}

// UVCデバイスのセットアップ
async function onairSetupUVCStream(onairVideoElement, deviceId) {
    try {
        const elements = onairGetElements();

        // 既存のストリームを停止
        if (onairVideoElement.srcObject) {
            onairVideoElement.srcObject.getTracks().forEach(track => track.stop());
        }

        // まずは基本的なストリームを取得して、カメラの能力を確認する
        const tempStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });
        const capabilities = tempStream.getVideoTracks()[0].getCapabilities();
        const widthIdeal = (capabilities.width && capabilities.width.max) ? capabilities.width.max : 1280;
        const heightIdeal = (capabilities.height && capabilities.height.max) ? capabilities.height.max : 720;
        // 不要になった一時ストリームは停止
        tempStream.getTracks().forEach(track => track.stop());

        // 再度、カメラのネイティブ解像度を理想値として指定してストリームを取得する
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                width: { ideal: widthIdeal },
                height: { ideal: heightIdeal },
                frameRate: { ideal: 30 }
            },
            audio: false
        });

        // ストリームをセットし再生を開始
        onairVideoElement.srcObject = stream;
        onairVideoElement.autoplay = true;
        onairVideoElement.playsInline = true;
        await onairVideoElement.play();

        // カメラの実際の設定を取得してログ出力
        const settings = stream.getVideoTracks()[0].getSettings();
        logDebug(`[onair.js] UVC stream set for device ID: ${deviceId} with native resolution ${settings.width}x${settings.height}, frameRate: ${settings.frameRate}`);

        // 再生ボタンの見た目をオレンジに更新
        const { onairPlayButton, onairPauseButton } = elements;
        if (onairPlayButton && onairPauseButton) {
            onairPlayButton.classList.add('important-button-orange');
            onairPlayButton.classList.remove('important-button-gray');
            onairPauseButton.classList.add('important-button-gray');
            onairPauseButton.classList.remove('important-button-blue');
        }

        // 残り時間タイマーを開始
        onairStartRemainingTimer(elements, onairCurrentState);

        logDebug(`[onair.js] UVC stream successfully set for device ID: ${deviceId}`);
    } catch (error) {
        logInfo(`[onair.js] Failed to start UVC stream for device ID: ${deviceId}: ${error.message}`);
        showMessage(`${getMessage('failed-to-start-uvc-stream')} ${error.message}`, 5000, 'error');

        // ストリーム失敗時にUIをリセット
        onairReset();
    }
}

// -----------------------
// 4 UI更新
// -----------------------

// UIを更新する関数
function onairUpdateUI(itemData) {
    const elements = onairGetElements();

    // 再生ボタンの状態更新
    if (itemData.endMode !== "UVC") {
        // UVCデバイス以外の場合のみボタン状態を更新
        onairUpdatePlayPauseButtons(elements);
    } else {
        logDebug('[onair.js] Skipping play/pause button update for UVC device.');
    }

    // シークバーの更新
    onairUpdateSeekBar(elements, itemData);

    // ファイル名表示の更新
    if (elements.onairFileNameDisplay) {
        elements.onairFileNameDisplay.textContent = itemData.name || 'No file loaded';
    }

    // エンドモード表示の更新
    if (elements.onairEndModeDisplay) {
        elements.onairEndModeDisplay.textContent = itemData.endMode
            ? `ENDMODE: ${itemData.endMode.toUpperCase()}`
            : 'ENDMODE';
    }

    // 音量スライダーと音量表示の更新（アイテムスライダーのみ更新。マスターフェーダーはグローバル状態を維持）
    if (elements.onairItemVolumeSlider && elements.onairItemVolumeValueDisplay) {
        elements.onairItemVolumeSlider.value = itemData.defaultVolume;
        elements.onairItemVolumeValueDisplay.textContent = `${itemData.defaultVolume}%`;
        elements.onairItemVolumeSlider.style.setProperty('--value', `${elements.onairItemVolumeSlider.value}%`);
    }

    // イン点・アウト点表示の更新
    if (elements.onairInPointDisplay) {
        elements.onairInPointDisplay.textContent = onairFormatTime(itemData.inPoint);
    }
    if (elements.onairOutPointDisplay) {
        elements.onairOutPointDisplay.textContent = onairFormatTime(itemData.outPoint);
    }

    // 残り時間タイマーの更新
    onairUpdateRemainingTime(elements, itemData);

    logDebug('[onair.js] UI updated with the latest item data.');
}

// 残り時間タイマーの更新
function onairUpdateRemainingTime(elements, itemData) {
    const { onairVideoElement, onairRemainTimeDisplay } = elements;

    if (!onairVideoElement || !onairRemainTimeDisplay) return;

    // UVCの場合は "LIVE" と表示して終了
    if (itemData.endMode === "UVC") {
        onairRemainTimeDisplay.textContent = 'LIVE';
        onairRemainTimeDisplay.style.color = 'green';
        return;
    }

    // 実時間ベースの残り時間を計算（再生速度を考慮）
    const rawRemaining = Math.max(0, itemData.outPoint - onairVideoElement.currentTime);
    const rate = onairVideoElement.playbackRate || 1;
    const remainingTime = rawRemaining / rate;

    onairRemainTimeDisplay.textContent = onairFormatTime(remainingTime);

    // 残り時間が少ない場合、色を赤にする
    if (remainingTime < 5) {
        onairRemainTimeDisplay.style.color = 'red';
    } else {
        onairRemainTimeDisplay.style.color = 'orange';
    }
}
// 再生・一時停止ボタンの更新
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

// シークバーの更新
function onairUpdateSeekBar(elements, itemData) {
    const { onairVideoElement, onairProgressSlider, onairStartTimeDisplay, onairEndTimeDisplay } = elements;
    if (!onairVideoElement || !onairProgressSlider || !onairStartTimeDisplay || !onairEndTimeDisplay) return;

    const inMarker = document.getElementById('on-air-in-marker');
    const outMarker = document.getElementById('on-air-out-marker');

    // 動画ファイルのパスが未設定（空文字）または src が空の場合は、マーカーを非表示にして終了
    if (!itemData.path || itemData.path.trim() === "" || !onairVideoElement.src || onairVideoElement.src.trim() === "") {
        if (inMarker) inMarker.style.display = "none";
        if (outMarker) outMarker.style.display = "none";
        return;
    }

    // UVCデバイスの場合は処理を行わない
    if (itemData.endMode === "UVC") {
        logDebug('[onair.js] Seek bar update for UVC device.');
        onairProgressSlider.value = 0;
        onairProgressSlider.disabled = true;
        onairStartTimeDisplay.textContent = 'LIVE';
        onairEndTimeDisplay.textContent = 'UVC';
        return;
    }

    onairProgressSlider.disabled = false;

    // 動画のメタデータがまだ読み込まれていない場合は、マーカーを非表示して終了
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

    // 正常に動画がロードされている場合、マーカーを表示
    if (inMarker) inMarker.style.display = "block";
    if (outMarker) outMarker.style.display = "block";

    const currentTime = onairVideoElement.currentTime || 0;
    onairProgressSlider.value = currentTime;
    onairProgressSlider.max = duration.toFixed(2);
    onairStartTimeDisplay.textContent = onairFormatTime(currentTime);
    onairEndTimeDisplay.textContent = onairFormatTime(duration);

    // マーカーの位置を更新
    updateSeekBarMarkers(elements, onairCurrentState.inPoint, onairCurrentState.outPoint);
}

// シークバー上にIN/OUTマーカーの位置を更新する関数
function updateSeekBarMarkers(elements, inPoint, outPoint) {
    const slider = elements.onairProgressSlider;
    if (!slider) return;
    const duration = parseFloat(slider.max);
    if (!duration || duration <= 0) return;

    // スライダー要素の位置と幅を取得
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

// 音量スライダーと音量表示の更新
function onairUpdateVolume(elements, volume) {
    const { onairVolumeSlider, onairVolumeValueDisplay } = elements;

    if (!onairVolumeSlider || !onairVolumeValueDisplay) return;

    onairVolumeSlider.value = volume;
    onairVolumeValueDisplay.textContent = `${volume}%`;
}

// -----------------------
// 6 再生プロセス
// -----------------------
function onairStartPlayback(itemData) {
    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (!onairVideoElement) {
        logInfo('[onair.js] Video element not found.');
        return;
    }

    // 既存の監視を停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
        onairPlaybackMonitor = null;
        logDebug('[onair.js] Existing playback monitor cleared.');
    }

    // 再生状態の定義
    onairIsPlaying = false;

    // 動画とUVCの処理振り分け
    if (itemData.deviceId) {
        // UVCの場合
        logInfo('[onair.js] Starting UVC stream.');
        onairSetupUVCStream(onairVideoElement, itemData.deviceId);
        return;
    }

    if (itemData.path) {
        logInfo('[onair.js] Starting video playback.');
        onairSetupVideoFile(onairVideoElement, itemData.path);
        // 再生速度コントローラーの値を再適用
        const currentSpeed = parseFloat(document.getElementById('playback-speed-input').value) || 1.00;
        onairVideoElement.playbackRate = currentSpeed;
        logDebug(`[onair.js] Applied playback speed: ${currentSpeed}`);
        // フルスクリーン側にも再生速度を送信する
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: currentSpeed
        });
    }

    // IN点とOUT点の取得
    const inPoint = itemData.inPoint || 0;
    const outPoint = itemData.outPoint || onairVideoElement.duration;

    // IN点にシーク
    onairSeekToInPoint(onairVideoElement, inPoint);

    // 音量をデフォルトボリュームにセット
    onairVideoElement.volume = itemData.defaultVolume / 100;

    // スタートモードに応じた処理分岐
    if (itemData.startMode === 'PLAY' || onairRepeatFlag) {
        onairIsPlaying = true; 
        onairVideoElement.play()
            .then(() => {
                onairRepeatFlag = false;
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData);
                logOpe('[onair.js] Playback started via PLAY start mode.');
                window.electronAPI.sendControlToFullscreen({ command: 'play' });
            })
            .catch(error => {
                onairIsPlaying = false;
                logInfo(`[onair.js] Playback failed: ${error.message}`);
                onairUpdatePlayPauseButtons(elements);
            });
    } else if (itemData.startMode === 'FADEIN') {
        onairVideoElement.volume = 0;
        // アイテムボリュームのスライダーをリセット
        const itemSlider = document.getElementById('on-air-item-volume-slider');
        if (itemSlider) {
            itemSlider.value = 0;
            document.getElementById('on-air-item-volume-value').textContent = '0%';
            itemSlider.style.setProperty('--value', `0%`);
        }
        // 映像面：フェードイン開始
        const ftbRate = itemData.ftbRate || 1.0;
        onairFadeFromBlack(ftbRate);
        
        onairIsPlaying = true;
        onairVideoElement.play()
            .then(() => {
                // 音声フェードイン処理
                audioFadeInItem(ftbRate);
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData);
                logOpe('[onair.js] Playback started via FADEIN start mode with fade in effect.');
                window.electronAPI.sendControlToFullscreen({
                    command: 'fadein',
                    ftbRate: ftbRate,
                    currentTime: onairVideoElement.currentTime
                });
            })
            .catch(error => {
                onairIsPlaying = false;
                logInfo(`[onair.js] Playback failed: ${error.message}`);
                onairUpdatePlayPauseButtons(elements);
            });
    } else {
        onairVideoElement.pause();
        onairIsPlaying = false;
        onairUpdatePlayPauseButtons(elements);
        onairStopRemainingTimer();
        logOpe('[onair.js] Playback paused via start mode.');
    }

    // 最後に再生監視を開始
    onairMonitorPlayback(onairVideoElement, outPoint);
}

// 再生開始時にIN点にシーク
function onairSeekToInPoint(onairVideoElement, inPoint) {
    if (!onairVideoElement) return;
    onairVideoElement.currentTime = inPoint;
    logDebug(`[onair.js] Seeked to IN point: ${inPoint}s`);
}

// OUT点到達の監視
function onairMonitorPlayback(onairVideoElement, outPoint) {
    if (!onairVideoElement) return;

    if (onairCurrentState?.endMode === "UVC") {
        logDebug('[onair.js] UVC device detected. Skipping playback monitoring.');
        return;
    }

    // 許容誤差（秒）を再生速度に応じて調整
    const tolerance = 0.05 * onairVideoElement.playbackRate;

    // 残り時間タイマーの終了をトリガーにエンドモードを発火
    function handleRemainingTimeTimerComplete() {
        const currentTime = onairVideoElement.currentTime;
        logInfo(`[onair.js] Remaining time timer reached OUT point. currentTime=${currentTime.toFixed(2)}s, outPoint=${outPoint}`);

        const currentEndMode = onairCurrentState?.endMode || "PAUSE";
        logInfo(`[onair.js] Triggering End Mode: ${currentEndMode}`);
        onairHandleEndMode(currentEndMode);
    }

    // 既存の監視を停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
    }

    // 再生監視の設定
    onairPlaybackMonitor = setInterval(() => {
        if (!onairIsPlaying) {
            clearInterval(onairPlaybackMonitor);
            return;
        }

        const remainingTime = outPoint - onairVideoElement.currentTime;

        // 残り時間が許容誤差以下ならエンドモードを発火
        if (remainingTime <= tolerance) {
            clearInterval(onairPlaybackMonitor);
            handleRemainingTimeTimerComplete();
        }

        // 残り時間タイマーの更新
        onairUpdateRemainingTime(onairGetElements(), {
            outPoint,
            currentTime: onairVideoElement.currentTime,
        });
    }, 30); // 更新間隔を短縮して精度を向上

    logDebug(`[onair.js] Playback monitoring started with OUT point (tolerance=${tolerance}s).`);
}

// 動画終了時の処理（OUT点を通過してしまった場合のみのフォールバック）
function handleGlobalEndedEvent(videoElement) {
    const currentEndMode = onairCurrentState?.endMode || "PAUSE";
    logInfo(`[onair.js] Global ended event fired. Triggering end mode. Current endMode=${currentEndMode}`);

    // エンドモードを発火
    onairHandleEndMode(currentEndMode);

    // 不要ならリスナーを削除
    if (videoElement && globalEndedListener) {
        videoElement.removeEventListener('ended', globalEndedListener);
        globalEndedListener = null;
    }
}

// -----------------------
// エンドモード
// -----------------------

// エンドモード処理の呼び出し
function onairHandleEndMode() {
    const endMode = onairCurrentState?.endMode || 'PAUSE';
    logDebug(`[onair.js] Calling handleEndMode with endMode: ${endMode}`);
    
    // フルスクリーンにエンドモード通知
    const currentTime = onairGetElements().onairVideoElement?.currentTime || 0;
    window.electronAPI.sendControlToFullscreen({
        command: 'trigger-endMode',
        value: endMode,
        currentTime: currentTime,
    });
    logDebug(`[onair.js] EndMode command sent to fullscreen: { endMode: ${endMode}, currentTime: ${currentTime} }`);
    
    onairExecuteEndMode(endMode);
}

// エンドモードの振り分け
function onairExecuteEndMode(endMode) {
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
        case 'FTB':
            onairHandleEndModeFTB();
            break;
        case 'NEXT':
            onairHandleEndModeNext();
            break;
        default:
            logInfo(`[onair.js] Unknown End Mode: ${endMode}`);
    }
}

// エンドモードOFF
function onairHandleEndModeOff() {
    logInfo('[onair.js] End Mode: OFF - Triggering Off-Air button click.');

    const elements = onairGetElements();
    const { onairOffAirButton } = elements;

    if (onairOffAirButton) {
        onairOffAirButton.click();
        logInfo('[onair.js] Off-Air button click triggered.');
    } else {
        logInfo('[onair.js] Off-Air button not found. Resetting manually.');
        onairReset();
    }
}

// エンドモードPAUSE
function onairHandleEndModePause() {
    logInfo('[onair.js] End Mode: PAUSE - Pausing at the last frame.');

    const elements = onairGetElements();
    const { onairVideoElement } = elements;

    if (onairVideoElement) {
        onairVideoElement.pause();
        onairVideoElement.currentTime = onairCurrentState.outPoint || onairVideoElement.duration;
    }

    onairIsPlaying = false;
    onairUpdatePlayPauseButtons(elements);

    // フルスクリーンエリアにも停止を通知
    window.electronAPI.sendControlToFullscreen({
        command: 'pause',
        value: onairVideoElement.currentTime,
    });

    logDebug('[onair.js] End Mode PAUSE: Play/Pause buttons updated.');
}

// エンドモードREPEAT
function onairHandleEndModeRepeat() {
    logInfo('[onair.js] End Mode: REPEAT - Restarting playback.');

    onairRepeatFlag = true;
    onairStartPlayback(onairCurrentState);
}

// エンドモードFTB
function onairHandleEndModeFTB() {
    logInfo('[onair.js] End Mode: FTB - Performing fade to black.');

    const elements = onairGetElements();
    const { onairVideoElement, onairFadeCanvas, onairOffAirButton } = elements;

    if (!onairVideoElement || !onairFadeCanvas) {
        logInfo('[onair.js] Video element or fade canvas not found. FTB skipped.');
        // FTBボタンの点滅も停止
        stopFadeButtonBlink(document.getElementById('ftb-off-button'));
        return;
    }

    const ftbRate = onairCurrentState.ftbRate || 1.0;

    // キャンバスサイズを調整
    adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas);

    // オーバーレイキャンバスの初期化
    function initializeOverlayCanvasOnAir() {
        const canvas = document.getElementById('fade-canvas');
        if (!canvas) {
            logInfo('[onair.js] fade-canvas element not found.');
            return null;
        }
        // canvas のサイズは adjustFadeCanvasSize で設定するのでそのまま返却
        return canvas;
    }

    // 画面のフェードアウト処理
    onairFadeToBlack(onairFadeCanvas, ftbRate);

    // 音声のフェードアウト処理
    audioFadeOutItem(ftbRate);

    // フェードアウト完了後に一時停止
    ftbMainTimeout = setTimeout(() => {
        onairVideoElement.pause();
        onairIsPlaying = false;
        onairUpdatePlayPauseButtons(elements);
        logInfo('[onair.js] FTB complete - Paused at the last frame.');

        // 0.5秒後にオフエアボタンをクリックし、FTBボタンの点滅を停止
        ftbOffAirTimeout = setTimeout(() => {
            if (onairOffAirButton) {
                logInfo('[onair.js] Clicking Off-Air button automatically after FTB.');
                onairOffAirButton.click(); // ボタンクリックをトリガー
            } else {
                logInfo('[onair.js] Off-Air button not found. Automatic click skipped.');
            }
            stopFadeButtonBlink(document.getElementById('ftb-off-button'));
        }, 500);
    }, (ftbRate + 0.5) * 1000);

    onairIsPlaying = false;
}

// キャンバスサイズ調整
function adjustFadeCanvasSize(videoElement, fadeCanvas) {
    const extraMargin = 1;
    fadeCanvas.width = videoElement.clientWidth + extraMargin;
    fadeCanvas.height = videoElement.clientHeight + extraMargin;
    fadeCanvas.style.left = `${videoElement.offsetLeft}px`;
    fadeCanvas.style.top = `${videoElement.offsetTop}px`;
}

// フェードアウト処理
function onairFadeToBlack(fadeCanvas, duration) {
    // FILL-KEY モードの場合はカラーピッカーで選択された色、そうでなければ黒に設定
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

    try {
        const elements      = onairGetElements();
        const videoElement  = elements.onairVideoElement;
        const overlayCanvas = initializeOverlayCanvasOnAir();
        if (videoElement && overlayCanvas) {
            // １）サイズ／位置合わせ
            adjustFadeCanvasSize(videoElement, overlayCanvas);

            // ２）キャンバス解像度を CSS サイズに同期
            overlayCanvas.width  = overlayCanvas.clientWidth;
            overlayCanvas.height = overlayCanvas.clientHeight;

            // ３）黒背景を塗る
            overlayCanvas.style.backgroundColor = 'black';

            // ４）最終フレームを描画
            const ctx = overlayCanvas.getContext('2d');
            ctx.drawImage(videoElement, 0, 0, overlayCanvas.width, overlayCanvas.height);

            // ５）オーバーレイを表示
            overlayCanvas.style.visibility = 'visible';
            overlayCanvas.style.opacity    = 1;

            // ６）次動画の最初のフレーム準備完了(canplay)で非表示＆クリア
            videoElement.addEventListener('canplay', function hideOverlay() {
                overlayCanvas.style.visibility = 'hidden';
                overlayCanvas.style.opacity    = 0;
                ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                videoElement.removeEventListener('canplay', hideOverlay);
            });
        }
    } catch (e) {
        logInfo('[onair.js] Overlay processing failed:', e);
    }

    const currentItemId = onairCurrentState?.itemId;
    if (!currentItemId) {
        onairHandleEndModeOff();
        return;
    }
    // 次のアイテムをリクエスト
    window.electronAPI.notifyNextModeComplete(currentItemId);
    onairCurrentState = null;
    onairNowOnAir    = false;
    onairIsPlaying   = false;

    logInfo('[onair.js] NEXT mode processing completed.');
}


// -------------------------------
// 再生、一時停止、オフエアボタン
// -------------------------------

// 再生ボタンの処理
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

    // 短尺ファイルの場合、動画の総尺が3秒未満なら動画要素をリセットして再初期化する
    if ((onairCurrentState.outPoint < 3) &&
        Math.abs(onairVideoElement.currentTime - (onairCurrentState.outPoint || onairVideoElement.duration)) < (0.05 * onairVideoElement.playbackRate)) {
        logDebug('[onair.js] Short file detected: resetting video element.');
        onairVideoElement.load();
        // 再初期化後、IN点にシークする
        onairSeekToInPoint(onairVideoElement, onairCurrentState.inPoint);
        logDebug(`[onair.js] For short file, seeked to IN point: ${onairCurrentState.inPoint}s`);
        // フルスクリーンにもIN点に戻す指示を送信
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: onairCurrentState.inPoint,
        });
        logDebug(`[onair.js] IN point seek command sent to fullscreen: ${onairCurrentState.inPoint}s`);
    }

    else if (Math.abs(onairVideoElement.currentTime - (onairCurrentState.outPoint || onairVideoElement.duration)) < 0.05) {
        // 通常ファイルの場合はそのままIN点にシークする
        onairSeekToInPoint(onairVideoElement, onairCurrentState.inPoint);
        logDebug(`[onair.js] Play button pressed: Current time is at OUT point, seeking to IN point: ${onairCurrentState.inPoint}s`);
        window.electronAPI.sendControlToFullscreen({
            command: 'seek',
            value: onairCurrentState.inPoint,
        });
        logDebug(`[onair.js] IN point seek command sent to fullscreen: ${onairCurrentState.inPoint}s`);
    }

    // 再生を開始
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

// 一時停止ボタンの処理
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

    // 再生を停止
    onairVideoElement.pause();
    onairIsPlaying = false;
    onairUpdatePlayPauseButtons(elements); 
    onairStopRemainingTimer(); 
    logOpe('[onair.js] Playback paused.');

    // Fullscreen.jsに通知
    window.electronAPI.sendControlToFullscreen({ command: 'pause' });
}

// オフエアボタンの処理
function onairHandleOffAirButton() {
    logOpe('[onair.js] OffAir button invoked');
    if (isOffAir || isOffAirProcessing) {
        logDebug('[onair.js] Already in off-air state or processing; skipping new off-air processing.');
        return;
    }
    isOffAirProcessing = true;
    logInfo('[onair.js] Executing off-air processing.');
    onairNowOnAir = false;
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

// イベントリスナーの設定
function onairSetupButtonHandlers() {
    const elements = onairGetElements();
    const { onairPlayButton, onairPauseButton, onairOffAirButton, onairFTBButton } = elements;
    if (onairPlayButton) {
        onairPlayButton.addEventListener('click', onairHandlePlayButton);
    }
    if (onairPauseButton) {
        onairPauseButton.addEventListener('click', onairHandlePauseButton);
    }
    if (onairOffAirButton) {
        onairOffAirButton.addEventListener('click', onairHandleOffAirButton);
    }
    if (onairFTBButton) {
        onairFTBButton.addEventListener('click', onairHandleFTBButton);
    }
    logDebug('[onair.js] Button handlers set up.');
}

// -----------------------
// マウスホイール操作よるコマ送りの処理
// -----------------------
function setupMouseWheelControl(videoElement) {
    // 動画要素をマウスホイールで操作可能にするため tabindex を設定
    videoElement.tabIndex = 0;

    // 動画ロード完了判定
    let isVideoLoaded = false;
    videoElement.addEventListener('loadedmetadata', () => {
        isVideoLoaded = true;
    });

    // ホイール操作によるシーク処理
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
        // フルスクリーン側にもシーク通知
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
    }
}

// シークバーのハンドラ設定
function onairSetupSeekBarHandlers(elements) {
    const { onairProgressSlider, onairVideoElement } = elements;

    if (!onairProgressSlider || !onairVideoElement) return;

    // ユーザーがシークバーを操作したときの処理
    onairProgressSlider.addEventListener('input', (event) => {
        if (!onairCurrentState || onairCurrentState.endMode === "UVC") {
            logDebug('[onair.js] Seek bar operation disabled for UVC device or invalid state.');
            onairProgressSlider.value = 0;
            return;
        }
        onairHandleSeekBarChange(event, elements);
    });

    // ビデオの再生位置が変わったときにシークバーを更新
    onairVideoElement.addEventListener('timeupdate', () => {
        if (!onairCurrentState) return;

        // UVCデバイスの場合、シークバー更新をスキップ
        if (onairCurrentState.endMode === "UVC") return;

        // 通常の動画の場合のみシークバーを更新
        onairUpdateSeekBar(elements, onairCurrentState);
    });

    // シークバーで矢印キーの動作を無効化
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
const PLAYBACK_SPEED_RETURN_DURATION = 500;

function setupPlaybackSpeedController() {
    logOpe('[onair.js] setupPlaybackSpeedController invoked');

    const slider = document.getElementById('playback-speed-slider');
    const inputField = document.getElementById('playback-speed-input');
    const video = document.getElementById('on-air-video');

    if (!slider || !inputField || !video) {
        logInfo('[onair.js] Playback speed controller element not found.');
        return;
    }

    // 初期状態では、onairNowOnAir フラグが false なら操作を無効化（UI上も disabled 属性）
    if (!onairNowOnAir) {
        slider.disabled = true;
        inputField.disabled = true;
    } else {
        slider.disabled = false;
        inputField.disabled = false;
    }

    // 動画のメタデータが読み込まれたタイミングで、onairNowOnAir が true なら操作を有効化
    video.addEventListener('loadedmetadata', () => {
        if (onairNowOnAir) {
            slider.disabled = false;
            inputField.disabled = false;
            logDebug('[onair.js] Speed control enabled after video loaded.');
        }
    });

    // スライダー操作中：更新（固定モードでなければ）
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
        const s = parseFloat(slider.value);
        const newRate = Math.pow(16, s / 16);
        video.playbackRate = newRate;
        inputField.value = newRate.toFixed(2);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: newRate
        });
    });

    // スライダー操作終了時の処理（既存のまま）
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
        const startValue = parseFloat(slider.value);
        const startTime = performance.now();

        function animate() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / PLAYBACK_SPEED_RETURN_DURATION, 1);
            const currentValue = startValue * (1 - progress);
            slider.value = currentValue.toFixed(2);
            const newRate = Math.pow(16, currentValue / 16);
            video.playbackRate = newRate;
            inputField.value = newRate.toFixed(2);
            window.electronAPI.sendControlToFullscreen({
                command: 'set-playback-speed',
                value: newRate
            });
            if (progress < 1) {
                playbackSpeedAnimationFrame = requestAnimationFrame(animate);
            } else {
                playbackSpeedAnimationFrame = null;
            }
        }
        if (playbackSpeedAnimationFrame) {
            cancelAnimationFrame(playbackSpeedAnimationFrame);
        }
        playbackSpeedAnimationFrame = requestAnimationFrame(animate);
    };
    slider.addEventListener('mouseup', releaseHandler);
    slider.addEventListener('touchend', releaseHandler);

    // 入力欄の手動変更時の処理
    inputField.addEventListener('change', () => {
        logOpe(`[onair.js] Playback speed input changed: ${inputField.value}`);
        if (!onairNowOnAir) {
            logDebug('[onair.js] Speed control change ignored: On-Air is not active.');
            return;
        }
        const manualRate = parseFloat(inputField.value);
        if (isNaN(manualRate) || manualRate <= 0) {
            inputField.value = "1.00";
            video.playbackRate = 1.00;
            window.electronAPI.sendControlToFullscreen({
                command: 'set-playback-speed',
                value: 1.00
            });
            return;
        }
        isPlaybackSpeedFixed = true;
        const newS = 16 * Math.log(manualRate) / Math.log(16);
        slider.value = newS.toFixed(2);
        video.playbackRate = manualRate;
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: manualRate
        });
    });

    // スライダーがクリックされた場合、固定モード解除
    slider.addEventListener('mousedown', () => {
        logOpe('[onair.js] Playback speed slider mousedown ? fixed mode disabled');
        isPlaybackSpeedFixed = false;
    });

    logDebug('[onair.js] Playback speed controller initialization complete.');
}

// -----------------------
// 残り時間タイマー
// -----------------------

// 残り時間タイマーの開始
function onairStartRemainingTimer(elements, itemData) {
    const { onairVideoElement } = elements;

    if (!onairVideoElement || !itemData) return;

    // タイマーをリセットして開始
    if (onairRemainingTimer) clearInterval(onairRemainingTimer);

    onairRemainingTimer = setInterval(() => {
        // 再生中のみタイマー更新
        if (onairIsPlaying) {
            onairUpdateRemainingTime(elements, itemData);
        }
    }, 100);

    logDebug('[onair.js] Remaining time timer started.');
}

// 残り時間タイマーの停止
function onairStopRemainingTimer() {
    if (onairRemainingTimer) {
        clearInterval(onairRemainingTimer);
        onairRemainingTimer = null;
        logDebug('[onair.js] Remaining time timer stopped.');
    }
}

// 初期化でタイマーをリセット
function onairResetRemainingTimer(elements) {
    const { onairRemainTimeDisplay } = elements;

    // 表示をリセット
    if (onairRemainTimeDisplay) {
        onairRemainTimeDisplay.textContent = '00:00:00:00';
        onairRemainTimeDisplay.style.color = 'orange';
    }

    // タイマーを停止
    onairStopRemainingTimer();

    logDebug('[onair.js] Remaining time timer reset.');
}

// ------------------------------
// 音量スライダー
// ------------------------------

// 音量スライダーのイベント設定
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
            onairMasterVolumeValueDisplay.textContent = `${masterVal}%`;
            if (masterVal <= 10) {
                onairMasterVolumeValueDisplay.classList.add('neon-warning');
            } else {
                onairMasterVolumeValueDisplay.classList.remove('neon-warning');
            }
        }
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });
        const videoElement = document.getElementById('on-air-video');
        if (videoElement) {
            videoElement.volume = finalVolume;
        }
        logInfo(`[onair.js] Combined volume updated: Item ${itemVal}%, Master ${masterVal}% -> Final ${(finalVolume * 100).toFixed(0)}%`);
    }

    // アイテムスライダー（フェード機能なし）
    onairItemVolumeSlider.addEventListener("input", () => {
        updateCombinedVolume();
        updateVolumeSliderAppearance();
    });

    // マスターフェーダー（フェード機能を持つ）
    onairMasterVolumeSlider.addEventListener("input", () => {
        if (fadeInInProgress || fadeOutInProgress) {
            stopFade();
        }
        const masterVal = parseInt(onairMasterVolumeSlider.value, 10);
        onairMasterVolume = masterVal;
        updateCombinedVolume();
        onairMasterVolumeSlider.style.setProperty('--value', `${onairMasterVolumeSlider.value}%`);
    });

    // 矢印キーによる操作の無効化（アイテムスライダー）
    onairItemVolumeSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            logDebug(`[onair.js] Key "${event.key}" input disabled on Item Volume Slider.`);
        }
    });
    // 矢印キーによる操作の無効化（マスターフェーダー）
    onairMasterVolumeSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            logDebug(`[onair.js] Key "${event.key}" input disabled on Master Volume Slider.`);
        }
    });
    logDebug('[onair.js] Volume slider handlers for item and master set up.');
}

// ------------------------------
// フェードイン・フェードアウト
// ------------------------------

// フェードアウト処理
function audioFadeOut(duration) {
    if (fadeOutInProgress || fadeInInProgress) return;
    fadeOutInProgress = true;

    const masterSlider = document.getElementById('on-air-master-volume-slider');
    let startTime = null;
    let currentValue = masterSlider.value;
    let targetValue = 0; 

    // スライダーの値を変更する
    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        const masterVolumeDisplay = document.getElementById('on-air-master-volume-value');
        masterVolumeDisplay.textContent = `${roundedValue}%`;
        masterSlider.style.setProperty('--value', `${roundedValue}%`);

        // マスターボリュームが10%以下の場合、警告用クラスを付与
        if (roundedValue <= 10) {
            masterVolumeDisplay.classList.add('neon-warning');
        } else {
            masterVolumeDisplay.classList.remove('neon-warning');
        }

        // 再計算して最終出力音量を更新
        const itemVal = parseInt(document.getElementById('on-air-item-volume-slider').value, 10);
        const masterVal = parseInt(masterSlider.value, 10);
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });
    }

    // フェードアウト処理
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;

        if (!fadeOutInProgress) return;

        const newValue = Math.max(targetValue, currentValue - (elapsed / (duration * 1000)) * currentValue);

        setSliderValue(newValue);

        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            setSliderValue(targetValue);
            // フェードアウト完了時にグローバル変数を更新
            onairMasterVolume = targetValue;
            fadeOutInProgress = false;
            stopFadeButtonBlink(document.getElementById('on-air-fo-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// フェードイン処理
function audioFadeIn(duration) {
    if (fadeInInProgress || fadeOutInProgress) return;
    fadeInInProgress = true;

    const masterSlider = document.getElementById('on-air-master-volume-slider');
    if (!masterSlider) {
        logInfo('[onair.js] Error: on-air-master-volume-slider not found. Aborting fadeIn.');
        fadeInInProgress = false;
        return;
    }
    const itemSlider = document.getElementById('on-air-item-volume-slider');
    if (!itemSlider) {
        logInfo('[onair.js] Error: on-air-item-volume-slider not found. Aborting fadeIn.');
        fadeInInProgress = false;
        return;
    }
    const masterValueElement = document.getElementById('on-air-master-volume-value');
    if (!masterValueElement) {
        logInfo('[onair.js] Error: on-air-master-volume-value not found. Aborting fadeIn.');
        fadeInInProgress = false;
        return;
    }
    const videoElement = document.getElementById('on-air-video');
    if (!videoElement) {
        logInfo('[onair.js] Error: on-air-video element not found. Aborting fadeIn.');
        fadeInInProgress = false;
        return;
    }

    let startTime = null;
    const currentValue = parseFloat(masterSlider.value);
    const targetValue = 100;

    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        masterValueElement.textContent = `${roundedValue}%`;
        masterSlider.style.setProperty('--value', `${roundedValue}%`);

        // マスターボリュームが10%以下なら警告用クラスを付与、それ以外の場合は削除
        if (roundedValue <= 10) {
            masterValueElement.classList.add('neon-warning');
        } else {
            masterValueElement.classList.remove('neon-warning');
        }

        const itemVal = parseInt(itemSlider.value, 10);
        const masterVal = parseInt(masterSlider.value, 10);
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });
    }

    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / (duration * 1000), 1);
        const newValue = currentValue + (targetValue - currentValue) * progress;
        setSliderValue(newValue);
        if (progress < 1) {
            requestAnimationFrame(fadeStep);
        } else {
            setSliderValue(targetValue);
            // フェードイン完了時にグローバル変数を更新
            onairMasterVolume = targetValue;
            fadeInInProgress = false;
            stopFadeButtonBlink(document.getElementById('on-air-fi-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// フェードイン・フェードアウトの処理を中断する関数
function stopFade() {
    if (fadeInInProgress) {
        fadeInInProgress = false;
        logInfo('[onair.js] Fade In stopped');
    }
    if (fadeOutInProgress) {
        fadeOutInProgress = false;
        logInfo('[onair.js] Fade Out stopped');
    }

    // ボタンの点滅を止める
    stopFadeButtonBlink(document.getElementById('on-air-fi-button'));
    stopFadeButtonBlink(document.getElementById('on-air-fo-button'));
}

// フェードイン、フェードアウトボタンのイベントリスナー
document.getElementById('on-air-fo-button').addEventListener('click', () => {
    logOpe('[onair.js] Fade Out button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているかチェック
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade out operation canceled.');
        return;
    }

    const fioRate = parseFloat(document.getElementById('fioRate').value);
    fadeButtonBlink(document.getElementById('on-air-fo-button'));
    audioFadeOut(fioRate);
});

document.getElementById('on-air-fi-button').addEventListener('click', () => {
    logOpe('[onair.js] Fade In button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているかチェック
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade in operation canceled.');
        return;
    }

    const fioRate = parseFloat(document.getElementById('fioRate').value);
    fadeButtonBlink(document.getElementById('on-air-fi-button')); 
    audioFadeIn(fioRate); 
});

// フェードイン・フェードアウトボタンに点滅アニメーションを適用
function fadeButtonBlink(button) {
    if (button) {
        button.classList.add('button-blink-orange');
    }
}

// フェード完了後に点滅を停止
function stopFadeButtonBlink(button) {
    if (button) {
        button.classList.remove('button-blink-orange'); 
    }
}

// スライダーの左側の色表示を、現在の値に合わせて更新する補助関数
function updateVolumeSliderAppearance() {
    const elements = onairGetElements();
    if (elements.onairItemVolumeSlider) {
        elements.onairItemVolumeSlider.style.setProperty('--value', `${elements.onairItemVolumeSlider.value}%`);
    }
}

// アイテム固有の音量フェードアウト処理
function audioFadeOutItem(duration) {
    if (fadeOutInProgress || fadeInInProgress) return;
    fadeOutInProgress = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    let startTime = null;
    let currentValue = itemSlider.value;
    let targetValue = 0;

    // アイテムスライダーの値を更新する補助関数
    function setSliderValue(value) {
        itemSlider.value = value;
        const roundedValue = Math.round(value);
        const itemVolumeDisplay = document.getElementById('on-air-item-volume-value');
        itemVolumeDisplay.textContent = `${roundedValue}%`;
        // カスタムプロパティ --value を更新
        itemSlider.style.setProperty('--value', `${roundedValue}%`);

        // 再計算して最終出力音量を更新（マスタースライダーの値はそのまま）
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

    // フェードアウト処理
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;

        if (!fadeOutInProgress) return;

        const newValue = Math.max(targetValue, currentValue - (elapsed / (duration * 1000)) * currentValue);
        setSliderValue(newValue);

        if (elapsed < duration * 1000) {
            requestAnimationFrame(fadeStep);
        } else {
            setSliderValue(targetValue);
            fadeOutInProgress = false;
            stopFadeButtonBlink(document.getElementById('on-air-item-fo-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// アイテムごとのフェードイン・フェードアウト
document.getElementById('on-air-item-fo-button').addEventListener('click', () => {
    logOpe('[onair.js] Item Fade Out button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているか確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-out operation canceled.');
        return;
    }
    const fadeDuration = onairCurrentState?.ftbRate || 1.0;
    fadeButtonBlink(document.getElementById('on-air-item-fo-button'));
    audioFadeOutItem(fadeDuration);
});

document.getElementById('on-air-item-fi-button').addEventListener('click', () => {
    logOpe('[onair.js] Item Fade In button clicked');
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているか確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-in operation canceled.');
        return;
    }

    // アイテム固有フェードの時間は ftbRate（アイテムデータから取得）を使用
    const fadeDuration = onairCurrentState?.ftbRate || 1.0;
    fadeButtonBlink(document.getElementById('on-air-item-fi-button'));
    audioFadeInItem(fadeDuration); 
});


// -----------------------
// スタートモードFADEIN
// -----------------------

// フェードイン（映像）の処理：画面を黒または FILL-KEY 用の色から透明にする
function onairFadeFromBlack(duration) {
    const elements = onairGetElements();
    const { onairFadeCanvas } = elements;
    if (!onairFadeCanvas) return;
    
    // FILL-KEY モードの場合はカラーピッカーで選択された色、そうでなければ黒を使用
    const selectedColor = isFillKeyMode ? (document.getElementById('fillkey-color-picker')?.value || "#00FF00") : "black";
    onairFadeCanvas.style.backgroundColor = selectedColor;
    
    // 初期状態：キャンバスを完全に不透明にして表示
    onairFadeCanvas.style.opacity = 1;
    onairFadeCanvas.style.visibility = 'visible';
    
    let startTime = null;
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        // opacity を 1 から 0 に向かって補間
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

// アイテム固有の音量フェードイン処理
function audioFadeInItem(duration) {
    if (fadeInInProgress || fadeOutInProgress) return;
    fadeInInProgress = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    if (!itemSlider) {
        logInfo('[onair.js] Error: on-air-item-volume-slider not found. Aborting fadeInItem.');
        fadeInInProgress = false;
        return;
    }
    const targetValue = onairCurrentState?.defaultVolume !== undefined ? onairCurrentState.defaultVolume : 100;
    let startTime = null;
    const currentValue = parseFloat(itemSlider.value);

    // アイテムスライダーの値を更新する補助関数
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

    // フェードイン処理
    function fadeStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / (duration * 1000), 1);
        const newValue = currentValue + (targetValue - currentValue) * progress;
        setSliderValue(newValue);
        if (progress < 1) {
            requestAnimationFrame(fadeStep);
        } else {
            setSliderValue(targetValue);
            fadeInInProgress = false;
            stopFadeButtonBlink(document.getElementById('on-air-item-fi-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// -----------------------
// アイテム状態情報の更新
// -----------------------

// Listedit 更新は「表示と内部状態のみ」更新する
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

    // 現在On-Airの同一アイテムのみ対象
    const updated = updatedState.find(it => it.playlistItem_id === onairCurrentState.itemId);
    if (!updated) {
        logDebug('[onair.js] Listedit update is for a different item. Ignored.');
        return;
    }

    compareAndUpdateState(updated, { source: 'listedit' });
});


// 現在の状態と最新状態を比較し、差分を反映する関数
function compareAndUpdateState(updatedItem, { source } = {}) {
    if (!onairCurrentState) {
        logInfo('[onair.js] Current state is not set. Skipping comparison.');
        return;
    }
    logDebug('[onair.js] Comparing current state with updated item.');

    // 型を正規化（stateは数値秒、updatedItemは文字列の可能性あり）
    const normIn  = typeof updatedItem.inPoint  === 'string' ? onairParseTimeToSeconds(updatedItem.inPoint)  : (updatedItem.inPoint  ?? 0);
    const normOut = typeof updatedItem.outPoint === 'string' ? onairParseTimeToSeconds(updatedItem.outPoint) : (updatedItem.outPoint ?? 0);
    const normEnd = (updatedItem.endMode || '').toString().toUpperCase() || 'PAUSE';
    const normFtb = parseFloat(updatedItem.ftbRate ?? onairCurrentState.ftbRate ?? 1.0);

    // IN
    if (Number(onairCurrentState.inPoint) !== Number(normIn)) {
        logInfo(`IN point updated: ${onairCurrentState.inPoint} → ${normIn}`);
        onairCurrentState.inPoint = normIn;
        handleInPointUpdate(normIn, { source }); // ← transportしない分岐へ
    }

    // OUT
    if (Number(onairCurrentState.outPoint) !== Number(normOut)) {
        logInfo(`OUT point updated: ${onairCurrentState.outPoint} → ${normOut}`);
        onairCurrentState.outPoint = normOut;
        handleOutPointUpdate(normOut, { source });
    }

    // EndMode
    if ((onairCurrentState.endMode || '').toString().toUpperCase() !== normEnd) {
        logInfo(`End mode updated: ${onairCurrentState.endMode} → ${normEnd}`);
        onairCurrentState.endMode = normEnd;
        handleEndModeUpdate(normEnd);
    }

    // FTB rate
    if (Number(onairCurrentState.ftbRate) !== Number(normFtb)) {
        logInfo(`FTB rate updated: ${onairCurrentState.ftbRate} → ${normFtb}`);
        onairCurrentState.ftbRate = normFtb;
        handleFtbRateUpdate(normFtb);
    }

    logDebug('[onair.js] State comparison and update completed.');
}


// IN点の更新処理
function handleInPointUpdate(newInPointSeconds, { source } = {}) {
    if (!onairCurrentState) return;

    const elements = onairGetElements();
    const { onairInPointDisplay, onairVideoElement } = elements;

    const inSec = Number(newInPointSeconds) || 0;
    onairCurrentState.inPoint = inSec;

    // UIのみ更新
    if (onairInPointDisplay) {
        onairInPointDisplay.textContent = onairFormatTime(inSec);
    }
    // マーカー再描画
    onairUpdateSeekBar(elements, onairCurrentState);

    // listedit 由来では transport を一切触らない
    if (source === 'listedit') {
        logDebug('[onair.js] IN updated (visual only, no transport) by listedit.');
        return;
    }

    // それ以外（ユーザー操作/OnAir開始など）で必要な場合のみローカルを合わせる
    if (onairVideoElement && onairVideoElement.currentTime < inSec) {
        onairVideoElement.currentTime = inSec;
        logDebug(`[onair.js] IN point applied to preview video: ${inSec}s`);
    }
    // fullscreen への seek は、ユーザー操作のハンドラ（再生ボタン/シークバー）側でのみ送る
}


// OUT点の更新処理
function handleOutPointUpdate(newOutPointSeconds, { source } = {}) {
    if (!onairCurrentState) return;

    const elements = onairGetElements();
    const { onairOutPointDisplay, onairVideoElement } = elements;

    const outSecRaw = Number(newOutPointSeconds) || 0;
    onairCurrentState.outPoint = outSecRaw;

    if (onairOutPointDisplay) {
        onairOutPointDisplay.textContent = onairFormatTime(outSecRaw);
    }
    // マーカー再描画
    onairUpdateSeekBar(elements, onairCurrentState);

    // listedit 由来なら“この再生セッションに限った有効OUT”を現再生位置+許容誤差まで後ろ寄せ
    let effectiveOut = outSecRaw;
    if (source === 'listedit' && onairIsPlaying && onairVideoElement) {
        const tol = 0.05 * (onairVideoElement.playbackRate || 1); // 監視側toleranceと整合
        effectiveOut = Math.max(outSecRaw, onairVideoElement.currentTime + tol);
        logDebug(`[onair.js] OUT updated by listedit. effectiveOut=${effectiveOut} (raw=${outSecRaw})`);
    }

    // transport は触らない（監視の付け替えのみ）
    if (onairIsPlaying && onairVideoElement) {
        clearInterval(onairPlaybackMonitor);
        onairMonitorPlayback(onairVideoElement, effectiveOut);
    }
}

// エンドモードの更新処理
function handleEndModeUpdate(newEndMode, { source } = {}) {
    const elements = onairGetElements();
    const { onairEndModeDisplay } = elements;

    // 常に state を先に更新（停止中でも次回再生に反映させる）
    if (onairCurrentState) {
        onairCurrentState.endMode = newEndMode;
    }

    // UI の更新
    if (onairEndModeDisplay) {
        onairEndModeDisplay.textContent = `ENDMODE: ${newEndMode.toUpperCase()}`;
    }

    // listedit は“視覚/状態のみ”で終了（transportへは影響なし）
    if (source === 'listedit') {
        logDebug(`[onair.js] End mode updated (visual/state only) by listedit: ${newEndMode}`);
        return;
    }

    // ユーザー操作や内部処理：transportはここでは何もしない（発火はOUT到達時）
    logDebug(`[onair.js] End mode updated: ${newEndMode}`);
}

// FTBレートの更新処理
function handleFtbRateUpdate(newFtbRate) {
    if (!onairCurrentState) {
        logDebug('[onair.js] No current state available for updating FTB rate.');
        return;
    }

    // 最新のFTBレートを状態に反映
    onairCurrentState.ftbRate = parseFloat(newFtbRate);
    logDebug(`[onair.js] FTB rate updated to: ${onairCurrentState.ftbRate}`);
}

// -----------------------
// 音量メーターのセットアップ
// -----------------------

// 受信停止監視用のウォッチドッグ
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

    // 受信停止監視：一定時間更新が無ければ確実にリセット
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
// 音量メーターの更新
// -----------------------

let lastVolumeUpdateTime = null; 
const volumeResetThreshold = 100; 

// 表示用のスムージング状態
let displayedDbFSL = -60;
let displayedDbFSR = -60;
let redHoldUntilTsL = 0;
let redHoldUntilTsR = 0;

// スムージング設定（必要に応じて調整可）
const ATTACK_MS  = 240;            // 上がる速さ（小さいほど速い）
const RELEASE_MS = 360;           // 下がる速さ（大きいほどゆっくり）
const RED_HOLD_MS = 180;          // 赤域に入った後の保持時間

// 数値表示＆ピークホールド（1秒）
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
            if (displayedDbFSL >= -6) redHoldUntilTsL = now + RED_HOLD_MS;
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
                    if (segmentDb >= -6 || (redHoldActive && segmentDb >= -6)) {
                        segment.style.backgroundColor = '#c05050';
                    } else if (segmentDb >= -18) {
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
            if (displayedDbFSR >= -6) redHoldUntilTsR = now + RED_HOLD_MS;
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
                    if (segmentDb >= -6 || (redHoldActive && segmentDb >= -6)) {
                        segment.style.backgroundColor = '#c05050';
                    } else if (segmentDb >= -18) {
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
// フルスクリーンからの音量データ受信
// -----------------------

window.electronAPI.onReceiveFullscreenVolumeLR((L, R) => {
    const l = (typeof L === 'number') ? L : (L && typeof L.dbFS === 'number' ? L.dbFS : -Infinity);
    const r = (typeof R === 'number') ? R : (R && typeof R.dbFS === 'number' ? R.dbFS : -Infinity);
    updateOnAirVolumeMeter(l, r, false);
});
// -----------------------
// スクリーンショット機能
// -----------------------
document.addEventListener('DOMContentLoaded', () => {
    const captureBtn = document.getElementById('capture-button');
    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            logOpe('[screenshot.js] Capture button clicked');
            window.electronAPI.ipcRenderer.send('request-capture-screenshot');
        });
    }
});

// -----------------------
// 録画機能
// -----------------------
document.addEventListener('DOMContentLoaded', () => {
    const recBtn = document.getElementById('rec-button');
    if (recBtn) {
        recBtn.addEventListener('click', async () => {
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
// FTBボタンの処理
// -----------------------
function onairHandleFTBButton() {
    if (!onairNowOnAir) {
        logDebug('[onair.js] FTB button clicked, but On-Air is not active.');
        return;
    }
    logOpe('[onair.js] FTB button clicked');
    logInfo('[onair.js] FTB button clicked. Forcing FTB end mode.');
    const elements = onairGetElements();
    fadeButtonBlink(elements.onairFTBButton);
    const currentTime = elements.onairVideoElement ? elements.onairVideoElement.currentTime : 0;

    // フルスクリーン側に FTB コマンドを送信
    window.electronAPI.sendControlToFullscreen({
        command: 'trigger-endMode',
        value: 'FTB',
        currentTime: currentTime,
    });
    logDebug(`[onair.js] EndMode command sent to fullscreen: { endMode: FTB, currentTime: ${currentTime} }`);
    onairHandleEndModeFTB();
}

// -----------------------
// FILL-KEY MODE
// -----------------------
(function setupFillKeyMode() {
    isFillKeyMode = false;
    const fillKeyButton = document.getElementById('fillkey-mode-button');
    if (!fillKeyButton) {
        logInfo('[onair.js] FILL-KEY mode button not found.');
        return;
    }
    fillKeyButton.addEventListener('keydown', (event) => {
        if (event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            logDebug('[onair.js] Prevented SHIFT+ENTER default behavior on FILL-KEY button.');
        }
    });
    // ボタンにクリックイベントリスナーを登録
    fillKeyButton.addEventListener('click', () => {
        logOpe('[onair.js] FillKey button clicked');
        if (!isFillKeyMode) {
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
            // モード解除: FILL-KEY MODE OFF
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

// FILLKEYモードの状態を onair.js 側に反映
function updateFillKeyModeState() {
    const fillKeyButton = document.getElementById('fillkey-mode-button');
    const onAirVideo = document.getElementById('on-air-video');
    
    if (isFillKeyMode) {
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

// FILLKEYモード更新のための IPC 受信
window.electronAPI.ipcRenderer.on('fillkey-mode-update', (event, fillKeyMode) => {
    logDebug(`[onair.js] Received fillkey-mode-update: ${fillKeyMode}`);
    if (typeof fillKeyMode === 'boolean') {
        isFillKeyMode = fillKeyMode;
        updateFillKeyModeState(); 
        logDebug(`[onair.js] FillKey mode switched to: ${isFillKeyMode}`);
    }
});

window.electronAPI.ipcRenderer.on('clear-modes', (event, newFillKeyMode) => {
    logDebug('[onair.js] Received clear-modes notification with value:', newFillKeyMode);
    isFillKeyMode = newFillKeyMode; 
    updateFillKeyModeState();
    // フルスクリーン側にもフィルキー解除を伝える
    window.electronAPI.sendControlToFullscreen({ command: 'set-fillkey-bg', value: '' });
    logDebug('[onair.js] FillKey mode has been updated to:', isFillKeyMode);
});

// -----------------------
// ショートカットキー管理
// -----------------------

// モーダル状態の初期化
let isOnAirModalActive = false;

// モーダル状態ログ/リスナー重複防止
let lastLoggedOnAirModalState = null;
let onairModalListenerRegistered = false;

// 音量上下の際のフェード補助関数
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
            slider.value = endValue;
            if (typeof updateAppearance === 'function') updateAppearance(slider, endValue);
            if (typeof syncCombinedVolume === 'function') syncCombinedVolume();
            if (typeof onComplete === 'function') onComplete(endValue);
        }
    }
    requestAnimationFrame(frame);
}

// ショートカットキーの共通処理関数
function handleShortcut(action) {
    if (isOnAirModalActive) {
        logDebug('[onair.js] Shortcut ignored because OnAir modal is active.');
        return;
    }

    // "Shift+Alt+S" は playlist.js 側で処理しているため、onair.js では無視する
    if (action === 'Shift+Alt+S') {
        return;
    }

    // 音量更新の共通処理（ITEM/Master値から最終出力を算出して反映）
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

        // CSSカスタムプロパティ更新
        itemSlider.style.setProperty('--value',   `${itemVal}%`);
        masterSlider.style.setProperty('--value', `${masterVal}%`);

        // 最終出力（ガンマ 2.2 適用）をFullscreenへ送信
        const finalVolume = (itemVal / 100) * (masterVal / 100);
        window.electronAPI.sendControlToFullscreen({
            command: 'set-volume',
            value: Math.pow(finalVolume, 2.2)
        });

        // プレビュー側にも反映
        if (videoElement) videoElement.volume = finalVolume;
    }

    function clampPercent(v) {
        return Math.max(0, Math.min(100, Math.round(v)));
    }

    switch (action) {
            case 'Escape': // ESCキー（ネイティブ）
            case 'Esc':    // メニューからのEscも同様に処理
                logOpe('[onair.js] Shortcut: ESC pressed.');
                onairHandleOffAirButton();
                break;

        case 'Space': // スペースキー
            logOpe('[onair.js] Shortcut: Space pressed.');
            if (onairIsPlaying) {
                onairHandlePauseButton(); // 一時停止
            } else {
                onairHandlePlayButton(); // 再生
            }
            break;

        case 'Ctrl+,': // CTRL + , (フェードイン)
            logOpe('[onair.js] Shortcut: CTRL+, (fade in) triggered.');
            document.getElementById('on-air-fi-button').click(); // フェードインボタンをクリック
            break;

        case 'Ctrl+.': // CTRL + . (フェードアウト)
            logOpe('[onair.js] Shortcut: CTRL+. (fade out) triggered.');
            document.getElementById('on-air-fo-button').click(); // フェードアウトボタンをクリック
            break;

        case 'Shift+Alt+F': // Shift + Alt + F で FILL-KEY モードをトグル
            logOpe('[onair.js] Shortcut: Shift+Alt+F triggered.');
            document.getElementById('fillkey-mode-button').click();
            break;

        case 'Shift+F': // Shift+F で FTB ボタンの処理を呼び出し
            logOpe('[onair.js] Shortcut: Shift+F triggered.');
            onairHandleFTBButton();
            break;

        case 'Shift+R': // Shift+R で録画の開始／停止をトグル
            logOpe('[onair.js] Shortcut: Shift+R (recording toggle) triggered.');
            document.getElementById('rec-button').click(); // 録画ボタンをクリック
            break;

        // 音量ショートカット
        case 'Alt+]': { // ITEM +3%（ミニフェード）
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
        case 'Alt+[': { // ITEM -3%（ミニフェード）
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
        case 'Ctrl+Alt+]': { // MAIN +3%（ミニフェード）
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
        case 'Ctrl+Alt[': { // MAIN -3%（ミニフェード）
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


// キーボードショートカットの設定（Mac用追加）
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

    // → Ctrl+.／Cmd+.+Option+. でフェードアウト
    // → Ctrl+,／Cmd+,／Option+, でフェードイン
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

    // 音量ショートカット
    // ITEM：Alt + ] / Alt + [
    if (!action && isAlt && !isShift && !isMod && event.key === ']') {
        action = 'Alt+]';
    } else if (!action && isAlt && !isShift && !isMod && event.key === '[') {
        action = 'Alt+[';
    }

    // MAIN：Ctrl+Alt + ] / [
    if (!action && isAlt && !isShift && ( (isCtrl && !isMeta) || (!isCtrl && isMeta) ) && event.key === ']') {
        action = 'Ctrl+Alt+]';
    } else if (!action && isAlt && !isShift && ( (isCtrl && !isMeta) || (!isCtrl && isMeta) ) && event.key === '[') {
        action = 'Ctrl+Alt[';
    }

    if (action) {
        handleShortcut(action);
        event.preventDefault();
    }
});



// メニューからショートカット通知を受信
window.electronAPI.onShortcutTrigger((event, action) => {
    logDebug(`[onair.js] Shortcut triggered from menu: ${action}`);
    handleShortcut(action);
});