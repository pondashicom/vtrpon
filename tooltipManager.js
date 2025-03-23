
// -----------------------
//     tooltipManager.js
//     ver 2.2.1
// -----------------------


document.addEventListener('DOMContentLoaded', () => {
    // 初期表示の言語はlocalStorageから（未設定なら英語）
    const currentLang = localStorage.getItem('language') || 'en';
    updateTooltips(currentLang);
});

// preload.js経由で受信（main.jsからの"language-changed"イベント）
if (window.electronAPI && window.electronAPI.onLanguageChanged) {
    window.electronAPI.onLanguageChanged((lang) => {
        updateTooltips(lang);
        localStorage.setItem('language', lang);
    });
}

function updateTooltips(lang) {
    // tooltipsオブジェクトは tooltips.js でグローバルに公開されている前提
    document.querySelectorAll('[data-tooltip-id]').forEach(el => {
        const key = el.getAttribute('data-tooltip-id');
        if (window.tooltips && window.tooltips[lang] && window.tooltips[lang][key]) {
            el.setAttribute('title', window.tooltips[lang][key]);
        }
    });
}
