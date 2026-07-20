'use strict';

const path = require('path');

function validateMediaPath(value, fieldName) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${fieldName} must be a non-empty string`);
    }
    if (value.includes('\0')) {
        throw new TypeError(`${fieldName} must not contain a NUL character`);
    }
    if (!path.isAbsolute(value)) {
        throw new TypeError(`${fieldName} must be an absolute path`);
    }
    return value;
}

function validatePositiveNumber(value, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${fieldName} must be a positive number`);
    }
    return value;
}

function validateDistinctPaths(inputPath, outputPath) {
    const normalizedInput = path.resolve(inputPath);
    const normalizedOutput = path.resolve(outputPath);
    const samePath = process.platform === 'win32'
        ? normalizedInput.toLowerCase() === normalizedOutput.toLowerCase()
        : normalizedInput === normalizedOutput;
    if (samePath) {
        throw new TypeError('inputPath and outputPath must be different');
    }
}

function buildAlacToAacArguments(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('ALAC conversion payload must be an object');
    }

    const inputPath = validateMediaPath(payload.inputPath, 'inputPath');
    const outputPath = validateMediaPath(payload.outputPath, 'outputPath');
    validateDistinctPaths(inputPath, outputPath);

    return [
        '-y',
        '-i', inputPath,
        '-vn',
        '-map_metadata', '0',
        '-c:a', 'aac',
        '-b:a', '320k',
        '-movflags', '+faststart',
        outputPath
    ];
}

function buildPngToVideoArguments(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('PNG conversion payload must be an object');
    }
    const inputPath = validateMediaPath(payload.inputPath, 'inputPath');
    const outputPath = validateMediaPath(payload.outputPath, 'outputPath');
    validateDistinctPaths(inputPath, outputPath);
    const fps = validatePositiveNumber(payload.fps, 'fps');
    const frameCount = validatePositiveNumber(payload.frameCount, 'frameCount');
    if (!Number.isInteger(frameCount)) {
        throw new TypeError('frameCount must be an integer');
    }
    if (typeof payload.hasAlpha !== 'boolean') {
        throw new TypeError('hasAlpha must be a boolean');
    }

    const common = ['-y', '-loop', '1', '-framerate', String(fps), '-i', inputPath];
    if (payload.hasAlpha) {
        return common.concat([
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
            '-auto-alt-ref', '0', '-frames:v', String(frameCount), outputPath
        ]);
    }
    return common.concat([
        '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-frames:v', String(frameCount), outputPath
    ]);
}

function buildPptxToMp4Arguments(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('PPTX video payload must be an object');
    }
    const outputPath = validateMediaPath(payload.outputPath, 'outputPath');
    const slideDuration = validatePositiveNumber(payload.slideDuration, 'slideDuration');
    const outputFps = validatePositiveNumber(payload.outputFps, 'outputFps');
    if (typeof payload.useDissolve !== 'boolean') {
        throw new TypeError('useDissolve must be a boolean');
    }

    if (!payload.useDissolve) {
        const inputPattern = validateMediaPath(payload.inputPattern, 'inputPattern');
        validateDistinctPaths(inputPattern, outputPath);
        return [
            '-y', '-framerate', `1/${slideDuration}`, '-start_number', '1',
            '-i', inputPattern, '-c:v', 'libx264', '-r', String(outputFps),
            '-g', '1', '-pix_fmt', 'yuv420p', outputPath
        ];
    }

    if (!Array.isArray(payload.inputPaths) || payload.inputPaths.length < 2) {
        throw new TypeError('inputPaths must contain at least two paths for dissolve');
    }
    const inputPaths = payload.inputPaths.map((item, index) =>
        validateMediaPath(item, `inputPaths[${index}]`)
    );
    inputPaths.forEach(inputPath => validateDistinctPaths(inputPath, outputPath));
    const dissolveDuration = 0.5;
    if (slideDuration <= dissolveDuration) {
        throw new TypeError('slideDuration must be greater than dissolve duration');
    }

    const args = ['-y'];
    inputPaths.forEach(inputPath => {
        args.push('-loop', '1', '-t', String(slideDuration), '-i', inputPath);
    });
    let filterComplex = '';
    let previousLabel = '0:v';
    let totalDuration = slideDuration;
    for (let index = 1; index < inputPaths.length; index++) {
        const outputLabel = index === inputPaths.length - 1 ? 'vfinal' : `v${index}`;
        const offset = totalDuration - dissolveDuration;
        filterComplex += `[${previousLabel}][${index}:v]xfade=transition=fade:duration=${dissolveDuration}:offset=${offset}[${outputLabel}];`;
        totalDuration += slideDuration - dissolveDuration;
        previousLabel = outputLabel;
    }
    args.push(
        '-filter_complex', filterComplex.slice(0, -1), '-map', '[vfinal]',
        '-r', String(outputFps), '-c:v', 'libx264', '-g', '1',
        '-pix_fmt', 'yuv420p', outputPath
    );
    return args;
}

function buildFlacPictureRemovalArguments(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('FLAC conversion payload must be an object');
    }
    const inputPath = validateMediaPath(payload.inputPath, 'inputPath');
    const outputPath = validateMediaPath(payload.outputPath, 'outputPath');
    validateDistinctPaths(inputPath, outputPath);
    return {
        metaflac: ['--remove', '--block-type=PICTURE', `--output=${outputPath}`, inputPath],
        ffmpeg: ['-y', '-i', inputPath, '-c:a', 'copy', '-map_metadata', '-1', outputPath]
    };
}

function validateMovToWebmPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('MOV conversion payload must be an object');
    }
    const inputPath = validateMediaPath(payload.inputPath, 'inputPath');
    const outputPath = validateMediaPath(payload.outputPath, 'outputPath');
    validateDistinctPaths(inputPath, outputPath);
    return { inputPath, outputPath };
}

module.exports = {
    buildAlacToAacArguments,
    buildFlacPictureRemovalArguments,
    buildPngToVideoArguments,
    buildPptxToMp4Arguments,
    validateMediaPath,
    validateMovToWebmPayload
};
