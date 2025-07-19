// -----------------------
//     clock.js
//     ver 2.3.7
// -----------------------

let timeOffset = 0;  // サーバーとの差分ミリ秒
const TIME_API = 'https://worldtimeapi.org/api/ip';  // 公開タイムサーバー

async function syncTime() {
    try {
        const res = await fetch(TIME_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const serverUtc = new Date(data.utc_datetime).getTime();
        const localNow = Date.now();
        timeOffset = serverUtc - localNow;
        console.log('[clock.js] Time sync successful. Offset:', timeOffset, 'ms');
        // INFOウィンドウにログと同じ文面を3秒間表示
        if (typeof showMessage === 'function') {
            showMessage(`Time sync successful. Offset: ${timeOffset} ms`, 3000, 'info');
        }
    } catch (err) {
        // 同期失敗時は無視（コンソール警告のみ）
        console.warn('[clock.js] Time sync failed:', err);
    }
}

function updateClock() {
    const now = new Date(Date.now() + timeOffset);
    const formatted = `${String(now.getHours()).padStart(2,'0')}`
                    + `:${String(now.getMinutes()).padStart(2,'0')}`
                    + `:${String(now.getSeconds()).padStart(2,'0')}`;
    document.getElementById('footer-clock').textContent = formatted;
}

// 初期表示
updateClock();

// 起動時と10分ごとに同期
syncTime();
setInterval(syncTime, 10 * 60 * 1000);

// 毎秒更新
setInterval(updateClock, 1000);

// IPC での同期要求を受信
window.electronAPI.onSyncTimeRequest(() => {
  syncTime();
});