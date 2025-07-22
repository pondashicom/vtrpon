//------------------------------
// atemsettings.js
//   2.3.7
//------------------------------

// ログ機能の取得
const logInfo = window.electronAPI.logInfo;
const logOpe = window.electronAPI.logOpe;
const logDebug = window.electronAPI.logDebug;

//初期化
document.addEventListener('DOMContentLoaded', async () => {
    const controlInput    = document.getElementById('atem-control-enable');
    const autoSwitchInput = document.getElementById('atem-auto-switch-enable');
    const ipInput         = document.getElementById('atem-ip');
    const chanInput       = document.getElementById('atem-input');
    const delayInput      = document.getElementById('atem-delay');
    const saveBtn         = document.getElementById('save-btn');
    const closeBtn        = document.getElementById('close-btn');
    const ipError         = document.getElementById('ip-error');

    // IP入力は数字とドットのみ
    ipInput.addEventListener('input', () => {
        logOpe(`IP input changed: ${ipInput.value}`);
        ipInput.value = ipInput.value.replace(/[^0-9.]/g, '');
    });

    // IP入力が終わったら存在チェック
    ipInput.addEventListener('blur', async () => {
      const statusDiv = document.getElementById('atem-status');
      statusDiv.textContent = 'Checking…';

      const ip = ipInput.value.trim();
      if (!ip) {
        statusDiv.textContent = '';
        return;
      }

      try {
        const result = await window.electronAPI.checkATEMDevice(ip);
        if (result.found && result.info) {
          const info = result.info;
          // productIdentifier / modelName を表示
          const name = info.productIdentifier || info.modelName;
          if (name) {
            statusDiv.textContent = name;
          } else {
            statusDiv.textContent = 'ATEM Not Found';
          }
        } else {
          statusDiv.textContent = result.error
            ? `ATEM Not Found: ${result.error}`
            : 'ATEM Not Found';
        }
      } catch (e) {
        statusDiv.textContent = `ATEM Not Found: ${e.message || ''}`;
      }
    });

    // 初期値読み込み
    const cfg = await window.electronAPI.getATEMConfig();
    controlInput.checked    = cfg.control    ?? false;
    autoSwitchInput.checked = cfg.autoSwitch ?? false;
    ipInput.value           = cfg.ip         || '';
    chanInput.value         = cfg.input      || 1;
    delayInput.value        = cfg.delay      ?? 0;

    // 次回起動時にも復元チェックの初期化（要素チェック）
    const restoreInput = document.getElementById('restoreOnStartup');
    if (restoreInput) {
        restoreInput.checked = cfg.restoreOnStartup ?? false;
    }

    // チェックボックス変更時のログ出力
    controlInput.addEventListener('change', () => {
        logOpe(`Control toggled: ${controlInput.checked ? 'enabled' : 'disabled'}`);
    });
    autoSwitchInput.addEventListener('change', () => {
        logOpe(`Auto-switch toggled: ${autoSwitchInput.checked ? 'enabled' : 'disabled'}`);
    });
    if (restoreInput) {
        restoreInput.addEventListener('change', () => {
            logOpe(`Restore on startup toggled: ${restoreInput.checked ? 'enabled' : 'disabled'}`);
        });
    }

    ipError.textContent     = '';

    // 保存処理
    saveBtn.addEventListener('click', () => {
        const ip = ipInput.value.trim();
        const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d{1,2})(\.(25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;
        ipError.textContent = '';
        if (!ipv4Pattern.test(ip)) {
            ipError.textContent = 'Enter a valid IPv4 (0?255 per octet)';
            ipInput.focus();
            return;
        }

        const restoreInput    = document.getElementById('restoreOnStartup');
        const restoreChecked  = restoreInput ? restoreInput.checked : false;

        const newCfg = {
            control:           controlInput.checked,
            autoSwitch:        autoSwitchInput.checked,
            ip:                ip,
            input:             parseInt(chanInput.value, 10) || 1,
            delay:             parseInt(delayInput.value, 10) || 0,
            restoreOnStartup:  restoreChecked
        };

        // 常に設定APIを呼び出し（restoreOnStartup フラグで main.js 側が保存／削除を判断）
        window.electronAPI.setATEMConfig(newCfg);
        logOpe(`ATEM config saved: ${JSON.stringify(newCfg)}`);
        window.close();
    });


    // キャンセル
    closeBtn.addEventListener('click', () => {
        logOpe('ATEM settings dialog closed');
        window.close();
    });
});