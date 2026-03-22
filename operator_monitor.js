// -----------------------
// operator_monitor.js
//     ver 2.6.1
// -----------------------

// OSD を実際の映像表示位置に合わせる関数
function updateOperatorMonitorOsdPosition() {
    const videoElement = document.getElementById('operator-monitor-video');
    const osdElement = document.getElementById('operator-monitor-osd');

    if (!videoElement || !osdElement) {
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const paddingX = 12;
    const paddingY = 12;

    if (viewportWidth <= 0 || viewportHeight <= 0) {
        return;
    }

    let displayLeft = 0;
    let displayTop = 0;

    if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        const srcAspect = videoElement.videoWidth / videoElement.videoHeight;
        const dstAspect = viewportWidth / viewportHeight;

        let displayWidth;
        let displayHeight;

        if (srcAspect > dstAspect) {
            displayWidth = viewportWidth;
            displayHeight = displayWidth / srcAspect;
            displayLeft = 0;
            displayTop = (viewportHeight - displayHeight) / 2;
        } else {
            displayHeight = viewportHeight;
            displayWidth = displayHeight * srcAspect;
            displayLeft = (viewportWidth - displayWidth) / 2;
            displayTop = 0;
        }
    }

    osdElement.style.left = `${Math.round(displayLeft + paddingX)}px`;
    osdElement.style.top = `${Math.round(displayTop + paddingY)}px`;
}

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

    const remainText = state.remain || '00:00:00:00';
    const durationText = state.duration || '00:00:00:00';
    const remainColor = state.remainColor || 'orange';

    if (fileNameElement) {
        fileNameElement.textContent = state.fileName || 'No file loaded';
    }
    if (remainElement) {
        remainElement.textContent = remainText;
        remainElement.style.color = remainColor;
    }
    if (durationElement) {
        durationElement.textContent = durationText;
    }
    if (startModeElement) {
        startModeElement.textContent = state.startMode || '-';
    }
    if (endModeElement) {
        endModeElement.textContent = state.endMode || '-';
    }

    updateOperatorMonitorOsdPosition();
}

// Operator Monitor の映像 stream を設定する関数
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

    updateOperatorMonitorOsdPosition();
}

window.setOperatorMonitorState = setOperatorMonitorState;
window.setOperatorMonitorStream = setOperatorMonitorStream;

document.addEventListener('DOMContentLoaded', () => {
    const videoElement = document.getElementById('operator-monitor-video');

    if (videoElement) {
        videoElement.addEventListener('loadedmetadata', updateOperatorMonitorOsdPosition);
    }

    window.addEventListener('resize', updateOperatorMonitorOsdPosition);
    document.addEventListener('fullscreenchange', updateOperatorMonitorOsdPosition);

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

    updateOperatorMonitorOsdPosition();
});