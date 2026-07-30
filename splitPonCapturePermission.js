'use strict';

const CAPTURE_BORDER_SETTINGS_URI =
    'ms-settings:privacy-graphicscapturewithoutborder';

function buildCapturePermissionDialogOptions(labels) {
    return {
        type: 'info',
        title: labels['splitpon-capture-permission-title'],
        message: labels['splitpon-capture-permission-message'],
        detail: labels['splitpon-capture-permission-detail'],
        buttons: [
            labels['splitpon-capture-permission-open-settings'],
            labels['splitpon-capture-permission-cancel']
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true
    };
}

module.exports = {
    CAPTURE_BORDER_SETTINGS_URI,
    buildCapturePermissionDialogOptions
};
