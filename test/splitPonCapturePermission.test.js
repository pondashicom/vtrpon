'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../labels');
const {
    CAPTURE_BORDER_SETTINGS_URI,
    buildCapturePermissionDialogOptions
} = require('../splitPonCapturePermission');

test('capture permission dialog follows the selected VTR-PON2 language', () => {
    const japanese =
        buildCapturePermissionDialogOptions(labels.ja);
    const english =
        buildCapturePermissionDialogOptions(labels.en);

    assert.match(japanese.message, /Windows/);
    assert.match(japanese.detail, /スクリーンショットの境界/);
    assert.equal(
        japanese.buttons[0],
        '必要な設定画面を開く'
    );
    assert.match(english.message, /Windows setting/);
    assert.match(english.detail, /Screenshot borders/);
    assert.equal(
        english.buttons[0],
        'Open required settings'
    );
    assert.equal(
        CAPTURE_BORDER_SETTINGS_URI,
        'ms-settings:privacy-graphicscapturewithoutborder'
    );
});
