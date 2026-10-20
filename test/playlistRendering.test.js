'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.className = '';
        this.children = [];
        this.textContent = '';
        this.classList = { add: (...names) => { this.className += ` ${names.join(' ')}`; } };
    }

    appendChild(child) { this.children.push(child); }

    set innerHTML(_value) {
        assert.fail('Playlist values must not pass through an HTML parser');
    }
}

function elementsWithClass(root, className) {
    return [root, ...root.children.flatMap((child) => elementsWithClass(child, className))]
        .filter((element) => element.className.split(/\s+/).includes(className));
}

function textWithClass(root, className) {
    return elementsWithClass(root, className).map((element) => element.textContent);
}

function createHarness(stores = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'playlist.js'), 'utf8');
    const start = source.indexOf('function createFileInfo(');
    const end = source.indexOf('function updateItemStateClass(', start);
    assert.ok(start >= 0 && end > start);
    const context = {
        document: { createElement: (tagName) => new Element(tagName) },
        localStorage: { getItem: (key) => stores[key] || null }
    };
    vm.runInNewContext(source.slice(start, end), context);
    return context;
}

function sampleFile(extra = {}) {
    return {
        name: '番組 <本編> & "字幕".mp4', path: 'C:/media/program.mp4',
        resolution: '1920x1080', duration: '00:00:30:00',
        inPoint: '00:00:01:00', outPoint: '00:00:29:00',
        totalRemainDisplay: '00:00:28:00', defaultVolume: 75,
        startMode: 'PLAY', endMode: 'OFF', ...extra
    };
}

const payload = '<img src="data:," onerror="window.__playlistInjected = true">';
const fields = ['name', 'resolution', 'duration', 'inPoint', 'outPoint',
    'totalRemainDisplay', 'type', 'defaultVolume'];

for (const field of fields) {
    test(`playlist ${field} renders HTML-like data as literal text`, () => {
        const { createFileInfo } = createHarness();
        const result = createFileInfo(sampleFile({ [field]: payload }), 0);
        const expected = field === 'defaultVolume' ? `${payload}%` : payload;
        assert.ok([
            ...textWithClass(result, 'file-name'), ...textWithClass(result, 'value')
        ].includes(expected));
    });
}

test('playlist labels, order, classes and ordinary text are preserved', () => {
    const { createFileInfo } = createHarness();
    const file = sampleFile();
    const result = createFileInfo(file, 2);
    assert.deepEqual(textWithClass(result, 'playlist-index-label'), [3].map(String));
    assert.deepEqual(textWithClass(result, 'file-name'), [file.name]);
    assert.deepEqual(textWithClass(result, 'label'), ['RES', 'IN', 'DUR', 'OUT', 'TOTAL', 'TYPE', 'VOL']);
    assert.deepEqual(textWithClass(result, 'value'), [
        '1920x1080', '00:00:01:00', '00:00:30:00', '00:00:29:00', '00:00:28:00', 'MP4', '75%'
    ]);
    assert.equal(elementsWithClass(result, 'file-details-grid').length, 2);
    assert.equal(elementsWithClass(result, 'file-details-row').length, 5);
});

test('offline items still render untrusted metadata as text', () => {
    const { createFileInfo } = createHarness();
    const result = createFileInfo(sampleFile({ mediaOffline: true, resolution: payload }), 0);
    assert.deepEqual(textWithClass(result, 'media-offline'), ['Media Offline']);
    assert.ok(textWithClass(result, 'value').includes(payload));
});

test('UVC and missing optional metadata retain their defaults', () => {
    const { createFileInfo } = createHarness();
    const result = createFileInfo({ name: 'Camera', path: 'UVC_DEVICE:camera' }, 0);
    assert.deepEqual(textWithClass(result, 'value'), ['', '00:00:00:00', '', '00:00:00:00', '', 'UVC', '100%']);
    assert.doesNotThrow(() => createFileInfo({ name: 'Missing path' }, 0));
});

test('path-derived file type is text even when it contains markup', () => {
    const { createFileInfo } = createHarness();
    const extension = '<img src="data:,">';
    const result = createFileInfo(sampleFile({ path: `C:/media/file.${extension}` }), 0);
    assert.ok(textWithClass(result, 'value').includes(extension.toUpperCase()));
});

for (const field of ['startMode', 'endMode']) {
    test(`playlist ${field} cannot create HTML elements`, () => {
        const { createStatusContainer } = createHarness();
        const result = createStatusContainer(sampleFile({ [field]: payload }));
        assert.ok(textWithClass(result, 'status-value').includes(payload));
    });
}

test('START, FADEOUT, REPEAT and GOTO labels retain their formatting', () => {
    const { createStatusContainer } = createHarness({
        vtrpon_playlist_store_2: JSON.stringify({ data: [
            { playlistItem_id: 'second', order: 2 }, { playlistItem_id: 'first', order: 1 }
        ] })
    });
    const cases = [
        [{}, 'OFF'],
        [{ ftbEnabled: true, endMode: 'NEXT' }, 'FADEOUT_NEXT'],
        [{ endMode: 'REPEAT' }, 'REPEAT(∞)'],
        [{ endMode: 'REPEAT', repeatCount: 3, repeatEndMode: 'NEXT', ftbEnabled: true }, 'FADEOUT_REPEAT(3)→NEXT'],
        [{ endMode: 'GOTO', endGotoPlaylist: 2, endGotoItemId: 'second' }, 'GOTO→2/2'],
        [{ endMode: 'GOTO', endGotoPlaylist: 2, endGotoItemId: 'missing' }, 'GOTO→2/?'],
        [{ endMode: 'GOTO', endGotoPlaylist: 0, ftbEnabled: true }, 'FADEOUT_GOTO']
    ];
    for (const [extra, expected] of cases) {
        const result = createStatusContainer(sampleFile(extra));
        assert.deepEqual(textWithClass(result, 'status-label'), ['START', 'END']);
        assert.deepEqual(textWithClass(result, 'status-value'), ['PLAY', expected]);
    }
});
