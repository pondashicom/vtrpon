// -----------------------
//     preload.js
//     ver 2.2.9
// -----------------------

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { logInfo, logOpe, logDebug, setLogLevel, LOG_LEVELS } = require('./logger');
const stateControl = require('./statecontrol');

// ドラッグ＆ドロップイベントのハンドリング
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
const { webUtils } = require('electron');  // 追加

window.addEventListener('drop', (e) => {
  e.preventDefault();
  const droppedFiles = Array.from(e.dataTransfer.files);
  const paths = droppedFiles
    .map(file => webUtils.getPathForFile(file))
    .filter(filePath => filePath && typeof filePath === 'string');
  console.log('[preload.js] Dropped file paths:', paths);
  ipcRenderer.send('files-dropped', paths);
});


contextBridge.exposeInMainWorld('electronAPI', {

    // -----------------------
    //  プレイリストの状態管理
    // -----------------------
    stateControl: {
        getPlaylistState: stateControl.getPlaylistState,
        setPlaylistState: stateControl.setPlaylistState,
        addFileToState: stateControl.addFileToState,
        setEditState: stateControl.setEditState,
        getEditState: stateControl.getEditState,
        clearState: stateControl.clearState,
        getPlaylistById: stateControl.getPlaylistById,
        setPlaylistStateWithId: stateControl.setPlaylistStateWithId,
        getAllPlaylists: stateControl.getAllPlaylists,
        resetOnAirState: stateControl.resetOnAirState,
        setOnAirState: stateControl.setOnAirState,
        getOnAirState: stateControl.getOnAirState,
        moveItemInPlaylist: stateControl.moveItemInPlaylist,
        deleteItemFromPlaylist: stateControl.deleteItemFromPlaylist,
    },

    // ----------------------------
    //  アイテムの状態管理
    // ----------------------------

    // 現在のモード取得
    requestCurrentMode: async () => ipcRenderer.invoke('requestCurrentMode'),

    // エディットからメインへアイテムのエディット状態の更新通知
    updateEditState: (itemData) => ipcRenderer.send('update-edit-state', itemData),

    // メインから全体にアイテムのエディット状態の更新通知
    onUpdateEditState: (callback) => ipcRenderer.on('update-edit-state', (event, itemData) => callback(itemData)),

    // ----------------------------
    //  アイテムの編集通知
    // ----------------------------

    // エディットからメインにエディット更新を通知
    notifyListeditUpdate: () => ipcRenderer.send('listedit-updated'),

    // メインから全体にエディット更新を通知
    onListeditUpdated: (callback) => {
        ipcRenderer.on('listedit-updated', (event) => {
            callback();
        });
    },

    // ----------------------------
    //  オンエアの通知
    // ----------------------------

    // プレイリストからメインにオンエアのアイテムIDを通知
    sendOnAirItemIdToMain: (itemId) => ipcRenderer.send('on-air-item-id', itemId),

    // メインからオンエア画面にオンエアアイテムIDを通知
    onReceiveOnAirData: (callback) => ipcRenderer.on('on-air-data', (event, onAirData) => callback(onAirData)),

    // ----------------------------
    //  フルスクリーンにもオンエア
    // ----------------------------

    // オンエアからメインにフルスクリーン用データを通知
    sendToFullscreenViaMain: (data) => ipcRenderer.send('send-video-to-fullscreen', data),

    // メインからフルスクリーンに動画データを通知
    onReceiveFullscreenData: (callback) => {
        ipcRenderer.on('load-video-from-main', (event, fullscreenData) => callback(fullscreenData));
    },

    // ----------------------------
    //  フルスクリーンを操作する
    // ----------------------------

    // メインからフルスクリーンにコマンドを送信
    sendControlToFullscreen: (commandData) => ipcRenderer.send('control-fullscreen', commandData),

    // フルスクリーンからメインに状態通知を受信
    onReceiveFullscreenStatus: (callback) => ipcRenderer.on('fullscreen-status', (event, statusData) => callback(statusData)),

    // フルスクリーンからの音量メーターデータを受信
    onReceiveFullscreenVolume: (callback) => ipcRenderer.on('fullscreen-audio-level', (event, volumeLevel) => callback(volumeLevel)),

    // ----------------------------
    //  オフエア通知
    // ----------------------------

    // オンエアからメインにオフエアボタンのクリックイベントを通知
    sendOffAirEvent: () => ipcRenderer.send('off-air-event'),

    // メインからプレイリストにオフエアボタンのクリックイベントを通知
    onReceiveOffAirNotify: (callback) => ipcRenderer.on('off-air-notify', callback),

    // ----------------------------
    //  ネクストモード
    // ----------------------------

    // オンエアからメインにNEXTモード動画が終了したイベントを通知
    notifyNextModeComplete: (currentItemId) => ipcRenderer.send('next-mode-complete', currentItemId),

    // メインからプレイリストに次のアイテムを要求されたイベントを受信
    onNextModeCompleteBroadcast: (callback) => ipcRenderer.on('next-mode-complete-broadcast', (event, currentItemId) => callback(currentItemId)),

    // ----------------------------
    //  メニュー操作
    // ----------------------------

    // メニューからショートカット通知
    onShortcutTrigger: (callback) => ipcRenderer.on('shortcut-trigger', callback),

    // ----------------------------
    //  モーダル管理
    // ----------------------------

    // モーダル状態を更新する関数
    updateModalState: (isActive) => ipcRenderer.send('update-modal-state', { isActive }),

    // モーダル状態の変更を監視する関数
    onModalStateChange: (callback) => ipcRenderer.on('modal-state-change', callback),

    // 現在のモーダル状態を取得する関数
    getModalState: () => ipcRenderer.invoke('get-modal-state'),

    // ---------------------------------------
    // プレイリストのインポート・エクスポート
    // ---------------------------------------
    exportPlaylist: (playlistData) => ipcRenderer.invoke('export-playlist', playlistData),
    importPlaylist: () => ipcRenderer.invoke('import-playlist'), 
    checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),// インポート時のファイル存在確認

    // ----------------------------
    //  エディットキャプチャとフルスクリーンキャプチャ
    // ----------------------------

    // エディアキャプチャ：Blobデータを一時ファイルに保存
    saveBlobToFile: async (arrayBuffer, fileName) => {
        return ipcRenderer.invoke('saveBlobToFile', arrayBuffer, fileName);
    },

    // フルスクリーン：スクリーンショットを保存
    saveScreenshot: (arrayBuffer, fileName, videoPath) => ipcRenderer.invoke('saveScreenshot', arrayBuffer, fileName, videoPath),

    // スクリーンショットの結果をshowMessage に通知
    notifyScreenshotSaved: (savedPath) => ipcRenderer.send('notify-screenshot-saved', savedPath),

    // ----------------------------
    //  デバイス設定関連
    // ----------------------------

    // デバイス設定ウィンドウを閉じるための API
    closeDeviceSettings: () => ipcRenderer.send('close-device-settings'),

    // ディスプレイ情報取得用 API
    getDisplayList: () => ipcRenderer.invoke('get-display-list'),

    // デバイス設定情報をメインプロセスに送信するAPI
    setDeviceSettings: (settings) => ipcRenderer.send('set-device-settings', settings),

    // メインプロセスからデバイス設定情報を取得する API
    getDeviceSettings: () => ipcRenderer.invoke('get-device-settings'),

    // ------------------------------
    // MOV透過チェックと変換処理用
    // ------------------------------
    checkMovAlpha: (filePath) => ipcRenderer.invoke('check-mov-alpha', filePath),
    convertMovToWebm: (filePath) => ipcRenderer.invoke('convert-mov-to-webm', filePath),

    // ------------------------------
    // FLACファイルの波形分析
    // ------------------------------ 
    generateWaveformThumbnail: (filePath) => ipcRenderer.invoke('generate-waveform-thumbnail', filePath),

    // ------------------------------
    //    PPTX to MP4変換関連
    // ------------------------------
    convertPptxToPngWinax: (pptxPath) => ipcRenderer.invoke('convert-pptx-to-png-winax', pptxPath),
    getPngFiles: (outputFolder) => ipcRenderer.invoke('get-png-files', outputFolder),

    // ------------------------------
    //    FILLKEYモード関連
    // ------------------------------

    // FILLKEYモードの復元用
    fillKeyModeUpdate: (fillKeyMode) => ipcRenderer.send('fillkey-mode-update', fillKeyMode),
    clearModes: () => ipcRenderer.send('clear-modes'),

    // ----------------------------
    //    DSK機能関連
    // ----------------------------

    // DSK送出用
    sendDSKCommand: (dskCommandData) => ipcRenderer.send('dsk-command', dskCommandData),

    // ------------------------------
    //    ファイル処理
    // ------------------------------

    // ファイル選択
    selectFiles: () => ipcRenderer.invoke('select-files'),

    // メタデータ取得
    getMetadata: (filePath) => ipcRenderer.invoke('get-metadata', filePath),

    // ファイルパス操作
    path: {
        join: (...args) => path.join(...args),
        basename: (p) => path.basename(p),
        dirname: (p) => path.dirname(p),
        extname: (p) => path.extname(p),
        normalize: (p) => path.normalize(p),
    },

    // ------------------------------
    //    動画処理
    // ------------------------------

    // FFmpeg操作
    execFfmpeg: (args) => {
        const ffmpegPath = path.join(process.resourcesPath, 'ffmpeg.exe');
        console.log('FFmpeg Path:', ffmpegPath);

        const command = `"${ffmpegPath}" ${args}`;

        return new Promise((resolve, reject) => {
            exec(command, { shell: true, encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    if (!stderr.includes('Unsupported pixel format: -1')) {
                        console.error(`FFmpeg error: ${stderr}`);
                        reject(stderr);
                    } else {
                        console.warn('Filtered FFmpeg warning: Unsupported pixel format');
                        resolve(stdout);
                    }
                } else {
                    console.log(`FFmpeg output: ${stdout}`);
                    resolve(stdout);
                }
            });
        });
    },

    // ----------------------------
    //    録画機能用 API
    // ----------------------------
    recorderSave: {
        saveRecordingFile: async (arrayBuffer, fileName) => {
            try {
                const savedPath = await ipcRenderer.invoke('save-recording-file', arrayBuffer, fileName);
                return savedPath;
            } catch (error) {
                console.error('[preload.js] saveRecordingFile error:', error);
                throw error;
            }
        }
    },

    recorderMerge: {
        mergeRecordingChunks: async (chunkFilePaths, targetFileName) => {
            try {
                const mergedPath = await ipcRenderer.invoke('merge-recording-chunks', chunkFilePaths, targetFileName);
                return mergedPath;
            } catch (error) {
                console.error('[preload.js] mergeRecordingChunks error:', error);
                throw error;
            }
        }
    },

    // 録画保存完了通知リスナー
    onRecordingSaveNotify: (callback) => ipcRenderer.on('recording-save-notify', (event, savedPath) => callback(savedPath)),

    // EBMLのメタデータ補完 API
    fixWebmMetadata: async (mergedPath, totalDurationMs) => {
        return await ipcRenderer.invoke('fix-webm-metadata', mergedPath, totalDurationMs);
    },

    // メディアファイルの再生時間を取得する API
    getMediaDuration: async (filePath) => {
        return await ipcRenderer.invoke('get-media-duration', filePath);
    },

    // ----------------------------
    // 録画設定用 API
    // ----------------------------
    getRecordingSettings: () => ipcRenderer.invoke('get-recording-settings'),
    setRecordingSettings: (settings) => ipcRenderer.send('set-recording-settings', settings),
    onRecordingSaveStart: (callback) => ipcRenderer.on('recording-save-start', (event) => callback()),
    onRecordingSaveComplete: (callback) => ipcRenderer.on('recording-save-complete', (event) => callback()),
    openRecordingSettings: () => ipcRenderer.send('open-recording-settings'),
    closeRecordingSettings: () => ipcRenderer.send('close-recording-settings'),
    showDirectoryDialog: () => ipcRenderer.invoke('show-recording-directory-dialog'),

    // ----------------------------
    //  その他の処理
    // ----------------------------

    // IPC通信用ショートカット
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
        once: (channel, func) => ipcRenderer.once(channel, (event, ...args) => func(event, ...args)),
    },

    // プラットフォーム情報
    process: {
        platform: process.platform,
    },

    // ------------------------------
    //    言語変更イベント受信用API
    // ------------------------------
    onLanguageChanged: (callback) => ipcRenderer.on('language-changed', (event, lang) => callback(lang)),

    // ------------------------------
    //    ログ機能
    // ------------------------------

    // ログ機能
    logInfo,
    logOpe,
    logDebug,
    setLogLevel,
    LOG_LEVELS,
});
