'use strict';

const {
    verifyRuntimeBinaries
} = require('./runtime-binary-validation');

try {
    const result = verifyRuntimeBinaries();
    process.stdout.write(
        `VTRPON2_RUNTIME_BINARY_GATE_PASS ${result.platform}-${result.arch} ` +
        `ffmpeg=${result.ffmpegSha256} ffprobe=${result.ffprobeSha256}\n`
    );
} catch (error) {
    process.stderr.write(
        `VTRPON2_RUNTIME_BINARY_GATE_FAIL ${error.message}\n`
    );
    process.exitCode = 1;
}
