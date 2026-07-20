'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockVideo {
    constructor() {
        this.currentTime = 0;
        this.paused = true;
        this.parentElement = null;
        this.src = '';
        this.style = { setProperty() {} };
        this.listeners = new Map();
        this.frameCallbacks = new Map();
        this.cancelledFrameCallbackIds = [];
        this.nextFrameCallbackId = 1;
        this.loadCalls = 0;
        this.pauseCalls = 0;
        this.removedAttributes = [];
    }

    addEventListener(name, handler) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(handler);
    }

    removeEventListener(name, handler) {
        this.listeners.get(name)?.delete(handler);
    }

    listenerCount(name) {
        return this.listeners.get(name)?.size || 0;
    }

    dispatch(name) {
        for (const handler of [...(this.listeners.get(name) || [])]) handler();
    }

    play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
        this.pauseCalls += 1;
    }

    requestVideoFrameCallback(callback) {
        const id = this.nextFrameCallbackId++;
        this.frameCallbacks.set(id, callback);
        return id;
    }

    cancelVideoFrameCallback(id) {
        this.cancelledFrameCallbackIds.push(id);
        this.frameCallbacks.delete(id);
    }

    removeAttribute(name) {
        this.removedAttributes.push(name);
        if (name === 'src') this.src = '';
    }

    load() {
        this.loadCalls += 1;
    }

    setAttribute() {}
}

class MockOverlay {
    constructor() {
        this.child = null;
        this.parentElement = null;
        this.style = {};
    }

    appendChild(child) {
        if (this.child) this.child.parentElement = null;
        this.child = child;
        child.parentElement = this;
    }

    querySelector(selector) {
        return selector === 'video' ? this.child : null;
    }

    set innerHTML(value) {
        assert.equal(value, '');
        if (this.child) this.child.parentElement = null;
        this.child = null;
    }

    get innerHTML() {
        return '';
    }
}

function createHarness() {
    const overlay = new MockOverlay();
    const videos = [];
    const source = fs.readFileSync(path.join(__dirname, '..', 'fullscreen.js'), 'utf8');
    const dskSection = source.slice(source.indexOf('// DSKオーバレイ要素'));
    const context = {
        DEFAULT_FADE_DURATION: 300,
        FS_LAYER_Z_DSK: 9000,
        console,
        currentDSKItem: null,
        document: {
            body: {
                appendChild(element) {
                    element.parentElement = this;
                }
            },
            createElement(name) {
                assert.equal(name, 'video');
                const video = new MockVideo();
                videos.push(video);
                return video;
            },
            getElementById(id) {
                return id === 'fs-dsk-overlay' ? overlay : null;
            }
        },
        fadeIn(element) {
            element.style.visibility = 'visible';
            element.style.opacity = '1';
        },
        fadeOut(element, _duration, callback) {
            element.style.opacity = '0';
            callback();
        },
        getSafeFileURL(filePath) {
            return `file://${filePath}`;
        },
        window: { fsDSKActive: false }
    };

    vm.runInNewContext(`${dskSection}\n;globalThis.__dskTestApi = {\n` +
        'initFsDSKOverlay, showFullscreenDSK, hideFullscreenDSK, ' +
        'releaseFullscreenDskVideo, invalidate: () => { fsDSKTransitionToken += 1; }\n};', context);
    context.__dskTestApi.initFsDSKOverlay();
    return { api: context.__dskTestApi, overlay, videos };
}

function playingPauseItem(pathValue = 'A.webm') {
    return {
        path: pathValue,
        inPoint: 0,
        outPoint: 30,
        endMode: 'PAUSE',
        startMode: 'PLAY'
    };
}

test('高速切替で旧Fullscreen DSKを停止し、監視とsrcを解放する', async () => {
    const { api, overlay, videos } = createHarness();

    api.showFullscreenDSK(playingPauseItem('A.webm'), 0);
    const oldVideo = videos[0];
    oldVideo.dispatch('loadeddata');
    await Promise.resolve();

    assert.equal(oldVideo.paused, false);
    assert.equal(oldVideo.listenerCount('timeupdate'), 1);
    assert.equal(oldVideo.listenerCount('ended'), 1);
    assert.equal(oldVideo.frameCallbacks.size, 1);

    api.showFullscreenDSK(playingPauseItem('B.webm'), 0);

    assert.equal(oldVideo.paused, true);
    assert.equal(oldVideo.listenerCount('timeupdate'), 0);
    assert.equal(oldVideo.listenerCount('ended'), 0);
    assert.equal(oldVideo.listenerCount('loadeddata'), 0);
    assert.equal(oldVideo.listenerCount('error'), 0);
    assert.equal(oldVideo.frameCallbacks.size, 0);
    assert.deepEqual(oldVideo.cancelledFrameCallbackIds, [1]);
    assert.equal(oldVideo.src, '');
    assert.deepEqual(oldVideo.removedAttributes, ['src']);
    assert.equal(oldVideo.loadCalls, 1);
    assert.equal(oldVideo.parentElement, null);
    assert.equal(overlay.child, videos[1]);
});

test('旧終了コールバックはトークン不一致でも監視を解除する', () => {
    const { api, videos } = createHarness();

    api.showFullscreenDSK(playingPauseItem(), 0);
    const video = videos[0];
    const staleEndCallback = video._onFsEnd;
    api.invalidate();

    staleEndCallback();

    assert.equal(video.listenerCount('timeupdate'), 0);
    assert.equal(video.listenerCount('ended'), 0);
    assert.equal(video.frameCallbacks.size, 0);
    assert.deepEqual(video.cancelledFrameCallbackIds, [1]);
});

test('DSK_CLEARのフェード完了時にvideoリソースを解放する', async () => {
    const { api, overlay, videos } = createHarness();

    api.showFullscreenDSK(playingPauseItem(), 0);
    const video = videos[0];
    video.dispatch('loadeddata');
    await Promise.resolve();

    api.hideFullscreenDSK(0);

    assert.equal(video.paused, true);
    assert.equal(video.src, '');
    assert.equal(video.loadCalls, 1);
    assert.equal(video.frameCallbacks.size, 0);
    assert.equal(video.parentElement, null);
    assert.equal(overlay.child, null);
});
