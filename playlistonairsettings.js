// ------------------------------
//  playlistonairsettings.js
//  ver 2.6.0
// ------------------------------

// デフォルト設定
const DEFAULT_PLAYLIST_ONAIR_SETTINGS = {
    preferAudioAlbumArt: true,
    autoSelectNextAfterOffAir: true,
    disableFtbButton: false,
    ftbButtonFadeSec: 1,
    dskFadeSec: 1,
    restoreOnStartup: false
};

let currentPlaylistOnAirSettings = { ...DEFAULT_PLAYLIST_ONAIR_SETTINGS };

// 言語を取得する関数
function getCurrentModalLanguage() {
    const lang =
        localStorage.getItem('language') ||
        document.documentElement.lang ||
        navigator.language ||
        'ja';

    return String(lang).toLowerCase().startsWith('en') ? 'en' : 'ja';
}

// ラベルを取得する関数
function getLabel(key, fallback) {
    const lang = getCurrentModalLanguage();
    if (typeof labels === 'object' && labels && labels[lang] && labels[lang][key]) {
        return labels[lang][key];
    }
    return fallback;
}

// ラベルを反映する関数
function applyLabels() {
    document.getElementById('playlistSectionTitle').textContent = getLabel('playlist-onair-section-playlist', 'PLAYLIST');
    document.getElementById('preferAudioAlbumArtLabel').textContent = getLabel('playlist-onair-prefer-album-art-label', 'Prefer album art for audio thumbnails');
    document.getElementById('autoSelectNextAfterOffAirLabel').textContent = getLabel('playlist-onair-auto-select-next-label', 'Auto-select next item after Off-Air');
    document.getElementById('restoreOnStartupLabel').textContent = getLabel('playlist-onair-restore-on-startup-label', 'Restore on next startup');
    document.getElementById('okButton').textContent = getLabel('playlist-onair-ok-button', 'OK');
}

// 設定をDOMへ反映する関数
function applySettingsToDom(settings) {
    const merged = {
        ...DEFAULT_PLAYLIST_ONAIR_SETTINGS,
        ...(settings || {})
    };

    currentPlaylistOnAirSettings = { ...merged };

    document.getElementById('preferAudioAlbumArt').checked = !!merged.preferAudioAlbumArt;
    document.getElementById('autoSelectNextAfterOffAir').checked = !!merged.autoSelectNextAfterOffAir;
    document.getElementById('restoreOnStartup').checked = !!merged.restoreOnStartup;
}

// 設定を保存する関数
function saveSettings() {
    const settings = {
        ...currentPlaylistOnAirSettings,
        preferAudioAlbumArt: document.getElementById('preferAudioAlbumArt').checked,
        autoSelectNextAfterOffAir: document.getElementById('autoSelectNextAfterOffAir').checked,
        restoreOnStartup: document.getElementById('restoreOnStartup').checked
    };

    window.electronAPI.setPlaylistOnAirSettings(settings);
    window.electronAPI.closePlaylistOnAirSettings();
}

// 初期化する関数
async function initializePlaylistOnAirSettings() {
    applyLabels();

    try {
        const settings = await window.electronAPI.getPlaylistOnAirSettings();
        applySettingsToDom(settings);
    } catch (_) {
        applySettingsToDom(DEFAULT_PLAYLIST_ONAIR_SETTINGS);
    }

    document.getElementById('okButton').addEventListener('click', saveSettings);

    if (window.electronAPI.onLanguageChanged) {
        window.electronAPI.onLanguageChanged(() => {
            applyLabels();
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializePlaylistOnAirSettings();
});