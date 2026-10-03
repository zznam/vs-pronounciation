class Playback {
    constructor(backend, onState, onError, onPhase) {
        this.backend = backend;
        this.onState = onState;
        this.onError = onError;
        this.onPhase = onPhase;
        this.current = null;
        this.request = 0;
        this.disposed = false;
    }

    async speak(text, options) {
        if (this.disposed) return;
        const request = ++this.request;
        try {
            await this.current?.stop();
            // Only the newest request may start after the previous process has exited.
            if (request !== this.request || this.disposed) return;
            const playback = this.backend.speak(text, options, (phase, name) => {
                if (request === this.request && !this.disposed) this.onPhase?.(phase, name);
            });
            this.current = playback;
            this.onState(true, options);
            try {
                await playback.done;
            } finally {
                if (this.current === playback) {
                    this.current = null;
                    this.onState(false);
                }
            }
        } catch (error) {
            if (request === this.request && !this.disposed) this.onError(error, request);
        }
    }

    async stop() {
        ++this.request;
        try {
            await this.current?.stop();
        } catch (error) {
            if (!this.disposed) this.onError(error);
        }
    }

    async dispose() {
        this.disposed = true;
        await this.stop();
    }
}

module.exports = { Playback };
