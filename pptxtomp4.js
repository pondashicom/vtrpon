// -----------------------
//     pptxtomp4.js
//     ver 2.4.6
// -----------------------


// PPTXからPNG連番への変換と、連番PNGから動画生成する処理
async function pptxtomp4_convertPPTXToMp4(pptxPath) {
    try {
        // PPTXファイルのディレクトリとベース名を取得
        const pptDir = window.electronAPI.path.dirname(pptxPath);
        const pptBase = window.electronAPI.path.basename(pptxPath)
                            .replace(window.electronAPI.path.extname(pptxPath), '');
        // 出力先フォルダは "<PPTXファイル名>_pngconvert" とする
        const outputFolder = pptDir + "\\" + pptBase + "_pngconvert";

        // winaxを利用してPPTXをPNG連番に変換する
        try {
            const outputFolder = await window.electronAPI.convertPptxToPngWinax(pptxPath);
            console.log("[pptxtomp4.js] PNG出力フォルダ:", outputFolder);
        } catch (error) {
            showMessage("PPTX conversion failed: " + (error.message || error), 5000, "alert");
            throw error;
        }

        // 出力フォルダ内のPNGファイル一覧を取得する
        let pngFiles = await window.electronAPI.getPngFiles(outputFolder);
        if (!pngFiles || pngFiles.length === 0) {
            throw new Error("No PNG files found.");
        }
        // PNGファイルを数値順にソート（例："Slide_001.png", "Slide_002.png", ...）
        pngFiles.sort((a, b) => {
            const getNum = s => {
                const match = s.match(/(\d+)\.png$/i);
                return match ? parseInt(match[1], 10) : 0;
            };
            return getNum(a) - getNum(b);
        });

        // 1スライドあたりの表示秒数を取得（fadeInDuration入力の値）
        const durationInput = document.getElementById('fadeInDuration');
        const duration = parseInt(durationInput.value, 10) || 1;
        const slideDuration = duration;
        // 出力動画のフレームレート（再生環境に合わせて30fpsに固定）
        const outputFps = 30;

        // ディゾルブ利用フラグ（UI側で id="pptxDissolve" のチェックボックスを用意する想定）
        const dissolveCheckbox = document.getElementById('pptxDissolve');
        const useDissolve = !!(dissolveCheckbox && dissolveCheckbox.checked && slideDuration > 0.5 && pngFiles.length > 1);

        // タイムスタンプとカウンターを用いて出力動画ファイル名を生成する
        const now = new Date();
        const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const timestamp = jstNow.toISOString().replace(/T/, '-').replace(/:/g, '-').split('.')[0];
        if (!window.convertCounter) { window.convertCounter = {}; }
        if (!window.convertCounter[timestamp]) { window.convertCounter[timestamp] = 1; }
        const counter = window.convertCounter[timestamp]++;
        const outputVideoPath = window.electronAPI.path.join(pptDir, `${pptBase}_video_${timestamp}-${counter}.mp4`);

        let ffmpegArgs;

        if (useDissolve) {
            // -----------------------------
            // ディゾルブあり（0.5秒固定）
            // 各PNGから slideDuration 秒のクリップを作成し、xfadeで順次クロスディゾルブ
            // -----------------------------
            const dissolveDuration = 0.5;

            // 入力（各PNGを -loop 1 -t <秒数> で読み込む）
            const inputArgsParts = [];
            for (let i = 0; i < pngFiles.length; i++) {
                inputArgsParts.push(`-loop 1 -t ${slideDuration} -i "${pngFiles[i]}"`);
            }
            const inputArgs = inputArgsParts.join(' ');

            // filter_complex で xfades を連結
            let filterComplex = "";
            let prevLabel = "0:v";
            let totalDuration = slideDuration;
            for (let i = 1; i < pngFiles.length; i++) {
                const outLabel = (i === pngFiles.length - 1) ? "vfinal" : `v${i}`;
                const offset = totalDuration - dissolveDuration;
                filterComplex += `[${prevLabel}][${i}:v]xfade=transition=fade:duration=${dissolveDuration}:offset=${offset}[${outLabel}];`;
                totalDuration = totalDuration + slideDuration - dissolveDuration;
                prevLabel = outLabel;
            }
            if (filterComplex.endsWith(";")) {
                filterComplex = filterComplex.slice(0, -1);
            }

            ffmpegArgs = `-y ${inputArgs} -filter_complex "${filterComplex}" -map "[vfinal]" -r ${outputFps} -c:v libx264 -g 1 -pix_fmt yuv420p "${outputVideoPath}"`;
        } else {
            // -----------------------------
            // ディゾルブなし（従来のシンプルなスライドショー）
            // -----------------------------
            // 入力側のフレームレート（1枚あたりの秒数に合わせる）
            const framerate = `1/${slideDuration}`;
            // PNGファイル名は "Slide_XXX.png" 形式（3桁連番）とする
            // FFmpeg 推奨の image2 入力 + 明示的な出力fps 指定で黒フレームを抑制
            ffmpegArgs = `-y -framerate ${framerate} -start_number 1 -i "${outputFolder}\\Slide_%03d.png" -c:v libx264 -r ${outputFps} -g 1 -pix_fmt yuv420p "${outputVideoPath}"`;
        }

        console.log("[pptxtomp4.js] FFmpeg args:", ffmpegArgs);

        // FFmpegによる動画変換を実行
        await window.electronAPI.execFfmpeg(ffmpegArgs);
        console.log("[pptxtomp4.js] Conversion completed. Output:", outputVideoPath);

        // 変換した動画のパスを返す
        return outputVideoPath;
    } catch (error) {
        console.error("[pptxtomp4.js] Error:", error);
        throw error;
    }
}

// 非同期変換
async function convertPptxToMp4(originalPath, tempEntryPath) {
    // 変換開始前に仮エントリの状態を更新
    let playlist = await window.electronAPI.stateControl.getPlaylistState();
    const tempIndex = playlist.findIndex(item => item.path === tempEntryPath);
    if (tempIndex !== -1) {
         playlist[tempIndex].converting = true;
         playlist[tempIndex].mediaOffline = false;
         playlist[tempIndex].resolution = "Converting...";
         playlist[tempIndex].duration = "00:00:10:00";
         await window.electronAPI.stateControl.setPlaylistState(playlist);
         await updatePlaylistUI();
    }

    let mp4Path;
    try {
         mp4Path = await pptxtomp4_convertPPTXToMp4(originalPath);
    } catch (error) {
         console.error(`[pptxtomp4.js] PPTX conversion failed: ${originalPath}`, error);
         // エラーメッセージを Info ウィンドウに表示
         showMessage("PPTX conversion failed. PowerPoint may not be running properly.", 5000, "alert");

         // 失敗時に仮エントリをエラー状態に更新
         if (tempIndex !== -1) {
             playlist[tempIndex].converting = false;
             playlist[tempIndex].mediaOffline = true;
            const errorCanvas = document.createElement('canvas');
            errorCanvas.width = 112;
            errorCanvas.height = 63;
            const errorCtx = errorCanvas.getContext('2d');
            errorCtx.fillStyle = 'red';
            errorCtx.fillRect(0, 0, errorCanvas.width, errorCanvas.height);
            errorCtx.fillStyle = 'white';
            errorCtx.font = '14px Arial';
            errorCtx.textAlign = 'center';
            errorCtx.textBaseline = 'middle';
            errorCtx.fillText('Error', errorCanvas.width / 2, errorCanvas.height / 2);
            playlist[tempIndex].thumbnail = errorCanvas.toDataURL('image/png');
            await window.electronAPI.stateControl.setPlaylistState(playlist);
            await updatePlaylistUI();
         }
         return;
    }
    if (!mp4Path) {
         console.error(`[pptxtomp4.js] PPTX conversion failed: ${originalPath}`);
         if (tempIndex !== -1) {
             playlist[tempIndex].converting = false;
             await window.electronAPI.stateControl.setPlaylistState(playlist);
             await updatePlaylistUI();
         }
         return;
    }
    console.log(`[pptxtomp4.js] PPTX conversion complete, updating playlist: ${mp4Path}`);
    let metadata;
    try {
         metadata = await window.electronAPI.getMetadata(mp4Path);
    } catch (err) {
         console.error(`[pptxtomp4.js] Failed to retrieve metadata for MP4: ${mp4Path}`, err);
         metadata = { resolution: "Unknown", duration: "00:00:10:00" };
    }
    const finalPlaylist = await window.electronAPI.stateControl.getPlaylistState();
    const finalIndex = finalPlaylist.findIndex(item => item.path === tempEntryPath);
    if (finalIndex !== -1) {
         finalPlaylist[finalIndex].path = mp4Path;
         finalPlaylist[finalIndex].name = window.electronAPI.path.basename(mp4Path);
         finalPlaylist[finalIndex].thumbnail = await generateThumbnail(mp4Path);
         finalPlaylist[finalIndex].resolution = metadata.resolution || "Unknown";
         finalPlaylist[finalIndex].duration = metadata.duration || "00:00:10:00";
         finalPlaylist[finalIndex].inPoint = "00:00:00:00";
         finalPlaylist[finalIndex].outPoint = metadata.duration || "00:00:10:00";
         finalPlaylist[finalIndex].mediaOffline = false;
         finalPlaylist[finalIndex].converting = false;
         await window.electronAPI.stateControl.setPlaylistState(finalPlaylist);
         await updatePlaylistUI();
    }
}

// グローバルに公開
window.pptxConverter = {
    convertPPTXToMp4: pptxtomp4_convertPPTXToMp4,  // 単体呼び出し用（Promise版）
    convertPptxToMp4: convertPptxToMp4            // Loadingエントリ対応版
};
