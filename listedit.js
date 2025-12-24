// -----------------------
//     listedit.js
//     ver 2.5.1
// -----------------------

// -----------------------
//     初期設定
// -----------------------

// グローバル変数
let controlButtons = {};
let inPoint = null;
let outPoint = null;
let isVideoLoaded = false;

// -----------------------
//     初期化
// -----------------------

document.addEventListener('DOMContentLoaded', () => {
    initializeEditArea();
});

// 初期化
function initializeEditArea() {
    const videoElement = document.getElementById('listedit-video');
    const filenameDisplay = document.getElementById('listedit-filename');
    const volumeMeterL = document.getElementById('listedit-volume-bar-L');
    const volumeMeterR = document.getElementById('listedit-volume-bar-R');
    const volumeSlider = document.getElementById('listedit-volume-slider'); 
    const volumeValue = document.getElementById('volume-value'); 
    const progressSlider = document.getElementById('progress-slider'); 
    const startTime = document.getElementById('start-time'); 
    const endTime = document.getElementById('end-time');
    const inPointTime = document.getElementById('in-point-time');
    const outPointTime = document.getElementById('out-point-time');
    const inPointButton = document.getElementById('in-point');
    const outPointButton = document.getElementById('out-point');
    const ftbRateInput = document.getElementById('ftbRate'); 
    const startFadeInInput = document.getElementById('startFadeInSec');
    const repeatCountInput = document.getElementById('repeatCount');
    const repeatInfinityCheckbox = document.getElementById('repeatInfinity');
    const repeatEndModeSelect = document.getElementById('end-repeat-endmode-select');
    const endGotoPlaylistSelect = document.getElementById('end-goto-playlist');
    const endGotoItemSelect = document.getElementById('end-goto-item');

    const startModeButtons = [
        document.getElementById('start-pause-button'),
        document.getElementById('start-play-button'),
        document.getElementById('start-fadein-button')
    ];
    
    const endModeButtons = [
        document.getElementById('end-off-button'),
        document.getElementById('end-pause-button'),
        document.getElementById('end-ftb-button'),
        document.getElementById('end-repeat-button'),
        document.getElementById('end-next-button'),
        document.getElementById('end-goto-button'),
    ];

    const inOutButtons = [
        document.getElementById('in-point-button'),
        document.getElementById('out-point-button')
    ];

    // ビデオ要素をリセット
    if (videoElement) {
        videoElement.pause(); 
        videoElement.src = "";
    }

    // ファイル名表示をクリア
    if (filenameDisplay) {
        filenameDisplay.textContent = "No file loaded";
    }

    // 音量メーターのリセット（L/R）
    [volumeMeterL, volumeMeterR].forEach(vm => {
        if (!vm) return;
        Array.from(vm.querySelectorAll('.volume-segment')).forEach(segment => {
            segment.style.backgroundColor = '#555'; 
            segment.style.boxShadow = 'none'; 
        });
    });

    // 音量スライダーの初期化
    if (volumeSlider && volumeValue) {
        const defaultVolume = 100;
        volumeSlider.value = defaultVolume;
        volumeValue.textContent = `${defaultVolume}%`;
    }

    // シークバーのリセット
    if (progressSlider && startTime && endTime) {
        progressSlider.value = 0; 
        progressSlider.max = 0; 
        progressSlider.step = "0.01";
        startTime.textContent = "00:00:00:00"; 
        endTime.textContent = "00:00:00:00"; 
    }

    // IN/OUT点のリセット
    if (inPointTime && outPointTime) {
    
        inPointTime.textContent = "00:00:00:00"; 
        outPointTime.textContent = "00:00:00:00"; 

        if (inPointButton) {
            inPointButton.classList.remove('button-green');
            inPointButton.classList.add('button-gray');
        }

        if (outPointButton) {
            outPointButton.classList.remove('button-green');
            outPointButton.classList.add('button-gray');
        }
    }

    // スタートモードのリセット
    if (startModeButtons.every(button => button)) {
        startModeButtons.forEach(button => {
            button.classList.remove('button-green'); 
            button.classList.add('button-gray');
        });
    }

    // エンドモードのリセット
    if (endModeButtons.every(button => button)) {
        endModeButtons.forEach(button => {
            button.classList.remove('button-green');
            button.classList.add('button-gray');
        });
    }

    // 再生コントロールボタンを取得
    const buttonIds = {
        play: 'play-button',
        pause: 'pause-button',
        rewindstart: 'rewind-start',
        rewind10x: 'rewind-10x',
        rewind5x: 'rewind-5x',
        fastForward5x: 'fast-forward-5x',
        fastForward10x: 'fast-forward-10x',
        fastForwardend: 'fast-forward-end',
    };

    controlButtons = Object.fromEntries(
        Object.entries(buttonIds).map(([key, id]) => [key, document.getElementById(id)])
    );

    if (!videoElement || !filenameDisplay || !volumeMeterL || !volumeMeterR || Object.values(controlButtons).some(button => !button)) {
        logInfo('[listedit.js] Edit area elements or control buttons not found.');
        return;
    }

    setupVideoPlayer(videoElement, filenameDisplay);
    setupPlaybackControls(videoElement);
    setupMouseWheelControl(videoElement);
    setupWheelOnInOutTimeFields(videoElement); 
    setupWheelOnInOutTimeFields(videoElement);
    setupVolumeMeterLR(videoElement, volumeMeterL, volumeMeterR);
    setupInOutPoints(videoElement);
    setupStartModeControls(videoElement);
    rebindEndModeControls(videoElement);
    setupFtbRate(ftbRateInput); 
    setupFtbRateListener(ftbRateInput);
    setupStartFadeInSecListener(startFadeInInput);
    setupRepeatConfigControls(repeatCountInput, repeatInfinityCheckbox, repeatEndModeSelect);
    setupGotoConfigControls(endGotoPlaylistSelect, endGotoItemSelect);
    setupVolumeControl();
    setVideoLoadedState(false);
}

// エンドモード系ボタンの安全な再バインド
function rebindEndModeControls(videoElement) {
    const ids = [
        'end-ftb-button',
        'end-next-button',
        'end-goto-button',
        'end-repeat-button',
        'end-off-button',
        'end-pause-button'
    ];

    ids.forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            const cloned = btn.cloneNode(true); // リスナを持たないクローン
            btn.replaceWith(cloned);
        }
    });
    // クリーンなボタンに対して改めてハンドラを登録
    setupEndModeControls(videoElement);
}

// 左ボタンの mousedown で即時反応させるボタンハンドラ
function attachImmediateButtonHandler(target, handler) {
    if (!target) return;
    target.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        handler();
    });
}
// -----------------------
//  動画プレーヤー初期化
// -----------------------

// 現在編集中のアイテムIDを保持する変数
let currentEditingItemId = null;

// 動画プレーヤーの初期化
function setupVideoPlayer(videoElement, filenameDisplay) {
    window.electronAPI.onUpdateEditState(async (itemData) => {
        if (!itemData || !itemData.playlistItem_id) {
            logInfo('[listedit.js] Invalid edit state data received.');
            filenameDisplay.textContent = 'No file loaded';
            videoElement.src = ''; 
            setVideoLoadedState(false); 
            return;
        }

        // 新たなアイテムに切り替える際に、前回のFTBレート値をリセット
        lastFtbRateUIValue = null;
        // 新たなアイテムに切り替える際に、前回の Start Fade-in 値のキャッシュもリセット
        lastStartFadeInUIValue = null;

        // 現在編集中のアイテムIDを記憶
        currentEditingItemId = itemData.playlistItem_id;

        // 別アイテム読み込み開始時点で、UIを一度初期化（前アイテムのGOTO表示が残るのを防ぐ）
        setVideoLoadedState(false);

        // ファイル名と動画パスを反映
        filenameDisplay.textContent = itemData.name || 'Unknown File';
        // UVCデバイス以外の場合、必ず安全なURLに変換してセットする
        if (typeof itemData.path === 'string' && !itemData.path.startsWith("UVC_DEVICE")) {
            videoElement.src = getSafeFileURL(itemData.path);
        } else {
            videoElement.src = itemData.path;
        }
        videoElement.load();

        // PFLがONなら、ソース切替直後に再バインドを仕込む
        if (isPFLActive) {
            await stopPFL();
            await rebindPFLToCurrentVideo();
        }

        videoElement.addEventListener('loadedmetadata', async () => {
            setVideoLoadedState(true); 

            // In/Out、StartMode、EndMode の初期値を設定
            const playlist = await stateControl.getPlaylistState();
            const updatedPlaylist = playlist.map(file => {
                if (file.playlistItem_id === currentEditingItemId) {
                    return {
                        ...file,
                        inPoint: file.inPoint || "00:00:00.00", 
                        outPoint: file.outPoint || formatTime(videoElement.duration),
                        startMode: file.startMode || "PAUSE",
                        endMode: file.endMode || "OFF",
                        defaultVolume: file.defaultVolume ?? 100,
                        startFadeInSec: (typeof file.startFadeInSec === 'number' && file.startFadeInSec >= 0)
                            ? parseFloat(file.startFadeInSec.toFixed(1))
                            : 1.0
                    };
                }
                return file;
            });
            
            await stateControl.setPlaylistState(updatedPlaylist);

            const currentItem = updatedPlaylist.find(file => file.playlistItem_id === currentEditingItemId);
            const startMode = currentItem?.startMode || "PAUSE";
            const endMode = currentItem?.endMode || "OFF";

            const volumeValueFromState = currentItem?.defaultVolume ?? 100;

            updateStartModeButtons(startMode);
            updateEndModeButtons(endMode);
            updateFtbButton(!!currentItem?.ftbEnabled);
            updateRepeatConfigUI();
            updateGotoConfigUI();

            // 音量の復元処理
            const volumeSlider = document.getElementById('listedit-volume-slider');
            const volumeValue = document.getElementById('volume-value');
            if (volumeSlider && volumeValue) {
                volumeSlider.value = volumeValueFromState;
                volumeValue.textContent = `${volumeValueFromState}%`;
                volumeSlider.style.setProperty('--value', `${volumeValueFromState}%`);
                volumeAdjustmentFactor = volumeValueFromState / 100;
            }

            // IN/OUT点の復元処理
            const inPointTime = document.getElementById('in-point-time');
            const outPointTime = document.getElementById('out-point-time');
            const inPointButton = document.getElementById('in-point');
            const outPointButton = document.getElementById('out-point');
            const defaultVolume = currentItem?.defaultVolume || 100;

            if (inPointTime && currentItem?.inPoint) {
                inPointTime.textContent = currentItem.inPoint;
                inPoint = parseTime(currentItem.inPoint); 
                updateButtonColor(inPointButton, inPoint > 0); 
                
                // シークバーをIN点の位置に進める
                videoElement.currentTime = inPoint;
            }
            if (outPointTime && currentItem?.outPoint) {
                outPointTime.textContent = currentItem.outPoint;
                outPoint = parseTime(currentItem.outPoint); // OUT点を状態に設定

                // OUT点が動画の長さと等しい場合、グレーにする
                const duration = parseFloat(videoElement.duration.toFixed(2)); 
                const isOutPointAtEnd = Math.abs(outPoint - duration) < 0.01;
                updateButtonColor(outPointButton, !isOutPointAtEnd);
            }

            // FTB Rate の UI を更新
            const ftbRateInput = document.getElementById('ftbRate');
            updateFtbRateUI(ftbRateInput);

            // Start Fade-in 秒数の UI を更新
            const startFadeInInput = document.getElementById('startFadeInSec');
            updateStartFadeInSecUI(startFadeInInput);

            // Repeat 回数・終了後エンドモードの UI を更新
            const repeatCountInput = document.getElementById('repeatCount');
            const repeatInfinityCheckbox = document.getElementById('repeatInfinity');
            const repeatEndModeSelect = document.getElementById('end-repeat-endmode-select');
            updateRepeatConfigUI(repeatCountInput, repeatInfinityCheckbox, repeatEndModeSelect);

            // INOUTマーカー位置を更新
            updateListeditSeekBarMarkers(inPoint, outPoint);
        });
    });
}

// INOUT状態の復元時にフォーマットされた時間を数値に変換
function parseTime(timeString) {
    if (typeof timeString !== 'string') {
        timeString = String(timeString);
    }
    const parts = timeString.split(/[:.]/);

    if (parts.length === 4) {
        const [hours, minutes, seconds, fractional] = parts.map(Number);
        return (hours * 3600) + (minutes * 60) + seconds + (fractional / 100);
    }
    return null; 
}

// 動画の読み込み状態を管理する関数
function setVideoLoadedState(loaded) {
    isVideoLoaded = loaded;
    updateUIForVideoState();
    updateRepeatConfigUI();
    updateGotoConfigUI();
}

// UIの状態を動画の読み込み状態に応じて更新する関数
function updateUIForVideoState() {

    if (!isVideoLoaded) {
        Object.values(controlButtons).forEach(button => {
            setButtonActive(button, false);
            button.classList.remove('button-green');
            button.classList.add('button-gray');
        });
        return;
    }

    const video = document.getElementById('listedit-video');
    if (!video) return;

    Object.values(controlButtons).forEach(button => {
        setButtonActive(button, true);
        button.classList.remove('button-green');
        button.classList.add('button-gray');
    });

    if (video.ended) {
        controlButtons.pause.classList.remove('button-gray');
        controlButtons.pause.classList.add('button-green');
    } else if (!video.paused) {
        controlButtons.play.classList.remove('button-gray');
        controlButtons.play.classList.add('button-green');
    } else {
        controlButtons.pause.classList.remove('button-gray');
        controlButtons.pause.classList.add('button-green');
    }
}

// ボタンの有効/無効を設定する関数
function setButtonActive(button, active) {
    if (active) {
        button.removeAttribute('disabled');
    } else {
        button.setAttribute('disabled', 'true');
    }
}

// -----------------------
// 再生コントロールの初期化
// -----------------------
function initializePlaybackControls(videoElement) {
    if (!videoElement) {
        logInfo("[listedit.js] Error: videoElement is not defined.");
        return;
    }
    setupPlaybackControls(videoElement);
    videoElement.addEventListener('loadeddata', () => {
        videoElement.pause();
        videoElement.currentTime = 0;
        isVideoLoaded = true;
        updateUIForVideoState();
    });
}

function handleEndedEvent() {
    const videoElement = document.getElementById('listedit-video');
    if (!videoElement) return;

    videoElement.pause(); 
    videoElement.currentTime = videoElement.duration;
    updateUIForVideoState();
}

// -----------------------
//  フェード時間の整合チェック
// -----------------------
let lastFadeDurationWarningAt = 0;

// フェード時間が尺を超える場合の警告メッセージ取得（ラベル未定義時はフォールバック）
function getFadeDurationWarningMessage() {
    if (typeof getMessage === 'function') {
        const m = getMessage('fade-duration-too-long');
        if (m && m !== 'fade-duration-too-long') {
            return m;
        }
    }
    return 'フェードイン＋フェードアウトの合計がクリップ長を超えています / Fade-in + fade-out exceed clip length';
}

// クリップ長とフェード時間の整合を確認し、違反時は警告を表示する
async function validateFadeDurationConstraint({ proposedStartFadeInSec = null, proposedFtbRate = null } = {}) {
    if (!isVideoLoaded || !currentEditingItemId) return { ok: true };

    const videoElement = document.getElementById('listedit-video') || document.getElementById('edit-video');
    const duration = (videoElement && typeof videoElement.duration === 'number' && isFinite(videoElement.duration))
        ? parseFloat(videoElement.duration.toFixed(2))
        : 0;

    const playlist = await stateControl.getPlaylistState();
    const currentItem = playlist.find(item => item.playlistItem_id === currentEditingItemId);
    if (!currentItem) return { ok: true };

    const inSec = (typeof inPoint === 'number')
        ? inPoint
        : (currentItem.inPoint ? parseTime(currentItem.inPoint) : 0);

    const outSec = (typeof outPoint === 'number')
        ? outPoint
        : (currentItem.outPoint ? parseTime(currentItem.outPoint) : duration);

    const clipLen = Math.max(0, outSec - inSec);

    const startMode = String(currentItem.startMode || 'PAUSE').toUpperCase();
    const ftbEnabled = Boolean(currentItem.ftbEnabled);

    const startFadeInSec = (typeof proposedStartFadeInSec === 'number')
        ? proposedStartFadeInSec
        : (typeof currentItem.startFadeInSec === 'number' ? currentItem.startFadeInSec : 1.0);

    const ftbRate = (typeof proposedFtbRate === 'number')
        ? proposedFtbRate
        : (typeof currentItem.ftbRate === 'number' ? currentItem.ftbRate : 1.0);

    const activeFadeIn = (startMode === 'FADEIN') ? startFadeInSec : 0;
    const activeFadeOut = (ftbEnabled) ? ftbRate : 0;
    const sumActive = activeFadeIn + activeFadeOut;

    const shouldCheck = (startMode === 'FADEIN') || ftbEnabled;

    if (shouldCheck && clipLen > 0 && clipLen < sumActive - 0.0001) {
        const now = Date.now();
        if (now - lastFadeDurationWarningAt > 800) {
            lastFadeDurationWarningAt = now;
            const msg = getFadeDurationWarningMessage();
            if (typeof showMessage === 'function') {
                showMessage(msg, 5000, 'alert');
            } else {
                alert(msg);
            }
        }
        return {
            ok: false,
            clipLen,
            startMode,
            ftbEnabled,
            startFadeInSec,
            ftbRate,
            currentItem
        };
    }

    return {
        ok: true,
        clipLen,
        startMode,
        ftbEnabled,
        startFadeInSec,
        ftbRate,
        currentItem
    };
}

// -----------------------
// 再生コントロール設定
// -----------------------
function setupPlaybackControls(videoElement) {
    const buttonIds = {
        play: 'play-button',
        pause: 'pause-button',
        rewindstart: 'rewind-start',
        rewind10x: 'rewind-10x',
        rewind5x: 'rewind-5x',
        fastForward5x: 'fast-forward-5x',
        fastForward10x: 'fast-forward-10x',
        fastForwardend: 'fast-forward-end',
    };
    controlButtons = Object.fromEntries(
        Object.entries(buttonIds).map(([key, id]) => [key, document.getElementById(id)])
    );

    const buttonActions = {
        rewind10x: -10,
        rewind5x: -5,
        fastForward5x: 5,
        fastForward10x: 10,
    };

    // 初期状態で全ボタンを無効化
    disableAllButtons(controlButtons); 

    // 再生ボタン
    attachImmediateButtonHandler(controlButtons.play, async () => {
        logOpe('[listedit.js] Play button clicked');

        if (videoElement.ended || (videoElement.currentTime >= videoElement.duration - 0.05)) {
            videoElement.pause();
            videoElement.currentTime = 0;
            videoElement.load();
        }

        try {
            const startVol = 0.001;
            videoElement.volume = startVol;
            await videoElement.play();
            await waitForPlaybackStable(videoElement, 30);
            isVideoLoaded = true;
            const targetVol = calcLinearVolumeFromSlider();
            await fadeVolume(videoElement, startVol, targetVol, 8);

            updateButtonStates({ play: true, pause: false });
            updateUIForVideoState();
        } catch (error) {
            logInfo("[listedit.js] Error during play button handling:", error);
        }
    });

    // 一時停止ボタン
    attachImmediateButtonHandler(controlButtons.pause, () => {
        if (videoElement.readyState < 2) {;
            return;
        }

        videoElement.pause();
        isVideoLoaded = true;
        updateButtonStates({ play: false, pause: true });
        updateUIForVideoState();
        logOpe("[listedit.js] Video is paused.");
    });

    // 初めに戻るボタン
    attachImmediateButtonHandler(controlButtons.rewindstart, () => {
        resetVideoIfEnded(videoElement);
        videoElement.currentTime = 0;
        videoElement.pause();
        updateButtonStates({ play: true, pause: false });
        logOpe("[listedit.js] Rewind start button clicked. Video reset to the start.");
    });

    // 最後に進むボタン
    attachImmediateButtonHandler(controlButtons.fastForwardend, () => {
        resetVideoIfEnded(videoElement);
        videoElement.currentTime = videoElement.duration;
        videoElement.pause();
        updateButtonStates({ play: true, pause: false });
        logOpe("[listedit.js] Fast forward end button clicked. Video set to the end.");
    });

    // 早送り・巻き戻しボタン
    Object.entries(buttonActions).forEach(([action, speed]) => {
        const button = controlButtons[action];
        if (!button) return;

        let interval;
        
        button.addEventListener('mousedown', (event) => {
            if (button.disabled) {
                return;
            }
            // 右クリックやホイールクリックの場合は無視（左=0）
            if (event.button !== 0) {
                return;
            }
            // 動画準備チェック
            if (videoElement.readyState < 2) {
                return;
            }
            
            // 終了状態の場合はリセット
            if (videoElement.duration > 0 && (videoElement.ended || (videoElement.currentTime >= videoElement.duration - 0.05))) {
                resetVideoIfEnded(videoElement);
            }

            // ボタンを緑に
            button.classList.add('button-green');
            button.classList.remove('button-gray');

            // 連続処理開始
            interval = setInterval(() => {
                const newTime = videoElement.currentTime + speed * 0.1;
                videoElement.currentTime = Math.max(0, Math.min(videoElement.duration, newTime));
            }, 100);
        });

        // ボタン上で離したら終了
        button.addEventListener('mouseup', (event) => {
            if (button.disabled) {
                return;
            }
            if (event.button !== 0) {
                return;
            }
            clearInterval(interval);
            interval = null;
            restorePlayPauseState(videoElement);
            logOpe(`[listedit.js] ${action} button released (mouse up).`);
        });

        // ボタン領域から出たら終了
        button.addEventListener('mouseleave', (event) => {
            if (button.disabled) {
                return;
            }
            clearInterval(interval);
            interval = null;
            restorePlayPauseState(videoElement);
        });
    });

    // 動画が終わった時の処理
    let isVideoHandlingEnded = false;

    videoElement.addEventListener('ended', (event) => {
        if (isVideoHandlingEnded) {
            return;
        }

        isVideoHandlingEnded = true;

        videoElement.currentTime = videoElement.duration;
        handleEndedEvent(event);
        updateUIForVideoState();

        setTimeout(() => {
            isVideoHandlingEnded = false;
        }, 100);
    });
}

// ボタンの状態管理
function updateButtonStates(states) {
    const buttonStates = {
        play: document.getElementById('play-button'),
        pause: document.getElementById('pause-button'),
    };

    Object.entries(buttonStates).forEach(([key, button]) => {
        const isActive = states[key];
        const hasGreenClass = button.classList.contains('button-green');
        const hasGrayClass = button.classList.contains('button-gray');
        const isDisabled = button.disabled;

        if (isActive && (!hasGreenClass || isDisabled)) {
            button.classList.add('button-green');
            button.classList.remove('button-gray');
            button.disabled = false;
        } else if (!isActive && (!hasGrayClass || !isDisabled)) {
            button.classList.remove('button-green');
            button.classList.add('button-gray');
            button.disabled = true;
        }
    });
}

function restorePlayPauseState(videoElement) {
    if (videoElement.paused) {
        updateButtonStates({ play: true, pause: false });
    } else {
        updateButtonStates({ play: false, pause: true });
    }
    isVideoLoaded = true;
    updateUIForVideoState();
}

function disableAllButtons(controlButtons) {
    Object.values(controlButtons).forEach(button => {
        if (button) {
            button.disabled = true;
            button.classList.remove('button-green');
            button.classList.add('button-gray');
        }
    });
}

function enableAllButtons(controlButtons) {
    Object.values(controlButtons).forEach(button => {
        if (button) {
            button.disabled = false;
            button.classList.remove('button-gray');
        }
    });
}

// マウスホイール操作とキーによるコマ送りの処理
function setupMouseWheelControl(videoElement) {
    // 動画要素をキーボード操作可能にするため tabindex を設定
    videoElement.tabIndex = 0;
    
    // マウスオン判定用フラグ
    let isMouseOverVideo = false;
    videoElement.addEventListener('mouseenter', () => {
        isMouseOverVideo = true;
    });
    videoElement.addEventListener('mouseleave', () => {
        isMouseOverVideo = false;
    });

    // ホイール操作によるシーク処理
    videoElement.addEventListener('wheel', (event) => {
        // 動画が読み込まれていない場合は操作を無効化
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Mouse wheel jog ignored because video is not loaded.');
            return;
        }

        event.preventDefault();
        const frameStep = 0.033;
        const delta = event.deltaY > 0 ? frameStep : -frameStep; // 下スクロールで進む、上スクロールで戻る
        const newTime = Math.max(0, Math.min(videoElement.duration, videoElement.currentTime + delta));
        videoElement.currentTime = newTime;

        logOpe('[listedit.js] Mouse wheel jog moved.');
    });
}

// 動画が終了状態の場合に内部状態をリセットするヘルパー
function resetVideoIfEnded(videoElement) {
    if (videoElement.duration > 0 && (videoElement.ended || (videoElement.currentTime >= videoElement.duration - 0.05))) {
        videoElement.pause();
        videoElement.currentTime = 0;
        videoElement.load();
        updateUIForVideoState();
        logOpe("[listedit.js] Video reset from ended state.");
    }
}

// -----------------------
//  再生安定待ち・フェード・音量変換
// -----------------------

// 再生開始直後の安定を待つ
function waitForPlaybackStable(video, waitMs = 30) {
    return new Promise((resolve) => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        const onPlaying = () => { video.removeEventListener('playing', onPlaying); done(); };
        const onTimeupdate = () => { video.removeEventListener('timeupdate', onTimeupdate); done(); };
        video.addEventListener('playing', onPlaying, { once: true });
        video.addEventListener('timeupdate', onTimeupdate, { once: true });
        setTimeout(done, waitMs);
    });
}

// 短フェード
function fadeVolume(video, from, to, durationMs = 8) {
    return new Promise((resolve) => {
        const start = performance.now();
        const step = () => {
            const t = performance.now() - start;
            const r = Math.min(1, t / durationMs);
            video.volume = from + (to - from) * r;
            if (r < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        };
        video.volume = from;
        requestAnimationFrame(step);
    });
}

function calcLinearVolumeFromSlider() {
    const slider = document.getElementById('listedit-volume-slider');
    if (!slider) return 0.001;
    const v = parseInt(slider.value, 10) || 0;
    if (v <= 0) return 0.001;
    const norm = v / 100;
    return Math.max(0.001, Math.pow(norm, 2.2));
}

// -----------------------
//  AudioContextManager
// -----------------------

// AudioContextManager シングルトン
const AudioContextManager = (function() {
    let audioContext = null;

    return {
        getContext: function() {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            return audioContext;
        },
        resetContext: function() {
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }
        }
    };
})();

// -----------------------
// 音声メーターリセット関数
// -----------------------
function resetVolumeMeter() {
    const volumeMeter = document.getElementById('listedit-volume-bar');
    if (!volumeMeter) return;

    Array.from(volumeMeter.querySelectorAll('.volume-segment')).forEach(segment => {
        segment.style.backgroundColor = '#555';
        segment.style.boxShadow = 'none';
    });
    logDebug('[listedit.js] Volume meter reset.');
}

// -----------------------
// 音声メーター更新関数
// -----------------------
function updateVolumeMeter(dbFS, sliderValue) {
    const volumeMeter = document.getElementById('listedit-volume-bar');
    if (!volumeMeter) return;
    updateVolumeMeterElement(volumeMeter, dbFS, sliderValue);
}

// 共通描画ロジック
function updateVolumeMeterElement(volumeMeterElement, dbFS, sliderValue) {
    if (!volumeMeterElement) return;

    const segments = Array.from(volumeMeterElement.querySelectorAll('.volume-segment'));
    const totalSegments = segments.length;

    // スライダーが 0 の場合 → 全消灯
    if (sliderValue === 0) {
        segments.forEach((segment) => {
            segment.style.backgroundColor = '#555';
            segment.style.boxShadow = 'none';
        });
        return;
    }

    // 無音 → 全消灯
    if (dbFS === -Infinity || dbFS < -100) {
        segments.forEach((segment) => {
            segment.style.backgroundColor = '#555';
            segment.style.boxShadow = 'none';
        });
        return;
    }

    // スライダー値正規化
    const sliderNormalized = sliderValue / 100;
    let adjustedDbFS = dbFS + 20 * Math.log10(sliderNormalized);

    // 表示レンジ
    if (adjustedDbFS > 0) adjustedDbFS = 0;
    if (adjustedDbFS < -60) adjustedDbFS = -60;
    const fillRatio = (adjustedDbFS + 60) / 60; // 0..1
    const activeSegments = Math.round(fillRatio * totalSegments);

    // 下=緑(-60～-18)／中=黄(-18～-6)／上=赤(-6～0)
    segments.forEach((segment, index) => {
        if (index >= totalSegments - activeSegments) {
            const posTopToBottom = index / (totalSegments - 1); // 0..1
            const segmentDb = 0 - posTopToBottom * 60;          // 0..-60

            if (segmentDb >= -9) {
                segment.style.backgroundColor = '#c05050';
                segment.style.boxShadow = '0 0 6px rgba(192, 80, 80, 0.6)';
            } else if (segmentDb >= -20) {
                segment.style.backgroundColor = 'rgb(210,160,120)';
                segment.style.boxShadow = '0 0 6px rgba(210, 160, 120, 0.6)';
            } else {
                segment.style.backgroundColor = 'rgb(90,130,90)';
                segment.style.boxShadow = '0 0 6px rgba(90, 130, 90, 0.6)';
            }
        } else {
            segment.style.backgroundColor = '#555';
            segment.style.boxShadow = 'none';
        }
    });
}

function updateVolumeMeterL(dbFS, sliderValue) {
    const el = document.getElementById('listedit-volume-bar-L');
    updateVolumeMeterElement(el, dbFS, sliderValue);
}
function updateVolumeMeterR(dbFS, sliderValue) {
    const el = document.getElementById('listedit-volume-bar-R');
    updateVolumeMeterElement(el, dbFS, sliderValue);
}

// -----------------------
// 音声メーターのセットアップ（LR）
// -----------------------
function setupVolumeMeterLR(videoElement, volumeMeterL, volumeMeterR) {
    let analyserL, analyserR, inputSourceNode, splitter, upmixNode;
    let animationFrameId = null;

    // 初期化
    function initVolumeMeter(el) {
        if (!el) return;
        el.innerHTML = '';
        for (let i = 0; i < 60; i++) {
            const segment = document.createElement('div');
            segment.classList.add('volume-segment');
            el.appendChild(segment);
        }
    }

    if (!volumeMeterL || !volumeMeterR) {
        logInfo('Volume meter elements (L/R) not found.');
        return;
    }
    initVolumeMeter(volumeMeterL);
    initVolumeMeter(volumeMeterR);
    logDebug('[listedit.js] Volume meter L/R initialized with 60 segments each.');

    function setupAudioContextLR() {
        const audioContext = AudioContextManager.getContext();

        // Analyser L/R
        if (!analyserL) {
            analyserL = audioContext.createAnalyser();
            analyserL.fftSize = 2048;
        }
        if (!analyserR) {
            analyserR = audioContext.createAnalyser();
            analyserR.fftSize = 2048;
        }

        if (!inputSourceNode || inputSourceNode.mediaElement !== videoElement) {
            if (inputSourceNode) {
                try { inputSourceNode.disconnect(); } catch (_) {}
            }
            if (splitter) {
                try { splitter.disconnect(); } catch (_) {}
            }
            if (upmixNode) {
                try { upmixNode.disconnect(); } catch (_) {}
            }

            try {
                inputSourceNode = audioContext.createMediaElementSource(videoElement);

                // モノ→ステレオアップミックス
                upmixNode = audioContext.createGain();
                upmixNode.channelCountMode = 'explicit';
                upmixNode.channelCount = 2;
                upmixNode.channelInterpretation = 'speakers';

                splitter = audioContext.createChannelSplitter(2);

                // input -> upmix(2ch) -> splitter -> analyserL/R
                inputSourceNode.connect(upmixNode);
                upmixNode.connect(splitter);
                splitter.connect(analyserL, 0);
                splitter.connect(analyserR, 1);
            } catch (error) {
                logInfo('Error setting up MediaElementSourceNode for LR:', error);
                return;
            }
        }

        if (!animationFrameId) {
            const timeDataL = new Float32Array(analyserL.fftSize);
            const timeDataR = new Float32Array(analyserR.fftSize);

            function render() {
                // L チャンネル
                analyserL.getFloatTimeDomainData(timeDataL);
                let peakL = 0.0;
                for (let i = 0; i < timeDataL.length; i++) {
                    const a = Math.abs(timeDataL[i]);
                    if (a > peakL) peakL = a;
                }
                const safeL = Math.max(peakL, 1e-9);
                const dbFSL = 20 * Math.log10(safeL);

                // R チャンネル
                analyserR.getFloatTimeDomainData(timeDataR);
                let peakR = 0.0;
                for (let i = 0; i < timeDataR.length; i++) {
                    const a = Math.abs(timeDataR[i]);
                    if (a > peakR) peakR = a;
                }
                const safeR = Math.max(peakR, 1e-9);
                const dbFSR = 20 * Math.log10(safeR);

                const sliderPct = (volumeAdjustmentFactor || 1) * 100;

                updateVolumeMeterElement(volumeMeterL, (peakL <= 1e-9 ? -Infinity : dbFSL), sliderPct);
                updateVolumeMeterElement(volumeMeterR, (peakR <= 1e-9 ? -Infinity : dbFSR), sliderPct);

                animationFrameId = requestAnimationFrame(render);
            }
            render();
        }
    }

    // イベントのセットアップ（LR）
    if (!setupVolumeMeterLR.initialized) {
        videoElement.addEventListener('play', setupAudioContextLR);
        videoElement.addEventListener('pause', () => {
            [volumeMeterL, volumeMeterR].forEach(el => {
                if (!el) return;
                Array.from(el.querySelectorAll('.volume-segment')).forEach(segment => {
                    segment.style.backgroundColor = '#555';
                    segment.style.boxShadow = 'none';
                });
            });
        });
        setupVolumeMeterLR.initialized = true;
        logDebug('[listedit.js] Audio context and volume meter LR setup complete (explicit upmix before split).');
    }
}

// -----------------------
// 再生時規定音量の設定
// -----------------------
function setupVolumeControl() {
    const volumeSlider = document.getElementById("listedit-volume-slider");
    const volumeValue = document.getElementById("volume-value");

    if (!volumeSlider || !volumeValue) {
        logInfo('[listedit.js] Volume slider or value display is missing.');
        return;
    }

    // カスタムプロパティ
    volumeSlider.style.setProperty('--value', `${volumeSlider.value}%`);

    volumeSlider.addEventListener("input", async () => {
        logOpe(`[listedit.js] Volume slider changed to ${volumeSlider.value}%`);
        const sliderValue = parseInt(volumeSlider.value, 10); 
        volumeSlider.style.setProperty('--value', `${volumeSlider.value}%`);

        // スライダー値を保持
        const sliderNormalizedValue = sliderValue / 100;

        // 実際の音量変換（対数スケール）
        const audioVolume = sliderValue === 0
            ? 0
            : Math.pow(sliderNormalizedValue, 2.2);

        // グローバル変数に保持
        volumeAdjustmentFactor = sliderNormalizedValue;

        // スライダー表示を更新
        updateVolumeDisplay(sliderValue);

        // 塗りの表示を更新
        volumeSlider.style.setProperty('--value', `${sliderValue}%`);

        // 再生中かどうか
        const isPlaying = checkIfPlaying(); 
        if (isPlaying) {
            const dbFS = sliderValue === 0 ? -Infinity : 0;
            updateVolumeMeterL(dbFS, sliderValue);
            updateVolumeMeterR(dbFS, sliderValue);
        } else {
            logInfo("[listedit.js] Volume slider adjusted, but playback is not active. Skipping meter update.");
        }

        // 音量状態更新
        const volumeToSend = sliderValue === 0 ? 0 : sliderValue;
        await updateVolumeState(volumeToSend);

        // 状態変更後通知
        window.electronAPI.notifyListeditUpdate();
    });

    // 音量スライダーで矢印キーの動作を無効化
    volumeSlider.addEventListener("keydown", function (event) {
        if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown"
        ) {
            event.preventDefault();
        }
    });
    logOpe("[listedit.js] Volume slider adjusted.");
}

// 再生状態をチェックする関数
function checkIfPlaying() {
    const videoElement = document.getElementById("listedit-video");
    if (!videoElement) {
        logInfo("[listedit.js] Video element not found.");
        return false;
    }
    return !videoElement.paused && !videoElement.ended;
}


// 音量の状態を更新
async function updateVolumeState(newVolume) {
    logOpe(`[listedit.js] updateVolumeState called with newVolume: ${newVolume}`);

    const adjustedVolume = newVolume === 0 ? 0 : newVolume;

    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(item => {
        if (item.playlistItem_id === currentEditingItemId) {
            return {
                ...item,
                defaultVolume: adjustedVolume,
            };
        }
        return item;
    });

    await stateControl.setPlaylistState(updatedPlaylist);

    // スライダーUIを更新
    updateVolumeDisplay(adjustedVolume);

    // 状態更新後に通知
    window.electronAPI.notifyListeditUpdate();
}

// スライダーの値をUIに反映
function updateVolumeDisplay(volume) {
    const volumeValue = document.getElementById("volume-value");
    const volumeSlider = document.getElementById("listedit-volume-slider");

    if (volumeValue && volumeSlider) {
        volumeSlider.value = volume;
        volumeValue.textContent = `${volume}%`;
    }
}

// -----------------------
// PFL機能
// -----------------------

// グローバル変数（AudioContext, hidden audio 要素）
let isPFLActive = false;
let pflAudioContext = null;
let pflAudioElement = null;
let pflBoundItemId = null;
let pflSelectedDeviceId = null;

// 要素取得
const pflButton = document.getElementById('pfl-button');
const videoElement = document.getElementById('listedit-video');

// PFL用AudioContext パイプライン初期化
async function startPFL(selectedDeviceId) {
    if (!videoElement || !videoElement.src) {
        logInfo('[listedit.js] PFL: Video element or source is not available.');
        return;
    }

    if (!videoElement.captureStream) {
        logInfo('[listedit.js] PFL: captureStream() is not supported.');
        return;
    }

    // 直近の選択デバイスを既定で再利用
    if (!selectedDeviceId && pflSelectedDeviceId) {
        selectedDeviceId = pflSelectedDeviceId;
    }

    try {
        const stream = videoElement.captureStream();
        if (stream.getAudioTracks().length === 0) {
            logInfo('[listedit.js] PFL: No audio track found in the video stream.');
            return;
        }

        pflAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = pflAudioContext.createMediaStreamSource(stream);
        const gainNode = pflAudioContext.createGain();
        gainNode.gain.value = 1.0;
        const dest = pflAudioContext.createMediaStreamDestination();
        source.connect(gainNode).connect(dest);

        if (!pflAudioElement) {
            pflAudioElement = document.createElement('audio');
            pflAudioElement.style.display = 'none';
            document.body.appendChild(pflAudioElement);
        }

        if (typeof pflAudioElement.setSinkId === 'function' && selectedDeviceId) {
            try {
                await pflAudioElement.setSinkId(selectedDeviceId);
                logInfo(`PFL: Successfully set sinkId (${selectedDeviceId}).`);
            } catch (err) {
                logInfo('[listedit.js] PFL: Failed to set sinkId:', err);
                showMessage(getMessage('failed-to-set-device'), 5000, 'alert');
                return;
            }
        }

        pflAudioElement.srcObject = dest.stream;
        await pflAudioElement.play();

        // 現在のアイテムとデバイスIDを記憶
        pflBoundItemId = currentEditingItemId || null;
        if (selectedDeviceId) {
            pflSelectedDeviceId = selectedDeviceId;
        }

        logInfo('[listedit.js] PFL monitoring started successfully.');
    } catch (error) {
        logInfo('[listedit.js] PFL: Monitoring failed:', error);
        showMessage(getMessage('monitoring-failed'), 5000, 'alert');
    }
}

// PFL の停止処理
async function stopPFL() {
    if (pflAudioElement) {
        pflAudioElement.pause();
        pflAudioElement.srcObject = null;
    }
    if (pflAudioContext) {
        await pflAudioContext.close();
        pflAudioContext = null;
    }
    logInfo('[listedit.js] PFL monitoring stoped');
}

// 現在の videoElement が再生可能になったタイミングでPFLを再開始
async function rebindPFLToCurrentVideo() {
    // video が再生準備できるまで待機（loadedmetadata または canplay のどちらか早い方）
    await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const onLoaded = () => { videoElement.removeEventListener('loadedmetadata', onLoaded); finish(); };
        const onCanplay = () => { videoElement.removeEventListener('canplay', onCanplay); finish(); };
        videoElement.addEventListener('loadedmetadata', onLoaded, { once: true });
        videoElement.addEventListener('canplay', onCanplay, { once: true });
        // 既に読み込み済みなら即時解決
        if (videoElement.readyState >= 1) {
            finish();
        }
    });

    if (isPFLActive) {
        logInfo('[listedit.js] Rebinding PFL to the new video source.');
        await startPFL(pflSelectedDeviceId);
    }
}

// PFL ボタン
if (pflButton && videoElement) {
    attachImmediateButtonHandler(pflButton, async () => {
        logOpe('[listedit.js] PFL button clicked');

        if (!isVideoLoaded) {
            showMessage(getMessage('no-video-loaded'), 5000, 'alert'); 
            return;
        }

        // メインプロセスからデバイス設定を取得
        const deviceSettings = await window.electronAPI.getDeviceSettings();
        const selectedDeviceId = deviceSettings.editAudioMonitorDevice;
        
        // デバイスが選択されていなければ、音声出力しない
        if (!selectedDeviceId) {
            showMessage(getMessage('no-pfl-device-selected'), 5000, 'alert');
            return;
        }

        // 利用可能なオーディオデバイスを取得
        const devices = await navigator.mediaDevices.enumerateDevices();
        const availableOutputDevices = devices.filter(device => device.kind === 'audiooutput');
        
        logInfo("[listedit.js] Available audio output devices:", availableOutputDevices.map(d => d.label || d.deviceId));

        // 選択されたデバイスが存在するか
        const isDeviceAvailable = availableOutputDevices.some(device => device.deviceId === selectedDeviceId);
        if (!isDeviceAvailable) {
            logInfo(`[listedit.js] PFL: Selected device (${selectedDeviceId}) is not available. PFL will not start.`);
            showMessage(getMessage('selected-device-not-found'), 5000, 'alert');
            return;
        }

        // PFLを開始または停止
        if (!isPFLActive) {
            try {
                await startPFL(selectedDeviceId);
                // 成功時のみ状態ON＋点灯
                isPFLActive = true;
                pflButton.classList.remove('button-gray');
                pflButton.classList.add('button-green');
            } catch (_) {
                // 失敗したらONにしない（見た目も変更しない）
                isPFLActive = false;
            }
        } else {
            // OFF操作
            await stopPFL();
            isPFLActive = false;
            pflButton.classList.remove('button-green');
            pflButton.classList.add('button-gray');
        }
    });
}

// 動画が再生状態になったとき（playing イベント）に、PFLがONでAudioContext未初期化
// または、現在のアイテムに未バインドの場合は再初期化
videoElement.addEventListener('playing', async () => {
    // 動画が終了状態の場合は、currentTimeをリセットしてから再初期化
    if (videoElement.ended) {
        videoElement.currentTime = 0;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (isPFLActive && (!pflAudioContext || pflBoundItemId !== currentEditingItemId)) {
        logInfo('[listedit.js] Video is playing: Reinitializing PFL (context missing or bound item changed)');
        await startPFL(pflSelectedDeviceId);
    }
});

// 動画終了時（ended イベント）に、AudioContext をリセットして再初期化
videoElement.addEventListener('ended', async () => {
    if (isPFLActive && pflAudioContext) {
        logInfo('[listedit.js] Video ended: Resetting PFL AudioContext');
        await stopPFL();
    }
});

// 動画ソース差し替え時などに発火する emptied でも念のためクリーンアップ
videoElement.addEventListener('emptied', async () => {
    if (isPFLActive && pflAudioContext) {
        logInfo('[listedit.js] Video emptied: Resetting PFL AudioContext');
        await stopPFL();
    }
});

// メインプロセスからデバイス設定変更の通知を受信し、PFLがONなら再初期化
window.electronAPI.ipcRenderer.on('device-settings-updated', async (event, newSettings) => {
    logInfo('[listedit.js] Device settings updated:', newSettings);
    if (isPFLActive) {
        await stopPFL();
        const newDeviceId = newSettings.editAudioMonitorDevice;
        if (!newDeviceId) {
            showMessage(getMessage('no-pfl-device-selected'), 5000, 'alert');
        } else {
            await startPFL(newDeviceId);
        }
    }
});

// -----------------------
// シークバー
// -----------------------

// シークバー（listedit 用）
document.addEventListener("DOMContentLoaded", function () {
    const video = document.getElementById("listedit-video");
    const progressSlider = document.getElementById("progress-slider");
    const startTime = document.getElementById("start-time");
    const endTime = document.getElementById("end-time");

    video.addEventListener("loadedmetadata", function () {
        const duration = video.duration;
        progressSlider.max = duration.toFixed(2);
        progressSlider.step = "0.01";
        progressSlider.value = 0;
        endTime.textContent = formatTime(duration);
        updateListeditSeekBarMarkers(inPoint, outPoint);
    });

    video.addEventListener("timeupdate", function () {
        const currentTime = video.currentTime;
        progressSlider.value = currentTime;
        startTime.textContent = formatTime(currentTime);
        updateListeditSeekBarMarkers(inPoint, outPoint);

        if (video.duration > 0 && currentTime >= video.duration - 0.05) {
            if (!video.ended) {
                video.pause();
                video.currentTime = video.duration;
                updateUIForVideoState();
            }
        }
    });

    progressSlider.addEventListener("input", function () {
        logOpe('[listedit.js] Seek bar value changed');
        resetVideoIfEnded(video);
        video.currentTime = parseFloat(progressSlider.value);
    });

    progressSlider.addEventListener("keydown", function (event) {
        logOpe(`[listedit.js] Seek bar keydown: ${event.key}`);
        if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown"
        ) {
            event.preventDefault();
        }
    });
    logOpe("[listedit.js] Seek bar operation completed.");
});

// UI表示用の時間フォーマット関数（hh:mm:ss形式）
function formatTimeForSeekbar(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// シークバー上に IN/OUT マーカーの位置を更新する関数
function updateListeditSeekBarMarkers(inPoint, outPoint) {
    const video = document.getElementById("listedit-video");
    const slider = document.getElementById("progress-slider");
    const inMarker = document.getElementById("listedit-in-marker");
    const outMarker = document.getElementById("listedit-out-marker");
    if (!video || !slider || !inMarker || !outMarker) return;
    
    // 動画が未読込の場合はマーカーを非表示
    if (!video.src || video.src.trim() === "" || video.readyState < 1 || video.duration <= 0) {
        inMarker.style.display = "none";
        outMarker.style.display = "none";
        return;
    }
    // 動画が正常にロードされている場合はマーカーを表示
    inMarker.style.display = "block";
    outMarker.style.display = "block";

    const container = slider.parentElement;
    if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
    }

    const duration = parseFloat(slider.max);
    if (!duration || duration <= 0) return;

    // シークバーの位置と幅
    const sliderRect = slider.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const sliderWidth = sliderRect.width;
    const sliderLeftOffset = sliderRect.left - containerRect.left;
    const inPositionRatio = inPoint / duration;
    const outPositionRatio = outPoint / duration;
    const inLeft = sliderLeftOffset + (inPositionRatio * sliderWidth);
    const outLeft = sliderLeftOffset + (outPositionRatio * sliderWidth);

    // マーカーの位置を設定
    inMarker.style.left = `${inLeft}px`;
    outMarker.style.left = `${outLeft - 5}px`;
}

// -----------------------
//  イン点、アウト点の処理
// -----------------------

// IN点OUT点ボタンの動作
function setupInOutPoints(videoElement) {
    const inPointButton = document.getElementById('in-point');
    const outPointButton = document.getElementById('out-point');

    // IN点ボタンの動作
    attachImmediateButtonHandler(inPointButton, async () => {
        logOpe('[listedit.js] In point button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] In point button pressed but video is not loaded.');
            return;
        }

        const currentTime = parseFloat(videoElement.currentTime.toFixed(2));

        // 現在地が0の場合にグレーに戻す
        if (currentTime === 0) {
            await updateInOutPoint('inPoint', 0);
            updateButtonColor(inPointButton, false);
            return;
        }
        
        // すでにOUT点が設定されている場合、currentTimeがOUT点以上ならエラー表示
        if (outPoint !== null && currentTime >= outPoint) {
            showMessage(getMessage('in-before-out'), 5000, 'alert');
            return;
        }

        // IN点を新たに設定
        await updateInOutPoint('inPoint', currentTime);
        updateButtonColor(inPointButton, true); // ボタンを緑に更新
    });

    // OUT点ボタンの動作
    attachImmediateButtonHandler(outPointButton, async () => {
        logOpe('[listedit.js] Out point button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Out point button pressed but video is not loaded.');
            return;
        }

        const currentTime = parseFloat(videoElement.currentTime.toFixed(2)); 
        const duration = parseFloat(videoElement.duration.toFixed(2)); 

        // 動作条件: 現在地が動画の長さの場合にグレーに戻す
        if (Math.abs(currentTime - duration) < 0.01) {
            await updateInOutPoint('outPoint', duration);
            updateButtonColor(outPointButton, false);
            return;
        }
        
        // 追加チェック: すでにIN点が設定されている場合、currentTimeがIN点以下ならエラー表示
        if (inPoint !== null && currentTime <= inPoint) {
            showMessage(getMessage('out-after-in'), 5000, 'alert');
            return;
        }

        // OUT点を新たに設定
        await updateInOutPoint('outPoint', currentTime);
        updateButtonColor(outPointButton, true);
    });
}

// IN/OUTの時間表示（#in-point-time / #out-point-time）上でのホイール操作
function setupWheelOnInOutTimeFields(videoElement) {
    const inPointTimeEl  = document.getElementById('in-point-time');
    const outPointTimeEl = document.getElementById('out-point-time');
    const inPointButton  = document.getElementById('in-point');
    const outPointButton = document.getElementById('out-point');
    const frameStep = 0.033;

    // --- 初期色の正規化 ---
    (function normalizeInitialButtonColors() {
        const duration = (typeof videoElement.duration === 'number' && isFinite(videoElement.duration))
            ? videoElement.duration
            : 0;
        const EPS = 0.02;

        if (inPointButton) {
            const isInDefault = (typeof inPoint === 'number') ? (Math.abs(inPoint - 0) <= EPS) : true;
            updateButtonColor(inPointButton, !isInDefault);
        }
        if (outPointButton) {
            const isOutDefault = (typeof outPoint === 'number' && duration > 0)
                ? (Math.abs(outPoint - duration) <= EPS)
                : true; // duration不明時は消灯
            updateButtonColor(outPointButton, !isOutDefault);
        }
    })();

    async function onWheel(pointType, event) {
        if (!isVideoLoaded) return;

        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault(); // ページスクロール抑止
        }

        const duration = (typeof videoElement.duration === 'number' && isFinite(videoElement.duration))
            ? parseFloat(videoElement.duration.toFixed(2))
            : 0;

        let base = (pointType === 'inPoint')
            ? (inPoint != null ? parseFloat(Number(inPoint).toFixed(2)) : 0)
            : (outPoint != null ? parseFloat(Number(outPoint).toFixed(2)) : duration);

        const delta = (event && event.deltaY > 0) ? frameStep : -frameStep;
        let newTime = parseFloat((base + delta).toFixed(3));

        // 範囲クランプ
        newTime = Math.max(0, Math.min(duration, parseFloat(newTime.toFixed(2))));

        // 整合性チェック
        if (pointType === 'inPoint') {
            if (outPoint != null && newTime >= outPoint) {
                showMessage(getMessage('in-before-out'), 3000, 'alert');
                return;
            }
        } else { // outPoint
            if (inPoint != null && newTime <= inPoint) {
                showMessage(getMessage('out-after-in'), 3000, 'alert');
                return;
            }
        }

        // 状態更新（UI/プレイリスト/マーカー更新は関数内で実施）
        await updateInOutPoint(pointType, newTime);

        // 動画の現在位置も寄せる
        videoElement.currentTime = newTime;

        // ボタン色の最終更新（「既定値なら消灯、変更なら点灯」）
        const EPS = 0.02;
        const nowIn  = (pointType === 'inPoint')  ? newTime : (typeof inPoint  === 'number' ? inPoint  : 0);
        const nowOut = (pointType === 'outPoint') ? newTime : (typeof outPoint === 'number' ? outPoint : duration);

        const inIsDefault  = (Math.abs(nowIn - 0) <= EPS);
        const outIsDefault = (duration > 0) ? (Math.abs(nowOut - duration) <= EPS) : true;

        if (inPointButton)  updateButtonColor(inPointButton,  !inIsDefault);
        if (outPointButton) updateButtonColor(outPointButton, !outIsDefault);
    }

    if (inPointTimeEl) {
        inPointTimeEl.addEventListener('wheel', (e) => onWheel('inPoint', e), { passive: false });
    }
    if (outPointTimeEl) {
        outPointTimeEl.addEventListener('wheel', (e) => onWheel('outPoint', e), { passive: false });
    }
}

// ボタン色を更新する関数
function updateButtonColor(button, isChanged) {
    if (isChanged) {
        button.classList.add('button-green');
        button.classList.remove('button-gray');
    } else {
        button.classList.add('button-gray');
        button.classList.remove('button-green');
    }
}

// IN点OUT点UIの更新
function updateInOutPointUI(pointType, newTime) {
    const targetElement = document.getElementById(pointType === 'inPoint' ? 'in-point-time' : 'out-point-time');
    if (targetElement) {
        const formattedTime = formatTime(newTime);
        targetElement.textContent = formattedTime;
    }
}

// IN点OUT点のデータ処理
async function updateInOutPoint(pointType, newTime) {
    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(file => {
        if (file.playlistItem_id === currentEditingItemId) {
            return {
                ...file,
                [pointType]: formatTime(newTime),
            };
        }
        return file;
    });

    await stateControl.setPlaylistState(updatedPlaylist);

    // UI更新
    updateInOutPointUI(pointType, newTime);
    if (pointType === 'inPoint') {
        inPoint = newTime;
    } else if (pointType === 'outPoint') {
        outPoint = newTime;
    }
    logOpe(`[listedit.js] ${pointType} updated to: ${newTime.toFixed(2)} seconds`);
    window.electronAPI.notifyListeditUpdate();
    updateListeditSeekBarMarkers(inPoint, outPoint);
    await validateFadeDurationConstraint();
}

// 時間フォーマット関数（小数点以下2桁の秒数形式）
function formatTime(duration) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.floor(duration % 60);
    const fractionalSeconds = (duration % 1).toFixed(2).substring(1); // 小数点以下2桁
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${fractionalSeconds}`;
}

// 数値を2桁にパディング
function pad(number) {
    return number.toString().padStart(2, '0');
}

// -----------------------
//  スタートモードの処理
// -----------------------
function setupStartModeControls(videoElement) {
    const startModePauseButton = document.getElementById('start-pause-button');
    const startModePlayButton = document.getElementById('start-play-button');
    const startModeFadeinButton = document.getElementById('start-fadein-button');

    if (!startModePauseButton || !startModePlayButton || !startModeFadeinButton) {
        logInfo('[listedit.js] One or more Start mode buttons not found.');
        return;
    }

    attachImmediateButtonHandler(startModePauseButton, async () => {
        logOpe('[listedit.js] Start mode PAUSE button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Start mode PAUSE button pressed but video is not loaded.');
            return;
        }
        await updateStartModeState("PAUSE");
    });

    attachImmediateButtonHandler(startModePlayButton, async () => {
        logOpe('[listedit.js] Start mode PLAY button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Start mode PLAY button pressed but video is not loaded.');
            return;
        }
        await updateStartModeState("PLAY");
    });

    attachImmediateButtonHandler(startModeFadeinButton, async () => {
        logOpe('[listedit.js] Start mode FADEIN button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Start mode FADEIN button pressed but video is not loaded.');
            return;
        }
        await updateStartModeState("FADEIN");
    });
}

// startModeを更新してstatecontrolに反映
async function updateStartModeState(newMode) {
    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(file => {
        if (file.playlistItem_id === currentEditingItemId) {
            return {
                ...file,
                startMode: newMode
            };
        }
        return file;
    });
    await stateControl.setPlaylistState(updatedPlaylist);

    updateStartModeButtons(newMode);
    await validateFadeDurationConstraint();
    window.electronAPI.notifyListeditUpdate();
}

// startModeに応じてボタンのアクティブ状態を更新
function updateStartModeButtons(mode) {
    const startModePauseButton = document.getElementById('start-pause-button');
    const startModePlayButton = document.getElementById('start-play-button');
    const startModeFadeinButton = document.getElementById('start-fadein-button');

    if (!startModePauseButton || !startModePlayButton || !startModeFadeinButton) {
        return;
    }

    // まずは全ボタンからbutton-greenを外す
    startModePauseButton.classList.remove('button-green');
    startModePlayButton.classList.remove('button-green');
    startModeFadeinButton.classList.remove('button-green');

    // 選択されたモードに応じて対象のボタンにbutton-greenを付与する
    if (mode === "PAUSE") {
        startModePauseButton.classList.add('button-green');
    } else if (mode === "PLAY") {
        startModePlayButton.classList.add('button-green');
    } else if (mode === "FADEIN") {
        startModeFadeinButton.classList.add('button-green');
    }
}

// -----------------------
//  エンドモードの処理
// -----------------------
function setupEndModeControls(videoElement) {
    // EndModeの排他セット（FTBは含めない）
    const modeButtons = {
        OFF: document.getElementById('end-off-button'),
        PAUSE: document.getElementById('end-pause-button'),
        REPEAT: document.getElementById('end-repeat-button'),
        NEXT: document.getElementById('end-next-button'),
    };
    const gotoButton = document.getElementById('end-goto-button');
    if (gotoButton) {
        modeButtons.GOTO = gotoButton;
    }
    // FTBは独立トグル
    const ftbButton = document.getElementById('end-ftb-button');

    if (Object.values(modeButtons).some(button => !button) || !ftbButton) {
        logInfo('[listedit.js] One or more END MODE buttons are missing.');
        return;
    }

    // EndMode排他セット
    Object.entries(modeButtons).forEach(([mode, button]) => {
        attachImmediateButtonHandler(button, () => {
            logOpe(`[listedit.js] End mode ${mode} button clicked`);
            if (!isVideoLoaded) {
                logInfo(`[listedit.js] End mode ${mode} button pressed but video is not loaded.`);
                return;
            }
            updateEndModeState(mode);
        });
    });

    // FTBはトグル（EndModeと共存）
    attachImmediateButtonHandler(ftbButton, async () => {
        logOpe('[listedit.js] FTB toggle button clicked');
        if (!isVideoLoaded) {
            logInfo('[listedit.js] FTB toggle pressed but video is not loaded.');
            return;
        }

        const playlist = await stateControl.getPlaylistState();
        let nextFtb = null;

        const updatedPlaylist = playlist.map(file => {
            if (file.playlistItem_id === currentEditingItemId) {
                nextFtb = !Boolean(file.ftbEnabled);
                // ① 視覚フィードバックを即時に出す（state 反映前でも点灯させる）
                updateFtbButton(nextFtb);
                return { ...file, ftbEnabled: nextFtb };
            }
            return file;
        });

        // state 反映（非同期）
        await stateControl.setPlaylistState(updatedPlaylist);

        // 念のため最終状態で再同期（UIはすでに切替済みなので薄い処理）
        const currentItem = updatedPlaylist.find(f => f.playlistItem_id === currentEditingItemId);
        if (typeof currentItem?.ftbEnabled !== 'undefined') {
            updateFtbButton(Boolean(currentItem.ftbEnabled));
        }

        // 通知（従来と同じ）
        await validateFadeDurationConstraint();
        window.electronAPI.notifyListeditUpdate();
    });
}

// END MODEの状態を更新
async function updateEndModeState(newMode) {

    // 動画未ロード時は制御不可
    if (!isVideoLoaded || !currentEditingItemId) {
        updateRepeatConfigUI();
        updateGotoConfigUI();
        return;
    }

    const playlist = await stateControl.getPlaylistState();
    logOpe('[listedit.js] updateEndModeState called with newMode:', newMode);

    // REPEATに切り替えた最初のタイミングで、リピート設定のデフォルトを作る
    if (newMode === 'REPEAT'
        && typeof stateControl.getRepeatConfigForItem === 'function'
        && typeof stateControl.setRepeatConfigForItem === 'function') {

        const cfg = stateControl.getRepeatConfigForItem(currentEditingItemId) || {};
        if (typeof cfg.repeatCount === 'undefined' && typeof cfg.repeatEndMode === 'undefined') {
            stateControl.setRepeatConfigForItem(currentEditingItemId, undefined, 'PAUSE');
        } else if (typeof cfg.repeatEndMode === 'undefined') {
            stateControl.setRepeatConfigForItem(currentEditingItemId, cfg.repeatCount, 'PAUSE');
        }
    }

    // GOTOに切り替えた最初のタイミングで、GOTO設定のデフォルトを作る
    let gotoDefaults = null;
    if (newMode === 'GOTO') {
        const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);
        if (currentItem) {
            gotoDefaults = getDefaultGotoConfigForItem(currentItem);
        }
    }

    const updatedPlaylist = playlist.map(file => {
        if (file.playlistItem_id === currentEditingItemId) {

            const updated = {
                ...file,
                endMode: newMode
            };

            if (newMode === 'GOTO' && gotoDefaults) {
                updated.endGotoPlaylist = gotoDefaults.endGotoPlaylist;
                updated.endGotoItemId = gotoDefaults.endGotoItemId;
            }

            return updated;
        }
        return file;
    });
    await stateControl.setPlaylistState(updatedPlaylist);
    updateEndModeButtons(newMode);
    updateRepeatConfigUI();
    updateGotoConfigUI();
    await validateFadeDurationConstraint();

    // 状態更新後通知
    window.electronAPI.notifyListeditUpdate();
}

// ボタンのアクティブ状態更新
function updateEndModeButtons(activeMode) {
    const buttons = document.querySelectorAll('#end-mode-area .button');
    buttons.forEach(button => {
        const mode = button.id.replace('end-', '').replace('-button', '').toUpperCase();

        // FTBは排他ハイライトの対象外（専用関数で制御）
        if (mode === 'FTB') {
            return;
        }

        if (mode === activeMode) {
            button.classList.remove('button-gray');
            button.classList.add('button-green');
        } else {
            button.classList.remove('button-green');
            button.classList.add('button-gray');
        }
    });
}

// FTBトグルの見た目更新（ON: 緑 / OFF: 灰）
function updateFtbButton(enabled) {
    const ftbBtn = document.getElementById('end-ftb-button');
    if (!ftbBtn) return;
    if (enabled) {
        ftbBtn.classList.remove('button-gray');
        ftbBtn.classList.add('button-green');
    } else {
        ftbBtn.classList.remove('button-green');
        ftbBtn.classList.add('button-gray');
    }
}

// --------------------------------
//  REPEAT回数 / 指定回数終了時のエンドモード
// --------------------------------

let isRepeatConfigUIUpdating = false;

function getRepeatConfigUIElements() {
    return {
        repeatCountInput: document.getElementById('repeatCount'),
        repeatInfinityCheckbox: document.getElementById('repeatInfinity'),
        repeatEndModeSelect: document.getElementById('end-repeat-endmode-select'),
    };
}

function setupRepeatConfigControls(repeatCountInput, repeatInfinityCheckbox, repeatEndModeSelect) {
    if (!repeatCountInput || !repeatInfinityCheckbox || !repeatEndModeSelect) {
        return;
    }

    // 起動時ディフォルト：∞はOFF（リピートボタンを押した時にONへ）
    repeatCountInput.value = '';
    repeatInfinityCheckbox.checked = false;
    repeatEndModeSelect.value = 'PAUSE';

    // 未ロード時は操作不可
    repeatCountInput.disabled = true;
    repeatInfinityCheckbox.disabled = true;
    repeatEndModeSelect.disabled = true;


    repeatInfinityCheckbox.addEventListener('change', async () => {
        if (isRepeatConfigUIUpdating) return;

        // 未ロード・未選択時は制御不可
        if (!isVideoLoaded || !currentEditingItemId) {
            updateRepeatConfigUI();
            return;
        }

        const playlist = await stateControl.getPlaylistState();
        const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);
        if (!currentItem || currentItem.endMode !== 'REPEAT') {
            updateRepeatConfigUI();
            return;
        }

        isRepeatConfigUIUpdating = true;
        try {
            const repeatEndMode = repeatEndModeSelect.value || 'PAUSE';

            if (repeatInfinityCheckbox.checked) {
                repeatCountInput.value = '';
                repeatCountInput.disabled = true;
                await stateControl.setRepeatConfigForItem(currentEditingItemId, undefined, repeatEndMode);
                logOpe(`[listedit.js] Repeat config changed: infinity=ON, endMode=${repeatEndMode}`);
            } else {
                let val = parseInt(repeatCountInput.value, 10);
                if (!Number.isFinite(val) || val < 1) val = 1;
                repeatCountInput.value = String(val);
                repeatCountInput.disabled = false;
                await stateControl.setRepeatConfigForItem(currentEditingItemId, val, repeatEndMode);
                logOpe(`[listedit.js] Repeat config changed: count=${val}, endMode=${repeatEndMode}`);
            }
        } finally {
            isRepeatConfigUIUpdating = false;
        }

        window.electronAPI.notifyListeditUpdate();
        updateRepeatConfigUI();
    });

    repeatCountInput.addEventListener('input', () => {
        if (repeatCountInput.value === '') return;
        const n = parseInt(repeatCountInput.value, 10);
        if (Number.isFinite(n) && n >= 1) {
            repeatInfinityCheckbox.checked = false;
        }
    });

    repeatCountInput.addEventListener('change', async () => {
        if (isRepeatConfigUIUpdating) return;

        if (!isVideoLoaded || !currentEditingItemId) {
            updateRepeatConfigUI();
            return;
        }

        const playlist = await stateControl.getPlaylistState();
        const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);
        if (!currentItem || currentItem.endMode !== 'REPEAT') {
            updateRepeatConfigUI();
            return;
        }

        isRepeatConfigUIUpdating = true;
        try {
            const repeatEndMode = repeatEndModeSelect.value || 'PAUSE';
            let val = parseInt(repeatCountInput.value, 10);

            if (!Number.isFinite(val) || val < 1) {
                // 数値が不正なら∞に戻す（排他）
                repeatCountInput.value = '';
                repeatInfinityCheckbox.checked = true;
                repeatCountInput.disabled = true;
                await stateControl.setRepeatConfigForItem(currentEditingItemId, undefined, repeatEndMode);
            } else {
                repeatInfinityCheckbox.checked = false;
                repeatCountInput.value = String(val);
                repeatCountInput.disabled = false;
                await stateControl.setRepeatConfigForItem(currentEditingItemId, val, repeatEndMode);
            }
        } finally {
            isRepeatConfigUIUpdating = false;
        }

        window.electronAPI.notifyListeditUpdate();
        updateRepeatConfigUI();
    });

    repeatEndModeSelect.addEventListener('change', async () => {
        if (isRepeatConfigUIUpdating) return;

        if (!isVideoLoaded || !currentEditingItemId) {
            updateRepeatConfigUI();
            return;
        }

        const playlist = await stateControl.getPlaylistState();
        const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);
        if (!currentItem || currentItem.endMode !== 'REPEAT') {
            updateRepeatConfigUI();
            return;
        }

        isRepeatConfigUIUpdating = true;
        try {
            const repeatEndMode = repeatEndModeSelect.value || 'PAUSE';
            let repeatCount = undefined;

            if (!repeatInfinityCheckbox.checked) {
                let val = parseInt(repeatCountInput.value, 10);
                if (!Number.isFinite(val) || val < 1) val = 1;
                repeatCountInput.value = String(val);
                repeatCount = val;
            } else {
                repeatCountInput.value = '';
            }

            await stateControl.setRepeatConfigForItem(currentEditingItemId, repeatCount, repeatEndMode);
        } finally {
            isRepeatConfigUIUpdating = false;
        }

        window.electronAPI.notifyListeditUpdate();
        updateRepeatConfigUI();
    });

    updateRepeatConfigUI();
}

async function updateRepeatConfigUI() {
    const { repeatCountInput, repeatInfinityCheckbox, repeatEndModeSelect } = getRepeatConfigUIElements();
    if (!repeatCountInput || !repeatInfinityCheckbox || !repeatEndModeSelect) return;
    if (isRepeatConfigUIUpdating) return;

    // 未ロード・未選択時は操作不可 + 起動時ディフォルト表示
    if (!isVideoLoaded || !currentEditingItemId) {
        repeatCountInput.value = '';
        repeatInfinityCheckbox.checked = false;
        repeatEndModeSelect.value = 'PAUSE';

        repeatCountInput.disabled = true;
        repeatInfinityCheckbox.disabled = true;
        repeatEndModeSelect.disabled = true;
        return;
    }

    const playlist = await stateControl.getPlaylistState();
    const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);

    // エンドモードがREPEAT以外は操作不可（表示はニュートラル）
    if (!currentItem || currentItem.endMode !== 'REPEAT') {
        repeatCountInput.value = '';
        repeatInfinityCheckbox.checked = false;
        repeatEndModeSelect.value = 'PAUSE';

        repeatCountInput.disabled = true;
        repeatInfinityCheckbox.disabled = true;
        repeatEndModeSelect.disabled = true;
        return;
    }

    const cfg = (typeof stateControl.getRepeatConfigForItem === 'function')
        ? stateControl.getRepeatConfigForItem(currentEditingItemId)
        : { repeatCount: undefined, repeatEndMode: undefined };

    const repeatEndMode = cfg.repeatEndMode || 'PAUSE';
    repeatEndModeSelect.value = repeatEndMode;

    if (cfg.repeatCount === undefined || cfg.repeatCount === null) {
        repeatInfinityCheckbox.checked = true;
        repeatCountInput.value = '';
        repeatCountInput.disabled = true;
    } else {
        repeatInfinityCheckbox.checked = false;
        repeatCountInput.value = String(cfg.repeatCount);
        repeatCountInput.disabled = false;
    }

    repeatInfinityCheckbox.disabled = false;
    repeatEndModeSelect.disabled = false;
}

// -----------------------
//  GOTO 設定UI
// -----------------------
let isGotoConfigUIUpdating = false;

function readSavedPlaylistsForGoto() {
    const saved = [];
    for (let i = 1; i <= 9; i++) {
        try {
            const raw = localStorage.getItem(`vtrpon_playlist_store_${i}`);
            if (!raw) {
                continue;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.data)) {
                continue;
            }

            // アイテムが1件以上あるプレイリストのみ候補にする
            const items = parsed.data
                .slice()
                .filter(it => it && typeof it === 'object'); // 念のためnull等を除外

            if (!items || items.length === 0) {
                continue;
            }

            items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            saved.push({ slot: i, name: parsed.name || `Playlist ${i}`, items });
        } catch (e) {
            // ignore
        }
    }
    return saved;
}

// updateEndModeState() からも呼ばれる（function宣言なので巻き上げされる）
function getDefaultGotoConfigForItem(item) {
    const saved = readSavedPlaylistsForGoto();
    if (!saved || saved.length === 0) {
        return { endGotoPlaylist: undefined, endGotoItemId: undefined, items: [] };
    }

    let slot = parseInt(item?.endGotoPlaylist, 10);
    if (!Number.isFinite(slot) || !saved.some(pl => pl.slot === slot)) {
        slot = saved[0].slot;
    }

    const target = saved.find(pl => pl.slot === slot);
    const items = target ? target.items : [];
    if (!items || items.length === 0) {
        return { endGotoPlaylist: slot, endGotoItemId: undefined, items: [] };
    }

    let itemId = item?.endGotoItemId;
    if (typeof itemId !== 'string' || !items.some(it => it.playlistItem_id === itemId)) {
        itemId = items[0].playlistItem_id;
    }

    return { endGotoPlaylist: slot, endGotoItemId: itemId, items };
}

function setupGotoConfigControls(endGotoPlaylistSelect, endGotoItemSelect) {
    if (!endGotoPlaylistSelect || !endGotoItemSelect) {
        return;
    }

    const refreshLater = (tries = 0) => {
        if (!isGotoConfigUIUpdating) {
            updateGotoConfigUI();
            return;
        }
        if (tries >= 9) {
            return;
        }
        setTimeout(() => refreshLater(tries + 1), 0);
    };

    const handleOpen = () => {
        if (isGotoConfigUIUpdating) {
            setTimeout(() => {
                if (!isGotoConfigUIUpdating) {
                    updateGotoConfigUI();
                }
            }, 0);
            return;
        }
        updateGotoConfigUI();
    };

    const handleKeyOpen = (event) => {
        if (!event) {
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            handleOpen();
        }
    };

    // プルダウンを開く瞬間に毎回ストレージを読み直して最新の候補を反映する
    endGotoPlaylistSelect.addEventListener('mousedown', handleOpen);
    endGotoPlaylistSelect.addEventListener('click', handleOpen);
    endGotoPlaylistSelect.addEventListener('focus', handleOpen);
    endGotoPlaylistSelect.addEventListener('keydown', handleKeyOpen);

    endGotoItemSelect.addEventListener('mousedown', handleOpen);
    endGotoItemSelect.addEventListener('click', handleOpen);
    endGotoItemSelect.addEventListener('focus', handleOpen);
    endGotoItemSelect.addEventListener('keydown', handleKeyOpen);

    endGotoPlaylistSelect.addEventListener('change', async () => {
        if (isGotoConfigUIUpdating || !isVideoLoaded || !currentEditingItemId) {
            return;
        }
        const slot = parseInt(endGotoPlaylistSelect.value, 10);
        if (!Number.isFinite(slot)) {
            return;
        }

        const saved = readSavedPlaylistsForGoto();
        const target = saved.find(pl => pl.slot === slot);
        const firstItemId = (target && target.items && target.items.length > 0) ? target.items[0].playlistItem_id : undefined;

        if (typeof stateControl.setGotoConfigForItem === 'function') {
            stateControl.setGotoConfigForItem(currentEditingItemId, slot, firstItemId);
        } else if (typeof stateControl.setPlaylistState === 'function' && typeof stateControl.getPlaylistState === 'function') {
            const current = stateControl.getPlaylistState();
            const updated = current.map(file => {
                if (file.playlistItem_id === currentEditingItemId) {
                    return {
                        ...file,
                        endGotoPlaylist: slot,
                        endGotoItemId: firstItemId,
                    };
                }
                return file;
            });
            await stateControl.setPlaylistState(updated);
        }

        updateGotoConfigUI();
        window.electronAPI.notifyListeditUpdate();
    });

    endGotoItemSelect.addEventListener('change', async () => {
        if (isGotoConfigUIUpdating || !isVideoLoaded || !currentEditingItemId) {
            return;
        }
        const slot = parseInt(endGotoPlaylistSelect.value, 10);
        if (!Number.isFinite(slot)) {
            return;
        }
        const itemId = endGotoItemSelect.value || undefined;

        if (typeof stateControl.setGotoConfigForItem === 'function') {
            stateControl.setGotoConfigForItem(currentEditingItemId, slot, itemId);
        } else if (typeof stateControl.setPlaylistState === 'function' && typeof stateControl.getPlaylistState === 'function') {
            const current = stateControl.getPlaylistState();
            const updated = current.map(file => {
                if (file.playlistItem_id === currentEditingItemId) {
                    return {
                        ...file,
                        endGotoPlaylist: slot,
                        endGotoItemId: itemId,
                    };
                }
                return file;
            });
            await stateControl.setPlaylistState(updated);
        }

        updateGotoConfigUI();
        window.electronAPI.notifyListeditUpdate();
    });
    updateGotoConfigUI();
}

function updateGotoConfigUI() {
    const endGotoPlaylistSelect = document.getElementById('end-goto-playlist');
    const endGotoItemSelect = document.getElementById('end-goto-item');
    if (!endGotoPlaylistSelect || !endGotoItemSelect) {
        return;
    }

    // 動画未ロード時は操作不可（グレーアウト）
    if (!isVideoLoaded || !currentEditingItemId) {
        endGotoPlaylistSelect.innerHTML = '';
        endGotoItemSelect.innerHTML = '';

        const optPl = document.createElement('option');
        optPl.value = '';
        optPl.textContent = '(No saved playlists)';
        endGotoPlaylistSelect.appendChild(optPl);

        const optIt = document.createElement('option');
        optIt.value = '';
        optIt.textContent = '(No items)';
        endGotoItemSelect.appendChild(optIt);

        endGotoPlaylistSelect.disabled = true;
        endGotoItemSelect.disabled = true;
        return;
    }

    const playlist = stateControl.getPlaylistState();
    const currentItem = playlist.find(file => file.playlistItem_id === currentEditingItemId);

    // エンドモードがGOTO以外は操作不可（グレーアウト）
    if (!currentItem || currentItem.endMode !== 'GOTO') {
        endGotoPlaylistSelect.innerHTML = '';
        endGotoItemSelect.innerHTML = '';
        endGotoPlaylistSelect.disabled = true;
        endGotoItemSelect.disabled = true;
        return;
    }

    isGotoConfigUIUpdating = true;
    try {
        const saved = readSavedPlaylistsForGoto();
        const defaults = getDefaultGotoConfigForItem(currentItem);

        // playlist
        endGotoPlaylistSelect.innerHTML = '';
        if (!saved || saved.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(No saved playlists)';
            endGotoPlaylistSelect.appendChild(opt);
        } else {
            saved.forEach(pl => {
                const opt = document.createElement('option');
                opt.value = String(pl.slot);
                opt.textContent = `${pl.slot}: ${pl.name}`;
                endGotoPlaylistSelect.appendChild(opt);
            });
            endGotoPlaylistSelect.value = String(defaults.endGotoPlaylist);
        }

        // items
        endGotoItemSelect.innerHTML = '';
        const items = defaults.items || [];
        if (!items || items.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(No items)';
            endGotoItemSelect.appendChild(opt);
        } else {
            items.forEach((item, idx) => {
                const opt = document.createElement('option');
                const itemId = item.playlistItem_id;
                opt.value = itemId ? String(itemId) : '';
                const orderNumber = (typeof item.order === 'number') ? (item.order + 1) : (idx + 1);
                const itemName = item.name || item.path || 'Untitled';
                opt.textContent = `${orderNumber}: ${itemName}`;
                endGotoItemSelect.appendChild(opt);
            });
            endGotoItemSelect.value = defaults.endGotoItemId ? String(defaults.endGotoItemId) : '';
        }

        if (!saved || saved.length === 0) {
            endGotoPlaylistSelect.disabled = true;
            endGotoItemSelect.disabled = true;
            return;
        }

        endGotoPlaylistSelect.disabled = false;
        endGotoItemSelect.disabled = (items.length === 0);

        // 旧データ（GOTO設定なし）でもクラッシュしないよう、未設定の場合のみデフォルトを確定させる
        const isUnset = (
            typeof currentItem.endGotoPlaylist === 'undefined' ||
            typeof currentItem.endGotoItemId === 'undefined'
        );
        if (isUnset) {
            if (typeof stateControl.setGotoConfigForItem === 'function') {
                stateControl.setGotoConfigForItem(currentEditingItemId, defaults.endGotoPlaylist, defaults.endGotoItemId);
            } else if (typeof stateControl.setPlaylistState === 'function' && typeof stateControl.getPlaylistState === 'function') {
                const current = stateControl.getPlaylistState();
                const updated = current.map(file => {
                    if (file.playlistItem_id === currentEditingItemId) {
                        return {
                            ...file,
                            endGotoPlaylist: defaults.endGotoPlaylist,
                            endGotoItemId: defaults.endGotoItemId,
                        };
                    }
                    return file;
                });
                stateControl.setPlaylistState(updated);
            }
        }

    } finally {
        isGotoConfigUIUpdating = false;
    }
}

// -----------------------
//  FTBレートの設定
// -----------------------

// FTBレートの初期化
function setupFtbRate(ftbRateInput) {
    if (!ftbRateInput) {
        logInfo('[listedit.js] FTB Rate input element not found.');
        return;
    }

    const playlist = stateControl.getPlaylistState();
    const currentItem = playlist.find(item => item.playlistItem_id === currentEditingItemId);

    // プレイリストの値をUIに反映（小数点以下1桁で表示）
    ftbRateInput.value = currentItem?.ftbRate?.toFixed(1) || '1.0';
}

// FTBレートのイベントリスナー
function setupFtbRateListener(ftbRateInput) {
    if (!ftbRateInput) {
        return;
    }

    // FTBレート変更イベントの設定（未ロード時は無効）
    ftbRateInput.addEventListener('input', async (event) => {
        if (!isVideoLoaded || !currentEditingItemId) {
            // エディットエリア未ロード時は変更を受け付けない
            logInfo('[listedit.js] FTB Rate change ignored because no item is loaded.');
            return;
        }

        let newRate = parseFloat(event.target.value);
        if (isNaN(newRate) || newRate < 0) {
            ftbRateInput.value = '1.0';
            return;
        }
        // 小数1桁に丸め
        newRate = parseFloat(newRate.toFixed(1));

        // フェード長の整合チェック（必要時は上限クランプ）
        const fadeCheck = await validateFadeDurationConstraint({ proposedFtbRate: newRate });
        if (!fadeCheck.ok && fadeCheck.ftbEnabled) {
            let maxAllowed = fadeCheck.clipLen;
            if (fadeCheck.startMode === 'FADEIN') {
                const inFade = (typeof fadeCheck.currentItem?.startFadeInSec === 'number')
                    ? fadeCheck.currentItem.startFadeInSec
                    : 1.0;
                maxAllowed -= inFade;
            }
            if (maxAllowed < 0) maxAllowed = 0;
            maxAllowed = parseFloat(maxAllowed.toFixed(1));
            if (newRate > maxAllowed) {
                newRate = maxAllowed;
                ftbRateInput.value = newRate.toFixed(1);
                logInfo(`[listedit.js] FTB Rate clamped to ${newRate.toFixed(1)} due to clip length.`);
            }
        }

        logOpe(`[listedit.js] FTB Rate updated to: ${newRate.toFixed(1)}`);

        // プレイリスト状態の更新
        const playlist = await stateControl.getPlaylistState();
        const updatedPlaylist = playlist.map(item => {
            if (item.playlistItem_id === currentEditingItemId) {
                return {
                    ...item,
                    ftbRate: parseFloat(newRate.toFixed(1)),
                };
            }
            return item;
        });

        await stateControl.setPlaylistState(updatedPlaylist);
        window.electronAPI.notifyListeditUpdate();
    });
}

// 前回UIに反映したFTBレート値を保持する変数
let lastFtbRateUIValue = null;

// FTBレートのUI更新
function updateFtbRateUI(ftbRateInput) {
    if (!ftbRateInput) {
        logInfo('[listedit.js] FTB Rate input element not found.');
        return;
    }

    // プレイリストを取得
    const playlist = stateControl.getPlaylistState();

    const currentItem = playlist.find(item => item.playlistItem_id === currentEditingItemId);

    // 新しい値を一時的に保持
    let newValue;
    if (currentItem && typeof currentItem.ftbRate !== 'undefined') {
        newValue = currentItem.ftbRate.toFixed(1);
    } else {
        newValue = '1.0';
    }

    // 前回と同じ値ならログを出さずにスキップ
    if (newValue === lastFtbRateUIValue) {
        return;
    }
    lastFtbRateUIValue = newValue;
    ftbRateInput.value = newValue;

    logOpe(`[listedit.js] FTB Rate UI updated: ${newValue}`);
}

// --------------------------------
//  Start Fade-in 秒数の設定
// --------------------------------

// 前回UIに反映した Start Fade-in 値
let lastStartFadeInUIValue = null;

// Start Fade-in 初期化（プレイリスト値→UI）
function setupStartFadeInSec(startFadeInInput) {
    if (!startFadeInInput) {
        logInfo('[listedit.js] Start Fade-in input element not found.');
        return;
    }
    const playlist = stateControl.getPlaylistState();
    const currentItem = playlist.find(item => item.playlistItem_id === currentEditingItemId);
    // 小数1桁表示、既定は 1.0 秒
    startFadeInInput.value = currentItem?.startFadeInSec?.toFixed(1) || '1.0';
}

// Start Fade-in 入力のイベントリスナー（UI→プレイリスト値保存）
function setupStartFadeInSecListener(startFadeInInput) {
    if (!startFadeInInput) return;

    startFadeInInput.addEventListener('input', async (event) => {
        if (!isVideoLoaded || !currentEditingItemId) {
            // エディットエリア未ロード時は変更を受け付けない
            logInfo('[listedit.js] Start Fade-in change ignored because no item is loaded.');
            return;
        }

        let sec = parseFloat(event.target.value);
        if (isNaN(sec) || sec < 0) {
            startFadeInInput.value = '1.0';
            sec = 1.0;
        }
        // 小数1桁に丸め
        sec = parseFloat(sec.toFixed(1));

        // フェード長の整合チェック（必要時は上限クランプ）
        const fadeCheck = await validateFadeDurationConstraint({ proposedStartFadeInSec: sec });
        if (!fadeCheck.ok && fadeCheck.startMode === 'FADEIN') {
            let maxAllowed = fadeCheck.clipLen;
            if (fadeCheck.ftbEnabled) {
                const outFade = (typeof fadeCheck.currentItem?.ftbRate === 'number')
                    ? fadeCheck.currentItem.ftbRate
                    : 1.0;
                maxAllowed -= outFade;
            }
            if (maxAllowed < 0) maxAllowed = 0;
            maxAllowed = parseFloat(maxAllowed.toFixed(1));
            if (sec > maxAllowed) {
                sec = maxAllowed;
                startFadeInInput.value = sec.toFixed(1);
                logInfo(`[listedit.js] Start Fade-in seconds clamped to ${sec.toFixed(1)} due to clip length.`);
            }
        }

        logOpe(`[listedit.js] Start Fade-in seconds updated to: ${sec.toFixed(1)}`);

        const playlist = await stateControl.getPlaylistState();
        const updated = playlist.map(item => {
            if (item.playlistItem_id === currentEditingItemId) {
                return { ...item, startFadeInSec: sec };
            }
            return item;
        });
        await stateControl.setPlaylistState(updated);
        window.electronAPI.notifyListeditUpdate();
    });
}

// Start Fade-in の UI をプレイリスト値で更新
function updateStartFadeInSecUI(startFadeInInput) {
    if (!startFadeInInput) {
        logInfo('[listedit.js] Start Fade-in input element not found.');
        return;
    }
    const playlist = stateControl.getPlaylistState();
    const currentItem = playlist.find(item => item.playlistItem_id === currentEditingItemId);

    let newValue = '1.0';
    if (currentItem && typeof currentItem.startFadeInSec !== 'undefined') {
        newValue = currentItem.startFadeInSec.toFixed(1);
    }

    if (newValue === lastStartFadeInUIValue) {
        return; // 同一値なら更新不要
    }
    lastStartFadeInUIValue = newValue;
    startFadeInInput.value = newValue;

    logOpe(`[listedit.js] Start Fade-in UI updated: ${newValue}`);
}

// アイテムの ftbRate / startFadeInSec をリセットするヘルパー
async function resetFadeParamsForCurrentItem() {
    if (!currentEditingItemId) {
        logInfo('[listedit.js] No currentEditingItemId. Skip resetting fade params.');
        return;
    }
    const playlist = await stateControl.getPlaylistState();
    const updated = playlist.map(item => {
        if (item.playlistItem_id === currentEditingItemId) {
            return {
                ...item,
                ftbRate: 1.0,
                startFadeInSec: 1.0,
            };
        }
        return item;
    });
    await stateControl.setPlaylistState(updated);

    // UI要素もあれば既定表示へ
    const ftbRateInput = document.getElementById('ftbRate');
    if (ftbRateInput) ftbRateInput.value = '1.0';
    const startFadeInInput = document.getElementById('startFadeInSec');
    if (startFadeInInput) startFadeInInput.value = '1.0';

    logOpe('[listedit.js] Reset ftbRate and startFadeInSec to defaults (1.0).');
}

// --------------------------------
//  キーボードショートカット
// --------------------------------

// ショートカットからボタンの mousedown を発火させるユーティリティ
function triggerMouseDownById(id, logMessage) {
    const btn = document.getElementById(id);
    if (!btn) {
        logInfo(`[listedit.js] Button not found for shortcut. id=${id}`);
        return;
    }
    const mouseDownEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
    });
    btn.dispatchEvent(mouseDownEvent);
    if (logMessage) {
        logOpe(logMessage);
    }
}

function triggerMouseDownOnElement(el, logMessage) {
    if (!el) return;
    const mouseDownEvent = new MouseEvent('mousedown', {
        button: 0,
        bubbles: true,
        cancelable: true
    });
    el.dispatchEvent(mouseDownEvent);
    if (logMessage) {
        logOpe(logMessage);
    }
}

async function handleShortcutAction(action) {
    switch (action) {
        case 'reset-edit-area':
            logOpe("[listedit.js] Reset Edit Area triggered.");
            if (isPFLActive) {
                await stopPFL();
                isPFLActive = false;
                if (pflButton) {
                    pflButton.classList.remove('button-green');
                    pflButton.classList.add('button-gray');
                }
            }
            await resetFadeParamsForCurrentItem();
            await clearPlaylistSelection();
            window.electronAPI.notifyListeditUpdate();
            disableAllButtons(controlButtons);
            setVideoLoadedState(false);
            initializeEditArea();
            break;
        case 'in-point':
            triggerMouseDownById(
                'in-point',
                '[listedit.js] IN point button triggered via shortcut (synthetic mousedown).'
            );
            break;
        case 'out-point':
            triggerMouseDownById(
                'out-point',
                '[listedit.js] OUT point button triggered via shortcut (synthetic mousedown).'
            );
            break;
        case 'toggle-start-mode': {
            const startPause = document.getElementById('start-pause-button');
            const startPlay = document.getElementById('start-play-button');
            const startFadein = document.getElementById('start-fadein-button');
            if (startPause && startPlay && startFadein) {
                if (startPause.classList.contains('button-green')) {
                    // PAUSE → PLAY
                    triggerMouseDownOnElement(
                        startPlay,
                        '[listedit.js] Start mode toggled to PLAY (synthetic mousedown).'
                    );
                } else if (startPlay.classList.contains('button-green')) {
                    // PLAY → FADEIN
                    triggerMouseDownOnElement(
                        startFadein,
                        '[listedit.js] Start mode toggled to FADEIN (synthetic mousedown).'
                    );
                } else {
                    // FADEIN（またはどれもアクティブでない状態） → PAUSE
                    triggerMouseDownOnElement(
                        startPause,
                        '[listedit.js] Start mode toggled to PAUSE (synthetic mousedown).'
                    );
                }
            }
            break;
        }
        case 'end-mode-off':
            triggerMouseDownById(
                'end-off-button',
                '[listedit.js] End mode OFF triggered via shortcut (synthetic mousedown).'
            );
            break;
        case 'end-mode-pause':
            triggerMouseDownById(
                'end-pause-button',
                '[listedit.js] End mode PAUSE triggered via shortcut (synthetic mousedown).'
            );
            break;
        case 'end-mode-ftb':
            triggerMouseDownById(
                'end-ftb-button',
                '[listedit.js] FTB flag toggled via shortcut (synthetic mousedown).'
            );
            break;
        case 'end-mode-repeat':
            triggerMouseDownById(
                'end-repeat-button',
                '[listedit.js] End mode REPEAT triggered via shortcut (synthetic mousedown).'
            );
            break;
        case 'end-mode-next':
            triggerMouseDownById(
                'end-next-button',
                '[listedit.js] End mode NEXT triggered via shortcut (synthetic mousedown).'
            );
            break;
        default:
            logInfo(`[listedit.js] Unknown action: ${action}`);
    }
}

document.addEventListener('keydown', (event) => {
    // モーダルや入力フィールドがアクティブな場合は処理しない
    const modal = document.getElementById('playlist-name-modal');
    if (modal && !modal.classList.contains('hidden')) return;
    const activeElement = document.activeElement;
    if (activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.isContentEditable
        )) return;

    // キーコードと修飾キーを取得
    const code = event.code;
    const isAlt = event.altKey;
    const isCmd = event.metaKey;
    const isWinAlt = isAlt && !isCmd;
    const isMacOptCmd = isAlt && isCmd;

    // Windows の Alt+X または macOS の Cmd+Option+X
    if (isWinAlt || isMacOptCmd) {
        // IN 点設定 (Alt+I / Cmd+Option+I)
        if (code === 'KeyI') {
            event.preventDefault();
            handleShortcutAction('in-point');
            return;
        }
        // OUT 点設定 / End OFF (Alt+O / Cmd+Option+O)
        if (code === 'KeyO') {
            event.preventDefault();
            if (event.shiftKey) {
                handleShortcutAction('out-point');
            } else {
                handleShortcutAction('end-mode-off');
            }
            return;
        }
        // Start モード切替 (Alt+S / Cmd+Option+S)
        if (code === 'KeyS') {
            event.preventDefault();
            handleShortcutAction('toggle-start-mode');
            logOpe('[listedit.js] Alt+S or Cmd+Opt+S triggered.');
            return;
        }
        // End PAUSE (Alt+P / Cmd+Option+P)
        if (code === 'KeyP') {
            event.preventDefault();
            handleShortcutAction('end-mode-pause');
            return;
        }
        // End FTB (Alt+F / Cmd+Option+F)
        if (code === 'KeyF') {
            event.preventDefault();
            handleShortcutAction('end-mode-ftb');
            return;
        }
        // End REPEAT (Alt+R / Cmd+Option+R)
        if (code === 'KeyR') {
            event.preventDefault();
            handleShortcutAction('end-mode-repeat');
            return;
        }
        // End NEXT (Alt+N / Cmd+Option+N)
        if (code === 'KeyN') {
            event.preventDefault();
            handleShortcutAction('end-mode-next');
            return;
        }
    } else {
        // 修飾キー未押下時のショートカット
        if (code === 'ArrowRight') {
            // 右矢印でエディットエリアリセット
            event.preventDefault();
            event.stopPropagation();
            handleShortcutAction('reset-edit-area');
        } else if (code === 'Semicolon') {
            // ; / : による1コマ送り・戻し
            // Ctrl / Alt / Cmd が付いている場合は無視
            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            const videoElement = document.getElementById('edit-video');
            if (!videoElement || isNaN(videoElement.duration)) {
                return;
            }

            // 例として 1/100 秒を 1コマとみなす
            const frameDuration = 1 / 100;

            if (event.shiftKey) {
                // Shift+; → ":" 相当 → 1コマ送り
                event.preventDefault();
                event.stopPropagation();
                const newTime = Math.min(
                    videoElement.duration,
                    videoElement.currentTime + frameDuration
                );
                videoElement.currentTime = newTime;
                logOpe('[listedit.js] Frame forward via ":" (Semicolon+Shift) shortcut.');
            } else {
                // ; → 1コマ戻し
                event.preventDefault();
                event.stopPropagation();
                const newTime = Math.max(
                    0,
                    videoElement.currentTime - frameDuration
                );
                videoElement.currentTime = newTime;
                logOpe('[listedit.js] Frame backward via ";" (Semicolon) shortcut.');
            }
        }
    }
});

// 「set-ftb-enabled」を受信してUIと内部状態を同期
window.electronAPI.onShortcutTrigger((_, action, payload) => {
    if (action !== 'set-ftb-enabled') return;

    const btn = document.getElementById('end-ftb-button');
    if (!btn) {
        logInfo('[listedit.js] end-ftb-button not found. Cannot apply FTB flag.');
        return;
    }
    const wantEnabled = !!(payload && payload.enabled);
    const isEnabledNow = btn.classList.contains('button-green'); // FTB ON 表示判定（あなたのUIルールに合わせる）

    // 期待状態と不一致のときのみ mousedown で既存トグル処理を呼び出す
    if (wantEnabled !== isEnabledNow) {
        triggerMouseDownOnElement(
            btn,
            `[listedit.js] FTB flag ${wantEnabled ? 'ENABLED' : 'DISABLED'} via menu (synced, synthetic mousedown).`
        );
    } else {
        logDebug('[listedit.js] FTB flag already in desired state. No action.');
    }
});

// 右矢印キーによるエディットエリアリセット時に、プレイリストの選択状態も解除
async function clearPlaylistSelection() {
    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(item => ({
        ...item,
        selectionState: "unselected",
        editingState: null
    }));
    await stateControl.setPlaylistState(updatedPlaylist);
    logOpe('[listedit.js] Cleared playlist selection.');
}

// メニューからのショートカット通知
window.electronAPI?.onShortcutTrigger((event, action) => {
    handleShortcutAction(action);
});
