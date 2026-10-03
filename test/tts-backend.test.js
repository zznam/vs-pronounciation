const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTtsBackend, secretKey } = require('../src/tts-backend');
const { fakeBackend, deferred, tick } = require('./helpers');
const { profile, wav, until } = require('./tts-helpers');

async function setup(t, overrides = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const local = fakeBackend();
    const calls = [], played = [], phases = [];
    const providers = { async synthesize(...args) { calls.push(args); return wav(); } };
    const player = { async ensureReady() {}, play(file) { played.push(file); return { done: Promise.resolve(), async stop() {} }; } };
    const secrets = { async get(id) { assert.equal(id, secretKey('test-connection')); return 'key'; } };
    const backend = createTtsBackend(local, { providers, player, secrets, tempRoot: root, ...overrides });
    t.after(() => backend.dispose());
    const speak = (text = 'Hello', options = { profile: profile() }) => backend.speak(text, options, (...phase) => phases.push(phase));
    return { root, backend, local, calls, played, phases, player, providers, secrets, speak };
}

test('local playback remains offline with native settings, while previews preserve cloud replay', async t => {
    const h = await setup(t);
    await h.speak().done;
    const preview = h.speak('sample', { preview: true });
    assert.deepEqual(h.local.calls[0].options, { voice: '', speed: 1 });
    h.local.calls[0].finish(); await preview.done;
    await h.speak().done;
    assert.equal(h.calls.length, 1);
    const local = h.speak('local', { voice: 'Alex', speed: 0.75 });
    h.local.calls[1].finish(); await local.done; await tick();
    await h.speak().done;
    assert.equal(h.calls.length, 2);
});

test('API chunks generate and play sequentially with generating/playing state and session replay', async t => {
    const h = await setup(t);
    const text = 'x'.repeat(4500);
    await h.speak(text).done;
    assert.deepEqual(h.calls.map(call => call[1].length), [2000, 2000, 500]);
    assert.deepEqual(h.phases.map(phase => phase[0]), ['generating', 'playing', 'generating', 'playing', 'generating', 'playing']);
    assert.ok(h.phases.every(phase => phase[1] === 'Test cloud'));
    assert.deepEqual(await fs.readFile(h.played[0]), wav());
    await h.speak(text).done;
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.played.slice(3), h.played.slice(0, 3));
    await h.backend.clearReplay();
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('different text, settings, endpoints and keys invalidate previously generated audio', async t => {
    const h = await setup(t);
    await h.speak().done;
    const previous = h.played[0];
    await h.speak('new text').done;
    await assert.rejects(fs.access(previous));
    await h.speak('new text', { profile: profile({ speed: 0.5 }) }).done;
    h.secrets.get = async () => 'changed-key';
    await h.speak('new text', { profile: profile({ speed: 0.5 }) }).done;
    assert.equal(h.calls.length, 4);
    await h.backend.dispose();
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('API previews never replace replay audio and always remove their files', async t => {
    const h = await setup(t);
    await h.speak().done;
    await h.speak('preview', { profile: profile(), preview: true }).done;
    await assert.rejects(fs.access(h.played[1]));
    await h.speak().done;
    assert.equal(h.calls.length, 2);
    assert.equal(h.played[2], h.played[0]);
});

test('missing audio players fail before any paid generation; absent credentials reach provider validation', async t => {
    const h = await setup(t);
    h.player.ensureReady = async () => { throw new Error('missing player'); };
    await assert.rejects(h.speak().done, error => error.cloud && error.remainingText === 'Hello' && /missing player/.test(error.message));
    assert.equal(h.calls.length, 0);
    const noKey = await setup(t, { secrets: { get: async () => undefined } });
    await noKey.speak().done;
    assert.equal(noKey.calls[0][2], '');
    await assert.rejects(h.speak('bad', { profile: profile({ speed: 10 }) }).done, /speed/);
});

test('Stop aborts generation and prevents later chunks, audio, errors and retained files', async t => {
    const h = await setup(t);
    const generated = deferred();
    h.providers.synthesize = async (p, text, key, signal) => {
        signal.addEventListener('abort', () => generated.reject(new Error('cancelled')), { once: true });
        return generated.promise;
    };
    const run = h.speak('x'.repeat(4000));
    await until(() => h.phases.length > 0);
    await Promise.all([run.stop(), run.stop(), run.done]);
    assert.equal(h.played.length, 0);
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('Stop during playback kills active audio and discards incomplete passage cache', async t => {
    const h = await setup(t);
    const current = deferred();
    let stops = 0;
    h.player.play = () => ({ done: current.promise, async stop() { stops++; current.resolve(); } });
    const run = h.speak('x'.repeat(4000));
    await until(() => h.phases.some(phase => phase[0] === 'playing'));
    await run.stop();
    assert.equal(stops, 1);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('later chunk failure supplies only the unplayed remainder and removes partial cache', async t => {
    const h = await setup(t);
    let count = 0;
    h.providers.synthesize = async () => { if (++count === 2) throw new Error('quota reached'); return wav(); };
    await assert.rejects(h.speak('x'.repeat(2000) + 'y'.repeat(500)).done, error => error.remainingText === 'y'.repeat(500) && error.cloud);
    assert.equal(h.played.length, 1);
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('clear replay during generation does not interrupt audio or repopulate the cache', async t => {
    const h = await setup(t);
    const generated = deferred();
    h.providers.synthesize = () => generated.promise;
    const run = h.speak(); await until(() => h.phases.length > 0);
    await h.backend.clearReplay();
    generated.resolve(wav()); await run.done;
    assert.equal(h.played.length, 1);
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('clear replay defers removing files currently in use until playback finishes', async t => {
    const h = await setup(t);
    await h.speak().done;
    const current = deferred();
    h.player.play = () => ({ done: current.promise, stop: async () => current.resolve() });
    const replay = h.speak(); await until(() => h.phases.length > 2);
    await h.backend.clearReplay();
    assert.equal((await fs.readdir(h.root)).length, 1);
    current.resolve(); await replay.done;
    assert.deepEqual(await fs.readdir(h.root), []);
});

test('cancellation during secret lookup or player checks never starts an HTTP request', async t => {
    const secret = deferred();
    const h = await setup(t, { secrets: { get: () => secret.promise } });
    const run = h.speak(); const stop = run.stop(); secret.resolve('key'); await stop;
    assert.equal(h.calls.length, 0);
    const ready = deferred();
    h.secrets.get = async () => 'key'; h.player.ensureReady = () => ready.promise;
    const next = h.speak(); await tick(); const stopping = next.stop(); ready.resolve(); await stopping;
    assert.equal(h.calls.length, 0);
});

test('deactivation stops active jobs and removes their audio, including late generated responses', async t => {
    const h = await setup(t);
    const generated = deferred();
    h.providers.synthesize = () => generated.promise;
    const run = h.speak(); await until(() => h.phases.length > 0); const dispose = h.backend.dispose();
    generated.resolve(wav()); await Promise.all([dispose, run.done]);
    assert.equal(h.played.length, 0);
    assert.deepEqual(await fs.readdir(h.root), []);
});
