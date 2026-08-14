'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
    assertExistingFile,
    getReleaseBinaryVersions,
    inspectBinary,
    verifyRuntimeBinaries
} = require('./runtime-binary-validation');

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

function normalizeOriginUrl(value) {
    return String(value)
        .trim()
        .replace(/\/+$/, '')
        .replace(/\.git$/i, '');
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

function main() {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
    assert.equal(packageLock.version, packageJson.version);
    assert.equal(packageLock.packages[''].version, packageJson.version);

    const expectedTag = `v${packageJson.version}`;
    const expectedOrigin = 'https://github.com/pondashicom/vtrpon';
    assert.equal(
        normalizeOriginUrl(git(['remote', 'get-url', 'origin'])),
        expectedOrigin,
        'Release build requires the official HTTPS origin.'
    );
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

    verifyRuntimeBinaries();

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
    getReleaseBinaryVersions,
    inspectBinary,
    normalizeOriginUrl,
    verifyRuntimeBinaries,
    main
};
