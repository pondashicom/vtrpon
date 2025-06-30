// -----------------------
//     renderer.js
//     ver 2.0.0
// -----------------------

// 各レンダラープロセスの共通処理のみ利用

// ----------------------//
//     INFO BOX ALERT    //
// ----------------------//

let showMessageTimeoutId;


// メッセージ表示関数
function showMessage(message, duration = 3000, type = 'success') {
    const messageBox = document.getElementById('info-display');
    if (!messageBox) {
        console.error('messageBox element not found.');
        return;
    }

    // 前回のクリアタイマーがあればキャンセル
    if (showMessageTimeoutId) {
        clearTimeout(showMessageTimeoutId);
    }

    // メッセージ／クラスを設定
    messageBox.textContent = message;
    messageBox.className = `info-display ${type}`;
    if (type === 'info') {
        messageBox.style.color = '#ffffff';
    } else {
        messageBox.style.color = '';
    }

    // 新規タイマーをセット
    showMessageTimeoutId = setTimeout(() => {
        messageBox.textContent = '';
        messageBox.className = 'info-display';
    }, duration);
}
// メインウィンドウの renderer 側で 'screenshot-saved' イベントを受信して showMessage を呼び出す
window.electronAPI.ipcRenderer.on('screenshot-saved', (event, savedPath) => {
    showMessage(`Screenshot saved at:\n${savedPath}`, 5000, 'info');
});

// 録画保存完了通知を受信して showMessage を呼び出す
window.electronAPI.onRecordingSaveNotify((savedPath) => {
    showMessage(getMessage('recording-save-result') + savedPath, 10000, 'info');
});

// info-message イベントを受信して showMessage を呼び出す
window.electronAPI.ipcRenderer.on('info-message', (event, key) => {
    // messages.js のキーを元にテキストを取得
    const text = getMessage(key) || key;
    // タイプ 'info' で表示（5秒間）
    showMessage(text, 5000, 'info');
});

// 使用例
// showMessage('UVCデバイスはエディットエリアで編集できません。', 5000, 'alert'); // 5秒間表示
