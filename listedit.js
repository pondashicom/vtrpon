// -----------------------
//     listedit.js
//     ver 2.2.7
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
    const volumeMeter = document.getElementById('listedit-volume-bar');
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

    // 音量メーターのリセット
    if (volumeMeter) {
        Array.from(volumeMeter.querySelectorAll('.volume-segment')).forEach(segment => {
            segment.style.backgroundColor = '#555'; 
            segment.style.boxShadow = 'none'; 
        });
    }

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

    if (!videoElement || !filenameDisplay || !volumeMeter || Object.values(controlButtons).some(button => !button)) {
        logInfo('[listedit.js] Edit area elements or control buttons not found.');
        return;
    }

    setupVideoPlayer(videoElement, filenameDisplay);
    setupPlaybackControls(videoElement);
    setupMouseWheelControl(videoElement);
    setupVolumeMeter(videoElement, volumeMeter);
    setupInOutPoints(videoElement);
    setupStartModeControls(videoElement);
    setupEndModeControls(videoElement);
    setupFtbRate(ftbRateInput); 
    setupFtbRateListener(ftbRateInput);
    setupVolumeControl();
    setVideoLoadedState(false);
}

// -----------------------
//  動画プレーヤー初期化
// -----------------------

// 現在編集中のアイテムIDを保持する変数
let currentEditingItemId = null;

// 動画プレーヤーの初期化
function setupVideoPlayer(videoElement, filenameDisplay) {
    window.electronAPI.onUpdateEditState((itemData) => {
        if (!itemData || !itemData.playlistItem_id) {
            logInfo('[listedit.js] Invalid edit state data received.');
            filenameDisplay.textContent = 'No file loaded';
            videoElement.src = ''; 
            setVideoLoadedState(false); 
            return;
        }

        // 新たなアイテムに切り替える際に、前回のFTBレート値をリセット
        lastFtbRateUIValue = null;

        // 現在編集中のアイテムIDを記憶
        currentEditingItemId = itemData.playlistItem_id;

        // ファイル名と動画パスを反映
        filenameDisplay.textContent = itemData.name || 'Unknown File';
        // UVCデバイス以外の場合、必ず安全なURLに変換してセットする
        if (typeof itemData.path === 'string' && !itemData.path.startsWith("UVC_DEVICE")) {
            videoElement.src = getSafeFileURL(itemData.path);
        } else {
            videoElement.src = itemData.path;
        }
        videoElement.load();

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
                        defaultVolume: file.defaultVolume ?? 100
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
    controlButtons.play?.addEventListener('click', async () => {
        if (videoElement.ended || (videoElement.currentTime >= videoElement.duration - 0.05)) {
            videoElement.pause();
            videoElement.currentTime = 0;
            videoElement.load();
        }
        try {
            await videoElement.play();
            isVideoLoaded = true;
            updateButtonStates({ play: true, pause: false });
            updateUIForVideoState();
        } catch (error) {
            logInfo("[listedit.js] Error during play button handling:", error);
        }
    });

    // 一時停止ボタン
    controlButtons.pause?.addEventListener('click', () => {
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
    controlButtons.rewindstart?.addEventListener('click', () => {
        resetVideoIfEnded(videoElement);
        videoElement.currentTime = 0;
        videoElement.pause();
        updateButtonStates({ play: true, pause: false });
        logOpe("[listedit.js] Rewind start button clicked. Video reset to the start.");
    });

    // 最後に進むボタン
    controlButtons.fastForwardend?.addEventListener('click', () => {
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

    // ホイール操作によるシーク処理（既存）
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

    // キーボードによる1コマ送り／戻し処理（動画上にマウスが乗っている場合のみ有効）
    videoElement.addEventListener('keydown', (event) => {
        // マウスオンでなければ処理しない
        if (!isMouseOverVideo) return;

        // 例として30fpsの場合の1コマの秒数
        const frameDuration = 1 / 100;
        if (event.key === ':') {
            event.preventDefault();
            const newTime = Math.min(videoElement.duration, videoElement.currentTime + frameDuration);
            videoElement.currentTime = newTime;
            logOpe('[listedit.js] Frame forward via ":" key pressed.');
        } else if (event.key === ';') {
            event.preventDefault();
            const newTime = Math.max(0, videoElement.currentTime - frameDuration);
            videoElement.currentTime = newTime;
            logOpe('[listedit.js] Frame backward via ";" key pressed.');
        }
    });
}

// 動画が終了状態の場合に内部状態をリセットするヘルパー
function resetVideoIfEnded(videoElement) {
    if (videoElement.duration > 0 && (videoElement.ended || (videoElement.currentTime >= videoElement.duration - 0.05))) {
        videoElement.pause();
        videoElement.currentTime = 0;
        videoElement.load(); // 内部状態をリセット
        updateUIForVideoState();
        logOpe("[listedit.js] Video reset from ended state.");
    }
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
        segment.style.backgroundColor = '#555'; // 灰色
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

    const segments = Array.from(volumeMeter.querySelectorAll('.volume-segment'));
    const totalSegments = segments.length;

    // スライダーが 0 の場合
    if (sliderValue === 0) {
        segments.forEach((segment) => {
            segment.style.backgroundColor = '#555'; // 全セグメントを灰色
            segment.style.boxShadow = 'none';
        });
        return;
    }

    // dBFS が -Infinity の場合（無音）
    if (dbFS === -Infinity || dbFS < -100) {
        segments.forEach((segment) => {
            segment.style.backgroundColor = '#555'; // 全セグメントを灰色
            segment.style.boxShadow = 'none';
        });
        return;
    }

    // スライダー値を正規化（0～1）
    const sliderNormalized = sliderValue / 100;

    // スライダー値を反映した dBFS 値を計算
    const adjustedDbFS = dbFS + 20 * Math.log10(sliderNormalized);

    // adjustedDbFS を 0～1 に正規化（対数スケール）
    const normalizedVolume = Math.max(0, Math.min(1, Math.pow(10, adjustedDbFS / 20)));
    const activeSegments = Math.round(normalizedVolume * totalSegments);

    // メーターを更新
    segments.forEach((segment, index) => {
        if (index >= totalSegments - activeSegments) {
            const segmentThreshold = -((index / totalSegments) * 80);

        if (segmentThreshold >= -10) {
            segment.style.backgroundColor = '#c05050';
            segment.style.boxShadow = '0 0 6px rgba(192, 80, 80, 0.6)';
        } else if (segmentThreshold >= -30) {
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

// -----------------------
// 音声メーターのセットアップ
// -----------------------
function setupVolumeMeter(videoElement, volumeMeter) {
    let analyser, inputSourceNode;
    let animationFrameId = null;

    if (!volumeMeter) {
        logInfo('Volume meter element not found.');
        return;
    }

    // 初期化関数
    function initVolumeMeter() {
        volumeMeter.innerHTML = '';
        for (let i = 0; i < 60; i++) {
            const segment = document.createElement('div');
            segment.classList.add('volume-segment');
            volumeMeter.appendChild(segment);
        }
        logDebug('[listedit.js] Volume meter initialized with 60 segments.');
    }

    // AudioContextのセットアップ
    function setupAudioContext() {
        const audioContext = AudioContextManager.getContext();

        if (!analyser) {
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
        }

        if (!inputSourceNode || inputSourceNode.mediaElement !== videoElement) {
            if (inputSourceNode) {
                inputSourceNode.disconnect();
            }
            try {
                inputSourceNode = audioContext.createMediaElementSource(videoElement);
                inputSourceNode.connect(analyser);
            } catch (error) {
                logInfo('Error setting up MediaElementSourceNode:', error);
                return;
            }
        }

        if (!animationFrameId) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            function render() {
                analyser.getByteFrequencyData(dataArray);
                const rawMaxAmplitude = Math.max(...dataArray);

                if (rawMaxAmplitude === 0) {
                    updateVolumeMeter(-Infinity, 100); 
                } else {
                    const scaledAmplitude = rawMaxAmplitude / 255;
                    const adjustedAmplitude = Math.pow(scaledAmplitude, 1.5);
                    const dbFS = 20 * Math.log10(adjustedAmplitude || 1);

                    // スライダー値を加味したメーター更新
                    updateVolumeMeter(dbFS, volumeAdjustmentFactor * 100);
                }
                animationFrameId = requestAnimationFrame(render);
            }
            render();
        }
    }

    // 初期化とイベントのセットアップ
    if (!setupVolumeMeter.initialized) {
        initVolumeMeter();
        videoElement.addEventListener('play', setupAudioContext);
        videoElement.addEventListener('pause', resetVolumeMeter);
        setupVolumeMeter.initialized = true;
        logDebug('[listedit.js] Audio context and volume meter setup complete.');
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

    // カスタムプロパティをセットする
    volumeSlider.style.setProperty('--value', `${volumeSlider.value}%`);

    volumeSlider.addEventListener("input", async () => {
        const sliderValue = parseInt(volumeSlider.value, 10); 
        volumeSlider.style.setProperty('--value', `${volumeSlider.value}%`);

        // スライダー値をそのまま保持
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

        // 再生中かどうかをチェック（再生中でない場合はメーター更新をスキップ）
        const isPlaying = checkIfPlaying(); 
        if (isPlaying) {
            // メーターを更新（スライダー値が0の場合はリセット）
            const dbFS = sliderValue === 0 ? -Infinity : 0;
            updateVolumeMeter(dbFS, sliderValue);
        } else {
            logInfo("[listedit.js] Volume slider adjusted, but playback is not active. Skipping meter update.");
        }

        // 音量の状態を更新（スライダーが0の場合は0を送信）
        const volumeToSend = sliderValue === 0 ? 0 : sliderValue;
        await updateVolumeState(volumeToSend);

        // 状態変更後に通知
        window.electronAPI.notifyListeditUpdate();
    });

    // 音量スライダーで矢印キーの動作を無効化（上下左右すべて）
    volumeSlider.addEventListener("keydown", function (event) {
        if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown"
        ) {
            event.preventDefault(); // 矢印キーのデフォルト動作を無効化
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

    // スライダーの値が0の場合、明示的に0を保持
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

// PFLボタンおよび動画要素の参照を取得
const pflButton = document.getElementById('pfl-button');
const videoElement = document.getElementById('listedit-video');

// PFL用の AudioContext パイプラインを初期化する関数
async function startPFL(selectedDeviceId) {
    if (!videoElement || !videoElement.src) {
        logInfo('[listedit.js] PFL: Video element or source is not available.');
        return;
    }

    if (!videoElement.captureStream) {
        logInfo('[listedit.js] PFL: captureStream() is not supported.');
        return;
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

// PFL ボタンのクリックイベント設定
if (pflButton && videoElement) {
    pflButton.addEventListener('click', async () => {
        // 動画が読み込まれているか確認
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

        // 選択されたデバイスが存在するか厳密に確認
        const isDeviceAvailable = availableOutputDevices.some(device => device.deviceId === selectedDeviceId);
        if (!isDeviceAvailable) {
            logInfo(`[listedit.js] PFL: Selected device (${selectedDeviceId}) is not available. PFL will not start.`);
            showMessage(getMessage('selected-device-not-found'), 5000, 'alert');
            return;
        }

        // PFLを開始または停止
        if (!isPFLActive) {
            isPFLActive = true;
            pflButton.classList.remove('button-gray');
            pflButton.classList.add('button-green');
            await startPFL(selectedDeviceId);
        } else {
            isPFLActive = false;
            pflButton.classList.remove('button-green');
            pflButton.classList.add('button-gray');
            await stopPFL();
        }
    });
}

// 動画が再生状態になったとき（playing イベント）に、PFLがONでAudioContextが未初期化の場合、再初期化する処理を追加
videoElement.addEventListener('playing', async () => {
    // 動画が終了状態の場合は、currentTimeをリセットしてから再初期化を試みる
    if (videoElement.ended) {
        videoElement.currentTime = 0;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (isPFLActive && !pflAudioContext) {
        logInfo('[listedit.js] Video is playing: Reinitializing PFL since it is ON');
        await startPFL();
    }
});

// 動画終了時（ended イベント）に、AudioContext をリセットして再初期化可能とする
videoElement.addEventListener('ended', async () => {
    if (isPFLActive && pflAudioContext) {
        logInfo('[listedit.js] Video ended: Resetting PFL AudioContext');
        await stopPFL();
    }
});

// メインプロセスからデバイス設定変更の通知を受信し、PFLがONなら再初期化する
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
        resetVideoIfEnded(video);
        video.currentTime = parseFloat(progressSlider.value);
    });

    progressSlider.addEventListener("keydown", function (event) {
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
    
    // 動画が未読込の場合（srcが空、readyStateが未満、durationが0以下の場合）はマーカーを非表示にする
    if (!video.src || video.src.trim() === "" || video.readyState < 1 || video.duration <= 0) {
        inMarker.style.display = "none";
        outMarker.style.display = "none";
        return;
    }
    // 動画が正常にロードされている場合はマーカーを表示
    inMarker.style.display = "block";
    outMarker.style.display = "block";

    // シークバーの親コンテナが relative でなければ設定
    const container = slider.parentElement;
    if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
    }
    
    const duration = parseFloat(slider.max);
    if (!duration || duration <= 0) return;

    // シークバーの位置と幅を取得
    const sliderRect = slider.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const sliderWidth = sliderRect.width;
    const sliderLeftOffset = sliderRect.left - containerRect.left;
    
    // ONAIR側と同様にシンプルな計算
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
    inPointButton.addEventListener('click', async () => {
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
    outPointButton.addEventListener('click', async () => {
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
    // グローバル変数の更新
    if (pointType === 'inPoint') {
        inPoint = newTime;
    } else if (pointType === 'outPoint') {
        outPoint = newTime;
    }
    logOpe(`[listedit.js] ${pointType} updated to: ${newTime.toFixed(2)} seconds`);
    window.electronAPI.notifyListeditUpdate();
    // マーカー位置を再計算して更新
    updateListeditSeekBarMarkers(inPoint, outPoint);
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

    startModePauseButton.addEventListener('click', async () => {
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Start mode PAUSE button pressed but video is not loaded.');
            return;
        }
        await updateStartModeState("PAUSE");
    });

    startModePlayButton.addEventListener('click', async () => {
        if (!isVideoLoaded) {
            logInfo('[listedit.js] Start mode PLAY button pressed but video is not loaded.');
            return;
        }
        await updateStartModeState("PLAY");
    });

    startModeFadeinButton.addEventListener('click', async () => {
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
    const modeButtons = {
        OFF: document.getElementById('end-off-button'),
        PAUSE: document.getElementById('end-pause-button'),
        FTB: document.getElementById('end-ftb-button'),
        REPEAT: document.getElementById('end-repeat-button'),
        NEXT: document.getElementById('end-next-button'),
        NEXT: document.getElementById('end-next-button'),
    };

    if (Object.values(modeButtons).some(button => !button)) {
        logInfo('[listedit.js] One or more END MODE buttons are missing.');
        return;
    }

    // ボタンのクリックイベントを設定
    Object.entries(modeButtons).forEach(([mode, button]) => {
        button.addEventListener('click', () => {
            if (!isVideoLoaded) {
                logInfo(`[listedit.js] End mode ${mode} button pressed but video is not loaded.`);
                return; // 動画が読み込まれていない場合は動作しない
            }
            updateEndModeState(mode);
        });
    });
}

// END MODEの状態を更新
async function updateEndModeState(newMode) {
    const playlist = await stateControl.getPlaylistState();
    logOpe('[listedit.js] updateEndModeState called with newMode:', newMode);

    const updatedPlaylist = playlist.map(file => {
        if (file.playlistItem_id === currentEditingItemId) {
            return {
                ...file,
                endMode: newMode
            };
        }
        return file;
    });
    await stateControl.setPlaylistState(updatedPlaylist);
    updateEndModeButtons(newMode);

    // 状態更新後に通知
    window.electronAPI.notifyListeditUpdate();
}

// ボタンのアクティブ状態を更新
function updateEndModeButtons(activeMode) {
    const buttons = document.querySelectorAll('#end-mode-area .button');
    buttons.forEach(button => {
        const mode = button.id.replace('end-', '').replace('-button', '').toUpperCase();
        if (mode === activeMode) {
            button.classList.remove('button-gray');
            button.classList.add('button-green');
        } else {
            button.classList.remove('button-green');
            button.classList.add('button-gray');
        }
    });
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

    // FTBレート変更イベントの設定
    ftbRateInput.addEventListener('input', async (event) => {
        const newRate = parseFloat(event.target.value);
        if (isNaN(newRate) || newRate <= 0) {
            ftbRateInput.value = '1.0';
            return;
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
        window.electronAPI.notifyListeditUpdate(); // リスナへの通知
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
//  キーボードショートカット
// --------------------------------

async function handleShortcutAction(action) {
    switch (action) {
        case 'reset-edit-area':
            logOpe("[listedit.js] Reset Edit Area triggered.");
            // PFLがONの場合は停止して初期化する
            if (isPFLActive) {
                await stopPFL();
                isPFLActive = false;
                // PFLボタンの状態も更新
                if (pflButton) {
                    pflButton.classList.remove('button-green');
                    pflButton.classList.add('button-gray');
                }
            }
            await clearPlaylistSelection();
            // プレイリストUI更新の通知を送信して、選択状態の解除を反映させる
            window.electronAPI.notifyListeditUpdate();
            disableAllButtons(controlButtons);
            setVideoLoadedState(false);
            initializeEditArea();
            break;
        case 'in-point':
            document.getElementById('in-point')?.click();
            logOpe('[listedit.js] IN point button triggered.');
            break;
        case 'out-point':
            document.getElementById('out-point')?.click();
            logOpe('[listedit.js] OUT point button triggered.');
            break;
        case 'toggle-start-mode':
            const startPause = document.getElementById('start-pause-button');
            const startPlay = document.getElementById('start-play-button');
            const startFadein = document.getElementById('start-fadein-button');
            if (startPause && startPlay && startFadein) {
                if (startPause.classList.contains('button-green')) {
                    // PAUSE → PLAY
                    startPlay.click();
                    logOpe('[listedit.js] Start mode toggled to PLAY.');
                } else if (startPlay.classList.contains('button-green')) {
                    // PLAY → FADEIN
                    startFadein.click();
                    logOpe('[listedit.js] Start mode toggled to FADEIN.');
                } else {
                    // FADEIN（またはどれもアクティブでない状態） → PAUSE
                    startPause.click();
                    logOpe('[listedit.js] Start mode toggled to PAUSE.');
                }
            }
            break;
        case 'end-mode-off':
            document.getElementById('end-off-button')?.click();
            logOpe('[listedit.js] End mode OFF triggered.');
            break;
        case 'end-mode-pause':
            document.getElementById('end-pause-button')?.click();
            logOpe('[listedit.js] End mode PAUSE triggered.');
            break;
        case 'end-mode-ftb':
            document.getElementById('end-ftb-button')?.click();
            logOpe('[listedit.js] End mode FTB triggered.');
            break;
        case 'end-mode-repeat':
            document.getElementById('end-repeat-button')?.click();
            logOpe('[listedit.js] End mode REPEAT triggered.');
            break;
        case 'end-mode-next':
            document.getElementById('end-next-button')?.click();
            logOpe('[listedit.js] End mode NEXT triggered.');
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
    const code = event.code;          // 例: 'KeyS', 'KeyO', ...
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
        // 修飾キー未押下時は右矢印でリセット
        if (code === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            handleShortcutAction('reset-edit-area');
        }
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
