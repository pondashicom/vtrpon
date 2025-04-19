// -----------------------
//     recorder.js
//     ver 2.2.9
// -----------------------


// ----------------------------------------
// グローバル変数
// ----------------------------------------
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;;
const MAX_MEMORY_CHUNKS = 10;
let diskChunkFiles = [];

// ----------------------------------------
// 録画オプション設定
// ----------------------------------------
const defaultRecordingOptions = {
    mimeType: 'video/webm; codecs=vp9,opus', // VP9/Opus によるエンコード
    videoBitsPerSecond: 8000000,             // 8 Mbps に設定
    timeSlice: 5000                          // 5秒ごとのチャンク取得
};

let recordingOptions = { ...defaultRecordingOptions };

// ----------------------------------------
// 録画開始処理
// ----------------------------------------
async function startRecording(videoElement) {
    // 設定ウィンドウから録画設定を取得し、ビットレートを反映
    try {
        const saved = await window.electronAPI.getRecordingSettings();
        recordingOptions.videoBitsPerSecond = saved.videoBitsPerSecond || recordingOptions.videoBitsPerSecond;
    } catch (error) {
        logOpe('[recorder.js] 設定取得失敗: ' + error);
    }
    console.log('[recorder.js] bitrate:', recordingOptions.videoBitsPerSecond);
    let stream;

    // オフスクリーンキャンバスで内部解像度にて描画
    const recordingCanvas = document.createElement('canvas');
    const intrinsicWidth = videoElement.videoWidth || 1920;
    const intrinsicHeight = videoElement.videoHeight || 1080;
    recordingCanvas.width = intrinsicWidth;
    recordingCanvas.height = intrinsicHeight;
    const ctx = recordingCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // フレーム描画ループ
    function drawFrame() {
        // 毎フレーム開始時にキャンバスをクリアする
        ctx.clearRect(0, 0, intrinsicWidth, intrinsicHeight);

        if (videoElement.readyState >= 2 && (videoElement.currentSrc || videoElement.srcObject)) {
            // 現在の動画ソースの自然な解像度を取得
            const srcWidth = videoElement.videoWidth;
            const srcHeight = videoElement.videoHeight;
            // キャンバス（固定）のアスペクト比
            const canvasRatio = intrinsicWidth / intrinsicHeight;
            // 動画ソースのアスペクト比
            const videoRatio = srcWidth / srcHeight;
            let drawWidth, drawHeight, offsetX, offsetY;
            if (videoRatio > canvasRatio) {
                // 動画が横長の場合：キャンバスの幅に合わせ、高さを調整
                drawWidth = intrinsicWidth;
                drawHeight = intrinsicWidth / videoRatio;
                offsetX = 0;
                offsetY = (intrinsicHeight - drawHeight) / 2;
            } else {
                // 動画が縦長の場合：キャンバスの高さに合わせ、幅を調整
                drawHeight = intrinsicHeight;
                drawWidth = intrinsicHeight * videoRatio;
                offsetY = 0;
                offsetX = (intrinsicWidth - drawWidth) / 2;
            }
            ctx.drawImage(videoElement, offsetX, offsetY, drawWidth, drawHeight);
        } else {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, intrinsicWidth, intrinsicHeight);
        }
        
        // 既存のフェードオーバーレイ処理
        const fadeElem = document.getElementById('fadeCanvas');
        if (fadeElem && fadeElem.style.display !== 'none') {
            const computedStyle = window.getComputedStyle(fadeElem);
            const opacity = parseFloat(computedStyle.opacity);
            if (opacity > 0) {
                const bgColor = computedStyle.backgroundColor;
                ctx.save();
                ctx.globalAlpha = opacity;
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, intrinsicWidth, intrinsicHeight);
                ctx.restore();
            }
        }
        
        requestAnimationFrame(drawFrame);
    }

    drawFrame();

    // 30fps でストリーム取得
    stream = recordingCanvas.captureStream(30);

    // 音声ストリームが存在しない、または音声トラックがない場合は再初期化を試みる
    if (!window.fullscreenAudioStream || window.fullscreenAudioStream.getAudioTracks().length === 0) {
        const fullscreenVideoElement = document.getElementById('fullscreen-video');
        if (fullscreenVideoElement) {
            logInfo('[recorder.js] fullscreenAudioStream not found or empty, reinitializing audio.');
            setupFullscreenAudio(fullscreenVideoElement);
        }
    }

    // fullscreenAudioStream が存在する場合、audioTracks を追加して映像と音声の複合ストリームを生成する
    if (window.fullscreenAudioStream) {
        const audioTracks = window.fullscreenAudioStream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        stream = new MediaStream([...videoTracks, ...audioTracks]);
    }
    recordedChunks = [];


    try {
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: recordingOptions.mimeType,
            videoBitsPerSecond: recordingOptions.videoBitsPerSecond
        });
    } catch (error) {
        logOpe('[recorder.js] Failed to create MediaRecorder: ' + error);
        return;
    }

    // チャンク受信時の処理
    mediaRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
            logInfo('[recorder.js] Data chunk received: ' + event.data.size + ' bytes');

            // 最新のチャンクが MAX_MEMORY_CHUNKS を超えた場合、超過分をディスクに書き出す
            if (recordedChunks.length > MAX_MEMORY_CHUNKS) {
                // flushCount: メモリ上に残すべき最新チャンク以外の数
                const flushCount = recordedChunks.length - MAX_MEMORY_CHUNKS;
                for (let i = 0; i < flushCount; i++) {
                    try {
                        // 書き出す際のインデックスは、すでにディスクに書き出した分も加味する
                        const filePath = await saveChunk(recordedChunks[i], diskChunkFiles.length + i);
                        diskChunkFiles.push(filePath);
                        logInfo('[recorder.js] Flushed chunk to disk: ' + filePath);
                    } catch (error) {
                        logOpe('[recorder.js] Error flushing chunk: ' + error);
                    }
                }
                // メモリ上には最新 MAX_MEMORY_CHUNKS 分のみ保持
                recordedChunks.splice(0, flushCount);
            }
        }
    };

    // 録画停止時の処理
    mediaRecorder.onstop = () => {
        logInfo('[recorder.js] Recording stopped. Number of chunks: ' + recordedChunks.length);
    };

    mediaRecorder.start(recordingOptions.timeSlice);
    isRecording = true;
    logInfo('[recorder.js] Recording started.');
}


// ----------------------------------------
// 録画ソース更新処理
// ----------------------------------------
function updateRecording(videoElement) {
    if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
        logInfo('[recorder.js] Recording session is still active, not updating.');
        return;
    }
    startRecording(videoElement);
}

// ----------------------------------------
// 録画停止処理
// ----------------------------------------
function stopRecording() {
    return new Promise((resolve, reject) => {
        if (!isRecording || !mediaRecorder || mediaRecorder.state !== 'recording') {
            logOpe('[recorder.js] Not recording.');
            resolve();
            return;
        }
        mediaRecorder.onstop = () => {
            logInfo('[recorder.js] Recording stopped. Number of chunks: ' + recordedChunks.length);
            isRecording = false;
            resolve();
        };
        mediaRecorder.stop();
        logInfo('[recorder.js] Recording stop requested.');
    });
}

// ----------------------------------------
// 録画データ保存処理
// ----------------------------------------
async function saveRecording() {
    try {
        const mergedPath = await mergeRecording();
        return mergedPath;
    } catch (error) {
        logOpe('[recorder.js] Failed to save recording file: ' + error);
        throw error;
    }
}

// ----------------------------------------
// チャンク単体保存処理
// ----------------------------------------
async function saveChunk(blob, index) {
    const arrayBuffer = await blob.arrayBuffer();
    const fileName = `chunk_${index}.webm`;
    const api = window.electronAPI;
    if (!api || !api.recorderSave || typeof api.recorderSave.saveRecordingFile !== 'function') {
        throw new Error('[recorder.js] recorderSave API is not available. Please check the preload.js settings.');
    }
    const savedPath = await api.recorderSave.saveRecordingFile(arrayBuffer, fileName);
    logInfo('[recorder.js] Chunk ' + index + ' saved: ' + savedPath + ' (blob size: ' + blob.size + ' bytes)');
    return savedPath;
}

// ----------------------------------------
// EBML メタデータ補完処理
// ----------------------------------------
async function fixWebmMetadata(mergedPath) {
    try {
        const expectedDurationSec = recordedChunks.length * (recordingOptions.timeSlice / 1000);
        logInfo('[recorder.js] Expected duration based on chunks: ' + expectedDurationSec + ' seconds');
        const fixedPath = await window.electronAPI.fixWebmMetadata(mergedPath, expectedDurationSec * 1000);
        return fixedPath;
    } catch (error) {
        logOpe('[recorder.js] EBML metadata fix failed: ' + error);
        throw error;
    }
}

// ----------------------------------------
// チャンク結合処理
// ----------------------------------------
async function mergeRecording() {
    // 録画停止時、残りのメモリ上のチャンクもディスクに書き出す
    if (recordedChunks.length > 0) {
        for (let i = 0; i < recordedChunks.length; i++) {
            try {
                const filePath = await saveChunk(recordedChunks[i], diskChunkFiles.length + i);
                diskChunkFiles.push(filePath);
            } catch (error) {
                logOpe('[recorder.js] Error saving in-memory chunk during merge: ' + error);
            }
        }
        recordedChunks = [];
    }

    // 結合対象は、ディスクに書き出したすべてのチャンク
    if (diskChunkFiles.length === 0) {
        logOpe('[recorder.js] No recording data exists.');
        return;
    }
    logInfo('[recorder.js] Chunk files to merge: ' + JSON.stringify(diskChunkFiles, null, 2));
    const now = new Date();
    const datePart = now.toLocaleDateString('ja-JP').replace(/\//g, '-'); // 例: "2023-04-12"
    const timePart = now.toLocaleTimeString('ja-JP', { hour12: false }).replace(/:/g, ''); // 例: "224530"
    const targetFileName = `recording_${datePart}_${timePart}.webm`;
    const mergedPath = await window.electronAPI.recorderMerge.mergeRecordingChunks(diskChunkFiles, targetFileName);
    logInfo('[recorder.js] Merged recording file: ' + mergedPath);
    const fixedPath = await fixWebmMetadata(mergedPath);
    
    // 解放: merge後、ディスク上のチャンクファイルパスの情報をクリアする
    diskChunkFiles = [];
    
    return fixedPath;
}

// ----------------------------------------
// 録画オプション更新処理
// ----------------------------------------
function setRecordingOptions(options) {
    recordingOptions = { ...recordingOptions, ...options };
    logInfo('[recorder.js] Recording options updated: ' + JSON.stringify(recordingOptions));
}

// ----------------------------------------
// モジュールエクスポート
// ----------------------------------------
window.recorder = {
    startRecording,
    stopRecording,
    saveRecording,
    setRecordingOptions,
    updateRecording
};
