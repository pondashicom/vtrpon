// -----------------------
//     dsk.js
//     ver 2.4.0
// -----------------------

// -----------------------
// グローバル変数
// -----------------------
let currentDSKItem = null;
let dskOverlay = null;
let dskVideo = null;
const DEFAULT_FADE_DURATION = 300;

// -----------------------
// DSKオーバーレイ初期化
// -----------------------
// dskOverlay の位置・サイズを動画要素に合わせて調整
function adjustDskOverlay() {
    const fsVideo = document.getElementById('fullscreen-video');
    if (fsVideo && dskOverlay) {
        const rect = fsVideo.getBoundingClientRect();
        dskOverlay.style.left = rect.left + 'px';
        dskOverlay.style.top = rect.top + 'px';
        dskOverlay.style.width = rect.width + 'px';
        dskOverlay.style.height = rect.height + 'px';
    }
}

// オンエア用DSKオーバーレイの位置・サイズを、on-air-video の位置に合わせて調整する関数
function adjustDskOverlay() {
    const onAirVideo = document.getElementById('on-air-video');
    if (onAirVideo && dskOverlay) {
        const rect = onAirVideo.getBoundingClientRect();
        dskOverlay.style.left = rect.left + 'px';
        dskOverlay.style.top = rect.top + 'px';
        dskOverlay.style.width = rect.width + 'px';
        dskOverlay.style.height = rect.height + 'px';
    } else {
        console.warn('[dsk.js] on-air-video element not found.');
    }
}

function initOnAirDSKOverlay() {
    const onAirVideo = document.getElementById('on-air-video');
    if (!onAirVideo) {
        console.error('[dsk.js] on-air-video element not found.');
        return;
    }
    let existingOverlay = document.getElementById('onair-dsk-overlay');
    if (existingOverlay) {
        dskOverlay = existingOverlay;
    } else {
        dskOverlay = document.createElement('div');
        dskOverlay.id = 'onair-dsk-overlay';
        dskOverlay.style.position = 'absolute';
        dskOverlay.style.opacity = '0';
        dskOverlay.style.visibility = 'hidden';
        dskOverlay.style.zIndex = '5';
        document.body.appendChild(dskOverlay);
    }
    adjustDskOverlay();
}

window.addEventListener('resize', () => {
    if (dskOverlay) {
        adjustDskOverlay();
    }
});

// -----------------------
// フェードイン／フェードアウト処理
// -----------------------
function fadeIn(element, duration, callback) {
    element.style.visibility = 'visible';
    element.style.transition = `opacity ${duration}ms ease`;
    window.getComputedStyle(element).opacity;
    element.style.opacity = '1';
    if (callback) {
        setTimeout(callback, duration);
    }
}

function fadeOut(element, duration, callback) {
    element.style.transition = `opacity ${duration}ms ease`;
    element.style.opacity = '0';
    setTimeout(() => {
        element.style.visibility = 'hidden';
        if (callback) callback();
    }, duration);
}

// -----------------------
// DSK表示関数 (showDSK)
// -----------------------
function showOnAirDSK(itemData) {
    if (!dskOverlay) {
        initOnAirDSKOverlay();
        if (!dskOverlay) return;
    }
    if (!itemData) {
        return;
    }
    currentDSKItem = itemData;
    dskOverlay.innerHTML = '';

    const video = document.createElement('video');
    video.src = getSafeFileURL(itemData.path);
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.muted = true;  // オンエア側DSKは音声出力しない

    const inSec = parseTimecode(itemData.inPoint);
    const outSec = parseTimecode(itemData.outPoint);

    video.loop = false;
    video.currentTime = inSec;
    const mode = itemData.endMode || 'OFF';

    if (mode === 'REPEAT') {
        video.addEventListener('timeupdate', function loopSegment() {
            if (video.currentTime >= outSec) {
                video.currentTime = inSec;
            }
        });
        video.addEventListener('ended', function loopOnEnded() {
            video.currentTime = inSec;
            video.play().catch(err => console.error('[dsk.js] REPEAT play error:', err));
        });

    } else if (mode === 'PAUSE') {
        function onPauseEnd() {
            video.pause();
            video.currentTime = outSec;
            video.removeEventListener('ended', onPauseEnd);
        }
        video.addEventListener('ended', onPauseEnd);

    } else {
        // OFF/FTB/NEXTは終了時にクリア
        function onClearEnd() {
            handleDskEnd();
            video.removeEventListener('ended', onClearEnd);
        }
        video.addEventListener('ended', onClearEnd);
    }

    video.play().catch(err => console.error('[dsk.js] video.play() error:', err));
    dskOverlay.appendChild(video);
    dskVideo = video;

    const fadeDuration = itemData.ftbRate * 1000;
    fadeIn(dskOverlay, fadeDuration);
    
    if (window.electronAPI && typeof window.electronAPI.sendDSKCommand === 'function') {
        window.electronAPI.sendDSKCommand({ command: 'DSK_SHOW', payload: itemData, target: 'onair' });
    }
    window.dispatchEvent(new CustomEvent('dsk-active-set', { detail: { itemId: itemData.playlistItem_id } }));
}

// DSK終了処理分岐
function handleDskEnd() {
    if (!currentDSKItem || !dskVideo) return;

    const inSec = parseTimecode(currentDSKItem.inPoint);
    const outSec = parseTimecode(currentDSKItem.outPoint);
    const mode  = currentDSKItem.endMode || 'OFF';

    switch (mode) {
        case 'REPEAT':
            dskVideo.currentTime = inSec;
            dskVideo.play().catch(err => console.error('[dsk.js] handleDskEnd repeat error:', err));
            break;

        case 'PAUSE':
            dskVideo.pause();
            dskVideo.currentTime = outSec;
            break;

        case 'FTB':
            hideOnAirDSK();
            break;

        case 'OFF':
        case 'NEXT':
            if (window.electronAPI && typeof window.electronAPI.sendDSKCommand === 'function') {
                window.electronAPI.sendDSKCommand({ command: 'DSK_CLEAR', target: 'onair' });
            }
            dskOverlay.innerHTML = '';
            dskOverlay.style.opacity = '0';
            dskOverlay.style.visibility = 'hidden';
            currentDSKItem = null;
            window.dispatchEvent(new CustomEvent('dsk-active-clear'));
            break;
    }
}


// -----------------------
// DSK非表示
// -----------------------
function hideOnAirDSK() {
    if (!dskOverlay) return;
    if (window.electronAPI && typeof window.electronAPI.sendDSKCommand === 'function') {
        window.electronAPI.sendDSKCommand({ command: 'DSK_CLEAR', target: 'onair' });
    }
    const fadeDuration = currentDSKItem.ftbRate * 1000;
    fadeOut(dskOverlay, fadeDuration, () => {
        dskOverlay.innerHTML = '';
        currentDSKItem = null;
        window.dispatchEvent(new CustomEvent('dsk-active-clear'));
    });
}

// -----------------------
// DSKトグル
// -----------------------
function toggleOnAirDSK(itemData) {
    if (currentDSKItem) {
        hideOnAirDSK();
        return;
    }
    if (!itemData) {
        const playlist = window.electronAPI.stateControl.getPlaylistState();
        itemData = playlist.find(item => item.selectionState === "selected");
        if (!itemData) {
            showMessage(getMessage('no-selected-item-for-dsk'), 5000, 'alert');
            return;
        }
    }
    let ext = "";
    if (itemData.type) {
        ext = itemData.type.toLowerCase();
    } else {
        const match = itemData.path.match(/\.([^.]+)$/);
        ext = match ? match[1].toLowerCase() : "";
    }
    if (ext !== 'mov' && ext !== 'mp4' && ext !== 'webm') {
        showMessage(getMessage('not-dsk-supported-file-error'), 5000, 'alert');
        return;
    }
    showOnAirDSK(itemData);
}

// -----------------------
// DSKクリア
// -----------------------
function clearOnAirDSK() {
    hideOnAirDSK();
}

// -----------------------
// 再生と一時停止
// -----------------------

function pauseOnAirDSK() {
    if (dskVideo && !dskVideo.paused) {
        dskVideo.pause();
    }
}

function playOnAirDSK() {
    if (dskVideo && dskVideo.paused) {
        dskVideo.play().catch(err => console.error('[dsk.js] dskVideo.play() error:', err));
        if (currentDSKItem?.endMode === 'PAUSE') {
            function onPauseEnd() {
                dskVideo.pause();
                dskVideo.currentTime = parseTimecode(currentDSKItem.outPoint);
                dskVideo.removeEventListener('ended', onPauseEnd);
            }
            dskVideo.addEventListener('ended', onPauseEnd);
        }
    }
}

// -----------------------
// 安全なファイルURL変換
// -----------------------
function getSafeFileURL(filePath) {
    if (!filePath.startsWith('file://')) {
        filePath = 'file:///' + filePath.replace(/\\/g, '/');
    }
    return encodeURI(filePath).replace(/#/g, '%23');
}

// -----------------------
// IN点とOUT点用の時間
// -----------------------
function parseTimecode(timecode) {
    if (typeof timecode === 'number') {
        return timecode;
    }
    if (typeof timecode === 'string') {
        const [timePart, fracPart] = timecode.split('.');
        let hh = 0, mm = 0, ss = 0, cs = 0;
        if (timePart) {
            const parts = timePart.split(':');
            if (parts.length === 3) {
                hh = Number(parts[0]);
                mm = Number(parts[1]);
                ss = Number(parts[2]);
            } else {
                return parseFloat(timecode) || 0;
            }
        }
        cs = Number(fracPart) || 0;
        return hh * 3600 + mm * 60 + ss + (cs / 100);
    }
    return 0;
}

// -----------------------
// DSK選択状態復元時に再適用する
// -----------------------
function setCurrentDSKItemById(itemId) {
    if (!itemId) return;
    try {
        const list = window.electronAPI.stateControl.getPlaylistState();
        const item = list.find(i => i.playlistItem_id === itemId);
        if (!item) return;
        // 現在のDSK対象として記録（再生や表示は開始しない）
        currentDSKItem = item;
        // Playlist側にdskActiveを付与してUI（オレンジ枠）を復元
        window.dispatchEvent(new CustomEvent('dsk-active-set', { detail: { itemId } }));
    } catch (e) {
        console.error('[dsk.js] setCurrentDSKItemById error:', e);
    }
}

// -----------------------
// モジュールエクスポート
// -----------------------
window.dskModule = {
    initOnAirDSKOverlay: initOnAirDSKOverlay,
    showOnAirDSK: showOnAirDSK,
    hideOnAirDSK: hideOnAirDSK,
    toggleOnAirDSK: toggleOnAirDSK,
    clearOnAirDSK: clearOnAirDSK,
    pauseOnAirDSK: pauseOnAirDSK,
    playOnAirDSK: playOnAirDSK,
    getCurrentDSKItem: function() { return currentDSKItem; },
    setCurrentDSKItemById: setCurrentDSKItemById
};

