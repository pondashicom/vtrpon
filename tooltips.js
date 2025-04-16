// -----------------------
//     tooltips.js
//     ver 2.2.8
// -----------------------


const tooltips = {
  "ja": {
    "in-point": "動画の再生を開始するポイントを設定します",
    "out-point": "動画の再生を終了するポイントを設定します",
    "start-pause-button": "IN点で一時停止した状態でオンエアします",
    "start-play-button": "オンエアと同時にIN点から再生を開始します",
    "start-fadein-button": "オンエアと同時にIN点から音声、映像をフェードインしながら再生を開始します。フェードイン時間はエディットエリアのFTB秒数で設定",
    "end-off-button": "OUT点に到達したらオフエアします",
    "end-pause-button": "OUT点に到達したら一時停止します",
    "end-repeat-button": "OUT点に到達したらIN点に戻って再生を繰り返します",
    "end-next-button": "OUT点に到達したらプレイリストの次の動画をオンエアします",
    "end-ftb-button": "OUT点に到達したらフェードアウトしてオフエアします",
    "ftbRate": "FTBやスタートモードFADEINでフェードする時間（秒）を設定します",
    "pfl-button": "Device Settingsメニューで設定したPFLデバイスを使ってプリフェーダーリッスンします",
    "listedit-volume-slider": "オンエア開始時の規定音量を設定します",
    "addUVCToPlaylistButton": "選択したUVCデバイスをプレイリストに追加します",
    "still-button": "エディットエリアに表示されている動画をキャプチャーしてプレイリストに登録します",
    "fadeInDuration": "CAPTUREボタン押下時やPNGファイル登録時に指定秒数でMP4動画に変換して登録します",
    "list-repeat-button": "プレイリスト全体のアイテムをスタートモード[PLAY]、エンドモード[NEXT]に設定します",
    "list-list-button": "プレイリスト上部をスタートモード[PAUSE]、中間を[PLAY]、下部を[PLAY]または[FTB]に設定します",
    "directonair-mode-button": "アイテムをダブルクリックすると即座にスタートモード[PLAY]に設定しオンエアします（エンドモードは保持）",
    "soundpad-mode-button": "アイテムをダブルクリックすると即座にスタートモード[PLAY]、エンドモード[OFF]に設定してオンエアします",
    "fillkey-mode-button": "ビデオプレーヤーの背景を緑にして透過情報付き動画を送出し、フィルキー信号を出力します",
    "playlise-save-button": "SAVEモード中にプレイリスト番号をクリックしてプレイリストを保存します",
    "playlisedel-button": "DELETEモード中にプレイリスト番号をクリックしてプレイリストを削除します",
    "playliseclear-button": "表示中のプレイリストのアイテムをクリアし、DIRECT、SOUNDPAD、FILLKEYモードも解除します",
    "file-button": "プレイリストにファイルを追加します",
    "cue-button": "フルスクリーンにアイテムを投影します",
    "on-air-item-volume-slider": "アイテム固有のボリュームを調整します。ネクストモードや次のオンエアでアイテムごとの音量にリセットされます",
    "on-air-master-volume-slider": "システム全体のボリュームを調整します。ネクストモードや次のオンエアをしても音量は保持されます",
    "on-air-item-fo-button": "アイテム固有の音声をフェードアウトします。フェード時間はエディットエリアのFTBボタン横の数字で指定します",
    "on-air-item-fi-button": "アテム固有音声をフェードインします。フェード時間はエディットエリアのFTBボタン横の数字で指定します",
    "on-air-fo-button": "メイン音声をフェードアウトします。フェード時間はフェードインボタンとフェードアウトボタンの間の数字で指定します",
    "on-air-fi-button": "メイン音声をフェードインします。フェード時間はフェードインボタンとフェードアウトボタンの間の数字で指定します",
    "playback-speed-slider": "スライダー操作中に動画の再生速度を変更します",
    "playback-speed-input": "動画の再生速度を変更します。スライダー操作でリセット",
    "captuer-button": "フルスクリーン動画のスクリーンショットをPNGとして保存します",
    "rec-button": "フルスクリーンに投影されている動画を録画します。最初に押すと録画開始、もう一度押すとファイルとして録画を保存し、プレイリストに登録します。",
    "off-air-button": "フルスクリーン動画をオフエアします",
    "ftb-off-button": "フルスクリーン動画をフェードアウトします。フェード時間はエディットエリアのFTB秒数で設定",
    "on-air-pause-button": "フルスクリーン動画を一時停止します",
    "on-air-play-button": "フルスクリーン動画を再生します"
  },
  "en": {
    "in-point": "Set the start point for video playback",
    "out-point": "Set the end point for video playback",
    "start-pause-button": "Air on pause at the IN point",
    "start-play-button": "Start playback at the IN point on air",
    "start-fadein-button": "Begin playback with audio and video fading in from the IN point simultaneously with going on-air. The fade-in duration is set by the seconds specified next to the FTB button in the edit area",
    "end-off-button": "Turn off air when reaching the OUT point",
    "end-pause-button": "Pause when reaching the OUT point",
    "end-repeat-button": "Repeat playback from the IN point upon reaching the OUT point",
    "end-next-button": "Air the next video in the playlist when reaching the OUT point",
    "end-ftb-button": "Fade out and turn off air when reaching the OUT point",
    "ftbRate": "Set the fade time (in seconds) for FTB and Start Mode FADEIN.",
    "pfl-button": "Listen using the PFL device set in the Device Settings menu",
    "listedit-volume-slider": "Set the default volume at air start",
    "addUVCToPlaylistButton": "Add the selected UVC device to the playlist",
    "still-button": "Capture the video displayed in the edit area and add it to the playlist",
    "fadeInDuration": "Set the duration (seconds) for converting to MP4 when capturing or registering a PNG file",
    "list-repeat-button": "Set all items in the playlist to Start Mode [PLAY] and End Mode [NEXT]",
    "list-list-button": "Set the top item to Start Mode [PAUSE], middle items to [PLAY], and the bottom item to [PLAY] or [FTB]",
    "directonair-mode-button": "Double-click an item to immediately set it to Start Mode [PLAY] for air (End Mode remains unchanged)",
    "soundpad-mode-button": "Double-click an item to immediately set it to Start Mode [PLAY] and End Mode [OFF] for air",
    "fillkey-mode-button": "Set the video player’s background to green and output a video with transparency for the fill key signal",
    "playlise-save-button": "Save the playlist by clicking a playlist number while in SAVE mode",
    "playlisedel-button": "Delete the playlist by clicking a playlist number while in DELETE mode",
    "playliseclear-button": "Clear the items of the current playlist and disable DIRECT, SOUNDPAD, and FILLKEY modes",
    "file-button": "Add a file to the playlist",
    "cue-button": "Project the item to the fullscreen display",
    "on-air-item-volume-slider": "Adjust the volume for each item. The volume will reset to the item's level in Next Mode or on the next on-air.",
    "on-air-master-volume-slider": "Adjust the overall system volume. The volume remains even in Next Mode or on the next on-air.",
    "on-air-item-fo-button": "Fades out the audio specific to the item. The fade time is specified by the number next to the FTB button in the edit area.",
    "on-air-item-fi-button": "Fades in the audio specific to the item. The fade time is specified by the number next to the FTB button in the edit area.",
    "on-air-fo-button": "Fade out the main audio. The fade duration is specified by the number between the fade-in and fade-out buttons.",
    "on-air-fi-button": "Fade in the main audio. The fade duration is specified by the number between the fade-in and fade-out buttons.",
    "playback-speed-slider": "Adjust the playback speed while sliding",
    "playback-speed-input": "Change the playback speed; resets when the slider is used",
    "captuer-button": "Capture a screenshot of the fullscreen video and save it as a PNG in the same directory as the video",
    "rec-button": "Record the video projected in fullscreen. Press once to start recording, and press again to save the recording as a file and add it to the playlist.",
    "off-air-button": "Turn off the fullscreen video projection",
    "ftb-off-button": "Fade out the fullscreen video. Duration is set by the seconds specified next to the FTB button in the edit area",
    "on-air-pause-button": "Pause the fullscreen video projection",
    "on-air-play-button": "Play the fullscreen video projection"
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tooltips;
} else {
  window.tooltips = tooltips;
}


// Expose the tooltips object globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = tooltips;
} else {
  window.tooltips = tooltips;
}
