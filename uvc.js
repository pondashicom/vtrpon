// -----------------------
//     uvc.js 
//     ver 2.3.5
// -----------------------

// -----------------------
// UVCデバイスの管理と追加処理
// -----------------------

// UVCデバイスをプレイリストに追加
document.getElementById('addUVCToPlaylistButton').addEventListener('click', async () => {
    const dropdown = document.getElementById('uvcDeviceDropdown');
    const selectedDeviceId = dropdown.value;
    const selectedDevice = availableUVCDevices.find(device => device.id === selectedDeviceId);

    if (selectedDevice) {
        try {
            // まずは解像度を取得
            const resolution = await getUVCResolution(selectedDevice.id);
            logDebug(`[playlist.js] Actual camera resolution: ${resolution}`);

            // 仮の「Loading...」サムネイルを作成
            const loadingThumbnail = createLoadingThumbnail();

            const uvcItem = {
                playlistItem_id: generateUniqueId(),
                path: `UVC_DEVICE:${selectedDevice.id}`, // deviceId を埋め込む
                name: selectedDevice.deviceName,
                resolution: resolution || "Unknown",
                deviceId: selectedDevice.id,
                duration: "UVC",
                startMode: "PLAY",
                endMode: "UVC",
                inPoint: "UVC",
                outPoint: "UVC",
                defaultVolume: 0,
                selectionState: "unselected",
                editingState: null,
                order: await getPlaylistOrder().length,
                thumbnail: loadingThumbnail, // 仮のサムネイルを設定
            };

            // プレイリストの状態を更新（仮のサムネイル）
            const currentPlaylist = await stateControl.getPlaylistState();
            const updatedPlaylist = [...currentPlaylist, uvcItem];
            await stateControl.setPlaylistState(updatedPlaylist);
            await updatePlaylistUI();

            logDebug(`[uvc.js] UVC device ${selectedDevice.deviceName} (${resolution}) added to playlist with temporary thumbnail.`);

            // ?? 非同期でサムネイルを生成し、後から更新
            const thumbnail = await generateThumbnail(`UVC_DEVICE:${selectedDevice.id}`);
            logDebug(`[uvc.js] Thumbnail generation complete - deviceId: ${selectedDevice.id}`);

            // サムネイルを更新
            const newPlaylist = await stateControl.getPlaylistState();
            const targetIndex = newPlaylist.findIndex(item => item.playlistItem_id === uvcItem.playlistItem_id);

            if (targetIndex !== -1) {
                newPlaylist[targetIndex].thumbnail = thumbnail;
                await stateControl.setPlaylistState(newPlaylist);
                await updatePlaylistUI();
                logDebug(`[uvc.js] Thumbnail updated - deviceId: ${selectedDevice.id}`);
            }
        } catch (error) {
            logDebug('[uvc.js] Error adding UVC device to playlist:', error);
        }
    } else {
        logDebug('[uvc.js] No UVC device selected.');
    }
});

// ?? 「Loading…」サムネイルを作成
function createLoadingThumbnail() {
    const canvas = document.createElement('canvas');
    canvas.width = 112;
    canvas.height = 63;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);

    return canvas.toDataURL('image/png'); // Base64形式のデータURLを返す
}

// UVCデバイスリスト
let availableUVCDevices = []; // 初期状態を空に設定

// プルダウンの内容を更新
async function updateUVCDevicesDropdown() {
    const dropdown = document.getElementById('uvcDeviceDropdown');
    dropdown.innerHTML = ''; // 既存の選択肢をクリア

    // 動的にUVCデバイスを取得
    availableUVCDevices = await getUVCDevices();

    if (availableUVCDevices.length === 0) {
        // デバイスが見つからない場合のフォールバック
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No devices found';
        dropdown.appendChild(option);
        return;
    }

    availableUVCDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = `${device.deviceName}`;
        dropdown.appendChild(option);
    });

    logDebug('[uvc.js] UVC devices updated in dropdown:', availableUVCDevices);
}

// UVCデバイスの取得
async function getUVCDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        logDebug('[uvc.js] Video Input Devices:', videoDevices);

        return videoDevices.map((device, index) => ({
            id: device.deviceId,
            deviceName: device.label || `Camera ${index + 1}`
        }));
    } catch (error) {
        logDebug('[uvc.js] Error fetching video input devices:', error);
        return [];
    }
}

// 解像度を取得
async function getUVCResolution(deviceId) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });
        const track = stream.getVideoTracks()[0];
        const { width, height } = track.getSettings();
        track.stop();
        return `${width}x${height}`;
    } catch (error) {
        logDebug(`[uvc.js] deviceId=${deviceId}`, error);
        return 'Unknown';
    }
}


// ほかのアプリで使われたら奪う
function stopAllStreams() {
    navigator.mediaDevices.enumerateDevices()
        .then(devices => devices.filter(device => device.kind === 'videoinput'))
        .then(videoDevices => {
            videoDevices.forEach(device => {
                navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } } })
                    .then(stream => {
                        stream.getTracks().forEach(track => track.stop());
                    })
                    .catch(err => logDebug('[uvc.js] Error stopping stream for device:', err));
            });
        })
        .catch(err => logDebug('[uvc.js] Error enumerating devices:', err));
}

// 初期化時にプルダウンを更新
updateUVCDevicesDropdown();

// UVCデバイスの接続状況変化を監視し、プルダウンを更新する
navigator.mediaDevices.addEventListener('devicechange', updateUVCDevicesDropdown);
