//------------------------------
// atemsettings.js
//   2.3.4
//------------------------------


//初期化
document.addEventListener('DOMContentLoaded', async () => {
    const controlInput    = document.getElementById('atem-control-enable');
    const autoSwitchInput = document.getElementById('atem-auto-switch-enable');
    const ipInput         = document.getElementById('atem-ip');
    const chanInput       = document.getElementById('atem-input');
    const saveBtn         = document.getElementById('save-btn');
    const closeBtn        = document.getElementById('close-btn');
    const ipError         = document.getElementById('ip-error');

    // IP入力は数字とドットのみ
    ipInput.addEventListener('input', () => {
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
          const name = info.productIdentifier
            || info.modelName
            || (info.model !== undefined ? `Model ${info.model}` : '');
          statusDiv.textContent = name;
        } else {
          statusDiv.textContent = result.error
            ? `ATEM Not Found: ${result.error}`
            : 'ATEM Not Found';
        }
      } catch (e) {
        statusDiv.textContent = `ATEM Not Found: ${e.message || ''}`;
      }
    });

    // 初期値読み込み（controlとautoSwitchも含む）
    const cfg = await window.electronAPI.getATEMConfig();
    controlInput.checked    = cfg.control    ?? false;
    autoSwitchInput.checked = cfg.autoSwitch ?? false;
    ipInput.value           = cfg.ip         || '';
    chanInput.value         = cfg.input      || 1;
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
        // control と autoSwitch フラグを含めて保存
        const newCfg = {
            control:    controlInput.checked,
            autoSwitch: autoSwitchInput.checked,
            ip:         ip,
            input:      parseInt(chanInput.value, 10) || 1
        };
        window.electronAPI.setATEMConfig(newCfg);
        window.close();
    });

    // キャンセル
    closeBtn.addEventListener('click', () => {
        window.close();
    });
});
