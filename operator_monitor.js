// -----------------------
// operator_monitor.js
//     ver 2.6.1
// -----------------------

// 状態表示を更新する関数
function setOperatorMonitorState(state) {
    const fileNameElement = document.getElementById('operator-monitor-filename');
    const remainElement = document.getElementById('operator-monitor-remain');
    const durationElement = document.getElementById('operator-monitor-duration');
    const startModeElement = document.getElementById('operator-monitor-startmode');
    const endModeElement = document.getElementById('operator-monitor-endmode');

    if (!state) {
        return;
    }

    if (fileNameElement) {
        fileNameElement.textContent = state.fileName || 'No file loaded';
    }
    if (remainElement) {
        remainElement.textContent = state.remain || '00:00:00:00';
    }
    if (durationElement) {
        durationElement.textContent = state.duration || '00:00:00:00';
    }
    if (startModeElement) {
        startModeElement.textContent = state.startMode || '-';
    }
    if (endModeElement) {
        endModeElement.textContent = state.endMode || '-';
    }
}

// PGM stream を設定する関数
function setOperatorMonitorStream(stream) {
    const videoElement = document.getElementById('operator-monitor-video');
    const waitingElement = document.getElementById('operator-monitor-waiting');

    if (!videoElement || !stream) {
        return;
    }

    if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
    }

    videoElement.muted = true;

    const playPromise = videoElement.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
    }

    if (waitingElement) {
        waitingElement.style.display = 'none';
    }
}

window.setOperatorMonitorState = setOperatorMonitorState;
window.setOperatorMonitorStream = setOperatorMonitorStream;

document.addEventListener('DOMContentLoaded', () => {
    try {
        if (window.opener && typeof window.opener.onairEnsureOperatorMonitorStream === 'function') {
            const stream = window.opener.onairEnsureOperatorMonitorStream();
            if (stream) {
                setOperatorMonitorStream(stream);
            }
        }
    } catch (_) {}

    try {
        if (window.opener && typeof window.opener.onairGetOperatorMonitorState === 'function') {
            const state = window.opener.onairGetOperatorMonitorState();
            if (state) {
                setOperatorMonitorState(state);
            }
        }
    } catch (_) {}
});