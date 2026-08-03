'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    getReleaseBinaryVersions,
    normalizeOriginUrl
} = require('../scripts/verify-release-source');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('2.6.5 release exposes GPL, source, notices, and dependency lock', () => {
    const packageJson = JSON.parse(read('package.json'));
    const destinations = new Map(
        packageJson.build.extraResources.map((entry) => [
            entry.to,
            entry.from
        ])
    );

    assert.equal(packageJson.version, '2.6.5');
    assert.equal(packageJson.license, 'GPL-3.0-or-later');
    assert.equal(destinations.get('COPYING'), 'LICENSE/gpl-3.0.txt');
    assert.equal(destinations.get('LICENSE.txt'), 'LICENSE/LICENSE.txt');
    assert.equal(
        destinations.get('THIRD-PARTY-NOTICES.txt'),
        'LICENSE/Third-Party Licenses.txt'
    );
    assert.equal(destinations.get('SOURCE.txt'), 'LICENSE/SOURCE.txt');
    assert.equal(
        destinations.get('NPM-DEPENDENCIES-LOCK.json'),
        'package-lock.json'
    );
    assert.doesNotMatch(
        packageJson.scripts.build,
        /verify:release-source/
    );
    assert.match(packageJson.scripts.build, /--publish=never/);
    assert.match(
        packageJson.scripts['build:release'],
        /verify:release-source/
    );
    for (const script of [
        'dist:win',
        'dist:mac-arm64'
    ]) {
        assert.match(
            packageJson.scripts[script],
            /verify:release-source/
        );
        assert.match(
            packageJson.scripts[script],
            /--publish=never/
        );
    }
    assert.deepEqual(
        packageJson.build.mac.target[0].arch,
        ['arm64']
    );
    for (const excludedOutput of [
        '!dist/**/*',
        '!dist-validation/**/*',
        '!out/**/*',
        '!build/**/*'
    ]) {
        assert.equal(
            packageJson.build.files.includes(excludedOutput),
            true,
            `Build output must be excluded from app.asar: ${excludedOutput}`
        );
    }
});

test('CI and release builds use separate source-verification gates', () => {
    const workflow = read('.github/workflows/build.yml');
    const tagConditions = workflow.match(
        /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/g
    ) || [];
    const releaseChecks = workflow.match(
        /run: npm run verify:release-source/g
    ) || [];
    const fullCheckouts = workflow.match(/fetch-depth: 0/g) || [];

    assert.equal(tagConditions.length, 2);
    assert.equal(releaseChecks.length, 2);
    assert.equal(fullCheckouts.length, 2);
    assert.match(
        workflow,
        /run: npx --no-install electron-builder --mac --arm64 --publish=never/
    );
    assert.match(
        workflow,
        /run: npx --no-install electron-builder --win --x64 --publish=never/
    );
    assert.doesNotMatch(workflow, /GH_TOKEN/);
});

test('release binary versions are explicit for each supported platform', () => {
    const macVersions = getReleaseBinaryVersions('darwin', 'arm64');
    const windowsVersions = getReleaseBinaryVersions('win32', 'x64');

    assert.match('ffmpeg version 6.0', macVersions.ffmpeg);
    assert.match('ffprobe version 4.4-tessus', macVersions.ffprobe);
    assert.match('ffmpeg version 6.1.1', windowsVersions.ffmpeg);
    assert.match('ffprobe version 4.0.2', windowsVersions.ffprobe);
    assert.throws(
        () => getReleaseBinaryVersions('darwin', 'x64'),
        /unsupported on darwin\/x64/
    );
});

test('release origin accepts GitHub HTTPS URLs with or without .git', () => {
    const expected = 'https://github.com/pondashicom/vtrpon';

    assert.equal(normalizeOriginUrl(expected), expected);
    assert.equal(normalizeOriginUrl(`${expected}.git`), expected);
    assert.equal(normalizeOriginUrl(`${expected}.git/`), expected);
    assert.notEqual(
        normalizeOriginUrl('git@github.com:pondashicom/vtrpon.git'),
        expected
    );
});

test('source notice identifies exact public tag and build gate', () => {
    const source = read('LICENSE/SOURCE.txt');
    const notice = read('LICENSE/LICENSE.txt');
    const thirdParty = read('LICENSE/Third-Party Licenses.txt');
    const verifier = read('scripts/verify-release-source.js');
    const main = read('main.js');

    assert.match(source, /v2\.6\.5/);
    assert.match(
        source,
        /github\.com\/pondashicom\/vtrpon\/tree\/v2\.6\.5/
    );
    assert.match(notice, /GPL-3\.0-or-later/);
    assert.match(notice, /Third-party components retain their own licenses/);
    assert.match(thirdParty, /FFmpeg 6\.1\.1 on Windows x64/);
    assert.match(thirdParty, /FFmpeg 6\.0 on macOS arm64/);
    assert.match(thirdParty, /FFprobe 4\.0\.2 on Windows x64/);
    assert.match(thirdParty, /FFprobe 4\.4-tessus on macOS arm64/);
    assert.match(thirdParty, /Windows x64\s+and macOS arm64/);
    assert.match(
        source,
        /Windows x64 and macOS arm64 distributions[\s\S]*platform-specific\s+prebuilt/
    );
    assert.match(verifier, /Published origin/);
    assert.match(verifier, /Release build requires a clean worktree/);
    assert.match(verifier, /require\('ffmpeg-static'\)/);
    assert.match(verifier, /require\('ffprobe-static'\)\.path/);
    assert.doesNotMatch(
        verifier,
        /node_modules\/ffmpeg-static\/ffmpeg\.exe|bin\/win32\/x64\/ffprobe\.exe/
    );
    assert.match(
        main,
        /github\.com\/pondashicom\/vtrpon\/tree\/v2\.6\.5/
    );
});
