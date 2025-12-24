// -----------------------
//     main.js
//     ver 2.5.1
// -----------------------

// ---------------------
// 初期設定
// ---------------------

const { app, BrowserWindow, ipcMain, dialog, protocol, Menu, globalShortcut, session, shell, powerSaveBlocker, nativeImage } = require('electron');
let screen;

app.setName('VTR-PON2');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
let ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs');
const statecontrol = require('./statecontrol.js');
const fixWebmDuration = require('fix-webm-duration');
const { Atem } = require('atem-connection');
const { exec } = require('child_process');

let mainWindow, fullscreenWindow, deviceSettingsWindow, recordingSettingsWindow, atemSettingsWindow;
let isDebugMode = false;
let playlistState = [];
let powerSaveBlockerId;
let isRecordingSaving = false;
let shouldQuitAfterSave = false;
let ignoreAtemEvent = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[main.js] Another instance is already running. Exiting.');
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 既存のメインウィンドウにフォーカスを移す
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// ffmpeg とffprobe のパス指定
const fixAsar = (p) => (p && p.includes('app.asar')) ? p.replace('app.asar', 'app.asar.unpacked') : p;

// ffmpeg（ffmpeg-static を使用）
let ffmpegPath = fixAsar(ffmpegStatic);
if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(path.normalize(ffmpegPath));
} else {
    console.error('[main.js] ffmpeg not found via ffmpeg-static:', ffmpegPath);
}

// ffprobe（ffprobe-static を使用）
let ffprobePath = fixAsar(ffprobeStatic.path);
if (ffprobePath && fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(path.normalize(ffprobePath));
} else {
    console.error('[main.js] ffprobe not found via ffprobe-static:', ffprobePath);
}

// 設定ファイルの読み込み
function loadConfig() {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            console.error('[main.js] Failed to parse config.json:', e);
            return {};
        }
    } else {
        return {};
    }
}

// 設定ファイルの保存
function saveConfig(config) {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('[main.js] Failed to save config.json:', e);
    }
}

// ---------------------
// ATEM読み込み関連
// ---------------------

// ATEM 設定取得
ipcMain.handle('get-atem-config', (event) => {
    const config = loadConfig();
    const persisted = config.atem;
    // 永続化設定があって restoreOnStartup=true のときのみ返却
    if (persisted && persisted.restoreOnStartup) {
        return persisted;
    }
    // それ以外はデフォルト（復元OFF）
    return {
        control:            false,
        autoSwitch:         false,
        ip:                  '',
        input:               1,
        delay:               0,
        restoreOnStartup:    false
    };
});

// ATEM 設定保存 ＆ 機能ON/OFFを即時反映
ipcMain.on('set-atem-config', async (event, atemConfig) => {
    // 設定永続化（restoreOnStartup が true のときのみ保存、false のときは削除）
    const config = loadConfig();
    if (atemConfig.restoreOnStartup) {
        config.atem = atemConfig;
    } else {
        delete config.atem;
    }
    saveConfig(config);

    // VTR-PON→ATEM制御のON/OFF
    if (atemConfig.control && atemConfig.ip) {
        await prepareAtemControl(atemConfig.ip);
    } else {
        disableAtemControl();
    }

    // ATEM→VTR-PON自動オンエアのON/OFF
    if (atemConfig.autoSwitch && atemConfig.ip) {
        await startATEMMonitor(atemConfig.ip);
    } else {
        stopATEMMonitor();
    }
});

// ATEM 存在チェック
ipcMain.handle('check-atem-device', async (event, ip) => {
  const atem = new Atem();
  try {
    // 1) ATEM に接続
    await atem.connect(ip);

    // 2) Info イベントを待つ（最大 1 秒でタイムアウト）
    const info = await new Promise(resolve => {
      const timeout = setTimeout(() => {
        // タイムアウト時は現在の state.info を返す
        resolve(atem.state.info || {});
      }, 1000);

      // ATEM-Connection が受け取る Info パケット
      atem.once('info', data => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    // 3) 切断
    atem.disconnect();

    return { found: true, info };
  } catch (error) {
    console.error('[main.js] ATEM connect error:', error);
    return { found: false, error: error.message };
  }
});

// ---------------------
// 更新の確認
// ---------------------

function initUpdateCheck() {
    function fetchVersionInfo() {
        const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
        const versionCSVUrl = 'https://docs.google.com/spreadsheets/d/1j8OPEgq_hzeHKwDTKPlXKM-PSQpT3QiofrOsn6hnBSE/export?format=csv';
        const Papa = require('papaparse');

        return fetch(versionCSVUrl)
            .then(response => response.ok ? response.text() : Promise.reject(`HTTP error: ${response.status}`))
            .then(csvText => Papa.parse(csvText, { header: true, skipEmptyLines: true }).data)
            .catch(error => {
                console.error('[Update Check] Version info error:', error);
                return null;
            });
    }

    function compareVersions(v1, v2) {
        const a = v1.split('.').map(Number);
        const b = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const diff = (a[i] || 0) - (b[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    function getUpdateDialogLabels() {
        if (global.currentLanguage === 'ja') {
            return {
                downloadButton: '新バージョンのダウンロード',
                cancelButton: 'キャンセル',
                title: 'アップデートのお知らせ',
                upToDateTitle: 'アップデート確認',
                upToDateMessage: '現在のバージョンは最新です。',
                noInfoMessage: 'バージョン情報を取得できませんでした。'
            };
        } else {
            return {
                downloadButton: 'Download New Version',
                cancelButton: 'Cancel',
                title: 'Update Available',
                upToDateTitle: 'Update Check',
                upToDateMessage: 'Your version is up to date.',
                noInfoMessage: 'Unable to retrieve version information.'
            };
        }
    }

    function showUpdateDialog(latestInfo) {
        const labels = getUpdateDialogLabels();

        // 言語に応じてアップデート内容を取得
        const updateDetails = global.currentLanguage === 'ja'
            ? latestInfo['Update Contents (JA)'] || '情報なし'
            : latestInfo['Update Contents (EN)'] || 'No information';

        const options = {
            type: 'info',
            buttons: [labels.downloadButton, labels.cancelButton],
            title: labels.title,
            message: global.currentLanguage === 'ja'
                ? `新しいバージョン (${latestInfo['Version']}) が利用可能です。`
                : `A new version (${latestInfo['Version']}) is available.`,
            detail: global.currentLanguage === 'ja'
                ? `リリース日: ${latestInfo['Release Date'] || '不明'}\n更新内容\n${updateDetails}`
                : `Release Date: ${latestInfo['Release Date'] || 'Unknown'}\nUpdate Details\n${updateDetails}`
        };

        dialog.showMessageBox(mainWindow, options).then(result => {
            if (result.response === 0) {
                // macOS の場合だけ専用 URL を使い、その他は従来の Download URL を使用
                const downloadUrl = process.platform === 'darwin'
                    ? latestInfo['Download URL (mac)']
                    : latestInfo['Download URL'];
                shell.openExternal(downloadUrl);
            }
        });
    }

    function checkForUpdates() {
        fetchVersionInfo().then(dataRows => {
            if (!dataRows || dataRows.length === 0) return;
            const latestInfo = dataRows[dataRows.length - 1];

            if (compareVersions(app.getVersion(), latestInfo['Version']) < 0) {
                showUpdateDialog(latestInfo);
            }
        });
    }

    function checkForUpdatesFromMenu() {
        fetchVersionInfo().then(dataRows => {
            const labels = getUpdateDialogLabels();
            if (!dataRows || dataRows.length === 0) {
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    buttons: ['OK'],
                    title: labels.upToDateTitle,
                    message: labels.noInfoMessage
                });
                return;
            }

            const latestInfo = dataRows[dataRows.length - 1];

            if (compareVersions(app.getVersion(), latestInfo['Version']) < 0) {
                showUpdateDialog(latestInfo);
            } else {
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    buttons: ['OK'],
                    title: labels.upToDateTitle,
                    message: labels.upToDateMessage,
                    detail: `${labels.upToDateMessage}: ${app.getVersion()}`
                });
            }
        });
    }

    return { checkForUpdates, checkForUpdatesFromMenu };
}

// `initUpdateCheck()` を関数定義の後に呼び出す
const { checkForUpdates, checkForUpdatesFromMenu } = initUpdateCheck();

// ---------------------
// メニューの生成
// ---------------------

// 既定の言語を設定（設定ファイルから読み込み。未設定の場合は英語をデフォルトに）
const config = loadConfig();
global.currentLanguage = config.language || 'en';

// メニュー生成
function buildMenuTemplate(labels) {
  const isMac = process.platform === 'darwin';
  const opt = isMac ? 'Option' : 'Alt';
  const cmd = isMac ? 'Command' : 'Control';

  return [
    {
      label: labels["menu-file"],
      submenu: [
        {
          label: labels["menu-add-file"],
          accelerator: `${cmd}+F`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'add-file');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-export-playlist"],
          accelerator: `${cmd}+E`,
          click: () => {
            mainWindow.webContents.send('export-playlist');
          }
        },
        {
          label: labels["menu-import-playlist"],
          accelerator: `${cmd}+I`,
          click: () => {
            mainWindow.webContents.send('import-playlist');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-device-settings"],
          click: () => {
            createDeviceSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-recording-settings"],
          click: () => {
            createRecordingSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-tools-atem-connection"],
          click: () => {
            createAtemSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-language"],
          submenu: [
            {
              label: labels["menu-language-english"] || "English",
              type: 'radio',
              checked: global.currentLanguage === 'en',
              click: () => {
                if (global.currentLanguage === 'en') return;

                global.currentLanguage = 'en';

                // 既存の設定を保持したまま language だけ更新
                const cfg = loadConfig();
                cfg.language = 'en';
                saveConfig(cfg);

                BrowserWindow.getAllWindows().forEach(win => {
                  win.webContents.send('language-changed', 'en');
                });
                rebuildMenu();
                console.log('[main.js] Language changed to English.');
              }
            },
            {
              label: labels["menu-language-japanese"] || "Japanese",
              type: 'radio',
              checked: global.currentLanguage === 'ja',
              click: () => {
                if (global.currentLanguage === 'ja') return;

                global.currentLanguage = 'ja';

                // 既存の設定を保持したまま language だけ更新
                const cfg = loadConfig();
                cfg.language = 'ja';
                saveConfig(cfg);

                BrowserWindow.getAllWindows().forEach(win => {
                  win.webContents.send('language-changed', 'ja');
                });
                rebuildMenu();
                console.log('[main.js] Language changed to Japanese.');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: labels["menu-exit"],
          accelerator: `${cmd}+Q`,
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: labels["menu-edit"],
      submenu: [
        {
          label: labels["menu-toggle-start-mode"],
          accelerator: `${opt}+S`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'toggle-start-mode');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-end-mode-off"],
          accelerator: `${opt}+O`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'end-mode-off');
          }
        },
        {
          label: labels["menu-end-mode-pause"],
          accelerator: `${opt}+P`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'end-mode-pause');
          }
        },
        {
          label: labels["menu-end-mode-repeat"],
          accelerator: `${opt}+R`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'end-mode-repeat');
          }
        },
        {
          label: labels["menu-end-mode-next"],
          accelerator: `${opt}+N`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'end-mode-next');
          }
        },
        {
          label: labels["menu-end-mode-ftb"],
          accelerator: `${opt}+F`,
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            mainWindow.webContents.send('shortcut-trigger', 'set-ftb-enabled', { enabled: menuItem.checked });
          }
        },
        {
          label: labels["menu-reset-edit-area"],
          accelerator: 'Right',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'reset-edit-area');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-set-in-point"],
          accelerator: `Shift+${opt}+I`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'in-point');
          }
        },
        {
          label: labels["menu-set-out-point"],
          accelerator: `Shift+${opt}+O`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'out-point');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-copy-item-state"],
          accelerator: `${cmd}+C`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'copy-item-state');
          }
        },
        {
          label: labels["menu-paste-item-state"],
          accelerator: `${cmd}+V`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'paste-item-state');
          }
        }
      ]
    },
    {
      label: labels["menu-playlist"],
      submenu: [
        {
          label: labels["menu-playlist1"],
          accelerator: `${cmd}+1`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '1');
          }
        },
        {
          label: labels["menu-playlist2"],
          accelerator: `${cmd}+2`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '2');
          }
        },
        {
          label: labels["menu-playlist3"],
          accelerator: `${cmd}+3`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '3');
          }
        },
        {
          label: labels["menu-playlist4"],
          accelerator: `${cmd}+4`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '4');
          }
        },
        {
          label: labels["menu-playlist5"],
          accelerator: `${cmd}+5`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '5');
          }
        },
        {
          label: labels["menu-playlist6"],
          accelerator: `${cmd}+6`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '6');
          }
        },
        {
          label: labels["menu-playlist7"],
          accelerator: `${cmd}+7`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', '7');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-save-mode"],
          accelerator: `${cmd}+S`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'save');
          }
        },
        {
          label: labels["menu-delete-mode"],
          accelerator: `${cmd}+D`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'delete');
          }
        },
        {
          label: labels["menu-clear-playlist"],
          accelerator: `${cmd}+K`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'clear');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-select-item-up"],
          accelerator: 'Up',
          enabled: false
        },
        {
          label: labels["menu-select-item-down"],
          accelerator: 'Down',
          enabled: false
        }
      ]
    },
    {
      label: labels["menu-on-air"],
      submenu: [
        {
          label: labels["menu-on-air"],
          accelerator: 'Shift+Enter',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+Enter');
          }
        },
        {
          label: labels["menu-off-air"],
          accelerator: 'Esc',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Esc');
          }
        },
        {
          label: labels["menu-ftb"],
          accelerator: 'Shift+F',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+F');
          }
        },
        {
          label: labels["menu-play-pause"],
          accelerator: 'Space',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Space');
          }
        },
        {
          label: labels["menu-audio-fade-in"],
          accelerator: `${cmd}+,`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', `${cmd}+,`);
          }
        },
        {
          label: labels["menu-audio-fade-out"],
          accelerator: `${cmd}+.`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', `${cmd}+.`);
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-capture-fullscreen"],
          accelerator: 'Shift+S',
          click: () => {
            if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
              fullscreenWindow.webContents.send('capture-screenshot');
              console.log('[main.js] Menu: Capture Screenshot triggered.');
            } else {
              console.log('[main.js] Menu: Fullscreen window not available.');
            }
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-recording-toggle"],
          accelerator: 'Shift+R',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+R');
            console.log('[main.js] Menu: Recording Toggle triggered.');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-dsk-toggle"],
          accelerator: 'Shift+D',
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+D');
          }
        }
      ]
    },
    {
      label: labels["menu-mode"],
      submenu: [
        {
          label: labels["menu-list-mode-repeat"],
          accelerator: `${cmd}+R`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'repeat');
          }
        },
        {
          label: labels["menu-list-mode-list"],
          accelerator: `${cmd}+L`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'list');
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-direct-mode"],
          accelerator: `Shift+${opt}+D`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+Alt+D');
          }
        },
        {
          label: labels["menu-soundpad-mode"],
          accelerator: `Shift+${opt}+S`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+Alt+S');
          }
        },
        {
          label: labels["menu-fillkey-mode"],
          accelerator: `Shift+${opt}+F`,
          click: () => {
            mainWindow.webContents.send('shortcut-trigger', 'Shift+Alt+F');
          }
        }
      ]
    },
    {
      label: labels["menu-window"],
      submenu: [
        {
          label: labels["menu-debug-mode"],
          accelerator: 'F10',
          click: () => {
            isDebugMode = !isDebugMode;
            toggleDebugMode(isDebugMode);
          }
        },
        {
          label: labels["menu-fullscreen"],
          accelerator: 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
        {
          label: labels["menu-move-fullscreen"],
          accelerator: `${opt}+W`,
          click: () => {
            moveFullscreenToNextDisplay();
          }
        },
        {
          label: labels["menu-fullscreen-toggle-minimize-maximize"],
          click: () => {
            if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
              if (fullscreenWindow.isMinimized()) {
                fullscreenWindow.restore();
              } else {
                fullscreenWindow.minimize();
              }
            }
          }
        }
      ]
    },
    {
      label: labels["menu-tools"],
      submenu: [
        {
          label: 'Clock Sync',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync-time');
            }
          }
        },
        { type: 'separator' },
        {
          label: labels["menu-tools-testpattern"],
          submenu: [
            {
              label: labels["menu-tools-generate-smpte-bars"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'smpte' });
                }
              }
            },
            {
              label: labels["menu-tools-generate-checker"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'checker' });
                }
              }
            },
            {
              label: labels["menu-tools-generate-grid"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'grid' });
                }
              }
            },
            {
              label: labels["menu-tools-generate-gray"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'gray' });
                }
              }
            },
            {
              label: labels["menu-tools-generate-pink"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'pink' });
                }
              }
            },
            {
              label: labels["menu-tools-generate-1khz-tone"],
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tools-generate-testpattern', { type: 'tone' });
                }
              }
            }
          ]
        }
      ]
    },
    {
      label: labels["menu-help"],
      submenu: [
        {
          label: labels["menu-check-update"],
          click: () => {
            if (typeof checkForUpdatesFromMenu === "function") {
              checkForUpdatesFromMenu();
            } else {
              console.error("[main.js] checkForUpdatesFromMenu is not defined.");
            }
          }
        },
        {
          label: labels["menu-about"],
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: `VTR-PON 2 \nVersion: ${app.getVersion()}\nCopyright (c) 2024-2025 Tetsu Suzuki All Rights Reserved.\n\nThis project "VTR-PON 2" is distributed under the terms of the GNU General Public License
Version 3 (or, at your option, any later version). The entire distribution (both source code and executable binaries) is subject to the GPL.`,
              buttons: ['OK']
            });
          }
        },
        {
          label: labels["menu-readme"],
          click: () => {
            shell.openExternal('https://pondashi.com/vtrpon/');
          }
        }
      ]
    }
  ];
}


// 初期メニューの生成
const initialLabels = require('./labels.js')[global.currentLanguage];
const menuTemplate = buildMenuTemplate(initialLabels);
Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

// メニュー再構築用関数
function rebuildMenu() {
    const updatedLabels = require('./labels.js')[global.currentLanguage];
    const newMenuTemplate = buildMenuTemplate(updatedLabels);
    Menu.setApplicationMenu(Menu.buildFromTemplate(newMenuTemplate));
}

// ---------------------
// ウインドウ生成
// ---------------------

// 操作ウインドウの生成
const LAYOUT_W = 1920;  // レイアウト上の横(pt)
const LAYOUT_H = 1080;  // レイアウト上の縦(pt)

// アイコン設定
const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, 'assets/icons/icon_256x256.png')
    : path.join(__dirname, 'assets/icons/icon.ico');

function createMainWindow() {
  // 1. ディスプレイ情報を取得
  const disp = screen.getPrimaryDisplay();
  const physW = disp.size.width;            // 物理ピクセル幅
  const physH = disp.size.height;           // 物理ピクセル高
  const scaleFactor = disp.scaleFactor;     // DPI 拡大率
  const workArea = disp.workArea;           // ワークエリア（DIP）
  const WA_W = workArea.width;
  const WA_H = workArea.height;

  // 2. 基本ズーム係数
  //    ・物理解像度が 1920×1080 のときは、DPI スケールを無視（常に1倍）
  //    ・それ以外は scaleFactor を使う
  const baseZoom = (physW === LAYOUT_W && physH === LAYOUT_H)
                  ? 1
                  : scaleFactor;

  // 3. “pt → px” による理想サイズ（DIP ではなく「pt×scaleFactor」でのピクセル）
  const idealPxW = Math.round(LAYOUT_W * baseZoom);
  const idealPxH = Math.round(LAYOUT_H * baseZoom);

  // 4. ワークエリアに収まる縮小係数
  const fitRatioW = WA_W / idealPxW;
  const fitRatioH = WA_H / idealPxH;
  //  拡大を防ぐため Math.min(1, ...)
  const fitZoom = Math.min(1, fitRatioW, fitRatioH);

  // 5. 最終的なウインドウズームとウインドウサイズ
  const finalZoom = baseZoom * fitZoom;
  const winPxW   = Math.round(LAYOUT_W * finalZoom);
  const winPxH   = Math.round(LAYOUT_H * finalZoom);

  // 6. 画面中央にオフセット
  const offsetX = Math.floor((WA_W - winPxW) / 2) + workArea.x;
  const offsetY = Math.floor((WA_H - winPxH) / 2) + workArea.y;

  // 7. BrowserWindow の生成
  mainWindow = new BrowserWindow({
    x: offsetX,
    y: offsetY,
    width: winPxW,
    height: winPxH,
    icon: iconPath,
    useContentSize: true,   // 内部コンテンツは pt 単位で LAYOUT_W×LAYOUT_H
    resizable: true,
    maximizable: true,
    backgroundColor: '#222',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  if (process.platform === 'darwin') {
      app.dock.setIcon(iconPath);
  }

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow.isDestroyed()) return;
    // 8. コンテンツ自体も同じズーム
    mainWindow.webContents.setZoomFactor(finalZoom);

    // 9. フォントサイズは15pxに固定
    mainWindow.webContents.insertCSS(`html { font-size: 15px !important; }`);

    // 言語通知とタイトル
    mainWindow.webContents.send('language-changed', global.currentLanguage);
    mainWindow.setTitle(`VTR-PON2  ver.${app.getVersion()}`);
  });

    mainWindow.on('closed', () => {
        // 操作ウインドウを閉じたら全ての動作を停止・終了

        // 1) フルスクリーンウインドウが残っていれば閉じる
        if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
            fullscreenWindow.close();
        }

        // 2) powerSaveBlocker を停止
        if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
            powerSaveBlocker.stop(powerSaveBlockerId);
        }

        // 3) ATEM 監視・制御を停止
        stopATEMMonitor();
        disableAtemControl();

        // 4) アプリ全体を終了
        app.quit();
    });

  return mainWindow;
}

// フルスクリーンウインドウの生成
function createFullscreenWindow() {
    const displays = screen.getAllDisplays();
    const externalDisplay = displays.find((display) => display.bounds.x !== 0 || display.bounds.y !== 0);
    const target = externalDisplay || displays[0];

    // mac
    const isMac = process.platform === 'darwin';

    fullscreenWindow = new BrowserWindow({
        fullscreen: isMac ? false : true, 
        frame: isMac ? false : undefined, 
        backgroundColor: '#000', 
        x: isMac ? undefined : target.bounds.x, 
        y: isMac ? undefined : target.bounds.y,
        fullscreenable: isMac ? false : true, 
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false
        }
    });

    fullscreenWindow.loadFile('fullscreen.html');
    fullscreenWindow.setMenuBarVisibility(false);

    if (isMac) {
        macEnterFakeFullscreen(fullscreenWindow, target);
        fullscreenWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    // win/linux
    fullscreenWindow.on('closed', () => {
        fullscreenWindow = null; // フルスクリーンウィンドウが閉じられたらリセット
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}

// registerSafeFileProtocol を定義
function registerSafeFileProtocol() {
    protocol.registerFileProtocol('safe', (request, callback) => {
        const url = request.url.replace(/^safe:/, '');
        callback({ path: path.normalize(url) });
    });
    console.log('[main.js] Safe file protocol registered.');
}

// アプリが準備完了したときの処理
app.whenReady().then(async () => {
    screen = require('electron').screen;

    // macOS の Dock アイコンを NativeImage 経由で設定
    if (process.platform === 'darwin') {
        const dockIcon = nativeImage.createFromPath(iconPath);
        if (!dockIcon.isEmpty()) {
            app.dock.setIcon(dockIcon);
        }
    }

    const displays = screen.getAllDisplays();

    // スクリーンセーバーやディスプレイスリープを防止するために powerSaveBlocker を開始
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('[main.js] powerSaveBlocker started with id:', powerSaveBlockerId);

    // キャッシュとローカルストレージをクリア
    session.defaultSession.clearStorageData({
        storages: ['localstorage', 'caches'],
    }).then(() => {
        console.log('[main.js] Cache and local storage cleared.');
    });

    // ATEM設定を読み込んでフラグを取得
    const cfg = loadConfig().atem || { control: false, autoSwitch: false, ip: '', input: 1 };

    // VTR-PON→ATEM制御がONならコマンド送信用に接続
    if (cfg.control && cfg.ip) {
        await prepareAtemControl(cfg.ip);
    }

    // ATEM→VTR-PON自動オンエアがONなら監視開始
    if (cfg.autoSwitch && cfg.ip) {
        await startATEMMonitor(cfg.ip);
    }

    // 録画設定の読み込み・初期化
    const config = loadConfig();
    const recordingConfig = config.recording || {};
    const recordingDir = recordingConfig.directory || path.join(app.getPath('pictures'), 'vtrpon-recordeing');
    const recordingPrefix = recordingConfig.prefix || '';
    const recordingBitrate = recordingConfig.videoBitsPerSecond || 8000000; 
    if (!fs.existsSync(recordingDir)) {
        fs.mkdirSync(recordingDir, { recursive: true });
    }
    config.recording = {
        directory:            recordingDir,
        prefix:               recordingPrefix,
        videoBitsPerSecond:   recordingBitrate
    };
    saveConfig(config);
    global.recordingConfig = config.recording;
    console.log('[main.js] Recording settings loaded:', global.recordingConfig);

    // プレイリスト保存ファイルを削除
    removeOldPlaylistFile();

    // アプリ起動時のデフォルトデバイス設定を読み込む
    let defaultFullscreenVideoOutputDevice = null;
    if (displays.length >= 2) {
        // OSの第二出力が存在する場合はそのディスプレイをデフォルトにする
        defaultFullscreenVideoOutputDevice = displays[1].id;
    } else if (displays.length === 1) {
        // ディスプレイが1つの場合はそのディスプレイを使用する
        defaultFullscreenVideoOutputDevice = displays[0].id;
    }

    // 既存の config から deviceSettings を読み出し、なければデフォルトを使う
    const appConfig = loadConfig();
    const savedDeviceSettings = appConfig.deviceSettings || {};

    global.deviceSettings = {
        editAudioMonitorDevice:
            savedDeviceSettings.editAudioMonitorDevice ?? "non-default",   // 既存設定 or デフォルト
        onairAudioOutputDevice:
            savedDeviceSettings.onairAudioOutputDevice ?? "default",       // 既存設定 or デフォルト
        fullscreenVideoOutputDevice:
            savedDeviceSettings.fullscreenVideoOutputDevice ?? defaultFullscreenVideoOutputDevice,
        // UVC 用の音声マッピング（複数デバイス対応）
        uvcAudioBindings:
            savedDeviceSettings.uvcAudioBindings || {}
    };
    console.log('[main.js] Initial device setup:', global.deviceSettings);

    // ウインドウ初期化を実行
    createFullscreenWindow();

    createMainWindow();
    registerSafeFileProtocol();

    // mac 前面復帰時に擬似フルスクリーンを再適用
    app.on('activate', () => {
        if (process.platform !== 'darwin') return;
        if (!fullscreenWindow || fullscreenWindow.isDestroyed()) return;

        const displays2 = screen.getAllDisplays();
        const target2 = displays2.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || displays2[0];
        macEnterFakeFullscreen(fullscreenWindow, target2);
    });

    // mac ディスプレイ構成変化で再適用
    if (process.platform === 'darwin') {
        const reenterFakeFS = () => {
            if (!fullscreenWindow || fullscreenWindow.isDestroyed()) return;
            const displays3 = screen.getAllDisplays();

            // 外部ディスプレイが無くなった（1枚になった）ら即退避
            if (displays3.length < 2) {
                collapseFullscreenSafely();   // ← 追加（下の #2 で定義）
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.focus();
                }
                return;
            }

            // 設定で希望の出力先があれば優先
            const preferId = (global.deviceSettings && global.deviceSettings.fullscreenVideoOutputDevice) || null;
            const target3 =
                displays3.find(d => d.id === preferId) ||
                displays3.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) ||
                displays3[0];

            macEnterFakeFullscreen(fullscreenWindow, target3);
        };
        screen.on('display-added', reenterFakeFS);
        screen.on('display-removed', reenterFakeFS);
        screen.on('display-metrics-changed', reenterFakeFS);
    }

    // ディスプレイが1枚の場合、mainWindow を親にしてモーダルでダイアログを表示
    if (displays.length < 2) {
        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: messages[global.currentLanguage]["single-display-dialog-title"],
            message: messages[global.currentLanguage]["single-display-dialog-message"],
            buttons: [
                messages[global.currentLanguage]["single-display-dialog-button-continue"],
                messages[global.currentLanguage]["single-display-dialog-button-exit"]
            ],
            defaultId: 0,
            cancelId: 1,
            modal: true
        }).then(result => {
            if (result.response === 1) {
                app.quit();
                return;
            }
        });
    }

    // ディスプレイが1枚の場合、フルスクリーンウィンドウは最小化状態にする
    if (displays.length < 2 && fullscreenWindow && !fullscreenWindow.isDestroyed()) {
        fullscreenWindow.minimize();
    }

    // 起動時にアップデートチェックを実行
    checkForUpdates();

    // ローカルストレージを初期化（mainWindow生成後に呼び出す）
    mainWindow.webContents.once('did-finish-load', () => {
        clearPlaylistStorage(mainWindow);
    });
});

// ---------------------------------------------
// ATEM Control設定
// ---------------------------------------------

// VTR-PON→ATEM制御用インスタンスを生成し接続（オンエア時コマンド送信準備）
async function prepareAtemControl(ip) {
    if (!global.atem) {
        global.atem = new Atem();
        try {
            await global.atem.connect(ip);
            console.log(`[main.js] ATEM Control connected to ${ip}`);
        } catch (err) {
            console.error('[main.js] ATEM Control connection error:', err);
        }
    }
}

// VTR-PON→ATEM制御を停止（インスタンス破棄）
function disableAtemControl() {
    if (global.atem) {
        global.atem.disconnect();
        delete global.atem;
        console.log('[main.js] ATEM Control disconnected');
    }
}

// ATEMモニタリング用インスタンスがなければ生成して接続
async function startATEMMonitor(ip) {
    if (global.atemMonitor) return;
    global.atemMonitor = new Atem();
    try {
        await global.atemMonitor.connect(ip);
        console.log(`[main.js] ATEM Monitor connected to ${ip}`);
        global.atemMonitor.on('stateChanged', (state, paths) => {
            const changed = Array.isArray(paths) ? paths : [paths];
            if (!changed.includes('video.mixEffects.0.programInput')) return;

            // 自身で発生させた切替イベントは無視
            if (ignoreAtemEvent) {
                ignoreAtemEvent = false;
                return;
            }

            const programOut = state.video.mixEffects[0].programInput;
            console.log(`[main.js][ATEM Monitor] Program switched to ${programOut}`);
            const latest = loadConfig().atem || {};
            if (latest.autoSwitch && programOut === latest.input
                && mainWindow && !mainWindow.isDestroyed()
            ) {
                mainWindow.webContents.send('shortcut-trigger', 'Shift+Enter');
                mainWindow.webContents.send('info-message', 'atem.autoOnAirTriggered');
                console.log('[main.js][ATEM Monitor] Auto OnAir triggered');
            }
        });
    } catch (err) {
        console.error('[main.js] ATEM Monitor connection error:', err);
    }
}
// ATEMモニタリングを停止してインスタンスを破棄
function stopATEMMonitor() {
    if (global.atemMonitor) {
        global.atemMonitor.disconnect();
        delete global.atemMonitor;
        console.log('[main.js] ATEM Monitor disconnected');
    }
}

// ---------------------------------------------
// ATEM 設定ウインドウ
// ---------------------------------------------
function createAtemSettingsWindow() {
    if (atemSettingsWindow) {
        atemSettingsWindow.focus();
        return;
    }
    atemSettingsWindow = new BrowserWindow({
        width: 500,
        height: 570,
        title: 'ATEM Connection',
        parent: mainWindow,
        modal: true,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    // CSS／HTML のサイズに合わせて load
    atemSettingsWindow.loadFile('atemsettings.html');
    // メニュー非表示
    atemSettingsWindow.setMenuBarVisibility(false);
    // 閉じられたら変数クリア
    atemSettingsWindow.on('closed', () => {
        atemSettingsWindow = null;
    });
}

// ---------------------------------------------
// デバイス設定
// ---------------------------------------------

// デバイス設定ウインドウの生成
function createDeviceSettingsWindow() {
    deviceSettingsWindow = new BrowserWindow({
        width: 500,
        height: 650,
        title: 'Device Settings',
        parent: mainWindow, // メインウィンドウを親に設定
        modal: true,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    deviceSettingsWindow.loadFile('devicesettings.html');
    deviceSettingsWindow.setMenuBarVisibility(false);
    deviceSettingsWindow.on('closed', () => {
        deviceSettingsWindow = null;
    });
}

// デバイス設定ウインドウを閉じる処理
ipcMain.on('close-device-settings', (event) => {
    if (deviceSettingsWindow) {
        deviceSettingsWindow.close();
    }
});

// ディスプレー情報の処理
const { execSync } = require('child_process');

ipcMain.handle('get-display-list', () => {
    const displays = screen.getAllDisplays();
    let monitorNames = [];

    if (process.platform === 'win32') {
        try {
            // WMICコマンドで、サービスが"monitor"のPnPエンティティからNameを取得する
            const stdout = execSync('wmic path Win32_PnPEntity where "Service=\'monitor\'" get Name', { encoding: 'utf8' });

            const lines = stdout.split('\n').map(line => line.trim()).filter(line => line && line !== 'Name');
            monitorNames = lines;
        } catch (e) {
            console.error('[main.js]Error during acquisition of monitor information by WMIC:', e);
        }
    }
    
    return displays.map((display, index) => {
        // 取得できたモニター名があればその値を利用、なければ従来の内部/外部の判定で表示
        let modelName = monitorNames[index] || (display.internal ? "Built-in Display" : "External Display");
        const resolution = `${display.bounds.width}×${display.bounds.height}`;
        return {
            id: display.id,
            label: `${modelName} (${resolution})`
        };
    });
});

ipcMain.on('set-device-settings', (event, settings) => {
    // 既存の deviceSettings とマージして保持
    const current = global.deviceSettings || {};
    global.deviceSettings = {
        ...current,
        ...settings
    };

    console.log('[main.js] Updated device settings:', global.deviceSettings);

    // 設定を config に永続化
    const cfg = loadConfig();
    cfg.deviceSettings = global.deviceSettings;
    saveConfig(cfg);
    console.log('[main.js] set-device-settings saved deviceSettings:', cfg.deviceSettings);

    // 全ウィンドウへ新しいデバイス設定情報をブロードキャストする
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('device-settings-updated', global.deviceSettings);
    });
});

// メインプロセス側でデバイス設定を返すハンドラー
ipcMain.handle('get-device-settings', () => {
    // 毎回 config.json から最新の deviceSettings を読み出して返す
    const cfg = loadConfig();
    const saved = cfg.deviceSettings || {};

    // 常に config 側の値をそのまま採用する
    global.deviceSettings = saved;

    console.log('[main.js] get-device-settings returning:', global.deviceSettings);

    return global.deviceSettings;
});

// ---------------------------------------------
// 録画設定ウインドウ
// ---------------------------------------------

// 録画設定ウインドウの生成
function createRecordingSettingsWindow() {
  recordingSettingsWindow = new BrowserWindow({
    width: 500,
    height: 420,
    title: 'Recording Settings',
    parent: mainWindow,
    modal: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  recordingSettingsWindow.loadFile('recordingSettings.html');
  recordingSettingsWindow.setMenuBarVisibility(false);
  recordingSettingsWindow.on('closed', () => { recordingSettingsWindow = null; });
}

ipcMain.on('open-recording-settings', () => {
  if (!recordingSettingsWindow) createRecordingSettingsWindow();
});

ipcMain.on('close-recording-settings', () => {
  if (recordingSettingsWindow) recordingSettingsWindow.close();
});

// ディレクトリ選択ダイアログ用
ipcMain.handle('show-recording-directory-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return (canceled || filePaths.length === 0) ? null : filePaths[0];
});

// ---------------------------------------------
// プレイリストとエディットの状態管理と通知
// ---------------------------------------------

// プレイリストからリストエディットにファイルの情報を送る
ipcMain.handle('add-file-to-state', (event, file) => {
    playlistState.push(file); // 状態を更新
    return playlistState; // 更新後の状態を返す
});

// プレイリスト状態を状態管理に送る
ipcMain.handle('set-playlist-state', (event, newState) => {
    playlistState = newState; // 状態を上書き
    return playlistState;
});

// プレイリスト状態を状態管理から受け取る
ipcMain.handle('get-playlist-state', () => {
    return playlistState; // 現在の状態を返す
});

// リストエディットの状態を状態管理に送る
ipcMain.handle('set-edit-state', async (event, itemPath) => {
    statecontrol.setEditState(itemPath);
    return 'Edit state updated';
});

// リストエディットの状態を状態管理から受け取る
ipcMain.handle('get-edit-state', async () => {
    return statecontrol.getEditState();
});

// エディットエリア更新イベントを受け取る
ipcMain.on('update-edit-state', (event, itemData) => {
    console.log('[main.js] Edit state updated.'); // 更新があったことのみログに出力

    // エディットエリアでの更新を各ウィンドウにブロードキャスト
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        win.webContents.send('update-edit-state', itemData);
    });
});

// エディットエリアの更新イベントを状態管理に送る
ipcMain.on('listedit-updated', () => {
    console.log('[main.js] Received listedit-updated event from Renderer.');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('listedit-updated');
        console.log('[main.js] Forwarded listedit-updated event to mainWindow.');
    } else {
        console.log('[main.js] mainWindow is not available to forward the update.');
    }
});

// ---------------------------------------------
// ATEM 切り替えヘルパー
// ---------------------------------------------
async function reliableAtemSwitch(atem, input) {
  const maxRetries = 5;
  const retryDelay = 100; // ms
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await atem.changeProgramInput(input);
    } catch (e) {
      console.warn(`[main.js] changeProgramInput attempt ${i} failed:`, e);
    }
    // 少し待ってから状態を確認
    await new Promise(r => setTimeout(r, retryDelay));
    const current = atem.state.video.mixEffects[0]?.programInput;
    if (current === input) {
      console.log(`[main.js] ATEM input confirmed as ${input} on attempt ${i}`);
      return;
    }
  }
  console.warn(`[main.js] ATEM switch to ${input} not confirmed after ${maxRetries} attempts`);
}

// ---------------------------------------------
// プレイリストからオンエアにアイテムIDを中継＋ATEM制御
// ---------------------------------------------
ipcMain.on('on-air-item-id', async (event, itemId) => {
    // control フラグを含む新しい設定を取得（delay も含む）
    const cfg = loadConfig().atem || { control: false, autoSwitch: false, ip: '', input: 1, delay: 0 };

    if (cfg.control && cfg.ip && cfg.delay < 0) {
        // 負のオフセット
        try {
            // 接続（初回のみ）
            if (!global.atem) {
                global.atem = new Atem();
                await global.atem.connect(cfg.ip);
                console.log(`[main.js] Connected to ATEM at ${cfg.ip}`);
                await new Promise(r => setTimeout(r, 300)); // 初期化待ち
            }
            ignoreAtemEvent = true;  // ← 自身の切替はモニタで無視
            await reliableAtemSwitch(global.atem, cfg.input);
            // 切替完了通知
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('info-message', 'atem.autoSwitchCommandSent');
            }
        } catch (err) {
            console.error('[main.js] ATEM switch error:', err);
        }
        // 絶対値分だけ待機
        await new Promise(r => setTimeout(r, Math.abs(cfg.delay)));
        // 再生トリガー
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('on-air-data', itemId);
        });
    } else {
        // 正のオフセットまたは0
        // 再生トリガー
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('on-air-data', itemId);
        });

        if (cfg.control && cfg.ip) {
            setTimeout(async () => {
                try {
                    if (!global.atem) {
                        global.atem = new Atem();
                        await global.atem.connect(cfg.ip);
                        console.log(`[main.js] Connected to ATEM at ${cfg.ip}`);
                        await new Promise(r => setTimeout(r, 300)); // 初期化待ち
                    }
                    ignoreAtemEvent = true;  // 自身の切替はモニタで無視
                    await reliableAtemSwitch(global.atem, cfg.input);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('info-message', 'atem.autoSwitchCommandSent');
                    }
                } catch (err) {
                    console.error('[main.js] ATEM switch error:', err);
                }
            }, cfg.delay);
        }
    }
});

// ---------------------------------------------
// プレイリストモード切り替え時の endMode 同期
// ---------------------------------------------
ipcMain.on('sync-onair-endmode', (event, payload) => {
    try {
        // payload: { reason: 'mode-change', mode: 'LIST' | 'REPEAT', editingItemId: string }
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('sync-onair-endmode', payload);
        });
        console.log('[main.js] Forwarded sync-onair-endmode:', payload);
    } catch (e) {
        console.error('[main.js] Error forwarding sync-onair-endmode:', e);
    }
});

// ---------------------------------------------
// オンエアからフルスクリーンにアイテムIDを中継
// ---------------------------------------------

// オンエアから受信し、フルスクリーンに転送
ipcMain.on('send-video-to-fullscreen', (event, fullscreenData) => {
    console.info('[main.js]Received video data from onAir:', fullscreenData);

    BrowserWindow.getAllWindows().forEach(win => {
        if (win === fullscreenWindow) { // フルスクリーンウィンドウのみ
            win.webContents.send('load-video-from-main', fullscreenData);
            console.info('[main.js]Forwarded video data to fullscreen:', fullscreenData);
        }
    });
});

// ---------------------------------------------
// オンエアからフルスクリーンに操作情報を中継
// ---------------------------------------------
// フルスクリーン操作コマンドを受け取り、フルスクリーンウィンドウに転送
ipcMain.on('control-fullscreen', (event, commandData) => {
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
        fullscreenWindow.webContents.send('control-video', commandData); // フルスクリーンに転送
        console.log(`[main.js] Sent command to fullscreen: ${JSON.stringify(commandData)}`);
    } else {
        console.warn('[main.js] Fullscreen window is not available to receive commands.');
    }
});

// ---------------------------------------------
// オンエアからプレイリストにオフエア状態を中継
// ---------------------------------------------

// オフエアボタンが押されたことを受信し、すべてのウィンドウに off-air-notify を送信する
ipcMain.on('off-air-event', (event) => {
    console.log('[main.js] Received Off-Air event from On-Air.');
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('off-air-notify'); // オフエア通知をすべてのウィンドウに送信
        console.log('[main.js] Off-Air event sent to window:', win.id);
    });
});

// -----------------------------------------------------
// オンエアからプレイリストにネクストモード要求を中継
// -----------------------------------------------------

// オンエアからNEXTモード動画終了イベントを受信
ipcMain.on('next-mode-complete', (event, currentItemId) => {
    // メインウインドウが残っていなければ何もしない
    if (!mainWindow || mainWindow.isDestroyed()) return;

    console.log(`[main.js] MAIN: NEXT mode complete event received for Item ID: ${currentItemId}`);
    // メインウインドウだけに通知
    mainWindow.webContents.send('next-mode-complete-broadcast', currentItemId);
});

// -----------------------------------------------------
// フルスクリーンからオンエアに音量情報を送る
// -----------------------------------------------------
// フルスクリーンからオンエアに音量情報を送る
ipcMain.on('fullscreen-audio-level', (event, dBFS) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fullscreen-audio-level', dBFS);
    }
});

// L/R 版（payload: { L: number, R: number } をそのまま転送）
ipcMain.on('fullscreen-audio-level-lr', (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fullscreen-audio-level-lr', payload);
    }
});

// -----------------------------------------------------
// フルスクリーンかshow-messageに情報を送る
// -----------------------------------------------------

// fullscreen からのスクリーンショット通知を受信し、メインウィンドウへ転送する
ipcMain.on('notify-screenshot-saved', (event, savedPath) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('screenshot-saved', savedPath);
        console.log('[main.js] Forwarded screenshot-saved notification to mainWindow:', savedPath);
    }
});

// -----------------------------------------------------
// FILLKEYモード更新メッセージを受信し、すべてのウィンドウに転送する
// -----------------------------------------------------

// FILLKEYモード更新メッセージを受信し、すべてのウィンドウに転送する
ipcMain.on('fillkey-mode-update', (event, fillKeyMode) => {
    console.log(`[main.js] Received fillkey-mode-update: ${fillKeyMode}`);
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('fillkey-mode-update', fillKeyMode);
        console.log(`[main.js] Sent fillkey-mode-update to window: ${fillKeyMode}`);
    });
});

// clear-modes 通知を受信し、すべてのウィンドウに転送する
ipcMain.on('clear-modes', (event) => {
    console.log('[main.js] Received clear-modes notification.');
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('clear-modes');
        console.log('[main.js] Sent clear-modes notification to a window.');
    });
});

// -----------------------------------------------------
// 透過情報をもつmovをwebmに変換してプレイリストに登録
// -----------------------------------------------------

// MOVファイルのピクセルフォーマットを取得して、アルファ情報の有無を返す
ipcMain.handle('check-mov-alpha', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`Error in ffprobe for ${filePath}:`, err);
                reject(err);
            } else {
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                if (videoStream && videoStream.pix_fmt) {
                    resolve(videoStream.pix_fmt);
                } else {
                    resolve('');
                }
            }
        });
    });
});

// MOVファイルをWebM VP9 (透過付き) に変換する
ipcMain.handle('convert-mov-to-webm', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        // 出力ファイル名を、元ファイルの拡張子部分を .webm に置換
        const outputFilePath = filePath.replace(/\.[^/.]+$/, ".webm");
        ffmpeg(filePath)
            .outputOptions([
                '-c:v', 'libvpx-vp9',
                '-pix_fmt', 'yuva420p',
                '-b:v', '2M',
                '-tile-columns', '4', 
                '-frame-parallel', '1', 
                '-row-mt', '1', 
                '-threads', '8'
            ])
            .on('end', () => {
                console.log(`[main.js] Conversion successful: ${outputFilePath}`);
                resolve(outputFilePath);
            })
            .on('error', (err) => {
                console.error(`[main.js] ffmpeg conversion error for ${filePath}:`, err);
                reject(err);
            })
            .save(outputFilePath);
    });
});

// ----------------------------------------
// PPTXをMP4に変換するための処理呼び出し
// ----------------------------------------
const pptxConverterWinax = require('./pptxConverterWinax');

ipcMain.handle('convert-pptx-to-png-winax', async (event, pptxPath) => {
    // デバッグ: winax モジュールの利用可否をログ出力
    const avail = pptxConverterWinax.available();
    console.log('[main.js] Debug: convert-pptx-to-png-winax available =', avail);

    if (!avail) {
        console.error('[main.js] convert-pptx-to-png-winax is only supported');
        throw new Error('Unsupported platform for PPTX to PNG conversion.');
    }
    try {
        const outputFolder = await pptxConverterWinax.convertPPTXToPNG(pptxPath);
        console.log('[main.js] Conversion succeeded, outputFolder =', outputFolder);
        return outputFolder;
    } catch (error) {
        console.error('[main.js] PPTX to PNG conversion error:', error);
        throw error;
    }
});

// ------------------------------------------
// PNG連番ファイルを読み込む（PPTX変換用）
// ------------------------------------------
ipcMain.handle('get-png-files', async (event, outputFolder) => {
    if (pptxConverterWinax.available() === false) {
        console.error("[main.js] get-png-files is only supported");
        throw new Error("Unsupported platform for PNG file retrieval.");
    }
    try {
        const files = await fs.promises.readdir(outputFolder);
        const pngFiles = files.filter(file => file.toLowerCase().endsWith('.png'))
                              .map(file => path.join(outputFolder, file));
        console.log("[main.js] Found PNG files:", pngFiles);
        return pngFiles;
    } catch (err) {
        console.error("[main.js] Error reading PNG files:", err);
        throw err;
    }
});

// -----------------------------------------------------
// フルスクリーンのスクリーンショット機能
// -----------------------------------------------------

// saveScreenshot
ipcMain.handle('saveScreenshot', async (event, arrayBuffer, fileName, videoPath) => {
    try {
        // 動画ファイルのディレクトリを取得し、その中に "Screenshot" フォルダを生成（存在しない場合）
        const videoDir = path.dirname(videoPath);
        const screenshotDir = path.join(videoDir, 'Screenshot');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        // 保存先ファイルパスを決定
        const filePath = path.join(screenshotDir, fileName);
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
        console.log(`[main.js] Screenshot saved at: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error('[main.js] Failed to save screenshot:', error);
        throw error;
    }
});

// キャプチャボタンの動作
ipcMain.on('request-capture-screenshot', (event) => {
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
        fullscreenWindow.webContents.send('capture-screenshot');
        console.log('[main.js] Screenshot requested from capture button.');
    } else {
        console.log('[main.js] Fullscreen window not available for screenshot capture.');
    }
});

// -----------------------------
// DSK用コマンド
// -----------------------------
ipcMain.on('dsk-command', (event, dskCommandData) => {
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
        fullscreenWindow.webContents.send('dsk-control', dskCommandData);
        console.log(`[main.js] Sent DSK command to fullscreen: ${dskCommandData.command}`);
    } else {
        console.warn('[main.js] Fullscreen window is not available to receive DSK commands.');
    }
});

// ---------------------------------
// 録画機能
// ---------------------------------

ipcMain.handle('save-recording-file', async (event, arrayBuffer, chunkFileName) => {
  try {
    const tempDir = path.join(app.getPath('temp'), 'vtrpon_recordings');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, chunkFileName.replace(/\.mp4$/, '.webm'));
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(filePath, buffer);
    const stats = fs.statSync(filePath);
    console.log(`[main.js] Recording chunk saved at: ${filePath}`);
    console.log(`[main.js] Chunk file size: ${stats.size} bytes`);
    return filePath;
  } catch (error) {
    console.error('[main.js] Failed to save recording chunk:', error);
    throw error;
  }
});

ipcMain.handle('merge-recording-chunks', async (event, chunkFilePaths, defaultFileName) => {
    isRecordingSaving = true;
    try {
        // 保存開始を通知
        mainWindow.webContents.send('recording-save-start');

        // プレフィクスまたはデフォルトを取得（デフォルトは "recording"）
        const prefix = global.recordingConfig.prefix || 'recording';
        // タイムスタンプを「YYYY-MM-DDTHH-MM-SS」形式で生成
        const timestamp = new Date()
            .toISOString()
            .split('.')[0]
            .replace(/:/g, '-');

        // ファイル名を「prefix + '_' + timestamp + .webm」で組み立て
        const fileName = `${prefix}_${timestamp}.webm`;
        // 設定された保存先ディレクトリに保存
        const saveDir = global.recordingConfig.directory;
        const filePath = path.join(saveDir, fileName);

        // concat プロトコル入力文字列を生成
        const concatInput = chunkFilePaths.map(p => p.replace(/\\/g, '/')).join('|');
        console.log('[main.js] Concat input:', concatInput);

        // Step1: チャンクを結合（再エンコードなし）
        const tempMergedPath = filePath.replace('.webm', '_temp.webm');
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(`concat:${concatInput}`)
                .outputOptions(['-c', 'copy', '-threads', '0'])
                .on('end', () => {
                    console.log('[main.js] Concat protocol による結合に成功しました。');
                    resolve();
                })
                .on('error', err => {
                    console.error('[main.js] Concat protocol 結合処理中エラー:', err);
                    reject(err);
                })
                .save(tempMergedPath);
        });

        // Step2: remux によるタイムスタンプリセットを filePath に直接保存
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(tempMergedPath)
                .outputOptions([
                    '-c', 'copy',
                    '-fflags', '+genpts',
                    '-reset_timestamps', '1'
                ])
                .on('end', () => {
                    console.log('[main.js] Remux 処理によりタイムスタンプをリセットしました。');
                    resolve();
                })
                .on('error', err => {
                    console.error('[main.js] Remux 処理中エラー:', err);
                    reject(err);
                })
                .save(filePath);
        });

        // 一時ファイルの削除
        await fs.promises.unlink(tempMergedPath);

        // 保存完了を通知
        mainWindow.webContents.send('recording-save-complete');
        mainWindow.webContents.send('recording-save-notify', filePath);

        // 終了予約があればアプリ終了
        if (shouldQuitAfterSave) {
            app.quit();
        }

        return filePath;
    } catch (error) {
        console.error('[main.js] merge-recording-chunks error:', error);
        throw error;
    } finally {
        isRecordingSaving = false;
    }
});

ipcMain.handle('fix-webm-metadata', async (event, mergedPath, totalDurationMs) => {
    try {
        const buffer = await fs.promises.readFile(mergedPath);
        const fixedBuffer = await fixWebmDuration(buffer, totalDurationMs);
        await fs.promises.writeFile(mergedPath, fixedBuffer);
        console.log('[main.js] EBML metadata fixed. Total duration:', totalDurationMs / 1000, 'seconds');
        return mergedPath;
    } catch (error) {
        console.error('[main.js] EBML metadata fix failed:', error);
        throw error;
    }
});


ipcMain.handle('get-media-duration', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                resolve(metadata.format.duration);
            }
        });
    });
});

// -----------------------------------------------------
// 録画設定取得/保存
// -----------------------------------------------------
ipcMain.handle('get-recording-settings', () => {
  return global.recordingConfig || {};
});

ipcMain.on('set-recording-settings', (event, newSettings) => {
  const config = loadConfig();
  config.recording = newSettings;
  saveConfig(config);
  global.recordingConfig = newSettings;
  console.log('[main.js] Recording settings updated:', newSettings);
});

// ---------------------------------
// ファイル操作
// ---------------------------------
// プレイリストでファイル選択ダイアログを表示し、選択されたファイルの基本情報を返す
ipcMain.handle('select-files', async () => {
    let extensions = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'wav', 'mp3', 'flac', 'aac', 'm4a', 'png', 'jpg', 'jpeg', 'mpeg'];
    if (pptxConverterWinax.available()) {
        extensions.push('pptx'); // WindowsでPPTX変換が可能な場合、pptxを追加
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Media Files', extensions: extensions }]
    });
    if (canceled) return [];

    return filePaths.map(filePath => ({
        path: filePath,
        name: path.basename(filePath),
        resolution: 'Unknown',
        duration: 'Unknown',
        creationDate: new Date().toLocaleDateString()
    }));
});

// プレイリストへの動画登録時のメタデータの取得
ipcMain.handle('get-metadata', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`[main.js]Error getting metadata for ${filePath}:`, err);
                reject(err);
            } else {
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown';

                const durationRaw = metadata.format.duration || '0';
                let durationInSeconds = parseFloat(durationRaw); // 数値に変換
                if (isNaN(durationInSeconds)) {
                    durationInSeconds = 0;
                }
                const creationDate = (metadata.format.tags && metadata.format.tags.creation_time) || 'unknown';

                resolve({
                    resolution: resolution,
                    duration: formatDuration(durationInSeconds), // 秒数を hh:mm:ss.xx にフォーマット
                    creationDate: creationDate
                });
            }
        });
    });
});

// ffmpeg操作
ipcMain.handle('exec-ffmpeg', async (event, args) => {
    const command = `"${ffmpegPath}" ${args}`;

    return new Promise((resolve, reject) => {
        exec(command, { shell: true, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                if (!stderr.includes('Unsupported pixel format: -1')) {
                    console.error(`FFmpeg error: ${stderr}`);
                    reject(stderr);
                } else {
                    console.warn('Filtered FFmpeg warning: Unsupported pixel format');
                    resolve(stdout);
                }
            } else {
                console.log(`FFmpeg output: ${stdout}`);
                resolve(stdout);
            }
        });
    });
});

// ---------------------------------
// ドラッグ＆ドロップで追加されたファイルを処理する
// ---------------------------------
ipcMain.on('files-dropped', (event, files) => {
    console.log('[main.js] Received dropped files:', files);
    const allowedExtensions = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'wav', 'mp3', 'flac', 'aac', 'm4a', 'png', 'jpg', 'jpeg', 'mpeg', 'pptx'];
    const validFiles = [];
    const invalidFiles = [];

    files.forEach(filePath => {
        if (!filePath || typeof filePath !== 'string') {
            console.warn('[main.js] Invalid file path received:', filePath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase().replace('.', '');
        if (allowedExtensions.includes(ext)) {
            validFiles.push({
                path: filePath,
                name: path.basename(filePath),
                resolution: 'Unknown',
                duration: 'Unknown',
                creationDate: new Date().toLocaleDateString()
            });
        } else {
            invalidFiles.push(filePath);
        }
    });

    if (invalidFiles.length > 0) {
        // 読み込めないファイルが含まれる場合、renderer 側でエラーメッセージを表示させるために通知を送信
        mainWindow.webContents.send('invalid-files-dropped', invalidFiles);
    }
    if (validFiles.length > 0) {
        // 読み込めるファイルがある場合は、add-dropped-file イベントで renderer に送信する
        mainWindow.webContents.send('add-dropped-file', validFiles);
    }
});

// ---------------------------------
// FLAC の PICTURE ブロックを削除した再生用ファイルを返す
// ---------------------------------
ipcMain.handle('getPlayableFlac', async (event, inputPath) => {
    const { fileURLToPath } = require('url');
    // file:// URL が渡された場合は実ファイルパスに変換
    let src = inputPath.startsWith('file://') ? fileURLToPath(inputPath) : inputPath;
    const dir  = path.dirname(src);
    const base = path.basename(src, '.flac');
    const out  = path.join(dir, `${base}_nopic.flac`);
    await removeFlacPicture(src, out);
    return out;
});

// ---------------------------------
// PICTURE 削除ロジック（metaflac → ffmpeg フォールバック）
// ---------------------------------
function removeFlacPicture(input, output) {
    return new Promise((resolve, reject) => {
        let cmd = `metaflac --remove --block-type=PICTURE --output="${output}" "${input}"`;
        exec(cmd, (err, _s, stderr) => {
            if (!err) return resolve();
            // metaflac 失敗時は ffmpeg でメタデータクリア＋コピー
            cmd = `ffmpeg -y -i "${input}" -c:a copy -map_metadata -1 "${output}"`;
            exec(cmd, (err2, _s2, stderr2) => {
                if (err2) return reject(stderr2||err2);
                resolve();
            });
        });
    });
}

// ---------------------------------
// FLACの波形生成
// ---------------------------------

// FLAC用波形サムネイル生成機能
ipcMain.handle('generate-waveform-thumbnail', async (event, filePath) => {
    return new Promise((resolve, reject) => {
         // 出力ファイル名：元の拡張子部分を _waveform.png に置換
         const outputFilePath = filePath.replace(/\.[^/.]+$/, "_waveform.png");
         ffmpeg(filePath)
             .outputOptions([
                  '-filter_complex', 'showwavespic=s=112x63:colors=white',
                  '-frames:v', '1'
             ])
             .on('end', () => {
                 fs.readFile(outputFilePath, (err, data) => {
                     if (err) {
                         reject(err);
                     } else {
                         const dataUrl = 'data:image/png;base64,' + data.toString('base64');
                         // 一時ファイルを削除
                         fs.unlink(outputFilePath, () => {});
                         resolve(dataUrl);
                     }
                 });
             })
             .on('error', (err) => {
                 reject(err);
             })
             .save(outputFilePath);
    });
});

// --------------------------------
// プレイリストのインポート、エクスポート
// --------------------------------

const { writeFile, readFile } = require('fs').promises;

// プレイリストをエクスポート
ipcMain.handle('export-playlist', async (event, playlistData) => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const defaultPath = `vtrpon-playlistconfig-${timestamp}.json`;

    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Playlist',
        defaultPath,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (filePath) {
        try {
            await writeFile(filePath, JSON.stringify(playlistData, null, 2), 'utf-8');
            console.log(`[main.js] Playlist exported to: ${filePath}`);
            return { success: true, path: filePath };
        } catch (error) {
            console.error('[main.js]Error exporting playlist:', error);
            return { success: false, error };
        }
    }
    return { success: false, error: 'User canceled save dialog' };
});

// プレイリストをインポート
ipcMain.handle('import-playlist', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Playlist',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (canceled || filePaths.length === 0) {
        return { success: false, error: 'User canceled open dialog' };
    }

    try {
        const data = await readFile(filePaths[0], 'utf-8');
        const playlistData = JSON.parse(data);

        // データ構造のチェック
        if (!playlistData || typeof playlistData !== 'object' || !Array.isArray(playlistData.playlists)) {
            console.error('Invalid playlist data structure:', playlistData);
            return { success: false, error: 'Invalid playlist data structure' };
        }

        // 欠落ファイルがあっても import 自体は成功させ、該当アイテムを mediaOffline=true にする
        const missingFiles = [];

        for (const playlist of playlistData.playlists) {
            if (!playlist || !Array.isArray(playlist.data)) continue;

            for (const file of playlist.data) {
                if (!file || typeof file !== 'object') continue;

                const hasPath = (typeof file.path === 'string' && file.path.length > 0);
                const isUVC = (hasPath && file.path.startsWith('UVC_DEVICE'));

                // UVC は存在チェックしない
                if (isUVC) {
                    file.mediaOffline = false;
                    continue;
                }

                let exists = false;
                if (hasPath) {
                    try {
                        exists = fs.existsSync(file.path);
                    } catch (e) {
                        exists = false;
                    }
                }

                if (!exists) {
                    file.mediaOffline = true;
                    missingFiles.push(file.path || file.name || 'Unknown file');
                } else {
                    file.mediaOffline = false;
                }
            }
        }

        console.log(`[main.js] Playlist imported from: ${filePaths[0]}`);
        return { success: true, data: playlistData, missingFiles };
    } catch (error) {
        console.error('Error importing playlist:', error);
        return { success: false, error: (error && error.message) ? error.message : 'Failed to read or parse JSON file' };
    }
});

// ファイルの存在をチェックするハンドラー
ipcMain.handle('check-file-exists', async (event, filePath) => {
    try {
        return fs.existsSync(filePath); // ファイルの存在を確認
    } catch (error) {
        console.error(`Error checking file existence for ${filePath}:`, error);
        return false; // エラー時は存在しないとみなす
    }
});

// --------------------------------
// キャプチャファイルの保存
// --------------------------------
ipcMain.handle('saveBlobToFile', async (event, arrayBuffer, fileName) => {
    try {
        // 一時ディレクトリを取得
        const tempDir = path.join(app.getPath('temp'), 'my-app-temp-files');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // 保存先ファイルパスを決定
        const filePath = path.join(tempDir, fileName);

        // ArrayBufferをBufferに変換してファイルに書き込む
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);

        console.log(`[main.js] File saved at: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error('[main.js]Failed to save file:', error);
        throw error;
    }
});

// ---------------------------------
// 時間のフォーマット
// ---------------------------------

// 時間を hh:mm:ss.xx 形式にフォーマットする関数
function formatDuration(seconds) {
    // 不正値ガード
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        seconds = 0;
    }

    // 1/100秒単位に「切り捨て」して整数化（実尺より長くならない）
    const totalCentiseconds = Math.floor(seconds * 100); // 例: 43.529 → 4352 (43.52s)

    const h = Math.floor(totalCentiseconds / (3600 * 100));
    const m = Math.floor((totalCentiseconds % (3600 * 100)) / (60 * 100));
    const s = Math.floor((totalCentiseconds % (60 * 100)) / 100);
    const cs = totalCentiseconds % 100; // centiseconds (0?99)

    // hh:mm:ss.xx 形式で返す
    return (
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0') + '.' +
        String(cs).padStart(2, '0')
    );
}

// フレーム対応の時間フォーマット関数（変更なし）
function formatTimeWithFrames(seconds, fps) {
    const totalFrames = Math.round(seconds * fps); // 総フレーム数を計算
    const h = Math.floor(totalFrames / (3600 * fps));
    const m = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
    const s = Math.floor((totalFrames % (60 * fps)) / fps);
    const frames = totalFrames % fps;

    // hh:mm:ss:ff形式で返す
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// --------------------------------
// ショートカットキー関連
// --------------------------------

// フルスクリーンウインドウを次のディスプレイに移動する関数（ALT+W）
function moveFullscreenToNextDisplay() {
  if (!fullscreenWindow || fullscreenWindow.isDestroyed()) return;

  const displays = screen.getAllDisplays();
  const b = fullscreenWindow.getBounds();
  const currentDisplayIndex = displays.findIndex(d => d.bounds.x === b.x && d.bounds.y === b.y);
  const nextDisplay = displays[(currentDisplayIndex + 1) % displays.length];

  if (process.platform === 'darwin') {
    // 擬似フルスクリーン前提：Spaceは跨がない
    macEnterFakeFullscreen(fullscreenWindow, nextDisplay);
  } else {
    // 既存（Windows等）はそのまま
    fullscreenWindow.setBounds({
      x: nextDisplay.bounds.x,
      y: nextDisplay.bounds.y,
      width: nextDisplay.bounds.width,
      height: nextDisplay.bounds.height
    });
    fullscreenWindow.setFullScreen(true);
  }
}

// --- mac only helpers ---
function macEnterFakeFullscreen(win, display) {
  try {
    // すでにネイティブFSの場合のみ解除（毎回はやらない）
    if (win.isFullScreen && win.isFullScreen()) {
      win.setFullScreen(false);
    }

    // 対象ディスプレイ全面にサイズ合わせ（ここは毎回OK）
    win.setBounds({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }, false);

    // simple fullscreen は未適用のときだけ適用（毎回トグルしない）
    if (win.isSimpleFullScreen && !win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(true);
    }

    // 一貫して強めに最前面（他所と競合しないよう 'screen-saver' に統一）
    win.setAlwaysOnTop(true, 'screen-saver');

    win.show();
    win.focus();
  } catch (e) {
    console.warn('[main.js] macEnterFakeFullscreen failed:', e);
  }
}

function collapseFullscreenSafely() {
    if (!fullscreenWindow || fullscreenWindow.isDestroyed()) return;
    try {
        // simple fullscreen を解除（適用時のみ）
        if (fullscreenWindow.isSimpleFullScreen && fullscreenWindow.isSimpleFullScreen()) {
            fullscreenWindow.setSimpleFullScreen(false);
        }
        // ネイティブFSなら解除
        if (fullscreenWindow.isFullScreen && fullscreenWindow.isFullScreen()) {
            fullscreenWindow.setFullScreen(false);
        }
        // 最前面解除してから退避
        fullscreenWindow.setAlwaysOnTop(false);

        // ひとまず隠す（最小化でもOK）
        // fullscreenWindow.minimize();
        fullscreenWindow.hide();

        // 万一前面に残っても邪魔しないよう、プライマリに小さく退避
        const primary = screen.getPrimaryDisplay();
        const wa = primary.workArea || primary.bounds;
        fullscreenWindow.setBounds({
            x: (wa.x || 0) + 50,
            y: (wa.y || 0) + 50,
            width: 640,
            height: 360
        }, false);
    } catch (e) {
        console.warn('[main.js] collapseFullscreenSafely failed:', e);
    }
}

function macRecreateFullscreenWindow(html = 'fullscreen.html') {
  try {
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
      fullscreenWindow.destroy();
    }
    const displays = screen.getAllDisplays();
    const target = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) || displays[0];

    fullscreenWindow = new BrowserWindow({
      fullscreen: false,
      frame: true,
      resizable: true,
      show: false,
      backgroundColor: '#000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    fullscreenWindow.loadFile(html);
    fullscreenWindow.setMenuBarVisibility(false);

    // 擬似フルスクリーンに入れる
    macEnterFakeFullscreen(fullscreenWindow, target);

    // 事故時にすぐ復旧できるよう、閉じたら参照クリア
    fullscreenWindow.on('closed', () => { fullscreenWindow = null; });
  } catch (e) {
    console.error('[main.js] macRecreateFullscreenWindow failed:', e);
  }
}

// デバッグモードを切り替える関数（F10)
function toggleDebugMode(isDebug) {
    if (isDebug) {
        mainWindow.webContents.openDevTools();
        fullscreenWindow?.webContents.openDevTools(); // フルスクリーンのDevToolsを開く
    } else {
        mainWindow.webContents.closeDevTools();
        fullscreenWindow?.webContents.closeDevTools(); // フルスクリーンのDevToolsを閉じる
    }
}

// グローバルショートカット登録
let isModalActive = false; // モーダルの表示状態を追跡

app.on('browser-window-focus', () => {
    if (!isModalActive) {
        registerShortcuts();
    }
});

app.on('browser-window-blur', () => {
    // すべてのグローバルショートカットを解除
    globalShortcut.unregisterAll();
    // CommandOrControl+Qは常に有効にする（アプリ終了）
    globalShortcut.register('CommandOrControl+Q', () => {
        app.quit();
    });
});

function registerShortcuts() {

    // F10 - Debug Mode
    globalShortcut.register('F10', () => {
        isDebugMode = !isDebugMode;  // デバッグモードの状態をトグル
        toggleDebugMode(isDebugMode);  // トグルした状態に応じてデバッグモードを切り替え
        console.log(`[main.js] Debug mode is now ${isDebugMode ? 'ON' : 'OFF'}`);
    });

    // F11 - Fullscreen Toggle
    globalShortcut.register('F11', () => {
        if (mainWindow) {
            const isFullScreen = mainWindow.isFullScreen();
            mainWindow.setFullScreen(!isFullScreen);
            console.log(`[main.js] Main window fullscreen is now ${!isFullScreen}`);
        }
    });

   // Move Fullscreen Window (macOS: Option+W, Others: Alt+W)
    const moveFSShortcut = process.platform === 'darwin' ? 'Option+W' : 'Alt+W';
    globalShortcut.register(moveFSShortcut, () => {
        console.log(`[main.js] ${moveFSShortcut} pressed ? shortcut handler invoked`);  // ← 追加
        moveFullscreenToNextDisplay();
        console.log(`[main.js] ${moveFSShortcut} triggered: Moved fullscreen window to next display.`);
    });

    // Shift＋S- Fullscreen Window Capture
    globalShortcut.register('Shift+S', () => {
        if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
            fullscreenWindow.webContents.send('capture-screenshot');
            console.log('[main.js] Global shortcut Shift+S triggered: Capture screenshot.');
        } else {
            console.log('[main.js] Fullscreen window not available for screenshot capture.');
        }
    });

    // Alt+Shift+O - On-Air OUT point を listedit に通知
    globalShortcut.register('Alt+Shift+O', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('shortcut-trigger', 'out-point');
            console.log('[main.js] Global shortcut Alt+Shift+O triggered: OUT point');
        }
    });

    // Alt+Shift+I - On-Air IN point を listedit に通知
    globalShortcut.register('Alt+Shift+I', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('shortcut-trigger', 'in-point');
            console.log('[main.js] Global shortcut Alt+Shift+I triggered: IN point');
        }
    });
}

// モーダル状態を受け取ってショートカットを無効化・再登録
ipcMain.on('update-modal-state', (event, { isActive }) => {
    isModalActive = isActive;

    if (isModalActive) {
        globalShortcut.unregisterAll();
        console.log("[main.js] Modal is active, shortcuts unregistered");
    } else {
        registerShortcuts();
        console.log("[main.js] Modal is inactive, shortcuts re-registered");
    }

    // モーダル状態の変更をすべてのレンダラープロセスに通知
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('modal-state-change', { isActive });
    });
});

// 現在のモーダル状態を取得するハンドラー
ipcMain.handle('get-modal-state', () => {
    return { isActive: isModalActive };
});

// 終了時にショートカットをリリース
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        console.log('[main.js] powerSaveBlocker stopped.');
    }
});

// ---------------------
// ローカルストレージ
// ---------------------

// ローカルストレージの初期化処理
function clearPlaylistStorage(window) {
    if (window) {
        window.webContents.executeJavaScript(`
            for (let i = 1; i <= 7; i++) {
                localStorage.removeItem('vtrpon_playlist_store_' + i);
            }
            console.log('[main.js] vtrpon Playlist stores have been cleared.');
        `).then(() => {
            console.log('[main.js] vtrpon Playlist storage cleared successfully.');
        }).catch(err => {
            console.error('[main.js] Error clearing vtrpon playlist storage:', err);
        });
    }
}

// プレイリスト保存ファイルの削除
function removeOldPlaylistFile() {
    const playlistDataFile = path.join(app.getPath('userData'), 'playlist.json');
    if (fs.existsSync(playlistDataFile)) {
        fs.unlinkSync(playlistDataFile);
        console.log('[main.js] Old playlist data file has been removed.');
    }
}

// --------------------------------
// 終了処理
// --------------------------------

// 録画ファイルの保存中はアプリを終了させない
app.on('before-quit', (e) => {
    if (isRecordingSaving) {
        e.preventDefault();
        shouldQuitAfterSave = true;
    }
});

// 全てのウインドウが閉じられたときの処理
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
