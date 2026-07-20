'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    getScreenshotSavePath,
    getTemporaryCaptureSavePath,
    saveScreenshotFile,
    saveTemporaryCaptureFile
} = require('../fileSaveValidation');

test('valid data is saved in the screenshot and temporary capture folders', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtr-pon2-file-save-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const videoPath = path.join(root, 'media', 'program.mp4');
    const screenshotData = Uint8Array.from([1, 2, 3]);
    const captureData = Uint8Array.from([4, 5, 6]);

    const screenshotPath = saveScreenshotFile(screenshotData, 'screenshot-2026-07-20T12-34-56-789Z.png', videoPath);
    const capturePath = saveTemporaryCaptureFile(captureData, 'capture_1753014896789.png', root);

    assert.deepEqual(fs.readFileSync(screenshotPath), Buffer.from(screenshotData));
    assert.deepEqual(fs.readFileSync(capturePath), Buffer.from(captureData));
    assert.equal(path.dirname(screenshotPath), path.join(root, 'media', 'Screenshot'));
    assert.equal(path.dirname(capturePath), path.join(root, 'VTR-PON2', 'capture'));
});

test('invalid input fails before a save directory or file is created', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtr-pon2-file-reject-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.throws(
        () => saveTemporaryCaptureFile(Uint8Array.from([1]), '../outside.png', root),
        /Invalid temporary capture file name/
    );
    assert.deepEqual(fs.readdirSync(root), []);
});

test('screenshot path is limited to the media directory Screenshot folder', () => {
    const videoPath = path.resolve('test-fixtures', 'media', 'program.mp4');
    const result = getScreenshotSavePath(videoPath, 'screenshot-2026-07-20T12-34-56-789Z.png');
    assert.equal(result.directory, path.join(path.dirname(videoPath), 'Screenshot'));
    assert.equal(result.filePath, path.join(result.directory, 'screenshot-2026-07-20T12-34-56-789Z.png'));
});

test('temporary capture path is limited to the VTR-PON2 capture folder', () => {
    const tempRoot = path.resolve('test-fixtures', 'temp');
    const result = getTemporaryCaptureSavePath(tempRoot, 'capture_1753014896789.png');
    assert.equal(result.directory, path.join(tempRoot, 'VTR-PON2', 'capture'));
    assert.equal(result.filePath, path.join(result.directory, 'capture_1753014896789.png'));
});

for (const invalidName of ['../screenshot-2026-07-20T12-34-56-789Z.png', 'subdir/screenshot-2026-07-20T12-34-56-789Z.png', 'screenshot-2026-07-20T12-34-56-789Z.jpg', 'other.png', '', null]) {
    test(`screenshot rejects invalid name: ${String(invalidName)}`, () => {
        assert.throws(() => getScreenshotSavePath(path.resolve('media', 'program.mp4'), invalidName), /Invalid screenshot file name/);
    });
}

for (const invalidName of ['../capture_1753014896789.png', 'capture_1753014896789.jpg', 'capture_123.png', 'other.png', '', null]) {
    test(`temporary capture rejects invalid name: ${String(invalidName)}`, () => {
        assert.throws(() => getTemporaryCaptureSavePath(path.resolve('temp'), invalidName), /Invalid temporary capture file name/);
    });
}

test('screenshot rejects a relative media path', () => {
    assert.throws(() => getScreenshotSavePath('media/program.mp4', 'screenshot-2026-07-20T12-34-56-789Z.png'), /videoPath must be a normalized absolute path/);
});

test('temporary capture rejects a relative temp root', () => {
    assert.throws(() => getTemporaryCaptureSavePath('temp', 'capture_1753014896789.png'), /tempRoot must be a normalized absolute path/);
});
