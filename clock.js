// -----------------------
//     clock.js
//     ver 2.4.8
// -----------------------

// -----------------------
//     clock.js
//     ver 2.4.8
// -----------------------

let timeOffset = 0;  // サーバーとの差分ミリ秒
const TIME_API = 'https://timeapi.io/api/Time/current/zone?timeZone=Etc/UTC';
const DEFAULT_CLOCK_SIZE = 1;
const CLOCK_SIZE_MIN = 0.6;
const CLOCK_SIZE_MAX = 2.4;

// Clock Size を正規化する関数
function normalizeClockSize(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_CLOCK_SIZE;
    }

    return Math.min(
        CLOCK_SIZE_MAX,
        Math.max(
            CLOCK_SIZE_MIN,
            Math.round(numeric * 10) / 10
        )
    );
}

// footer clock のサイズを反映する関数
function applyFooterClockSize(value) {
    const footerClock = document.getElementById('footer-clock');
    if (!footerClock) {
        return;
    }

    const scale = normalizeClockSize(value);

    footerClock.style.fontSize = `${1.5 * scale}em`;
    footerClock.style.padding = `${0.4375 * scale}rem ${1.25 * scale}rem`;
    footerClock.style.borderRadius = `${0.625 * scale}rem`;
    footerClock.style.boxShadow = `0 0.25rem ${0.5 * scale}rem rgba(0, 0, 0, 0.5)`;
    footerClock.style.width = `${13.125 * scale}rem`;
    footerClock.style.letterSpacing = `${0.125 * scale}rem`;
}

// 保存済みの時計サイズを読み込む関数
async function initializeFooterClockSize() {
    try {
        if (window.electronAPI.getPlaylistOnAirSettings) {
            const settings = await window.electronAPI.getPlaylistOnAirSettings();
            applyFooterClockSize(settings?.clockSize);
        }
    } catch (_) {
        applyFooterClockSize(DEFAULT_CLOCK_SIZE);
    }

    if (window.electronAPI.onPlaylistOnAirSettingsUpdated) {
        window.electronAPI.onPlaylistOnAirSettingsUpdated((settings) => {
            applyFooterClockSize(settings?.clockSize);
        });
    }
}

async function syncTime() {
    try {
        const res = await fetch(TIME_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const isoRaw = data.utc_datetime || data.dateTime || data.iso8601;
        if (!isoRaw) throw new Error('No datetime field in response');

        // タイムゾーン情報が付いていない場合は UTC（Z付き）として解釈させる
        const iso = (typeof isoRaw === 'string' && !(/[zZ]$|[+\-]\d\d:\d\d$/.test(isoRaw)))
            ? `${isoRaw}Z`
            : isoRaw;

        const serverUtc = new Date(iso).getTime();
        const localNow = Date.now();
        timeOffset = serverUtc - localNow;

        // 現在のローカルタイムゾーン名とUTCオフセットを取得
        const tzName = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'local';
        const offsetMin = new Date().getTimezoneOffset(); // JSTなら -540
        const sign = offsetMin <= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
        const mm = String(absMin % 60).padStart(2, '0');
        const tzOffsetStr = `UTC${sign}${hh}:${mm}`;

        console.log('[clock.js] Time sync successful. Offset:', timeOffset, 'ms');
        if (typeof showMessage === 'function') {
            showMessage(`Time sync successful. Offset: ${timeOffset} ms (${tzName}, ${tzOffsetStr})`, 3000, 'info');
        }
    } catch (err) {
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
initializeFooterClockSize();

// 起動時と10分ごとに同期
syncTime();
setInterval(syncTime, 10 * 60 * 1000);

// 毎秒更新
setInterval(updateClock, 1000);

// IPC での同期要求を受信
window.electronAPI.onSyncTimeRequest(() => {
  syncTime();
});