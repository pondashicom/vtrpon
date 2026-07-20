'use strict';

const path = require('path');
const fs = require('fs');

const SCREENSHOT_FILE_NAME_PATTERN = /^screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.png$/;
const TEMP_CAPTURE_FILE_NAME_PATTERN = /^capture_\d{13}\.png$/;

function requireAbsolutePath(value, label) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
        throw new TypeError(`${label} must be a non-empty absolute path.`);
    }
    const resolvedPath = path.resolve(value);
    if (!path.isAbsolute(value) || path.normalize(value) !== resolvedPath) {
        throw new TypeError(`${label} must be a normalized absolute path.`);
    }
    return resolvedPath;
}

function requireFileName(fileName, pattern, label) {
    if (typeof fileName !== 'string' || fileName.length === 0 || fileName.includes('\0')
        || path.basename(fileName) !== fileName || !pattern.test(fileName)) {
        throw new TypeError(`Invalid ${label} file name.`);
    }
    return fileName;
}

function resolvePathWithin(baseDirectory, fileName) {
    const targetPath = path.resolve(baseDirectory, fileName);
    const relativePath = path.relative(baseDirectory, targetPath);
    if (relativePath === '' || relativePath.startsWith(`..${path.sep}`)
        || relativePath === '..' || path.isAbsolute(relativePath)) {
        throw new TypeError('Save path is outside the allowed directory.');
    }
    return targetPath;
}

function getScreenshotSavePath(videoPath, fileName) {
    const normalizedVideoPath = requireAbsolutePath(videoPath, 'videoPath');
    const validFileName = requireFileName(fileName, SCREENSHOT_FILE_NAME_PATTERN, 'screenshot');
    const directory = path.join(path.dirname(normalizedVideoPath), 'Screenshot');
    return { directory, filePath: resolvePathWithin(directory, validFileName) };
}

function getTemporaryCaptureSavePath(tempRoot, fileName) {
    const normalizedTempRoot = requireAbsolutePath(tempRoot, 'tempRoot');
    const validFileName = requireFileName(fileName, TEMP_CAPTURE_FILE_NAME_PATTERN, 'temporary capture');
    const directory = path.join(normalizedTempRoot, 'VTR-PON2', 'capture');
    return { directory, filePath: resolvePathWithin(directory, validFileName) };
}

function writeFileToValidatedPath(savePath, arrayBuffer) {
    fs.mkdirSync(savePath.directory, { recursive: true });
    fs.writeFileSync(savePath.filePath, Buffer.from(arrayBuffer));
    return savePath.filePath;
}

function saveScreenshotFile(arrayBuffer, fileName, videoPath) {
    return writeFileToValidatedPath(getScreenshotSavePath(videoPath, fileName), arrayBuffer);
}

function saveTemporaryCaptureFile(arrayBuffer, fileName, tempRoot) {
    return writeFileToValidatedPath(getTemporaryCaptureSavePath(tempRoot, fileName), arrayBuffer);
}

module.exports = {
    getScreenshotSavePath,
    getTemporaryCaptureSavePath,
    saveScreenshotFile,
    saveTemporaryCaptureFile
};
