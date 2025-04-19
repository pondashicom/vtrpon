//------------------------------
//  recordingSettings.js
//   2.2.9
//------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const prefixInput = document.getElementById('recordingPrefixInput');
  const dirInput = document.getElementById('recordingDirInput');
  const browseBtn = document.getElementById('browseButton');
  const okBtn = document.getElementById('okButton');

  // 保存済み設定を読み込んで初期表示
  const saved = await window.electronAPI.getRecordingSettings();
  prefixInput.value = saved.prefix || '';
  dirInput.value = saved.directory || '';

  // ディレクトリ選択
  browseBtn.addEventListener('click', async () => {
    const selected = await window.electronAPI.showDirectoryDialog();
    if (selected) dirInput.value = selected;
  });

  // OK ボタンで設定を保存してウィンドウを閉じる
  okBtn.addEventListener('click', () => {
    window.electronAPI.setRecordingSettings({
      prefix: prefixInput.value,
      directory: dirInput.value
    });
    window.electronAPI.closeRecordingSettings();
  });
});

// （devicesettings.js と同じカスタム confirm は不要なため省略可）
