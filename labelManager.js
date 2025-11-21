// -----------------------
//     labelManager.js
//     ver 2.4.7
// -----------------------

document.addEventListener('DOMContentLoaded', () => {
    // 初期表示の言語は localStorage 優先、無ければ html.lang を見る（ja/en）
    const storedLang = localStorage.getItem('language');
    const htmlLang = document.documentElement.lang || '';
    const detectedLang = htmlLang.toLowerCase().startsWith('en') ? 'en' : 'ja';
    const currentLang = storedLang || detectedLang || 'en';

    window.currentLanguage = currentLang;
    updateLabels(currentLang);
});

// preload.js 経由で受信する言語変更イベントがある場合、更新処理を呼び出す
if (window.electronAPI && window.electronAPI.onLanguageChanged) {
    window.electronAPI.onLanguageChanged((lang) => {
        setLanguage(lang);
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

// 現在言語でラベル文字列を返す（無ければ fallback）
function getLabelInternal(labelId, fallback = null) {
    try {
        const lang = window.currentLanguage || localStorage.getItem('language') || 'en';
        if (window.labels && window.labels[lang] && window.labels[lang][labelId]) {
            return window.labels[lang][labelId];
        }
    } catch (e) {
    }
    return fallback;
}

// 言語切り替え本体
function setLanguage(lang) {
    const normalized = String(lang).toLowerCase().startsWith('en') ? 'en' : 'ja';
    window.currentLanguage = normalized;
    document.documentElement.lang = normalized;
    localStorage.setItem('language', normalized);
    updateLabels(normalized);
}

// 他のJSから呼べるように公開（既にあれば上書きしない）
if (typeof window.setLanguage !== 'function') {
    window.setLanguage = setLanguage;
}
if (typeof window.getLabel !== 'function') {
    window.getLabel = getLabelInternal;
}

