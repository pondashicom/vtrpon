'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function git(args) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    );
}

function assertFile(relativePath) {
    const absolutePath = path.join(repoRoot, relativePath);
    assert.equal(
        fs.existsSync(absolutePath),
        true,
        `Release file is missing: ${relativePath}`
    );
    return absolutePath;
}

function assertExistingFile(filePath, label) {
    assert.equal(
        typeof filePath,
        'string',
        `${label} path is unavailable on ${process.platform}/${process.arch}`
    );
    const absolutePath = path.resolve(filePath);
    assert.equal(
        fs.existsSync(absolutePath),
        true,
        `${label} is missing: ${absolutePath}`
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

function main() {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    assert.equal(packageJson.version, '2.6.5');
    assert.equal(packageLock.version, packageJson.version);
    assert.equal(packageLock.packages[''].version, packageJson.version);

    const expectedTag = `v${packageJson.version}`;
    const expectedOrigin =
        'https://github.com/pondashicom/vtrpon.git';
    assert.equal(git(['remote', 'get-url', 'origin']), expectedOrigin);
    assert.equal(
        git(['status', '--porcelain']),
        '',
        'Release build requires a clean worktree.'
    );

    const head = git(['rev-parse', 'HEAD']);
    const localTagCommit = git([
        'rev-list',
        '-n',
        '1',
        expectedTag
    ]);
    assert.equal(
        localTagCommit,
        head,
        `${expectedTag} does not identify the build commit.`
    );

    const remoteTagLines = git([
        'ls-remote',
        'origin',
        `refs/tags/${expectedTag}`,
        `refs/tags/${expectedTag}^{}`
    ]).split(/\r?\n/).filter(Boolean);
    assert.equal(
        remoteTagLines.some((line) => line.startsWith(`${head}\t`)),
        true,
        `Published origin ${expectedTag} does not identify the build commit.`
    );

    for (const relativePath of [
        'LICENSE/gpl-3.0.txt',
        'LICENSE/LICENSE.txt',
        'LICENSE/Third-Party Licenses.txt',
        'LICENSE/SOURCE.txt',
        'package-lock.json'
    ]) {
        assertFile(relativePath);
    }
    const sourceText = fs.readFileSync(
        path.join(repoRoot, 'LICENSE', 'SOURCE.txt'),
        'utf8'
    );
    assert.match(
        sourceText,
        new RegExp(
            `github\\.com/pondashicom/vtrpon/tree/${expectedTag}`
        )
    );

    const ffmpegPackage = readJson(
        'node_modules/ffmpeg-static/package.json'
    );
    assert.equal(ffmpegPackage.version, '5.3.0');
    assert.equal(
        ffmpegPackage['ffmpeg-static']['binary-release-tag'],
        'b6.1.1'
    );
    const ffmpegPath = assertExistingFile(
        require('ffmpeg-static'),
        'FFmpeg release binary'
    );
    assertExistingFile(
        `${ffmpegPath}.LICENSE`,
        'FFmpeg binary license'
    );
    assertExistingFile(
        `${ffmpegPath}.README`,
        'FFmpeg binary source notice'
    );
    inspectBinary(ffmpegPath, /^ffmpeg version 6\.1\.1\b/m, 'FFmpeg');

    const ffprobePackage = readJson(
        'node_modules/ffprobe-static/package.json'
    );
    assert.equal(ffprobePackage.version, '3.1.0');
    const ffprobePath = assertExistingFile(
        require('ffprobe-static').path,
        'FFprobe release binary'
    );
    inspectBinary(ffprobePath, /^ffprobe version 4\.0\.2\b/m, 'FFprobe');

    process.stdout.write(
        `VTRPON2_RELEASE_SOURCE_GATE_PASS ${expectedTag} ${head}\n`
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `VTRPON2_RELEASE_SOURCE_GATE_FAIL ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

module.exports = {
    assertExistingFile,
    inspectBinary,
    main
};
