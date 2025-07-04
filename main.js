// -----------------------
//     main.js
//     ver 2.3.5
// -----------------------

// ---------------------
// 初期設定
// ---------------------

const { app, BrowserWindow, ipcMain, dialog, protocol, screen, Menu, globalShortcut, session, shell, powerSaveBlocker } = require('electron');

const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const statecontrol = require('./statecontrol.js');
const fixWebmDuration = require('fix-webm-duration');
const { Atem } = require('atem-connection');

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
const ffmpegPath = path.join(
    process.resourcesPath,
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);
if (!fs.existsSync(ffmpegPath)) {
    console.error('[main.js] FFmpeg binary not found:', ffmpegPath);
} else {
    console.log('[main.js] FFmpeg binary found:', ffmpegPath);
    ffmpeg.setFfmpegPath(ffmpegPath);
}

const ffprobePath = path.join(
    process.resourcesPath,
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
);

const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'ffprobe.exe');
if (fs.existsSync(unpackedPath)) {
    ffprobePath = unpackedPath;
}

if (!fs.existsSync(ffprobePath)) {
    console.error('[main.js] FFprobe binary not found:', ffprobePath);
} else {
    console.log('[main.js] FFprobe binary found:', ffprobePath);
    ffmpeg.setFfprobePath(ffprobePath);
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

// ATEM 設定取得
ipcMain.handle('get-atem-config', (event) => {
    const config = loadConfig();
    // control/autoSwitch フラグも含むデフォルトを返す
    return config.atem || { control: false, autoSwitch: false, ip: '', input: 1, delay: 0 };
});

// ATEM 設定保存 ＆ 機能ON/OFFを即時反映
ipcMain.on('set-atem-config', async (event, atemConfig) => {
    // 設定永続化
    const config = loadConfig();
    config.atem = atemConfig;
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
                console.error('[Update Check] バージョン情報取得エラー:', error);
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
                ? `リリース日: ${latestInfo['Release Date'] || '不明'}\n更新内容: ${updateDetails}`
                : `Release Date: ${latestInfo['Release Date'] || 'Unknown'}\nUpdate Details: ${updateDetails}`
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

// labels.js からメニュー用ラベルを取得する共通関数
function buildMenuTemplate(labels) {
    return [
        {
            label: labels["menu-file"],
            submenu: [
                {
                    label: labels["menu-add-file"],
                    accelerator: 'CommandOrControl+F',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'add-file');
                    }
                },
                { type: 'separator' },
                {
                    label: labels["menu-export-playlist"],
                    click: () => {
                        mainWindow.webContents.send('export-playlist');
                    }
                },
                {
                    label: labels["menu-import-playlist"],
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
                    label: labels["menu-language"],
                    submenu: [
                        {
                            label: "English",
                            type: 'radio',
                            checked: global.currentLanguage === 'en',
                            click: () => {
                                global.currentLanguage = 'en';
                                saveConfig({ language: 'en' });
                                BrowserWindow.getAllWindows().forEach(win => {
                                    win.webContents.send('language-changed', 'en');
                                });
                                rebuildMenu();
                                console.log('[main.js] Language changed to English.');
                            }
                        },
                        {
                            label: "Japanese",
                            type: 'radio',
                            checked: global.currentLanguage === 'ja',
                            click: () => {
                                global.currentLanguage = 'ja';
                                saveConfig({ language: 'ja' });
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
                    accelerator: 'CommandOrControl+Q',
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
                    accelerator: 'Alt+S',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'toggle-start-mode');
                    }
                },
                { type: 'separator' },
                {
                    label: labels["menu-end-mode-off"],
                    accelerator: 'Alt+O',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'end-mode-off');
                    }
                },
                {
                    label: labels["menu-end-mode-pause"],
                    accelerator: 'Alt+P',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'end-mode-pause');
                    }
                },
                {
                    label: labels["menu-end-mode-ftb"],
                    accelerator: 'Alt+F',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'end-mode-ftb');
                    }
                },
                {
                    label: labels["menu-end-mode-repeat"],
                    accelerator: 'Alt+R',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'end-mode-repeat');
                    }
                },
                {
                    label: labels["menu-end-mode-next"],
                    accelerator: 'Alt+N',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'end-mode-next');
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
                    accelerator: 'Shift+Alt+I',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'in-point');
                    }
                },
                {
                    label: labels["menu-set-out-point"],
                    accelerator: 'Shift+Alt+O',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'out-point');
                    }
                },
                { type: 'separator' },
                {
                    label: labels["menu-copy-item-state"],
                    accelerator: 'CommandOrControl+C',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'copy-item-state');
                    }
                },
                {
                    label: labels["menu-paste-item-state"],
                    accelerator: 'CommandOrControl+V',
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
                    accelerator: 'CommandOrControl+1',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', '1');
                    }
                },
                {
                    label: labels["menu-playlist2"],
                    accelerator: 'CommandOrControl+2',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', '2');
                    }
                },
                {
                    label: labels["menu-playlist3"],
                    accelerator: 'CommandOrControl+3',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', '3');
                    }
                },
                {
                    label: labels["menu-playlist4"],
                    accelerator: 'CommandOrControl+4',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', '4');
                    }
                },
                {
                    label: labels["menu-playlist5"],
                    accelerator: 'CommandOrControl+5',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', '5');
                    }
                },
                { type: 'separator' },
                {
                    label: labels["menu-save-mode"],
                    accelerator: 'CommandOrControl+S',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'save');
                    }
                },
                {
                    label: labels["menu-delete-mode"],
                    accelerator: 'CommandOrControl+D',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'delete');
                    }
                },
                {
                    label: labels["menu-clear-playlist"],
                    accelerator: 'CommandOrControl+K',
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
                    accelerator: 'CommandOrControl+,',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'CommandOrControl+,');
                    }
                },
                {
                    label: labels["menu-audio-fade-out"],
                    accelerator: 'CommandOrControl+.',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'CommandOrControl+.');
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
                            console.log('[main.js] Menu: Fullscreen window not available for screenshot capture.');
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
                    accelerator: 'CommandOrControl+R',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'repeat');
                    }
                },
                {
                    label: labels["menu-list-mode-list"],
                    accelerator: 'CommandOrControl+L',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'list');
                    }
                },
                { type: 'separator' },
                {
                    label: labels["menu-direct-mode"],
                    accelerator: 'Shift+Alt+D',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'Shift+Alt+D');
                    }
                },
                {
                    label: labels["menu-soundpad-mode"],
                    accelerator: 'Shift+Alt+S',
                    click: () => {
                        mainWindow.webContents.send('shortcut-trigger', 'Shift+Alt+S');
                    }
                },
                {
                    label: labels["menu-fillkey-mode"],
                    accelerator: 'Shift+Alt+F',
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
                    accelerator: 'Alt+W',
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
                    label: labels["menu-tools-atem-connection"],
                    click: () => {
                        createAtemSettingsWindow();
                    }
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
                      message: `VTRPON\nVersion: ${app.getVersion()}\nDeveloped by Tetsu Suzuki.\nReleased under the GNU General Public License (GPL)`,
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
function createMainWindow() {
    // プライマリディスプレイのサイズを取得
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor; // 拡大率（例: 1.5で150%拡大）

    mainWindow = new BrowserWindow({
        width: width,   // ディスプレイ幅そのまま
        height: height, // ディスプレイ高さそのまま
        icon: path.join(__dirname, 'assets/icons/icon.png'), // アイコンファイル
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false,              
            webSecurity: true, 
            nodeIntegrationInSubFrames: true,
            backgroundThrottling: false 
        }
    });

    // スケーリングの調整はそのまま残す
    mainWindow.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.setZoomFactor(1 / scaleFactor); // スケーリング補正を適用
        }
    });

    // ウィンドウ生成後のdid-finish-loadイベントリスナー登録
    mainWindow.webContents.on('did-finish-load', function handleDidFinishLoad() {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.setZoomFactor(1 / scaleFactor);
        } else {
            console.log('[main.js] mainWindow has already been destroyed before adjusting the zoom factor.');
        }
    });


    mainWindow.on('closed', () => {
        mainWindow = null; // mainWindow参照をクリア

        // アプリ全体を終了する
        if (process.platform !== 'darwin') {
            app.quit(); // macOS以外ではアプリを終了
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('language-changed', global.currentLanguage);
        mainWindow.setTitle(`VTR-PON2  ver.${app.getVersion()}`);
    });
}

// フルスクリーンウインドウの生成
function createFullscreenWindow() {
    const displays = screen.getAllDisplays();
    const externalDisplay = displays.find((display) => display.bounds.x !== 0 || display.bounds.y !== 0);

    fullscreenWindow = new BrowserWindow({
        fullscreen: true,
        x: externalDisplay ? externalDisplay.bounds.x : undefined,
        y: externalDisplay ? externalDisplay.bounds.y : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    fullscreenWindow.loadFile('fullscreen.html'); 
    fullscreenWindow.setMenuBarVisibility(false);

    fullscreenWindow.on('closed', () => {
        fullscreenWindow = null; // フルスクリーンウィンドウが閉じられたらリセット
        // フルスクリーンウィンドウが閉じられた場合、アプリ全体を終了する
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
    global.deviceSettings = {
        editAudioMonitorDevice: "non-default",  // OS標準出力以外のデバイス
        onairAudioOutputDevice: "default",        // OS標準出力
        fullscreenVideoOutputDevice: defaultFullscreenVideoOutputDevice,
        uvcAudioInputDevice: ""                   // 空（後で設定予定）
    };
    console.log('[main.js] 初期デバイス設定:', global.deviceSettings);

    // ウインドウ初期化を実行
    createFullscreenWindow();
    createMainWindow();
    registerSafeFileProtocol();

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
        height: 650,
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
        height: 400,
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
    global.deviceSettings = settings;
    console.log('[main.js] Updated device settings:', global.deviceSettings);
    // 全ウィンドウへ新しいデバイス設定情報をブロードキャストする
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('device-settings-updated', global.deviceSettings);
    });
});

// メインプロセス側でデバイス設定を返すハンドラー
ipcMain.handle('get-device-settings', () => {
    return global.deviceSettings || {};
});

// ---------------------------------------------
// 録画設定ウインドウ
// ---------------------------------------------

// 録画設定ウインドウの生成
function createRecordingSettingsWindow() {
  recordingSettingsWindow = new BrowserWindow({
    width: 500,
    height: 550,
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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return (result.canceled || result.filePaths.length === 0)
    ? null
    : result.filePaths[0];
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
    console.log(`[main.js] MAIN: NEXT mode complete event received for Item ID: ${currentItemId}`); // デバッグログ追加

    // ブロードキャスト
    BrowserWindow.getAllWindows().forEach(window => {
        console.log(`[main.js] MAIN: Broadcasting next-mode-complete for Item ID: ${currentItemId}`); // ブロードキャストのログ
        window.webContents.send('next-mode-complete-broadcast', currentItemId);
    });
});

// -----------------------------------------------------
// フルスクリーンからオンエアに音量情報を送る
// -----------------------------------------------------
// フルスクリーンエリアから送信された音量データをオンエアエリアに転送
ipcMain.on('fullscreen-audio-level', (event, dBFS) => {
    if (mainWindow) {
        mainWindow.webContents.send('fullscreen-audio-level', dBFS);
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
    if (pptxConverterWinax.available() === false) {
        console.error("[main.js] convert-pptx-to-png-winax is only supported");
        throw new Error("Unsupported platform for PPTX to PNG conversion.");
    }
    try {
        const outputFolder = await pptxConverterWinax.convertPPTXToPNG(pptxPath);
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
    let extensions = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'wav', 'mp3', 'flac', 'aac', 'm4a', 'png', 'mpeg'];
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

// ---------------------------------
// ドラッグ＆ドロップで追加されたファイルを処理する
// ---------------------------------
ipcMain.on('files-dropped', (event, files) => {
    console.log('[main.js] Received dropped files:', files);
    const allowedExtensions = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'wav', 'mp3', 'flac', 'aac', 'm4a', 'png', 'mpeg', 'pptx'];
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

        // ファイルの存在確認
        // 1) path が "UVC_DEVICE" で始まる場合は存在チェックから除外
        // 2) それ以外は fs.existsSync() で実ファイルを確認
        const invalidFiles = playlistData.playlists.flatMap(playlist =>
            playlist.data.filter(file => {
                // UVCデバイスならOK
                if (typeof file.path === 'string' && file.path.startsWith('UVC_DEVICE')) {
                    return false; // 不正ファイルではない
                }
                // UVCデバイス以外で実ファイルが存在しない場合は不正ファイル
                return !fs.existsSync(file.path);
            })
        );
        if (invalidFiles.length > 0) {
            return {
                success: false,
                error: `Some files are missing: ${invalidFiles.map(f => f.path).join(', ')}`,
            };
        }

        console.log(`[main.js] Playlist imported from: ${filePaths[0]}`);
        return { success: true, data: playlistData };
    } catch (error) {
        console.error('Error importing playlist:', error);
        return { success: false, error: 'Failed to read or parse JSON file' };
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

// 時間を hh:mm:ss 形式にフォーマットする関数
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const fractionalSeconds = (seconds % 1).toFixed(2).substring(1); // 小数部分 ".xx" を取得
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${fractionalSeconds}`;
}

// フレーム対応の時間フォーマット関数
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
    const displays = screen.getAllDisplays();
    const currentDisplayIndex = displays.findIndex(display =>
        display.bounds.x === fullscreenWindow.getBounds().x &&
        display.bounds.y === fullscreenWindow.getBounds().y
    );
    const nextDisplay = displays[(currentDisplayIndex + 1) % displays.length];
    fullscreenWindow.setBounds({
        x: nextDisplay.bounds.x,
        y: nextDisplay.bounds.y,
        width: nextDisplay.bounds.width,
        height: nextDisplay.bounds.height
    });
    fullscreenWindow.setFullScreen(true); // フルスクリーン状態を保持
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

    // Alt+W - Move Fullscreen Window
    globalShortcut.register('Alt+W', () => {
        moveFullscreenToNextDisplay(); // フルスクリーンウィンドウを次のディスプレイに移動
        console.log('[main.js] Alt+W triggered: Moved fullscreen window to next display.');
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
            for (let i = 1; i <= 5; i++) {
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

// macOSでウインドウが全て閉じられた後に再度アイコンがクリックされた場合の処理
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

