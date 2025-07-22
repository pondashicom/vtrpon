// -----------------------
//     logger.js 
//     ver 1.0.1
// -----------------------

// ----------------------//
//     CONSOLE LOG       //
// ----------------------//

// ログレベル設定
const LOG_LEVELS = {
    NONE: 0,
    INFO: 1,
    OPE : 2,
    DEBUG: 3
};

let currentLogLevel = LOG_LEVELS.DEBUG; // 共通ログレベル設定

// タイムスタンプ生成
function getTimestamp() {
    return new Date().toISOString();
}

// ログ出力関数
function logInfo(message) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
        console.log(`[${getTimestamp()}] INFO: ${message}`);
    }
}

function logOpe(message) {
    if (currentLogLevel >= LOG_LEVELS.OPE) {
        console.log(`[${getTimestamp()}] OPE: ${message}`);
    }
}

function logDebug(message) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
        console.log(`[${getTimestamp()}] DEBUG: ${message}`);
    }
}


// ログレベルの設定関数
function setLogLevel(level) {
    currentLogLevel = level;
}

// エクスポート
module.exports = {
    LOG_LEVELS,
    setLogLevel,
    logInfo,
    logOpe,
    logDebug
};


