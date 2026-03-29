// -----------------------
//     livemode.js
//     ver 2.6.1
// -----------------------

// ライブモード状態を反映する関数
function applyLiveModeState(enabled) {
    document.body.classList.toggle('live-mode', !!enabled);
}

// ライブモード初期化
document.addEventListener('DOMContentLoaded', async () => {
    if (!window.electronAPI) {
        return;
    }

    try {
        const state = await window.electronAPI.getLiveModeState();
        applyLiveModeState(state && state.enabled);
    } catch (error) {
        console.error('[livemode.js] Failed to get live mode state:', error);
    }

    window.electronAPI.onLiveModeStateChange((event, payload) => {
        applyLiveModeState(payload && payload.enabled);
    });
});