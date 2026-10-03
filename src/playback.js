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

    async speak(text, options, onPhase) {
        if (this.disposed) return { status: 'cancelled' };
        const request = ++this.request;
        try {
            await this.current?.stop();
            // Only the newest request may start after the previous process has exited.
            if (request !== this.request || this.disposed) return { status: 'cancelled' };
            const playback = this.backend.speak(text, options, (phase, name) => {
                if (request === this.request && !this.disposed) {
                    this.onPhase?.(phase, name);
                    onPhase?.(phase, name);
                }
            });
            this.current = playback;
            this.onState(true, options);
            try {
                await playback.done;
                return { status: request === this.request && !this.disposed ? 'completed' : 'cancelled' };
            } finally {
                if (this.current === playback) {
                    this.current = null;
                    this.onState(false);
                }
            }
        } catch (error) {
            if (request !== this.request || this.disposed) return { status: 'cancelled' };
            this.onError(error, request);
            return { status: 'failed', error };
        }
    }

    async stop() {
        const request = ++this.request;
        try {
            await this.current?.stop();
            return { status: 'cancelled' };
        } catch (error) {
            if (request !== this.request || this.disposed) return { status: 'cancelled' };
            this.onError(error, request);
            return { status: 'failed', error };
        }
    }

    async dispose() {
        this.disposed = true;
        await this.stop();
    }
}

module.exports = { Playback };
