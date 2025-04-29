// -----------------------
//     movtowebm.js 
//     ver 2.1.5
// -----------------------

// MOVファイルにアルファチャンネルが含まれているかをチェックする関数
async function checkMovAlpha(filePath) {
  try {
    const pixFmt = await window.electronAPI.checkMovAlpha(filePath);
    return pixFmt.trim().toLowerCase().includes('yuva');
  } catch (error) {
    logInfo('checkMovAlpha error:', error);
    return false;
  }
}

// 仮のプレイリストエントリを追加する関数
async function addLoadingEntry(originalPath, extension) {
    const originalFileName = window.electronAPI.path.basename(originalPath).replace(window.electronAPI.path.extname(originalPath), '');
    const loadingPath = `${originalPath}_loading.${extension}`;

    const loadingCanvas = document.createElement('canvas');
    loadingCanvas.width = 112;
    loadingCanvas.height = 63;
    const ctx = loadingCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, loadingCanvas.width, loadingCanvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', loadingCanvas.width / 2, loadingCanvas.height / 2);
    const loadingThumbnail = loadingCanvas.toDataURL('image/png');

    const tempPlaylistItem = {
        path: loadingPath,
        name: `${originalFileName}.${extension}`,
        thumbnail: loadingThumbnail,
        selectionState: "unselected",
        editingState: null,
        onAirState: null,
        mediaOffline: false, 
    };

    const currentPlaylist = await stateControl.getPlaylistState();
    const updatedPlaylist = [...currentPlaylist, tempPlaylistItem];

    await stateControl.setPlaylistState(updatedPlaylist);
    await updatePlaylistUI();

    return loadingPath;
}

// MOV → WebM 変換を実行し、プレイリストを更新
async function convertMovToWebm(originalPath, tempEntryPath) {
    convertingFiles.add(originalPath);

    // 仮エントリ更新
    const playlist = await stateControl.getPlaylistState();
    const tempIndex = playlist.findIndex(item => item.path === tempEntryPath);

    if (tempIndex !== -1) {
        playlist[tempIndex].converting = true; 

        playlist[tempIndex].mediaOffline = false;
        playlist[tempIndex].resolution = "Converting...";
        playlist[tempIndex].duration = "00:00:10:00"; 
        await stateControl.setPlaylistState(playlist);
        await updatePlaylistUI();
    }

    const webmPath = await window.electronAPI.convertMovToWebm(originalPath);
    if (!webmPath) {
        logInfo(`[playlist.js] MOV conversion failed: ${originalPath}`);
        convertingFiles.delete(originalPath);

        // 失敗時には converting を解除
        if (tempIndex !== -1) {
            playlist[tempIndex].converting = false;
            await stateControl.setPlaylistState(playlist);
            await updatePlaylistUI();
        }

        return;
    }

    logInfo(`[playlist.js] MOV conversion complete, updating playlist: ${webmPath}`);

    // 変換成功後のメタデータを取得
    let metadata;
    try {
        metadata = await window.electronAPI.getMetadata(webmPath);
    } catch (err) {
        logInfo(`[playlist.js] Failed to retrieve metadata for WebM: ${webmPath}`);
        metadata = { resolution: "Unknown", duration: "00:00:10:00" };
    }

    const finalPlaylist = await stateControl.getPlaylistState();
    const finalIndex = finalPlaylist.findIndex(item => item.path === tempEntryPath);

    if (finalIndex !== -1) {
        finalPlaylist[finalIndex].path = webmPath;
        finalPlaylist[finalIndex].thumbnail = await generateThumbnail(webmPath);
        finalPlaylist[finalIndex].resolution = metadata.resolution || "Unknown";
        finalPlaylist[finalIndex].duration = metadata.duration || "00:00:10:00";
        finalPlaylist[finalIndex].inPoint = "00:00:00:00";
        finalPlaylist[finalIndex].outPoint = metadata.duration || "00:00:10:00";
        finalPlaylist[finalIndex].mediaOffline = false;

        finalPlaylist[finalIndex].converting = false;

        await stateControl.setPlaylistState(finalPlaylist);
        await updatePlaylistUI();
    }
    convertingFiles.delete(originalPath);
}