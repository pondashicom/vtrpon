// -----------------------
//     recorder.js
//     ver 2.2.8
// -----------------------


// ----------------------------------------
// グローバル変数
// ----------------------------------------
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

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
function startRecording(videoElement) {
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
        if (videoElement.readyState >= 2 && (videoElement.currentSrc || videoElement.srcObject)) {
            // 内部解像度で描画
            ctx.drawImage(videoElement, 0, 0, intrinsicWidth, intrinsicHeight);
        } else {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, intrinsicWidth, intrinsicHeight);
        }
        requestAnimationFrame(drawFrame);
    }
    drawFrame();

    // 30fps でストリーム取得
    stream = recordingCanvas.captureStream(30);
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
    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
            logInfo('[recorder.js] Data chunk received: ' + event.data.size + ' bytes');
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
    if (recordedChunks.length === 0) {
        logOpe('[recorder.js] No recording data exists.');
        return;
    }
    const chunkFilePaths = [];
    for (let i = 0; i < recordedChunks.length; i++) {
        const filePath = await saveChunk(recordedChunks[i], i);
        chunkFilePaths.push(filePath);
    }
    logInfo('[recorder.js] Chunk files to merge: ' + JSON.stringify(chunkFilePaths, null, 2));
    const targetFileName = `recording_merged_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    const mergedPath = await window.electronAPI.recorderMerge.mergeRecordingChunks(chunkFilePaths, targetFileName);
    logInfo('[recorder.js] Merged recording file: ' + mergedPath);
    const fixedPath = await fixWebmMetadata(mergedPath);
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
