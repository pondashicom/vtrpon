// ------------------------------
//  screenLockBackgroundSettingsUtils.js
//  ver 2.6.0
// ------------------------------

const SCREEN_LOCK_BACKGROUND_IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const SCREEN_LOCK_BACKGROUND_VIDEO_FILE_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'];

function inferScreenLockBackgroundMediaType(assetPath = '') {
    const extension = assetPath.split('.').pop()?.toLowerCase() || '';

    if (SCREEN_LOCK_BACKGROUND_IMAGE_FILE_EXTENSIONS.includes(extension)) {
        return 'image';
    }

    if (SCREEN_LOCK_BACKGROUND_VIDEO_FILE_EXTENSIONS.includes(extension)) {
        return 'video';
    }

    return '';
}

function getDefaultScreenLockBackgroundSettings() {
    return {
        enabled: false,
        mediaType: '',
        assetPath: '',
        originalFileName: '',
        updatedAt: ''
    };
}

function normalizeScreenLockBackgroundSettings(settings = {}) {
    const defaults = getDefaultScreenLockBackgroundSettings();
    const assetPath = typeof settings.assetPath === 'string' ? settings.assetPath : defaults.assetPath;
    const mediaType = typeof settings.mediaType === 'string' && settings.mediaType
        ? settings.mediaType
        : inferScreenLockBackgroundMediaType(assetPath);

    return {
        enabled: settings.enabled === true && assetPath.trim() !== '' && (mediaType === 'image' || mediaType === 'video'),
        mediaType: mediaType === 'image' || mediaType === 'video' ? mediaType : defaults.mediaType,
        assetPath,
        originalFileName: typeof settings.originalFileName === 'string' ? settings.originalFileName : defaults.originalFileName,
        updatedAt: typeof settings.updatedAt === 'string' ? settings.updatedAt : defaults.updatedAt
    };
}

function getScreenLockBackgroundDisplayName(settings = {}) {
    const normalized = normalizeScreenLockBackgroundSettings(settings);

    if (normalized.originalFileName) {
        return normalized.originalFileName;
    }

    if (!normalized.assetPath) {
        return '';
    }

    const normalizedPath = normalized.assetPath.replace(/\\/g, '/');
    const segments = normalizedPath.split('/');
    return segments[segments.length - 1] || '';
}

module.exports = {
    SCREEN_LOCK_BACKGROUND_IMAGE_FILE_EXTENSIONS,
    SCREEN_LOCK_BACKGROUND_VIDEO_FILE_EXTENSIONS,
    getDefaultScreenLockBackgroundSettings,
    normalizeScreenLockBackgroundSettings,
    getScreenLockBackgroundDisplayName,
    inferScreenLockBackgroundMediaType
};
