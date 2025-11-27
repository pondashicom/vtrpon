//------------------------------
//  devicesettings.js
//   2.4.8
//------------------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
const logDebug = window.electronAPI.logDebug;

//--------------
// 初期化
//--------------

document.addEventListener('DOMContentLoaded', async () => {
    initializeDeviceSettings();
});

async function initializeDeviceSettings() {
    const elements = getDOMElements();
    if (!elements) return;
    
    const savedSettings = await window.electronAPI.getDeviceSettings();

    // enumerateDevices の前に一度だけ権限を確保（label/deviceId の安定化、NDI仮想マイクの列挙目的）
    try {
        // 映像は開かず、音声デバイスだけ権限ウォームアップすることで起動を軽くする
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach(t => t.stop());
        logDebug('[devicesettings.js] Media permissions warmed up for device enumeration (audio only).');
    } catch (e) {
        logDebug('[devicesettings.js] Media permission warm-up skipped/failed:', e);
    }

    const devices = await getMediaDevices();

    populateAudioSelect(elements.onairAudioSelect, devices.audioOutputs, savedSettings?.onairAudioOutputDevice, true);
    populateAudioSelect(elements.editAudioSelect, devices.audioOutputs, savedSettings?.editAudioMonitorDevice, false, true);
    addAudioSelectionWarnings(elements.editAudioSelect, elements.onairAudioSelect);
    addAudioSelectionWarnings(elements.onairAudioSelect, elements.editAudioSelect);

    const uvcDevices = await getUVCDevicesForSettings();
    buildUvcAudioMappingUI(uvcDevices, devices.audioInputs, savedSettings?.uvcAudioBindings || {});
    
    // 「Restore on next startup」チェックボックスの初期状態を反映
    const restoreInput = document.getElementById('restoreOnStartup');
    if (restoreInput) {
        restoreInput.checked = savedSettings?.restoreOnStartup ?? false;
    }

    // デバイスの読み込みが一通り完了したのでローディングメッセージを消す
    const loadingMessage = document.getElementById('deviceLoadingMessage');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }
    
    elements.okButton.addEventListener('click', () => saveSettings(elements));
}

//--------------
// DOM要素の取得
//--------------

function getDOMElements() {
    const editAudioSelect = document.getElementById('editAudioMonitorDevice');
    const onairAudioSelect = document.getElementById('onairAudioOutputDevice');
    const okButton = document.getElementById('okButton');

    if (!editAudioSelect || !onairAudioSelect || !okButton) {
        logInfo("[devicesettings.js] One or more required elements not found.");
        return null;
    }
    return { editAudioSelect, onairAudioSelect, okButton };
}

//-------------------
// デバイス情報の取得
//-------------------

async function getMediaDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
        audioOutputs: devices.filter(device => device.kind === 'audiooutput'),
        audioInputs: devices.filter(device => device.kind === 'audioinput')
    };
}

// UVC（ビデオ入力）デバイス一覧を取得（UVC用マッピングUI向け）
async function getUVCDevicesForSettings() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
}

async function getDisplayDevices() {
    return await window.electronAPI.getDisplayList();
}

//------------------------
// セレクトボックスの設定
//------------------------

function populateAudioSelect(selectElement, devices, savedDeviceId, isDefault = false, addNoneOption = false) {
    selectElement.innerHTML = "";

    // すべてのデバイスリストに "No Device Selected" を追加する
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No Device Selected";
    selectElement.appendChild(noneOption);

    // ONAIR 用セレクトでは OS のデフォルト出力を明示的な選択肢として追加
    if (isDefault) {
        const defaultOption = document.createElement("option");
        defaultOption.value = "default";
        defaultOption.textContent = "System Default Output";
        selectElement.appendChild(defaultOption);
    }

    let foundSaved = false;

    devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Audio Output ${device.deviceId}`;

        if (savedDeviceId && savedDeviceId === device.deviceId) {
            option.selected = true;
            foundSaved = true;
        }

        selectElement.appendChild(option);
    });

    // 保存された ID に一致するデバイスがなかった場合のフォールバック
    if (!foundSaved) {
        if (isDefault && savedDeviceId === "default") {
            // ONAIR が "default" で保存されている場合は「System Default Output」を選択
            selectElement.value = "default";
        } else if (!savedDeviceId && isDefault) {
            // onair 用など savedDeviceId が空で「何も指定されていない」場合は
            // 最初の実デバイスを選択（従来の挙動）
            if (devices.length > 0) {
                selectElement.value = devices[0].deviceId;
            } else {
                selectElement.value = "";
            }
        } else if (!savedDeviceId && addNoneOption) {
            // UVC マッピングなど、「No Audio」を初期値としたい場合
            selectElement.value = "";
        } else if (savedDeviceId && savedDeviceId !== "default") {
            // savedDeviceId があるが enumerateDevices に出てこない場合は、
            // いったん "No Device Selected" に戻す
            selectElement.value = "";
        }
    }
}

function populateVideoSelect(selectElement, devices, savedDeviceId) {
    selectElement.innerHTML = "";
    devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.id;
        option.textContent = device.label;
        if (savedDeviceId === device.id) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

// UVCデバイスごとの音声マッピングUIを構築
function buildUvcAudioMappingUI(uvcDevices, audioInputs, savedBindings) {
    const container = document.getElementById('uvcAudioMappingContainer');
    if (!container) {
        logInfo("[devicesettings.js] UVC audio mapping container not found.");
        return;
    }

    container.innerHTML = "";

    if (!Array.isArray(uvcDevices) || uvcDevices.length === 0) {
        const info = document.createElement("p");
        info.textContent = "No UVC devices detected.";
        container.appendChild(info);
        return;
    }

    uvcDevices.forEach((uvc) => {
        const row = document.createElement("div");
        row.classList.add("uvc-audio-row");

        const label = document.createElement("span");
        label.classList.add("uvc-audio-label");
        label.textContent = uvc.label || `UVC ${uvc.deviceId}`;

        const select = document.createElement("select");
        select.dataset.uvcDeviceId = uvc.deviceId;

        const noneOption = document.createElement("option");
        noneOption.value = "";
        noneOption.textContent = "No Audio";
        select.appendChild(noneOption);

        audioInputs.forEach((audio) => {
            const option = document.createElement("option");
            option.value = audio.deviceId;
            option.textContent = audio.label || `Audio Input ${audio.deviceId}`;
            select.appendChild(option);
        });

        const savedId = savedBindings[uvc.deviceId];
        if (savedId) {
            select.value = savedId;
        }

        row.appendChild(label);
        row.appendChild(select);
        container.appendChild(row);
    });
}

//-------------------
// 競合防止の警告
//-------------------

function addAudioSelectionWarnings(primarySelect, secondarySelect) {
    primarySelect.addEventListener('change', (event) => {
        const selectedDevice = event.target.value;
        if (selectedDevice === secondarySelect.value && selectedDevice !== "") {
            const confirmMessage = primarySelect.id.includes("edit") ?
                "This device is the same as ONAIR AUDIO OUTPUT DEVICE. Proceed?" :
                "This device is currently selected as PFL output. Proceed?";

            customConfirm(confirmMessage).then((result) => {
                if (!result) {
                    event.target.value = "";
                }
            });
        }
    });
}

//-------------------
// カスタム confirm ダイアログ
//-------------------

function customConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("customConfirmModal");
        const messageElement = document.getElementById("customConfirmMessage");
        const okButton = document.getElementById("confirmOkButton");
        const cancelButton = document.getElementById("confirmCancelButton");

        // メッセージをセット
        messageElement.textContent = message;
        modal.style.display = "flex";

        // OKボタン
        okButton.onclick = () => {
            modal.style.display = "none";
            resolve(true);
        };

        // キャンセルボタン
        cancelButton.onclick = () => {
            modal.style.display = "none";
            resolve(false);
        };
    });
}

//-------------------
// 設定の保存
//-------------------
function saveSettings(elements) {
    const settings = {
        editAudioMonitorDevice: elements.editAudioSelect.value,
        onairAudioOutputDevice: elements.onairAudioSelect.value,
        uvcAudioBindings: {},
        restoreOnStartup: false
    };

    const container = document.getElementById('uvcAudioMappingContainer');
    if (container) {
        const selects = container.querySelectorAll('select[data-uvc-device-id]');
        selects.forEach((sel) => {
            const uvcId = sel.dataset.uvcDeviceId;
            const audioId = sel.value || "";
            if (uvcId) {
                settings.uvcAudioBindings[uvcId] = audioId;
            }
        });
    }

    // 「Restore on next startup」のチェック状態を反映
    const restoreInput = document.getElementById('restoreOnStartup');
    if (restoreInput) {
        settings.restoreOnStartup = !!restoreInput.checked;
    }

    window.electronAPI.setDeviceSettings(settings);
    window.electronAPI.closeDeviceSettings();
}
