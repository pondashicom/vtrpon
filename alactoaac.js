// -----------------------
//     alactoaac.js
//     ver 2.6.1
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
            playlistItem_id: `${Date.now()}-${Math.random()}`,
            path: outputFilePath,
            name: window.electronAPI.path.basename(outputFilePath),
            resolution: 'Audio File',
            duration: 'Unknown',
            creationDate: 'Unknown',
            inPoint: "00:00:00:00",
            outPoint: "00:00:00:00",
            startMode: "PAUSE",
            endMode: "PAUSE",
            defaultVolume: 100,
            thumbnail: canvas.toDataURL('image/png'),
            selectionState: "unselected",
            editingState: null,
            onAirState: null,
            mediaOffline: false,
            isAudioFile: true,
            type: 'M4A'
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
            const metadata = await getMetadata(outputFilePath);

            currentPlaylist[targetIndex].path = outputFilePath;
            currentPlaylist[targetIndex].name = window.electronAPI.path.basename(outputFilePath);
            currentPlaylist[targetIndex].resolution = metadata.resolution || 'Audio File';
            currentPlaylist[targetIndex].duration = metadata.duration || 'Unknown';
            currentPlaylist[targetIndex].creationDate = metadata.creationDate || 'Unknown';
            currentPlaylist[targetIndex].inPoint = "00:00:00:00";
            currentPlaylist[targetIndex].outPoint = metadata.duration || "00:00:00:00";
            currentPlaylist[targetIndex].startMode = currentPlaylist[targetIndex].startMode || "PAUSE";
            currentPlaylist[targetIndex].endMode = currentPlaylist[targetIndex].endMode || "PAUSE";
            currentPlaylist[targetIndex].defaultVolume =
                typeof currentPlaylist[targetIndex].defaultVolume === 'number'
                    ? currentPlaylist[targetIndex].defaultVolume
                    : 100;
            currentPlaylist[targetIndex].thumbnail = await generateThumbnail(outputFilePath);
            currentPlaylist[targetIndex].isAudioFile = true;
            currentPlaylist[targetIndex].type = 'M4A';

            await stateControl.setPlaylistState(currentPlaylist);
            await updatePlaylistUI();

            try {
                if (typeof saveActivePlaylistToStore === 'function') {
                    await saveActivePlaylistToStore();
                }
            } catch (e) {
                logInfo('[alactoaac.js] Auto-save after ALAC conversion update failed (ignored):', e);
            }

            showMessage(getMessage('alac-converted-to-aac'), 5000, 'info');
        }

        return outputFilePath;
    } catch (err) {
        throw new Error(`convertAlacToAac error: ${err && err.message ? err.message : err}`);
    }
}