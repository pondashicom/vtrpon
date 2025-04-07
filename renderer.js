// -----------------------
//     renderer.js
//     ver 2.0.0
// -----------------------

// 各レンダラープロセスの共通処理のみ利用

// ----------------------//
//     INFO BOX ALERT    //
// ----------------------//

function showMessage(message, duration = 3000, type = 'success') {
    const messageBox = document.getElementById('info-display');

    if (!messageBox) {
        console.error('messageBox element not found.');
        return;
    }

    // メッセージを設定
    messageBox.textContent = message;

    // クラスをリセットして新しいタイプを追加
    messageBox.className = `info-display ${type}`;

    // 表示する際、type が 'info' なら文字色を白に設定
    if (type === 'info') {
        messageBox.style.color = '#ffffff';
    } else {
        messageBox.style.color = '';
    }

    // 一定時間後にリセット
    setTimeout(() => {
        // メッセージを消す
        messageBox.textContent = '';  // テキストをクリア
        messageBox.className = 'info-display'; // クラスを初期状態に戻す
    }, duration);

}

// メインウィンドウの renderer 側で 'screenshot-saved' イベントを受信して showMessage を呼び出す
window.electronAPI.ipcRenderer.on('screenshot-saved', (event, savedPath) => {
    showMessage(`Screenshot saved at:\n${savedPath}`, 5000, 'info');
});


// 使用例
// showMessage('UVCデバイスはエディットエリアで編集できません。', 5000, 'alert'); // 5秒間表示
