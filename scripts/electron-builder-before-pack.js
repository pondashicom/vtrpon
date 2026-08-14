'use strict';

const {
    verifyRuntimeBinaries
} = require('./runtime-binary-validation');

module.exports = async function beforePack(context) {
    if (context.electronPlatformName !== process.platform) {
        throw new Error(
            `Cross-platform packaging is unsupported: ${process.platform} -> ` +
            context.electronPlatformName
        );
    }
    const result = verifyRuntimeBinaries();
    console.log(
        `VTRPON2_BEFORE_PACK_BINARY_GATE_PASS ${result.platform}-${result.arch} ` +
        `ffmpeg=${result.ffmpegSha256} ffprobe=${result.ffprobeSha256}`
    );
};
