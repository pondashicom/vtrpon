// ------------------------------
//  testpattern.js
//  ver 2.5.2
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
// テストパターン追加処理
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
            tpLogDebug(`[testpattern.js] Test pattern add is already in progress. type=${type}`);
        }
        return;
    }

    isAddingTestPattern = true;

    try {
        const info = buildTestPatternInfo(type);
        if (!info || !info.path) {
            if (typeof tpLogInfo === 'function') {
                tpLogInfo(`[testpattern.js] Unsupported test pattern type: ${type}`);
            }
            return;
        }

        const playlistAPI =
            (window.playlistAPI && typeof window.playlistAPI.addFilesFromPaths === 'function')
                ? window.playlistAPI
                : (window.electronAPI &&
                   window.electronAPI.playlistAPI &&
                   typeof window.electronAPI.playlistAPI.addFilesFromPaths === 'function')
                    ? window.electronAPI.playlistAPI
                    : null;

        if (!playlistAPI) {
            console.error('[testpattern.js] playlistAPI.addFilesFromPaths is not available.');
            return;
        }

        const paths = [info.path];
        const result = playlistAPI.addFilesFromPaths(paths);

        // Promise が返ってきた場合のみ待機
        if (result && typeof result.then === 'function') {
            await result;
        }

        if (typeof tpLogOpe === 'function') {
            tpLogOpe(`[testpattern.js] Test pattern added to playlist. type=${type}, path=${info.path}`);
        }
    } catch (error) {
        console.error('[testpattern.js] Failed to add test pattern:', error);
        if (typeof tpLogInfo === 'function') {
            tpLogInfo(
                `[testpattern.js] Failed to add test pattern: ${
                    error && error.message ? error.message : String(error)
                }`
            );
        }
    } finally {
        isAddingTestPattern = false;
    }
}

// ------------------------------
// ファイルパス
// ------------------------------

function buildTestPatternInfo(type) {
    const pathApi = window.electronAPI && window.electronAPI.path;
    const join = pathApi && typeof pathApi.join === 'function'
        ? pathApi.join
        : (...parts) => parts.join('/');

    // ベースディレクトリ（開発時／ビルド版で切替）
    let baseDir = 'assets/video';
    if (window.electronAPI && typeof window.electronAPI.getTestPatternBaseDir === 'function') {
        baseDir = window.electronAPI.getTestPatternBaseDir();
    }

    switch (type) {
        case 'smpte':
            return {
                path: join(baseDir, 'smpte_1080p30_1kHz_-18dBFS_20s.mp4')
            };
        case 'checker':
            return {
                path: join(baseDir, 'colorchecker_1080p30_1kHz_-18dBFS_20s.mp4')
            };
        case 'grid':
            return {
                path: join(baseDir, 'projector_grid_1920x1080_20s.mp4')
            };
        case 'gray':
            return {
                path: join(baseDir, 'grayramp_1080p30_1kHz_-18dBFS_20s.mp4')
            };
        case 'pink':
            return {
                path: join(baseDir, 'pinknoise_20s.wav')
            };
        case 'tone':
            return {
                path: join(baseDir, 'testtone_1kHz_-18dBFS_20s.wav')
            };
        default:
            return null;
    }
}
