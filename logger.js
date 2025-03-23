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

// ログ出力関数
function logInfo(message) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
        console.log("INFO:", message);
    }
}

function logDebug(message) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
        console.log("DEBUG:", message);
    }
}

function logOpe(message) {
    if (currentLogLevel >= LOG_LEVELS.OPE) {
        console.log("OPE:", message);
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


