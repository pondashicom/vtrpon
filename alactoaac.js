// -----------------------
//     alactoaac.js
//     ver 2.6.0
// -----------------------

// ALAC M4A を AAC M4A に変換する関数
async function convertAlacToAac(inputPath) {
    try {
        const now = new Date();
        const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const timestamp = jstNow.toISOString().replace(/T/, '-').replace(/:/g, '-').split('.')[0];

        if (!window.alacConvertCounter) {
            window.alacConvertCounter = {};
        }
        if (!window.alacConvertCounter[timestamp]) {
            window.alacConvertCounter[timestamp] = 1;
        }

        const counter = window.alacConvertCounter[timestamp]++;
        const outputDirectory = window.electronAPI.path.dirname(inputPath);
        const originalFileName = window.electronAPI.path.basename(inputPath).replace(window.electronAPI.path.extname(inputPath), '');
        const outputFilePath = window.electronAPI.path.join(
            outputDirectory,
            `${originalFileName}_aac_${timestamp}-${counter}.m4a`
        );

        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 68;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Converting...', canvas.width / 2, canvas.height / 2);;
        
        const tempPlaylistItem = {
            path: outputFilePath,
            name: window.electronAPI.path.basename(outputFilePath),
            thumbnail: canvas.toDataURL('image/png'),
            selectionState: "unselected",
            editingState: null,
            onAirState: null,
            mediaOffline: false
        };

        const currentPlaylist = await stateControl.getPlaylistState();
        currentPlaylist.push(tempPlaylistItem);
        await stateControl.setPlaylistState(currentPlaylist);
        await updatePlaylistUI();

        try {
            if (typeof saveActivePlaylistToStore === 'function') {
                await saveActivePlaylistToStore();
            }
        } catch (e) {
            logInfo('[alactoaac.js] Auto-save after ALAC loading entry failed (ignored):', e);
        }

        const ffmpegArgs = `-y -i "${inputPath}" -vn -map_metadata 0 -c:a aac -b:a 320k -movflags +faststart "${outputFilePath}"`;

        await window.electronAPI.execFfmpeg(ffmpegArgs);

        const updatedPlaylist = await stateControl.getPlaylistState();
        const targetIndex = updatedPlaylist.findIndex(item => item.path === outputFilePath);

        if (targetIndex !== -1) {
            updatedPlaylist[targetIndex].name = window.electronAPI.path.basename(outputFilePath);
            updatedPlaylist[targetIndex].thumbnail = await generateThumbnail(outputFilePath);
            updatedPlaylist[targetIndex].mediaOffline = false;

            await stateControl.setPlaylistState(updatedPlaylist);
            await updatePlaylistUI();

            try {
                if (typeof saveActivePlaylistToStore === 'function') {
                    await saveActivePlaylistToStore();
                }
            } catch (e) {
                logInfo('[alactoaac.js] Auto-save after ALAC conversion update failed (ignored):', e);
            }
        }

        return outputFilePath;
    } catch (err) {
        throw new Error(`convertAlacToAac error: ${err && err.message ? err.message : err}`);
    }
}