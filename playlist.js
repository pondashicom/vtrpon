// -----------------------
//     playlist.js 
//     ver 2.5.2
// -----------------------


// -----------------------
// 初期設定
// -----------------------

// ログ機能取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
const logDebug = window.electronAPI.logDebug;

// 状態管理取得
const stateControl = window.electronAPI.stateControl;
const __loadState = { token: 0 };

// モード状態管理：
let soundPadActive = false;
let directOnAirActive = false;

// 変換中ファイル管理
const convertingFiles = new Set();

// ドラッグ中アイテムID保持
let draggedPlaylistItemId = null;
let draggedSourcePlaylistIndex = null;
let dragOriginalActivePlaylistIndex = null;
let dragDropCompleted = false;
let dragHoverSwitchTimer = null;
let dragHoverTargetPlaylistIndex = null;
let dragHoverSwitchInProgress = false;
let dragSourcePlaylistSnapshot = null;

// インポートキュー管理
const pendingFiles = [];
let isImporting = false;
let totalCount = 0;
let finishedCount = 0;


// --------
// 正規化
// --------

// プレイリストアイテム正規化
function normalizePlaylistStoreItemForStore(item, index) {
    const src = (item && typeof item === 'object') ? item : {};

    const path = (typeof src.path === 'string') ? src.path : '';
    const uvcDeviceIdFromPath = (path.startsWith('UVC_DEVICE:')) ? path.replace('UVC_DEVICE:', '') : null;
    const uvcDeviceId = (typeof src.uvcDeviceId === 'string' && src.uvcDeviceId) ? src.uvcDeviceId : uvcDeviceIdFromPath;
    const isUVC = !!uvcDeviceId;

    const normalized = {
        ...src,
        ...(uvcDeviceId ? { uvcDeviceId } : {}),
        // UVCは path を必ず復元可能な形に揃える
        ...(isUVC ? { path: `UVC_DEVICE:${uvcDeviceId}` } : {}),
        order: index,
        repeatCount: (typeof src.repeatCount === 'number') ? src.repeatCount : null,
        repeatEndMode: src.repeatEndMode ?? null,
        endGotoPlaylist: src.endGotoPlaylist ?? null,
        endGotoItemId: src.endGotoItemId ?? null,
        startMode: src.startMode ?? null,
        endMode: src.endMode ?? null,
        inPoint: typeof src.inPoint === 'number' ? src.inPoint : 0,
        outPoint: typeof src.outPoint === 'number'
            ? src.outPoint
            : (typeof src.duration === 'number' ? src.duration : 0),
        repeatStartIndex: 0
    };

    resetPlaylistStoreItemRuntimeState(normalized);

    // UVCのthumbnail(HTMLElement)はlocalStorageへ入れない（{}化して壊れる）
    if (isUVC) {
        normalized.thumbnail = null;
    }

    return normalized;
}

// アクティブスロット正規化（1-9）
function getActivePlaylistSlotOrDefault(defaultSlot = 1) {
    const slot = (typeof activePlaylistIndex === 'number' && activePlaylistIndex >= 1 && activePlaylistIndex <= 9)
        ? activePlaylistIndex
        : defaultSlot;
    return slot;
}

function getActivePlaylistSlotOrNull() {
    const slot = (typeof activePlaylistIndex === 'number' && activePlaylistIndex >= 1 && activePlaylistIndex <= 9)
        ? activePlaylistIndex
        : null;
    return slot;
}

// -------------------
// 読込進捗表示用関数
// -------------------
function updateLoadingProgress(current, total) {
    const progressElem = document.getElementById('loading-progress');
    if (progressElem) {
        progressElem.textContent = total === 0 ? "" : `LOADING... ${current} / ${total}`;
    }
}
function enqueueImport(files) {
    pendingFiles.push(...files);
    totalCount += files.length;
    updateLoadingProgress(finishedCount, totalCount);

    // 読み込み開始（キュー投入直後からUIロック）
    if (!isImporting && pendingFiles.length > 0) {
        isImporting = true;
        processNextFile();
        return;
    }
}

async function processNextFile() {
    if (pendingFiles.length === 0) {
        isImporting = false;

        // 読み込み状態の変化を通知（UI側でボタンをロック/解除する）
        try {
            window.dispatchEvent(new CustomEvent('vtrpon-importing-changed', { detail: { isImporting } }));
        } catch (e) {
            // ignore
        }

        totalCount = 0;
        finishedCount = 0;
        updateLoadingProgress(0, 0);
        return;
    }

    isImporting = true;

    // 読み込み状態の変化を通知（UI側でボタンをロック/解除する）
    try {
        window.dispatchEvent(new CustomEvent('vtrpon-importing-changed', { detail: { isImporting } }));
    } catch (e) {
        // ignore
    }

    const file = pendingFiles.shift();

    try {
        let currentPlaylist = await stateControl.getPlaylistState();
        const validUpdates = await getValidUpdates([file], currentPlaylist);

        if (validUpdates.length > 0) {
            const updatedPlaylist = currentPlaylist.map(existingItem => {
                const updatedItem = validUpdates.find(item => item.playlistItem_id === existingItem.playlistItem_id);
                return updatedItem ? { ...existingItem, ...updatedItem, converting: false } : existingItem;
            });
            const newItems = validUpdates.filter(item => !currentPlaylist.some(existing => existing.playlistItem_id === item.playlistItem_id));
            const finalPlaylist = [...updatedPlaylist, ...newItems];
            await stateControl.setPlaylistState(finalPlaylist);
            await updatePlaylistUI();

            // 読み込み完了後にオートセーブ
            try {
                if (typeof saveActivePlaylistToStore === 'function') {
                    await saveActivePlaylistToStore();
                }
            } catch (e) {
                // ignore
            }
        }
    } catch (error) {
        logInfo('[playlist.js] Error processing file:', error);
    } finally {
        finishedCount++;
        updateLoadingProgress(finishedCount, totalCount);
        await processNextFile();
    }
}

// -----------------------
// 初期化
// -----------------------
document.addEventListener('DOMContentLoaded', async () => {
    const addFileButton = document.getElementById('file-button');
    if (!addFileButton) {
        logInfo('[playlist.js] File button not found in the DOM.');
        return;
    }

    // オンエアボタンイベントリスナー初期化
    initializeOnAirButtonListener();

    // Listedit更新通知イベントリスナ
    window.electronAPI.onListeditUpdated(async () => {
        logDebug('[playlist.js] Received listedit-updated notification, refreshing UI...');

        // stateControl側の実体プレイリストが別スロット由来に切り替わっている場合に備え、
        // 保存先スロット（activePlaylistIndex）を同期してからUI更新・オートセーブする
        await syncActiveSlotToCurrentPlaylistStateIfNeeded();

        await updatePlaylistUI();
        try {
            await saveActivePlaylistToStore();
        } catch (e) {
            // ignore (autosave failure should not break UI)
        }
    });

    // SOUND PADモードボタンイベントリスナー初期化
    async function toggleSoundPadMode(event) {
        const soundPadButton = document.getElementById('soundpad-mode-button');
        if (!soundPadButton) {
            logInfo('[playlist.js] SOUND PAD mode button not found.');
            return;
        }

        // 実マウス操作のときだけボタン種別チェック
        if (event && event.button !== undefined && event.button !== 0) return;
        if (event) event.preventDefault();

        soundPadActive = !soundPadActive;

        if (soundPadActive) {
            // 相互排他：DIRECT ONAIRモードがオンならオフ
            if (directOnAirActive) {
                directOnAirActive = false;
                const directOnAirButton = document.getElementById('directonair-mode-button');
                if (directOnAirButton) directOnAirButton.classList.remove('button-green');
            }
            soundPadButton.classList.add('button-green');
            try {
                const playlist = await stateControl.getPlaylistState();
                const updatedPlaylist = playlist.map(item => {
                    if (item.startMode === "PLAY" && item.endMode === "UVC") {
                        return {
                            ...item,
                            order: Number(item.order)
                        };
                    }
                    const newStartMode = (item.startMode === "PAUSE") ? "PLAY" : item.startMode;
                    const newEndMode = "OFF";
                    return {
                        ...item,
                        startMode: newStartMode,
                        endMode: newEndMode,
                        order: Number(item.order)
                    };
                });
                await stateControl.setPlaylistState(updatedPlaylist);
                await updatePlaylistUI();
                const latest = await stateControl.getPlaylistState();
                const editingItem = latest.find(it => it.editingState === 'editing');
                if (editingItem) {
                    window.electronAPI.updateEditState(editingItem);
                    window.electronAPI.syncOnAirEndMode &&
                        window.electronAPI.syncOnAirEndMode({
                            editingItemId: editingItem.playlistItem_id,
                            endMode: editingItem.endMode
                        });
                    logOpe('[playlist.js] Requested On-Air endMode sync (SOUND PAD ON).');
                }
            } catch (e) {
                logInfo('[playlist.js] SOUND PAD mode apply error:', e);
            }
        } else {
            soundPadButton.classList.remove('button-green');
        }
        logOpe(`[playlist.js] SOUND PAD mode toggled: ${soundPadActive}`);
        soundPadButton.blur();
        // オートセーブ
        try {
            await saveActivePlaylistToStore();
        } catch (e) {
            logInfo('[playlist.js] Auto-save after SOUND PAD mode toggle failed (ignored):', e);
        }
    }

    const soundPadButton = document.getElementById('soundpad-mode-button');
    if (soundPadButton) {
        soundPadButton.addEventListener('mousedown', async (event) => {
            await toggleSoundPadMode(event);
        });

    } else {
        logInfo('[playlist.js] SOUND PAD mode button not found.');
    }

    // サウンドパッドモードショートカットキー干渉防止
    document.addEventListener('keydown', (event) => {
        if (event.altKey && event.shiftKey && event.key.toLowerCase() === 's') {
            event.stopPropagation();
            event.preventDefault();
            toggleSoundPadMode(null);
            logOpe('[playlist.js] SOUND PAD mode triggered via shortcut.');
        }
    }, true);


    // DIRECT ONAIRモードボタンイベントリスナー初期化
    const directOnAirButton = document.getElementById('directonair-mode-button');
    if (directOnAirButton) {
        directOnAirButton.addEventListener('mousedown', async (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            directOnAirActive = !directOnAirActive;

            if (directOnAirActive) {
                // 相互排他：SOUND PADモードがオンならオフ
                if (soundPadActive) {
                    soundPadActive = false;
                    const soundPadButton = document.getElementById('soundpad-mode-button');
                    if (soundPadButton) soundPadButton.classList.remove('button-green');
                }
                directOnAirButton.classList.add('button-green');
                try {
                    const playlist = await stateControl.getPlaylistState();
                    const updatedPlaylist = playlist.map(item => {
                        const newStartMode = (item.startMode === "PAUSE") ? "PLAY" : item.startMode;
                        return {
                            ...item,
                            startMode: newStartMode,
                            order: Number(item.order)
                        };
                    });
                    await stateControl.setPlaylistState(updatedPlaylist);
                    await updatePlaylistUI();

                    // 編集中アイテムをエディットエリアに再送信
                    const latest = await stateControl.getPlaylistState();
                    const editingItem = latest.find(it => it.editingState === 'editing');
                    if (editingItem) {
                        window.electronAPI.updateEditState(editingItem);
                        window.electronAPI.syncOnAirEndMode &&
                            window.electronAPI.syncOnAirEndMode({
                                editingItemId: editingItem.playlistItem_id,
                                endMode: editingItem.endMode
                            });
                        logOpe('[playlist.js] Requested On-Air endMode sync (DIRECT ON).');
                    }
                } catch (e) {
                    logInfo('[playlist.js] DIRECT ONAIR mode apply error:', e);
                }
            } else {
                directOnAirButton.classList.remove('button-green');
            }
            logOpe(`[playlist.js] DIRECT ONAIR mode toggled: ${directOnAirActive}`);
            directOnAirButton.blur();

            // オートセーブ
            try {
                await saveActivePlaylistToStore();
            } catch (e) {
                logInfo('[playlist.js] Auto-save after DIRECT ONAIR mode toggle failed (ignored):', e);
            }
        });
    } else {
        logInfo('[playlist.js] DIRECT ONAIR mode button not found.');
    }

    // ファイルボタンクリックイベント登録
        addFileButton.addEventListener('mousedown', async (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            logOpe('[playlist.js] File button clicked.');

            try {
                const files = await window.electronAPI.selectFiles();
                if (!files || files.length === 0) {
                    logInfo('[playlist.js] No files selected.');
                    return;
                }
                enqueueImport(files);
            } catch (error) {
                logInfo('[playlist.js] Error adding files:', error);
            }
        });

    // プレイリスト1-9 初期化（空スロット作成） + 起動時スロット=1
    try {
        // 後方互換不要：プレイリスト0が存在したらエラー
        if (localStorage.getItem('vtrpon_playlist_store_0') !== null) {
            throw new Error('[playlist.js] Legacy playlist0 detected (vtrpon_playlist_store_0).');
        }

        // スロット1-9を必ず用意（既にあれば上書きしない）
        for (let i = 1; i <= 9; i++) {
            const key = `vtrpon_playlist_store_${i}`;
            if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, JSON.stringify({
                    name: `Playlist ${i}`,
                    data: []
                }));
            }
        }

        // 起動時は必ずスロット1を初期状態にする（復元はしない）
        activePlaylistIndex = 1;

        // 可能ならUI側の「1をアクティブ」にする
        if (typeof setActiveStoreButton === 'function') {
            setActiveStoreButton(1);
        }

        // 可能ならスロット1をロード（無ければ空のまま）
        if (typeof loadPlaylist === 'function') {
            await loadPlaylist(1);
        } else {
            // loadPlaylistが無い/未定義の場合は、現行プレイリストを空にする
            await stateControl.setPlaylistState([]);
        }
    } catch (e) {
        logInfo('[playlist.js] Playlist store init failed:', e);
        if (e && e.message && e.message.includes('Legacy playlist0 detected')) {
            showMessage('Legacy playlist0 detected (vtrpon_playlist_store_0)', 20000, 'alert');
        }
        return;
    }

    // 初回UI更新
    try {
        const playlist = await stateControl.getPlaylistState();
        if (playlist.length > 0) {
            const updatedPlaylist = playlist.map(item => ({
                ...item,
                onAirState: null,
            }));
            stateControl.setPlaylistState(updatedPlaylist);
        }
        await updatePlaylistUI();
    } catch (error) {
        logInfo('[playlist.js] Error initializing UI:', error);
    }

    // 5秒ごとファイル存在確認処理
    setInterval(async () => {
        try {
            const currentPlaylist = await stateControl.getPlaylistState();
            let updated = false;

            for (let i = 0; i < currentPlaylist.length; i++) {
                const item = currentPlaylist[i];

                // (1) MOV→WEBM変換中アイテムはスキップ
                if (item.converting) {
                    continue;
                }

                // (2) UVCデバイスの場合デバイス一覧と照合してオンライン/オフラインを判定
                if (typeof item.path === 'string' && item.path.startsWith("UVC_DEVICE")) {
                    const deviceId = item.path.replace("UVC_DEVICE:", "");
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoDevices = devices.filter(device => device.kind === 'videoinput').map(device => device.deviceId);
                    const deviceAvailable = videoDevices.includes(deviceId);
                    if (!deviceAvailable && !item.mediaOffline) {
                        item.mediaOffline = true;
                        updated = true;
                        logInfo(`[playlist.js] UVC device not found => mediaOffline: ${item.path}`);
                    } else if (deviceAvailable && item.mediaOffline) {
                        item.mediaOffline = false;
                        updated = true;
                    }
                    continue;
                }

                // (3) 上記以外のみファイル存在チェック
                const exists = await window.electronAPI.checkFileExists(item.path);
                if (!exists) {
                    if (!item.mediaOffline) {
                        item.mediaOffline = true;
                        updated = true;
                        logInfo(`[playlist.js] File not found => mediaOffline: ${item.path}`);
                    }
                } else {
                    if (item.mediaOffline) {
                        item.mediaOffline = false;
                        updated = true;
                    }
                }
            }

            if (updated) {
                await stateControl.setPlaylistState(currentPlaylist);
                await updatePlaylistUI();
            }
        } catch (error) {
            logInfo('[playlist.js] Error during periodic file existence check:', error);
        }
    }, 5000);
});

// -----------------------
// データ取得関数
// -----------------------
async function getValidUpdates(files, currentPlaylist) {
    let updatedFiles = [];

    for (const file of files) {
        const lowerPath = file.path.toLowerCase();

        // 静止画（PNG / JPG / JPEG）→ MP4 または WebM 変換（透過判定付き）処理
        if (lowerPath.endsWith('.png') || lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
            logInfo(`[playlist.js] Converting still image: ${file.path}`);
            try {
                const convertedPath = await convertPNGToVideo(file.path);
                if (!convertedPath) {
                    logInfo(`[playlist.js] Image conversion returned no output: ${file.path}`);
                    continue;
                }
                file.path = convertedPath;
                file.name = window.electronAPI.path.basename(convertedPath);
                const processedFile = await processFileData(file, currentPlaylist);
                if (processedFile) updatedFiles.push(processedFile);
            } catch (error) {
                logInfo(`[playlist.js] Error converting image (${file.path}): ${error.message || JSON.stringify(error)}`);
                continue;
            }
            continue;
        }

        // PPTX → PNG連番 & MP4変換処理
        if (lowerPath.endsWith('.pptx')) {
            logInfo(`[playlist.js] Converting PPTX: ${file.path}`);
            try {
                // エントリ追加
                const tempPlaylistItem = await addLoadingEntry(file.path, "mp4");

                // 仮エントリ追加（プレイリスト変更）をスロットへ反映（ベストエフォート）
                try {
                    if (typeof saveActivePlaylistToStore === 'function') {
                        await saveActivePlaylistToStore();
                    }
                } catch (e) {
                    logInfo('[playlist.js] Auto-save after PPTX addLoadingEntry failed (ignored):', e);
                }
                
                // 変換開始
                convertPptxToMp4(file.path, tempPlaylistItem)
                    .then(() => {
                        logInfo(`[playlist.js] PPTX conversion succeeded: ${file.path}`);
                    })
                    .catch(err => {
                        logInfo(`[playlist.js] PPTX conversion failed: ${err.message}`);
                        showMessage(`PPTX変換に失敗しました: ${err.message}`, 5000, 'alert');
                        // 失敗時は仮エントリをリストから削除
                        stateControl.getPlaylistState()
                            .then(list => list.filter(item => item.playlistItem_id !== tempPlaylistItem.playlistItem_id))
                            .then(filtered => stateControl.setPlaylistState(filtered))
                            .then(async () => {
                                try {
                                    if (typeof saveActivePlaylistToStore === 'function') {
                                        await saveActivePlaylistToStore();
                                    }
                                } catch (e) {
                                    logInfo('[playlist.js] Auto-save after PPTX failure cleanup failed (ignored):', e);
                                }
                            });
                    });
            } catch (error) {
                logInfo(`[playlist.js] Error adding loading entry for PPTX (${file.path}): ${error.message}`);
            }
            continue;
        }

        // MOV の透過チェック & 変換
        if (lowerPath.endsWith('.mov')) {
            logInfo(`[playlist.js] Checking MOV file for alpha channel: ${file.path}`);
            let pixFmt = null;

            try {
                pixFmt = await window.electronAPI.checkMovAlpha(file.path);
            } catch (err) {
                logInfo(`[playlist.js] Error checking MOV alpha: ${err}`);
            }

            if (pixFmt && pixFmt.toLowerCase().includes('yuva')) {
                logInfo(`[playlist.js] MOV has alpha, adding temporary entry and converting to WebM: ${file.path}`);
                
                // 1) 変換中の仮エントリを追加
                const tempPlaylistItem = await addLoadingEntry(file.path, "webm");

                // 仮エントリ追加（プレイリスト変更）をスロットへ反映（ベストエフォート）
                try {
                    if (typeof saveActivePlaylistToStore === 'function') {
                        await saveActivePlaylistToStore();
                    }
                } catch (e) {
                    logInfo('[playlist.js] Auto-save after MOV addLoadingEntry failed (ignored):', e);
                }

                // 2) 非同期でMOV → WebM変換を開始
                convertMovToWebm(file.path, tempPlaylistItem);

                continue; // 仮のエントリのみ追加、即時登録しない
            }
        }
        const processedFile = await processFileData(file, currentPlaylist);
        if (processedFile) updatedFiles.push(processedFile);
    }
    return updatedFiles;
}

// -----------------------------------------------
// ドラッグ＆ドロップでプレイリストアイテム追加
// -----------------------------------------------;

window.electronAPI.ipcRenderer.on('add-dropped-file', async (event, files) => {
    logInfo('[playlist.js] Received dropped files:', files);
    if (!files || files.length === 0) {
        logInfo('[playlist.js] No dropped files detected.');
        return;
    }
    enqueueImport(files);
});

// 読み込めないファイルドロップ時の通知
window.electronAPI.ipcRenderer.on('invalid-files-dropped', (event, invalidFiles) => {
    const errorMsg = getMessage('not-supported-file-error') + "\n" + invalidFiles.join("\n");
    showMessage(errorMsg, 5000, 'alert');
});

// -----------------------
// サムネイル生成
// -----------------------

// サムネイル生成関数
async function generateThumbnail(filePath) {
    return new Promise(async (resolve) => {
        // もしファイルパスが UVC デバイス用でなく、かつ file:// で始まっていなければ、安全なファイルURLに変換
        if (!filePath.startsWith("UVC_DEVICE:") && !/^file:\/\//.test(filePath)) {
            filePath = getSafeFileURL(filePath);
        }

        // UVCデバイスのサムネイル生成
        if (filePath.startsWith("UVC_DEVICE:")) {
            const deviceId = filePath.replace("UVC_DEVICE:", "");
            logInfo("Generating thumbnail - deviceId:", deviceId);

            // `deviceId` でカメラ起動
            navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } }).then(async (stream) => {
                try {
                    const track = stream.getVideoTracks()[0];
                    if (track && typeof track.getCapabilities === 'function' && typeof track.applyConstraints === 'function') {
                        const caps = track.getCapabilities();
                        const maxW = (caps && caps.width && typeof caps.width.max === 'number') ? caps.width.max : undefined;
                        const maxH = (caps && caps.height && typeof caps.height.max === 'number') ? caps.height.max : undefined;
                        if (maxW && maxH) {
                            await track.applyConstraints({
                                width:  maxW,
                                height: maxH,
                            });
                            const s = track.getSettings();
                            logInfo("Applied UVC constraints to device max - Width:", s.width, "Height:", s.height);
                        }
                    }
                } catch (e) {
                    logInfo("applyConstraints to device max skipped or failed:", e && e.message ? e.message : e);
                }

                const video = document.createElement('video');
                video.srcObject = stream;
                video.autoplay = true;
                video.muted = true;
                video.playsInline = true;
                video.onloadedmetadata = () => {
                    logInfo("Camera metadata - Width:", video.videoWidth, "Height:", video.videoHeight);
                    video.play();
                };

                // サムネイルサイズ
                const targetWidth = 135;
                const targetHeight = Math.round(targetWidth * 9 / 16);

                // 黒背景コンテナ作成
                const container = document.createElement('div');
                container.style.width = targetWidth + 'px';
                container.style.height = targetHeight + 'px';
                container.style.backgroundColor = 'black';
                container.style.overflow = 'hidden';

                // video 要素スタイル設定
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'contain';

                // video 要素追加
                container.appendChild(video);

                // ライブプレビュー
                resolve(container);
            }).catch((error) => {
                logInfo("Failed to get camera:", error);
                const canvas = document.createElement('canvas');
                const targetWidth = 135;
                const targetHeight = Math.round(targetWidth * 9 / 16);
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'red';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'white';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Loading failed', canvas.width / 2, canvas.height / 2);
                resolve(canvas.toDataURL('image/png'));
            });

            return;
        }

        // 拡張子取得
        const extension = filePath.split('.').pop().toLowerCase();

        // 1) 音声ファイル
        if (['wav','mp3','flac','aac','m4a'].includes(extension)) {
            const audio = new Audio(filePath);

            // 再生可否判定
            const playable = await Promise.race([
                new Promise(res => audio.addEventListener('loadedmetadata', () => res(true))),
                new Promise(res => audio.addEventListener('error',       () => res(false))),
                new Promise(res => setTimeout    (() => res(false), 3000))
            ]);

            if (!playable) {
                // 再生できない場合
                const canvas = document.createElement('canvas');
                canvas.width = 112; canvas.height = 63;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'red';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'white';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Loading failed', canvas.width/2, canvas.height/2);
                resolve(canvas.toDataURL('image/png'));
                return;
            }

            const durationSec = audio.duration;

            // 2時間以上なら波形スキップ
            if (durationSec > 7200) {
                const canvas = document.createElement('canvas');
                canvas.width = 112;
                canvas.height = 63;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'white';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(extension.toUpperCase(), canvas.width/2, canvas.height/2);
                resolve(canvas.toDataURL('image/png'));
                return;
            }

            // 2時間未満
            try {
                const arrayBuffer = await fetch(filePath).then(r => r.arrayBuffer());
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const canvas = document.createElement('canvas');
                canvas.width = 112;
                canvas.height = 63;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.strokeStyle = 'green';
                ctx.lineWidth = 1;
                const rawData = audioBuffer.getChannelData(0);
                const step = Math.floor(rawData.length / canvas.width);
                ctx.beginPath();
                for (let i = 0; i < canvas.width; i++) {
                    const amp = rawData[i * step] * (canvas.height/2);
                    ctx.lineTo(i, (canvas.height/2) - amp);
                }
                ctx.stroke();

                ctx.fillStyle = 'rgba(200,200,200,0.7)';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(extension.toUpperCase(), canvas.width/2, canvas.height-2);

                resolve(canvas.toDataURL('image/png'));
            } catch {
                const canvas = document.createElement('canvas');
                canvas.width = 112;
                canvas.height = 63;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'white';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(extension.toUpperCase(), canvas.width/2, canvas.height/2);
                resolve(canvas.toDataURL('image/png'));
            }
            return;
        }

        // 動画ファイル
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        let settled = false;
        const targetWidth = 120;
        const targetHeight = Math.round((targetWidth * 9) / 16);

        const cleanup = () => {
            video.onloadedmetadata = null;
            video.onseeked = null;
            video.onloadeddata = null;
            video.onerror = null;
            try { video.pause(); } catch (_) {}
            try { video.removeAttribute('src'); } catch (_) {}
            try { video.src = ''; } catch (_) {}
            try { video.load(); } catch (_) {}
        };

        const drawFrame = () => {
            const originalWidth = video.videoWidth || 0;
            const originalHeight = video.videoHeight || 0;
            if (originalWidth <= 0 || originalHeight <= 0) return false;

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const videoAspect = originalWidth / originalHeight;
            const canvasAspect = targetWidth / targetHeight;
            let drawWidth, drawHeight, offsetX, offsetY;
            if (videoAspect > canvasAspect) {
                drawWidth = targetWidth;
                drawHeight = Math.round(targetWidth / videoAspect);
                offsetX = 0;
                offsetY = Math.round((targetHeight - drawHeight) / 2);
            } else {
                drawWidth = Math.round(targetHeight * videoAspect);
                drawHeight = targetHeight;
                offsetX = Math.round((targetWidth - drawWidth) / 2);
                offsetY = 0;
            }
            ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
            resolve(canvas.toDataURL('image/png'));
            return true;
        };

        // 5秒ウォッチドッグ
        const watchdog = setTimeout(() => {
            if (settled) return;
            settled = true;
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
            cleanup();
            resolve(canvas.toDataURL('image/png'));
        }, 5000);

        video.onloadedmetadata = () => {
            const t = Math.min(1, Math.max(0.1, (video.duration || 1) * 0.1));
            video.currentTime = t;
            video.onseeked = () => {
                if (settled) return;
                requestAnimationFrame(() => {
                    if (settled) return;
                    if (drawFrame()) {
                        settled = true;
                        clearTimeout(watchdog);
                        cleanup();
                    } else {
                        fallbackToZero();
                    }
                });
            };
            setTimeout(() => {
                if (!settled) fallbackToZero();
            }, 2000);
        };

        function fallbackToZero() {
            if (settled) return;
            video.currentTime = 0;
            video.onloadeddata = () => {
                if (settled) return;
                if (drawFrame()) {
                    settled = true;
                    clearTimeout(watchdog);
                    cleanup();
                }
            };
        }

        video.onerror = () => {
            if (settled) return;
            settled = true;
            const canvas = document.createElement('canvas');
            canvas.width = 112;
            canvas.height = 63;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loading failed', canvas.width / 2, canvas.height / 2);
            showMessage(getMessage('not-supported-file-error'), 5000, 'alert');
            clearTimeout(watchdog);
            cleanup();
            resolve(canvas.toDataURL('image/png'));
        };
        video.src = filePath;
    });
}

// -----------------------
// プレイリストアイテム生成
// -----------------------
async function processFileData(file, currentPlaylist) {
    try {
        if (file.path && file.path.startsWith("UVC_DEVICE")) {
            // 必要なら deviceId を取り出す
            // const deviceId = file.path.replace("UVC_DEVICE:", "");
            const uvcItem = {
                playlistItem_id: file.playlistItem_id || `${Date.now()}-${Math.random()}`,
                path: file.path,
                name: file.name,
                resolution: file.resolution || "UVC",
                duration: "UVC",
                creationDate: "N/A",
                inPoint: "UVC",
                outPoint: "UVC",
                startMode: "PLAY",
                endMode: "UVC",
                defaultVolume: 0,
                selectionState: "unselected",
                editingState: null,
                onAirState: null,
                thumbnail: await generateThumbnail(file.path),
            };
            await window.electronAPI.stateControl.addFileToState(uvcItem);
            return uvcItem;
        }

        // FLAC処理
        if (file.path.toLowerCase().endsWith('.flac')) {
            const testAudio = new Audio(file.path);
            const canPlay = await new Promise(res => {
                const t = setTimeout(() => res(false), 3000);
                testAudio.addEventListener('loadedmetadata', () => { clearTimeout(t); res(true); });
                testAudio.addEventListener('error',       () => { clearTimeout(t); res(false); });
            });
            if (!canPlay) {
                const playable = await window.electronAPI.getPlayableFlac(file.path);
                file.path = playable;
                file.name = playable.split(/[/\\]/).pop();
            }
        }

        // 通常ファイル処理
        const metadata = await getMetadata(file.path);
        
        const newItem = {
            playlistItem_id: file.playlistItem_id || `${Date.now()}-${Math.random()}`,
            path: file.path,
            name: file.name,
            resolution: metadata.resolution || 'Unknown',
            duration: metadata.duration || 'Unknown',
            creationDate: metadata.creationDate || 'Unknown',
            inPoint: "00:00:00:00",
            outPoint: metadata.duration || "00:00:00:00",
            startMode: "PAUSE",
            endMode: "PAUSE",
            defaultVolume: 100,
            selectionState: "unselected",
            editingState: null,
            onAirState: null,
            thumbnail: await generateThumbnail(file.path),
        };
        const extension = file.path.split('.').pop().toLowerCase();
        newItem.isAudioFile = ['wav', 'mp3', 'flac', 'aac', 'm4a'].includes(extension);
        newItem.type = extension.toUpperCase();

        await window.electronAPI.stateControl.addFileToState(newItem);

        return newItem;
    } catch (error) {
        logInfo(`[playlist.js] Error processing file: ${file.name}, Error: ${error.message}`);
        return null;
    }
}

// 特殊文字エスケープ関数
function escapeSpecialCharacters(input) {
    return input.replace(/[#&%]/g, (char) => encodeURIComponent(char));
}

// ローカルファイルパスを安全なファイルURLに変換
function getSafeFileURL(filePath) {
    let normalizedPath = filePath.replace(/\\/g, '/');
    if (!/^file:\/\//.test(normalizedPath)) {
        normalizedPath = 'file:///' + normalizedPath;
    }
    let encoded = encodeURI(normalizedPath);
    encoded = encoded.replace(/#/g, '%23');
    return encoded;
}

// -----------------------
// メタデータ取得
// -----------------------
async function getMetadata(filePath) {
    try {
        if (filePath.startsWith("UVC_DEVICE")) {
            const deviceId = filePath.split(":")[1];
            const resolution = await getUVCResolution(deviceId);
            return {
                resolution: resolution || "Unknown",
                duration: "UVC",
                creationDate: "N/A"
            };
        }
        const metadata = await window.electronAPI.getMetadata(filePath);

        if (!metadata.resolution || !metadata.duration || !metadata.creationDate) {
        }
        const extension = filePath.split('.').pop().toLowerCase();
        const isAudioFile = ['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(extension);

        let creationDate = 'Unknown';
        try {
            if (metadata.creationDate) {
                creationDate = new Date(metadata.creationDate).toLocaleDateString();
            }
        } catch (dateError) {
            logInfo(`[playlist.js] Error processing creationDate for file: ${filePath}`);
        }
        return {
            resolution: isAudioFile ? 'Audio File' : (metadata.resolution || 'Unknown'),
            duration: metadata.duration || 'Unknown',
            creationDate,
        };
    } catch (error) {
        logInfo(`[playlist.js] Failed to retrieve metadata for file: ${filePath}, Error: ${error.message}`);
        return {
            resolution: 'Unknown',
            duration: 'Unknown',
            creationDate: 'Unknown',
        };
    }
}

// -----------------------
// UVCデバイスの解像度を取得
// -----------------------
async function getUVCResolution(deviceId) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                width:  { ideal: 1920 },
                height: { ideal: 1080 },
                aspectRatio: 16/9,
                resizeMode: "none"
            }
        });
        const track = stream.getVideoTracks()[0];
        try {
            const caps = (typeof track.getCapabilities === 'function') ? track.getCapabilities() : null;
            const targetW = caps && caps.width && typeof caps.width.max === 'number' ? Math.min(1920, caps.width.max) : 1920;
            const targetH = caps && caps.height && typeof caps.height.max === 'number' ? Math.min(1080, caps.height.max) : 1080;
            await track.applyConstraints({ width: targetW, height: targetH, aspectRatio: 16/9 });
        } catch (_) {}

        const settings = track.getSettings();
        track.stop();

        if (settings.width && settings.height) {
            return `${settings.width}x${settings.height}`;
        }
    } catch (error) {
        logInfo(`[playlist.js] Failed to get UVC resolution for deviceId: ${deviceId}, Error: ${error.message}`);
    }
    return "Unknown";
}

// ---------------------------
// プレイリストアイテム描画
// ---------------------------

function renderPlaylistItem(file, index) {
    const item = document.createElement('div');
    item.classList.add('playlist-item');
    item.playlistItem_id = file.playlistItem_id;
    item.setAttribute('data-playlist-item-id', file.playlistItem_id);
    item.setAttribute('data-file-path', file.path);
    item.setAttribute('draggable', 'true');

    // ドラッグ挿入位置の視覚インジケータ（●-----）
    const dragIndicator = document.createElement('div');
    dragIndicator.classList.add('drag-indicator');

    const dragIndicatorDot = document.createElement('div');
    dragIndicatorDot.classList.add('drag-indicator-dot');

    const dragIndicatorBar = document.createElement('div');
    dragIndicatorBar.classList.add('drag-indicator-bar');

    dragIndicator.appendChild(dragIndicatorDot);
    dragIndicator.appendChild(dragIndicatorBar);

    // absolute を効かせるため relative にしてインジケータを持たせる
    item.style.position = 'relative';
    item.appendChild(dragIndicator);
    item._dragIndicator = dragIndicator;

    // ドラッグ開始
    item.addEventListener('dragstart', (e) => {
        draggedPlaylistItemId = file.playlistItem_id;

        // ドラッグ元スロット（プレイリスト番号ボタンへのホバー切替・ドロップ移動用）
        draggedSourcePlaylistIndex = getActivePlaylistSlotOrDefault(1);
        dragOriginalActivePlaylistIndex = draggedSourcePlaylistIndex;
        dragDropCompleted = false;
        dragHoverTargetPlaylistIndex = draggedSourcePlaylistIndex;

        // ドラッグ開始時点のソースプレイリストをスナップショット（プレイリスト切替後の移動に使う）
        dragSourcePlaylistSnapshot = null;
        void (async () => {
            try {
                const src = await stateControl.getPlaylistState();
                if (Array.isArray(src)) {
                    dragSourcePlaylistSnapshot = src.map(item => ({ ...item }));
                }
            } catch (e) {
                // ignore
            }
        })();

        try {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copyMove';
                e.dataTransfer.setData('text/plain', String(file.playlistItem_id));
            }
        } catch (error) {
            logDebug('[playlist.js] dragstart dataTransfer error:', error);
        }
        item.classList.add('dragging');
    });

    // ドラッグ終了
    item.addEventListener('dragend', () => {
        const restoreSlot = (!dragDropCompleted
            && typeof dragOriginalActivePlaylistIndex === 'number'
            && dragOriginalActivePlaylistIndex >= 1 && dragOriginalActivePlaylistIndex <= 9
            && activePlaylistIndex !== dragOriginalActivePlaylistIndex)
            ? dragOriginalActivePlaylistIndex
            : null;

        draggedPlaylistItemId = null;
        draggedSourcePlaylistIndex = null;
        dragSourcePlaylistSnapshot = null;
        dragHoverTargetPlaylistIndex = null;
        if (dragHoverSwitchTimer) {
            clearTimeout(dragHoverSwitchTimer);
            dragHoverSwitchTimer = null;
        }

        item.classList.remove('dragging');
        clearDragIndicators();

        if (restoreSlot !== null) {
            void restorePlaylistAfterCanceledDrag(restoreSlot);
        }

        dragOriginalActivePlaylistIndex = null;
        dragDropCompleted = false;
        dragHoverSwitchInProgress = false;
    });

    // 区切り線
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
            const isCopy = !!(e.ctrlKey || e.metaKey);
            e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
        }

        const rect = item.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const isAfter = offsetY > rect.height / 2;

        clearDragIndicators();

        item.classList.add('drag-over');

        if (isAfter) {
            // 下側
            item.dataset.dropPosition = 'after';
            if (item._dragIndicator) {
                item._dragIndicator.style.top = `${rect.height - 3}px`; // 6px の半分だけ外へ
                item._dragIndicator.style.display = 'flex';
            }
        } else {
            // 上側
            item.dataset.dropPosition = 'before';
            if (item._dragIndicator) {
                item._dragIndicator.style.top = `-3px`; // 6px の半分だけ外へ
                item._dragIndicator.style.display = 'flex';
            }
        }
    });

    // ドラッグ外れ
    item.addEventListener('dragleave', () => {
        clearDragIndicators();
    });

    // 並替実行
    item.addEventListener('drop', async (e) => {
        e.preventDefault();

        const sourceId =
            draggedPlaylistItemId ||
            (e.dataTransfer && e.dataTransfer.getData('text/plain'));

        if (!sourceId || String(sourceId) === String(file.playlistItem_id)) {
            clearDragIndicators();
            return;
        }
        let dropPosition = item.dataset.dropPosition || 'before';

        const container = item.parentElement;
        if (container) {
            const items = Array.from(container.querySelectorAll('.playlist-item'));
            const isLast = items.length > 0 && items[items.length - 1] === item;
            if (isLast && dropPosition === 'before') {
                dropPosition = 'after';
            }
        }

        const isCopy = !!(e.ctrlKey || e.metaKey);

        if (isCopy) {
            await copyPlaylistByDrag(sourceId, file.playlistItem_id, dropPosition);
        } else {
            await reorderPlaylistByDrag(sourceId, file.playlistItem_id, dropPosition);
        }

        // ドロップ完了後に、そのスロットをアクティブ（緑）に確定
        setActiveStoreButton(activePlaylistIndex);

        clearDragIndicators();
    });

    // アイテムクリック時
    item.addEventListener('click', () => {
        logOpe(`[listedit.js] Playlist item clicked (index: ${index})`);
        handlePlaylistItemClick(item, index);
    });

    // ダブルクリック時
    item.addEventListener('dblclick', () => {
        logOpe(`[listedit.js] Playlist item double-clicked (index: ${index})`);
        if (soundPadActive) {
            handleSoundPadOnAir(item, index);
        } else if (directOnAirActive) {
            handleDirectOnAir(item, index);
        }
    });

    // 右クリックコンテキストメニュー表示
    item.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        // プレイリスト読み込み中は編集禁止
        if (isImporting) {
            logInfo('[playlist.js] Playlist is currently importing. Context menu actions are disabled.');
            showMessage(getMessage('playlist-importing-cannot-edit'), 5000, 'info');
            return;
        }

        logOpe(`[playlist.js] Playlist item contextmenu opened (index: ${index})`);

        // 右クリックでもアイテムを選択
        handlePlaylistItemClick(item, index);

        showPlaylistItemContextMenu(event.clientX, event.clientY, file.playlistItem_id);
    });

    // ▲▼DELの生成
    const moveButtons = createMoveButtons(item);

    // ▲▼DEL用ラッパー
    const controlsWrapper = document.createElement('div');
    controlsWrapper.classList.add('playlist-controls');
    controlsWrapper.appendChild(moveButtons);

    // サムネイル生成
    const thumbnailContainer = createThumbnail(file);

    // ファイル情報生成
    const fileInfo = createFileInfo(file, index);

    // ステータスエリア生成
    const statusContainer = createStatusContainer(file);

    // アイテムにコントロール群、サムネイル、ファイル情報、ステータス追加
    item.appendChild(controlsWrapper);
    item.appendChild(thumbnailContainer);
    item.appendChild(fileInfo);
    item.appendChild(statusContainer);

    // 状態をUIに反映
    updateItemStateClass(item, file);

    return item;
}

// 区切り線リセット
function clearDragIndicators() {
    const items = document.querySelectorAll('.playlist-item');
    items.forEach((el) => {
        el.classList.remove('drag-over');
        el.style.boxShadow = '';
        el.removeAttribute('data-drop-position');

        if (el._dragIndicator) {
            el._dragIndicator.style.display = 'none';
        }
    });

    const containers = document.querySelectorAll('.playlist-items');
    containers.forEach((container) => {
        if (container && container._dragContainerIndicator) {
            container._dragContainerIndicator.style.display = 'none';
        }
        const di = container ? container.querySelector('.drag-container-indicator') : null;
        if (di) {
            di.style.display = 'none';
        }
    });

    const buttons = document.querySelectorAll('[id^="playlise"][id$="-button"]');
    buttons.forEach((btn) => {
        if (!btn) {
            return;
        }
        btn.classList.remove('playlist-button-drag-hover');
        if (btn.style) {
            btn.style.outline = '';
        }
    });
}

// 操作ボタン生成
function createMoveButtons(item) {
    const moveButtons = document.createElement('div');
    moveButtons.classList.add('move-buttons');

    const moveUpButton = createButton('▲', 'move-up', () => movePlaylistItem(item, -1));
    const moveDownButton = createButton('▼', 'move-down', () => movePlaylistItem(item, 1));
    const deleteButton = createButton('DEL', 'delete-button', () => {
        logOpe(`[playlist.js] Delete button clicked for item with ID: ${item.playlistItem_id}`);
        deletePlaylistItem(item.playlistItem_id);
    });
    moveButtons.appendChild(moveUpButton);
    moveButtons.appendChild(moveDownButton);
    moveButtons.appendChild(deleteButton);

    return moveButtons;
}

// ボタン生成ヘルパー
function createButton(text, className, onClick) {
    const button = document.createElement('button');
    button.classList.add(className);
    button.textContent = text;

    // 実行ロジック共通化
    function handleAction() {
        logOpe(`[playlist.js] Button clicked: ${text}`);
        onClick();
    }

    // マウス操作・ショートカット
    button.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleAction();
    });

    // キーボード操作（Space/Enter）からの click
    button.addEventListener('click', (event) => {
        if (event.detail !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleAction();
    });

    return button;
}

// サムネイル生成
function createThumbnail(file) {
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.classList.add('thumbnail-container');

    const isUVC = (file && typeof file.path === 'string' && file.path.startsWith('UVC_DEVICE:'));

    // UVC: thumbnail(HTMLElement) が無い場合でも、描画時に再生成して貼り替える
    if (isUVC) {
        if (file.thumbnail instanceof HTMLElement) {
            thumbnailContainer.appendChild(file.thumbnail);
            return thumbnailContainer;
        }

        // プレースホルダ（コピー直後など）
        const placeholder = document.createElement('div');
        placeholder.style.width = '100%';
        placeholder.style.height = '100%';
        placeholder.style.display = 'flex';
        placeholder.style.alignItems = 'center';
        placeholder.style.justifyContent = 'center';
        placeholder.style.backgroundColor = 'black';
        placeholder.style.color = 'white';
        placeholder.style.fontSize = '12px';
        placeholder.textContent = 'Loading...';
        thumbnailContainer.appendChild(placeholder);

        // 非同期でUVCサムネイルを生成して差し替え
        (async () => {
            try {
                const thumb = await generateThumbnail(file.path);

                // 既に再描画されている等で、このコンテナがDOMから外れていたら何もしない
                if (!thumbnailContainer.isConnected) return;

                // 念のため「このアイテムの現在のサムネイル枠」と一致する場合のみ差し替え
                const itemEl = document.querySelector(`.playlist-item[data-playlist-item-id="${file.playlistItem_id}"]`);
                if (!itemEl) return;
                const currentContainer = itemEl.querySelector('.thumbnail-container');
                if (currentContainer !== thumbnailContainer) return;

                while (thumbnailContainer.firstChild) {
                    thumbnailContainer.removeChild(thumbnailContainer.firstChild);
                }

                if (thumb instanceof HTMLElement) {
                    thumbnailContainer.appendChild(thumb);
                } else if (typeof thumb === 'string' && thumb.length > 0) {
                    const img = document.createElement('img');
                    img.src = thumb;
                    img.alt = `Thumbnail for ${file.name}`;
                    img.classList.add('thumbnail-image');
                    thumbnailContainer.appendChild(img);
                }
            } catch (e) {
                // 失敗時はプレースホルダのまま（ログは増やさない）
            }
        })();

        return thumbnailContainer;
    }

    // 通常ファイル: 既存挙動
    if (file.thumbnail instanceof HTMLElement) {
        thumbnailContainer.appendChild(file.thumbnail);
    } else {
        const thumbnailImg = document.createElement('img');
        thumbnailImg.src = file.thumbnail || 'path/to/default-thumbnail.png';
        thumbnailImg.alt = `Thumbnail for ${file.name}`;
        thumbnailImg.classList.add('thumbnail-image');
        thumbnailContainer.appendChild(thumbnailImg);
    }
    return thumbnailContainer;
}

// ファイル情報生成
function createFileInfo(file, index) {
    const fileInfo = document.createElement('div');
    fileInfo.classList.add('file-info');

    const inPoint = file.inPoint || "00:00:00:00";
    const outPoint = file.outPoint || "00:00:00:00";
    const fileName = file.mediaOffline ? 'Media Offline' : file.name;
    const fileNameClass = file.mediaOffline ? 'file-name media-offline' : 'file-name';
    let fileType = '';
    if (typeof file.path === 'string' && file.path.startsWith('UVC_DEVICE')) {
        fileType = 'UVC';
    } else {
        fileType = file.type || file.path.split('.').pop().toUpperCase();
    }

    // ファイル名番号ラベル
    fileInfo.innerHTML = `
        <div class="file-header-row">
            <div class="playlist-index-label">${String(index + 1)}</div>
            <p class="${fileNameClass}">${fileName}</p>
        </div>
        <div class="file-details-grid">
            <div class="file-details-grid">
                <div class="file-details-row">
                    <span class="label">RES</span><span class="value">${file.resolution}</span>
                    <span class="label">IN</span><span class="value">${inPoint}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">DUR</span><span class="value">${file.duration}</span>
                    <span class="label">OUT</span><span class="value">${outPoint}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">TYPE</span><span class="value">${fileType}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">VOL</span><span class="value">${file.defaultVolume !== undefined ? file.defaultVolume : 100}%</span>
                </div>
            </div>
        </div>
    `;
    return fileInfo;
}

// ステータスエリア生成
function resolveGotoDisplayForStatus(endGotoPlaylist, endGotoItemId) {
    const storeNumber = Number(endGotoPlaylist);
    if (!Number.isFinite(storeNumber) || storeNumber < 1 || storeNumber > 9) {
        return null;
    }

    const itemId = (typeof endGotoItemId === 'string' && endGotoItemId) ? endGotoItemId : null;

    let itemNumber = null;
    if (itemId) {
        const key = `vtrpon_playlist_store_${storeNumber}`;
        const stored = localStorage.getItem(key);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                const data = Array.isArray(parsed.data) ? parsed.data : [];
                const sorted = data.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
                const idx = sorted.findIndex((it) => it && it.playlistItem_id === itemId);
                if (idx !== -1) {
                    itemNumber = idx + 1;
                }
            } catch (e) {
                itemNumber = null;
            }
        }
    }

    if (itemNumber !== null) {
        return `${storeNumber}/${itemNumber}`;
    }
    return `${storeNumber}/?`;
}

function createStatusContainer(file) {
    const statusContainer = document.createElement('div');
    statusContainer.classList.add('status-container');
    const startVal = file.startMode;

    const baseEnd = file.endMode || 'OFF';
    let endVal = file.ftbEnabled ? `FADEOUT_${baseEnd}` : baseEnd;

    // REPEAT の場合は回数/終了後エンドモードを表示に含める
    if (baseEnd === 'REPEAT') {
        const rawCount = file.repeatCount;
        const parsedCount = (Number.isFinite(Number(rawCount)) && Number(rawCount) >= 1)
            ? Math.floor(Number(rawCount))
            : undefined;
        const countStr = (parsedCount !== undefined) ? String(parsedCount) : '∞';

        const rawAfter = file.repeatEndMode;
        const afterVal = (rawAfter === 'PAUSE' || rawAfter === 'OFF' || rawAfter === 'NEXT')
            ? rawAfter
            : '';

        let repeatText = `REPEAT(${countStr})`;
        if (parsedCount !== undefined && afterVal) {
            repeatText += `→${afterVal}`;
        }
        endVal = file.ftbEnabled ? `FADEOUT_${repeatText}` : repeatText;
    }

    // GOTO の場合はとび先プレイリスト/アイテム番号を表示に含める
    if (baseEnd === 'GOTO') {
        const gotoDisplay = resolveGotoDisplayForStatus(file.endGotoPlaylist, file.endGotoItemId);
        if (gotoDisplay) {
            const prefix = file.ftbEnabled ? 'FADEOUT_' : '';
            endVal = `${prefix}GOTO→${gotoDisplay}`;
        } else {
            endVal = file.ftbEnabled ? 'FADEOUT_GOTO' : 'GOTO';
        }
    }

    const statusList = [
        { label: 'START', value: startVal },
        { label: 'END', value: endVal },
    ];

    statusList.forEach(({ label, value }) => {
        const statusRow = document.createElement('div');
        statusRow.classList.add('status-row');
        statusRow.innerHTML = `
            <span class="status-label">${label}</span>
            <span class="status-value">${value}</span>
        `;
        statusContainer.appendChild(statusRow);
    });
    return statusContainer;
}

function updateItemStateClass(item, file) {
    item.classList.remove('onair', 'editing', 'selected');

    // 状態を順番に適用（優先順位: onair > editing > selected）
    if (file.onAirState === "onair") {
        item.classList.add('onair');
    } else {
        item.classList.remove('onair');
    }

    if (file.editingState === "editing") {
        item.classList.add('editing');
    } else {
        item.classList.remove('editing');
    }

    if (file.selectionState === "selected") {
        item.classList.add('selected');
    } else {
        item.classList.remove('selected');
    }
    if (file.dskActive) {
        item.classList.add('dsk-active');
    }

    // 背景色（プレイリスト色分け）反映
    const bgKeyRaw = (file.bgColor || 'default');
    const bgKey = String(bgKeyRaw).toLowerCase();

    const BG_COLOR_MAP = {
        default: '',
        gray: '',
        grey: '',
        red: 'rgba(255, 120, 120, 0.28)',
        yellow: 'rgba(255, 235, 120, 0.30)',
        blue: 'rgba(120, 180, 255, 0.28)',
        green: 'rgba(140, 230, 160, 0.28)'
    };

    const nextBg = BG_COLOR_MAP[bgKey] ?? '';
    if (nextBg) {
        item.style.backgroundColor = nextBg;
    } else {
        item.style.backgroundColor = '';
    }
}

// -----------------------
// プレイリストUI更新処理
// -----------------------

// プレイリストID設定関数
function setCurrentPlaylistId(playlistId) {
    currentPlaylistId = playlistId;
}
let currentPlaylistId = null;  // 現在プレイリストID追跡

// 高解像度対応：プレイリスト高さ調整関数
function adjustPlaylistHeight() {
  const playlist = document.querySelector('.playlist-items');
  if (!playlist) return;
  const top = playlist.getBoundingClientRect().top;
  const footer = document.getElementById('important-button-area');
  const footerHeight = footer ? footer.offsetHeight : 0;
  const margin = 20;
  playlist.style.maxHeight = (window.innerHeight - top - footerHeight - margin) + 'px';
}

// ページ読み込み＆リサイズ時に高さ調整
window.addEventListener('load',  adjustPlaylistHeight);
window.addEventListener('resize', adjustPlaylistHeight);

// プレイリストUI更新処理
async function updatePlaylistUI() {
    const playlistItemsContainer = document.querySelector('.playlist-items');
    const playlist = await stateControl.getPlaylistState();

    if (!Array.isArray(playlist)) {
        logInfo('[playlist.js] Playlist is not an array:', playlist);
        return;
    }
    try {
        const currentDSKItem =
            window.dskModule && typeof window.dskModule.getCurrentDSKItem === 'function'
                ? window.dskModule.getCurrentDSKItem()
                : null;
        let needUpdate = false;
        if (currentDSKItem && currentDSKItem.playlistItem_id) {
            const existsHere = playlist.some(it => it.playlistItem_id === currentDSKItem.playlistItem_id);
            if (existsHere) {
                for (const it of playlist) {
                    const should = it.playlistItem_id === currentDSKItem.playlistItem_id;
                    if ((it.dskActive || false) !== should) {
                        it.dskActive = should;
                        needUpdate = true;
                    }
                }
            } else {
                for (const it of playlist) {
                    if (it.dskActive) {
                        it.dskActive = false;
                        needUpdate = true;
                    }
                }
            }
        } else {
            for (const it of playlist) {
                if (it.dskActive) {
                    it.dskActive = false;
                    needUpdate = true;
                }
            }
        }
        if (needUpdate) {
            await stateControl.setPlaylistState(playlist);
        }
    } catch (e) {
        logInfo('[playlist.js] DSK reconcile failed:', e);
    }
    // ソート
    const sortedPlaylist = playlist.sort((a, b) => a.order - b.order);

    // DnD: 空リスト/末尾ドロップを受けるため、コンテナ側のリスナーを一度だけバインド
    bindPlaylistContainerDragDrop(playlistItemsContainer);

    // プレイリストアイテム削除
    playlistItemsContainer.innerHTML = '';

    const renderedItems = []; // 描画されたアイテム記録

    // 各プレイリストアイテム描画
    sortedPlaylist.forEach((file, index) => {
        const item = renderPlaylistItem(file, index);

        // 初期化
        item.classList.remove('selected', 'editing', 'onair');

        // 状態に応じたクラスの付与
        if (file.onAirState === "onair") {
            item.classList.add('onair');
        } else {
            item.classList.remove('onair');
        }

        if (file.editingState === "editing") {
            item.classList.add('editing');
        } else {
            item.classList.remove('editing');
        }

        if (file.selectionState === "selected") {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }

        // コンテナ追加
        playlistItemsContainer.appendChild(item);

        // 描画されたアイテム記録
        renderedItems.push({
            path: file.path,
            selected: item.classList.contains('selected'),
            editing: item.classList.contains('editing'),
            onair: item.classList.contains('onair'),
        });
    });

    // DnD: コンテナ末尾用インジケータ（updatePlaylistUI の都度作り直す）
    const containerIndicator = createPlaylistContainerDragIndicator();
    playlistItemsContainer.appendChild(containerIndicator);
    playlistItemsContainer._dragContainerIndicator = containerIndicator;

    // 高解像度対応
    adjustPlaylistHeight();
}

// ----------------------
// エディットに動画を送る
// ----------------------

async function handlePlaylistItemClick(item, index) {
    const targetPlaylistItemId = item.playlistItem_id;
    logOpe(`[playlist.js] Handling click for ID: ${targetPlaylistItemId}`);

    if (!targetPlaylistItemId) {
        logInfo("[playlist.js] Failed to retrieve playlistItem_id from DOM. Item:", item);
        return;
    }

    // ファイル存在確認（UVC_DEVICEは除外）
    const currentPlaylist = await stateControl.getPlaylistState();
    const selectedItemCheck = currentPlaylist.find(file => file.playlistItem_id === targetPlaylistItemId);
    if (selectedItemCheck && selectedItemCheck.converting) {
        logInfo(`[playlist.js] Conversion in progress for selected item: ${selectedItemCheck.name}`);
        showMessage(getMessage('conversion-in-progress-cannot-select-item'), 5000, 'alert');
        item.classList.remove('selected');
        return;
    }
    if (selectedItemCheck && !(selectedItemCheck.path === "UVC_DEVICE" || (typeof selectedItemCheck.path === 'string' && selectedItemCheck.path.startsWith("UVC_DEVICE")))) {
        const exists = await window.electronAPI.checkFileExists(selectedItemCheck.path);
        if (!exists) {
            logInfo(`[playlist.js] File not found for selected item: ${selectedItemCheck.name}`);
            showMessage(`${getMessage('media-offline')} ${selectedItemCheck.name}`, 5000, 'alert');
            return;
        }
    }
    try {
        // プレイリスト状態取得
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist state is not an array:', playlist);
            return;
        }

        // 現在の選択インデックス更新
        const playlistItems = Array.from(document.querySelectorAll('.playlist-item'));
        currentSelectedIndex = playlistItems.findIndex(el => el.dataset.playlistItemId === targetPlaylistItemId);

        // プレイリストの選択状態と編集状態更新
        const updatedPlaylist = playlist.map(file => ({
            ...file,
            selectionState: file.playlistItem_id === targetPlaylistItemId ? "selected" : "unselected",
            editingState: file.playlistItem_id === targetPlaylistItemId ? "editing" : null
        }));

        // プレイリスト保存
        await stateControl.setPlaylistState(
            updatedPlaylist.map(item => ({
                ...item,
                order: Number(item.order),
            }))
        );

        // プレイリストUI更新
        await updatePlaylistUI();

        // 選択されたアイテム取得
        const selectedItem = updatedPlaylist.find(item => item.selectionState === "selected");
        if (!selectedItem) {
            logInfo('[playlist.js] No selected item to send to edit area.');
            return;
        }

        // UVCデバイスの場合はエディットエリアに送らない
        if (selectedItem && (selectedItem.endMode === "UVC" || (typeof selectedItem.path === 'string' && selectedItem.path.startsWith("UVC_DEVICE")))) {
            logInfo(`[playlist.js] UVC device "${selectedItem.name}" selected. Skipping edit area update.`);
            showMessage(getMessage('uvc-devices-cannot-be-edited'), 10000, 'info');
            // エディットエリアをクリア
            window.electronAPI.updateEditState(null);
            return;
        }

        // エディットエリアに選択されたアイテム送信
        window.electronAPI.updateEditState(selectedItem);
        logOpe(`Playlist item sent to edit area with ID: ${selectedItem.playlistItem_id}`);
    } catch (error) {
        logInfo('[playlist.js] Error handling playlist item click:', error);
    }
}

// 選択状態更新
function setSelectionState(index) {
    const playlist = stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map((item, idx) => {
        if (item.onAirState === "onair") {
            return { ...item, selectionState: "unselected" };
        }
        return { 
            ...item, 
            selectionState: idx === index ? "selected" : "unselected" 
        };
    });

    stateControl.setPlaylistState(updatedPlaylist);
    updatePlaylistUI();
    logInfo(`[playlist.js] Playlist selection changed to index: ${index}`);
}

// アイテムの編集状態更新
function setEditingState(itemId) {
    const playlist = stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(item => {
        // `onAirState` が "onair" のアイテムは編集対象から除外
        if (item.onAirState === "onair") {
            return { ...item, editingState: null };
        }
        return { 
            ...item, 
            editingState: item.playlistItem_id === itemId ? "editing" : null 
        };
    });

    stateControl.setPlaylistState(updatedPlaylist);
    updatePlaylistUI();
    logInfo(`[playlist.js] Playlist item sent to edit area with ID: ${itemId}`);
}

// ---------------------------
// プレイリストアイテムの削除
// ---------------------------
async function deletePlaylistItem(itemId) {
    const success = await window.electronAPI.stateControl.deleteItemFromPlaylist(itemId);
    if (success) {
        await updatePlaylistUI();
        try {
            if (typeof saveActivePlaylistToStore === 'function') {
                await saveActivePlaylistToStore();
            }
        } catch (e) {
            logInfo('[playlist.js] Auto-save after deletePlaylistItem failed (ignored):', e);
        }

    } else {
        logInfo('[playlist.js] Failed to delete playlist item. Not found.');
    }
    await simulateRightArrowKey();
    logOpe("[playlist.js] edit clear.");
}

// ---------------------------
// プレイリストアイテム名の変更
// ---------------------------
async function renamePlaylistItemName(itemId, newName) {
    try {
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist is not an array while renaming item.');
            return;
        }

        const updatedPlaylist = playlist.map((item) => {
            if (String(item.playlistItem_id) === String(itemId)) {
                return {
                    ...item,
                    name: newName
                };
            }
            return item;
        });

        await stateControl.setPlaylistState(updatedPlaylist);
        await updatePlaylistUI();

        try {
            if (typeof saveActivePlaylistToStore === 'function') {
                await saveActivePlaylistToStore();
            }
        } catch (e) {
            logInfo('[playlist.js] Auto-save after renamePlaylistItemName failed (ignored):', e);
        }

        logOpe(`[playlist.js] Playlist item renamed. ID: ${itemId}, new name: ${newName}`);
    } catch (error) {
        logInfo(`[playlist.js] Failed to rename playlist item. Error: ${error.message}`);
    }
}

// ------------------------------------
// ドラッグ＆ドロップによる並び替え処理
// ------------------------------------

function isValidPlaylistStoreNumber(n) {
    return (typeof n === 'number' && n >= 1 && n <= 9);
}

function getPlaylistStoreKey(storeNumber) {
    return `vtrpon_playlist_store_${storeNumber}`;
}

function readPlaylistStorePayload(storeNumber) {
    if (!isValidPlaylistStoreNumber(storeNumber)) {
        return null;
    }
    const key = getPlaylistStoreKey(storeNumber);
    const raw = localStorage.getItem(key);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        logInfo(`[playlist.js] Failed to parse localStorage(${key}): ${error?.stack || error?.message || error}`);
        return null;
    }
}

function resetPlaylistStoreItemRuntimeState(item) {
    if (!item || typeof item !== 'object') {
        return item;
    }

    item.isSelected = false;
    item.isEditing = false;
    item.isOnAir = false;
    item.isDirectModeOnAir = false;
    item.directModeOnAirStatus = '';
    item.fillKeyModeOnAirStatus = '';

    return item;
}

function normalizePlaylistDataForStore(data) {
    const arr = Array.isArray(data) ? data.slice() : [];
    return arr.map((item, index) => normalizePlaylistStoreItemForStore(item, index));
}

function writePlaylistStoreData(storeNumber, data) {
    if (!isValidPlaylistStoreNumber(storeNumber)) {
        return;
    }
    const key = getPlaylistStoreKey(storeNumber);

    const prev = readPlaylistStorePayload(storeNumber) || {};
    const next = {
        name: (typeof prev.name === 'string' && prev.name.trim() !== '') ? prev.name : `Playlist ${storeNumber}`,
        endMode: prev.endMode ?? null,
        soundPadMode: !!prev.soundPadMode,
        directOnAirMode: !!prev.directOnAirMode,
        fillKeyMode: !!prev.fillKeyMode,
        dskCurrentItemId: prev.dskCurrentItemId ?? null,
        data: normalizePlaylistDataForStore(data)
    };

    try {
        localStorage.setItem(key, JSON.stringify(next));
    } catch (error) {
        logInfo(`[playlist.js] Failed to save localStorage(${key}): ${error?.stack || error?.message || error}`);
    }

    const button = document.getElementById(`playlise${storeNumber}-button`);
    if (button) {
        if (Array.isArray(next.data) && next.data.length > 0) {
            button.classList.add('playlist-saved');
        } else {
            button.classList.remove('playlist-saved');
        }
    }

    // ボタン色などの更新（存在する場合のみ）
    try {
        if (typeof updateStoreButtons === 'function') {
            updateStoreButtons();
        }
    } catch (error) {
        // ignore
    }
}

function createPlaylistContainerDragIndicator() {
    const indicator = document.createElement('div');
    indicator.classList.add('drag-container-indicator');

    const dot = document.createElement('div');
    dot.classList.add('drag-container-indicator-dot');
    indicator.appendChild(dot);

    const bar = document.createElement('div');
    bar.classList.add('drag-container-indicator-bar');
    indicator.appendChild(bar);

    return indicator;
}

function bindPlaylistContainerDragDrop(container) {
    if (!container || !container.dataset) {
        return;
    }
    if (container.dataset.playlistDragDropBound === '1') {
        return;
    }
    container.dataset.playlistDragDropBound = '1';

    const getContainerDropTarget = (clientY) => {
        const items = Array.from(container.querySelectorAll('.playlist-item'));
        if (items.length === 0) {
            return { mode: 'empty', targetItem: null, dropPosition: 'after' };
        }

        for (const it of items) {
            const r = it.getBoundingClientRect();
            const mid = r.top + (r.height / 2);

            if (clientY < mid) {
                return { mode: 'item', targetItem: it, dropPosition: 'before' };
            }
            if (clientY <= r.bottom) {
                return { mode: 'item', targetItem: it, dropPosition: 'after' };
            }
        }

        return { mode: 'item', targetItem: items[items.length - 1], dropPosition: 'after' };
    };

    const showItemDropIndicator = (targetItem, dropPosition) => {
        if (!targetItem) {
            return;
        }

        targetItem.classList.add('drag-over');

        const rect = targetItem.getBoundingClientRect();
        if (targetItem._dragIndicator) {
            if (dropPosition === 'after') {
                targetItem._dragIndicator.style.top = `${rect.height - 3}px`; // 6px の半分だけ外へ
            } else {
                targetItem._dragIndicator.style.top = `-3px`; // 6px の半分だけ外へ
            }
            targetItem._dragIndicator.style.display = 'flex';
        }
    };

    // 空リスト／末尾・先頭・隙間ドロップ用（アイテム上のドロップは各アイテム側の drop で処理）
    container.addEventListener('dragover', (e) => {
        if (!draggedPlaylistItemId) {
            return;
        }
        if (e.target && e.target.closest && e.target.closest('.playlist-item')) {
            return;
        }
        e.preventDefault();
        if (e.dataTransfer) {
            const isCopy = !!(e.ctrlKey || e.metaKey);
            e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
        }

        clearDragIndicators();

        const indicator = container._dragContainerIndicator;
        const info = getContainerDropTarget(e.clientY);

        // 空プレイリストの場合はマーカーを表示しない（位置が不自然になるため）
        if (info.mode === 'empty') {
            if (indicator) {
                indicator.style.display = 'none';
            }
            return;
        }

        if (indicator) {
            indicator.style.display = 'none';
        }
        showItemDropIndicator(info.targetItem, info.dropPosition);
    });

    container.addEventListener('dragleave', (e) => {
        if (!draggedPlaylistItemId) {
            return;
        }
        if (e.relatedTarget && container.contains(e.relatedTarget)) {
            return;
        }

        clearDragIndicators();

        const indicator = container._dragContainerIndicator;
        if (indicator) {
            indicator.style.display = 'none';
        }
    });

    container.addEventListener('drop', async (e) => {
        if (!draggedPlaylistItemId) {
            return;
        }
        if (e.target && e.target.closest && e.target.closest('.playlist-item')) {
            return;
        }
        e.preventDefault();

        const isCopy = !!(e.ctrlKey || e.metaKey);

        const sourceId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) ? e.dataTransfer.getData('text/plain') : draggedPlaylistItemId;
        if (!sourceId) {
            return;
        }

        const info = getContainerDropTarget(e.clientY);

        if (info.mode === 'empty') {
            if (isCopy) {
                await copyPlaylistByDrag(sourceId, null, 'after');
            } else {
                await reorderPlaylistByDrag(sourceId, null, 'after');
            }
            // ドロップ完了後に、そのスロットをアクティブ（緑）に確定
            setActiveStoreButton(activePlaylistIndex);
            return;
        }

        const targetId = info.targetItem ? info.targetItem.getAttribute('data-playlist-item-id') : null;
        if (!targetId) {
            if (isCopy) {
                await copyPlaylistByDrag(sourceId, null, 'after');
            } else {
                await reorderPlaylistByDrag(sourceId, null, 'after');
            }
            // ドロップ完了後に、そのスロットをアクティブ（緑）に確定
            setActiveStoreButton(activePlaylistIndex);
            return;
        }

        if (isCopy) {
            await copyPlaylistByDrag(sourceId, targetId, info.dropPosition);
        } else {
            await reorderPlaylistByDrag(sourceId, targetId, info.dropPosition);
        }
        // ドロップ完了後に、そのスロットをアクティブ（緑）に確定
        setActiveStoreButton(activePlaylistIndex);
    });
}

function scheduleSwitchPlaylistDuringDragHover(storeNumber) {
    if (!draggedPlaylistItemId) {
        return;
    }
    if (!isValidPlaylistStoreNumber(storeNumber)) {
        return;
    }
    if (dragHoverTargetPlaylistIndex === storeNumber) {
        return;
    }

    dragHoverTargetPlaylistIndex = storeNumber;

    if (dragHoverSwitchTimer) {
        clearTimeout(dragHoverSwitchTimer);
        dragHoverSwitchTimer = null;
    }
    dragHoverSwitchTimer = setTimeout(() => {
        void switchPlaylistForDragHover(storeNumber);
    }, 120);
}

async function switchPlaylistForDragHover(storeNumber) {
    if (!draggedPlaylistItemId) {
        return;
    }
    if (!isValidPlaylistStoreNumber(storeNumber)) {
        return;
    }
    if (activePlaylistIndex === storeNumber) {
        return;
    }
    if (dragHoverSwitchInProgress) {
        return;
    }
    dragHoverSwitchInProgress = true;

    try {
        activePlaylistIndex = storeNumber;
        await loadPlaylist(storeNumber);
    } catch (error) {
        logInfo(`[playlist.js] Failed to switch playlist for drag hover: ${error?.stack || error?.message || error}`);
    } finally {
        dragHoverSwitchInProgress = false;
    }
}

async function restorePlaylistAfterCanceledDrag(storeNumber) {
    if (!isValidPlaylistStoreNumber(storeNumber)) {
        return;
    }
    try {
        activePlaylistIndex = storeNumber;
        await loadPlaylist(storeNumber);
        setActiveStoreButton(storeNumber);
    } catch (error) {
        logInfo(`[playlist.js] Failed to restore playlist after canceled drag: ${error?.stack || error?.message || error}`);
    }
}

async function reorderPlaylistByDrag(sourcePlaylistItemId, targetPlaylistItemId, dropPosition) {
    try {
        const dropTargetStoreIndex = activePlaylistIndex;

        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist state is invalid.');
            return;
        }

        const srcId = String(sourcePlaylistItemId);
        const tgtId = (targetPlaylistItemId === null || targetPlaylistItemId === undefined || targetPlaylistItemId === '') ? null : String(targetPlaylistItemId);

        // ターゲット位置（"null" の場合は末尾）
        const targetIndexBefore = (tgtId === null)
            ? playlist.length
            : playlist.findIndex(p => String(p.playlistItem_id) === tgtId);

        // 現在プレイリスト内にソースがあるか（同一プレイリスト内の並び替え判定）
        const currentIndex = playlist.findIndex(p => String(p.playlistItem_id) === srcId);

        // (A) 他プレイリストからの移動
        if (currentIndex === -1) {
            if (!isValidPlaylistStoreNumber(draggedSourcePlaylistIndex) || draggedSourcePlaylistIndex === dropTargetStoreIndex) {
                logInfo('[playlist.js] Drag source playlist is not available.');
                return;
            }
            if (tgtId !== null && targetIndexBefore === -1) {
                logInfo(`[playlist.js] Target item not found: ${targetPlaylistItemId}`);
                return;
            }

            const sourcePayload = readPlaylistStorePayload(draggedSourcePlaylistIndex);
            const sourceData = Array.isArray(dragSourcePlaylistSnapshot) ? dragSourcePlaylistSnapshot.slice() : (Array.isArray(sourcePayload?.data) ? sourcePayload.data.slice() : []);

            const sourceIndex = sourceData.findIndex(p => String(p.playlistItem_id) === srcId);
            if (sourceIndex === -1) {
                logInfo(`[playlist.js] Source item not found in source playlist: ${sourcePlaylistItemId}`);
                return;
            }

            // ソースから削除
            const [movingItemRaw] = sourceData.splice(sourceIndex, 1);

            // 移動アイテム（状態フラグはリセット）
            const movingItem = { ...movingItemRaw };
            resetPlaylistStoreItemRuntimeState(movingItem);

            // ターゲットへ挿入
            let insertIndex = (dropPosition === 'after') ? targetIndexBefore + 1 : targetIndexBefore;
            if (insertIndex < 0) {
                insertIndex = 0;
            }
            if (insertIndex > playlist.length) {
                insertIndex = playlist.length;
            }
            if (tgtId === null) {
                insertIndex = playlist.length;
            }

            playlist.splice(insertIndex, 0, movingItem);

            // order等の整形
            playlist.forEach((p, index) => {
                p.order = index;
                resetPlaylistStoreItemRuntimeState(p);
            });

            // ターゲット（現在表示中）へ反映
            await stateControl.setPlaylistState(playlist);
            await updatePlaylistUI();

            // ターゲットの自動保存
            await saveActivePlaylistToStore();

            // ソース側の保存（ローカルストレージを直接更新）
            writePlaylistStoreData(draggedSourcePlaylistIndex, sourceData);
            dragSourcePlaylistSnapshot = sourceData.slice();

            dragDropCompleted = true;
            clearDragIndicators();

            // ドロップ先スロットを必ず表示確定（ドラッグ元へ戻るのを防ぐ）
            if (isValidPlaylistStoreNumber(dropTargetStoreIndex)) {
                await loadPlaylist(dropTargetStoreIndex);
                setActiveStoreButton(dropTargetStoreIndex);
            } else {
                setActiveStoreButton(activePlaylistIndex);
            }

            return;

        }

        // (B) 同一プレイリスト内の並び替え
        if (tgtId !== null && targetIndexBefore === -1) {
            logInfo(`[playlist.js] Target item not found: ${targetPlaylistItemId}`);
            return;
        }

        if (currentIndex === targetIndexBefore && tgtId !== null) {
            return;
        }

        // 移動対象を取り出し
        const [movingItem] = playlist.splice(currentIndex, 1);

        // 削除後に再度ターゲット位置を取得（同一プレイリスト内でインデックスが変わるため）
        const targetIndex = (tgtId === null)
            ? -1
            : playlist.findIndex(p => String(p.playlistItem_id) === tgtId);

        let insertIndex;
        if (tgtId === null || targetIndex === -1) {
            insertIndex = playlist.length;
        } else {
            insertIndex = (dropPosition === 'after') ? targetIndex + 1 : targetIndex;
        }

        if (insertIndex < 0) {
            insertIndex = 0;
        }
        if (insertIndex > playlist.length) {
            insertIndex = playlist.length;
        }

        playlist.splice(insertIndex, 0, movingItem);

        // orderを更新し、選択状態などをリセット
        playlist.forEach((p, index) => {
            p.order = index;
            resetPlaylistStoreItemRuntimeState(p);
        });

        await stateControl.setPlaylistState(playlist);
        await updatePlaylistUI();

        // 自動保存
        await saveActivePlaylistToStore();

        dragDropCompleted = true;
        clearDragIndicators();
    } catch (error) {
        logInfo(`[playlist.js] Drag & drop reorder error: ${error?.stack || error?.message || error}`);
    }
}

async function copyPlaylistByDrag(sourcePlaylistItemId, targetPlaylistItemId, dropPosition) {
    try {
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist state is invalid.');
            return;
        }

        const srcId = String(sourcePlaylistItemId);
        const tgtId = (targetPlaylistItemId === null || targetPlaylistItemId === undefined || targetPlaylistItemId === '') ? null : String(targetPlaylistItemId);

        // ターゲット位置（"null" の場合は末尾）
        const targetIndexBefore = (tgtId === null)
            ? playlist.length
            : playlist.findIndex(p => String(p.playlistItem_id) === tgtId);

        if (tgtId !== null && targetIndexBefore === -1) {
            logInfo(`[playlist.js] Target item not found: ${targetPlaylistItemId}`);
            return;
        }

        // コピー元のアイテムを取得（同一プレイリスト内 or 他プレイリスト）
        let sourceItemRaw = null;

        const currentIndex = playlist.findIndex(p => String(p.playlistItem_id) === srcId);
        if (currentIndex !== -1) {
            sourceItemRaw = playlist[currentIndex];
        } else {
            if (!isValidPlaylistStoreNumber(draggedSourcePlaylistIndex)) {
                logInfo('[playlist.js] Drag source playlist is not available.');
                return;
            }

            const sourcePayload = readPlaylistStorePayload(draggedSourcePlaylistIndex);
            const sourceData = Array.isArray(dragSourcePlaylistSnapshot)
                ? dragSourcePlaylistSnapshot.slice()
                : (Array.isArray(sourcePayload?.data) ? sourcePayload.data.slice() : []);

            const sourceIndex = sourceData.findIndex(p => String(p.playlistItem_id) === srcId);
            if (sourceIndex === -1) {
                logInfo(`[playlist.js] Source item not found in source playlist: ${sourcePlaylistItemId}`);
                return;
            }
            sourceItemRaw = sourceData[sourceIndex];
        }

        // 複製（IDは必ず新規発行）
        const copiedItem = { ...sourceItemRaw };
        copiedItem.playlistItem_id = `${Date.now()}-${Math.random()}`;
        resetPlaylistStoreItemRuntimeState(copiedItem);

        // thumbnail(HTMLElement) をコピーすると DOM が移動して元が消えるため、コピー側は必ず切り離す
        if (copiedItem.thumbnail instanceof HTMLElement) {
            copiedItem.thumbnail = null;
        }

        // ターゲットへ挿入
        let insertIndex = (dropPosition === 'after') ? targetIndexBefore + 1 : targetIndexBefore;
        if (insertIndex < 0) {
            insertIndex = 0;
        }
        if (insertIndex > playlist.length) {
            insertIndex = playlist.length;
        }
        if (tgtId === null) {
            insertIndex = playlist.length;
        }

        playlist.splice(insertIndex, 0, copiedItem);

        // orderを更新し、選択状態などをリセット
        playlist.forEach((p, index) => {
            p.order = index;
            resetPlaylistStoreItemRuntimeState(p);
        });

        await stateControl.setPlaylistState(playlist);
        await updatePlaylistUI();

        // 自動保存（コピー先のみ）
        await saveActivePlaylistToStore();

        dragDropCompleted = true;
        clearDragIndicators();
    } catch (error) {
        logInfo(`[playlist.js] Drag & drop copy error: ${error?.stack || error?.message || error}`);
    }
}

// ------------------------------------------------
// アイテムを上下に移動して入れ替える(▲▼ボタン）
// ------------------------------------------------
async function movePlaylistItem(item, direction) {
    logOpe(`[playlist.js] movePlaylistItem called: id=${item.playlistItem_id}, direction=${direction}`);
    const playlist = await window.electronAPI.stateControl.getPlaylistState();

    // 現在インデックス取得
    const currentIndex = playlist.findIndex(p => p.playlistItem_id === item.playlistItem_id);
    if (currentIndex === -1) {
        logInfo('[playlist.js] Item not found in playlist.');
        return false;
    }

    // 新しいインデックス計算
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= playlist.length) {
        logInfo('[playlist.js] Move out of range.');
        return false;
    }

    // 順序入れ替え
    const [movingItem] = playlist.splice(currentIndex, 1);
    playlist.splice(newIndex, 0, movingItem);
    playlist.forEach((item, index) => {
        item.order = index;
    });

    // 更新
    await window.electronAPI.stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // 移動確定（プレイリスト変更）をアクティブスロットへ保存（ベストエフォート）
    try {
        if (typeof saveActivePlaylistToStore === 'function') {
            await saveActivePlaylistToStore();
        }
    } catch (e) {
        logInfo('[playlist.js] Auto-save after movePlaylistItem failed (ignored):', e);
    }

    logOpe(`[playlist.js] Moved item id=${item.playlistItem_id} to index=${newIndex}`);
    return true;
}

// ----------------------------
// 選択アイテムをオンエア
// ----------------------------

// オンエアアイテム記録
let lastOnAirItemId = null;

// 編集中アイテムをオンエア
async function performOnAirForEditingItem() {
    try {
        const playlist = await stateControl.getPlaylistState();
        const editingItem = playlist.find(item => item.editingState === 'editing'); // 現在編集中アイテム

        if (!editingItem) {
            // 動作しない理由表示
            showMessage(getMessage('no-item-in-editing-state'), 5000, 'alert');
            return;
        }

        // 最後のオンエアアイテムとして記憶
        lastOnAirItemId = editingItem.playlistItem_id;

        // ボタンを赤色に変更（存在すれば）
        const onAirButton = document.getElementById('cue-button');
        if (onAirButton) {
            onAirButton.classList.add('important-button-red');
        }

        // プレイリストのオンエア状態をstateControlに通知
        await stateControl.setOnAirState(editingItem.playlistItem_id); // 正しく playlistItem_id を渡す

        // プレイリストを正規化して保存（orderの数値形式を保持）
        await stateControl.setPlaylistState(
            playlist.map(item => ({
                ...item,
                order: Number(item.order), // 数値形式に変換して保存
            }))
        );

        await updatePlaylistUI(); // UI更新

        showMessage(`${getMessage('on-air-started')} ${editingItem.name}`, 5000, 'success');
        logInfo(`[playlist.js] On-Air Item ID sent to main process: ${editingItem.playlistItem_id}`);

        // メインプロセス通知
        window.electronAPI.sendOnAirItemIdToMain(editingItem.playlistItem_id);

        // ON AIRメッセージ表示後もボタンの色を維持
        showMessage(getMessage('on-air'), 10000, 'alert');
    } catch (error) {
        logInfo('[playlist.js] Error during On-Air process:', error);
        showMessage(getMessage('on-air-error-occurred'), 5000, 'alert');
    }
}

// オンエアボタンイベントリスナー
function initializeOnAirButtonListener() {
    const onAirButton = document.getElementById('cue-button');
    if (!onAirButton) {
        logInfo('[playlist.js] On-Air button not found.');
        return;
    }

    onAirButton.addEventListener('mousedown', async (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        logOpe('[playlist.js] On-Air button clicked');

        // 共通オンエア処理を呼び出し
        await performOnAirForEditingItem();
    });

    // Enterキーによる誤動作を防ぐため、keydownイベントでEnterキーのデフォルト動作を無効化
    onAirButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    });
}

// 編集中のアイテムID取得
function getEditingItemId() {
    const playlist = stateControl.getPlaylistState();
    const editingItem = playlist.find(item => item.editingState === 'editing');
    return editingItem ? editingItem.playlistItem_id : null;
}

// アイテムIDを通知
function notifyOnAirItemId(itemId) {
    // メインプロセス通知
    window.electronAPI.sendOnAirItemIdToMain(itemId);
    logInfo(`[playlist.js] On-Air Item ID sent to main process: ${itemId}`);
}

// アイテムのオンエア状態を更新
function setOnAirState(itemId) {
    const playlist = stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map(item => {
        // 選択されたアイテムは "onair" に、それ以外は null に設定
        return {
            ...item,
            onAirState: item.playlistItem_id === itemId ? "onair" : null,
        };
    });
    stateControl.setPlaylistState(updatedPlaylist);

    // UI更新
    updatePlaylistUI(); 

    logInfo(`[playlist.js] On-Air state updated for Item ID: ${itemId}`);
}

// -----------------------
// オフエア通知受信
// -----------------------
window.electronAPI.onReceiveOffAirNotify(async () => {
    logInfo('[playlist.js] Received Off-Air notification.');

    // オンエアボタンを消灯
    const onAirButton = document.getElementById('cue-button');
    if (onAirButton) {
        onAirButton.classList.remove('important-button-red');
        logInfo('[playlist.js] On-Air button has been turned off.');
    } else {
        logInfo('[playlist.js] On-Air button not found.');
    }

    // プレイリストアイテムのオンエア状態解除
    try {
        await stateControl.resetOnAirState();
        logInfo('[playlist.js] All playlist items have been set to Off-Air state.');
        await updatePlaylistUI();
        logInfo('[playlist.js] Playlist UI updated successfully after Off-Air.');
    } catch (error) {
        logInfo('[playlist.js] Failed to reset playlist items Off-Air state:', error);
    }
    
    
    // 現在の選択アイテムIDを取得（ユーザーの編集中選択を尊重）
    let currentSelectedItemId = null;
    try {
        const playlist = await stateControl.getPlaylistState();
        if (Array.isArray(playlist)) {
            const selectedItem = playlist.find(item => item.selectionState === "selected");
            if (selectedItem) {
                currentSelectedItemId = selectedItem.playlistItem_id;
            }
        }
    } catch (error) {
        logDebug('[playlist.js] Failed to get current selected item:', error);
    }

    // 最後にオンエアだったアイテムがあれば次のアイテムを自動選択
    // ただし、現在の選択が「最後のオンエアアイテム」または「選択なし」のときだけ実行する
    if (lastOnAirItemId && (!currentSelectedItemId || currentSelectedItemId === lastOnAirItemId)) {
        logInfo(`[playlist.js] Auto-selecting next item (without...ir) after Off-Air for last On-Air item ID: ${lastOnAirItemId}`);
        await selectNextPlaylistItem(lastOnAirItemId);
        lastOnAirItemId = null;
    } else if (lastOnAirItemId) {
        logDebug(`[playlist.js] Skipped auto-select next item after Off-Air (user selection preserved). selected=${currentSelectedItemId}, lastOnAir=${lastOnAirItemId}`);
        lastOnAirItemId = null;
    }
});

// -----------------------
// オフエア後に次のアイテムを選択する（オンエアはしない）
// -----------------------
async function selectNextPlaylistItem(currentItemId) {
    const playlist = await stateControl.getPlaylistState();
    if (!Array.isArray(playlist) || playlist.length === 0) {
        logDebug('[playlist.js] Playlist is empty or invalid.');
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Sent Off-Air notification. (Playlist is empty)');
        return;
    }
    const sortedPlaylist = playlist.slice().sort((a, b) => a.order - b.order);
    const currentIndex = sortedPlaylist.findIndex(item => item.playlistItem_id === currentItemId);
    if (currentIndex === -1) {
        logDebug('[playlist.js] Current item not found in sorted playlist.');
        return;
    }
    let nextIndex = currentIndex + 1;
    if (nextIndex >= sortedPlaylist.length) {
        nextIndex = 0;
    }
    const availableIndex = findNextAvailableIndex(sortedPlaylist, nextIndex);
    if (availableIndex === -1) {
        logInfo('[playlist.js] No available next item (all items are media offline).');
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Sent Off-Air notification. (All items are offline)');
        return;
    }
    nextIndex = availableIndex;
    const nextItem = sortedPlaylist[nextIndex];

    logInfo(`[playlist.js] Next item selected (without On-Air): ID: ${nextItem.playlistItem_id}, Name: ${nextItem.name}`);
    const updatedPlaylist = playlist.map(item => ({
        ...item,
        selectionState: item.playlistItem_id === nextItem.playlistItem_id ? 'selected' : 'unselected',
        editingState: item.playlistItem_id === nextItem.playlistItem_id ? 'editing' : null,
    }));
    await stateControl.setPlaylistState(updatedPlaylist);
    await updatePlaylistUI();
    window.electronAPI.updateEditState(nextItem);
    logInfo(`[playlist.js] Next item sent to edit area: ${nextItem.name}`);
    scrollToPlaylistItem(nextItem.playlistItem_id);
}

// --------------------------------
// プレイリスト保存
// --------------------------------

// 指定スロットへ、現在のプレイリスト状態を保存する
async function savePlaylistToStore(storeNumber, playlistName) {
    const n = Number(storeNumber);
    if (!Number.isFinite(n) || n < 1 || n > 9) {
        throw new Error(`[playlist.js] Invalid storeNumber: ${storeNumber}`);
    }

    const key = `vtrpon_playlist_store_${n}`;

    // 現在のプレイリスト状態を取得
    const playlist = await stateControl.getPlaylistState();
    const rawData = Array.isArray(playlist) ? playlist : [];

    // 名前は、引数 > 既存保存名 > デフォルト
    let name = (typeof playlistName === 'string' && playlistName.trim()) ? playlistName.trim() : '';
    if (!name) {
        const stored = localStorage.getItem(key);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
                    name = parsed.name.trim();
                }
            } catch (e) {
                // ignore
            }
        }
    }
    if (!name) name = `Playlist ${n}`;

    // 保存用に正規化（実行時の一時状態は保存しない）
    const data = rawData
        .map((item, idx) => {
            const src = item || {};
            const {
                selectionState,
                editingState,
                onAirState,
                converting,
                thumbnail,
                uvcDeviceId: uvcDeviceIdRaw,
                ...rest
            } = src;

            const orderNum = Number(rest.order);
            const order = Number.isFinite(orderNum) ? orderNum : idx;

            const endGotoPlaylist = (Number.isFinite(Number(rest.endGotoPlaylist)) && Number(rest.endGotoPlaylist) >= 1 && Number(rest.endGotoPlaylist) <= 9)
                ? Number(rest.endGotoPlaylist)
                : undefined;

            const endGotoItemId = (typeof rest.endGotoItemId === 'string' && rest.endGotoItemId) ? rest.endGotoItemId : undefined;

            const playlistItemId = (typeof rest.playlistItem_id === 'string' && rest.playlistItem_id)
                ? rest.playlistItem_id
                : `${Date.now()}-${Math.random()}`;

            const path = (typeof rest.path === 'string') ? rest.path : '';
            const uvcDeviceIdFromPath = (path.startsWith('UVC_DEVICE:')) ? path.replace('UVC_DEVICE:', '') : null;
            const uvcDeviceId = (typeof uvcDeviceIdRaw === 'string' && uvcDeviceIdRaw) ? uvcDeviceIdRaw : uvcDeviceIdFromPath;
            const isUVC = !!uvcDeviceId;

            const out = {
                ...rest,
                ...(uvcDeviceId ? { uvcDeviceId } : {}),
                ...(isUVC ? { path: `UVC_DEVICE:${uvcDeviceId}` } : {}),
                order,
                playlistItem_id: playlistItemId,
                endGotoPlaylist,
                endGotoItemId,
                selectionState: "unselected",
                editingState: null,
                onAirState: null,
            };

            // 非UVCのthumbnailは文字列（dataURL等）だけ保存
            if (!isUVC && typeof thumbnail === 'string' && thumbnail) {
                out.thumbnail = thumbnail;
            }

            // UVCは thumbnail を保存しない（復元は load 時に generateThumbnail で行う）
            if (isUVC) {
                out.thumbnail = null;
            }

            return out;
        })
        .sort((a, b) => Number(a.order) - Number(b.order));

    // DSK選択中アイテムID取得（取れなければ null）
    let dskCurrentItemId = null;
    try {
        const dskItem = window.dskModule && typeof window.dskModule.getCurrentDSKItem === 'function'
            ? window.dskModule.getCurrentDSKItem()
            : null;
        dskCurrentItemId = dskItem ? dskItem.playlistItem_id : null;
    } catch (e) {
        dskCurrentItemId = null;
    }

    // 保存（空なら空で保存する：スロットは常に存在）
    localStorage.setItem(key, JSON.stringify({
        name,
        endMode: null,
        soundPadMode: !!soundPadActive,
        directOnAirMode: !!directOnAirActive,
        fillKeyMode: !!isFillKeyMode,
        dskCurrentItemId: dskCurrentItemId,
        data
    }));

// ボタンラベル/状態更新（アイテム有無だけ反映）
    const button = document.getElementById(`playlise${n}-button`);
    if (button) {
        button.dataset.storeNumber = n;
        button.textContent = `${n}`;
        if (data.length > 0) {
            button.classList.add('playlist-saved');
        } else {
            button.classList.remove('playlist-saved');
        }
    }

    // ボタン色更新（新方針：非アクティブ=グレー、アクティブ=緑）
    if (typeof updateStoreButtons === 'function') {
        updateStoreButtons();
    }
    if (typeof setActiveButton === 'function') {
        const active = getActivePlaylistSlotOrNull();
        if (active !== null) setActiveButton(active);
    }
}

// 現在アクティブなスロットへ保存する（他のUI更新から呼び出す用）
async function saveActivePlaylistToStore(playlistName) {
    const active = getActivePlaylistSlotOrDefault(1);
    return await savePlaylistToStore(active, playlistName);
}

// 初期化用関数（ボタン表示は保存内容を反映）
function initializePlaylistUI() {
    for (let i = 1; i <= 9; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        button.dataset.storeNumber = i;

        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
        if (storedPlaylist) {
            try {
                const parsedData = JSON.parse(storedPlaylist);
                // ボタンは常にスロット番号のみ表示（名前は表示しない）
                button.textContent = `${i}`;
                if (parsedData && Array.isArray(parsedData.data) && parsedData.data.length > 0) {
                    button.classList.add('playlist-saved');
                } else {
                    button.classList.remove('playlist-saved');
                }
            } catch (e) {
                // ボタンは常にスロット番号のみ表示（名前は表示しない）
                button.textContent = `${i}`;
                button.classList.remove('playlist-saved');
            }
        } else {
            button.textContent = `${i}`;
            button.classList.remove('playlist-saved');
        }
	
    // ボタン色初期化
    updateButtonColors();

    // プレイリスト名表示：ダブルクリック / 右クリックで名前変更モーダルを開く
    const playlistNameDisplay = document.getElementById('playlist-name-display');
    if (playlistNameDisplay && !playlistNameDisplay.dataset.playlistRenameBound) {
        playlistNameDisplay.dataset.playlistRenameBound = '1';

        playlistNameDisplay.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void openActivePlaylistNameRenameModal();
        });

        playlistNameDisplay.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // ブラウザ右クリックメニュー抑止
            e.stopPropagation();
            void openActivePlaylistNameRenameModal();
        });
    }
}

// --------------------------------
// プレイリスト呼出
// --------------------------------

// プレイリスト番号ボタン処理
function applyPlaylistNumberButtonsImportLock(importing) {
    const disabled = !!importing;

    for (let i = 1; i <= 9; i++) {
        const btn = document.getElementById(`playlise${i}-button`);
        if (!btn) continue;

        // button要素なら disabled が効く。効かない要素でも pointer-events で確実に止める
        try {
            btn.disabled = disabled;
        } catch (e) {
            // ignore
        }
        if (btn && btn.style) {
            btn.style.pointerEvents = disabled ? 'none' : '';
        }
    }
}

// 読み込み状態変化イベントを受けて、ボタンをロック/解除
window.addEventListener('vtrpon-importing-changed', (e) => {
    const importing = !!(e && e.detail && e.detail.isImporting);
    applyPlaylistNumberButtonsImportLock(importing);
});

// 初期状態も反映（起動直後に読み込み中でない想定だが念のため）
applyPlaylistNumberButtonsImportLock(!!isImporting);

for (let i = 1; i <= 9; i++) {
    const button = document.getElementById(`playlise${i}-button`);
    if (!button) {
        logInfo(`[playlist.js] Playlist button not found: playlise${i}-button`);
        continue;
    }

    // ドラッグ＆ドロップ: ボタン上ホバーでプレイリストを切り替え、ドロップで移動
    button.addEventListener('dragenter', (event) => {
        if (!draggedPlaylistItemId || isImporting) {
            return;
        }
        event.preventDefault();

        const buttons = document.querySelectorAll('[id^="playlise"][id$="-button"]');
        buttons.forEach((btn) => btn.classList.remove('playlist-button-drag-hover'));
        button.classList.add('playlist-button-drag-hover');

        scheduleSwitchPlaylistDuringDragHover(i);
    });

    button.addEventListener('dragover', (event) => {
        if (!draggedPlaylistItemId || isImporting) {
            return;
        }
        event.preventDefault();

        if (event.dataTransfer) {
            const isCopy = !!(event.ctrlKey || event.metaKey);
            event.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
        }

        const buttons = document.querySelectorAll('[id^="playlise"][id$="-button"]');
        buttons.forEach((btn) => btn.classList.remove('playlist-button-drag-hover'));
        button.classList.add('playlist-button-drag-hover');

        scheduleSwitchPlaylistDuringDragHover(i);
    });

    button.addEventListener('dragleave', (event) => {
        if (!draggedPlaylistItemId) {
            return;
        }
        if (event.relatedTarget && button.contains(event.relatedTarget)) {
            return;
        }
        button.classList.remove('playlist-button-drag-hover');
        if (button.style) {
            // 過去互換（旧コード残留対策）
            button.style.outline = '';
        }
    });

    button.addEventListener('drop', async (event) => {
        if (!draggedPlaylistItemId || isImporting) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        const isCopy = !!(event.ctrlKey || event.metaKey);

        const buttons = document.querySelectorAll('[id^="playlise"][id$="-button"]');
        buttons.forEach((btn) => btn.classList.remove('playlist-button-drag-hover'));
        if (button.style) {
            // 過去互換（旧コード残留対策）
            button.style.outline = '';
        }

        // タイマー待ちをせずに、即時で表示切り替え（そのスロットへ）
        if (dragHoverSwitchTimer) {
            clearTimeout(dragHoverSwitchTimer);
            dragHoverSwitchTimer = null;
        }
        if (activePlaylistIndex !== i) {
            await switchPlaylistForDragHover(i);
        }

        // ボタンへのドロップは「末尾へ移動」
        const sourceId = (event.dataTransfer && event.dataTransfer.getData('text/plain'))
            ? event.dataTransfer.getData('text/plain')
            : draggedPlaylistItemId;
        if (!sourceId) {
            return;
        }

        if (isCopy) {
            await copyPlaylistByDrag(sourceId, null, 'after');
        } else {
            await reorderPlaylistByDrag(sourceId, null, 'after');
        }

        // ドロップ完了後に、そのスロットをアクティブ（緑）に確定
        setActiveStoreButton(i);
    });

    button.addEventListener('mousedown', async (event) => {
        if (event.button !== 0) return;
        event.preventDefault();

        // 読み込み中はスロット切替を禁止（誤登録防止）
        if (isImporting) {
            return;
        }

        logOpe(`[playlist.js] Playlist number ${i} button clicked`);

        logOpe(`[playlist.js] Button ${i} clicked`);

        const __loadKey = `vtrpon_playlist_store_${i}`;
        logOpe(`[playlist.js] LOAD intent: slot=${i} key=${__loadKey}`);

        // スロット切替の直前に、現在アクティブの状態を保存（失敗しても切替は継続）
        try {
            await saveActivePlaylistToStore();
        } catch (e) {
        }

        // 新しいアクティブスロット確定
        activePlaylistIndex = i;

        await loadPlaylist(i);

        const playlistNameDisplay = document.getElementById('playlist-name-display');
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
        if (playlistNameDisplay) {
            if (storedPlaylist) {
                const playlistData = JSON.parse(storedPlaylist);
                playlistNameDisplay.textContent = playlistData.name || `Playlist ${i}`;
            } else {
                // 保存が無い場合でも空スロットとして扱う
                playlistNameDisplay.textContent = `Playlist ${i}`;
            }
        }

        updateStoreButtons();
        setActiveButton(i);
    });}
}

// プレイリスト読込処理
async function loadPlaylist(storeNumber) {
    const token = ++__loadState.token;

    const n = Number(storeNumber);
    if (!Number.isFinite(n) || n < 1 || n > 9) {
        throw new Error(`[playlist.js] Invalid storeNumber for loadPlaylist: ${storeNumber}`);
    }

    activePlaylistIndex = n;

    logOpe(`[playlist.js] loadPlaylist called with storeNumber=${n}`);
    const __key = `vtrpon_playlist_store_${n}`;
    logOpe(`[playlist.js] Resolving key for load: ${__key}`);

    const storedPlaylist = localStorage.getItem(__key);

    // 保存が無い場合でも「空プレイリスト」としてロードする
    if (!storedPlaylist) {
        logInfo(`[playlist.js] No playlist found for store number ${storeNumber}. Load as empty.`);

        try {
            setCurrentPlaylistId(null);
            await stateControl.clearState();
            if (token !== __loadState.token) {
                logInfo('[playlist.js] Load aborted: newer request detected (after clearState).');
                return;
            }

            await stateControl.setPlaylistState([]);
            if (token !== __loadState.token) {
                logInfo('[playlist.js] Load aborted: newer request detected (after setPlaylistState empty).');
                return;
            }

            await updatePlaylistUI();

            // モード類は空スロットではリセット
            soundPadActive = false;
            directOnAirActive = false;
            isFillKeyMode = false;

            const soundPadButton = document.getElementById('soundpad-mode-button');
            if (soundPadButton) soundPadButton.classList.remove('button-green');

            const directOnAirButton = document.getElementById('directonair-mode-button');
            if (directOnAirButton) directOnAirButton.classList.remove('button-green');

            const fillKeyButton = document.getElementById('fillkey-mode-button');
            if (fillKeyButton) fillKeyButton.classList.remove('button-green');

            window.electronAPI.ipcRenderer.send('fillkey-mode-update', isFillKeyMode);

            // DSK選択状態は解除（可能なら）
            if (window.dskModule && typeof window.dskModule.setCurrentDSKItemById === 'function') {
                window.dskModule.setCurrentDSKItemById(null);
            }
        } catch (error) {
            logInfo('[playlist.js] Error loading empty playlist:', error);
        }

        logOpe("[playlist.js] edit clear.");
        return;
    }

    try {
        const playlistData = JSON.parse(storedPlaylist);
        logOpe(`[playlist.js] Loaded playlist meta: name="${playlistData.name || ''}" items=${Array.isArray(playlistData.data) ? playlistData.data.length : '?'} id=${playlistData.playlist_id || 'n/a'}`);
        if (token !== __loadState.token) {
            logInfo('[playlist.js] Load aborted: newer request detected (after parse).');
            return;
        }
        setCurrentPlaylistId(playlistData.playlist_id);
        await stateControl.clearState();
        if (token !== __loadState.token) {
            logInfo('[playlist.js] Load aborted: newer request detected (after clearState).');
            return;
        }
        const reorderedData = await Promise.all((Array.isArray(playlistData.data) ? playlistData.data : [])
            .map(async (item) => {
                const base = {
                    ...item,
                    endGotoPlaylist: (Number.isFinite(Number(item.endGotoPlaylist)) && Number(item.endGotoPlaylist) >= 1 && Number(item.endGotoPlaylist) <= 9)
                        ? Number(item.endGotoPlaylist)
                        : undefined,
                    endGotoItemId: (typeof item.endGotoItemId === 'string' && item.endGotoItemId) ? item.endGotoItemId : undefined,
                };

                const path = (typeof base.path === 'string') ? base.path : '';
                const uvcDeviceIdFromPath = (path.startsWith('UVC_DEVICE:')) ? path.replace('UVC_DEVICE:', '') : null;
                const uvcDeviceId = (typeof base.uvcDeviceId === 'string' && base.uvcDeviceId) ? base.uvcDeviceId : uvcDeviceIdFromPath;
                const isUVC = !!uvcDeviceId;

                if (isUVC) {
                    const restoredPath = path.startsWith('UVC_DEVICE:')
                        ? path
                        : `UVC_DEVICE:${uvcDeviceId}`;

                    base.path = restoredPath;
                    base.uvcDeviceId = restoredPath.replace('UVC_DEVICE:', '');

                    try {
                        base.thumbnail = await generateThumbnail(restoredPath);
                    } catch (e) {
                        logInfo(`[playlist.js] Failed to regenerate UVC thumbnail on load: ${e?.stack || e?.message || e}`);
                        base.thumbnail = null;
                    }
                }

                return base;
            })
        );

        reorderedData.sort((a, b) => a.order - b.order);
        await stateControl.setPlaylistState(reorderedData);

        if (token !== __loadState.token) {
            logInfo('[playlist.js] Load aborted: newer request detected (after setPlaylistState).');
            return;
        }
        await updatePlaylistUI();

        // SOUND PADモード状態復元
        soundPadActive = playlistData.soundPadMode || false;
        const soundPadButton = document.getElementById('soundpad-mode-button');
        if (soundPadButton) {
            if (soundPadActive) {
                soundPadButton.classList.add('button-green');
            } else {
                soundPadButton.classList.remove('button-green');
            }
        }

        // DIRECT ONAIRモード状態復元
        directOnAirActive = playlistData.directOnAirMode || false;
        const directOnAirButton = document.getElementById('directonair-mode-button');
        if (directOnAirButton) {
            if (directOnAirActive) {
                directOnAirButton.classList.add('button-green');
            } else {
                directOnAirButton.classList.remove('button-green');
            }
        }

        // FILLKEYモード状態復元
        isFillKeyMode = playlistData.fillKeyMode || false;
        const fillKeyButton = document.getElementById('fillkey-mode-button');
        if (fillKeyButton) {
            if (isFillKeyMode) {
                fillKeyButton.classList.add('button-green');
            } else {
                fillKeyButton.classList.remove('button-green');
            }
        }

        // FILLKEYモードの状態通知
        window.electronAPI.ipcRenderer.send('fillkey-mode-update', isFillKeyMode);

        // DSK選択状態復元
        if (playlistData.dskCurrentItemId && window.dskModule && typeof window.dskModule.setCurrentDSKItemById === 'function') {
            window.dskModule.setCurrentDSKItemById(playlistData.dskCurrentItemId);
        }

    } catch (error) {
        logInfo('[playlist.js] Error loading playlist:', error);
    }
    logOpe("[playlist.js] edit clear.");
}

// プレイリスト順番取得
function getPlaylistOrder() {
    return stateControl.getPlaylistState().map((item) => ({ ...item }));
}

// ボタン状態更新
function updateStoreButtons() {
    const delButton = document.getElementById('playlisedel-button');
    const isDeleteMode = !!(delButton && delButton.classList.contains('button-blink-orange'));

    for (let i = 1; i <= 9; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (!button) {
            logInfo(`[playlist.js] Playlist button not found: playlise${i}-button`);
            continue;
        }
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);

        // 変更後方針：空/保存あり問わず常にグレー
        button.classList.add('button-gray');
        button.classList.remove('button-blue');

        // （DEL機能を完全廃止するなら、このdeleteMode一式も後で消せます）
        if (isDeleteMode) {
            if (storedPlaylist) {
                button.classList.add('button-purple');
            }
        } else {
            button.classList.remove('button-purple');
        }

        // アクティブ色は setActiveButton 側で制御
        button.classList.remove('button-orange');
        button.classList.remove('button-green');
    }
}

// ボタンアクティブ
function setActiveButton(activeIndex) {
    for (let i = 1; i <= 9; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (!button) continue;
        if (i === activeIndex) {
            button.classList.add('button-green');
            button.classList.remove('button-orange');
        } else {
            button.classList.remove('button-green');
            button.classList.remove('button-orange');
        }
    }
}

// アクティブボタン設定
function setActiveStoreButton(storeNumber) {
    const sn = Number(storeNumber);
    if (!Number.isFinite(sn) || sn < 1 || sn > 9) return;

    // 重要：表示だけでなく「保存先スロット」も同期する
    activePlaylistIndex = sn;

    const activeButton = document.getElementById(`playlise${sn}-button`);
    const playlistNameDisplay = document.getElementById('playlist-name-display');
    updateStoreButtons();

    if (activeButton) {
        activeButton.classList.add('button-green');
        activeButton.classList.remove('button-orange');
    }

    const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${sn}`);

    if (playlistNameDisplay) {
        if (storedPlaylist) {
            const playlistData = JSON.parse(storedPlaylist);
            playlistNameDisplay.textContent = playlistData.name || `Playlist ${sn}`;
        } else {
            // 保存が無い場合でも空スロットとして扱う
            playlistNameDisplay.textContent = `Playlist ${sn}`;
        }
    }
}

// --------------------------------
// プレイリストクリア
// --------------------------------

// CLEARボタンクリックイベント登録
document.getElementById('playliseclear-button').addEventListener('mousedown', async () => {
    // どのスロットがアクティブか（無ければ1扱い）
    const slot = getActivePlaylistSlotOrDefault(1);

    // まず「クリアの本体」だけを厳密に扱う（ここが失敗した時だけ失敗表示）
    try {
        await stateControl.setPlaylistState([]);
        await updatePlaylistUI();
    } catch (error) {
        logInfo(`[playlist.js] Error clearing playlist (core): ${error?.stack || error?.message || error}`);
        try {
            if (typeof showMessage === 'function' && typeof getMessage === 'function') {
                showMessage(getMessage('failed-to-clear-playlist'), 'error');
            }
        } catch (e) {
            // ignore
        }
        return;
    }

    // ここから下は「ベストエフォート」：失敗してもクリア失敗扱いにしない
    try {
        // モード状態をリセット
        soundPadActive = false;
        directOnAirActive = false;

        const soundPadButton = document.getElementById('soundpad-mode-button');
        if (soundPadButton) {
            soundPadButton.classList.remove('button-green');
        }

        const directOnAirButton = document.getElementById('directonair-mode-button');
        if (directOnAirButton) {
            directOnAirButton.classList.remove('button-green');
        }

        // FILLKEYモードリセット
        isFillKeyMode = false;
        const fillKeyButton = document.getElementById('fillkey-mode-button');
        if (fillKeyButton) {
            fillKeyButton.classList.remove('button-green');
        }

        try {
            window.electronAPI?.ipcRenderer?.send('clear-modes', false);
        } catch (e) {
            logInfo(`[playlist.js] clear-modes send failed (ignored): ${e?.stack || e?.message || e}`);
        }

        // 変更後方針：CLEAR後もスロットは維持（空として保存）
        // ※保存処理が未完成でも、クリア自体は成功として扱う
        try {
            if (typeof saveActivePlaylistToStore === 'function') {
                await saveActivePlaylistToStore();
            } else if (typeof savePlaylistToStore === 'function') {
                await savePlaylistToStore(slot);
            }
        } catch (e) {
            logInfo(`[playlist.js] Save after clear failed (ignored): ${e?.stack || e?.message || e}`);
        }

        // ボタン色を再反映（非アクティブ=グレー、アクティブ=緑）
        try {
            updateStoreButtons();
            setActiveButton(slot);
        } catch (e) {
            logInfo(`[playlist.js] Update store buttons after clear failed (ignored): ${e?.stack || e?.message || e}`);
        }

        // 表示名（無ければ Playlist N）
        const playlistNameDisplay = document.getElementById('playlist-name-display');
        if (playlistNameDisplay) {
            const stored = localStorage.getItem(`vtrpon_playlist_store_${slot}`);
            if (stored) {
                try {
                    const d = JSON.parse(stored);
                    playlistNameDisplay.textContent = (d && d.name) ? d.name : `Playlist ${slot}`;
                } catch (e) {
                    playlistNameDisplay.textContent = `Playlist ${slot}`;
                }
            } else {
                playlistNameDisplay.textContent = `Playlist ${slot}`;
            }
        }
    } catch (e) {
        logInfo(`[playlist.js] Post-clear best-effort step failed (ignored): ${e?.stack || e?.message || e}`);
    }

    logOpe('[playlist.js] playliseclear-button clicked.');

    try {
        await simulateRightArrowKey();
        logOpe("[playlist.js] edit clear.");
    } catch (e) {
        logInfo(`[playlist.js] simulateRightArrowKey failed (ignored): ${e?.stack || e?.message || e}`);
    }
});

// UI更新
function updateButtonColors() {
    for (let i = 1; i <= 9; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (!button) continue;
        const stored = localStorage.getItem(`vtrpon_playlist_store_${i}`);

        let hasItems = false;
        if (stored) {
            try {
                const d = JSON.parse(stored);
                hasItems = !!(d && Array.isArray(d.data) && d.data.length > 0);
            } catch (e) {
                hasItems = false;
            }
        }

        if (hasItems) {
            button.classList.add('playlist-saved');
        } else {
            button.classList.remove('playlist-saved');
        }

        button.classList.remove('playlist-active');
    }
}

// ----------------------------------------
// プレイリストインポート・エクスポート
// ----------------------------------------

// プレイリストエクスポート処理
async function doExportPlaylist() {
    logOpe('[playlist.js] Export playlist triggered');
    try {
        const MAX_PLAYLISTS = 9;
        const allPlaylists = [];

        // 後方互換不要：playlist_store_0 が存在したらエラー
        if (localStorage.getItem('vtrpon_playlist_store_0') !== null) {
            throw new Error('[playlist.js] Legacy playlist0 detected (vtrpon_playlist_store_0).');
        }

        // 現在アクティブなスロット（1-9）
        const currentActive = getActivePlaylistSlotOrDefault(1);

        // 現在編集状態（stateControl）を、アクティブスロットのデータとしてエクスポートに反映
        const liveState = await stateControl.getPlaylistState();
        const nameLabel = document.getElementById('playlist-name-display');
        const liveName = (nameLabel && nameLabel.textContent && nameLabel.textContent.trim() !== "")
            ? nameLabel.textContent.trim()
            : `Playlist ${currentActive}`;

        const normalizedLiveData = (Array.isArray(liveState) ? liveState : []).map((item) => ({
            ...item,
            order: (item.order !== undefined && item.order !== null) ? Number(item.order) : 0,
            startMode: (item.startMode !== undefined && item.startMode !== null) ? item.startMode : "PAUSE",
            endMode: (item.endMode !== undefined && item.endMode !== null) ? item.endMode : "PAUSE",
            bgColor: (item.bgColor !== undefined && item.bgColor !== null) ? item.bgColor : "default",
            defaultVolume: (item.defaultVolume !== undefined && item.defaultVolume !== null) ? item.defaultVolume : 100,
            ftbEnabled: item.ftbEnabled === true,
            ftbRate: (item.ftbRate !== undefined && item.ftbRate !== null) ? item.ftbRate : 1.0,
            startFadeInSec: (item.startFadeInSec !== undefined && item.startFadeInSec !== null) ? item.startFadeInSec : 1.0,
            repeatCount: item.repeatCount,
            repeatEndMode: item.repeatEndMode,
            endGotoPlaylist: (Number.isFinite(Number(item.endGotoPlaylist)) && Number(item.endGotoPlaylist) >= 1 && Number(item.endGotoPlaylist) <= 9)
                ? Number(item.endGotoPlaylist)
                : undefined,
            endGotoItemId: (typeof item.endGotoItemId === 'string' && item.endGotoItemId) ? item.endGotoItemId : undefined,
        }));

        // ローカルストレージから 1-9 のプレイリスト収集（無い場合は空で入れる）
        for (let i = 1; i <= MAX_PLAYLISTS; i++) {
            const storedData = localStorage.getItem(`vtrpon_playlist_store_${i}`);

            // 無い場合でも空としてエクスポート（新仕様：スロットは常に存在）
            if (!storedData) {
                allPlaylists.push({
                    index: i,
                    name: `Playlist ${i}`,
                    endMode: undefined,
                    data: (i === currentActive) ? normalizedLiveData : [],
                });
                continue;
            }

            try {
                const parsedData = JSON.parse(storedData);

                // アクティブスロットは stateControl を優先（未保存の編集を含める）
                const useData = (i === currentActive)
                    ? { ...parsedData, name: liveName, data: normalizedLiveData }
                    : parsedData;

                if (validatePlaylistData(useData)) {
                    const normalizedData = useData.data.map(item => ({
                        ...item,
                        order: (item.order !== undefined && item.order !== null) ? Number(item.order) : 0,
                        startMode: (item.startMode !== undefined && item.startMode !== null) ? item.startMode : "PAUSE",
                        endMode: (item.endMode !== undefined && item.endMode !== null) ? item.endMode : "PAUSE",
                        bgColor: (item.bgColor !== undefined && item.bgColor !== null) ? item.bgColor : "default",
                        defaultVolume: (item.defaultVolume !== undefined && item.defaultVolume !== null) ? item.defaultVolume : 100,
                        ftbEnabled: item.ftbEnabled === true,
                        ftbRate: (item.ftbRate !== undefined && item.ftbRate !== null) ? item.ftbRate : 1.0,
                        startFadeInSec: (item.startFadeInSec !== undefined && item.startFadeInSec !== null) ? item.startFadeInSec : 1.0,
                        repeatCount: item.repeatCount,
                        repeatEndMode: item.repeatEndMode,
                        endGotoPlaylist: (Number.isFinite(Number(item.endGotoPlaylist)) && Number(item.endGotoPlaylist) >= 1 && Number(item.endGotoPlaylist) <= 9)
                            ? Number(item.endGotoPlaylist)
                            : undefined,
                        endGotoItemId: (typeof item.endGotoItemId === 'string' && item.endGotoItemId) ? item.endGotoItemId : undefined,
                    }));

                    allPlaylists.push({
                        index: i,
                        name: useData.name,
                        endMode: useData.endMode,
                        data: normalizedData,
                    });
                } else {
                    logInfo(`[playlist.js] Playlist ${i} has invalid data and will be skipped.`);
                }
            } catch (parseError) {
                logInfo(`[playlist.js] Failed to parse playlist ${i}:`, parseError);
            }
        }

        // エクスポートデータ構築（active は 1-9）
        const exportData = {
            playlists: allPlaylists,
            activePlaylistIndex: currentActive,
        };

        // メインプロセスにデータ送信
        const result = await window.electronAPI.exportPlaylist(exportData);
        if (result.success) {
            logInfo('[playlist.js] Playlist exported to:', result.path);
            showMessage(`${getMessage('playlist-exported-successfully')} ${result.path}`, 5000, 'info');
        } else if (result.error && result.error.includes('User canceled')) {
            logInfo('[playlist.js] Export canceled by user.');
        } else {
            logInfo('[playlist.js] Failed to export playlist:', result.error);
            showMessage(getMessage('failed-to-export-playlist'), 5000, 'alert');
        }
    } catch (error) {
        if (error && error.message && error.message.includes('User canceled')) {
            logInfo('[playlist.js] Import canceled by user.');
        } else {
            const msg = (error && error.message) ? error.message : String(error);
            const stack = (error && error.stack) ? error.stack : '';
            const errorDetails = `Reason: ${msg}`;

            logInfo('[playlist.js] Error during import playlists (message):', msg);
            if (stack) {
                logInfo('[playlist.js] Error during import playlists (stack):', stack);
            }

            showMessage(`${getMessage('failed-to-import-playlist')}\n${errorDetails}`, 20000, 'alert');
        }
    }
}

// プレイリストエクスポート処理（メニュー呼び出し）
window.electronAPI.ipcRenderer.on('export-playlist', async () => {
    await doExportPlaylist();
});

// プレイリストデータバリデーション関数
function validatePlaylistData(data) {
    if (!data) return false;
    if (typeof data.name !== 'string') return false;
    if (!Array.isArray(data.data)) return false;

    return data.data.every(item => {
        if (!item) return false;
        const n = Number(item.order);
        return Number.isFinite(n) && n >= 0;
    });
}

// プレイリストインポート処理
async function doImportPlaylists() {
    logOpe('[playlist.js] Import playlist triggered');
    try {
        const result = await window.electronAPI.importPlaylist();
        if (!result.success) {
            if (result.error && result.error.includes('User canceled')) {
                logInfo('[playlist.js] Import canceled by user.');
                return;
            }
            const errorDetails = result.error ? `Reason: ${result.error}` : 'Invalid playlist file format.';
            showMessage(`${getMessage('failed-to-import-playlist')}\n${errorDetails}`, 5000, 'alert');
            return;
        }

        const { playlists, activePlaylistIndex: importedActivePlaylistIndex } = result.data;

        // 救済：activePlaylistIndex は 0 を許容（= アクティブ無しとして破棄）。1-9 は通常復元。その他はエラー。
        const activeIndex = Number(importedActivePlaylistIndex);
        if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex > 9) {
            throw new Error(`[playlist.js] Invalid activePlaylistIndex (must be 0-9): ${importedActivePlaylistIndex}`);
        }

        // 旧データでは activePlaylistIndex=0 があり得る。
        // その場合でもインポート直後の表示復元先として 1 を採用する（スロット番号のシフトはしない）。
        const restoreIndex = (activeIndex >= 1 && activeIndex <= 9) ? activeIndex : 1;

        // 救済：index=0 は破棄（無視）して継続。0以外で 1-9 以外はエラー。
        const filteredPlaylists = [];
        for (const p of playlists) {
            const idx = Number(p.index);
            if (!Number.isFinite(idx)) {
                throw new Error(`[playlist.js] Invalid playlist index in import (must be 1-9, or legacy 0): ${p.index}`);
            }
            if (idx === 0) {
                // legacy playlist0 は完全に破棄
                continue;
            }
            if (idx < 1 || idx > 9) {
                throw new Error(`[playlist.js] Invalid playlist index in import (must be 1-9): ${p.index}`);
            }
            filteredPlaylists.push(p);
        }

        const missingFiles = [];
        const newPlaylists = [];

        for (const playlist of filteredPlaylists) {
            const { index, name, data, endMode } = playlist;

            const validData = [];
            for (const file of data) {
                const hasPath = (typeof file.path === 'string' && file.path.length > 0);
                const isUVC = (hasPath && file.path.startsWith('UVC_DEVICE'));

                // checkFileExists は例外を飲み込み、インポート全体を失敗させない
                let exists = false;
                if (hasPath && !isUVC) {
                    try {
                        exists = await window.electronAPI.checkFileExists(file.path);
                    } catch (e) {
                        exists = false;
                        logInfo('[playlist.js] checkFileExists failed on import:', e);
                    }
                }

                const restoredFile = {
                    ...file,
                    ftbEnabled: file.ftbEnabled === true,
                    ftbRate: (file.ftbRate !== undefined && file.ftbRate !== null) ? file.ftbRate : 1.0,
                    startFadeInSec: (file.startFadeInSec !== undefined && file.startFadeInSec !== null) ? file.startFadeInSec : 1.0,
                    startMode: (file.startMode !== undefined && file.startMode !== null) ? file.startMode : "PAUSE",
                    endMode: (file.endMode !== undefined && file.endMode !== null) ? file.endMode : "PAUSE",
                    defaultVolume: (file.defaultVolume !== undefined && file.defaultVolume !== null) ? file.defaultVolume : 100,
                    repeatCount: (Number.isFinite(Number(file.repeatCount)) && Number(file.repeatCount) >= 1) ? Math.floor(Number(file.repeatCount)) : undefined,
                    repeatEndMode: (file.repeatEndMode === "PAUSE" || file.repeatEndMode === "OFF" || file.repeatEndMode === "NEXT") ? file.repeatEndMode : undefined,
                    endGotoPlaylist: (Number.isFinite(Number(file.endGotoPlaylist)) && Number(file.endGotoPlaylist) >= 1 && Number(file.endGotoPlaylist) <= 9)
                        ? Number(file.endGotoPlaylist)
                        : undefined,
                    endGotoItemId: (typeof file.endGotoItemId === 'string' && file.endGotoItemId) ? file.endGotoItemId : undefined,
                };

                // UVC デバイスサムネイル再生成
                if (isUVC) {
                    restoredFile.mediaOffline = false;
                    try {
                        restoredFile.thumbnail = await generateThumbnail(restoredFile.path);
                    } catch (e) {
                        logInfo('[playlist.js] Failed to regenerate UVC thumbnail on import:', e);
                    }
                } else {
                    // 通常ファイル：無い場合でも落とさず Media Offline として保持
                    restoredFile.mediaOffline = !exists;
                    if (!exists) {
                        logInfo(`File not found: ${file.path}`);
                        missingFiles.push(file.path || file.name || 'Unknown file');
                    }
                }

                validData.push(restoredFile);
            }

            const playlistData = {
                name,
                data: validData.sort((a, b) => a.order - b.order),
                endMode,
            };

            newPlaylists.push({
                index,
                playlistData,
                active: Number(index) === restoreIndex
            });
        }

        // まず 1-9 を空で初期化（無いスロットも必ず作る）
        for (let i = 1; i <= 9; i++) {
            const storeKey = `vtrpon_playlist_store_${i}`;
            localStorage.setItem(storeKey, JSON.stringify({
                name: `Playlist ${i}`,
                endMode: null,
                data: [],
            }));
        }

        // 取り込んだものだけ上書き
        for (const pl of newPlaylists) {
            const storeKey = `vtrpon_playlist_store_${pl.index}`;
            const storePayload = {
                name: pl.playlistData.name,
                endMode: (pl.playlistData.endMode !== undefined) ? pl.playlistData.endMode : null,
                data: pl.playlistData.data,
            };
            localStorage.setItem(storeKey, JSON.stringify(storePayload));
        }

        // stateControl/UI へ表示復元（activePlaylistIndex が 0 の旧データでも restoreIndex(=1) を表示復元する）
        if (restoreIndex >= 1 && restoreIndex <= 9) {
            for (const pl of newPlaylists) {
                const { playlistData, active } = pl;
                if (active) {
                    const playlistItemsContainer = document.querySelector('.playlist-items');
                    if (playlistItemsContainer) {
                        playlistItemsContainer.innerHTML = '';
                    }
                    try {
                        const normalizedForState = playlistData.data.map((f, idx) => ({
                            ...f,
                            order: (f.order !== undefined && f.order !== null) ? f.order : idx,
                        }));

                        await stateControl.setPlaylistState(normalizedForState);
                        await updatePlaylistUI();
                        logOpe('[playlist.js] Playlist restored to stateControl and UI after import.');
                    } catch (e) {
                        logInfo('[playlist.js] Failed to restore playlist into stateControl:', e);
                    }
                    await window.electronAPI.ipcRenderer.send('setMode', playlistData.endMode);
                }
            }
        }

        // アクティブスロット反映（ボタン色・表示名）
        if (restoreIndex >= 1 && restoreIndex <= 9) {
            setActiveStoreButton(restoreIndex);
            try {
                activePlaylistIndex = restoreIndex;
            } catch (e) {
            }
        }

        logDebug('[playlist.js] All playlists imported successfully');
        setTimeout(() => {
            showMessage(getMessage('playlists-imported-successfully'), 5000, 'info');
            if (missingFiles.length > 0) {
                const missingList = missingFiles.join('\n');
                showMessage(`${getMessage('files-not-found')}\n${missingList}`, 20000, 'alert');
            }
        }, 200);

    } catch (error) {
        if (error && error.message && error.message.includes('User canceled')) {
            logInfo('[playlist.js] Import canceled by user.');
        } else {
            const msg = (error && error.message) ? error.message : String(error);
            const stack = (error && error.stack) ? error.stack : '';
            const errorDetails = `Reason: ${msg}`;

            logInfo('[playlist.js] Error during import playlists (message):', msg);
            if (stack) {
                logInfo('[playlist.js] Error during import playlists (stack):', stack);
            }

            showMessage(`${getMessage('failed-to-import-playlist')}\n${errorDetails}`, 20000, 'alert');
        }
    }
}

// プレイリストインポート処理（メニュー呼び出し）
window.electronAPI.ipcRenderer.on('import-playlist', async () => {
    await doImportPlaylists();
});

// -----------------------
// リピートモードとリストモード
// -----------------------

// リピートとリストボタンイベントリスナー
document.getElementById("list-repeat-button").addEventListener("mousedown", () => {
    logOpe('[playlist.js] Playlist set to Repeat mode.');
    setRepeatMode();
});
document.getElementById("list-list-button").addEventListener("mousedown", () => {
    logOpe('[playlist.js] Playlist set to List mode.');
    setListMode();
});

// エンターキー誤動作防止
document.getElementById("list-repeat-button").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
    }
});

document.getElementById("list-list-button").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
    }
});

// リピートモード設定
async function setRepeatMode() {
    const playlist = await stateControl.getPlaylistState();

    const updatedPlaylist = playlist.map((item) => {
        if (item.startMode === "PLAY" && item.endMode === "UVC") {
            return item;
        }

        // startMode は "PAUSE" のときだけ "PLAY" に変更
        const newStartMode = (item.startMode === "PAUSE") ? "PLAY" : item.startMode;

        // endMode はリピートでは常に "NEXT"
        const newEndMode = "NEXT";

        return {
            ...item,
            startMode: newStartMode,
            endMode: newEndMode
        };
    });

    const normalizedPlaylist = updatedPlaylist.map(item => ({
        ...item,
        order: Number(item.order),
    }));

    await stateControl.setPlaylistState(normalizedPlaylist);

    updateListModeButtons("REPEAT");
    await updatePlaylistUI();
    // オートセーブ
    try {
        await saveActivePlaylistToStore();
    } catch (e) {
        logInfo('[playlist.js] Auto-save after setRepeatMode failed (ignored):', e);
    }
    logOpe("[playlist.js] Playlist set to REPEAT mode.");
    showMessage(getMessage('repeat-mode-activated'), 5000, "info");

    // モード切替後、エディットエリアへ現在の編集アイテムを再送信
    const latest = await stateControl.getPlaylistState();
    const editingItem = latest.find(item => item.editingState === 'editing');
    if (editingItem) {
        window.electronAPI.updateEditState(editingItem);
        logOpe(`[playlist.js] Edit area updated after mode change for ID: ${editingItem.playlistItem_id}`);

        // オンエア側へエンドモード同期
        window.electronAPI.syncOnAirEndMode &&
            window.electronAPI.syncOnAirEndMode({
                editingItemId: editingItem.playlistItem_id,
                endMode: editingItem.endMode
            });
        logOpe('[playlist.js] Requested On-Air endMode sync (REPEAT).');
    }
}

// リストモード設定
async function setListMode() {
    const playlist = await stateControl.getPlaylistState();

    const updatedPlaylist = playlist.map((item, index) => {
        if (item.startMode === "PLAY" && item.endMode === "UVC") {
            return item;
        }

        const isLast = (index === playlist.length - 1);

        // startMode は "PAUSE" のときだけ "PLAY" に変更
        const newStartMode = (item.startMode === "PAUSE") ? "PLAY" : item.startMode;

        // endMode は最後だけ "OFF"、それ以外は "NEXT"
        const newEndMode = isLast ? "OFF" : "NEXT";

        return {
            ...item,
            startMode: newStartMode,
            endMode: newEndMode
        };
    });

    const normalizedPlaylist = updatedPlaylist.map(item => ({
        ...item,
        order: Number(item.order),
    }));

    await stateControl.setPlaylistState(normalizedPlaylist);
    updateListModeButtons("LIST");
    await updatePlaylistUI();
    // オートセーブ
    try {
        await saveActivePlaylistToStore();
    } catch (e) {
        logInfo('[playlist.js] Auto-save after setListMode failed (ignored):', e);
    }
    logOpe("[playlist.js] Playlist set to LIST mode.");

    // 設定完了ユーザ通知
    showMessage(getMessage('list-mode-activated'), 5000, "info");

    // モード切替後、エディットエリアへ現在の編集アイテムを再送信
    const latest = await stateControl.getPlaylistState();
    const editingItem = latest.find(item => item.editingState === 'editing');
    if (editingItem) {
        window.electronAPI.updateEditState(editingItem);
        logOpe(`[playlist.js] Edit area updated after mode change for ID: ${editingItem.playlistItem_id}`);

        // オンエア側へエンドモード同期
        window.electronAPI.syncOnAirEndMode &&
            window.electronAPI.syncOnAirEndMode({
                editingItemId: editingItem.playlistItem_id,
                endMode: editingItem.endMode
            });
        logOpe('[playlist.js] Requested On-Air endMode sync (LIST).');
    }
}

// 右矢印キー自動押下処理
async function simulateRightArrowKey() {
    const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        keyCode: 39,
        bubbles: true,
    });
    document.dispatchEvent(event);

    try {
        const playlist = await stateControl.getPlaylistState();
        const updatedPlaylist = playlist.map(item => ({
            ...item,
            selectionState: "unselected",
            editingState: null,
        }));
        await stateControl.setPlaylistState(updatedPlaylist);
        await updatePlaylistUI();
        currentSelectedIndex = -1;
        logOpe('[playlist.js] Playlist selection cleared after right arrow simulation.');
    } catch (error) {
        logInfo('[playlist.js] Error clearing playlist selection:', error);
    }
}

// ボタン更新
function updateListModeButtons(activeMode) {
    const repeatButton = document.getElementById("list-repeat-button");
    const listButton = document.getElementById("list-list-button");

    if (!repeatButton || !listButton) {
        logInfo("[playlist.js] List mode buttons not found.");
        return;
    }

    // 全ボタンリセット
    repeatButton.classList.remove("button-green");
    repeatButton.classList.add("button-gray");
    listButton.classList.remove("button-green");
    listButton.classList.add("button-gray");
}

// -----------------------
// Sound Padモード処理
// -----------------------
async function handleSoundPadOnAir(item, index) {
    const targetId =
        (item && typeof item === 'object' && 'playlistItem_id' in item && item.playlistItem_id) ?
            item.playlistItem_id :
        (item && typeof item.getAttribute === 'function') ?
            item.getAttribute('data-playlist-item-id') :
            null;

    if (!targetId) {
        logInfo('[playlist.js] SOUND PAD On-Air: targetId not found.');
        return;
    }
    logOpe(`[playlist.js] SOUND PAD On-Air triggered for item ID: ${targetId}`);

    // 対象アイテム書換
    let playlist = await stateControl.getPlaylistState();
    playlist = playlist.map(file => {
        if (file.playlistItem_id === targetId) {
            // startMode: "PAUSE" → "PLAY"、それ以外は変更なし
            const newStartMode = (file.startMode === "PAUSE") ? "PLAY" : file.startMode;

            // endMode はサウンドパッドでは常に "OFF"
            const newEndMode = "OFF";

            return {
                ...file,
                startMode: newStartMode,
                endMode: newEndMode,
                selectionState: "selected",
                editingState: "editing"
            };
        }
        return file;
    });

    // 状態保存、UI更新
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // オートセーブ
    try {
        await saveActivePlaylistToStore();
    } catch (e) {
        logInfo('[playlist.js] Auto-save after SOUND PAD On-Air update failed (ignored):', e);
    }

    // 更新したアイテム送信
    const targetItem = playlist.find(file => file.playlistItem_id === targetId);
    if (targetItem) {
        window.electronAPI.updateEditState(targetItem);
        logOpe(`[playlist.js] SOUND PAD On-Air: Sent item to edit area with ID: ${targetId}`);
    }

    // オンエア処理
    await performOnAirForEditingItem();

    showMessage(
        `${getMessage('sound-pad-on-air-triggered')} ${targetItem ? targetItem.name : targetId}`,
        5000,
        'success'
    );
}

// -----------------------
// Direct Onair モード処理
// -----------------------
async function handleDirectOnAir(item, index) {
    const targetId =
        (item && typeof item === 'object' && 'playlistItem_id' in item && item.playlistItem_id) ?
            item.playlistItem_id :
        (item && typeof item.getAttribute === 'function') ?
            item.getAttribute('data-playlist-item-id') :
            null;

    if (!targetId) {
        logInfo('[playlist.js] DIRECT ONAIR: targetId not found.');
        return;
    }
    logOpe(`[playlist.js] DIRECT ONAIR triggered for item ID: ${targetId}`);
    let playlist = await stateControl.getPlaylistState();
    playlist = playlist.map(file => {
        if (file.playlistItem_id === targetId) {
            const newStartMode = (file.startMode === "PAUSE") ? "PLAY" : file.startMode;
            return {
                ...file,
                startMode: newStartMode,
                selectionState: "selected",
                editingState: "editing"
            };
        }
        return file;
    });
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // オートセーブ
    try {
        await saveActivePlaylistToStore();
    } catch (e) {
        logInfo('[playlist.js] Auto-save after DIRECT ONAIR update failed (ignored):', e);
    }

    // 更新アイテム送信
    const targetItem = playlist.find(file => file.playlistItem_id === targetId);
    if (targetItem) {
        window.electronAPI.updateEditState(targetItem);
        logOpe(`[playlist.js] DIRECT ONAIR: Sent item to edit area with ID: ${targetId}`);
    }

    // オンエア処理
    await performOnAirForEditingItem();

    showMessage(
        `${getMessage('direct-on-air-triggered')} ${targetItem ? targetItem.name : targetId}`,
        5000,
        'success'
    );
}

// Shift+数字処理
async function triggerQuickOnAirByIndex(idx) {
    try {
        const playlistItems = Array.from(document.querySelectorAll('.playlist-item'));
        if (idx < 0 || idx >= playlistItems.length) {
            return;
        }
        const itemEl = playlistItems[idx];
        const targetId = itemEl.getAttribute('data-playlist-item-id');
        await handlePlaylistItemClick(itemEl, idx);
        if (soundPadActive) {
            await handleSoundPadOnAir(itemEl, idx);
        } else if (directOnAirActive) {
            await handleDirectOnAir(itemEl, idx);
        } else {
        }
        if (targetId) {
            scrollToPlaylistItem(targetId);
        }
    } catch (error) {
        logInfo('[playlist.js] triggerQuickOnAirByIndex error:', error);
    }
}

// -----------------------
// ネクストモード処理
// -----------------------

// NEXTモード動画終了イベントリスナー
window.electronAPI.onNextModeCompleteBroadcast((currentItemId) => {
    logInfo(`[playlist.js] PLAYLIST: Received NEXT mode complete broadcast for Item ID: ${currentItemId}`);
    handleNextModePlaylist(currentItemId);
});

// 次に利用可能なアイテムのインデックスを返すヘルパー
function findNextAvailableIndex(sortedPlaylist, startIndex) {
    let count = sortedPlaylist.length;
    let idx = startIndex;
    while (count > 0) {
        if (!sortedPlaylist[idx].mediaOffline && !sortedPlaylist[idx].dskActive) {
            return idx;
        }
        idx = (idx + 1) % sortedPlaylist.length;
        count--;
    }
    return -1;
}

// localStorage 上のプレイリストから currentItemId を含むものを探すヘルパー
function findStoredPlaylistByItemId(targetItemId) {
    for (let i = 1; i <= 9; i++) {
        const key = `vtrpon_playlist_store_${i}`;
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        try {
            const parsed = JSON.parse(stored);
            const data = Array.isArray(parsed.data) ? parsed.data : [];
            const hasItem = data.some(item => item.playlistItem_id === targetItemId);
            if (hasItem) {
                return {
                    storeNumber: i,
                    key,
                    name: parsed.name || `Playlist ${i}`,
                    playlist_id: parsed.playlist_id || null,
                    data,
                };
            }
        } catch (error) {
            logDebug(`[playlist.js] Failed to parse playlist store: ${key}`, error);
        }
    }
    return null;
}

// stateControl上の「現在のプレイリスト実体」が、どの保存スロット由来か推定し、必要なら activePlaylistIndex を同期する
// 目的：GOTO/NEXT等で stateControl 側が別スロットの内容に切り替わった後、誤ったスロットへオートセーブされるのを防ぐ
async function syncActiveSlotToCurrentPlaylistStateIfNeeded() {
    try {
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist) || playlist.length === 0) return;

        const first = playlist.find(item => item && typeof item.playlistItem_id === 'string' && item.playlistItem_id);
        if (!first) return;

        const stored = findStoredPlaylistByItemId(first.playlistItem_id);
        if (!stored || !stored.storeNumber) return;

        const target = stored.storeNumber;

        if (typeof activePlaylistIndex === 'number' && activePlaylistIndex === target) return;

        activePlaylistIndex = target;

        // UI反映（stateControlの内容は既に切り替わっている前提なのでロードし直さない）
        try {
            updateStoreButtons();
        } catch (e) {
        }
        try {
            setActiveButton(target);
        } catch (e) {
        }

        const playlistNameDisplay = document.getElementById('playlist-name-display');
        if (playlistNameDisplay) {
            playlistNameDisplay.textContent = stored.name || `Playlist ${target}`;
        }
    } catch (e) {
        // ignore
    }
}

function getStoredPlaylistByNumber(storeNumber) {

    const num = Number(storeNumber);
    if (!Number.isFinite(num) || num < 1 || num > 9) return null;

    const key = `vtrpon_playlist_store_${num}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    try {
        const parsed = JSON.parse(stored);
        const data = Array.isArray(parsed.data) ? parsed.data : [];
        return {
            storeNumber: num,
            key,
            name: parsed.name || `Playlist ${num}`,
            playlist_id: parsed.playlist_id || null,
            data,
        };
    } catch (error) {
        logDebug(`[playlist.js] Failed to parse playlist store: ${key}`, error);
        return null;
    }
}

async function handleNextModePlaylist(currentItemId) {
    let playlist = await stateControl.getPlaylistState();

    // プレイリスト検証
    // 表示中スロットが空でも、再生中アイテムが所属する保存済みスロットから復元してNEXTを解決する
    if (!Array.isArray(playlist) || playlist.length === 0) {
        logDebug('[playlist.js] Playlist is empty or invalid. Trying to resolve NEXT from stored playlists (by currentItemId).');

        const sourcePlaylist = findStoredPlaylistByItemId(currentItemId);

        if (!sourcePlaylist || !Array.isArray(sourcePlaylist.data) || sourcePlaylist.data.length === 0) {
            logDebug('[playlist.js] Playlist is empty or invalid.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（プレイリスト空）');
            return;
        }

        logInfo(`[playlist.js] NEXT mode fallback (empty current playlist): Resolved source playlist from store #${sourcePlaylist.storeNumber} (${sourcePlaylist.name}).`);

        // 元プレイリストを「カレント」としてボタン表示も切り替える
        setActiveStoreButton(sourcePlaylist.storeNumber);

        // 元プレイリストを stateControl 側にロードし直す（選択状態も currentItemId に合わせて作り直す）
        const normalizedSourceData = sourcePlaylist.data.map((item, index) => ({
            ...item,
            order: (item.order !== undefined && item.order !== null) ? Number(item.order) : index,
            selectionState: item.playlistItem_id === currentItemId ? 'selected' : 'unselected',
            editingState: item.playlistItem_id === currentItemId ? 'editing' : null,
        }));

        await stateControl.setPlaylistState(normalizedSourceData);
        await updatePlaylistUI();

        playlist = await stateControl.getPlaylistState();

        if (!Array.isArray(playlist) || playlist.length === 0) {
            logInfo('[playlist.js] NEXT mode fallback (empty current playlist): Restored playlist is still empty. Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（NEXT: restored empty）');
            return;
        }
    }

    // 現在の選択アイテムIDを取得
    let currentSelectedItemId = null;
    try {
        const selectedItem = playlist.find(item => item.selectionState === "selected");
        if (selectedItem) {
            currentSelectedItemId = selectedItem.playlistItem_id;
        }
    } catch (error) {
        logDebug('[playlist.js] Failed to get current selected item:', error);
    }

    // 自動選択してよい条件
    //  - 現在選択なし
    //  - または現在の選択が「今終わったオンエアアイテム」
    let shouldAutoSelectNext = (!currentSelectedItemId || currentSelectedItemId === currentItemId);

    // ソート（現在表示中のプレイリスト）
    let sortedPlaylist = playlist.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    let currentIndex = sortedPlaylist.findIndex(item => item.playlistItem_id === currentItemId);

    // 1) カレントプレイリスト内にオンエア中アイテムが存在する場合 → 従来ロジック
    if (currentIndex === -1) {
        // 2) カレントプレイリストに currentItemId が存在しない場合
        //    → オンエアされているプレイリストとカレント表示プレイリストが異なるケース
        logDebug('[playlist.js] Current On-Air item not found in current playlist. Resolving NEXT from stored playlists.');

        const sourcePlaylist = findStoredPlaylistByItemId(currentItemId);

        if (!sourcePlaylist || !Array.isArray(sourcePlaylist.data) || sourcePlaylist.data.length === 0) {
            logInfo('[playlist.js] NEXT mode fallback: Current On-Air item not found in any stored playlist. Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（NEXT: stored playlist not found）');
            return;
        }

        logInfo(`[playlist.js] NEXT mode fallback: Resolved source playlist from store #${sourcePlaylist.storeNumber} (${sourcePlaylist.name}).`);

        // 元プレイリストを「カレント」としてボタン表示も切り替える
        setActiveStoreButton(sourcePlaylist.storeNumber);

        // 元プレイリストを stateControl 側にロードし直す
        const normalizedSourceData = sourcePlaylist.data.map((item, index) => ({
            ...item,
            order: (item.order !== undefined && item.order !== null) ? Number(item.order) : index,
            selectionState: item.playlistItem_id === currentItemId ? 'selected' : 'unselected',
            editingState: item.playlistItem_id === currentItemId ? 'editing' : null,
        }));

        await stateControl.setPlaylistState(normalizedSourceData);
        await updatePlaylistUI();

        const refreshedPlaylist = await stateControl.getPlaylistState();
        sortedPlaylist = refreshedPlaylist.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        currentIndex = sortedPlaylist.findIndex(item => item.playlistItem_id === currentItemId);

        if (currentIndex === -1) {
            logInfo('[playlist.js] NEXT mode fallback: Current On-Air item still not found after loading source playlist. Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（NEXT: resolved playlist mismatch）');
            return;
        }

        // 元プレイリストに戻したので、自動選択は許可してよい
        currentSelectedItemId = currentItemId;
        shouldAutoSelectNext = true;
    }

    const currentItem = sortedPlaylist[currentIndex];

    let nextItem = null;

    // -----------------------
    // GOTO
    // -----------------------
    if (currentItem && currentItem.endMode === "GOTO") {
        const gotoStoreNumber = (currentItem.endGotoPlaylist !== undefined && currentItem.endGotoPlaylist !== null) ? Number(currentItem.endGotoPlaylist) : NaN;
        const gotoItemId = currentItem.endGotoItemId;

        if (!Number.isFinite(gotoStoreNumber) || gotoStoreNumber < 1 || gotoStoreNumber > 9 || !gotoItemId) {
            logInfo('[playlist.js] GOTO mode: Destination not configured. Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（GOTO: destination not configured）');
            return;
        }

        const targetPlaylist = getStoredPlaylistByNumber(gotoStoreNumber);

        if (!targetPlaylist || !Array.isArray(targetPlaylist.data) || targetPlaylist.data.length === 0) {
            logInfo(`[playlist.js] GOTO mode: Stored playlist not found or empty. Sending Off-Air. storeNumber=${gotoStoreNumber}`);
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（GOTO: stored playlist not found）');
            return;
        }

        // 対象プレイリストへ切り替え（選択状態もここで作り直す）
        setActiveStoreButton(gotoStoreNumber);

        const normalizedTargetData = targetPlaylist.data.map((item, index) => ({
            ...item,
            order: (item.order !== undefined && item.order !== null) ? Number(item.order) : index,
            selectionState: item.playlistItem_id === gotoItemId ? 'selected' : 'unselected',
            editingState: item.playlistItem_id === gotoItemId ? 'editing' : null,
            onAirState: null,
        }));

        sortedPlaylist = normalizedTargetData.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        nextItem = sortedPlaylist.find(item => item.playlistItem_id === gotoItemId);

        if (!nextItem) {
            logInfo('[playlist.js] GOTO mode: Target item not found in stored playlist. Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（GOTO: target item not found）');
            return;
        }

        // GOTOは指定アイテムに固定（利用不可ならOff-Air）
        if (nextItem.mediaOffline || nextItem.dskActive) {
            logInfo('[playlist.js] GOTO mode: Target item is not available (media offline or DSK active). Sending Off-Air.');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（GOTO: target item unavailable）');
            return;
        }

        // GOTOでプレイリストを切り替えるため、自動選択を許可する
        currentSelectedItemId = gotoItemId;
        shouldAutoSelectNext = true;

        logInfo(`[playlist.js] GOTO MODE: Jump to store #${gotoStoreNumber}, itemId=${gotoItemId}, Name: ${nextItem.name}`);
    } else {
        let nextIndex = currentIndex + 1;
        if (nextIndex >= sortedPlaylist.length) {
            nextIndex = 0;
        }

        // メディアオフラインなら次の利用可能なアイテムを探す
        const availableIndex = findNextAvailableIndex(sortedPlaylist, nextIndex);
        if (availableIndex === -1) {
            logInfo('[playlist.js] No available next item (all items are media offline).');
            window.electronAPI.sendOffAirEvent();
            logOpe('[playlist.js] Off-Air通知を送信しました。（全アイテムがオフライン）');
            return;
        }

        nextIndex = availableIndex;
        nextItem = sortedPlaylist[nextIndex];

        logInfo(`[playlist.js] NEXT MODE (sorted): currentIndex=${currentIndex}, nextIndex=${nextIndex}, sortedPlaylistLength=${sortedPlaylist.length}`);
        logInfo(`[playlist.js] NEXT mode: Next selected item -> ID: ${nextItem.playlistItem_id}, Name: ${nextItem.name}`);
    }

    if (!nextItem) {
        logInfo('[playlist.js] No next item available in playlist.');
        return;
    }

    let updatedPlaylist;

    if (shouldAutoSelectNext) {
        // 次を選択する
        updatedPlaylist = sortedPlaylist.map(item => {
            return {
                ...item,
                selectionState: item.playlistItem_id === nextItem.playlistItem_id ? 'selected' : 'unselected',
                editingState: item.playlistItem_id === nextItem.playlistItem_id ? 'editing' : null,
                onAirState: null,
            };
        });
    } else {
        // ユーザーが別アイテムを編集中なので、選択/編集状態は維持してオンエア状態だけ消す
        updatedPlaylist = sortedPlaylist.map(item => {
            return {
                ...item,
                selectionState: item.selectionState,
                editingState: item.editingState,
                onAirState: null,
            };
        });
    }

    // プレイリスト状態設定
    await stateControl.setPlaylistState(updatedPlaylist);

    // NEXT/GOTO は必ず算出した nextItem をオンエア対象にする
    lastOnAirItemId = nextItem.playlistItem_id;
    await stateControl.setOnAirState(nextItem.playlistItem_id);
    logInfo(`[playlist.js] Next item set as On-Air: ${nextItem.name}`);

    // メインプロセスへ nextItem を通知（cue-button に依存しない）
    notifyOnAirItemId(nextItem.playlistItem_id);

    // エディットエリア更新は「自動選択してよい条件」のときだけ
    if (shouldAutoSelectNext) {
        // UVCデバイスの場合はエディットエリアに送らない
        if (nextItem.path && nextItem.path.startsWith("UVC_DEVICE")) {
            logInfo(`[playlist.js] Next item is a UVC device. Skipping edit area update.`);
            logOpe("[playlist.js] edit clear.");
        } else {
            await window.electronAPI.updateEditState(nextItem);
            logInfo(`[playlist.js] Next item sent to edit area: ${nextItem.name}`);
        }
    } else {
        logDebug(`[playlist.js] Skipped auto-select/edit/scroll in NEXT mode (user selection preserved). selected=${currentSelectedItemId}, currentOnAir=${currentItemId}`);
    }

    // プレイリストUI更新
    await updatePlaylistUI();

    // スクロールも「自動選択してよい条件」のときだけ
    if (shouldAutoSelectNext) {
        scrollToPlaylistItem(nextItem.playlistItem_id);
    }
}

// スクロール表示関数
function scrollToPlaylistItem(itemId) {
    const itemElement = document.querySelector(`.playlist-item[data-playlist-item-id="${itemId}"]`);
    if (itemElement) {
        itemElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
        });
        logInfo(`[playlist.js] Scrolled into view for next item: ${itemId}`);
    } else {
        logInfo(`[playlist.js] Playlist item with ID ${itemId} not found.`);
    }
}

// -----------------------
// DSK
// -----------------------

// DSKボタンイベントリスナー
const dskButton = document.getElementById('dsk-button');
if (dskButton) {
    dskButton.addEventListener('mousedown', async (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        logOpe('[playlist.js] DSK button clicked');
        if (window.dskModule.getCurrentDSKItem()) {
            window.dskModule.toggleOnAirDSK();
            window.electronAPI.sendDSKCommand({ command: 'DSK_TOGGLE' });
            return;
        }
        const playlist = await stateControl.getPlaylistState();
        const selectedItem = playlist.find(item => item.selectionState === "selected");
        if (!selectedItem) {
            showMessage(getMessage('no-selected-item-for-dsk'), 5000, 'alert');
            return;
        }
        window.dskModule.toggleOnAirDSK(selectedItem);
        window.electronAPI.sendDSKCommand({ command: 'DSK_TOGGLE', payload: selectedItem });
    });
} else {
    logInfo('[playlist.js] DSK button not found.');
}

// DSK送出状態反映
window.addEventListener('dsk-active-set', async (e) => {
    const activeItemId = e.detail.itemId;
    try {
        const playlist = await stateControl.getPlaylistState();
        const updatedPlaylist = playlist.map(item => ({
            ...item,
            dskActive: item.playlistItem_id === activeItemId
        }));
        await stateControl.setPlaylistState(updatedPlaylist);
        await updatePlaylistUI();
    } catch (err) {
        logInfo("Error updating dskActive flag in state:", err);
    }
    const dskButton = document.getElementById('dsk-button');
    if (dskButton) {
        dskButton.classList.add('button-recording');
    }
});

// DSK送出解除時
window.addEventListener('dsk-active-clear', async () => {
    try {
        const playlist = await stateControl.getPlaylistState();
        const cleared = playlist.map(item => ({ ...item, dskActive: false }));
        await stateControl.setPlaylistState(cleared);
        await updatePlaylistUI();
    } catch (err) {
        logInfo("Error clearing dskActive flags:", err);
    }
    const dskButton = document.getElementById('dsk-button');
    if (dskButton) {
        dskButton.classList.remove('button-recording');
    }
});

// 一時停止、再生ボタンイベントリスナー
const dksPauseButton = document.getElementById('dks-pause-button');
const dskPlayButton = document.getElementById('dsk-play-button');
if (dksPauseButton) {
    dksPauseButton.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        logOpe('[playlist.js] DSK Pause button clicked');
        window.dskModule.pauseOnAirDSK();
        window.electronAPI.sendControlToFullscreen({ command: 'DSK_PAUSE' });
    });
}
if (dskPlayButton) {
    dskPlayButton.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        logOpe('[playlist.js] DSK Play button clicked');
        window.dskModule.playOnAirDSK();
        window.electronAPI.sendControlToFullscreen({ command: 'DSK_PLAY' });
    });
}

// -----------------------
// モーダル処理
// -----------------------

// モーダル初期値設定
let isModalActive = false;

// Enterキーリスナー参照保持（リーク防止用）
let nameInputKeydownHandler = null;
let nameInputKeypressHandler = null;
let nameInputKeyupHandler = null;

// モーダル中 Enter を全体でガードするためのハンドラ参照
let modalEnterGuardHandler = null;
let modalEnterGuardKeyupHandler = null;

// IME（日本語変換）中かどうかを追跡
let isNameInputComposing = false;
let nameInputCompositionStartHandler = null;
let nameInputCompositionEndHandler = null;

// モーダル初期状態取得
window.electronAPI.getModalState().then((state) => {
    isModalActive = state.isActive;
    logInfo(`[playlist.js] Modal state initialized: ${isModalActive}`);
});

// モーダル状態変更監視
window.electronAPI.onModalStateChange((event, { isActive }) => {
    isModalActive = isActive;
});

// モーダル表示
function showModal() {
    document.getElementById('playlist-name-modal').classList.remove('hidden');
    const inputElement = document.getElementById('playlist-name-input');

    // モーダル状態更新
    window.electronAPI.updateModalState(true);

    if (inputElement) {
        // 既存リスナーがあれば掃除（重複防止）
        if (nameInputKeydownHandler) {
            inputElement.removeEventListener('keydown', nameInputKeydownHandler);
        }
        if (nameInputKeypressHandler) {
            inputElement.removeEventListener('keypress', nameInputKeypressHandler);
        }
        if (nameInputKeyupHandler) {
            inputElement.removeEventListener('keyup', nameInputKeyupHandler);
        }
        if (nameInputCompositionStartHandler) {
            inputElement.removeEventListener('compositionstart', nameInputCompositionStartHandler);
        }
        if (nameInputCompositionEndHandler) {
            inputElement.removeEventListener('compositionend', nameInputCompositionEndHandler);
        }

        // IME状態を追跡
        nameInputCompositionStartHandler = () => {
            isNameInputComposing = true;
        };
        nameInputCompositionEndHandler = () => {
            isNameInputComposing = false;
        };
        inputElement.addEventListener('compositionstart', nameInputCompositionStartHandler);
        inputElement.addEventListener('compositionend', nameInputCompositionEndHandler);

        // 入力欄側で Enter を全フェーズで封じる
        const blockEnter = (event) => {
            if (event.key !== 'Enter') return;

            // IME変換確定の Enter：defaultは殺さず、伝播だけ完全停止
            if (event.isComposing || isNameInputComposing || event.keyCode === 229) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                return;
            }

            // 通常の Enter：保存・フォーム送信等へ行かせない
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        };

        nameInputKeydownHandler = blockEnter;
        nameInputKeypressHandler = blockEnter;
        nameInputKeyupHandler = blockEnter;

        inputElement.addEventListener('keydown', nameInputKeydownHandler);
        inputElement.addEventListener('keypress', nameInputKeypressHandler);
        inputElement.addEventListener('keyup', nameInputKeyupHandler);
    }

    // モーダル中は document の capture でも Enter を握る（グローバル拾い対策）
    if (!modalEnterGuardHandler) {
        modalEnterGuardHandler = (event) => {
            if (!isModalActive) return;
            if (event.key !== 'Enter') return;

            // IME変換確定の Enter：defaultは殺さず、伝播のみ止める
            if (event.isComposing || isNameInputComposing || event.keyCode === 229) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        };
        document.addEventListener('keydown', modalEnterGuardHandler, true); // capture
    }

    if (!modalEnterGuardKeyupHandler) {
        modalEnterGuardKeyupHandler = (event) => {
            if (!isModalActive) return;
            if (event.key !== 'Enter') return;

            if (event.isComposing || isNameInputComposing || event.keyCode === 229) {
                event.stopImmediatePropagation();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        };
        document.addEventListener('keyup', modalEnterGuardKeyupHandler, true); // capture
    }

    setTimeout(() => {
        if (inputElement) inputElement.focus();
    }, 100);
}

function hideModal() {
    document.getElementById('playlist-name-modal').classList.add('hidden');

    const nameInput = document.getElementById('playlist-name-input');

    // Enterキーリスナー掃除（リーク防止）
    if (nameInput && nameInputKeydownHandler) {
        nameInput.removeEventListener('keydown', nameInputKeydownHandler);
        nameInputKeydownHandler = null;
    }
    if (nameInput && nameInputKeypressHandler) {
        nameInput.removeEventListener('keypress', nameInputKeypressHandler);
        nameInputKeypressHandler = null;
    }
    if (nameInput && nameInputKeyupHandler) {
        nameInput.removeEventListener('keyup', nameInputKeyupHandler);
        nameInputKeyupHandler = null;
    }

    // IMEリスナー掃除
    if (nameInput && nameInputCompositionStartHandler) {
        nameInput.removeEventListener('compositionstart', nameInputCompositionStartHandler);
        nameInputCompositionStartHandler = null;
    }
    if (nameInput && nameInputCompositionEndHandler) {
        nameInput.removeEventListener('compositionend', nameInputCompositionEndHandler);
        nameInputCompositionEndHandler = null;
    }
    isNameInputComposing = false;

    // document側 Enter ガード掃除
    if (modalEnterGuardHandler) {
        document.removeEventListener('keydown', modalEnterGuardHandler, true);
        modalEnterGuardHandler = null;
    }
    if (modalEnterGuardKeyupHandler) {
        document.removeEventListener('keyup', modalEnterGuardKeyupHandler, true);
        modalEnterGuardKeyupHandler = null;
    }

    // モーダル状態更新
    window.electronAPI.updateModalState(false); 
}

// ---------------------------
// コンテキストメニュー
// ---------------------------
let playlistContextMenuElement = null;
let playlistContextSubMenuElement = null;
let playlistContextMenuTargetId = null;
let playlistContextSubmenuHideTimer = null;

function createContextMenuElement(id) {
    const menu = document.createElement('div');
    menu.id = id;

    Object.assign(menu.style, {
        position: 'fixed',
        zIndex: '10000',
        minWidth: '220px',
        background: 'rgba(30, 30, 30, 0.98)',
        color: '#fff',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
        padding: '6px 0',
        fontSize: '14px',
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        display: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
    });

    document.body.appendChild(menu);
    return menu;
}

function ensurePlaylistContextMenu() {
    if (playlistContextMenuElement && playlistContextSubMenuElement) return;

    playlistContextMenuElement = createContextMenuElement('playlist-context-menu');
    playlistContextSubMenuElement = createContextMenuElement('playlist-context-submenu');

    const cancelSubmenuHide = () => {
        if (playlistContextSubmenuHideTimer) {
            clearTimeout(playlistContextSubmenuHideTimer);
            playlistContextSubmenuHideTimer = null;
        }
    };
    const scheduleSubmenuHide = () => {
        cancelSubmenuHide();
        playlistContextSubmenuHideTimer = setTimeout(() => {
            if (playlistContextSubMenuElement) {
                playlistContextSubMenuElement.style.display = 'none';
                playlistContextSubMenuElement.innerHTML = '';
            }
        }, 180);
    };

    playlistContextMenuElement.addEventListener('mouseenter', cancelSubmenuHide);
    playlistContextMenuElement.addEventListener('mouseleave', scheduleSubmenuHide);

    playlistContextSubMenuElement.addEventListener('mouseenter', cancelSubmenuHide);
    playlistContextSubMenuElement.addEventListener('mouseleave', scheduleSubmenuHide);

    document.addEventListener('click', () => {
        if (playlistContextMenuElement.style.display === 'none') return;
        hidePlaylistContextMenu();
    }, true);

    window.addEventListener('blur', hidePlaylistContextMenu);
    window.addEventListener('resize', hidePlaylistContextMenu);
    document.addEventListener('scroll', hidePlaylistContextMenu, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hidePlaylistContextMenu();
        }
    });
}

// 対象アイテムにパッチを当てて保存→UI更新→必要ならオンエア側へ同期
async function applyPlaylistItemPatch(playlistItemId, patch, { syncEndMode = false } = {}) {
    try {
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) return;

        const updatedPlaylist = playlist.map(item => {
            if (String(item.playlistItem_id) !== String(playlistItemId)) return item;

            let resolvedPatch = patch;
            if (typeof patch === 'function') {
                resolvedPatch = patch(item);
            }

            if (!resolvedPatch || typeof resolvedPatch !== 'object') {
                return item;
            }

            return { ...item, ...resolvedPatch };
        });

        await stateControl.setPlaylistState(updatedPlaylist);
        await updatePlaylistUI();

        // オートセーブ
        try {
            await saveActivePlaylistToStore();
        } catch (e) {
            logInfo('[playlist.js] Auto-save after applyPlaylistItemPatch failed (ignored):', e);
        }

        // 編集中アイテムがあればエディットエリアへ再送信
        const latest = await stateControl.getPlaylistState();
        const editingItem = latest.find(it => it.editingState === 'editing');
        if (editingItem) {
            window.electronAPI.updateEditState(editingItem);

            if (syncEndMode) {
                window.electronAPI.syncOnAirEndMode &&
                    window.electronAPI.syncOnAirEndMode({
                        editingItemId: editingItem.playlistItem_id,
                        endMode: editingItem.endMode
                    });
                logOpe('[playlist.js] Requested On-Air endMode sync (CONTEXT MENU).');
            }
        }
    } catch (e) {
        logInfo('[playlist.js] Context menu item update error:', e);
    }
}

function setPlaylistItemStartMode(playlistItemId, mode) {
    logOpe(`[playlist.js] startMode set via context menu: ${mode}`);
    applyPlaylistItemPatch(playlistItemId, { startMode: mode }, { syncEndMode: false });
}

function setPlaylistItemEndMode(playlistItemId, mode) {
    logOpe(`[playlist.js] endMode set via context menu: ${mode}`);
    applyPlaylistItemPatch(playlistItemId, { endMode: mode }, { syncEndMode: true });
}

// 背景色変更
function setPlaylistItemBgColor(playlistItemId, colorKey) {
    logOpe(`[playlist.js] bgColor set via context menu: ${colorKey}`);
    applyPlaylistItemPatch(playlistItemId, { bgColor: colorKey }, { syncEndMode: false });
}

// FTBトグル
async function togglePlaylistItemFtbEnabled(playlistItemId) {
    applyPlaylistItemPatch(
        playlistItemId,
        (item) => {
            const nextVal = !(item.ftbEnabled === true);
            logOpe(`[playlist.js] ftbEnabled toggled via context menu: ${nextVal}`);
            return { ftbEnabled: nextVal };
        },
        { syncEndMode: true }
    );
}

// labels.js取得
function getContextLabel(labelId, fallback) {
    try {
        if (typeof window.getLabel === 'function') {
            const v = window.getLabel(labelId);
            if (v && v !== labelId) return v;
        }
        if (typeof getLabel === 'function') {
            const v = getLabel(labelId);
            if (v && v !== labelId) return v;
        }
        if (window.labelManager && typeof window.labelManager.getLabel === 'function') {
            const v = window.labelManager.getLabel(labelId);
            if (v && v !== labelId) return v;
        }
        if (window.labelManager && typeof window.labelManager.getText === 'function') {
            const v = window.labelManager.getText(labelId);
            if (v && v !== labelId) return v;
        }
        if (typeof labels === 'object' && labels) {
            const rawLang =
                window.currentLanguage ||
                window.labelLanguage ||
                localStorage.getItem('language') ||
                document.documentElement.lang ||
                'ja';

            const lang = String(rawLang).toLowerCase().startsWith('en') ? 'en' : 'ja';
            const v = labels[lang] && labels[lang][labelId];
            if (v) return v;
        }
    } catch (e) {
    }
    return fallback;
}

function buildPlaylistContextMenuItems(playlistItemId) {
    const L = (key, fallback) => getContextLabel(key, fallback);
    const cap = (s) => (s && typeof s === 'string') ? (s.charAt(0).toUpperCase() + s.slice(1)) : s;

    const startModes = ['PAUSE', 'PLAY', 'FADEIN'];
    const endModes = ['OFF', 'PAUSE', 'REPEAT', 'NEXT'];
    const bgColors = ['default', 'red', 'yellow', 'blue', 'green'];

    const renameLabel =
        L('context-rename-item', null) ||
        L('rename-item', '名前の変更');

    const startModeLabel = L('context-start-mode', 'スタートモード');
    const endModeLabel = L('context-end-mode', 'エンドモード');
    const ftbToggleLabel = L('context-end-mode-ftb', 'FTB');
    const bgColorLabel = L('context-bg-color', '背景色');
    const copyStateLabel = L('context-copy-item-state', 'アイテムの状態をコピー');
    const pasteStateLabel = L('context-paste-item-state', 'アイテムの状態をペースト');

    const hasCopiedState = (typeof copiedItemState !== 'undefined') && !!copiedItemState;

    const startModeChildren = startModes.map(v => ({
        label: L(`context-start-mode-${v.toLowerCase()}`, v),
        action: () => setPlaylistItemStartMode(playlistItemId, v)
    }));

    const endModeChildren = [
        ...endModes.map(v => ({
            label: L(`context-end-mode-${v.toLowerCase()}`, v),
            action: () => setPlaylistItemEndMode(playlistItemId, v)
        })),
        {
            label: ftbToggleLabel,
            action: () => togglePlaylistItemFtbEnabled(playlistItemId)
        }
    ];

    const bgColorChildren = bgColors.map(v => ({
        label: L(`context-bg-color-${v}`, cap(v)),
        action: () => setPlaylistItemBgColor(playlistItemId, v)
    }));

    // START → END → COPY → PASTE(条件付き無効) → BGCOLOR → RENAME
    return [
        { label: startModeLabel, children: startModeChildren },
        { label: endModeLabel, children: endModeChildren },
        { label: copyStateLabel, action: () => copyItemState() },
        { label: pasteStateLabel, disabled: !hasCopiedState, action: () => pasteItemState() },
        { label: bgColorLabel, children: bgColorChildren },
        { label: renameLabel, action: () => openItemRenameModal(playlistItemId) }
    ];
}

function renderContextMenu(menuEl, items, level = 0, anchorRect = null) {
    menuEl.innerHTML = '';

    items.forEach((it) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            minHeight: '30px',
            cursor: 'default',
            lineHeight: '1.4',
        });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = it.label;
        row.appendChild(labelSpan);

        if (it.disabled) {
            row.style.opacity = '0.45';
        }

        if (Array.isArray(it.children) && it.children.length > 0) {
            const arrowSpan = document.createElement('span');
            arrowSpan.textContent = '>';
            arrowSpan.style.opacity = '0.7';
            row.appendChild(arrowSpan);
        }

        row.addEventListener('mouseenter', () => {
            // disabled 行はハイライト/操作しない
            if (it.disabled) {
                row.style.background = 'transparent';
                if (level === 0 && playlistContextSubMenuElement) {
                    playlistContextSubMenuElement.style.display = 'none';
                    playlistContextSubMenuElement.innerHTML = '';
                }
                return;
            }

            row.style.background = 'rgba(255, 255, 255, 0.08)';
            if (playlistContextSubmenuHideTimer) {
                clearTimeout(playlistContextSubmenuHideTimer);
                playlistContextSubmenuHideTimer = null;
            }

            if (Array.isArray(it.children) && it.children.length > 0) {
                const rect = row.getBoundingClientRect();
                renderContextMenu(playlistContextSubMenuElement, it.children, level + 1, rect);
                let x = rect.right + 2;
                let y = rect.top;

                playlistContextSubMenuElement.style.display = 'block';
                playlistContextSubMenuElement.style.left = `${x}px`;
                playlistContextSubMenuElement.style.top = `${y}px`;
                const srect = playlistContextSubMenuElement.getBoundingClientRect();
                if (srect.right > window.innerWidth) {
                    x = Math.max(0, rect.left - srect.width - 2);
                }
                if (srect.bottom > window.innerHeight) {
                    y = Math.max(0, window.innerHeight - srect.height - 4);
                }

                playlistContextSubMenuElement.style.left = `${x}px`;
                playlistContextSubMenuElement.style.top = `${y}px`;
            } else {
                // ルートメニューで子がない行に乗ったらサブメニューを閉じる
                if (level === 0 && playlistContextSubMenuElement) {
                    playlistContextSubMenuElement.style.display = 'none';
                    playlistContextSubMenuElement.innerHTML = '';
                }
            }
        });

        row.addEventListener('mouseleave', () => {
            row.style.background = 'transparent';
        });

        row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (it.disabled) {
                return;
            }

            if (Array.isArray(it.children) && it.children.length > 0) {
                return;
            }

            hidePlaylistContextMenu();
            try {
                if (typeof it.action === 'function') it.action();
            } catch (err) {
                logInfo(`[playlist.js] Context menu action failed: ${err}`);
            }
        });

        menuEl.appendChild(row);
    });

    if (level === 0) {
        playlistContextSubMenuElement.style.display = 'none';
        playlistContextSubMenuElement.innerHTML = '';
    }
}

function showPlaylistItemContextMenu(clientX, clientY, playlistItemId) {
    ensurePlaylistContextMenu();

    const menu = playlistContextMenuElement;
    playlistContextMenuTargetId = playlistItemId;

    const items = buildPlaylistContextMenuItems(playlistItemId);

    renderContextMenu(menu, items, 0, null);

    menu.style.display = 'block';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const rect = menu.getBoundingClientRect();
    let x = clientX;
    let y = clientY;

    if (rect.right > window.innerWidth) {
        x = Math.max(0, window.innerWidth - rect.width - 4);
    }
    if (rect.bottom > window.innerHeight) {
        y = Math.max(0, window.innerHeight - rect.height - 4);
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

function hidePlaylistContextMenu() {
    if (playlistContextMenuElement) {
        playlistContextMenuElement.style.display = 'none';
        playlistContextMenuElement.innerHTML = '';
    }
    if (playlistContextSubMenuElement) {
        playlistContextSubMenuElement.style.display = 'none';
        playlistContextSubMenuElement.innerHTML = '';
    }
    playlistContextMenuTargetId = null;
}

// ---------------------------
// プレイリスト名変更モーダル
// ---------------------------
async function openActivePlaylistNameRenameModal() {
    const modal = document.getElementById('playlist-name-modal');
    const nameInput = document.getElementById('playlist-name-input');
    const saveButton = document.getElementById('playlist-name-save');
    const cancelButton = document.getElementById('playlist-name-cancel');

    // モーダル見出し取得
    const titleElement = modal ? modal.querySelector('[data-label-id="playlist-name-title"]') : null;
    const originalTitleText = titleElement ? titleElement.textContent : '';

    if (!modal || !nameInput || !saveButton || !cancelButton) {
        logInfo('[playlist.js] Failed to open playlist rename modal: required elements not found.');
        return;
    }

    try {
        const active = getActivePlaylistSlotOrDefault(1);

        const key = `vtrpon_playlist_store_${active}`;

        // 現在名（引数なし自動保存方式に合わせて、保存済み名があればそれを優先）
        let currentName = `Playlist ${active}`;
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
                    currentName = parsed.name.trim();
                }
            }
        } catch (e) {
        }

        // タイトル差し替え
        if (titleElement) {
            titleElement.textContent = 'ENTER PLAYLIST NAME';
        }
        const restoreTitle = () => {
            if (titleElement) {
                titleElement.textContent = originalTitleText;
            }
        };

        showModal();
        nameInput.value = currentName;
        nameInput.focus();
        try {
            nameInput.select();
        } catch (e) {
        }

        let handled = false;

        const applyName = async () => {
            if (handled) return;
            handled = true;

            const raw = (typeof nameInput.value === 'string') ? nameInput.value : '';
            const trimmed = raw.trim();
            const finalName = trimmed ? trimmed : `Playlist ${active}`;

            // “名前だけ”更新を優先（存在すればJSONのnameのみ差し替え）
            let updated = false;
            try {
                const storedNow = localStorage.getItem(key);
                if (storedNow) {
                    const parsedNow = JSON.parse(storedNow);
                    if (parsedNow && typeof parsedNow === 'object') {
                        parsedNow.name = finalName;
                        localStorage.setItem(key, JSON.stringify(parsedNow));
                        updated = true;
                    }
                }
            } catch (e) {
            }

            // 未保存スロット等：現在状態も含めて保存して名前を確定
            if (!updated) {
                await saveActivePlaylistToStore(finalName);
            }

            // UI反映
            const playlistNameDisplay = document.getElementById('playlist-name-display');
            if (playlistNameDisplay) {
                playlistNameDisplay.textContent = finalName;
            }

            // ボタン色も更新
            try {
                updateButtonColors();
            } catch (e) {
            }

            restoreTitle();
            hideModal();
        };

        saveButton.onclick = () => {
            void applyName();
        };

        cancelButton.onclick = () => {
            if (handled) return;
            handled = true;
            restoreTitle();
            hideModal();
        };

        // Enter / Escape
        nameInputKeydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void applyName();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (handled) return;
                handled = true;
                restoreTitle();
                hideModal();
            }
        };
        nameInput.addEventListener('keydown', nameInputKeydownHandler);
    } catch (error) {
        logInfo(`[playlist.js] Failed to open playlist rename modal. Error: ${error?.stack || error?.message || error}`);
    }
}

// ---------------------------
// プレイリストアイテム名変更モーダル
// ---------------------------
async function openItemRenameModal(targetPlaylistItemId) {

    const modal = document.getElementById('playlist-name-modal');
    const nameInput = document.getElementById('playlist-name-input');
    const saveButton = document.getElementById('playlist-name-save');
    const cancelButton = document.getElementById('playlist-name-cancel');

    // モーダル見出し取得
    const titleElement = modal ? modal.querySelector('[data-label-id="playlist-name-title"]') : null;
    const originalTitleText = titleElement ? titleElement.textContent : '';

    if (!modal || !nameInput || !saveButton || !cancelButton) {
        logInfo('[playlist.js] Failed to open rename modal: required elements not found.');
        return;
    }

    try {
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist is not an array while opening rename modal.');
            return;
        }

        const targetItem = playlist.find((item) => String(item.playlistItem_id) === String(targetPlaylistItemId));
        if (!targetItem) {
            logInfo(`[playlist.js] Target item for rename not found. ID: ${targetPlaylistItemId}`);
            return;
        }

        const currentName = typeof targetItem.name === 'string' ? targetItem.name : '';

        // 既存のEnterリスナー解除（SAVEモードなどからの残りを掃除）
        if (nameInputKeydownHandler) {
            nameInput.removeEventListener('keydown', nameInputKeydownHandler);
            nameInputKeydownHandler = null;
        }

        // 名前変更モード用にタイトルを差し替え
        if (titleElement) {
            titleElement.textContent = 'ENTER ITEM NAME';
        }

        const restoreTitle = () => {
            if (titleElement) {
                titleElement.textContent = originalTitleText;
            }
        };

        showModal();
        nameInput.value = currentName;

        // 末尾にカーソルを移動
        setTimeout(() => {
            try {
                const length = nameInput.value.length;
                nameInput.setSelectionRange(length, length);
                nameInput.focus();
            } catch (e) {
                // ignore
            }
        }, 100);

        let handled = false;

        const fireRename = async () => {
            if (handled) return;
            handled = true;

            const newName = nameInput.value.trim();
            if (!newName) {
                restoreTitle();
                hideModal();
                return;
            }

            await renamePlaylistItemName(targetPlaylistItemId, newName);
            restoreTitle();
            hideModal();
        };

        // 保存ボタン
        saveButton.onclick = () => {
            fireRename();
        };

        // キャンセルボタン
        cancelButton.onclick = () => {
            if (handled) return;
            handled = true;
            restoreTitle();
            hideModal();
        };

        // Enter / Escape キー
        nameInputKeydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                fireRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (handled) return;
                handled = true;
                restoreTitle();
                hideModal();
            }
        };
        nameInput.addEventListener('keydown', nameInputKeydownHandler);
    } catch (error) {
        logInfo(`[playlist.js] Failed to open rename modal. Error: ${error.message}`);
    }
}

// --------------------------------
//  キーボードショートカット
// --------------------------------

// ショートカットからボタンの mousedown を発火させるユーティリティ
function triggerButtonMouseDown(buttonId, logMessage) {
    const btn = document.getElementById(buttonId);
    if (!btn) {
        logInfo(`[playlist.js] Button not found for shortcut. id=${buttonId}`);
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

function handlePlaylistShortcut(action) {
    switch (action) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            triggerButtonMouseDown(
                `playlise${action}-button`,
                `[playlist.js] Playlist button ${action} triggered via synthetic mousedown.`
            );
            break;
        case 'save':
            triggerButtonMouseDown(
                'playlise-save-button',
                '[playlist.js] Save mode button triggered via synthetic mousedown.'
            );
            break;
        case 'delete':
            triggerButtonMouseDown(
                'playlisedel-button',
                '[playlist.js] Delete mode button triggered via synthetic mousedown.'
            );
            break;
        case 'clear':
            triggerButtonMouseDown(
                'playliseclear-button',
                '[playlist.js] Clear button triggered via synthetic mousedown.'
            );
            break;
        case 'repeat':
            triggerButtonMouseDown(
                'list-repeat-button',
                '[playlist.js] List mode REPEAT triggered via synthetic mousedown.'
            );
            break;
        case 'list':
            triggerButtonMouseDown(
                'list-list-button',
                '[playlist.js] List mode LIST triggered via synthetic mousedown.'
            );
            break;
        case 'add-file':
            triggerButtonMouseDown(
                'file-button',
                '[playlist.js] Add file button triggered via synthetic mousedown.'
            );
            break;
        case 'on-air':
            logOpe('[playlist.js] On-Air triggered via shortcut.');
            performOnAirForEditingItem();
            break;
        case 'Shift+Alt+D': {
            const directOnAirButton = document.getElementById('directonair-mode-button');
            if (directOnAirButton) {
                const mouseDownEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                });
                directOnAirButton.dispatchEvent(mouseDownEvent);
                logOpe('[playlist.js] DIRECT ONAIR mode triggered via shortcut.');
            } else {
                logInfo('[playlist.js] DIRECT ONAIR shortcut: directonair-mode-button not found.');
            }
            break;
        }
        case 'Shift+Alt+S': {
            const soundPadButton = document.getElementById('soundpad-mode-button');
            if (soundPadButton) {
                const mouseDownEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                });
                soundPadButton.dispatchEvent(mouseDownEvent);
                logOpe('[playlist.js] SOUND PAD mode triggered via shortcut.');
            } else {
                logInfo('[playlist.js] SOUND PAD shortcut: soundpad-mode-button not found.');
            }
            break;
        }
        case 'Shift+D':
            triggerButtonMouseDown(
                'dsk-button',
                '[playlist.js] DSK toggled via shortcut (synthetic mousedown).'
            );
            break;
        default:
            logInfo(`[playlist.js] Unknown action: ${action}`);
    }
}

// キーボードショートカット設定
document.addEventListener('keydown', (event) => {
    if (isModalActive) {
        return; // モーダルが開いている場合はショートカットを無視
    }

    const keyLower = event.key.toLowerCase();
    const code     = event.code;
    const isMod    = event.ctrlKey || event.metaKey;
    const isShift  = event.shiftKey;
    const isAlt    = event.altKey;
    const isEnter  = event.key === 'Enter';

    // Shift+Enter
    if (isShift && isEnter) {
        event.preventDefault();
        triggerButtonMouseDown(
            'cue-button',
            '[playlist.js] On-Air triggered via Shift+Enter (synthetic mousedown).'
        );
        return;
    }

    // Shift+数字 / テンキー
    let quickOnAirIdx = null;

    // パターンA: キーボード上段の数字キー (Digit1?Digit0) を Shift付きで押した場合
    if (!isMod && !isAlt && isShift && code.startsWith('Digit')) {
        const digitChar = code.replace('Digit', '');
        if (/^[0-9]$/.test(digitChar)) {
            if (digitChar === '0') {
                quickOnAirIdx = 9; // 0は10番目
            } else {
                quickOnAirIdx = parseInt(digitChar, 10) - 1;
            }
        }
    }

    // パターンB: テンキー (Numpad1?Numpad0) を押した場合
    if (!isMod && !isAlt && code.startsWith('Numpad') && quickOnAirIdx === null) {
        const digitChar = code.replace('Numpad', '');
        if (/^[0-9]$/.test(digitChar)) {
            if (digitChar === '0') {
                quickOnAirIdx = 9; // 0は10番目
            } else {
                quickOnAirIdx = parseInt(digitChar, 10) - 1;
            }
        }
    }

    // quickOnAirIdx即オンエア処理
    if (quickOnAirIdx !== null) {
        event.preventDefault();
        logOpe(
            `[playlist.js] QuickOnAir key detected. code=${code}, idx=${quickOnAirIdx}, ` +
            `soundPadActive=${soundPadActive}, directOnAirActive=${directOnAirActive}`
        );
        if (!(soundPadActive || directOnAirActive)) {
            logOpe('[playlist.js] QuickOnAir ignored because both modes are OFF.');
            return;
        }

        logOpe(`[playlist.js] triggerQuickOnAirByIndex(${quickOnAirIdx}) called.`);
        triggerQuickOnAirByIndex(quickOnAirIdx);
        return;
    }

    // ===========================================
    // それ以外のショートカット
    // ===========================================
    if (isMod || isShift || isAlt) {
        event.preventDefault();

        if (isShift && isAlt && keyLower === 'd') {
            handlePlaylistShortcut('Shift+Alt+D');
        } else if (isShift && !isAlt && !isMod && keyLower === 'd') {
            handlePlaylistShortcut('Shift+D');
        } else if (isMod && keyLower === '.') {
            handlePlaylistShortcut('Mod+.');
        } else if (isMod && keyLower === ',') {
            handlePlaylistShortcut('Mod+,');
        } else if (isMod && keyLower === '1') {
            handlePlaylistShortcut('1');
        } else if (isMod && keyLower === '2') {
            handlePlaylistShortcut('2');
        } else if (isMod && keyLower === '3') {
            handlePlaylistShortcut('3');
        } else if (isMod && keyLower === '4') {
            handlePlaylistShortcut('4');
        } else if (isMod && keyLower === '5') {
            handlePlaylistShortcut('5');
        } else if (isMod && keyLower === '6') {
            handlePlaylistShortcut('6');
        } else if (isMod && keyLower === '7') {
            handlePlaylistShortcut('7');
        } else if (isMod && keyLower === '8') {
            handlePlaylistShortcut('8');
        } else if (isMod && keyLower === '9') {
            handlePlaylistShortcut('9');
        } else if (isMod && keyLower === 'k') {
            handlePlaylistShortcut('clear');
        } else if (isMod && keyLower === 'r') {
            handlePlaylistShortcut('repeat');
        } else if (isMod && keyLower === 'l') {
            handlePlaylistShortcut('list');
        } else if (isMod && keyLower === 'e') {
            doExportPlaylist();
        } else if (isMod && keyLower === 'i') {
            doImportPlaylists();
        } else if (isMod && keyLower === 'f') {
            handlePlaylistShortcut('add-file');
        } else if (isMod && keyLower === 'c') {
            copyItemState();
        } else if (isMod && keyLower === 'v') {
            pasteItemState();
        }
    }
});

// メニューショートカットイベント処理
window.electronAPI.onShortcutTrigger((event, shortcut) => {
    logInfo(`[playlist.js] Shortcut triggered: ${shortcut}`);

    if (isModalActive) {
        logDebug('[playlist.js] Shortcut ignored due to active modal.');
        return; // モーダルがアクティブな場合は処理をスキップ
    }

    if (shortcut === 'Shift+Enter') {
        triggerButtonMouseDown(
            'cue-button',
            '[playlist.js] On-Air triggered via menu shortcut (synthetic mousedown).'
        );
    }
    else if (shortcut === 'add-file') {
        handlePlaylistShortcut('add-file');
    }
    else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(shortcut)) {
        handlePlaylistShortcut(shortcut);
    }
    else if (shortcut === 'clear') {
        handlePlaylistShortcut('clear');
    }
    else if (shortcut === 'repeat') {
        handlePlaylistShortcut('repeat');
    }
    else if (shortcut === 'list') {
        handlePlaylistShortcut('list');
    }
    else if (shortcut === 'Shift+Alt+D') {
        handlePlaylistShortcut('Shift+Alt+D');
    }
    else if (shortcut === 'Shift+Alt+S') {
        handlePlaylistShortcut('Shift+Alt+S');
    }
    else if (shortcut === 'Shift+D') {
        handlePlaylistShortcut('Shift+D');
    }
    else if (shortcut === 'copy-item-state') {
        copyItemState();
    }
    else if (shortcut === 'paste-item-state') {
        pasteItemState();
    }
});

// -----------------------
// アイテム状態コピー＆ペースト機能
// -----------------------

// アイテム状態コピー関数
function copyItemState() {
    const playlist = stateControl.getPlaylistState();
    if (currentSelectedIndex < 0 || currentSelectedIndex >= playlist.length) {
        logInfo('[playlist.js] No item selected for copying.');
        showMessage(getMessage('no-item-to-copy'), 3000, 'alert');
        return;
    }
    const item = playlist[currentSelectedIndex];
    copiedItemState = {
        startMode: item.startMode,
        endMode: item.endMode,
        ftbRate: item.ftbRate,
        ftbEnabled: !!item.ftbEnabled,
        bgColor: item.bgColor
    };
    logOpe(`[playlist.js] Copied state: ${JSON.stringify(copiedItemState)}`);
    showMessage(getMessage('item-state-copied'), 3000, 'success');
}

// アイテム状態ペースト関数
async function pasteItemState() {
    if (!copiedItemState) {
        logInfo('[playlist.js] No copied state available.');
        showMessage(getMessage('no-copied-state'), 3000, 'alert');
        return;
    }
    const playlist = await stateControl.getPlaylistState();
    if (currentSelectedIndex < 0 || currentSelectedIndex >= playlist.length) {
        logInfo('[playlist.js] No item selected for pasting.');
        showMessage(getMessage('no-item-to-paste'), 3000, 'alert');
        return;
    }
    const item = playlist[currentSelectedIndex];
    item.startMode = copiedItemState.startMode;
    item.endMode = copiedItemState.endMode;
    item.ftbRate = copiedItemState.ftbRate;
    if (typeof copiedItemState.ftbEnabled !== 'undefined') {
        item.ftbEnabled = !!copiedItemState.ftbEnabled;
    }
    if (typeof copiedItemState.bgColor !== 'undefined') {
        item.bgColor = copiedItemState.bgColor;
    }
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // オートセーブ
    try {
        await saveActivePlaylistToStore();
    } catch (e) {
        logInfo('[playlist.js] Auto-save after pasteItemState failed (ignored):', e);
    }

    // Notify the edit area to update its UI
    window.electronAPI.updateEditState(item);
    logOpe(`[playlist.js] Pasted state to item ID ${item.playlistItem_id}.`);
    showMessage(getMessage('item-state-pasted'), 3000, 'success');
}

// ------------------------------------------------
// 矢印でアイテムを選択するショートカット(↑↓キー）
// ------------------------------------------------

// 現在選択されているアイテムのインデックス
let currentSelectedIndex = -1;

// コピーされたアイテム状態保持
let copiedItemState = null;

// 矢印キーで選択を移動
function changePlaylistSelection(direction) {
    if (isModalActive) {
        return; // モーダルが開いている場合はショートカットを無視
    }

    const items = Array.from(document.querySelectorAll('.playlist-item'));
    if (items.length === 0) {
        logInfo('[playlist.js] No playlist items available for selection.');
        return;
    }

    // 現在の選択状態初期化
    if (currentSelectedIndex === -1) {
        const selectedItem = items.find(item => item.classList.contains('editing'));
        currentSelectedIndex = items.indexOf(selectedItem);
        if (currentSelectedIndex === -1) currentSelectedIndex = 0;
    }

    // 上下移動ロジック
    currentSelectedIndex += direction;
    if (currentSelectedIndex < 0) currentSelectedIndex = items.length - 1;
    if (currentSelectedIndex >= items.length) currentSelectedIndex = 0;

    // 現在選択されたアイテム取得
    const selectedItem = items[currentSelectedIndex];

    // アイテム画面内スクロール
    selectedItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
    });

    // クリック処理
    handlePlaylistItemClick(selectedItem, currentSelectedIndex);
    logOpe(`[playlist.js] Playlist selection changed to index: ${currentSelectedIndex}`);
}

// キーボードイベントリスナー登録
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
        changePlaylistSelection(-1);
        event.preventDefault();
        logOpe('[playlist.js] ArrowUp clicked.');
    } else if (event.key === 'ArrowDown') {
        changePlaylistSelection(1);
        event.preventDefault();
        logOpe('[playlist.js] ArrowDown clicked.');
    }
});

// -----------------
//     API
//------------------

window.playlistAPI = {
    addFilesFromPaths: async (paths) => {
        if (!Array.isArray(paths) || paths.length === 0) {
            logInfo('[playlist.js] playlistAPI.addFilesFromPaths called with empty paths.');
            return;
        }
        const files = paths.map((p) => ({
            path: p,
            name: window.electronAPI.path.basename(p),
        }));

        logOpe(`[playlist.js] playlistAPI.addFilesFromPaths called. count=${files.length}`);
        enqueueImport(files);
    },
};

// ----------------------//
//     初期化実行        //
//-----------------------//

initializePlaylistUI();