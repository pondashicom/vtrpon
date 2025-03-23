// -----------------------
//     statecontrol.js
//     ver 2.2.5
// -----------------------


// ---------------------------------------------
// プレイリストIDとアイテムIDを生成する汎用関数
// ---------------------------------------------
function generateUniqueId(prefix = '') {
    return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ------------------------------
//   プレイリスト全体の状態管理
// ------------------------------

// プレイリスト全体の状態
const playlists = []; // プレイリストオブジェクト専用

// プレイリスト全体を取得
function getAllPlaylists() {
    return [...playlists];
}

// プレイリスト全体の状態を取得するメソッド
function getPlaylistById(playlist_id) {
    const allPlaylists = getAllPlaylists(); // すべてのプレイリストを取得

    // プレイリストが存在しない場合の警告
    if (!playlist) {
        console.warn(`No playlist found for ID: ${playlist_id}`);
    } else {
        console.debug(`Playlist found: ${playlist.name}`);
    }

    // 指定されたプレイリストIDに一致するものを取得
    const playlist = allPlaylists.find(p => p.playlist_id === playlist_id) || null;

    if (playlist) {
        playlist.data = playlist.data.map((item, idx) => ({
            ...item,
            order: item.order, // 順序を補完せず、そのまま使用
            path: item.path || (item.name === "UVC_DEVICE" ? "UVC_DEVICE" : ""), // パスを補完
        }));
    }
    return playlist;
}

// -----------------------
//   プレイリストアイテム
// -----------------------

// プレイリストアイテムの状態
const playlist = []; // プレイリストアイテム専用


// プレイリストアイテムの状態を取得
function getPlaylistState() {
    return [...playlist].sort((a, b) => (a.order || 0) - (b.order || 0));
}

// プレイリスト状態を設定
function setPlaylistState(newState) {
    const oldPlaylist = [...playlist];

    playlist.length = 0;
    playlist.push(...newState.map((newItem, index) => {
        const existingItem = oldPlaylist.find(item => item.playlistItem_id === newItem.playlistItem_id);

        // console.log('[statecontrol.js] Processing item:', newItem);
        
        const updatedItem = {
            ...newItem,
            playlistItem_id: newItem.playlistItem_id || existingItem?.playlistItem_id || generateUniqueId('item_'),
            deviceId: newItem.deviceId || existingItem?.deviceId || null,
            selectionState: typeof newItem.selectionState !== 'undefined' 
                ? newItem.selectionState 
                : (existingItem?.selectionState || "unselected"),
            editingState: typeof newItem.editingState !== 'undefined' 
                ? newItem.editingState 
                : (existingItem?.editingState || null),
            onAirState: onAirState.currentOnAirItem === newItem.playlistItem_id ? "onair" : null, // 正しく適用
            startMode: newItem.startMode || existingItem?.startMode || "PAUSE",
            endMode: newItem.endMode || existingItem?.endMode || "PAUSE",
            defaultVolume: newItem.defaultVolume ?? existingItem?.defaultVolume ?? 100,
            ftbRate: typeof newItem.ftbRate !== 'undefined'
                ? newItem.ftbRate
                : (existingItem?.ftbRate || 1.0), // デフォルト値を1.0に設定
            order: typeof newItem.order !== 'undefined' ? newItem.order : (existingItem?.order ?? index),
            inPoint: typeof newItem.inPoint !== 'undefined' 
                ? newItem.inPoint 
                : (existingItem?.inPoint || "00:00:00.00"),
            outPoint: typeof newItem.outPoint !== 'undefined' 
                ? newItem.outPoint 
                : (existingItem?.outPoint || "00:00:00.00"),
            directMode: typeof newItem.directMode !== 'undefined' // 追加
                ? newItem.directMode 
                : (existingItem?.directMode || false), 
            fillKeyMode: typeof newItem.fillKeyMode !== 'undefined' // 追加
                ? newItem.fillKeyMode 
                : (existingItem?.fillKeyMode || false),
        };

        // console.log('[statecontrol.js] Updated item:', updatedItem);
        return updatedItem;
    }));
}

// --------------------------------
// ファイルをプレイリストに追加
// --------------------------------
function addFileToState(file) {
    // 現在のプレイリスト状態から最大の order を取得
    const nextOrder = playlist.reduce((max, item) => Math.max(max, item.order ?? -1), -1) + 1;

    // プレイリストに存在しない場合のみ追加
    if (!playlist.some(item => item.path === file.path)) {
        playlist.push({
            ...file,
            playlistItem_id: file.playlistItem_id || generateUniqueId('item_'),  // アイテムIDを設定
            selectionState: "unselected",
            editingState: null,
            startMode: "PAUSE",
            endMode: "PAUSE",
            defaultVolume: 100, // 初期音量を100に設定
            order: file.order ?? nextOrder // 指定された order がなければ計算した値を使用
        });
    }
}

// -----------------------
// 編集状態の管理
// -----------------------

// 編集状態の管理
const editState = {
    currentEditingItem: null, // 現在編集中のアイテム
};

// 編集状態を設定
function setEditState(itemPath) {
    editState.currentEditingItem = itemPath;
    playlist.forEach(item => {
        item.editingState = item.path === itemPath ? "editing" : null;
    });
}

// 編集状態を取得
function getEditState() {
    return editState;
}

// -----------------------
// オンエア状態の管理
// -----------------------

// オンエア状態の管理オブジェクト
const onAirState = {
    currentOnAirItem: null, // 現在オンエア中のアイテムID
};

// オンエア状態を設定
function setOnAirState(itemId) { 
    onAirState.currentOnAirItem = itemId; // 現在のオンエアアイテムIDを更新

    playlist.forEach(item => {
        item.onAirState = item.playlistItem_id === itemId ? "onair" : null; // 正しく playlistItem_id を比較
    });
}

// オンエア状態を取得
function getOnAirState() {
    return onAirState.currentOnAirItem; // 現在のオンエアアイテムIDを返す
}

// オンエア状態をリセット
function resetOnAirState() {
    onAirState.currentOnAirItem = null;

    // プレイリストの各アイテムのオンエア状態を解除
    playlist.forEach(item => {
        item.onAirState = null;
    });

    console.log('[statecontrol.js] On-Air state has been reset for all items.');
}

// -----------------------
// プレイリストの順番管理
// -----------------------

// プレイリスト内でアイテムを移動
function moveItemInPlaylist(itemId, direction) {
    const index = playlist.findIndex(item => item.playlistItem_id === itemId);

    if (index === -1) return false; // アイテムが見つからない場合は処理しない

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= playlist.length) return false; // 範囲外の場合は処理しない

    // アイテムを交換
    const [movedItem] = playlist.splice(index, 1);
    playlist.splice(targetIndex, 0, movedItem);

    return true; // 成功した場合
}

// プレイリスト内からアイテムを削除したとき
function deleteItemFromPlaylist(itemId) {
    const index = playlist.findIndex(item => item.playlistItem_id === itemId);

    if (index === -1) return false; // アイテムが見つからない場合は処理しない

    playlist.splice(index, 1); // アイテムを削除
    return true;
}

// プレイリストにアイテムを追加したとき
function addItemToPlaylist(itemData) {
    // 新しいアイテムをプレイリストの最後に追加
    playlist.push({
        ...itemData,
        order: playlist.length, // 現在のリストの長さを順序として設定
        playlistItem_id: itemData.playlistItem_id || generateUniqueId('item_'), // アイテムIDを生成
    });
}

// プレイリストの順序を再計算（必要な場合のみ呼び出すこと）
function recalculateOrder() {
    playlist.forEach((item, index) => {
        item.order = index; // インデックスを順序に設定
    });
}

// -----------------------
//   プレイリストの保存
// -----------------------
function setPlaylistStateWithId(playlist_id, playlistData) {
    const allPlaylists = getAllPlaylists();

    // 既に保存されているプレイリストの中に、渡された playlist_id と一致するものがあるかを確認
    const existingIndex = allPlaylists.findIndex(p => p.playlist_id === playlist_id);

    if (existingIndex !== -1) {
        // 更新時：既存の playlist_id をそのまま維持し、データを上書きする
        allPlaylists[existingIndex] = {
            ...allPlaylists[existingIndex],
            name: playlistData.name,
            data: playlistData.data.map(item => ({
                ...item,
                playlistItem_id: item.playlistItem_id || generateUniqueId('item_'),
                order: item.order !== undefined ? item.order : (allPlaylists[existingIndex].data.length),
                path: item.path || (item.name === "UVC_DEVICE" ? "UVC_DEVICE" : ""),
                directMode: typeof item.directMode !== 'undefined' ? item.directMode : false, // DIRECTモード追加
                fillKeyMode: typeof item.fillKeyMode !== 'undefined' ? item.fillKeyMode : false,  // FILLKEYモード追加
            }))
        };
    } else {
        // 新規追加：playlistData に既に playlist_id が含まれていればそれを使い、なければ渡された playlist_id を利用する
        const newId = playlistData.playlist_id || playlist_id;
        allPlaylists.push({
            playlist_id: newId,
            name: playlistData.name,
            data: playlistData.data.map(item => ({
                ...item,
                playlistItem_id: item.playlistItem_id || generateUniqueId('item_'),
                order: item.order !== undefined ? item.order : allPlaylists.length,
                directMode: typeof item.directMode !== 'undefined' ? item.directMode : false, // DIRECTモード追加
                fillKeyMode: typeof item.fillKeyMode !== 'undefined' ? item.fillKeyMode : false,  // FILLKEYモード追加
            }))
        });
    }

    // 状態管理用配列を更新
    playlists.length = 0;
    playlists.push(...allPlaylists);
}


// -----------------------
//   UVCデバイスの状態
// -----------------------

// UVCデバイス用の固定情報を設定する関数
function createUVCDeviceItem(selectedDevice) {
    return {
        playlistItem_id: generateUniqueId('uvc_'),
        path: "UVC_DEVICE",
        name: selectedDevice.deviceName,
        resolution: selectedDevice.resolution,
        duration: "UVC",
        startMode: "PAUSE",
        endMode: "UVC",
        inPoint: "UVC",
        outPoint: "UVC",
        defaultVolume: 0,
        selectionState: "unselected",
        editingState: null,
        order: playlist.length, // 現在のリストの長さを順序として設定
    };
}

// -----------------------
//   初期化とエクスポート
// -----------------------

// 初期化
function clearState() {
    playlist.length = 0; // プレイリストアイテムをクリア
    playlists.length = 0; // プレイリストオブジェクトをクリア（追加）
    editState.currentEditingItem = null; // 編集状態をクリア
}

// エクスポート
module.exports = {
    getPlaylistState,
    setPlaylistState,
    addFileToState,
    setEditState,
    getEditState,
    setOnAirState,
    getOnAirState,
    resetOnAirState,
    clearState,
    getPlaylistById,
    setPlaylistStateWithId,
    getAllPlaylists,
    moveItemInPlaylist,
    deleteItemFromPlaylist,
};

