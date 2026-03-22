// ------------------------------
//  screenLockBackgroundSettingsUtils.js
//  ver 2.6.0
// ------------------------------

function getDefaultScreenLockBackgroundSettings() {
    return {
        enabled: false,
        assetPath: '',
        originalFileName: '',
        updatedAt: ''
    };
}

function normalizeScreenLockBackgroundSettings(settings = {}) {
    const defaults = getDefaultScreenLockBackgroundSettings();

    return {
        enabled: settings.enabled === true && typeof settings.assetPath === 'string' && settings.assetPath.trim() !== '',
        assetPath: typeof settings.assetPath === 'string' ? settings.assetPath : defaults.assetPath,
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
    getDefaultScreenLockBackgroundSettings,
    normalizeScreenLockBackgroundSettings,
    getScreenLockBackgroundDisplayName
};
