// -----------------------
//     playlist.js 
//     ver 2.2.7
// -----------------------


// -----------------------
// 初期設定
// -----------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
const logDebug = window.electronAPI.logDebug;

// 状態管理の取得
const stateControl = window.electronAPI.stateControl;

// モード状態管理：SOUND PADモードと DIRECT ONAIRモード
let soundPadActive = false;
let directOnAirActive = false;

// 変換中のファイルを管理
const convertingFiles = new Set();

// 進捗表示用関数
function updateLoadingProgress(current, total) {
    const progressElem = document.getElementById('loading-progress');
    if (progressElem) {
        progressElem.textContent = `LOADING... ${current} / ${total}`;
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

    // オンエアボタンのイベントリスナーを初期化
    initializeOnAirButtonListener();

    // Listeditからの更新通知のイベントリスナ
    window.electronAPI.onListeditUpdated(async () => {
        logDebug('[playlist.js] Received listedit-updated notification, refreshing UI...');
        await updatePlaylistUI();
    });

    // SOUND PADモードボタンのイベントリスナーを初期化
    const soundPadButton = document.getElementById('soundpad-mode-button');
    if (soundPadButton) {
        soundPadButton.addEventListener('click', () => {
            soundPadActive = !soundPadActive;
            if (soundPadActive) {
                // 相互排他：DIRECT ONAIRモードがオンならオフにする
                if (directOnAirActive) {
                    directOnAirActive = false;
                    const directOnAirButton = document.getElementById('directonair-mode-button');
                    if (directOnAirButton) directOnAirButton.classList.remove('button-green');
                }
                soundPadButton.classList.add('button-green');
            } else {
                soundPadButton.classList.remove('button-green');
            }
            logOpe(`[playlist.js] SOUND PAD mode toggled: ${soundPadActive}`);
            soundPadButton.blur();
        });
    } else {
        logInfo('[playlist.js] SOUND PAD mode button not found.');
    }

    // サウンドパッドモードのショートカットキーを干渉防止で先にリッスン
    document.addEventListener('keydown', (event) => {
        if (event.altKey && event.shiftKey && event.key.toLowerCase() === 's') {
            event.stopPropagation();
            event.preventDefault();
            document.getElementById('soundpad-mode-button')?.click();
            logOpe('[playlist.js] SOUND PAD mode triggered via shortcut.');
        }
    }, true); // キャプチャフェーズで登録

    // DIRECT ONAIRモードボタンのイベントリスナーを初期化
    const directOnAirButton = document.getElementById('directonair-mode-button');
    if (directOnAirButton) {
        directOnAirButton.addEventListener('click', () => {
            directOnAirActive = !directOnAirActive;
            if (directOnAirActive) {
                // 相互排他：SOUND PADモードがオンならオフにする
                if (soundPadActive) {
                    soundPadActive = false;
                    const soundPadButton = document.getElementById('soundpad-mode-button');
                    if (soundPadButton) soundPadButton.classList.remove('button-green');
                }
                directOnAirButton.classList.add('button-green');
            } else {
                directOnAirButton.classList.remove('button-green');
            }
            logOpe(`[playlist.js] DIRECT ONAIR mode toggled: ${directOnAirActive}`);
            directOnAirButton.blur();
        });
    } else {
        logInfo('[playlist.js] DIRECT ONAIR mode button not found.');
    }

    // ファイルボタンのクリックイベント登録
    addFileButton.addEventListener('click', async () => {
        logOpe('[playlist.js] File button clicked.');

        try {
            const files = await window.electronAPI.selectFiles();
            if (!files || files.length === 0) {
                logInfo('[playlist.js] No files selected.');
                return;
            }
            // 進捗表示を初期化
            updateLoadingProgress(0, files.length);

            let processedCount = 0;
            let validUpdatesAccum = [];
            let currentPlaylist = await stateControl.getPlaylistState();

            // 各ファイルを順次処理する（getValidUpdates は配列を受け取るため、個別処理）
            for (const file of files) {
                const validUpdates = await getValidUpdates([file], currentPlaylist);
                if (validUpdates.length > 0) {
                    validUpdatesAccum = validUpdatesAccum.concat(validUpdates);
                }
                processedCount++;
                updateLoadingProgress(processedCount, files.length);
            }

            if (validUpdatesAccum.length > 0) {
                const updatedPlaylist = currentPlaylist.map(existingItem => {
                    const updatedItem = validUpdatesAccum.find(item => item.playlistItem_id === existingItem.playlistItem_id);
                    return updatedItem ? { ...existingItem, ...updatedItem, converting: false } : existingItem;
                });

                const newItems = validUpdatesAccum.filter(item => !currentPlaylist.some(existing => existing.playlistItem_id === item.playlistItem_id));
                const finalPlaylist = [...updatedPlaylist, ...newItems];

                await stateControl.setPlaylistState(finalPlaylist);
                await updatePlaylistUI();
            }
            // 全処理完了後、進捗表示をクリア
            const progressElem = document.getElementById('loading-progress');
            if (progressElem) progressElem.textContent = "";
        } catch (error) {
            logInfo('[playlist.js] Error adding files:', error);
        }
    });

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

    // 変換中のファイルを追跡
    const convertingFiles = new Set();

    // 5秒ごとのファイル存在確認処理
    setInterval(async () => {
        try {
            const currentPlaylist = await stateControl.getPlaylistState();
            let updated = false;

            for (let i = 0; i < currentPlaylist.length; i++) {
                const item = currentPlaylist[i];

                // (1) MOV→WEBM変換中のアイテムはスキップ
                if (item.converting) {
                    continue;
                }

                // (2) UVCデバイスはファイル存在チェックをスキップ（別途 uvc.js 等でオフライン判定）
                if (typeof item.path === 'string' && item.path.startsWith("UVC_DEVICE")) {
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
// データを取得する関数
// -----------------------
async function getValidUpdates(files, currentPlaylist) {
    let updatedFiles = [];

    for (const file of files) {
        const lowerPath = file.path.toLowerCase();

        // PNG → MP4 または WebM 変換（透過判定付き）の処理
        if (lowerPath.endsWith('.png')) {
            logInfo(`[playlist.js] Converting PNG: ${file.path}`);
            try {
                const convertedPath = await convertPNGToVideo(file.path);
                if (!convertedPath) {
                    logInfo(`[playlist.js] PNG conversion returned no output: ${file.path}`);
                    continue;
                }
                file.path = convertedPath;
                file.name = window.electronAPI.path.basename(convertedPath);
                const processedFile = await processFileData(file, currentPlaylist);
                if (processedFile) updatedFiles.push(processedFile);
            } catch (error) {
                logInfo(`[playlist.js] Error converting PNG (${file.path}): ${error.message || JSON.stringify(error)}`);
                continue;
            }
            continue;
        }

        // PPTX → PNG連番 & MP4変換処理（変換中はLoadingエントリを追加）
        if (lowerPath.endsWith('.pptx')) {
            logInfo(`[playlist.js] Converting PPTX: ${file.path}`);
            try {
                // 変換中の仮エントリを追加（"mp4" タイプ指定）
                const tempPlaylistItem = await addLoadingEntry(file.path, "mp4");
                // 非同期でPPTX → MP4変換を開始（fire-and-forget）
                convertPptxToMp4(file.path, tempPlaylistItem);
            } catch (error) {
                logInfo(`[playlist.js] Error adding loading entry for PPTX (${file.path}): ${error.message || JSON.stringify(error)}`);
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

                // 2) 非同期でMOV → WebM変換を開始
                convertMovToWebm(file.path, tempPlaylistItem);

                continue; // 仮のエントリのみ追加し、即時登録はしない
            }
        }
        const processedFile = await processFileData(file, currentPlaylist);
        if (processedFile) updatedFiles.push(processedFile);
    }
    return updatedFiles;
}

// -----------------------
// サムネイル生成
// -----------------------

// サムネイル生成関数
async function generateThumbnail(filePath) {
    return new Promise((resolve) => {
        // もしファイルパスが UVC デバイス用でなく、かつ file:// で始まっていなければ、安全なファイルURLに変換する
        if (!filePath.startsWith("UVC_DEVICE:") && !/^file:\/\//.test(filePath)) {
            filePath = getSafeFileURL(filePath);
        }

        // UVCデバイスのサムネイル生成
        if (filePath.startsWith("UVC_DEVICE:")) {
            const deviceId = filePath.replace("UVC_DEVICE:", ""); // `deviceId` を取得
            console.log("サムネイル生成 - deviceId:", deviceId);

            // `deviceId` を使ってカメラを起動（各インスタンスで個別に処理）
            navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId } }).then((stream) => {
                const video = document.createElement('video');
                video.srcObject = stream;
                video.autoplay = true;
                video.muted = true;
                video.playsInline = true;
                video.onloadedmetadata = () => {
                    console.log("カメラのメタデータ取得 - Width:", video.videoWidth, "Height:", video.videoHeight);
                    video.play();
                };

                // サムネイルのターゲットサイズ（16:9, 135px 横幅）
                const targetWidth = 135;
                const targetHeight = Math.round(targetWidth * 9 / 16);

                // 黒背景のコンテナを作成
                const container = document.createElement('div');
                container.style.width = targetWidth + 'px';
                container.style.height = targetHeight + 'px';
                container.style.backgroundColor = 'black';
                container.style.overflow = 'hidden';

                // video 要素のスタイル設定（解像度に合わせてフィット）
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'contain';

                // コンテナに video 要素を追加
                container.appendChild(video);

                // ライブプレビューとして video を返す（ストリームは停止しない）
                resolve(container);
            }).catch((error) => {
                console.error("カメラの取得に失敗:", error);
                // エラーの場合は従来のエラーハンドリング（赤背景にメッセージ）を実施
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

        // 拡張子を小文字で取得
        const extension = filePath.split('.').pop().toLowerCase();

        // === 1) 音声ファイル（wav, mp3, flac）の場合 ===
        if (['wav', 'mp3', 'flac'].includes(extension)) {
            const safeFileURL = filePath;  // 既に先頭で変換済みなのでそのまま利用
            fetch(safeFileURL)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => {
                    const audioContext = new AudioContext();
                    return audioContext.decodeAudioData(arrayBuffer);
                })
                .then(audioBuffer => {
                    // キャンバスを作って黒背景に白波形を描画
                    const canvas = document.createElement('canvas');
                    canvas.width = 112; // サムネイル幅
                    canvas.height = 63; // サムネイル高さ
                    const ctx = canvas.getContext('2d');

                    // 背景を黒で塗りつぶし
                    ctx.fillStyle = 'black';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // 波形を描画
                    ctx.strokeStyle = 'green';
                    ctx.lineWidth = 1;
                    const rawData = audioBuffer.getChannelData(0);
                    const sampleStep = Math.floor(rawData.length / canvas.width);
                    ctx.beginPath();
                    for (let i = 0; i < canvas.width; i++) {
                        const sampleIndex = i * sampleStep;
                        const amplitude = rawData[sampleIndex] * (canvas.height / 2);
                        ctx.lineTo(i, (canvas.height / 2) - amplitude);
                    }
                    ctx.stroke();

                    // 拡張子テキストを下部に重ねる
                    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(extension.toUpperCase(), canvas.width / 2, canvas.height - 2);
                    resolve(canvas.toDataURL('image/png'));
                })
                .catch(() => {
                    // フォールバック処理
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
                    ctx.fillText(extension.toUpperCase(), canvas.width / 2, canvas.height / 2);
                    resolve(canvas.toDataURL('image/png'));
                });
            return;
        }

        // 動画ファイルの場合
        const video = document.createElement('video');
        video.src = filePath;  // すでに安全なURLに変換済み
        video.onloadedmetadata = () => {
            video.currentTime = 3; // サムネイル用のフレーム指定
        };

        video.onseeked = () => {
            const originalWidth = video.videoWidth;
            const originalHeight = video.videoHeight;
            const targetWidth = 120;
            const targetHeight = Math.round((targetWidth * 9) / 16);
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
        };

        video.onerror = () => {
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
            resolve(canvas.toDataURL('image/png'));
        };
    });
}

// -----------------------
// プレイリストアイテム生成
// -----------------------
async function processFileData(file, currentPlaylist) {
    try {
        if (file.path === "UVC_DEVICE") {
            // `UVC_DEVICE` 用の特別な処理
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

            // stateControl に新しいアイテムを追加して順序を管理
            await window.electronAPI.stateControl.addFileToState(uvcItem);

            // デバッグログに追加されたアイテムの情報を出力
            // logDebug(`Added UVC item: ID: ${uvcItem.playlistItem_id}, Name: ${uvcItem.name}, Order: ${uvcItem.order}`);

            return uvcItem;
        }

        // 通常のファイル処理
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
        newItem.isAudioFile = ['wav', 'mp3', 'flac'].includes(extension);
        newItem.type = extension.toUpperCase();

        // stateControl に新しいアイテムを追加して順序を管理
        await window.electronAPI.stateControl.addFileToState(newItem);

        // デバッグログに追加されたアイテムの情報を出力
        // logDebug(`Added item: ID: ${newItem.playlistItem_id}, Name: ${newItem.name}, Order: ${newItem.order}`);

        return newItem;
    } catch (error) {
        logInfo(`[playlist.js] Error processing file: ${file.name}, Error: ${error.message}`);
        return null;
    }
}

// 特殊文字をエスケープする関数
function escapeSpecialCharacters(input) {
    // 特殊文字が含まれる場合のみエスケープ
    return input.replace(/[#&%]/g, (char) => encodeURIComponent(char));
}

// ローカルファイルパスを安全なファイルURLに変換する関数（修正後）
// encodeURI() は「#」をエスケープしないため、手動で「#」を%23に変換します
function getSafeFileURL(filePath) {
    // Windowsの場合、バックスラッシュをスラッシュに変換
    let normalizedPath = filePath.replace(/\\/g, '/');
    // 既に file:// で始まっていない場合は付加
    if (!/^file:\/\//.test(normalizedPath)) {
        normalizedPath = 'file:///' + normalizedPath;
    }
    // encodeURIで一度エンコードした後、'#' を手動でエスケープ
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
            const deviceId = filePath.split(":")[1]; // "UVC_DEVICE:<deviceId>" の形式から deviceId を取得
            const resolution = await getUVCResolution(deviceId); // 解像度を取得
            return {
                resolution: resolution || "Unknown",
                duration: "UVC",
                creationDate: "N/A"
            };
        }

        // logDebug(`Retrieving metadata for file: ${filePath}`);
        const metadata = await window.electronAPI.getMetadata(filePath);

        if (!metadata.resolution || !metadata.duration || !metadata.creationDate) {
        }

        const extension = filePath.split('.').pop().toLowerCase();
        const isAudioFile = ['mp3', 'wav' ,'flac'].includes(extension);

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
            video: { deviceId: { exact: deviceId } }
        });
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getSettings(); // 解像度を取得
        track.stop(); // ストリームを閉じる

        if (capabilities.width && capabilities.height) {
            return `${capabilities.width}x${capabilities.height}`;
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

    // data-playlist-item-id 属性を追加
    item.setAttribute('data-playlist-item-id', file.playlistItem_id);
    // data-file-path 属性を追加（後のフィルタ用）
    item.setAttribute('data-file-path', file.path);

    // アイテムクリック時の処理
    item.addEventListener('click', () => handlePlaylistItemClick(item, index));

    // ダブルクリック時：モードに応じた処理を実行
    item.addEventListener('dblclick', () => {
        if (soundPadActive) {
            handleSoundPadOnAir(item, index);
        } else if (directOnAirActive) {
            handleDirectOnAir(item, index);
        }
    });

    // 操作ボタンの生成
    const moveButtons = createMoveButtons(item);

    // サムネイルの生成
    const thumbnailContainer = createThumbnail(file);

    // ファイル情報の生成
    const fileInfo = createFileInfo(file);

    // ステータスエリアの生成
    const statusContainer = createStatusContainer(file);

    // アイテムにボタン、サムネイル、ファイル情報、ステータスを追加
    item.appendChild(moveButtons);
    item.appendChild(thumbnailContainer);
    item.appendChild(fileInfo);
    item.appendChild(statusContainer);

    // 状態をUIに反映
    updateItemStateClass(item, file);

    return item;
}

// 操作ボタンを生成
function createMoveButtons(item) {
    const moveButtons = document.createElement('div');
    moveButtons.classList.add('move-buttons');

    const moveUpButton = createButton('▲', 'move-up', () => movePlaylistItem(item, -1));
    const moveDownButton = createButton('▼', 'move-down', () => movePlaylistItem(item, 1));
    // deleteButtonの生成
    const deleteButton = createButton('DEL', 'delete-button', () => {
        logOpe(`[playlist.js] Delete button clicked for item with ID: ${item.playlistItem_id}`);
        deletePlaylistItem(item.playlistItem_id);
    });
    moveButtons.appendChild(moveUpButton);
    moveButtons.appendChild(moveDownButton);
    moveButtons.appendChild(deleteButton);

    return moveButtons;
}

// ボタンを生成するヘルパー関数
function createButton(text, className, onClick) {
    const button = document.createElement('button');
    button.classList.add(className);
    button.textContent = text;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        logOpe(`[playlist.js] Button clicked: ${text}`);  // クリック時の確認
        onClick();
    });
    return button;
}

// サムネイルを生成
function createThumbnail(file) {
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.classList.add('thumbnail-container');

    // サムネイルが DOM 要素の場合はそのまま追加、文字列の場合は img タグを生成
    if (file.thumbnail instanceof HTMLElement) {
        thumbnailContainer.appendChild(file.thumbnail);
    } else {
        const thumbnailImg = document.createElement('img');
        // file.thumbnail が存在しない場合はデフォルトのサムネイル画像を設定
        thumbnailImg.src = file.thumbnail || 'path/to/default-thumbnail.png';
        thumbnailImg.alt = `Thumbnail for ${file.name}`;
        thumbnailImg.classList.add('thumbnail-image');
        thumbnailContainer.appendChild(thumbnailImg);
    }

    return thumbnailContainer;
}


// ファイル情報を生成
function createFileInfo(file) {
    const fileInfo = document.createElement('div');
    fileInfo.classList.add('file-info');

    const inPoint = file.inPoint || "00:00:00:00";
    const outPoint = file.outPoint || "00:00:00:00";

    // ファイルが存在しない場合、file.mediaOffline が true として設定されている前提
    const fileName = file.mediaOffline ? 'Media Offline' : file.name;
    const fileNameClass = file.mediaOffline ? 'file-name media-offline' : 'file-name';

    fileInfo.innerHTML = `
        <p class="${fileNameClass}">${fileName}</p>
        <div class="file-details-grid">
            <div class="file-details-grid">
                <div class="file-details-row">
                    <span class="label">Res</span><span class="value">${file.resolution}</span>
                    <span class="label">IN</span><span class="value">${inPoint}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">Dur</span><span class="value">${file.duration}</span>
                    <span class="label">OUT</span><span class="value">${outPoint}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">TYPE</span><span class="value">${file.type || file.path.split('.').pop().toUpperCase()}</span>
                </div>
                <div class="file-details-row">
                    <span class="label">VOL</span><span class="value">${file.defaultVolume !== undefined ? file.defaultVolume : 100}%</span>
                </div>
            </div>
        </div>
    `;

    return fileInfo;
}

// ステータスエリアを生成
function createStatusContainer(file) {
    const statusContainer = document.createElement('div');
    statusContainer.classList.add('status-container');

    // startModeはfile.startModeをそのまま表示
    // endModeはfile.endMode || 'OFF'で初期化済みなのでそのままでOK
    const statusList = [
        { label: 'START', value: file.startMode },
        { label: 'END', value: file.endMode || 'OFF' },
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

// アイテムの状態を反映
function updateItemStateClass(item, file) {
    // すべての状態をリセット
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
}

// -----------------------
// プレイリストUI更新処理
// -----------------------

// プレイリストIDを設定する関数
function setCurrentPlaylistId(playlistId) {
    currentPlaylistId = playlistId;
}
let currentPlaylistId = null;  // 現在のプレイリストIDを追跡

// プレイリストUI更新処理
async function updatePlaylistUI() {
    const playlistItemsContainer = document.querySelector('.playlist-items');
    const playlist = await stateControl.getPlaylistState(); // プレイリスト状態を取得

    if (!Array.isArray(playlist)) {
        logInfo('[playlist.js] Playlist is not an array:', playlist);
        return;
    }

    // 並び順を `order` フィールドに基づいてソート
    const sortedPlaylist = playlist.sort((a, b) => a.order - b.order);

    // プレイリストアイテムをすべて削除
    playlistItemsContainer.innerHTML = '';

    const renderedItems = []; // 描画されたアイテムを記録


    // 各プレイリストアイテムを描画
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

        // コンテナに追加
        playlistItemsContainer.appendChild(item);

        // 描画されたアイテムを記録
        renderedItems.push({
            path: file.path,
            selected: item.classList.contains('selected'),
            editing: item.classList.contains('editing'),
            onair: item.classList.contains('onair'),
        });
    });
}

// -------------------------------------------------------
// プレイリストアイテムを選択しエディットに動画を送る
// -------------------------------------------------------
async function handlePlaylistItemClick(item, index) {
    const targetPlaylistItemId = item.playlistItem_id; // プロパティからIDを取得
    logOpe(`[playlist.js] Handling click for ID: ${targetPlaylistItemId}`);

    // IDが取得できない場合は処理を終了
    if (!targetPlaylistItemId) {
        logInfo("[playlist.js] Failed to retrieve playlistItem_id from DOM. Item:", item);
        return;
    }

    // 選択時のファイル存在確認（UVC_DEVICEは除外）
    const currentPlaylist = await stateControl.getPlaylistState();
    const selectedItemCheck = currentPlaylist.find(file => file.playlistItem_id === targetPlaylistItemId);
    // 変換中の場合は選択を解除し、変換中である旨のメッセージを表示する
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
        // プレイリストの状態を取得
        const playlist = await stateControl.getPlaylistState();
        if (!Array.isArray(playlist)) {
            logInfo('[playlist.js] Playlist state is not an array:', playlist);
            return;
        }

        // 現在の選択インデックスを更新
        const playlistItems = Array.from(document.querySelectorAll('.playlist-item'));
        currentSelectedIndex = playlistItems.findIndex(el => el.dataset.playlistItemId === targetPlaylistItemId);

        // プレイリストの選択状態と編集状態を更新
        const updatedPlaylist = playlist.map(file => ({
            ...file,
            selectionState: file.playlistItem_id === targetPlaylistItemId ? "selected" : "unselected",
            editingState: file.playlistItem_id === targetPlaylistItemId ? "editing" : null
        }));

        // プレイリストを正規化して保存
        await stateControl.setPlaylistState(
            updatedPlaylist.map(item => ({
                ...item,
                order: Number(item.order), // 数値形式に変換して保存
            }))
        );

        // プレイリストUIを更新
        await updatePlaylistUI();

        // 選択されたアイテムを取得
        const selectedItem = updatedPlaylist.find(item => item.selectionState === "selected");
        if (!selectedItem) {
            logInfo('[playlist.js] No selected item to send to edit area.');
            return;
        }

        // UVCデバイスの場合はエディットエリアに送らない
        if (selectedItem && (selectedItem.endMode === "UVC" || (typeof selectedItem.path === 'string' && selectedItem.path.startsWith("UVC_DEVICE")))) {
            logInfo(`[playlist.js] UVC device "${selectedItem.name}" selected. Skipping edit area update.`);
            showMessage(getMessage('uvc-devices-cannot-be-edited'), 5000, 'info'); // 5秒間表示
            // 自動選択処理（simulateRightArrowKey）の呼び出しとログ出力を削除
            return;
        }

        // エディットエリアに選択されたアイテムを送信
        window.electronAPI.updateEditState(selectedItem);
        logOpe(`Playlist item sent to edit area with ID: ${selectedItem.playlistItem_id}`);
    } catch (error) {
        logInfo('[playlist.js] Error handling playlist item click:', error);
    }
}

// 選択状態を更新
function setSelectionState(index) {
    const playlist = stateControl.getPlaylistState(); // プレイリストの状態を取得
    const updatedPlaylist = playlist.map((item, idx) => {
        // `onAirState` が "onair" のアイテムは選択対象から除外
        if (item.onAirState === "onair") {
            return { ...item, selectionState: "unselected" };
        }
        // 選択状態を更新
        return { 
            ...item, 
            selectionState: idx === index ? "selected" : "unselected" 
        };
    });

    stateControl.setPlaylistState(updatedPlaylist);

    // UIを更新
    updatePlaylistUI();
    logInfo(`[playlist.js] Playlist selection changed to index: ${index}`);
}


// アイテムの編集状態を更新
function setEditingState(itemId) {
    const playlist = stateControl.getPlaylistState(); // プレイリストの状態を取得
    const updatedPlaylist = playlist.map(item => {
        // `onAirState` が "onair" のアイテムは編集対象から除外
        if (item.onAirState === "onair") {
            return { ...item, editingState: null };
        }

        // 編集状態を更新
        return { 
            ...item, 
            editingState: item.playlistItem_id === itemId ? "editing" : null 
        };
    });

    stateControl.setPlaylistState(updatedPlaylist);

    // UIを更新
    updatePlaylistUI();
    logInfo(`[playlist.js] Playlist item sent to edit area with ID: ${itemId}`);
}

// -------------------------------------
// プレイリストアイテムの削除(DELボタン)
// -------------------------------------
async function deletePlaylistItem(itemId) {
    const success = await window.electronAPI.stateControl.deleteItemFromPlaylist(itemId);
    if (success) {
        await updatePlaylistUI(); // UIを更新
    } else {
        logInfo('[playlist.js] Failed to delete playlist item. Not found.');
    }
    // 右矢印キーを自動押下
    simulateRightArrowKey();
    logOpe("[playlist.js] edit claer.");
}

// ------------------------------------------------
// アイテムを上下に移動して入れ替える(▲▼ボタン）
// ------------------------------------------------
async function movePlaylistItem(item, direction) {
    const playlist = await window.electronAPI.stateControl.getPlaylistState();

    // 現在のインデックスを取得
    const currentIndex = playlist.findIndex(p => p.playlistItem_id === item.playlistItem_id);
    if (currentIndex === -1) {
        logInfo('[playlist.js] Item not found in playlist.');
        return false;
    }

    // 新しいインデックスを計算
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= playlist.length) {
        logInfo('[playlist.js] Move out of range.');
        return false;
    }

    // 順序を入れ替える
    const [movingItem] = playlist.splice(currentIndex, 1);
    playlist.splice(newIndex, 0, movingItem);

    // 新しい順序を再計算して割り当て
    playlist.forEach((item, index) => {
        item.order = index;
    });

    // 更新
    await window.electronAPI.stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    return true;
}

// ----------------------------
// 選択アイテムをオンエアに送る
// ----------------------------

// オンエアアイテムの記録
let lastOnAirItemId = null;

// オンエアボタンのイベントリスナー
function initializeOnAirButtonListener() {
    const onAirButton = document.getElementById('cue-button');
    if (!onAirButton) {
        logInfo('[playlist.js] On-Air button not found.');
        return;
    }

    onAirButton.addEventListener('click', async () => {
        try {
            const playlist = await stateControl.getPlaylistState();
            const editingItem = playlist.find(item => item.editingState === 'editing'); // 現在編集中のアイテム

            if (!editingItem) {
                // 動作しない理由を表示
                showMessage(getMessage('no-item-in-editing-state'), 5000, 'alert');
                return;
            }

            // 最後のオンエアアイテムとして記憶
            lastOnAirItemId = editingItem.playlistItem_id;

            // ボタンを赤色に変更
            onAirButton.classList.add('important-button-red');

            // プレイリストのオンエア状態をstateControlに通知
            await stateControl.setOnAirState(editingItem.playlistItem_id); // 正しく playlistItem_id を渡す

            // プレイリストを正規化して保存（orderの数値形式を保持）
            await stateControl.setPlaylistState(
                playlist.map(item => ({
                    ...item,
                    order: Number(item.order), // 数値形式に変換して保存
                }))
            );

            await updatePlaylistUI(); // UIを更新

            showMessage(`${getMessage('on-air-started')} ${editingItem.name}`, 5000, 'success');
            logInfo(`[playlist.js] On-Air Item ID sent to main process: ${editingItem.playlistItem_id}`);

            // メインプロセスへ通知
            window.electronAPI.sendOnAirItemIdToMain(editingItem.playlistItem_id);

            // ON AIRメッセージ表示後もボタンの色を維持
            showMessage(getMessage('on-air'), 10000, 'alert'); // 10秒間表示
            
        } catch (error) {
            logInfo('[playlist.js] Error during On-Air process:', error);
            showMessage(getMessage('on-air-error-occurred'), 5000, 'alert');
        }
    });

    // Enterキーによる誤動作を防ぐため、keydownイベントでEnterキーのデフォルト動作を無効化
    onAirButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    });
}


// 編集中のアイテムIDを取得
function getEditingItemId() {
    const playlist = stateControl.getPlaylistState(); // プレイリストの状態を取得
    const editingItem = playlist.find(item => item.editingState === 'editing');
    return editingItem ? editingItem.playlistItem_id : null;
}

// アイテムIDを通知
function notifyOnAirItemId(itemId) {
    // メインプロセスに通知
    window.electronAPI.sendOnAirItemIdToMain(itemId);
    logInfo(`[playlist.js] On-Air Item ID sent to main process: ${itemId}`);
}

// アイテムのオンエア状態を更新
function setOnAirState(itemId) {
    const playlist = stateControl.getPlaylistState(); // プレイリストの状態を取得
    const updatedPlaylist = playlist.map(item => {
        // 選択されたアイテムは "onair" に、それ以外は null に設定
        return {
            ...item,
            onAirState: item.playlistItem_id === itemId ? "onair" : null,
        };
    });
    stateControl.setPlaylistState(updatedPlaylist); // 更新したプレイリストを保存

    // プレイリストUIを更新
    updatePlaylistUI(); 

    logInfo(`[playlist.js] On-Air state updated for Item ID: ${itemId}`);
}

// -----------------------
// オフエア通知の受信
// -----------------------
window.electronAPI.onReceiveOffAirNotify(async () => {
    logInfo('[playlist.js] Received Off-Air notification.'); // ログに表示

    // オンエアボタンを消灯
    const onAirButton = document.getElementById('cue-button');
    if (onAirButton) {
        onAirButton.classList.remove('important-button-red'); // 赤色（オンエア状態）を解除
        logInfo('[playlist.js] On-Air button has been turned off.');
    } else {
        logInfo('[playlist.js] On-Air button not found.');
    }

    // プレイリストアイテムのオンエア状態を解除
    try {
        await stateControl.resetOnAirState(); // 既存のリセット関数を呼び出し
        logInfo('[playlist.js] All playlist items have been set to Off-Air state.');

        // プレイリストUIを更新
        await updatePlaylistUI(); // ここでUIを更新
        logInfo('[playlist.js] Playlist UI updated successfully after Off-Air.');
    } catch (error) {
        logInfo('[playlist.js] Failed to reset playlist items Off-Air state:', error);
    }
    
    // 追加：最後にオンエアだったアイテムがあれば次のアイテムを自動選択（オンエアは行わない）
    if (lastOnAirItemId) {
        logInfo(`[playlist.js] Auto-selecting next item (without On-Air) after Off-Air for last On-Air item ID: ${lastOnAirItemId}`);
        await selectNextPlaylistItem(lastOnAirItemId);
        lastOnAirItemId = null;
    }
});

// -----------------------
// オフエア後に次のアイテムを選択する（オンエアはしない）
// -----------------------
async function selectNextPlaylistItem(currentItemId) {
    const playlist = await stateControl.getPlaylistState(); // プレイリスト状態を取得

    if (!Array.isArray(playlist) || playlist.length === 0) {
        logDebug('[playlist.js] Playlist is empty or invalid.');
        // プレイリストが空の場合、Off-Air通知を送信する
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Off-Air通知を送信しました。（プレイリスト空）');
        return;
    }

    // プレイリストを order プロパティでソート
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

    // メディアオフラインなら次の利用可能なアイテムを探す
    const availableIndex = findNextAvailableIndex(sortedPlaylist, nextIndex);
    if (availableIndex === -1) {
        logInfo('[playlist.js] No available next item (all items are media offline).');
        // さらに利用可能な次アイテムがない場合、Off-Air通知を送信する
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Off-Air通知を送信しました。（全アイテムがオフライン）');
        return;
    }

    nextIndex = availableIndex;
    const nextItem = sortedPlaylist[nextIndex];

    logInfo(`[playlist.js] Next item selected (without On-Air): ID: ${nextItem.playlistItem_id}, Name: ${nextItem.name}`);

    // プレイリストの状態を更新：選択・編集状態のみ更新（オンエア状態は変更しない）
    const updatedPlaylist = playlist.map(item => ({
        ...item,
        selectionState: item.playlistItem_id === nextItem.playlistItem_id ? 'selected' : 'unselected',
        editingState: item.playlistItem_id === nextItem.playlistItem_id ? 'editing' : null,
    }));

    await stateControl.setPlaylistState(updatedPlaylist);
    await updatePlaylistUI();

    // エディットエリアへ選択アイテムを送信
    window.electronAPI.updateEditState(nextItem);
    logInfo(`[playlist.js] Next item sent to edit area: ${nextItem.name}`);

    // 次のアイテムにスクロールして表示
    scrollToPlaylistItem(nextItem.playlistItem_id);
}

// --------------------------------
// プレイリストの保存
// --------------------------------

// 初期化用関数
function initializePlaylistUI() {
    // 保存済みプレイリストを初期化
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        // data-store-number 属性を設定
        button.dataset.storeNumber = i;
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
    
        if (storedPlaylist) {
            const parsedData = JSON.parse(storedPlaylist);
            button.textContent = parsedData.name || `Playlist ${i}`;
            button.classList.add('playlist-saved');
        } else {
            button.textContent = `${i}`;
            button.classList.remove('playlist-saved');
        }
    }
    // ボタンの色を初期化
    updateButtonColors();
}

// SAVEボタンのリスナー
document.getElementById('playlise-save-button').addEventListener('click', () => {
    const saveButton = document.getElementById('playlise-save-button');

    // プレイリストアイテムがなにもない場合、処理を終了
    if (document.querySelectorAll('.playlist-item').length === 0) {
        logInfo('[playlist.js] No playlist items to save. Exiting save mode.');
        return;
    }

    // 既にSAVEモードの場合、解除して終了
    if (saveButton.classList.contains('button-blink-orange')) {
        exitSaveMode();
        return;
    }

    // SAVEモードを開始
    saveButton.classList.add('button-blink-orange'); // SAVEボタンをオレンジに点滅

    // 空いている番号ボタンを水色に変更
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (!localStorage.getItem(`vtrpon_playlist_store_${i}`)) {
            button.classList.add('button-lightblue'); // 水色に設定
            button.addEventListener('click', enterSaveMode); // SAVEモード処理を登録
        }
    }
    logOpe('[playlist.js] playlise-save-button clicked.');
});

// SAVEモードの処理
function enterSaveMode(event) {
    // イベントオブジェクトから currentTarget を優先、なければ target から辿る
    let button = event.currentTarget;
    if (!button || !button.dataset || !button.dataset.storeNumber) {
        // 親要素を辿って data-store-number 属性を探す
        button = event.target;
        while (button && (!button.dataset || !button.dataset.storeNumber)) {
            button = button.parentElement;
        }
    }
    if (!button || !button.dataset || !button.dataset.storeNumber) {
        logInfo('[playlist.js] enterSaveMode triggered without proper event context.');
        return;
    }
    const storeNumber = button.dataset.storeNumber;
    // 後続のコールバックでも確実に参照できるよう、ローカル変数 _storeNumber に格納
    const _storeNumber = storeNumber;
    const modal = document.getElementById('playlist-name-modal');
    const nameInput = document.getElementById('playlist-name-input');
    // 既存のプレイリスト名を取得
    const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${_storeNumber}`);
    const defaultName = storedPlaylist ? JSON.parse(storedPlaylist).name : `Playlist ${_storeNumber}`;
    // モーダルを表示
    showModal();
    // 入力欄のデフォルト値を設定
    nameInput.value = defaultName;
    // フォーカスを設定する
    setTimeout(() => {
        if (nameInput) {
            nameInput.focus();
            const length = nameInput.value.length;
            nameInput.setSelectionRange(length, length);
        }
    }, 100);
    // 保存ボタン処理の登録
    const saveButton = document.getElementById('playlist-name-save');
    saveButton.onclick = () => {
        savePlaylist(_storeNumber);
        exitSaveMode();
    };
    const cancelButton = document.getElementById('playlist-name-cancel');
    cancelButton.onclick = () => {
        exitSaveMode();
        hideModal();
    };
    nameInput.addEventListener('keydown', function onKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            savePlaylist(_storeNumber);
            exitSaveMode();
            nameInput.removeEventListener('keydown', onKeyDown);
        }
    });
}


// SAVEモードを終了
function exitSaveMode() {
    const saveButton = document.getElementById('playlise-save-button');
    saveButton.classList.remove('button-blink-orange'); // SAVEボタンの点滅解除
    // 空いている番号ボタンの水色解除
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        button.classList.remove('button-lightblue'); // 水色を削除
        button.removeEventListener('click', enterSaveMode); // SAVEモード処理を解除
    }
}

// プレイリストIDとアイテムIDを生成
function generateUniqueId(prefix = '') {
    return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// プレイリスト保存
async function savePlaylist(storeNumber) {
    const nameInput = document.getElementById('playlist-name-input');
    const playlistName = nameInput.value.trim();

    if (!playlistName) {
        showMessage(getMessage('enter-playlist-name'), 5000, 'alert'); // 5秒間表示
        return;
    }

    const playlist_id = generateUniqueId('playlist_'); // プレイリストIDを生成

    try {
        // 最新のプレイリスト状態を取得
        const playlist = await stateControl.getPlaylistState(); // 非同期で最新状態を取得

        if (!playlist || !Array.isArray(playlist)) {
            logInfo("[playlist.js] Invalid playlist state:", playlist);
            showMessage(getMessage('failed-to-retrieve-playlist-state'), 5000, 'alert'); // 5秒間表示
            return;
        }

        // プレイリストデータの構築（DIRECTモードとFILLKEYモードの状態を追加）
        const playlistData = {
            playlist_id, // プレイリストIDを設定
            name: playlistName,
            soundPadMode: soundPadActive,        // 追加：現在の SOUND PAD モード状態
            directOnAirMode: directOnAirActive,    // 追加：現在の DIRECT ONAIR モード状態
            fillKeyMode: isFillKeyMode,            // 既存の FILLKEY モード状態
            data: playlist.map((item) => ({
                ...item,
                order: item.order, // 元の順序をそのまま保持
                playlistItem_id: item.playlistItem_id || `${playlist_id}-${item.order}`, // アイテムIDを生成
                selectionState: "unselected", // 保存時に選択状態をリセット
                editingState: null, // 保存時に編集状態をリセット
                onAirState: null, // 保存時はすべてオフエアに設定
            })),
        };

        // ソート順をログに表示
        const orderLog = playlistData.data.map(item => item.order);

        // 保存処理
        localStorage.setItem(`vtrpon_playlist_store_${storeNumber}`, JSON.stringify(playlistData));

        // プレイリスト情報を保存
        await stateControl.setPlaylistStateWithId(playlist_id, playlistData);

        hideModal(); // モーダル非表示
        setActiveStoreButton(storeNumber); // ボタンのアクティブ状態を更新
    } catch (error) {
        logInfo('[playlist.js] Error saving playlist:', error);
        showMessage(getMessage('failed-to-save-playlist'), 5000, 'alert'); // 5秒間表示
    }

    // デバッグ用：保存後の状態をログに出力
    // const savedState = await stateControl.getPlaylistState();
    // logDebug('Playlist state after save:', savedState);
}

// --------------------------------
// プレイリストの呼び出し
// --------------------------------

// プレイリスト番号ボタンをクリックしたときの処理
for (let i = 1; i <= 5; i++) {
    const button = document.getElementById(`playlise${i}-button`);
    button.addEventListener('click', async (event) => {

        // SAVEモード中の判定
        if (document.getElementById('playlise-save-button').classList.contains('button-blink-orange')) {
            // SAVEモードの処理を実際のイベントオブジェクトを渡して実行
            enterSaveMode(event);
            return;
        }

        // 通常モードの処理
        if (button.classList.contains('button-gray')) {
            return;
        }
        logOpe(`[playlist.js] Button ${i} clicked`);

        // プレイリストIDを取得して読み込む
        await loadPlaylist(i);
        // プレイリスト名の表示を更新
        const playlistNameDisplay = document.getElementById('playlist-name-display');
        // 修正：storeNumberではなく、ループ変数iを使用する
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
        if (storedPlaylist) {
            const playlistData = JSON.parse(storedPlaylist);
            playlistNameDisplay.textContent = playlistData.name || `Playlist ${i}`;
        } else {
            playlistNameDisplay.textContent = 'No Playlist Loaded';
        }
        // ボタンの状態を更新
        updateStoreButtons();
        // クリックしたボタンをオレンジに設定し、他のボタンをリセット
        setActiveButton(i);
    });
}

// プレイリストの読み込み処理
async function loadPlaylist(storeNumber) {
    const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${storeNumber}`);
    if (!storedPlaylist) {
        logInfo(`[playlist.js] No playlist found for store number ${storeNumber}.`);
        return;
    }

    try {
        const playlistData = JSON.parse(storedPlaylist);

        // プレイリストIDを設定
        setCurrentPlaylistId(playlistData.playlist_id);

        // 既存のプレイリスト状態をクリアしてから新しい状態をセットする
        await stateControl.clearState();

        // 復元時に order に基づいてソートのみ実行
        const reorderedData = playlistData.data.sort((a, b) => a.order - b.order);

        // 状態を設定
        await stateControl.setPlaylistState(reorderedData);
        await updatePlaylistUI();
        // SOUND PADモードの状態を復元
        soundPadActive = playlistData.soundPadMode || false;
        const soundPadButton = document.getElementById('soundpad-mode-button');
        if (soundPadButton) {
            if (soundPadActive) {
                soundPadButton.classList.add('button-green');
            } else {
                soundPadButton.classList.remove('button-green');
            }
        }

        // DIRECT ONAIRモードの状態を復元
        directOnAirActive = playlistData.directOnAirMode || false;
        const directOnAirButton = document.getElementById('directonair-mode-button');
        if (directOnAirButton) {
            if (directOnAirActive) {
                directOnAirButton.classList.add('button-green');
            } else {
                directOnAirButton.classList.remove('button-green');
            }
        }

        // FILLKEYモードの状態を復元
        isFillKeyMode = playlistData.fillKeyMode || false;
        const fillKeyButton = document.getElementById('fillkey-mode-button');
        if (fillKeyButton) {
            if (isFillKeyMode) {
                fillKeyButton.classList.add('button-green');
            } else {
                fillKeyButton.classList.remove('button-green');
            }
        }

        // FILLKEYモードの状態をオンエア側に通知する
        window.electronAPI.ipcRenderer.send('fillkey-mode-update', isFillKeyMode);

        } catch (error) {
            logInfo('[playlist.js] Error loading playlist:', error);
        }

        // 自動選択処理は一旦無効化（※必要に応じて後で見直す）
        // simulateRightArrowKey();
        logOpe("[playlist.js] edit claer.");
}

// プレイリストの順番を取得
function getPlaylistOrder() {
    return stateControl.getPlaylistState().map((item) => ({ ...item }));
}

// ボタンの状態更新
function updateStoreButtons() {
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);

        // 保存された場合は青、それ以外はグレー
        if (storedPlaylist) {
            button.classList.add('button-blue'); // 保存済み状態
            button.classList.remove('button-gray'); // 未保存状態を削除
        } else {
            button.classList.add('button-gray'); // 未保存状態
            button.classList.remove('button-blue'); // 保存済み状態を削除
            button.classList.remove('button-purple'); // 削除されたボタンは紫を解除
        }

        // 削除モード中は保存されたボタンを紫色に設定
        if (document.getElementById('playlisedel-button').classList.contains('button-blink-orange')) {
            if (storedPlaylist) {
                button.classList.add('button-purple'); // 紫色に設定
            }
        } else {
            button.classList.remove('button-purple'); // 削除モード終了時は紫を解除
        }

        // アクティブ状態（オレンジ）をリセット
        button.classList.remove('button-orange');
    }
}

// クリックされたボタンをアクティブ（オレンジ）にする
function setActiveButton(activeIndex) {
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (i === activeIndex) {
            button.classList.add('button-orange'); // アクティブ状態（オレンジ）を追加
        } else {
            button.classList.remove('button-orange'); // 他のボタンのアクティブ状態を解除
        }
    }
}

// アクティブボタンの設定
function setActiveStoreButton(storeNumber) {
    const activeButton = document.getElementById(`playlise${storeNumber}-button`);
    const playlistNameDisplay = document.getElementById('playlist-name-display');
    
    // ボタンのクラスを適切に設定
    updateStoreButtons();
    
    if (activeButton) {
        activeButton.classList.add('button-orange');  // アクティブ状態
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${storeNumber}`);

        if (storedPlaylist) {
            const playlistData = JSON.parse(storedPlaylist);
            playlistNameDisplay.textContent = playlistData.name || `Playlist ${storeNumber}`;
        } else {
            playlistNameDisplay.textContent = 'No Playlist Loaded';
        }
    }
}

// --------------------------------
// 保存されたプレイリストの削除
// --------------------------------

// DELボタンのリスナー
document.getElementById('playlisedel-button').addEventListener('click', () => {
    const delButton = document.getElementById('playlisedel-button');

    // 保存されたボタンがない場合、処理を終了
    let hasStoredButton = false;
    for (let i = 1; i <= 5; i++) {
        if (localStorage.getItem(`vtrpon_playlist_store_${i}`)) {
            hasStoredButton = true;
            break;
        }
    }

    if (!hasStoredButton) {
        logInfo('[playlist.js] No stored playlists to delete. Exiting delete mode.');
        return;
    }

    // 既に削除モードの場合、解除して終了
    if (delButton.classList.contains('button-blink-orange')) {
        exitDeleteMode();
        return;
    }

    // 削除モードを開始（オレンジに点滅）
    delButton.classList.add('button-blink-orange'); // DELボタンをオレンジに点滅

    // 保存されている番号ボタンを紫色に変更
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
        if (storedPlaylist) {
            button.classList.remove('button-blue'); // 青色を削除
            button.classList.remove('button-orenge'); // オレンジを削除
            button.classList.add('button-purple'); // 紫色に設定
            button.addEventListener('click', enterDeleteMode); // 削除モード処理を登録
        }
    }
    logOpe('[playlist.js] playlistdel-button clicked.');
});

// 削除モードの処理
function enterDeleteMode(event) {
    const button = event.currentTarget;
    const storeNumber = button.dataset.storeNumber; // data-store-number 属性から取得
    // 削除処理を実行
    deletePlaylist(storeNumber); // 削除処理を即実行
    exitDeleteMode(); // 削除モードを終了
}

// プレイリストを削除
function deletePlaylist(storeNumber) {
    try {
        // ローカルストレージから削除
        localStorage.removeItem(`vtrpon_playlist_store_${storeNumber}`);

        // プレイリストの状態を空にしてUIを更新
        stateControl.setPlaylistState([]);
        updatePlaylistUI();

        // ボタンの状態を更新（紫色をリセットしてグレーに戻す）
        updateStoreButtons();

        // logDebug(`Playlist ${storeNumber} deleted successfully!`);
    } catch (error) {
        logInfo('[playlist.js] Error deleting playlist:', error);
        showMessage(getMessage('failed-to-delete-playlist'), 5000, 'alert'); // 5秒間表示
    }
}

// 削除モードを終了
function exitDeleteMode() {
    const delButton = document.getElementById('playlisedel-button');
    delButton.classList.remove('button-blink-orange'); // DELボタンの点滅解除（オレンジに戻す）

    let activeButtonIndex = null;
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        const storedPlaylist = localStorage.getItem(`vtrpon_playlist_store_${i}`);
        button.classList.remove('button-purple'); // 紫を削除

        if (storedPlaylist) {
            button.classList.add('button-blue'); // 保存済み状態を復元
        } else {
            button.classList.add('button-gray'); // 未保存状態を復元
        }

        button.removeEventListener('click', enterDeleteMode); // 削除モード処理を解除

        // 現在アクティブなボタンを記録
        if (button.classList.contains('button-orange')) {
            activeButtonIndex = i;
        }
    }

    // アクティブ状態を復元
    if (activeButtonIndex !== null) {
        setActiveButton(activeButtonIndex);
    }
}

// --------------------------------
// プレイリストのクリア
// --------------------------------

// CLEARボタンのクリックイベントを登録
document.getElementById('playliseclear-button').addEventListener('click', async () => {
    try {
        // プレイリストの状態を空にする
        await stateControl.setPlaylistState([]);

        // プレイリストUIを更新
        await updatePlaylistUI();

        // モード状態をリセット：SOUND PADモードと DIRECT ONAIRモード
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

        // FILLKEYモードをリセット
        isFillKeyMode = false;
        const fillKeyButton = document.getElementById('fillkey-mode-button');
        if (fillKeyButton) {
            fillKeyButton.classList.remove('button-green');
        }

        // モード解除通知を送信
        window.electronAPI.ipcRenderer.send('clear-modes', false);

        // 現在アクティブなボタンだけを青に戻す
        const activeButton = document.querySelector('.button-orange');
        if (activeButton) {
            activeButton.classList.remove('button-orange');
            activeButton.classList.add('button-blue');
        }

        // プレイリスト名表示をリセット
        const playlistNameDisplay = document.getElementById('playlist-name-display');
        if (playlistNameDisplay) {
            playlistNameDisplay.textContent = 'PLAY LIST STORE';
        }
    } catch (error) {
        logInfo('[playlist.js] Error clearing playlist:', error);
        showMessage(getMessage('failed-to-clear-playlist'), 5000, 'alert');
    }
    logOpe('[playlist.js] playliseclear-button clicked.');

    // 右矢印キーを自動押下
    simulateRightArrowKey();
    logOpe("[playlist.js] edit claer.");
});



// UI更新
function updateButtonColors() {
    for (let i = 1; i <= 5; i++) {
        const button = document.getElementById(`playlise${i}-button`);
        if (localStorage.getItem(`vtrpon_playlist_store_${i}`)) {
            button.classList.add('playlist-saved');
        } else {
            button.classList.remove('playlist-saved');
        }
        button.classList.remove('playlist-active');
    }
}

// ----------------------------------------
// プレイリストのインポート・エクスポート
// ----------------------------------------

// プレイリストのエクスポート処理
window.electronAPI.ipcRenderer.on('export-playlist', async () => {
    try {
        const MAX_PLAYLISTS = 5; // 最大プレイリスト数
        const allPlaylists = [];

        // ローカルストレージからプレイリストを収集
        for (let i = 1; i <= MAX_PLAYLISTS; i++) {
            const storedData = localStorage.getItem(`vtrpon_playlist_store_${i}`);
            if (storedData) {
                try {
                    const parsedData = JSON.parse(storedData);

                    // データの整合性を確認
                    if (validatePlaylistData(parsedData)) {
                        allPlaylists.push({ index: i, ...parsedData });
                    } else {
                        logInfo(`[playlist.js] Playlist ${i} has invalid data and will be skipped.`);
                    }
                } catch (parseError) {
                    logInfo(`[playlist.js] Failed to parse playlist ${i}:`, parseError);
                }
            }
        }

        // エクスポートデータの構築
        const exportData = {
            playlists: allPlaylists,
        };

        // メインプロセスにデータを送信
        const result = await window.electronAPI.exportPlaylist(exportData);
        if (result.success) {
            showMessage(`${getMessage('playlist-exported-successfully')} ${result.path}`, 5000, 'info');
        } else if (result.error && result.error.includes('User canceled')) {
            logInfo('[playlist.js] Export canceled by user.');
            // キャンセル時はエラーメッセージを表示せず、単にログ出力のみ
        } else {
            logInfo('[playlist.js] Failed to export playlist:', result.error);
            showMessage(getMessage('failed-to-export-playlist'), 5000, 'alert');
        }
    } catch (error) {
        if (error.message && error.message.includes('User canceled')) {
            logInfo('[playlist.js] Export canceled by user.');
        } else {
            logInfo('[playlist.js] An error occurred during the export process:', error);
            showMessage(getMessage('failed-to-export-playlist'), 5000, 'alert');
        }
    }
});

// プレイリストデータのバリデーション関数
function validatePlaylistData(data) {
    return (
        data &&
        typeof data.name === 'string' &&
        Array.isArray(data.data) &&
        data.data.every(item => typeof item.order === 'number' && item.order >= 0)
    );
}

// プレイリストのインポート処理
window.electronAPI.ipcRenderer.on('import-playlist', async () => {
    try {
        const result = await window.electronAPI.importPlaylist();
        if (!result.success) {
            if (result.error && result.error.includes('User canceled')) {
                logInfo('[playlist.js] Import canceled by user.');
                return;
            }
            const errorDetails = result.error ? `Reason: ${result.error}` : 'Invalid playlist file format.';
            showMessage(`${getMessage('failed-to-import-playlist')}\n${errorDetails}`, 5000, 'alert'); // 5秒間表示
            return;
        }

        const { playlists, activePlaylistIndex } = result.data;
        const missingFiles = [];

        const newPlaylists = []; // インポートした新しいプレイリストデータを一時保存

        for (const playlist of playlists) {
            const { index, name, data, endMode } = playlist;

            const validData = [];
            for (const file of data) {
                const exists = await window.electronAPI.checkFileExists(file.path);
                if (exists || (typeof file.path === 'string' && file.path.startsWith('UVC_DEVICE'))) {
                    validData.push(file);
                } else {
                    logInfo(`File not found: ${file.path}`);
                    missingFiles.push(file.path || file.name || 'Unknown file');
                }
            }

            const playlistData = {
                name,
                data: validData.sort((a, b) => a.order - b.order),
                endMode,
            };

            newPlaylists.push({ index, playlistData, active: index === activePlaylistIndex });
        }

        // 成功したらUIを初期化
        document.getElementById('playliseclear-button').click();

        // 新しいプレイリストを保存してUIに反映
        for (const { index, playlistData, active } of newPlaylists) {
            localStorage.setItem(`vtrpon_playlist_store_${index}`, JSON.stringify(playlistData));

            if (active) {
                document.getElementById('playlist-name-display').textContent = playlistData.name;

                const playlistItemsContainer = document.querySelector('.playlist-items');
                playlistItemsContainer.innerHTML = ''; // 既存のリストをクリア

                for (const file of playlistData.data) {
                    logInfo(`[playlist.js] File added to playlist: ${file.name}`);
                }

                await window.electronAPI.ipcRenderer.send('setMode', playlistData.endMode);
            }
        }

        updateButtonColors();
        setActiveStoreButton(activePlaylistIndex);

        logDebug('[playlist.js] All playlists imported successfully');
        setTimeout(() => {
            showMessage(getMessage('playlists-imported-successfully'), 5000, 'info'); // 5秒間表示

            if (missingFiles.length > 0) {
                const missingList = missingFiles.join('\n');
                showMessage(`${getMessage('files-not-found')}\n${missingList}`, 20000, 'alert'); // 5秒間表示
            }
        }, 200);
    } catch (error) {
        if (error.message && error.message.includes('User canceled')) {
            logInfo('[playlist.js] Import canceled by user.');
        } else {
            const errorDetails = `Reason: ${error.message || 'Unknown error occurred.'}`;
            logInfo('Error during import playlists:', error);
            showMessage(`${getMessage('failed-to-import-playlist')}\n${errorDetails}`, 20000, 'alert');
        }
    }
});

// -----------------------
// リピートモードとリストモード
// -----------------------

// リピートとリストボタンのイベントリスナー
document.getElementById("list-repeat-button").addEventListener("click", setRepeatMode);
document.getElementById("list-list-button").addEventListener("click", setListMode);

// エンターキーによる誤動作防止
document.getElementById("list-repeat-button").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault(); // エンターキーのデフォルト動作を無効化
    }
});

document.getElementById("list-list-button").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault(); // エンターキーのデフォルト動作を無効化
    }
});

// リピートモードに設定
async function setRepeatMode() {
    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map((item, index) => {
        if (item.startMode === "PLAY" && item.endMode === "UVC") {
            return item; // 条件に一致するアイテムはそのままにする
        }
        return {
            ...item,
            startMode: "PLAY",
            endMode: "NEXT",
        };
    });
    const normalizedPlaylist = updatedPlaylist.map(item => ({
        ...item,
        order: Number(item.order), // 数値形式に変換して保存
    }));
    await stateControl.setPlaylistState(normalizedPlaylist);

    updateListModeButtons("REPEAT");
    await updatePlaylistUI();
    logOpe("[playlist.js] Playlist set to REPEAT mode.");

    // 設定完了をユーザに通知（削除しない）
    showMessage(getMessage('repeat-mode-activated'), 5000, "info");
}

// リストモードに設定
async function setListMode() {
    const playlist = await stateControl.getPlaylistState();
    const updatedPlaylist = playlist.map((item, index) => {
        if (item.startMode === "PLAY" && item.endMode === "UVC") {
            return item; // 条件に一致するアイテムはそのままにする
        }
        return {
            ...item,
            startMode: index === 0 ? "PAUSE" : "PLAY",
            endMode: index === playlist.length - 1 ? "FTB" : "NEXT",
        };
    });
    const normalizedPlaylist = updatedPlaylist.map(item => ({
        ...item,
        order: Number(item.order), // 数値形式に変換して保存
    }));
    await stateControl.setPlaylistState(normalizedPlaylist);
    updateListModeButtons("LIST");
    await updatePlaylistUI();
    logOpe("[playlist.js] Playlist set to LIST mode.");

    // 設定完了をユーザに通知（削除しない）
    showMessage(getMessage('list-mode-activated'), 5000, "info");
}

// 右矢印キーを自動押下する処理（選択状態を解除するよう修正）
function simulateRightArrowKey() {
    // キーボードイベントのシミュレーション（必要に応じて残す）
    const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        keyCode: 39,
        bubbles: true,
    });
    document.dispatchEvent(event);
    
    // プレイリスト状態を取得し、全アイテムの選択状態を解除する
    try {
        const playlist = stateControl.getPlaylistState(); // 同期関数なので.thenは使えない
        const updatedPlaylist = playlist.map(item => ({
            ...item,
            selectionState: "unselected",
            editingState: null,
        }));
        // 選択状態解除後、状態を保存しUIを更新
        stateControl.setPlaylistState(updatedPlaylist).then(() => {
            updatePlaylistUI();
            // 現在の選択インデックスもリセット
            currentSelectedIndex = -1;
            logOpe('[playlist.js] Playlist selection cleared after right arrow simulation.');
        }).catch((error) => {
            logInfo('[playlist.js] Error clearing playlist selection:', error);
        });
    } catch (error) {
        logInfo('[playlist.js] Error getting playlist state:', error);
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

    // 全ボタンをリセット
    repeatButton.classList.remove("button-green");
    repeatButton.classList.add("button-gray");
    listButton.classList.remove("button-green");
    listButton.classList.add("button-gray");
}

// -----------------------
// Sound Padモード処理
// -----------------------
async function handleSoundPadOnAir(item, index) {
    const targetId = item.playlistItem_id;
    logOpe(`[playlist.js] SOUND PAD On-Air triggered for item ID: ${targetId}`);

    // 現在のプレイリスト状態を取得し、対象アイテムの状態を更新（スタートモードを PLAY、エンドモードを OFF に設定）
    let playlist = await stateControl.getPlaylistState();
    playlist = playlist.map(file => {
        if (file.playlistItem_id === targetId) {
            return {
                ...file,
                startMode: "PLAY",
                endMode: "OFF",
                selectionState: "selected",
                editingState: "editing"
            };
        }
        return file;
    });

    // 状態を保存しUI更新
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // エディットエリアに更新したアイテムを送信
    const targetItem = playlist.find(file => file.playlistItem_id === targetId);
    if (targetItem) {
        window.electronAPI.updateEditState(targetItem);
        logOpe(`[playlist.js] SOUND PAD On-Air: Sent item to edit area with ID: ${targetId}`);
    }

    // オンエアボタンをクリックしてオンエア処理を実行
    const onAirButton = document.getElementById('cue-button');
    if (onAirButton) {
        onAirButton.click();
        logOpe(`[playlist.js] SOUND PAD On-Air: Triggered On-Air for item ID: ${targetId}`);
    } else {
        logInfo('[playlist.js] SOUND PAD On-Air: On-Air button not found.');
    }

    // ユーザーにメッセージを表示
    showMessage(`${getMessage('sound-pad-on-air-triggered')} ${targetItem ? targetItem.name : targetId}`, 5000, 'success');
}



// -----------------------
// Direct Onair モード処理
// -----------------------

async function handleDirectOnAir(item, index) {
    const targetId = item.playlistItem_id;
    logOpe(`[playlist.js] DIRECT ONAIR triggered for item ID: ${targetId}`);

    // 現在のプレイリスト状態を取得し、対象アイテムの状態を更新
    // ※ スタートモードを PLAY に設定し、エンドモードは既存の値を保持する
    let playlist = await stateControl.getPlaylistState();
    playlist = playlist.map(file => {
        if (file.playlistItem_id === targetId) {
            return {
                ...file,
                startMode: "PLAY", // スタートモードのみ強制設定
                // endMode は変更せず既存の値を保持
                selectionState: "selected",
                editingState: "editing"
            };
        }
        return file;
    });

    // 状態を保存しUI更新
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();

    // エディットエリアに更新したアイテムを送信
    const targetItem = playlist.find(file => file.playlistItem_id === targetId);
    if (targetItem) {
        window.electronAPI.updateEditState(targetItem);
        logOpe(`[playlist.js] DIRECT ONAIR: Sent item to edit area with ID: ${targetId}`);
    }

    // オンエアボタンをクリックしてオンエア処理を実行
    const onAirButton = document.getElementById('cue-button');
    if (onAirButton) {
        onAirButton.click();
        logOpe(`[playlist.js] DIRECT ONAIR: Triggered On-Air for item ID: ${targetId}`);
    } else {
        logInfo('[playlist.js] DIRECT ONAIR: On-Air button not found.');
    }

    // ユーザーにメッセージを表示
    showMessage(`${getMessage('direct-on-air-triggered')} ${targetItem ? targetItem.name : targetId}`, 5000, 'success');
}


// -----------------------
// ネクストモード処理
// -----------------------

// NEXTモード動画終了イベントのリスナーを設定
window.electronAPI.onNextModeCompleteBroadcast((currentItemId) => {
    logInfo(`[playlist.js] PLAYLIST: Received NEXT mode complete broadcast for Item ID: ${currentItemId}`);
    handleNextModePlaylist(currentItemId);
});

// 次に利用可能なアイテムのインデックスを返すヘルパー関数
function findNextAvailableIndex(sortedPlaylist, startIndex) {
    let count = sortedPlaylist.length;
    let idx = startIndex;
    while (count > 0) {
        if (!sortedPlaylist[idx].mediaOffline) {
            return idx;
        }
        idx = (idx + 1) % sortedPlaylist.length;
        count--;
    }
    return -1;  // すべてメディアオフラインの場合
}

async function handleNextModePlaylist(currentItemId) {
    const playlist = await stateControl.getPlaylistState(); // プレイリスト状態を非同期で取得

    // プレイリストの検証
    if (!Array.isArray(playlist) || playlist.length === 0) {
        logDebug('[playlist.js] Playlist is empty or invalid.');
        // 修正追加：プレイリストが空の場合、Off-Air通知を送信する
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Off-Air通知を送信しました。（プレイリスト空）');
        return;
    }
    // プレイリストを order プロパティでソート
    const sortedPlaylist = playlist.slice().sort((a, b) => a.order - b.order);
    const currentIndex = sortedPlaylist.findIndex(item => item.playlistItem_id === currentItemId);

    if (currentIndex === -1) {
        logDebug('[playlist.js] Current On-Air item not found in sorted playlist.');
        return;
    }

    let nextIndex = currentIndex + 1;
    if (nextIndex >= sortedPlaylist.length) {
        nextIndex = 0;
    }

    // メディアオフラインなら次の利用可能なアイテムを探す
    const availableIndex = findNextAvailableIndex(sortedPlaylist, nextIndex);
    if (availableIndex === -1) {
        logInfo('[playlist.js] No available next item (all items are media offline).');
        // 利用可能な次アイテムがない場合、Off-Air通知を送信する
        window.electronAPI.sendOffAirEvent();
        logOpe('[playlist.js] Off-Air通知を送信しました。（全アイテムがオフライン）');
        return;
    }

    nextIndex = availableIndex;
    const nextItem = sortedPlaylist[nextIndex];

    logInfo(`[playlist.js] NEXTモード (sorted): currentIndex=${currentIndex}, nextIndex=${nextIndex}, sortedPlaylistLength=${sortedPlaylist.length}`);
    logInfo(`[playlist.js] NEXTモード: 次に選択されるアイテム -> ID: ${nextItem.playlistItem_id}, Name: ${nextItem.name}`);

    if (nextItem) {
        // プレイリスト全体のステータスを更新
        const updatedPlaylist = playlist.map(item => {
            return {
                ...item,
                selectionState: item.playlistItem_id === nextItem.playlistItem_id ? 'selected' : 'unselected',
                editingState: item.playlistItem_id === nextItem.playlistItem_id ? 'editing' : null,
                onAirState: null, // 一旦全てのアイテムのオンエア状態をクリア
            };
        });

        // プレイリストの状態を設定
        await stateControl.setPlaylistState(updatedPlaylist);

        // 次のアイテムを「選択状態」に設定
        await stateControl.setOnAirState(nextItem.playlistItem_id);
        logInfo(`[playlist.js] Next item set as On-Air: ${nextItem.name}`);

        // UVCデバイスの場合はエディットエリアに送らない
        if (nextItem.path.startsWith("UVC_DEVICE")) {
            logInfo(`[playlist.js] Next item is a UVC device. Skipping edit area update.`);
            // 右矢印キーを自動押下
            simulateRightArrowKey();
            logOpe("[playlist.js] edit claer.");
        } else {
            // エディットに次のアイテムを送る
            await window.electronAPI.updateEditState(nextItem);
            logInfo(`[playlist.js] Next item sent to edit area: ${nextItem.name}`);
        }

        // オンエアボタン をクリックしてオンエアを開始
        const cueButton = document.getElementById('cue-button');
        if (cueButton) {
            cueButton.click();
            logInfo('[playlist.js] Cue button clicked to trigger On-Air.');
        } else {
            logInfo('[playlist.js] Cue button not found. Unable to trigger On-Air.');
        }

        // プレイリストUIを更新
        await updatePlaylistUI();

        // スクロールして次のアイテムを表示
        scrollToPlaylistItem(nextItem.playlistItem_id);
    } else {
        logInfo('[playlist.js] No next item available in playlist.');
    }
}

// プレイリストアイテムをスクロールして表示する関数
function scrollToPlaylistItem(itemId) {
    const itemElement = document.querySelector(`.playlist-item[data-playlist-item-id="${itemId}"]`);
    if (itemElement) {
        itemElement.scrollIntoView({
            behavior: 'smooth', // スクロールをスムーズに
            block: 'nearest',   // 必要最小限のスクロール
        });
        logInfo(`[playlist.js] Scrolled into view for next item: ${itemId}`);
    } else {
        logInfo(`[playlist.js] Playlist item with ID ${itemId} not found.`);
    }
}

// -----------------------
// モーダル処理
// -----------------------

// モーダルの初期値を設定
let isModalActive = false;

// モーダルの初期状態の取得
window.electronAPI.getModalState().then((state) => {
    isModalActive = state.isActive;
    logInfo(`[playlist.js] Modal state initialized: ${isModalActive}`);
});

// モーダル状態の変更を監視
window.electronAPI.onModalStateChange((event, { isActive }) => {
    isModalActive = isActive;
});

// モーダル表示
function showModal() {
    document.getElementById('playlist-name-modal').classList.remove('hidden');
    const inputElement = document.getElementById('playlist-name-input');

    // モーダルの状態を更新
    window.electronAPI.updateModalState(true);

    setTimeout(() => {
        if (inputElement) inputElement.focus();
    }, 100);
}

// モーダル停止
function hideModal() {
    document.getElementById('playlist-name-modal').classList.add('hidden');
    
    // モーダルの状態を更新
    window.electronAPI.updateModalState(false); 
}

// --------------------------------
//  キーボードショートカット
// --------------------------------

function handlePlaylistShortcut(action) {
    switch (action) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
            document.getElementById(`playlise${action}-button`)?.click();
            logOpe(`[playlist.js] Playlist button ${action} triggered.`);
            break;
        case 'save':
            document.getElementById('playlise-save-button')?.click();
            logOpe('[playlist.js] Save mode button triggered.');
            break;
        case 'delete':
            document.getElementById('playlisedel-button')?.click();
            logOpe('[playlist.js] Delete mode button triggered.');
            break;
        case 'clear':
            document.getElementById('playliseclear-button')?.click();
            logOpe('[playlist.js] Clear button triggered.');
            break;
        case 'repeat':
            document.getElementById('list-repeat-button')?.click();
            logOpe('[playlist.js] List mode REPEAT triggered.');
            break;
        case 'list':
            document.getElementById('list-list-button')?.click();
            logOpe('[playlist.js] List mode LIST triggered.');
            break;
        case 'add-file':
            document.getElementById('file-button')?.click();
            logOpe('[playlist.js] Add file button triggered.');
            break;
        case 'on-air':
            document.getElementById('cue-button')?.click();
            logOpe('[playlist.js] On-Air button triggered via shortcut.');
            break;
        case 'Shift+Alt+D':
            document.getElementById('directonair-mode-button')?.click();
            logOpe('[playlist.js] DIRECT ONAIR mode triggered via shortcut.');
            break;
        case 'Shift+Alt+S':
            document.getElementById('soundpad-mode-button')?.click();
            logOpe('[playlist.js] SOUND PAD mode triggered via shortcut.');
            break;
        default:
            logInfo(`[playlist.js] Unknown action: ${action}`);
    }
}

document.addEventListener('keydown', (event) => {
    if (isModalActive) {
        return; // モーダルが開いている場合はショートカットを無視
    }
    const key = event.key.toLowerCase();
    const isCtrl = event.ctrlKey;
    const isShift = event.shiftKey;
    const isAlt = event.altKey;
    const isEnter = event.key === 'Enter';

    // Shift+Enter の処理を追加
    if (isShift && isEnter) {
        event.preventDefault(); // デフォルト動作を無効化
        const cueButton = document.getElementById('cue-button');
        if (cueButton) {
            cueButton.click();
            logOpe('[playlist.js] On-Air triggered via Shift+Enter.');
        } else {
            logInfo('[playlist.js] On-Air button not found.');
        }
        return; // 他の処理を実行しないようにリターン
    }

    // Ctrl, Shift, Alt キーの組み合わせを処理
    if (isCtrl || isShift || isAlt) {
        event.preventDefault(); // デフォルト動作を無効化
        if (isShift && isAlt && key === 'd') {
            handlePlaylistShortcut('Shift+Alt+D');
        } else if (isCtrl && key === '.') {
            handlePlaylistShortcut('Ctrl+,');
        } else if (isCtrl && key === ',') {
            handlePlaylistShortcut('Ctrl+.');
        } else if (isCtrl && key === '1') {
            handlePlaylistShortcut('1');
        } else if (isCtrl && key === '2') {
            handlePlaylistShortcut('2');
        } else if (isCtrl && key === '3') {
            handlePlaylistShortcut('3');
        } else if (isCtrl && key === '4') {
            handlePlaylistShortcut('4');
        } else if (isCtrl && key === '5') {
            handlePlaylistShortcut('5');
        } else if (isCtrl && key === 's') {
            handlePlaylistShortcut('save');
        } else if (isCtrl && key === 'd') {
            handlePlaylistShortcut('delete');
        } else if (isCtrl && key === 'k') {
            handlePlaylistShortcut('clear');
        } else if (isCtrl && key === 'r') {
            handlePlaylistShortcut('repeat');
        } else if (isCtrl && key === 'l') {
            handlePlaylistShortcut('list');
        } else if (isCtrl && key === 'e') {
            handlePlaylistShortcut('edit');
        } else if (isCtrl && key === 'f') {
            handlePlaylistShortcut('add-file');
        } else if (isCtrl && key === 'c') {  // Ctrl+C
            copyItemState();
        } else if (isCtrl && key === 'v') {  // Ctrl+V
            pasteItemState();
        }
    }
});


// メニューからのショートカットイベント処理
window.electronAPI.onShortcutTrigger((event, shortcut) => {
    logInfo(`[playlist.js] Shortcut triggered: ${shortcut}`);

    if (isModalActive) {
        logDebug('[playlist.js] Shortcut ignored due to active modal.');
        return; // モーダルがアクティブな場合は処理をスキップ
    }

    if (shortcut === 'Shift+Enter') {
        // メニュー操作からOn-Airボタンをクリック
        document.getElementById('cue-button')?.click();
        logOpe('[playlist.js] On-Air triggered via menu shortcut.');
    }
    else if (shortcut === 'add-file') {
        handlePlaylistShortcut('add-file');
    }
    else if (['1', '2', '3', '4', '5'].includes(shortcut)) {
        handlePlaylistShortcut(shortcut);
    }
    else if (shortcut === 'save') {
        handlePlaylistShortcut('save');
    }
    else if (shortcut === 'delete') {
        handlePlaylistShortcut('delete');
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
    else if (shortcut === 'copy-item-state') {
        copyItemState();
    }
    else if (shortcut === 'paste-item-state') {
        pasteItemState();
    }
});


// -----------------------
// アイテム状態のコピー＆ペースト機能
// -----------------------

// アイテムの状態をコピーする関数
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
        ftbRate: item.ftbRate
    };
    logOpe(`[playlist.js] Copied state: ${JSON.stringify(copiedItemState)}`);
    showMessage(getMessage('item-state-copied'), 3000, 'success');
}

// アイテムの状態をペーストする関数
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
    await stateControl.setPlaylistState(playlist);
    await updatePlaylistUI();
    // Notify the edit area to update its UI
    window.electronAPI.updateEditState(item);
    logOpe(`[playlist.js] Pasted state to item ID ${item.playlistItem_id}.`);
    showMessage(getMessage('item-state-pasted'), 3000, 'success');
}

// ------------------------------------------------
// 矢印でアイテムを選択するショートカット(↑↓キー）
// ------------------------------------------------

// 現在選択されているアイテムのインデックスを記録
let currentSelectedIndex = -1;

// コピーされたアイテム状態を保持する変数
let copiedItemState = null;

// 矢印キーで選択を移動する処理
function changePlaylistSelection(direction) {
    if (isModalActive) {
        // logDebug('Modal is open, ignoring shortcuts');
        return; // モーダルが開いている場合はショートカットを無視
    }

    const items = Array.from(document.querySelectorAll('.playlist-item')); // 全アイテムを取得
    if (items.length === 0) {
        logInfo('[playlist.js] No playlist items available for selection.');
        return; // アイテムがなければ何もしない
    }

    // 現在の選択状態を取得して初期化
    if (currentSelectedIndex === -1) {
        const selectedItem = items.find(item => item.classList.contains('editing')); // editing状態のアイテムを取得
        currentSelectedIndex = items.indexOf(selectedItem);
        if (currentSelectedIndex === -1) currentSelectedIndex = 0; // 選択されていない場合は最初を選択
    }

    // 上下移動のロジック
    currentSelectedIndex += direction;
    if (currentSelectedIndex < 0) currentSelectedIndex = items.length - 1; // 循環
    if (currentSelectedIndex >= items.length) currentSelectedIndex = 0;   // 循環

    // 現在選択されたアイテムを取得
    const selectedItem = items[currentSelectedIndex];

    // 選択されたアイテムを画面内にスクロール
    selectedItem.scrollIntoView({
        behavior: 'smooth', // スムーズなスクロール
        block: 'nearest',   // 必要最小限のスクロール
    });

    // クリック処理をトリガー（アイテム選択の処理を一元化）
    selectedItem.click(); // この処理で `handlePlaylistItemClick` が呼ばれる
    logOpe(`[playlist.js] Playlist selection changed to index: ${currentSelectedIndex}`);
}

// キーボードイベントリスナーを登録
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
        changePlaylistSelection(-1); // 上方向
        event.preventDefault(); // デフォルトのスクロールを防止
        logOpe('[playlist.js] ArrowUp clicked.');
    } else if (event.key === 'ArrowDown') {
        changePlaylistSelection(1); // 下方向
        event.preventDefault(); // デフォルトのスクロールを防止
        logOpe('[playlist.js] ArrowDown clicked.');
    }
});

// ----------------------//
//     初期化実行        //
//-----------------------//

initializePlaylistUI();
