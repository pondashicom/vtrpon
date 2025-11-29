// ------------------------------
//  testpattern.js
//  ver 2.5.0
// ------------------------------

// ログ機能の取得
const tpLogInfo  = window.electronAPI.logInfo;
const tpLogOpe   = window.electronAPI.logOpe;
const tpLogDebug = window.electronAPI.logDebug;

let isAddingTestPattern = false;

// イベントリスナー
document.addEventListener('DOMContentLoaded', () => {
    if (!window.electronAPI || typeof window.electronAPI.onGenerateTestPattern !== 'function') {
        console.warn('[testpattern.js] electronAPI.onGenerateTestPattern is not available.');
        return;
    }

    window.electronAPI.onGenerateTestPattern((payload) => {
        const type = payload && payload.type;
        handleTestPatternRequest(type);
    });

    if (typeof tpLogInfo === 'function') {
        tpLogInfo('[testpattern.js] Test pattern handler initialized.');
    } else {
        console.log('[testpattern.js] Test pattern handler initialized.');
    }
});

// ------------------------------
// テストパターンメニューハンドラ
// ------------------------------
async function handleTestPatternRequest(type) {
    if (!type) {
        if (typeof tpLogInfo === 'function') {
            tpLogInfo('[testpattern.js] Test pattern type is not specified.');
        }
        return;
    }

    if (isAddingTestPattern) {
        if (typeof tpLogDebug === 'function') {
            tpLogDebug('[testpattern.js] Another test pattern addition is already in progress.');
        }
        return;
    }

    isAddingTestPattern = true;

    try {
        const info = buildTestPatternInfo(type);
        if (!info || !info.path) {
            if (typeof tpLogInfo === 'function') {
                tpLogInfo(`[testpattern.js] Unknown test pattern type: ${type}`);
            }
            return;
        }

        if (typeof tpLogOpe === 'function') {
            tpLogOpe(`[testpattern.js] Adding test pattern to playlist. type=${type}, file=${info.path}`);
        }

        if (!window.playlistAPI || typeof window.playlistAPI.addFilesFromPaths !== 'function') {
            if (typeof tpLogInfo === 'function') {
                tpLogInfo('[testpattern.js] window.playlistAPI.addFilesFromPaths is not available.');
            }
            if (typeof showMessage === 'function') {
                const msg = (typeof getMessage === 'function'
                    ? getMessage('testpattern-playlist-not-ready')
                    : 'Playlist module is not ready.');
                showMessage(msg, 3000, 'alert');
            }
            return;
        }

        // プレイリスト側の公開 API
        await window.playlistAPI.addFilesFromPaths([info.path]);

        if (typeof showMessage === 'function') {
            const msg = (typeof getMessage === 'function'
                ? getMessage('testpattern-added-to-playlist')
                : 'Test pattern added to playlist.');
            showMessage(msg, 3000, 'info');
        }
    } catch (err) {
        const message = (err && err.message) ? err.message : String(err);
        if (typeof tpLogInfo === 'function') {
            tpLogInfo(`[testpattern.js] Failed to add test pattern: ${message}`);
        }
        if (typeof showMessage === 'function') {
            const msg = (typeof getMessage === 'function'
                ? getMessage('testpattern-add-failed')
                : 'Failed to add test pattern.');
            showMessage(msg, 5000, 'alert');
        }
    } finally {
        isAddingTestPattern = false;
    }
}

// ------------------------------
// ファイルパス
// ------------------------------
function buildTestPatternInfo(type) {
    // アプリ実行ディレクトリからの相対パスとして扱う
    switch (type) {
        case 'smpte':
            return {
                path: 'assets/video/smpte_1080p30_1kHz_-18dBFS_20s.mp4'
            };
        case 'checker':
            return {
                path: 'assets/video/colorchecker_1080p30_1kHz_-18dBFS_20s.mp4'
            };
        case 'tone':
            return {
                path: 'assets/video/testtone_1kHz_-18dBFS_20s.wav'
            };
        default:
            return null;
    }
}
