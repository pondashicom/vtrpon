// -----------------------
//     onair.js
//     ver 2.2.9
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
    const centiseconds = Math.floor((seconds % 1) * 100); // 小数を百分の1秒に変換
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
        seconds += parts[3] / 100; // 百分の1秒を秒に変換
    }

    return (hours * 3600) + (minutes * 60) + seconds;
}

// グローバル変数
let onairCurrentState = null;
let onairNowOnAir = false;
let onairIsPlaying = false;
let onairRepeatFlag = false;
let onairRemainingTimer = null;
let globalEndedListener; // endedイベントリスナー
let isFillKeyMode = false; // FILL-KEY モード判定用フラグ
let ftbMainTimeout = null;  // FTB用のメインタイマー
let ftbOffAirTimeout = null; // FTB後半のオフエアタイマー
let onairMasterVolume = 100; // マスターフェーダーの音量（グローバルに保持）
let fadeOutInProgress = false;// フェード中の処理を管理するフラグを個別に管理
let fadeInInProgress = false;
let isOffAirProcessing = false; // Off-Air処理中フラグ

// -----------------------
// 初期化
// -----------------------

// 初回読み込み時の初期化実行
document.addEventListener('DOMContentLoaded', onairInitialize);

// UI要素の取得と定義
function onairGetElements() {
    return {
        onairVideoElement: document.getElementById('on-air-video'),
        onairFadeCanvas: document.getElementById('fade-canvas'),
        onairVolumeBar: document.getElementById('on-air-volume-bar'),
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
    const { onairVolumeBar } = elements;
    if (!onairVolumeBar) return;

    // 音量メーターのセットアップ処理
    onairVolumeBar.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.className = 'volume-segment';
        onairVolumeBar.appendChild(segment);
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
    onairProgressSlider.max = 0; // 最大値
    onairProgressSlider.step = "0.01"; // 精度
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
        onairProgressSlider.max = duration.toFixed(2); // 動画の尺を最大値に設定
        onairEndTimeDisplay.textContent = onairFormatTime(duration); // 終了時間表示
        // logDebug(`Seek bar updated with video duration: ${duration}s`);
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
    onairFadeCanvas.style.opacity = 0; // 初期は透明
    onairFadeCanvas.style.visibility = 'hidden'; // 非表示

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
let onairInitialized = false;  // 初期化済フラグ

function onairInitialize() {
    // 既に初期化されていれば何もしない
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
    window.electronAPI.onModalStateChange((event, { isActive }) => {
        isOnAirModalActive = isActive;
        logDebug(`[onair.js] OnAir Modal state changed: ${isOnAirModalActive}`);
    });

    // 初期モーダル状態取得
    window.electronAPI.getModalState().then((state) => {
        isOnAirModalActive = state.isActive;
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
            speedSlider.value = "0"; // s = 0 に相当（1.00倍）
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
            // UIはそのまま有効にして値を変更しない
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
    const playlist = stateControl.getPlaylistState(); // プレイリストの状態を取得
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
        const combinedVolume = (itemVal / 100) * (masterVal / 100);  // 0～1の範囲
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
        // このリスナーは一度だけ実行するので削除
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

    const remainingTime = Math.max(0, itemData.outPoint - onairVideoElement.currentTime);
    onairRemainTimeDisplay.textContent = onairFormatTime(remainingTime);

    // 残り時間が少ない場合、色を赤にする
    if (remainingTime < 5) {
        onairRemainTimeDisplay.style.color = 'red';
    } else {
        onairRemainTimeDisplay.style.color = 'orange';
    }

    logDebug(`[onair.js] Remaining time updated: ${remainingTime}s`);
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

    // 残り時間の計算
    const remainingTime = Math.max(0, itemData.outPoint - onairVideoElement.currentTime);
    onairRemainTimeDisplay.textContent = onairFormatTime(remainingTime);

    // 色の更新: 5秒未満なら赤、それ以外はオレンジ
    onairRemainTimeDisplay.style.color = remainingTime < 5 ? 'red' : 'orange';

    // logDebug(`Remaining time updated: ${remainingTime}s`);
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

    // 既存の監視を停止（念のため）
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
                onairRepeatFlag = false; // リピート解除
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData); // 残り時間タイマー開始
                logOpe('[onair.js] Playback started via PLAY start mode.');
                // Fullscreen 側に PLAY 指令を送信
                window.electronAPI.sendControlToFullscreen({ command: 'play' });
            })
            .catch(error => {
                onairIsPlaying = false;
                logInfo(`[onair.js] Playback failed: ${error.message}`);
                onairUpdatePlayPauseButtons(elements);
            });
    } else if (itemData.startMode === 'FADEIN') {
        // FADEIN モードの場合：音声と映像のフェードイン効果を実施
        // 初期音量を 0 に設定（映像側の音量も0にする）
        onairVideoElement.volume = 0;
        // アイテムボリュームのスライダーをリセット
        const itemSlider = document.getElementById('on-air-item-volume-slider');
        if (itemSlider) {
            itemSlider.value = 0;
            document.getElementById('on-air-item-volume-value').textContent = '0%';
            itemSlider.style.setProperty('--value', `0%`);
        }
        // 映像面：フェードイン開始（duration は FTBレートを使用）
        const ftbRate = itemData.ftbRate || 1.0;
        onairFadeFromBlack(ftbRate);
        
        onairIsPlaying = true;
        onairVideoElement.play()
            .then(() => {
                // 音声フェードイン処理（アイテムボリュームの値を0からデフォルト値へフェードイン）
                audioFadeInItem(ftbRate);
                onairUpdatePlayPauseButtons(elements);
                onairStartRemainingTimer(elements, itemData);
                logOpe('[onair.js] Playback started via FADEIN start mode with fade in effect.');
                // Fullscreen 側へ FADEIN 指令を送信
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

// OUT点到達の監視（残り時間タイマーを利用）
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

        const currentEndMode = onairCurrentState?.endMode || "PAUSE"; // 最新のエンドモードを取得
        logInfo(`[onair.js] Triggering End Mode: ${currentEndMode}`);
        onairHandleEndMode(currentEndMode);
    }

    // 既存の監視を停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
    }

    // 再生監視の設定（残り時間を利用）
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
    const currentEndMode = onairCurrentState?.endMode || "PAUSE"; // 最新のエンドモードを取得
    logInfo(`[onair.js] Global ended event fired. Triggering end mode. Current endMode=${currentEndMode}`);

    // エンドモードを発火
    onairHandleEndMode(currentEndMode);

    // 不要ならリスナーを削除
    if (videoElement && globalEndedListener) {
        videoElement.removeEventListener('ended', globalEndedListener);
        globalEndedListener = null; // リスナーをリセット
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
        value: endMode, // この値が正しく設定されているか確認
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
        onairOffAirButton.click(); // オフエアボタンをクリック
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
        onairVideoElement.currentTime = onairCurrentState.outPoint || onairVideoElement.duration; // 最終フレームに移動
    }

    onairIsPlaying = false; // 再生状態を停止に設定
    onairUpdatePlayPauseButtons(elements); // ボタン状態を更新

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

    onairRepeatFlag = true; // リピートフラグを立てる
    onairStartPlayback(onairCurrentState); // 再生プロセスに戻る
}

// エンドモードFTB
function onairHandleEndModeFTB() {
    logInfo('[onair.js] End Mode: FTB - Performing fade to black.');

    const elements = onairGetElements();
    const { onairVideoElement, onairFadeCanvas, onairOffAirButton } = elements; // オフエアボタンを取得

    if (!onairVideoElement || !onairFadeCanvas) {
        logInfo('[onair.js] Video element or fade canvas not found. FTB skipped.');
        // FTBボタンの点滅も停止
        stopFadeButtonBlink(document.getElementById('ftb-off-button'));
        return;
    }

    const ftbRate = onairCurrentState.ftbRate || 1.0; // FTBレートを取得

    // キャンバスサイズを調整
    adjustFadeCanvasSize(onairVideoElement, onairFadeCanvas);

    // 画面のフェードアウト処理
    onairFadeToBlack(onairFadeCanvas, ftbRate);

    // 音声のフェードアウト処理
    audioFadeOutItem(ftbRate);

    // フェードアウト完了後に一時停止
    ftbMainTimeout = setTimeout(() => {
        onairVideoElement.pause();
        onairIsPlaying = false; // 再生状態をリセット
        onairUpdatePlayPauseButtons(elements); // UIを更新
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
        }, 500); // 0.5秒後
    }, (ftbRate + 0.5) * 1000); // FTB時間 + 0.5秒

    onairIsPlaying = false;
}

// キャンバスサイズ調整
function adjustFadeCanvasSize(videoElement, fadeCanvas) {
    const extraMargin = 1; // 微調整用の余白
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

    const currentItemId = onairCurrentState?.itemId;
    if (!currentItemId) {
        logInfo('[onair.js] No current On-Air item ID found. Executing Off-Air.');
        onairHandleEndModeOff();
        return;
    }

    // 次のアイテムの選択は playlist.js 側で処理するため、現在のアイテムIDをそのまま通知する
    window.electronAPI.notifyNextModeComplete(currentItemId);
    logInfo(`[onair.js] NEXT mode complete broadcast sent for item ID: ${currentItemId}`);

    onairCurrentState = null;
    onairNowOnAir = false;
    onairIsPlaying = false;

    logInfo('[onair.js] NEXT mode processing completed.');
}

// -------------------------------
// 再生、一時停止、オフエアボタン
// -------------------------------

// 再生ボタンの処理
function onairHandlePlayButton() {
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
        onairVideoElement.load();  // ended 状態をリセットするため load() を呼び出す
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
            onairIsPlaying = true; // 再生中に設定
            onairUpdatePlayPauseButtons(elements); // UIを更新
            onairStartRemainingTimer(elements, onairCurrentState); // タイマーを開始
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
    onairUpdatePlayPauseButtons(elements); // UIを更新
    onairStopRemainingTimer(); // タイマーを停止
    logOpe('[onair.js] Playback paused.');

    // Fullscreen.jsに通知
    window.electronAPI.sendControlToFullscreen({ command: 'pause' });
}

// オフエアボタンの処理
function onairHandleOffAirButton() {
    if (isOffAir || isOffAirProcessing) {
        logDebug('[onair.js] Already in off-air state or processing; skipping new off-air processing.');
        return;
    }
    isOffAirProcessing = true;
    logInfo('[onair.js] Executing off-air processing.');
    onairNowOnAir = false; // オンエア状態を強制的に無効化
    onairReset(); // リセット処理（全体初期化）
    // ここでITEM音量を強制的に100%に再設定
    const elements = onairGetElements();
    onairInitializeVolumeSlider(elements, 100);
    window.electronAPI.sendControlToFullscreen({ command: 'offAir' });
    window.electronAPI.stateControl.resetOnAirState();
    logDebug('[onair.js] resetOnAirState executed.');
    // Off-Air通知を送信してプレイリスト側の初期化を促す
    window.electronAPI.sendOffAirEvent();
    logDebug('[onair.js] sendOffAirEvent executed.');
    isOffAirProcessing = false;
    isOffAir = true; // Off-Air状態に設定
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

// --------------
// シークバー
// --------------

// シーク操作ハンドラ
function onairHandleSeekBarChange(event, elements) {
    const { onairVideoElement, onairProgressSlider } = elements;

    if (!onairVideoElement || !onairProgressSlider) return;

    const newTime = parseFloat(onairProgressSlider.value);
    if (!isNaN(newTime)) {
        onairVideoElement.currentTime = newTime; // ビデオ位置を更新
        logOpe(`[onair.js] Video seeked to time: ${newTime}`);

        // Fullscreen.js に通知
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
            onairProgressSlider.value = 0; // 強制的にシーク位置をリセット
            return;
        }
        onairHandleSeekBarChange(event, elements);
    });

    // ビデオの再生位置が変わったときにシークバーを更新
    onairVideoElement.addEventListener('timeupdate', () => {
        if (!onairCurrentState) return; // currentStateがない場合は無視

        // UVCデバイスの場合、シークバー更新をスキップ
        if (onairCurrentState.endMode === "UVC") return;

        // 通常の動画の場合のみシークバーを更新
        onairUpdateSeekBar(elements, onairCurrentState);
    });

    // シークバーで矢印キーの動作を無効化
    onairProgressSlider.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); // デフォルトのキー動作を無効化
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
let isPlaybackSpeedFixed = false; // ユーザーが手動入力で固定したかどうか
const PLAYBACK_SPEED_RETURN_DURATION = 500; // 戻りアニメーションの所要時間（ミリ秒）

function setupPlaybackSpeedController() {
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
        if (!onairNowOnAir) {
            logDebug('[onair.js] Speed control input ignored: On-Air is not active.');
            return;
        }
        if (isPlaybackSpeedFixed) {
            isPlaybackSpeedFixed = false;
        }
        isPlaybackSpeedDragging = true;
        const s = parseFloat(slider.value); // 範囲: -16 ～ 16
        const newRate = Math.pow(16, s / 16); // 対数スケール変換
        video.playbackRate = newRate;
        inputField.value = newRate.toFixed(2); // 入力欄も更新
        window.electronAPI.sendControlToFullscreen({
            command: 'set-playback-speed',
            value: newRate
        });
    });

    // スライダー操作終了時の処理（既存のまま）
    const releaseHandler = () => {
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
    }, 100); // 100msごとに更新

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
            // マスターボリュームが10%以下の場合、警告用のCSSクラスを付与
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
        onairMasterVolume = masterVal; // グローバル変数を更新
        updateCombinedVolume();
        // マスタースライダーも背景更新（--value に現在の値をセット）
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
    if (fadeOutInProgress || fadeInInProgress) return; // 既にフェード中なら中断
    fadeOutInProgress = true;

    const masterSlider = document.getElementById('on-air-master-volume-slider');
    let startTime = null;
    let currentValue = masterSlider.value;  // 現在のスライダー値（0～100）
    let targetValue = 0; // フェードアウト先のスライダー値（0）

    // スライダーの値を変更する
    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        const masterVolumeDisplay = document.getElementById('on-air-master-volume-value');
        masterVolumeDisplay.textContent = `${roundedValue}%`;
        // カスタムプロパティ --value を更新して、左側の色表示を反映
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
    if (fadeInInProgress || fadeOutInProgress) return; // 既にフェード中なら中断
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
    const targetValue = 100; // マスターフェーダーは100までフェードインする

    function setSliderValue(value) {
        masterSlider.value = value;
        const roundedValue = Math.round(value);
        masterValueElement.textContent = `${roundedValue}%`;
        // カスタムプロパティ --value を更新
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
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているかチェック
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade out operation canceled.');
        return;
    }

    const fioRate = parseFloat(document.getElementById('fioRate').value);
    fadeButtonBlink(document.getElementById('on-air-fo-button')); // フェードアウトボタン点滅
    audioFadeOut(fioRate); // フェードアウト処理
});

document.getElementById('on-air-fi-button').addEventListener('click', () => {
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているかチェック
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Fade in operation canceled.');
        return;
    }

    const fioRate = parseFloat(document.getElementById('fioRate').value);
    fadeButtonBlink(document.getElementById('on-air-fi-button')); // フェードインボタン点滅
    audioFadeIn(fioRate); // フェードイン処理
});

// フェードイン・フェードアウトボタンに点滅アニメーションを適用
function fadeButtonBlink(button) {
    if (button) {
        button.classList.add('button-blink-orange'); // 点滅
    }
}

// フェード完了後に点滅を停止
function stopFadeButtonBlink(button) {
    if (button) {
        button.classList.remove('button-blink-orange'); // 点滅停止
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
    if (fadeOutInProgress || fadeInInProgress) return; // 既にフェード中なら中断
    fadeOutInProgress = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    let startTime = null;
    let currentValue = itemSlider.value;  // 現在のアイテムスライダー値（0～100）
    let targetValue = 0; // フェードアウト先の値（0）

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
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているか確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-out operation canceled.');
        return;
    }

    // アイテム固有フェードの時間は ftbRate（アイテムデータから取得）を使用
    const fadeDuration = onairCurrentState?.ftbRate || 1.0;
    fadeButtonBlink(document.getElementById('on-air-item-fo-button')); // アイテムフェードアウトボタン点滅
    audioFadeOutItem(fadeDuration); // アイテムフェードアウト処理
});

document.getElementById('on-air-item-fi-button').addEventListener('click', () => {
    const elements = onairGetElements();
    const videoElement = elements.onairVideoElement;

    // 動画がロードされているか確認
    if (!videoElement || !videoElement.src || videoElement.src.trim() === "" || videoElement.readyState < 2) {
        logInfo('[onair.js] No video loaded or not ready. Item fade-in operation canceled.');
        return;
    }

    // アイテム固有フェードの時間は ftbRate（アイテムデータから取得）を使用
    const fadeDuration = onairCurrentState?.ftbRate || 1.0;
    fadeButtonBlink(document.getElementById('on-air-item-fi-button')); // アイテムフェードインボタン点滅
    audioFadeInItem(fadeDuration); // アイテムフェードイン処理
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
// on-air-item-volume-slider の値を、0からデフォルト値（存在しなければ100）へ徐々に上げる
function audioFadeInItem(duration) {
    if (fadeInInProgress || fadeOutInProgress) return; // 既にフェード中なら中断
    fadeInInProgress = true;

    const itemSlider = document.getElementById('on-air-item-volume-slider');
    if (!itemSlider) {
        logInfo('[onair.js] Error: on-air-item-volume-slider not found. Aborting fadeInItem.');
        fadeInInProgress = false;
        return;
    }
    // 目標値は、onairCurrentState の defaultVolume があればそれを、なければ100
    const targetValue = onairCurrentState?.defaultVolume !== undefined ? onairCurrentState.defaultVolume : 100;
    let startTime = null;
    const currentValue = parseFloat(itemSlider.value); // 初期は0になっているはず

    // アイテムスライダーの値を更新する補助関数
    function setSliderValue(value) {
        itemSlider.value = value;
        const roundedValue = Math.round(value);
        const itemVolumeDisplay = document.getElementById('on-air-item-volume-value');
        itemVolumeDisplay.textContent = `${roundedValue}%`;
        itemSlider.style.setProperty('--value', `${roundedValue}%`);

        // 再計算：マスタースライダーの値はそのまま利用
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
            // フェードイン完了時に必要なグローバル変数を更新
            fadeInInProgress = false;
            stopFadeButtonBlink(document.getElementById('on-air-item-fi-button'));
        }
    }
    requestAnimationFrame(fadeStep);
}

// -----------------------
// アイテム状態情報の更新
// -----------------------

// エディットエリアで更新があったら通知を受信するリスナー
window.electronAPI.onListeditUpdated(() => {
    logDebug('[onair.js]  Listedit update received.');

    // 最新状態の取得
    const updatedState = stateControl.getPlaylistState();
    if (!updatedState || !Array.isArray(updatedState)) {
        logInfo('[onair.js] Failed to retrieve updated playlist state.');
        return;
    }

    // 現在のアイテムに対応するデータを取得
    const currentItem = updatedState.find(item => item.playlistItem_id === onairCurrentState?.itemId);
    if (!currentItem) {
        logInfo('[onair.js] No matching item found in updated state.');
        return;
    }

    // 差分を確認
    compareAndUpdateState(currentItem);
});

// 現在の状態と最新状態を比較し、差分を反映する関数
function compareAndUpdateState(updatedItem) {
    if (!onairCurrentState) {
        logInfo('[onair.js] Current state is not set. Skipping comparison.');
        return;
    }

    logDebug('[onair.js] Comparing current state with updated item.');

    // 差分チェックと処理
    if (onairCurrentState.inPoint !== updatedItem.inPoint) {
        logInfo(`IN point updated: ${onairCurrentState.inPoint} → ${updatedItem.inPoint}`);
        onairCurrentState.inPoint = updatedItem.inPoint;
        handleInPointUpdate(updatedItem.inPoint);
    }

    if (onairCurrentState.outPoint !== updatedItem.outPoint) {
        logInfo(`OUT point updated: ${onairCurrentState.outPoint} → ${updatedItem.outPoint}`);
        onairCurrentState.outPoint = updatedItem.outPoint;
        handleOutPointUpdate(updatedItem.outPoint);
    }

    if (onairCurrentState.endMode !== updatedItem.endMode) {
        logInfo(`End mode updated: ${onairCurrentState.endMode} → ${updatedItem.endMode}`);
        onairCurrentState.endMode = updatedItem.endMode;
        handleEndModeUpdate(updatedItem.endMode);
    }

    if (onairCurrentState.ftbRate !== updatedItem.ftbRate) {
        logInfo(`FTB rate updated: ${onairCurrentState.ftbRate} → ${updatedItem.ftbRate}`);
        onairCurrentState.ftbRate = updatedItem.ftbRate;
        handleFtbRateUpdate(updatedItem.ftbRate);
    }

    logDebug('[onair.js] State comparison and update completed.');
}

// IN点の更新処理
function handleInPointUpdate(newInPoint) {
    if (!onairCurrentState) {
        logDebug('[onair.js] No current state available for updating IN point.');
        return;
    }

    const elements = onairGetElements();
    const { onairInPointDisplay, onairVideoElement } = elements;

    // 新しいIN点を変換して適用
    const parsedInPoint = onairParseTimeToSeconds(newInPoint || '00:00:00:00');
    onairCurrentState.inPoint = parsedInPoint;

    // UIの更新
    if (onairInPointDisplay) {
        onairInPointDisplay.textContent = onairFormatTime(parsedInPoint);
    }

    // 現在の再生位置がIN点より前の場合のみ、再生位置を更新
    if (onairVideoElement && onairVideoElement.currentTime < parsedInPoint) {
        onairVideoElement.currentTime = parsedInPoint;
        logDebug(`[onair.js] IN point updated and video seeked to: ${parsedInPoint}s`);
    } else {
        logDebug(`[onair.js] IN point updated without seeking: ${parsedInPoint}s`);
    }
}

// OUT点の更新処理
function handleOutPointUpdate(newOutPoint) {
    if (!onairCurrentState) {
        logDebug('[onair.js] No current state available for updating OUT point.');
        return;
    }

    const elements = onairGetElements();
    const { onairOutPointDisplay, onairVideoElement } = elements;

    // 新しいOUT点を変換して適用
    const parsedOutPoint = onairParseTimeToSeconds(newOutPoint || '00:00:00:00');
    onairCurrentState.outPoint = parsedOutPoint;

    // UIの更新
    if (onairOutPointDisplay) {
        onairOutPointDisplay.textContent = onairFormatTime(parsedOutPoint);
    }

    logDebug(`[onair.js] OUT point updated: ${parsedOutPoint}s`);

    // 既存の監視を停止
    if (typeof onairPlaybackMonitor !== 'undefined') {
        clearInterval(onairPlaybackMonitor);
    }

    // 再生監視の更新
    if (onairIsPlaying && onairVideoElement) {
        clearInterval(onairPlaybackMonitor); // 既存の再生監視を停止
        onairMonitorPlayback(onairVideoElement, parsedOutPoint); // 新しいOUT点で再監視
    }
}

// エンドモードの更新処理
function handleEndModeUpdate(newEndMode) {
    const elements = onairGetElements();
    const { onairEndModeDisplay } = elements;

    // エンドモードのUI表示を更新
    if (onairEndModeDisplay) {
        onairEndModeDisplay.textContent = `ENDMODE: ${newEndMode.toUpperCase()}`;
    }

    // 再生中でもエンドモードの動作を即時反映するために設定を変更
    if (onairIsPlaying && onairCurrentState) {
        onairCurrentState.endMode = newEndMode;
        logDebug(`[onair.js] End mode updated to: ${newEndMode} during playback.`);
    }

    logDebug(`[onair.js] End mode updated in UI: ${newEndMode}`);
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
function setupOnAirVolumeMeter() {
    const volumeBar = document.getElementById('on-air-volume-bar');

    if (!volumeBar) {
        logDebug('On-Air Volume Bar element not found.');
        return;
    }

    // 初期化
    volumeBar.innerHTML = ''; // メーターをクリア
    for (let i = 0; i < 60; i++) {
        const segment = document.createElement('div');
        segment.classList.add('volume-segment');
        volumeBar.appendChild(segment);
    }
}

// -----------------------
// 音量メーターの更新
// -----------------------

let lastVolumeUpdateTime = null; // 最後に音量が更新された時間を記録
const volumeResetThreshold = 100; // 100ms以上信号が途絶えたらリセット

function updateOnAirVolumeMeter(dbFS) {
    const volumeBar = document.getElementById('on-air-volume-bar');
    if (!volumeBar) return;

    const segments = Array.from(volumeBar.querySelectorAll('.volume-segment'));
    const totalSegments = segments.length;

    // アイテムスライダーとマスタースライダーの値を取得し、最終出力音量（0～100）を算出
    const itemSliderValue = parseFloat(document.getElementById('on-air-item-volume-slider').value);
    const masterSliderValue = parseFloat(document.getElementById('on-air-master-volume-slider').value);
    const combinedSliderValue = (itemSliderValue / 100) * (masterSliderValue / 100) * 100; // パーセンテージ換算
    const sliderNormalized = combinedSliderValue / 100; // 0～1に正規化

    // 信号が来ていない場合はリセット
    if (dbFS === -Infinity || dbFS < -100) {
        resetOnAirVolumeMeter();
        return;
    }

    // 2つのスライダーの値を反映したdBFS値を計算
    const adjustedDbFS = dbFS + 20 * Math.log10(sliderNormalized || 0.01);  // 0の場合は最小値を設定

    // dBFSを0～1に正規化（対数スケール）
    const normalizedVolume = Math.max(0, Math.min(1, Math.pow(10, adjustedDbFS / 20)));
    const activeSegments = Math.round(normalizedVolume * totalSegments);

    // メーターを更新
    segments.forEach((segment, index) => {
        if (index >= totalSegments - activeSegments) {
            const segmentThreshold = -((index / totalSegments) * 80);

        if (segmentThreshold >= -10) {
            segment.style.backgroundColor = '#c05050'; // やや深めの赤
            segment.style.boxShadow = '0 0 6px rgba(192, 80, 80, 0.6)';
        } else if (segmentThreshold >= -30) {
            segment.style.backgroundColor = 'rgb(210,160,120)'; // オレンジつまみと同色
            segment.style.boxShadow = '0 0 6px rgba(210, 160, 120, 0.6)';
        } else {
            segment.style.backgroundColor = 'rgb(90,130,90)'; // 濃いめ緑（落ち着いた渋さ）
            segment.style.boxShadow = '0 0 6px rgba(90, 130, 90, 0.6)';
        }
        } else {
            segment.style.backgroundColor = '#555'; // 灰色（非アクティブ）
            segment.style.boxShadow = 'none';
        }
    });

    // 音量更新時間を記録
    lastVolumeUpdateTime = Date.now();

    // 音量のリセット処理
    setTimeout(() => {
        if (Date.now() - lastVolumeUpdateTime >= volumeResetThreshold) {
            resetOnAirVolumeMeter();
        }
    }, volumeResetThreshold);
}


function resetOnAirVolumeMeter() {
    const volumeBar = document.getElementById('on-air-volume-bar');
    if (!volumeBar) return;

    Array.from(volumeBar.querySelectorAll('.volume-segment')).forEach(segment => {
        segment.style.backgroundColor = '#555'; // 灰色
        segment.style.boxShadow = 'none';
    });
}

// -----------------------
// フルスクリーンからの音量データ受信
// -----------------------

window.electronAPI.onReceiveFullscreenVolume((dbFS) => {
    // logDebug(`Received dBFS: ${dbFS}`);
    updateOnAirVolumeMeter(dbFS);
});

// -----------------------
// スクリーンショット機能
// -----------------------
document.addEventListener('DOMContentLoaded', () => {
    const captureBtn = document.getElementById('captuer-button');
    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
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
            // 録画対象は fullscreen-video から取得するため、直接 recorder を呼び出さず、fullscreen.js へ制御コマンドを送信する
            if (!window.recorderIsActive) {
                // 録画開始
                window.electronAPI.sendControlToFullscreen({ command: 'start-recording' });
                window.recorderIsActive = true;
                recBtn.classList.add('button-recording');
                logInfo('[onair.js] REC mode started (command sent).');
            } else {
                // 録画停止
                window.electronAPI.sendControlToFullscreen({ command: 'stop-recording' });
                window.recorderIsActive = false;
                recBtn.classList.remove('button-recording');
                logInfo('[onair.js] REC mode ended (command sent).');
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
    logInfo('[onair.js] FTB button clicked. Forcing FTB end mode.');
    const elements = onairGetElements();
    // FTBボタンの点滅開始
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
    // FILL-KEY MODE のオン/オフ状態を管理するため、グローバル変数 isFillKeyMode を利用
    isFillKeyMode = false;
    // FILL-KEY ボタン（id="fillkey-mode-button"）を取得
    const fillKeyButton = document.getElementById('fillkey-mode-button');
    if (!fillKeyButton) {
        logInfo('[onair.js] FILL-KEY mode button not found.');
        return;
    }
    // SHIFT+ENTER キーによる誤動作を防止するため、キー操作イベントリスナーを登録
    fillKeyButton.addEventListener('keydown', (event) => {
        if (event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            logDebug('[onair.js] Prevented SHIFT+ENTER default behavior on FILL-KEY button.');
        }
    });
    // ボタンにクリックイベントリスナーを登録
    fillKeyButton.addEventListener('click', () => {
        if (!isFillKeyMode) {
            // モード有効化: FILL-KEY MODE ON
            isFillKeyMode = true;
            fillKeyButton.classList.add('button-green');
            fillKeyButton.style.backgroundColor = "";
            
            // カラーピッカーの値を取得（存在する場合）
            const colorPicker = document.getElementById('fillkey-color-picker');
            const selectedColor = colorPicker ? colorPicker.value : "#00FF00";

            // オンエア動画（id="on-air-video"）の背景色をカラーピッカー選択色に設定
            const onAirVideo = document.getElementById('on-air-video');
            if (onAirVideo) {
                onAirVideo.style.backgroundColor = selectedColor;
            }
            // フルスクリーン側に背景色変更のコマンドを送信
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

// FILLKEYモードの状態を onair.js 側に反映する関数
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
            // カラーピッカーの値を取得（存在する場合）
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
        updateFillKeyModeState();  // onair.js 側でモード切り替え（背景色の更新等）
        logDebug(`[onair.js] FillKey mode switched to: ${isFillKeyMode}`);
    }
});

window.electronAPI.ipcRenderer.on('clear-modes', (event, newFillKeyMode) => {
    logDebug('[onair.js] Received clear-modes notification with value:', newFillKeyMode);
    isFillKeyMode = newFillKeyMode;  // 解除状態（false）を適用
    updateFillKeyModeState();
    // フルスクリーン側にもフィルキー解除を伝える
    window.electronAPI.sendControlToFullscreen({ command: 'set-fillkey-bg', value: '' });
    logDebug('[onair.js] FillKey mode has been updated to:', isFillKeyMode);
});

// -----------------------
// ショートカットキー管理
// -----------------------

// モーダル状態の初期化（onair専用の名前に変更）
let isOnAirModalActive = false;

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

    switch (action) {
        case 'Escape': // ESCキー
            logDebug('[onair.js] Shortcut: ESC pressed.');
            onairHandleOffAirButton(); // オフエアボタンの処理を呼び出し
            break;

        case 'Space': // スペースキー
            logDebug('[onair.js] Shortcut: Space pressed.');
            if (onairIsPlaying) {
                onairHandlePauseButton(); // 一時停止
            } else {
                onairHandlePlayButton(); // 再生
            }
            break;

        case 'Ctrl+,': // CTRL + , (フェードイン)
            logDebug('[onair.js] Shortcut: CTRL+, (fade in) triggered.');
            document.getElementById('on-air-fi-button').click(); // フェードインボタンをクリック
            break;

        case 'Ctrl+.': // CTRL + . (フェードアウト)
            logDebug('[onair.js] Shortcut: CTRL+. (fade out) triggered.');
            document.getElementById('on-air-fo-button').click(); // フェードアウトボタンをクリック
            break;

        case 'Shift+Alt+F': // Shift + Alt + F で FILL-KEY モードをトグル
            logDebug('[onair.js] Shortcut: Shift+Alt+F triggered.');
            document.getElementById('fillkey-mode-button').click();
            break;

        case 'Shift+F': // Shift+F で FTB ボタンの処理を呼び出し
            logDebug('[onair.js] Shortcut: Shift+F triggered.');
            onairHandleFTBButton();
            break;

        default:
            logDebug(`[onair.js] Unknown shortcut: ${action}`);
            break;
    }
}

// キーボードショートカットの設定
document.addEventListener('keydown', (event) => {
    let action = null;

    // ショートカットキーの判定
    if (event.key.toLowerCase() === 'escape') {
        action = 'Escape';
    } else if (event.key === ' ') {
        action = 'Space';
    } else if (event.ctrlKey && event.key === '.') {
        action = 'Ctrl+,';
    } else if (event.ctrlKey && event.key === ',') {
        action = 'Ctrl+.';
    } else if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
        action = 'Shift+Alt+F';
    } else if (event.shiftKey && event.key.toLowerCase() === 'f') {
    
        action = 'Shift+F';
    }

    if (action) {
        handleShortcut(action);
        event.preventDefault(); // ショートカットキーのデフォルト動作を防止
    }
});

// メニューからショートカット通知を受信
window.electronAPI.onShortcutTrigger((event, action) => {
    logDebug(`[onair.js] Shortcut triggered from menu: ${action}`);
    handleShortcut(action);
});
