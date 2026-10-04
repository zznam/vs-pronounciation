const { readingMode } = require('./session-text');
const { setTimeout: sleep } = require('node:timers/promises');

function practiceOptions({ repeatCount = 3, gapSeconds = 2 } = {}) {
    if (!Number.isInteger(repeatCount) || repeatCount < 2 || repeatCount > 5) throw new Error('Practice repeats must be an integer from 2 to 5.');
    if (!Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 10) throw new Error('Practice gap must be a number from 0 to 10 seconds.');
    return Object.freeze({ repeatCount, gapSeconds });
}

const cancelled = () => ({ status: 'cancelled' });

// Owns passage navigation, but all audio still belongs to the shared Playback.
// Snapshot offsets are relative to passage.original; source.offset anchors them
// to the captured document version. No live document content is retained here.
class ReadingSession {
    constructor(playback, resolveOptions, { resolvePractice = () => ({}), delay = (ms, signal) => sleep(ms, undefined, { signal }) } = {}) {
        this.playback = playback;
        this.resolveOptions = resolveOptions;
        this.resolvePractice = resolvePractice;
        this.delay = delay;
        this.gapController = undefined;
        this.revision = 0;
        this.disposed = false;
        this.listeners = new Set();
        this.value = Object.freeze({ passage: undefined, index: 0, mode: 'manual', phase: 'idle', options: undefined, practicing: false, iteration: 0, iterations: 1, gapSeconds: 0 });
    }

    get state() { return this.value; }

    subscribe(listener) {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    update(change) {
        this.value = Object.freeze({ ...this.value, ...change });
        for (const listener of this.listeners) listener(this.value);
    }

    interrupt() {
        ++this.revision;
        this.gapController?.abort();
        this.gapController = undefined;
        if (['playing', 'generating', 'gap'].includes(this.value.phase)) this.update({ phase: 'stopped' });
    }

    async load(passage, mode) {
        if (this.disposed) return cancelled();
        readingMode(mode);
        this.interrupt();
        const stopped = this.playback.stop();
        this.update({ passage, index: 0, mode, phase: 'ready', options: undefined, practicing: false, iteration: 0, iterations: 1, gapSeconds: 0 });
        return stopped;
    }

    play() { return this.run(false); }

    practice() { return this.run(true); }

    async run(practicing) {
        if (this.disposed || !this.value.passage) return cancelled();
        this.interrupt();
        const revision = this.revision;
        const { passage, mode } = this.value;
        let options, settings;
        try {
            settings = practicing ? practiceOptions(this.resolvePractice(passage)) : { repeatCount: 1, gapSeconds: 0 };
            const resolved = this.resolveOptions(passage);
            options = Object.freeze({ ...resolved, ...(resolved.profile ? { profile: Object.freeze({ ...resolved.profile }) } : {}) });
        } catch (error) {
            const stopped = this.playback.stop();
            this.update({ phase: 'failed', options: undefined, practicing: false, iteration: 0, iterations: 1, gapSeconds: 0 });
            await stopped;
            if (revision !== this.revision || this.disposed) return cancelled();
            throw error;
        }
        this.update({ options, practicing, iteration: 1, iterations: settings.repeatCount, gapSeconds: settings.gapSeconds });
        while (!this.disposed && revision === this.revision) {
            const sentence = passage.sentences[this.value.index];
            this.update({ phase: options.profile ? 'generating' : 'playing' });
            if (revision !== this.revision || this.disposed) return cancelled();
            const outcome = await this.playback.speak(sentence.text, options, phase => {
                if (revision === this.revision && !this.disposed) this.update({ phase });
            });
            if (revision !== this.revision || this.disposed) return cancelled();
            if (outcome.status !== 'completed') {
                this.update({ phase: outcome.status === 'failed' ? 'failed' : 'stopped' });
                return outcome;
            }
            const repeating = this.value.iteration < settings.repeatCount;
            const advancing = mode === 'continuous' && this.value.index < passage.sentences.length - 1;
            if (!repeating && !advancing) {
                this.update({ phase: 'completed' });
                return outcome;
            }
            if (settings.gapSeconds > 0 && !await this.waitGap(settings.gapSeconds, revision)) return cancelled();
            if (revision !== this.revision || this.disposed) return cancelled();
            this.update(repeating ? { iteration: this.value.iteration + 1 } : { index: this.value.index + 1, iteration: 1 });
        }
        return cancelled();
    }

    async waitGap(seconds, revision) {
        const controller = new AbortController();
        this.gapController = controller;
        this.update({ phase: 'gap' });
        try {
            await this.delay(seconds * 1000, controller.signal);
            return revision === this.revision && !this.disposed;
        } catch (error) {
            if (controller.signal.aborted || revision !== this.revision || this.disposed) return false;
            this.update({ phase: 'failed' });
            throw error;
        } finally {
            if (this.gapController === controller) this.gapController = undefined;
        }
    }

    move(delta) {
        if (this.disposed || !this.value.passage) return Promise.resolve(cancelled());
        const index = this.value.index + delta;
        if (index < 0 || index >= this.value.passage.sentences.length) return this.stop();
        this.interrupt();
        this.update({ index, phase: 'ready' });
        return this.run(this.value.practicing);
    }

    async select(index) {
        if (this.disposed || !this.value.passage) return cancelled();
        if (!Number.isInteger(index) || index < 0 || index >= this.value.passage.sentences.length) throw new Error('Choose a sentence in the current reading session.');
        this.interrupt();
        const stopped = this.playback.stop();
        this.update({ index, phase: 'ready' });
        return stopped;
    }

    async setMode(mode) {
        if (this.disposed) return cancelled();
        readingMode(mode);
        this.interrupt();
        const stopped = this.playback.stop();
        this.update({ mode });
        return stopped;
    }

    stop() {
        this.interrupt();
        return this.playback.stop();
    }

    clear() {
        this.interrupt();
        const stopped = this.playback.stop();
        this.update({ passage: undefined, index: 0, phase: 'idle', options: undefined, practicing: false, iteration: 0, iterations: 1, gapSeconds: 0 });
        return stopped;
    }

    dispose() {
        this.disposed = true;
        const stopped = this.clear();
        this.listeners.clear();
        return stopped;
    }
}

module.exports = { ReadingSession, practiceOptions };
