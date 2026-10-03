const { readingMode } = require('./session-text');

const cancelled = () => ({ status: 'cancelled' });

// Owns passage navigation, but all audio still belongs to the shared Playback.
// Snapshot offsets are relative to passage.original; source.offset anchors them
// to the captured document version. No live document content is retained here.
class ReadingSession {
    constructor(playback, resolveOptions) {
        this.playback = playback;
        this.resolveOptions = resolveOptions;
        this.revision = 0;
        this.disposed = false;
        this.listeners = new Set();
        this.value = Object.freeze({ passage: undefined, index: 0, mode: 'manual', phase: 'idle', options: undefined });
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
        if (this.value.phase === 'playing' || this.value.phase === 'generating') this.update({ phase: 'stopped' });
    }

    async load(passage, mode) {
        if (this.disposed) return cancelled();
        readingMode(mode);
        this.interrupt();
        const stopped = this.playback.stop();
        this.update({ passage, index: 0, mode, phase: 'ready', options: undefined });
        return stopped;
    }

    async play() {
        if (this.disposed || !this.value.passage) return cancelled();
        const revision = ++this.revision;
        const { passage, mode } = this.value;
        let options;
        try {
            const resolved = this.resolveOptions(passage);
            options = Object.freeze({ ...resolved, ...(resolved.profile ? { profile: Object.freeze({ ...resolved.profile }) } : {}) });
        } catch (error) {
            const stopped = this.playback.stop();
            this.update({ phase: 'failed', options: undefined });
            await stopped;
            if (revision !== this.revision || this.disposed) return cancelled();
            throw error;
        }
        this.update({ options });
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
            if (mode === 'manual' || this.value.index === passage.sentences.length - 1) {
                this.update({ phase: 'completed' });
                return outcome;
            }
            this.update({ index: this.value.index + 1 });
        }
        return cancelled();
    }

    move(delta) {
        if (this.disposed || !this.value.passage) return Promise.resolve(cancelled());
        const index = this.value.index + delta;
        if (index < 0 || index >= this.value.passage.sentences.length) return this.stop();
        this.interrupt();
        this.update({ index, phase: 'ready' });
        return this.play();
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
        this.update({ passage: undefined, index: 0, phase: 'idle', options: undefined });
        return stopped;
    }

    dispose() {
        this.disposed = true;
        const stopped = this.clear();
        this.listeners.clear();
        return stopped;
    }
}

module.exports = { ReadingSession };
