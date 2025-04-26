// -----------------------
//     dsk.js
//     ver 2.3.1
// -----------------------

// -----------------------
// グローバル変数
// -----------------------
let currentDSKItem = null;      // 現在DSKとして送出中のアイテム情報
let dskOverlay = null;          // onair.js 内でDSK映像を表示するオーバーレイ用DOM要素
let dskVideo = null;            // DSK映像として使用するvideo要素の参照を保持する変数
const DEFAULT_FADE_DURATION = 300; // 既定のフェード時間（各アイテムは必ず ftbRate を持つ前提）

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
    // すでに body にオーバーレイがあるか確認
    let existingOverlay = document.getElementById('onair-dsk-overlay');
    if (existingOverlay) {
        dskOverlay = existingOverlay;
    } else {
        dskOverlay = document.createElement('div');
        dskOverlay.id = 'onair-dsk-overlay';
        dskOverlay.style.position = 'absolute';
        // 初期状態は非表示
        dskOverlay.style.opacity = '0';
        dskOverlay.style.visibility = 'hidden';
        dskOverlay.style.zIndex = '5';
        document.body.appendChild(dskOverlay);
    }
    // on-air-video の位置・サイズに合わせてDSKオーバーレイを配置
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

    // IN点～OUT点の秒数に変換
    const inSec = parseTimecode(itemData.inPoint);
    const outSec = parseTimecode(itemData.outPoint);

    // EndMode に応じた終了処理をイベント登録
    video.loop = false;
    video.currentTime = inSec;
    const mode = itemData.endMode || 'OFF';

    if (mode === 'REPEAT') {
        // REPEAT：IN→OUT をループ
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
        // PAUSE：終了時に一時停止
        function onPauseEnd() {
            video.pause();
            video.currentTime = outSec;
            video.removeEventListener('ended', onPauseEnd);
        }
        video.addEventListener('ended', onPauseEnd);

    } else {
        // OFF/FTB/NEXT：終了時にクリア
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
        // 送信時に target を 'onair' と指定
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
            // 繰り返し
            dskVideo.currentTime = inSec;
            dskVideo.play().catch(err => console.error('[dsk.js] handleDskEnd repeat error:', err));
            break;

        case 'PAUSE':
            // 最終フレームで停止
            dskVideo.pause();
            dskVideo.currentTime = outSec;
            break;

        case 'FTB':
            // 既存のフェード→クリア
            hideOnAirDSK();
            break;

        case 'OFF':
        case 'NEXT':
            // 即時クリア
            if (window.electronAPI && typeof window.electronAPI.sendDSKCommand === 'function') {
                window.electronAPI.sendDSKCommand({ command: 'DSK_CLEAR', target: 'onair' });
            }
            dskOverlay.innerHTML = '';
            dskOverlay.style.opacity = '0';
            dskOverlay.style.visibility = 'hidden';
            // currentDSKItem はクリアしない（playlist 側で保持したままに）
            window.dispatchEvent(new CustomEvent('dsk-active-clear'));
            break;

    }
}

// -----------------------
// DSK非表示関数 (hideDSK)
// -----------------------
function hideOnAirDSK() {
    if (!dskOverlay) return;
    // 解除命令を即座に送信（送信時に target: 'onair' を指定）
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
// DSKトグル関数 (toggleDSK)
// -----------------------
function toggleOnAirDSK(itemData) {
    // 現在DSKが表示中なら、selected item のチェックをせずに単に解除する
    if (currentDSKItem) {
        hideOnAirDSK();
        return;
    }
    // DSKが表示されていない場合は、selected item の存在チェックを行う
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
// DSKクリア関数 (clearDSK)
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
        // PAUSE モードなら再度ハンドラ登録
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
// 安全なファイルURL変換関数 (getSafeFileURL)
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
    // "HH:MM:SS.ff"形式であることを前提とする
    if (typeof timecode === 'number') {
        return timecode;
    }
    if (typeof timecode === 'string') {
        // ピリオドで秒と100分の1秒の部分を分離
        const [timePart, fracPart] = timecode.split('.');
        let hh = 0, mm = 0, ss = 0, cs = 0;
        if (timePart) {
            const parts = timePart.split(':');
            if (parts.length === 3) {
                hh = Number(parts[0]);
                mm = Number(parts[1]);
                ss = Number(parts[2]);
            } else {
                // 想定外の形式の場合は parseFloat で処理
                return parseFloat(timecode) || 0;
            }
        }
        // 100分の1秒部分がある場合はその値を使用
        cs = Number(fracPart) || 0;
        return hh * 3600 + mm * 60 + ss + (cs / 100);
    }
    return 0;
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
    getCurrentDSKItem: function() { return currentDSKItem; }
};
