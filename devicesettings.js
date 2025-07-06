//------------------------------
//  devicesettings.js
//   2.2.8
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
    const devices = await getMediaDevices();
    
    populateAudioSelect(elements.onairAudioSelect, devices.audioOutputs, savedSettings?.onairAudioOutputDevice, true);
    populateAudioSelect(elements.editAudioSelect, devices.audioOutputs, savedSettings?.editAudioMonitorDevice, false, true);
    addAudioSelectionWarnings(elements.editAudioSelect, elements.onairAudioSelect);
    addAudioSelectionWarnings(elements.onairAudioSelect, elements.editAudioSelect);
    
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

    devices.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Audio Output ${device.deviceId}`;
        if (savedDeviceId === device.deviceId) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });

    // `uvcAudioSelect` の場合、規定値を "No Device Selected" にする
    if (!savedDeviceId && addNoneOption) {
        selectElement.value = "";
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
        onairAudioOutputDevice: elements.onairAudioSelect.value
    };

    window.electronAPI.setDeviceSettings(settings);
    window.electronAPI.closeDeviceSettings();
}