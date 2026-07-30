# SPLIT-PON Addon control

## 正式master候補の位置付け

この実装は正式`master`へ採用する最小ADDON連携候補である。VTR-PON2は既存の
Fullscreen／OnAir／DSK／FTB表示を維持し、Electron main processから外部ADDON
hostを制御する。開発用の診断runner、試験専用IPC、ADDON実行binaryは含めない。
ADDON UIを最初に正式搭載するVTR-PON2 versionは`2.6.5`とする。

Windows固有のcapture、変換、queue、SPLIT-PON Core、Output Adapter、Job Object、
worker再起動policyはVTR-PON2へ入れず、独立repository
`G:\vtrpon2-splitpon-addon`が所有する。

```text
VTR-PON2 Electron main process
  ├─ local Named Pipe／JSON Lines control
  │   └─ vtrpon2-split-pon-addon-host.exe
  │       └─ worker generation
  └─ Operator Monitor OSD sideband
      └─ ADDON側の最終OSD表示process
```

## 正式な制御境界

VTR-PON2側controllerは、起動・停止・障害隔離を行うADDON hostの完成形として次を
使用する。

- `hello`
- `status.get`
- `capture.borderless.check`
- `outputs.set`（protocol v3）
- `system.start`
- `system.stop`
- `shutdown`
- workerのdesired／observed state、generation、PID、終了コード、error
- NDI／Operator Monitorの全desired stateと共有Input／Core state
- `--controller-pid`、`--worker`、`--worker-arg`、`--ready-timeout-ms`、
  `--heartbeat-timeout-ms`、`--stop-timeout-ms`、`--exit-on-disconnect`

正規workspace`G:\vtrpon2-splitpon-addon`は、Named Pipe host、worker state／error、
Job Object、再起動、停止、process cleanupを所有する。VTR-PON2側statusは
`component`、`code`、`nativeCode`、`message`、`attempt`、`timestamp`を保持する。
実binaryを使う統合診断はADDON repository側で行い、VTR-PON2正式差分にはrunnerを
持ち込まない。
host起動時にはVTR-PON2 main process PIDを`--controller-pid`で渡し、ADDON hostが
`GetNamedPipeClientProcessId`で得た実PIDおよびhello申告PIDと照合する。

ADDON側の開発受入結果はこの正式候補の入力とするが、installer、clean machine
lifecycle、配布GOは別判定として保持する。

## VTR-PON2側の操作

正常導入時だけ、主画面の`ADDITIONAL OUTPUT`と「ツール」メニューの
`Output Control`を表示する。未導入時は表示せず、破損導入時は
「修復が必要」として操作不可にする。

- `NDI出力`: High Quality用Outputのdesired stateを切り替える。
- `オペレーターモニター`: Live ultra-low-latency Outputのdesired stateを切り替える。
- `ADDONを停止`: 全Output、共有Core／Inputを止めた後、ADDON hostを終了する。
- `状態を表示`: host、共有Input／Core、各Outputのdesired／observed stateとerrorを表示する。

VTR-PON2は`outputs.set`で二つの全desired stateだけを送る。Input／Core／Output
componentへ直接start／stopを送らない。ADDON hostは最初のOutputで共有Input／Coreを
起動し、最後のOutput停止時だけ共有processを止める。
正式componentではready 45秒、heartbeat 5秒、stop 15秒をhostへ渡す。
`outputs.set`中は定期`status.get`を止め、共有Input／CoreとOutputの二段階起動を
最大95秒待つ。既にtimeoutとなったrequestの応答が後着してもcontrol pipeの
protocol failureにはしない。

workerが異常終了してもElectron main processは終了しない。状態を`failed`へ更新し、
自動再起動は行わない。次の起動はユーザー操作で新しいgenerationとして行う。

VTR-PON2終了時は`before-quit`でADDON hostへ停止・終了を要求する。応答しないhostは
VTR-PON2側controllerが終了させるが、VTR-PON2本体の終了は妨げない。

## executableの解決

製品packageはVTR-PON2へ混載しない。ADDON installerが次へ配置する。

```text
%ProgramFiles%\Pondashi\VTR-PON2 SPLIT-PON ADDON\
  vtrpon2-split-pon-addon-host.exe
  addon-manifest.json
  components\
    vtrpon2-input-worker.exe
    split-pon-core-worker.exe
    split-pon-output-ndi-worker.exe
    vtrpon2-operator-monitor-worker.exe
```

VTR-PON2は次のmachine-wide install markerを読む。

```text
%ProgramData%\Pondashi\VTR-PON2\addons\
  pondashi.vtrpon2.splitpon-addon.json
```

markerがなければ未導入、markerがありmanifest／version／必須binaryが不正なら
導入済みだが利用不可として「修復が必要」とする。正常導入でもOutput開始要求前は
host／workerを起動しない。正式packageはinstall marker以外からADDONを解決せず、
`process.resourcesPath`直下へADDONを同梱または探索しない。

開発用stageはADDON repositoryで
`scripts\Stage-M6DevelopmentAddon.ps1`を実行して生成し、未packageのElectron開発実行
だけで次の明示overrideへ接続できる。package済みVTR-PON2はこの環境変数を無視する。

```powershell
$env:VTRPON2_SPLITPON_ADDON_MANIFEST = `
  'G:\vtrpon2-splitpon-addon\out\m6-addon\addon-manifest.json'
```

`VTRPON2_SPLITPON_ADDON_HOST`／`VTRPON2_SPLITPON_ADDON_WORKER`／
`VTRPON2_SPLITPON_ADDON_ALLOW_DUMMY_CRASH=1`は旧control-plane診断専用であり、
実media workerの製品経路には使用しない。

非Windowsまたは未導入ではOutput UIを表示しない。markerがある破損導入は
`[修復が必要]`として操作不可にし、VTR-PON2の通常機能はそのまま動作する。

## Windows／macOS境界

ADDON連携はWindows版だけで有効にする。macOS版は
`loadSplitPonOptionalRuntime()`の入口でno-op runtimeへ移り、Windows用controller、
capture permission、audio pipe、Operator Monitor sideband moduleを読み込まない。
preloadはADDON用IPCとaudio bridgeをrendererへ公開せず、main processもADDON用IPCを
登録しない。Tools／主画面／AboutにもADDONまたはNDI出力を表示しない。

DSKの配置と通常動作、共通UI整理、Fullscreen／OnAir、旧内蔵Operator Monitorの廃止は
platform共通変更として維持する。したがってmacOS版にもこれらを適用するが、廃止した
旧Operator MonitorをADDON版で置き換えない。macOS版にはOperator Monitor出力自体を
提供しない。

Windows／macOSのrelease source gateは共通のtag、clean worktree、source noticeを
確認し、FFmpeg／ffprobeはbuildを実行しているplatformのnpm package解決先を検査する。
Windows固定の`.exe` pathをmacOS releaseへ要求しない。

## WGC capture borderの共通preflight

Operator MonitorとNDI出力は、どちらもVTR-PON2 FullscreenをWGCで取得する。
黄色いcapture borderをFullscreenへ出さないため、各出力の開始操作は
共通の`ensureSplitPonCapturePermission()`を最初に呼ぶ。

VTR-PON2はADDON hostへ`capture.borderless.check`を送り、
`AppCapability.CheckAccess()`の現在値だけを確認する。このcommandは
Windowsの許可prompt、worker起動、capture開始を行わない。
許可されていない場合は出力を開始せず、`global.currentLanguage`に対応した
日本語または英語のdialogだけを表示する。
「必要な設定画面を開く」は
`ms-settings:privacy-graphicscapturewithoutborder`を開く。
設定後の自動再試行はせず、ユーザーが出力開始をもう一度実行する。

2026-07-28時点でこの共通gateは正式NDI／Operator Monitor checkboxのうち、最初の
Outputを開始する操作へ接続済みである。二つ目のOutput追加時は共有captureが動作中の
ため再確認しない。ADDON Input Adapter側のfail-closed判定も残し、競合や設定変更が
あっても黄色枠付きcaptureへfallbackしない。

Operator Monitor OSDはworker controlとは別の一方向sidebandである。開発時は
`VTRPON2_SPLITPON_OPERATOR_MONITOR_PIPE`へlocal Named Pipe名を設定する。
VTR-PON2は`REMAIN`／`DUR`／`START MODE`／`ENDMODE`、表示色、FTB／DSKの
active状態だけを送り、
ADDON側がSPLIT-PON Operator Monitorの最終表示へ重ねる。映像合成、別ウィンドウ、
音声制御をVTR-PON2へ戻さない。OSDはbest-effortであり、未接続時のstateを
queueまたは再送せず破棄する。

Program音声pipeとOSD pipeはVTR-PON2 main process PIDから安定名を生成する。
Program音声tapはADDONがない通常動作では休眠し、最初のOutput開始要求で有効化し、
最後のOutput停止またはADDON停止で切断する。Fullscreen renderer再生成時は
`did-finish-load`後に有効状態と新しいpresentation情報を再通知する。

## 確認

JS単体テスト:

```powershell
PS G:\vtrpon2> npm test
```

ADDON側のbuild、実process統合、process残留確認はADDON repositoryの試験を使う。
VTR-PON2のJS test、ADDONの自動test、clean machine確認、ユーザー目視、配布GOは
それぞれ別判定として保持する。
