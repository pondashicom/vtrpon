'use strict';

class SplitPonAudioTapProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.batchFrames = 960;
        this.left = new Float32Array(this.batchFrames);
        this.right = new Float32Array(this.batchFrames);
        this.writeOffset = 0;
        this.batchContextFrame = 0;
    }

    process(inputs, outputs) {
        const input = inputs[0] || [];
        const output = outputs[0] || [];
        for (const channel of output) {
            channel.fill(0);
        }
        const blockFrames =
            (output[0] && output[0].length) ||
            (input[0] && input[0].length) ||
            128;
        const left = input[0] || null;
        const right = input[1] || left;
        let sourceOffset = 0;

        while (sourceOffset < blockFrames) {
            if (this.writeOffset === 0) {
                this.batchContextFrame = currentFrame + sourceOffset;
            }
            const count = Math.min(
                blockFrames - sourceOffset,
                this.batchFrames - this.writeOffset);
            for (let index = 0; index < count; index += 1) {
                this.left[this.writeOffset + index] =
                    left ? left[sourceOffset + index] : 0;
                this.right[this.writeOffset + index] =
                    right ? right[sourceOffset + index] : 0;
            }
            sourceOffset += count;
            this.writeOffset += count;

            if (this.writeOffset === this.batchFrames) {
                const pcm = new Float32Array(this.batchFrames * 2);
                for (let frame = 0; frame < this.batchFrames; frame += 1) {
                    pcm[frame * 2] = this.left[frame];
                    pcm[frame * 2 + 1] = this.right[frame];
                }
                this.port.postMessage({
                    pcm: pcm.buffer,
                    contextFrame: this.batchContextFrame,
                    frameCount: this.batchFrames,
                    sampleRate,
                    channels: 2,
                }, [pcm.buffer]);
                this.writeOffset = 0;
            }
        }

        // The tap output remains silent. The existing hidden-audio route is unchanged.
        return true;
    }
}

registerProcessor('splitpon-audio-tap', SplitPonAudioTapProcessor);
