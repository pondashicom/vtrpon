// -----------------------
//     labelManager.js
//     ver 2.2.1
// -----------------------

document.addEventListener('DOMContentLoaded', () => {
    // 初期表示の言語はlocalStorageから取得（未設定の場合は'en'）
    const currentLang = localStorage.getItem('language') || 'en';
    updateLabels(currentLang);
});

// preload.js 経由で受信する言語変更イベントがある場合、更新処理を呼び出す
if (window.electronAPI && window.electronAPI.onLanguageChanged) {
    window.electronAPI.onLanguageChanged((lang) => {
        updateLabels(lang);
        localStorage.setItem('language', lang);
    });
}

function updateLabels(lang) {
    // labels オブジェクトは labels.js でグローバルに公開されている前提です
    document.querySelectorAll('[data-label-id]').forEach(el => {
        const key = el.getAttribute('data-label-id');
        if (window.labels && window.labels[lang] && window.labels[lang][key]) {
            el.textContent = window.labels[lang][key];
        }
    });
}
