// ------------------------------
//  screenlockbackgroundsettings.js
//  ver 2.6.0
// ------------------------------

const DEFAULT_SCREEN_LOCK_BACKGROUND_SETTINGS = window.electronAPI.screenLockBackgroundSettings.getDefaultSettings();

let currentScreenLockBackgroundSettings = { ...DEFAULT_SCREEN_LOCK_BACKGROUND_SETTINGS };

function getModalLabel(key, fallback) {
    if (typeof window.getLabel === 'function') {
        return window.getLabel(key, fallback);
    }
    return fallback;
}

function getModalMessage(key, fallback) {
    if (typeof window.getMessage === 'function') {
        const message = window.getMessage(key);
        return message === key ? fallback : message;
    }
    return fallback;
}

function normalizeScreenLockBackgroundSettings(settings = {}) {
    return window.electronAPI.screenLockBackgroundSettings.normalizeSettings(settings);
}

function getScreenLockBackgroundDisplayName(settings = currentScreenLockBackgroundSettings) {
    return window.electronAPI.screenLockBackgroundSettings.getDisplayName(settings);
}

function setFeedbackMessage(message, type = '') {
    const element = document.getElementById('screenLockBackgroundMessage');
    if (!element) {
        return;
    }

    element.textContent = message || '';
    element.classList.remove('is-error', 'is-success');
    if (type === 'error') {
        element.classList.add('is-error');
    } else if (type === 'success') {
        element.classList.add('is-success');
    }
}

function applySettingsToDom(settings) {
    currentScreenLockBackgroundSettings = normalizeScreenLockBackgroundSettings(settings);

    const statusValue = document.getElementById('screenLockBackgroundStatusValue');
    const clearButton = document.getElementById('screenLockBackgroundClearButton');
    const hasCustomBackground = currentScreenLockBackgroundSettings.enabled && !!currentScreenLockBackgroundSettings.assetPath;
    const displayName = getScreenLockBackgroundDisplayName(currentScreenLockBackgroundSettings);

    if (statusValue) {
        statusValue.textContent = hasCustomBackground
            ? `${getModalLabel('screen-lock-background-status-set', 'Configured')}: ${displayName || currentScreenLockBackgroundSettings.assetPath}`
            : getModalLabel('screen-lock-background-status-unset', 'Not Set');
        statusValue.title = hasCustomBackground ? (displayName || currentScreenLockBackgroundSettings.assetPath) : '';
    }

    if (clearButton) {
        clearButton.disabled = !hasCustomBackground;
    }
}

async function refreshSettings() {
    try {
        const settings = await window.electronAPI.getScreenLockBackgroundSettings();
        applySettingsToDom(settings);
    } catch (_) {
        applySettingsToDom(DEFAULT_SCREEN_LOCK_BACKGROUND_SETTINGS);
    }
}

async function handleSelectButtonClick() {
    setFeedbackMessage('');
    const result = await window.electronAPI.selectScreenLockBackgroundImage();
    if (result?.success) {
        applySettingsToDom(result.settings);
        setFeedbackMessage(getModalMessage('screen-lock-background-selected', 'Screen lock background image saved.'), 'success');
        return;
    }

    if (result?.canceled) {
        return;
    }

    const detail = result?.error ? ` ${result.error}` : '';
    setFeedbackMessage(
        `${getModalMessage('screen-lock-background-select-failed', 'Failed to set the screen lock background image.')}${detail}`,
        'error'
    );
}

async function handleClearButtonClick() {
    setFeedbackMessage('');
    const result = await window.electronAPI.clearScreenLockBackgroundImage();
    if (result?.success) {
        applySettingsToDom(result.settings);
        setFeedbackMessage(getModalMessage('screen-lock-background-cleared', 'Screen lock background image cleared.'), 'success');
        return;
    }

    const detail = result?.error ? ` ${result.error}` : '';
    setFeedbackMessage(
        `${getModalMessage('screen-lock-background-clear-failed', 'Failed to clear the screen lock background image.')}${detail}`,
        'error'
    );
}

async function initializeScreenLockBackgroundSettings() {
    await refreshSettings();

    document.getElementById('screenLockBackgroundSelectButton').addEventListener('click', handleSelectButtonClick);
    document.getElementById('screenLockBackgroundClearButton').addEventListener('click', handleClearButtonClick);
    document.getElementById('screenLockBackgroundCloseButton').addEventListener('click', () => {
        window.electronAPI.closeScreenLockBackgroundSettings();
    });

    if (window.electronAPI.onScreenLockBackgroundSettingsChanged) {
        window.electronAPI.onScreenLockBackgroundSettingsChanged((settings) => {
            applySettingsToDom(settings);
        });
    }

    if (window.electronAPI.onLanguageChanged) {
        window.electronAPI.onLanguageChanged(() => {
            applySettingsToDom(currentScreenLockBackgroundSettings);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeScreenLockBackgroundSettings();
});
