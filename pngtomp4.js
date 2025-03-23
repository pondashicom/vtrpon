// -----------------------
//     pngtomp4.js 
//     ver 2.1.5
// -----------------------

// PNGに透過が含まれているかをチェックする関数
function checkPngHasTransparency(pngPath) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      let fileUrl = pngPath;
      if (!pngPath.startsWith('file://')) {
        fileUrl = 'file:///' + pngPath.replace(/\\/g, '/');
      }
      img.src = fileUrl;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
              return resolve(true);
            }
          }
          return resolve(false);
        } catch (e) {
          return reject(e);
        }
      };
      img.onerror = (err) => {
        return reject(err);
      };
    } catch (ex) {
      return reject(ex);
    }
  });
}

// PNG → MP4 または WebM に変換する関数
async function convertPNGToVideo(pngPath) {
  try {
    const hasAlpha = await checkPngHasTransparency(pngPath);

    // 必要な変数を定義
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const timestamp = jstNow.toISOString().replace(/T/, '-').replace(/:/g, '-').split('.')[0];
    if (!window.convertCounter) { window.convertCounter = {}; }
    if (!window.convertCounter[timestamp]) { window.convertCounter[timestamp] = 1; }
    const counter = window.convertCounter[timestamp]++;
    const outputDirectory = window.electronAPI.path.dirname(pngPath);
    const originalFileName = window.electronAPI.path.basename(pngPath).replace(window.electronAPI.path.extname(pngPath), '');
    const durationInput = document.getElementById('fadeInDuration');
    const duration = parseInt(durationInput.value, 10) || 1;

    let outputFilePath, ffmpegArgs;
    if (hasAlpha) {
      outputFilePath = window.electronAPI.path.join(outputDirectory, `${originalFileName}_still_${timestamp}-${counter}.webm`);
      ffmpegArgs = `-y -loop 1 -i "${pngPath}" -c:v libvpx-vp9 -pix_fmt yuva420p -t ${duration} -auto-alt-ref 0 "${outputFilePath}"`;
    } else {
      outputFilePath = window.electronAPI.path.join(outputDirectory, `${originalFileName}_still_${timestamp}-${counter}.mp4`);
      ffmpegArgs = `-y -loop 1 -i "${pngPath}" -vf "scale=ceil(iw/2)*2:ceil(ih/2)*2" -c:v libx264 -t ${duration} -pix_fmt yuv420p "${outputFilePath}"`;
    }

    // 一時エントリをプレイリストに追加（Loading...）
    const loadingCanvas = document.createElement('canvas');
    loadingCanvas.width = 112;
    loadingCanvas.height = 63;
    const ctx = loadingCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, loadingCanvas.width, loadingCanvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', loadingCanvas.width / 2, loadingCanvas.height / 2);
    const loadingThumbnail = loadingCanvas.toDataURL('image/png');

    const tempPlaylistItem = {
      path: outputFilePath,
      name: hasAlpha ? `${originalFileName}.webm` : `${originalFileName}.mp4`,
      thumbnail: loadingThumbnail,
      selectionState: "unselected",
      editingState: null,
      onAirState: null
    };

    const currentPlaylist = await stateControl.getPlaylistState();
    const updatedPlaylist = [...currentPlaylist, tempPlaylistItem];
    await stateControl.setPlaylistState(updatedPlaylist);
    await updatePlaylistUI();

    // FFmpeg変換実行
    const result = await window.electronAPI.execFfmpeg(ffmpegArgs);
    // FFmpeg変換成功後、プレイリストエントリ更新
    const finalPlaylist = await stateControl.getPlaylistState();
    const finalIndex = finalPlaylist.findIndex(item => item.path === outputFilePath);
    if (finalIndex !== -1) {
      finalPlaylist[finalIndex].path = outputFilePath;
      finalPlaylist[finalIndex].thumbnail = await generateThumbnail(outputFilePath);
      await stateControl.setPlaylistState(finalPlaylist);
      await updatePlaylistUI();
    }
    return outputFilePath;
  } catch (err) {
    throw new Error(`convertPNGToVideo error: ${err && err.message ? err.message : err}`);
  }
}
