'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAlacToAacArguments,
    buildFlacPictureRemovalArguments,
    buildPngToVideoArguments,
    buildPptxToMp4Arguments,
    validateMovToWebmPayload,
    validateMediaPath
} = require('../externalMediaArguments');

test('ALAC変換の日本語・空白・記号を含むパスを個別の引数として保持する', () => {
    const inputPath = 'G:\\素材 フォルダー\\入力 [完成版] #1.m4a';
    const outputPath = 'G:\\素材 フォルダー\\入力 [完成版] #1_aac.m4a';

    const args = buildAlacToAacArguments({ inputPath, outputPath });

    assert.deepEqual(args, [
        '-y',
        '-i', inputPath,
        '-vn',
        '-map_metadata', '0',
        '-c:a', 'aac',
        '-b:a', '320k',
        '-movflags', '+faststart',
        outputPath
    ]);
    assert.equal(args.includes(`"${inputPath}"`), false);
    assert.equal(args.includes(`"${outputPath}"`), false);
});

test('相対パスを拒否する', () => {
    assert.throws(
        () => validateMediaPath('relative file.m4a', 'inputPath'),
        /absolute path/
    );
});

test('NUL文字を含むパスを拒否する', () => {
    assert.throws(
        () => validateMediaPath('G:\\media\\bad\0name.m4a', 'inputPath'),
        /NUL character/
    );
});

test('入力と出力が同一の変換を拒否する', () => {
    const mediaPath = 'G:\\素材\\同一.m4a';
    assert.throws(
        () => buildAlacToAacArguments({ inputPath: mediaPath, outputPath: mediaPath }),
        /must be different/
    );
});

test('非透過PNG変換の特殊文字パスと数値を個別引数として保持する', () => {
    const inputPath = 'G:\\素材 フォルダー\\静止画 [非透過] #1.png';
    const outputPath = 'G:\\素材 フォルダー\\静止画 [非透過] #1.mp4';
    const args = buildPngToVideoArguments({
        inputPath, outputPath, hasAlpha: false, fps: 30, frameCount: 60
    });
    assert.equal(args[args.indexOf('-i') + 1], inputPath);
    assert.equal(args.at(-1), outputPath);
    assert.deepEqual(args.slice(args.indexOf('-vf'), args.indexOf('-vf') + 2), [
        '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2'
    ]);
});

test('透過PNG変換をWebM用引数として構築する', () => {
    const args = buildPngToVideoArguments({
        inputPath: 'G:\\素材\\透過.png',
        outputPath: 'G:\\素材\\透過.webm',
        hasAlpha: true,
        fps: 30,
        frameCount: 30
    });
    assert.equal(args.includes('libvpx-vp9'), true);
    assert.equal(args.includes('yuva420p'), true);
    assert.equal(args.includes('0'), true);
});

test('PNG変換の不正なフレーム数を拒否する', () => {
    assert.throws(() => buildPngToVideoArguments({
        inputPath: 'G:\\素材\\入力.png', outputPath: 'G:\\素材\\出力.mp4',
        hasAlpha: false, fps: 30, frameCount: 1.5
    }), /integer/);
});

test('PPTXディゾルブなしの連番パターンを個別引数として保持する', () => {
    const inputPattern = 'G:\\資料 日本語 [1]_pngconvert\\Slide_%03d.png';
    const outputPath = 'G:\\資料 日本語 [1] #完成.mp4';
    const args = buildPptxToMp4Arguments({
        inputPattern, inputPaths: [], outputPath,
        slideDuration: 2, outputFps: 30, useDissolve: false
    });
    assert.equal(args[args.indexOf('-i') + 1], inputPattern);
    assert.equal(args.at(-1), outputPath);
    assert.equal(args.includes('1/2'), true);
});

test('PPTXディゾルブありの複数入力とフィルターを構築する', () => {
    const inputPaths = [
        'G:\\資料 日本語\\Slide_001 [赤].png',
        'G:\\資料 日本語\\Slide_002 #青.png',
        'G:\\資料 日本語\\Slide_003 (緑).png'
    ];
    const outputPath = 'G:\\資料 日本語\\スライド 完成.mp4';
    const args = buildPptxToMp4Arguments({
        inputPattern: 'G:\\unused\\Slide_%03d.png', inputPaths, outputPath,
        slideDuration: 2, outputFps: 30, useDissolve: true
    });
    assert.deepEqual(args.filter((value, index) => args[index - 1] === '-i'), inputPaths);
    assert.equal(args[args.indexOf('-filter_complex') + 1],
        '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=1.5[v1];' +
        '[v1][2:v]xfade=transition=fade:duration=0.5:offset=3[vfinal]');
    assert.equal(args.at(-1), outputPath);
});

test('PPTXディゾルブは2入力未満を拒否する', () => {
    assert.throws(() => buildPptxToMp4Arguments({
        inputPaths: ['G:\\資料\\Slide_001.png'], outputPath: 'G:\\資料\\出力.mp4',
        slideDuration: 2, outputFps: 30, useDissolve: true
    }), /at least two/);
});

test('FLAC画像除去のmetaflacとFFmpeg引数を構築する', () => {
    const inputPath = 'G:\\音源 日本語\\入力 [画像付き] #1.flac';
    const outputPath = 'G:\\音源 日本語\\入力 [画像付き] #1_nopic.flac';
    const args = buildFlacPictureRemovalArguments({ inputPath, outputPath });
    assert.deepEqual(args.metaflac, [
        '--remove', '--block-type=PICTURE', `--output=${outputPath}`, inputPath
    ]);
    assert.deepEqual(args.ffmpeg, [
        '-y', '-i', inputPath, '-c:a', 'copy', '-map_metadata', '-1', outputPath
    ]);
});

test('MOV変換payloadの特殊文字パスを検証して保持する', () => {
    const payload = {
        inputPath: 'G:\\動画 日本語\\入力 [alpha] #1.mov',
        outputPath: 'G:\\動画 日本語\\入力 [alpha] #1.webm'
    };
    assert.deepEqual(validateMovToWebmPayload(payload), payload);
});
