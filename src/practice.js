const { setTimeout: delay } = require('node:timers/promises');

function practiceSpeech(backend, text, options, { count, gapMs }, onPhase) {
    if (!Number.isInteger(count) || count < 2 || count > 5 || !Number.isInteger(gapMs) || gapMs < 0 || gapMs > 10000) {
        throw new Error('Practice needs 2–5 repeats and a gap from 0 to 10,000 milliseconds.');
    }
    const controller = new AbortController();
    let active;
    const name = options.profile?.name || 'Local speech';
    const done = (async () => {
        // Let the coordinator install the handle and show its Stop control first.
        await Promise.resolve();
        for (let round = 1; round <= count && !controller.signal.aborted; round++) {
            const progress = { round, rounds: count };
            onPhase(options.profile ? 'generating' : 'playing', name, progress);
            active = backend.speak(text, options, (phase, connection, chunk) => onPhase(phase, connection, { ...chunk, ...progress }));
            await active.done;
            active = undefined;
            if (round < count && !controller.signal.aborted) {
                onPhase('waiting', name, progress);
                try { await delay(gapMs, undefined, { signal: controller.signal }); }
                catch (error) { if (error.name !== 'AbortError') throw error; }
            }
        }
    })();
    return {
        done,
        endRepetitions() { controller.abort(); },
        async stop() {
            controller.abort();
            await active?.stop();
            await done.catch(() => {});
        }
    };
}

module.exports = { practiceSpeech };
