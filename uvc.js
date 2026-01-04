// -----------------------
//     uvc.js 
//     ver 2.5.2
// -----------------------

// -----------------------
// UVCデバイスの管理と追加処理
// -----------------------

// UVCデバイスをプレイリストに追加
document.getElementById('addUVCToPlaylistButton').addEventListener('mousedown', async (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const dropdown = document.getElementById('uvcDeviceDropdown');
    const selectedDeviceId = dropdown.value;
    const selectedDevice = availableUVCDevices.find(device => device.id === selectedDeviceId);

    // クリック時点のアクティブスロットを固定（途中でプレイリスト切替されても上書き事故を起こさない）
    const expectedSlot = (typeof getActivePlaylistSlotOrNull === 'function')
        ? getActivePlaylistSlotOrNull()
        : ((typeof activePlaylistIndex === 'number') ? activePlaylistIndex : null);

    const expectedStoreNumber = (typeof expectedSlot === 'number' && expectedSlot >= 1 && expectedSlot <= 9) ? expectedSlot : 1;

    const isExpectedSlotActive = () => {
        if (typeof getActivePlaylistSlotOrNull === 'function') {
            return getActivePlaylistSlotOrNull() === expectedStoreNumber;
        }
        if (typeof activePlaylistIndex === 'number') {
            return activePlaylistIndex === expectedStoreNumber;
        }
        // 判定できない場合は「非アクティブ」として扱い、UI/stateの上書きをしない
        return false;
    };

    const createTextThumbnail = (text, bgColor) => {
        const canvas = document.createElement('canvas');
        const targetWidth = 120;
        const targetHeight = Math.round(targetWidth * 9 / 16);
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bgColor || 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        return canvas.toDataURL('image/png');
    };

    // 存在しないUVC（NDI Webcam未起動など）は getUserMedia を呼ばずに即オフライン扱い
    const isDevicePresent = async (deviceId) => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return Array.isArray(devices) && devices.some(d => d && d.kind === 'videoinput' && String(d.deviceId) === String(deviceId));
        } catch (e) {
            return true; // enumerateDevices が失敗した場合は存在するとみなす（後段で失敗判定）
        }
    };

    // “起動していないのに列挙だけされる”系はプレビュー取得（getUserMedia）をしない
    const isPreviewDisabledUvcName = (name) => {
        const s = String(name || '');
        return /NDI|OBS|Virtual/i.test(s);
    };

    if (selectedDevice) {
        try {
            // UVCごとの音声デバイス設定を取得
            let boundUvcAudioDeviceId = "";
            try {
                if (window.electronAPI && typeof window.electronAPI.getDeviceSettings === 'function') {
                    const settings = await window.electronAPI.getDeviceSettings();
                    if (settings && settings.uvcAudioBindings && settings.uvcAudioBindings[selectedDevice.id]) {
                        boundUvcAudioDeviceId = settings.uvcAudioBindings[selectedDevice.id] || "";
                    }
                }
            } catch (error) {
                logDebug('[uvc.js] Failed to load UVC audio binding from device settings:', error);
            }

            const devicePresent = await isDevicePresent(selectedDevice.id);
            const previewDisabled = (typeof isPreviewDisabledUvcName === 'function') ? isPreviewDisabledUvcName(selectedDevice.deviceName) : false;

            // 仮のサムネイル（存在しないデバイスは最初から Media Offline / プレビュー無効は No Preview）
            const loadingThumbnail = (!devicePresent)
                ? createTextThumbnail('Media Offline')
                : (previewDisabled ? createTextThumbnail('No Preview') : createLoadingThumbnail());

            // 追加対象のプレイリスト（スロット固定）
            let basePlaylist = [];
            if (typeof readPlaylistStorePayload === 'function') {
                const payload = readPlaylistStorePayload(expectedStoreNumber);
                basePlaylist = (payload && Array.isArray(payload.data)) ? payload.data : [];
            } else {
                basePlaylist = await stateControl.getPlaylistState();
            }

            if (!Array.isArray(basePlaylist)) basePlaylist = [];

            const uvcItem = {
                playlistItem_id: `${Date.now()}-${Math.random()}`,
                path: `UVC_DEVICE:${selectedDevice.id}`, // deviceId を埋め込む
                name: selectedDevice.deviceName,
                resolution: "Unknown",
                deviceId: selectedDevice.id,
                duration: "UVC",
                startMode: "PLAY",
                endMode: "UVC",
                inPoint: "UVC",
                outPoint: "UVC",
                defaultVolume: 100,
                uvcAudioDeviceId: boundUvcAudioDeviceId,
                selectionState: "unselected",
                editingState: null,
                order: basePlaylist.length,
                thumbnail: loadingThumbnail,
                mediaOffline: !devicePresent,
                uvcPreviewDisabled: !!previewDisabled
            };

            const updatedPlaylist = [...basePlaylist, uvcItem];

            try {
                if (!window.__vtrponUvcPreviewDisabledIds) {
                    window.__vtrponUvcPreviewDisabledIds = new Set();
                }
            } catch (e) {
                // ignore
            }

// 固定スロットに保存（アクティブスロットに対する saveActivePlaylistToStore は使わない）
            if (typeof writePlaylistStoreData === 'function') {
                try {
                    writePlaylistStoreData(expectedStoreNumber, updatedPlaylist);
                } catch (e) {
                    // ignore
                }
            }

            // 表示中のスロットであれば、安全な経路（loadPlaylist の token ガード）で反映する
            if (isExpectedSlotActive() && (typeof loadPlaylist === 'function')) {
                await loadPlaylist(expectedStoreNumber);
            }

            // 非同期で解像度を取得して、保存データ／表示を更新する（失敗しても無視・巻き込み防止）
            (async () => {
                try {
                    if (!devicePresent) return;
                    if (typeof getUVCResolution !== 'function') return;

                    const res = await getUVCResolution(selectedDevice.id, 2500);
                    if (!res || res === 'Unknown') return;

                    let latestItems = null;
                    try {
                        if (typeof readPlaylistStorePayload === 'function') {
                            const payload = readPlaylistStorePayload(expectedStoreNumber);
                            if (payload && Array.isArray(payload.items)) {
                                latestItems = payload.items;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }

                    const base = Array.isArray(latestItems) ? latestItems : updatedPlaylist;
                    const next = base.map((it) => {
                        if (!it || String(it.playlistItem_id) !== String(uvcItem.playlistItem_id)) return it;
                        return { ...it, resolution: res };
                    });

                    if (typeof writePlaylistStoreData === 'function') {
                        try {
                            writePlaylistStoreData(expectedStoreNumber, next);
                        } catch (e) {
                            // ignore
                        }
                    }

                    if (isExpectedSlotActive() && (typeof loadPlaylist === 'function')) {
                        await loadPlaylist(expectedStoreNumber);
                    }
                } catch (e) {
                    // ignore
                }
            })();

            return;

        } catch (error) {
            logDebug('[uvc.js] Error adding UVC device to playlist:', error);
        }
    } else {
        logDebug('[uvc.js] No UVC device selected.');
    }
});

// 「Loading…」サムネイルを作成
function createLoadingThumbnail() {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 68;
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
async function getUVCResolution(deviceId, timeoutMs = 4000) {
    try {
        // enumerateDevices で存在チェック（存在しないデバイスは getUserMedia しない）
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const exists = Array.isArray(devices) && devices.some(d => d && d.kind === 'videoinput' && String(d.deviceId) === String(deviceId));
            if (!exists) {
                return 'Unknown';
            }
        } catch (e) {
            // enumerateDevices が失敗しても getUserMedia は試す
        }

        // まず ideal で FHD を要求（交渉を強める）
        const gumPromise = navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                aspectRatio: 16 / 9,
                resizeMode: 'none'
            }
        });

        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve(null), timeoutMs);
        });

        const stream = await Promise.race([gumPromise, timeoutPromise]);

        if (!stream) {
            // 後から解決した場合に備えて停止
            gumPromise.then((s) => {
                try { s.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
            }).catch(() => { /* ignore */ });
            return 'Unknown';
        }

        try {
            const track = stream.getVideoTracks()[0];
            const settings = (track && typeof track.getSettings === 'function') ? track.getSettings() : null;
            const width = settings && settings.width ? settings.width : null;
            const height = settings && settings.height ? settings.height : null;

            stream.getTracks().forEach(track => track.stop());

            if (width && height) return `${width}x${height}`;
            return 'Unknown';
        } catch (e) {
            try { stream.getTracks().forEach(t => t.stop()); } catch (err) { /* ignore */ }
            return 'Unknown';
        }
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
