'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

const releaseBinaryVersions = {
    'darwin-arm64': {
        ffmpeg: /^ffmpeg version 6\.0\b/m,
        ffprobe: /^ffprobe version 4\.4(?:-tessus)?\b/m
    },
    'win32-x64': {
        ffmpeg: /^ffmpeg version 6\.1\.1\b/m,
        ffprobe: /^ffprobe version 4\.0\.2\b/m
    }
};

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    );
}

function assertExistingFile(filePath, label) {
    assert.equal(
        typeof filePath,
        'string',
        `${label} path is unavailable`
    );
    const absolutePath = path.resolve(filePath);
    assert.equal(
        fs.existsSync(absolutePath),
        true,
        `${label} is missing: ${absolutePath}`
    );
    assert.equal(
        fs.statSync(absolutePath).isFile(),
        true,
        `${label} is not a file: ${absolutePath}`
    );
    return absolutePath;
}

function inspectBinary(executablePath, expectedVersionPattern, label) {
    const result = spawnSync(executablePath, ['-version'], {
        encoding: 'utf8',
        windowsHide: true
    });
    assert.equal(
        result.error,
        undefined,
        `${label} could not be started: ${result.error?.message}`
    );
    assert.equal(result.status, 0, `${label} -version failed`);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.match(output, expectedVersionPattern, `${label} version mismatch`);
    assert.match(output, /--enable-gpl/, `${label} is not a GPL build`);
    assert.match(output, /--enable-version3/, `${label} is not version-3 enabled`);
}

function getReleaseBinaryVersions(platform, arch) {
    const key = `${platform}-${arch}`;
    const versions = releaseBinaryVersions[key];
    assert.ok(
        versions,
        `Release binaries are unsupported on ${platform}/${arch}`
    );
    return versions;
}

function sha256(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function assertMatchingFile(sourcePath, packagedPath, label) {
    const source = assertExistingFile(sourcePath, `${label} source`);
    const packaged = assertExistingFile(packagedPath, `${label} packaged file`);
    assert.equal(
        fs.statSync(packaged).size,
        fs.statSync(source).size,
        `${label} packaged size mismatch`
    );
    assert.equal(
        sha256(packaged),
        sha256(source),
        `${label} packaged hash mismatch`
    );
    return packaged;
}

function verifyRuntimeBinaries(options = {}) {
    const platform = options.platform || process.platform;
    const arch = options.arch || process.arch;
    assert.equal(
        platform,
        process.platform,
        `Cross-platform binary validation is unsupported: ${process.platform} -> ${platform}`
    );
    assert.equal(
        arch,
        process.arch,
        `Cross-architecture binary validation is unsupported: ${process.arch} -> ${arch}`
    );

    const versions = getReleaseBinaryVersions(platform, arch);
    const ffmpegPackage = readJson('node_modules/ffmpeg-static/package.json');
    assert.equal(ffmpegPackage.version, '5.3.0');
    assert.equal(
        ffmpegPackage['ffmpeg-static']['binary-release-tag'],
        'b6.1.1'
    );
    const ffmpegPath = assertExistingFile(
        require('ffmpeg-static'),
        'FFmpeg release binary'
    );
    const ffmpegLicensePath = assertExistingFile(
        `${ffmpegPath}.LICENSE`,
        'FFmpeg binary license'
    );
    const ffmpegReadmePath = assertExistingFile(
        `${ffmpegPath}.README`,
        'FFmpeg binary source notice'
    );
    inspectBinary(ffmpegPath, versions.ffmpeg, 'FFmpeg');

    const ffprobePackage = readJson('node_modules/ffprobe-static/package.json');
    assert.equal(ffprobePackage.version, '3.1.0');
    const ffprobePath = assertExistingFile(
        require('ffprobe-static').path,
        'FFprobe release binary'
    );
    inspectBinary(ffprobePath, versions.ffprobe, 'FFprobe');

    return {
        platform,
        arch,
        versions,
        ffmpegPath,
        ffmpegLicensePath,
        ffmpegReadmePath,
        ffprobePath,
        ffmpegSha256: sha256(ffmpegPath),
        ffprobeSha256: sha256(ffprobePath)
    };
}

function getPackagedBinaryPaths(resourcesPath, platform, arch) {
    const unpackedModules = path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules'
    );
    const ffmpegName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffprobeName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const ffmpegPath = path.join(
        unpackedModules,
        'ffmpeg-static',
        ffmpegName
    );
    return {
        ffmpegPath,
        ffmpegLicensePath: `${ffmpegPath}.LICENSE`,
        ffmpegReadmePath: `${ffmpegPath}.README`,
        ffprobePath: path.join(
            unpackedModules,
            'ffprobe-static',
            'bin',
            platform,
            arch,
            ffprobeName
        )
    };
}

function verifyPackagedRuntimeBinaries(resourcesPath, options = {}) {
    const source = verifyRuntimeBinaries(options);
    const packaged = getPackagedBinaryPaths(
        path.resolve(resourcesPath),
        source.platform,
        source.arch
    );
    const ffmpegPath = assertMatchingFile(
        source.ffmpegPath,
        packaged.ffmpegPath,
        'FFmpeg binary'
    );
    assertMatchingFile(
        source.ffmpegLicensePath,
        packaged.ffmpegLicensePath,
        'FFmpeg binary license'
    );
    assertMatchingFile(
        source.ffmpegReadmePath,
        packaged.ffmpegReadmePath,
        'FFmpeg binary source notice'
    );
    const ffprobePath = assertMatchingFile(
        source.ffprobePath,
        packaged.ffprobePath,
        'FFprobe binary'
    );
    inspectBinary(ffmpegPath, source.versions.ffmpeg, 'Packaged FFmpeg');
    inspectBinary(ffprobePath, source.versions.ffprobe, 'Packaged FFprobe');

    return {
        ...packaged,
        ffmpegSha256: sha256(ffmpegPath),
        ffprobeSha256: sha256(ffprobePath)
    };
}

module.exports = {
    assertExistingFile,
    getPackagedBinaryPaths,
    getReleaseBinaryVersions,
    inspectBinary,
    sha256,
    verifyPackagedRuntimeBinaries,
    verifyRuntimeBinaries
};
