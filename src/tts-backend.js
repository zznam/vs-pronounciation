const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProviders, splitPassage, validateProfile } = require('./tts-providers');
const { createAudioPlayer } = require('./audio-player');

function secretKey(id) { return `pronounciation.tts.apiKey.${id}`; }

function createTtsBackend(local, { secrets, providers = createProviders(), player = createAudioPlayer(), files = fs, tempRoot = os.tmpdir() } = {}) {
    let cache;
    let epoch = 0;
    let disposed = false;
    const retained = new Set();
    const busy = new Set();
    const jobs = new Set();
    async function remove(directory) {
        if (busy.has(directory)) { retained.add(directory); return; }
        await files.rm(directory, { recursive: true, force: true });
        retained.delete(directory);
    }
    const backend = {
        async clearReplay() {
            ++epoch;
            const old = cache;
            cache = undefined;
            if (old) await remove(old.directory);
        },
        speak(text, options = {}, onPhase) {
            if (!options.profile) {
                if (!options.preview) void backend.clearReplay().catch(() => {});
                return local.speak(text, { voice: options.voice || '', speed: options.speed ?? 1 });
            }
            const profile = { ...options.profile };
            const controller = new AbortController();
            let active;
            let remainingText = text;
            let directory;
            const startEpoch = epoch;
            const done = (async () => {
                try {
                    validateProfile(profile);
                    const key = await secrets.get(secretKey(profile.id)) || '';
                    if (controller.signal.aborted) return;
                    const signature = JSON.stringify([text, profile, key]);
                    await player.ensureReady();
                    if (controller.signal.aborted) return;
                    const hit = !options.preview && cache?.signature === signature;
                    const allowCache = startEpoch === epoch;
                    if (!options.preview && !hit) await backend.clearReplay();
                    const cacheEpoch = epoch;
                    directory = hit ? cache.directory : await files.mkdtemp(path.join(tempRoot, 'pronunciation-audio-'));
                    busy.add(directory);
                    const chunks = splitPassage(text);
                    const paths = [];
                    for (let i = 0; i < chunks.length; i++) {
                        remainingText = chunks.slice(i).join('');
                        if (controller.signal.aborted) return;
                        const file = path.join(directory, `${i}.wav`);
                        if (!hit) {
                            onPhase?.('generating', profile.name);
                            const audio = await providers.synthesize(profile, chunks[i], key, controller.signal);
                            if (controller.signal.aborted) return;
                            await files.writeFile(file, audio, { mode: 0o600 });
                        }
                        if (controller.signal.aborted) return;
                        onPhase?.('playing', profile.name);
                        active = player.play(file);
                        await active.done;
                        active = undefined;
                        paths.push(file);
                    }
                    if (!controller.signal.aborted && !options.preview && allowCache && cacheEpoch === epoch && !disposed) {
                        cache = { signature, directory, paths };
                    }
                } catch (error) {
                    if (!controller.signal.aborted) {
                        // Never expose provider responses, URLs, credentials, or selected text in notifications.
                        throw Object.assign(new Error(error.message), { cloud: true, remainingText });
                    }
                } finally {
                    if (directory) {
                        busy.delete(directory);
                        if (cache?.directory !== directory || controller.signal.aborted || (options.preview && startEpoch !== epoch)) {
                            if (cache?.directory === directory) cache = undefined;
                            await remove(directory);
                        }
                    }
                }
            })();
            const handle = { done, async stop() { controller.abort(); await active?.stop(); await done.catch(() => {}); } };
            jobs.add(handle);
            done.then(() => jobs.delete(handle), () => jobs.delete(handle));
            return handle;
        },
        async dispose() {
            disposed = true;
            await Promise.all([...jobs].map(job => job.stop()));
            await backend.clearReplay();
            await Promise.all([...retained].map(remove));
        }
    };
    return backend;
}

module.exports = { createTtsBackend, secretKey };
