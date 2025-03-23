
// -----------------------
//     messages.js
//     ver 2.2.3
// -----------------------

const messages = {
  "ja": {
    "monitoring-failed": "PFL: モニタリングの開始に失敗しました。",
    "failed-to-set-device": "PFL: 選択されたデバイスの設定に失敗しました。",
    "no-video-loaded": "ビデオが読み込まれていません。",
    "no-pfl-device-selected": "PFLデバイスが選択されていません。",
    "selected-device-not-found": "PFL: 選択されたデバイスが見つかりません。デバイス設定を確認してください。",
    "in-before-out": "OUT点の前にIN点を設定する必要があります。",
    "out-after-in": "IN点の後にOUT点を設定する必要があります。",
    "failed-to-start-uvc-stream": "UVCストリームの開始に失敗しました:",
    "not-supported-file-error": "サポートされていないファイルです。エラー",
    "conversion-in-progress-cannot-select-item": "変換中です。アイテムを選択できません。",
    "media-offline": "メディアオフライン:",
    "uvc-devices-cannot-be-edited": "UVCデバイスは編集できません。",
    "no-item-in-editing-state": "\"編集中\"の状態のアイテムがありません。オンエア処理を進めることができません。",
    "on-air-started": "オンエア開始:",
    "on-air": "ON AIR",
    "on-air-error-occurred": "オンエア中にエラーが発生しました。詳細はログを確認してください。",
    "enter-playlist-name": "プレイリスト名を入力してください。",
    "failed-to-retrieve-playlist-state": "プレイリスト状態の取得に失敗しました。",
    "failed-to-save-playlist": "プレイリストの保存に失敗しました。",
    "failed-to-delete-playlist": "プレイリストの削除に失敗しました。",
    "failed-to-clear-playlist": "プレイリストのクリアに失敗しました。",
    "playlist-exported-successfully": "プレイリストが正常にエクスポートされました:",
    "failed-to-export-playlist": "プレイリストのエクスポートに失敗しました。",
    "failed-to-import-playlist": "プレイリストのインポートに失敗しました.",
    "playlists-imported-successfully": "プレイリストが正常にインポートされました。",
    "files-not-found": "以下のファイルが見つかりませんでした:",
    "repeat-mode-activated": "リピートモードが有効になりました: 全アイテムがスタートモードPLAY、エンドモードNEXTに設定されました。",
    "list-mode-activated": "リストモードが有効になりました: 編集は一時停止、順次再生、終了はFTBです。",
    "sound-pad-on-air-triggered": "SOUND PAD On-Airがトリガーされました。アイテム:",
    "direct-on-air-triggered": "DIRECT ONAIRがトリガーされました。アイテム:",
    "no-item-to-copy": "コピー可能なアイテムがありません。",
    "item-state-copied": "アイテムの状態をコピーしました。",
    "no-copied-state": "コピーされた状態がありません。",
    "no-item-to-paste": "貼付可能なアイテムがありません。",
    "item-state-pasted": "アイテムの状態を貼付しました。",
    "single-display-dialog-title": "ディスプレイの接続状況", 
    "single-display-dialog-message": "本ソフトウェアはディスプレイが2枚以上接続された状態での動作を想定しています。現在1枚のディスプレイしか接続されていませんが起動しますか？",
    "single-display-dialog-button-continue": "起動する", 
    "single-display-dialog-button-exit": "終了"
  },
  "en": {
    "monitoring-failed": "PFL: Monitoring failed to start.",
    "failed-to-set-device": "PFL: Failed to set the selected device.",
    "no-video-loaded": "No Video Loaded.",
    "no-pfl-device-selected": "No PFL Device Selected.",
    "selected-device-not-found": "PFL: Selected device not found. Please check device settings.",
    "in-before-out": "IN point must be set before the OUT point.",
    "out-after-in": "OUT point must be set after the IN point.",
    "failed-to-start-uvc-stream": "Failed to start UVC stream:",
    "not-supported-file-error": "Not Supported FILE! Error",
    "conversion-in-progress-cannot-select-item": "Conversion in progress. Cannot select item.",
    "media-offline": "Media Offline:",
    "uvc-devices-cannot-be-edited": "UVC devices cannot be edited.",
    "no-item-in-editing-state": "No item in \"editing\" state. On-Air action cannot proceed.",
    "on-air-started": "On-Air started:",
    "on-air": "ON AIR",
    "on-air-error-occurred": "An error occurred during On-Air. Check logs for details.",
    "enter-playlist-name": "Please enter a playlist name.",
    "failed-to-retrieve-playlist-state": "Failed to retrieve playlist state.",
    "failed-to-save-playlist": "Failed to save playlist.",
    "failed-to-delete-playlist": "Failed to delete playlist.",
    "failed-to-clear-playlist": "Failed to clear playlist.",
    "playlist-exported-successfully": "Playlist successfully exported to:",
    "failed-to-export-playlist": "Failed to export playlist",
    "failed-to-import-playlist": "Failed to import playlist.",
    "playlists-imported-successfully": "Playlists successfully imported",
    "files-not-found": "The following files were not found:",
    "repeat-mode-activated": "Repeat mode activated: all items set to start mode PLAY and end mode NEXT.",
    "list-mode-activated": "List mode activated: starts paused, plays sequentially, ends with FTB.",
    "sound-pad-on-air-triggered": "SOUND PAD On-Air triggered for item:",
    "direct-on-air-triggered": "DIRECT ONAIR triggered for item:",
    "no-item-to-copy": "No item available to copy.",
    "item-state-copied": "Item state copied.",
    "no-copied-state": "No copied state available.",
    "no-item-to-paste": "No item available to paste.",
    "item-state-pasted": "Item state pasted.",
    "single-display-dialog-title": "Display Check", 
    "single-display-dialog-message": "This software is designed to run with two or more displays. Only one display detected. Continue startup?", 
    "single-display-dialog-button-continue": "Continue",
    "single-display-dialog-button-exit": "Exit" 
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = messages;
} else {
  window.messages = messages;
}
