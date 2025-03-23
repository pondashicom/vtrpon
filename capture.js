// -----------------------
//     capture.js
//     ver 2.0.1
// -----------------------

// キャプチャボタンのイベントリスナー
document.getElementById('still-button').addEventListener('click', async () => {
    const videoElement = document.getElementById('listedit-video');

    if (!videoElement || videoElement.readyState < 2) {
        logInfo('[capture.js] Video element is not ready for capture.');
        return;
    }

    try {
        // Canvasを生成してビデオフレームをキャプチャ
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // PNGデータをBlob形式で取得
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

        // 一時ファイルに保存し、保存先パスを取得
        const tempFilePath = await saveTemporaryFile(blob, `capture_${Date.now()}.png`);
        if (!tempFilePath) {
            logInfo('[capture.js] Failed to save temporary file.');
            return;
        }

        logDebug(`[capture.js] Temporary file saved at: ${tempFilePath}`);

        // プレイリストに登録
        const capturedFiles = [{ path: tempFilePath, name: `capture_${Date.now()}.png` }];
        const currentPlaylist = await stateControl.getPlaylistState();
        const validUpdates = await getValidUpdates(capturedFiles, currentPlaylist);

        if (validUpdates.length > 0) {
            const updatedPlaylist = [
                ...currentPlaylist.map(existingItem => ({
                    ...existingItem,
                    selectionState: existingItem.selectionState || "unselected",
                    editingState: existingItem.editingState || null,
                    onAirState: null,
                })),
                ...validUpdates.map(newItem => ({
                    ...newItem,
                    selectionState: "unselected",
                    editingState: null,
                    onAirState: null,
                })),
            ];

            await stateControl.setPlaylistState(updatedPlaylist);
            await updatePlaylistUI();
            logDebug(`Capture successfully added to playlist: ${tempFilePath}`);
        }
    } catch (error) {
        logInfo('[capture.js] Error capturing video frame:', error);
    }
});

// 一時ファイルを保存する
async function saveTemporaryFile(blob, fileName) {
    try {
        // BlobをArrayBufferに変換
        const arrayBuffer = await blob.arrayBuffer();

        // `saveBlobToFile` を呼び出して一時ファイルを保存
        const tempFilePath = await window.electronAPI.saveBlobToFile(arrayBuffer, fileName);

        logDebug(`[capture.js] Temporary file saved at: ${tempFilePath}`);
        return tempFilePath;
    } catch (error) {
        logInfo('[capture.js] Error saving temporary file:', error);
        throw error;
    }
}
