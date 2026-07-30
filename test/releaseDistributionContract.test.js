'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
    for (const script of [
        'dist:win',
        'dist:mac-arm64',
        'dist:mac-x64'
    ]) {
        assert.match(
            packageJson.scripts[script],
            /verify:release-source/
        );
    }
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
    assert.match(thirdParty, /FFmpeg 6\.1\.1/);
    assert.match(thirdParty, /FFprobe 4\.0\.2/);
    assert.match(thirdParty, /Windows x64\s+and macOS x64\/arm64/);
    assert.match(
        source,
        /Windows and macOS distributions[\s\S]*platform-specific prebuilt/
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
