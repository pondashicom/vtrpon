// -----------------------
//     clock.js
//     ver 2.0.0
// -----------------------

function updateClock() {
    const now = new Date();
    const formattedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    document.getElementById('footer-clock').textContent = `${formattedTime}`;
}

// ページ読み込み時と1秒ごとに時計を更新
setInterval(updateClock, 1000);
updateClock(); // 初期表示
