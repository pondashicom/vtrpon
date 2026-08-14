'use strict';

const path = require('node:path');
const {
    verifyPackagedRuntimeBinaries
} = require('./runtime-binary-validation');

function getResourcesPath(context) {
    if (context.electronPlatformName === 'darwin') {
        return path.join(
            context.appOutDir,
            `${context.packager.appInfo.productFilename}.app`,
            'Contents',
            'Resources'
        );
    }
    return path.join(context.appOutDir, 'resources');
}

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== process.platform) {
        throw new Error(
            `Cross-platform packaged binary validation is unsupported: ` +
            `${process.platform} -> ${context.electronPlatformName}`
        );
    }
    const result = verifyPackagedRuntimeBinaries(getResourcesPath(context));
    console.log(
        `VTRPON2_AFTER_PACK_BINARY_GATE_PASS ${process.platform}-${process.arch} ` +
        `ffmpeg=${result.ffmpegSha256} ffprobe=${result.ffprobeSha256}`
    );
};
