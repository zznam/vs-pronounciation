const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReadingSession } = require('../src/reading-session');
const { Playback } = require('../src/playback');
const { createPassage } = require('../src/session-text');
const { fakeBackend, tick } = require('./helpers');

const passage = text => createPassage(text, { get: (key, fallback) => fallback }, 'en');

async function setup(mode = 'manual', backendOptions) {
    const backend = fakeBackend(backendOptions), errors = [], states = [];
    const options = { voice: 'Alex', speed: 1 };
    const playback = new Playback(backend, () => {}, error => errors.push(error.message));
    const session = new ReadingSession(playback, () => options);
    const subscription = session.subscribe(state => states.push(state));
    await session.load(passage('One sentence. Two sentences. Three sentences.'), mode);
    return { session, playback, backend, errors, states, options, subscription };
}

test('manual sessions load silently, read only the current sentence, and retain it after completion', async () => {
    const h = await setup();
    assert.equal(h.backend.calls.length, 0);
    assert.equal(h.session.state.phase, 'ready');
    const run = h.session.play(); await tick();
    assert.equal(h.backend.calls[0].text, 'One sentence.');
    assert.equal(h.session.state.phase, 'playing');
    h.backend.calls[0].finish(); assert.equal((await run).status, 'completed');
    assert.equal(h.session.state.index, 0);
    assert.equal(h.session.state.phase, 'completed');
    assert.ok(Object.isFrozen(h.session.state));
    h.subscription.dispose(); const count = h.states.length;
    await h.session.dispose(); assert.equal(h.states.length, count);
});

test('continuous runs freeze voice settings, advance in order, and finish on the last sentence', async () => {
    const h = await setup('continuous');
    h.options.profile = { name: 'Cloud', voice: 'first', speed: 1 };
    const run = h.session.play(); await tick();
    h.options.voice = 'changed'; h.options.profile.voice = 'changed';
    for (let index = 0; index < 3; index++) {
        assert.equal(h.session.state.index, index);
        assert.equal(h.backend.calls[index].options.voice, 'Alex');
        assert.equal(h.backend.calls[index].options.profile.voice, 'first');
        h.backend.calls[index].finish(); await tick();
    }
    assert.equal((await run).status, 'completed');
    assert.deepEqual(h.backend.calls.map(c => c.text), ['One sentence.', 'Two sentences.', 'Three sentences.']);
    assert.equal(h.session.state.phase, 'completed');
    const replay = h.session.play(); await tick();
    assert.equal(h.backend.calls[3].options.voice, 'changed');
    assert.equal(h.backend.calls[3].options.profile.voice, 'changed');
    await h.session.stop(); await replay;
});

test('Stop cancels continuous advancement and subsequent Play restarts the interrupted sentence', async () => {
    const h = await setup('continuous');
    const first = h.session.play(); await tick();
    h.backend.calls[0].finish(); await tick();
    await h.session.stop(); assert.equal((await first).status, 'cancelled');
    assert.equal(h.session.state.index, 1);
    assert.equal(h.session.state.phase, 'stopped');
    await tick(); assert.equal(h.backend.calls.length, 2);
    const retry = h.session.play(); await tick();
    assert.equal(h.backend.calls[2].text, 'Two sentences.');
    await h.session.stop(); await retry;
});

test('Previous/Next interrupt and read the chosen sentence without wrapping at boundaries', async () => {
    const h = await setup();
    await h.session.move(-1); assert.equal(h.backend.calls.length, 0);
    const first = h.session.play(); await tick();
    const next = h.session.move(1); await tick();
    assert.equal((await first).status, 'cancelled');
    assert.equal(h.backend.calls[1].text, 'Two sentences.');
    const previous = h.session.move(-1); await tick();
    assert.equal((await next).status, 'cancelled');
    assert.equal(h.backend.calls[2].text, 'One sentence.');
    await h.session.stop(); await previous;
    await h.session.select(2);
    await h.session.move(1);
    assert.equal(h.backend.calls.length, 3);
    assert.equal(h.session.state.index, 2);
});

test('rapid navigation waits for process exit and only the newest request can speak', async () => {
    const h = await setup('manual', { autoStop: false });
    const first = h.session.play(); await tick();
    const second = h.session.move(1), third = h.session.move(1);
    await tick(); assert.equal(h.backend.calls.length, 1);
    h.backend.calls[0].finish(); await tick();
    assert.deepEqual(h.backend.calls.map(c => c.text), ['One sentence.', 'Three sentences.']);
    h.backend.calls[1].finish();
    assert.deepEqual((await Promise.all([first, second, third])).map(r => r.status), ['cancelled', 'cancelled', 'completed']);
});

test('ordinary reads and previews cancel session playback without a stale automatic continuation', async () => {
    const h = await setup('continuous');
    const run = h.session.play(); await tick();
    h.session.interrupt();
    const ordinary = h.playback.speak('ordinary', {}); await tick();
    assert.equal((await run).status, 'cancelled');
    assert.equal(h.session.state.phase, 'stopped');
    h.backend.calls[1].finish(); await ordinary; await tick();
    assert.deepEqual(h.backend.calls.map(c => c.text), ['One sentence.', 'ordinary']);
    const second = h.session.play(); await tick();
    const preview = h.playback.speak('preview', { preview: true }); await tick();
    assert.equal((await second).status, 'cancelled');
    assert.equal(h.session.state.phase, 'stopped');
    h.backend.calls[3].finish(); await preview;
});

test('engine failures retain position, stop advancement, and allow retry', async () => {
    const h = await setup('continuous');
    const run = h.session.play(); await tick();
    h.backend.calls[0].fail(new Error('offline'));
    assert.equal((await run).status, 'failed');
    assert.equal(h.session.state.phase, 'failed');
    assert.equal(h.session.state.index, 0);
    assert.deepEqual(h.errors, ['offline']);
    const retry = h.session.play(); await tick();
    assert.equal(h.backend.calls[1].text, 'One sentence.');
    await h.session.stop(); await retry;
});

test('clear and replacement sessions discard old snapshots and cannot resurrect an old run', async () => {
    const h = await setup('continuous');
    const first = h.session.play(); await tick();
    await h.session.load(passage('Replacement.'), 'manual');
    assert.equal((await first).status, 'cancelled');
    assert.equal(h.session.state.index, 0);
    assert.equal(h.session.state.passage.original, 'Replacement.');
    const replacement = h.session.play(); await tick();
    await h.session.clear(); assert.equal((await replacement).status, 'cancelled');
    assert.equal(h.session.state.passage, undefined);
    assert.equal(h.session.state.phase, 'idle');
    await h.session.play(); await h.session.move(1); await h.session.select(0);
    assert.equal(h.backend.calls.length, 2);
    const ordinary = h.playback.speak('ordinary'); await tick();
    await h.session.clear(); assert.equal(h.backend.calls[2].stops, 1);
    h.backend.calls[2].finish(); await ordinary;
});

test('selecting a sentence is silent; changing mode stops playback and applies on the next run', async () => {
    const h = await setup();
    await h.session.select(1); assert.equal(h.backend.calls.length, 0);
    await assert.rejects(h.session.select(3), /Choose a sentence/);
    await assert.rejects(h.session.select(0.5), /Choose a sentence/);
    await assert.rejects(h.session.setMode('invalid'), /Reading mode/);
    const run = h.session.play(); await tick();
    await h.session.setMode('continuous'); await run;
    assert.equal(h.session.state.mode, 'continuous');
    const continuous = h.session.play(); await tick();
    h.backend.calls[1].finish(); await tick();
    assert.equal(h.backend.calls[2].text, 'Three sentences.');
    h.backend.calls[2].finish(); await continuous;
});

test('invalid connection options stop old audio and cannot advance the passage', async () => {
    const h = await setup('continuous');
    const old = h.session.play(); await tick();
    h.session.resolveOptions = () => { throw new Error('missing connection'); };
    await assert.rejects(h.session.play(), /missing connection/);
    await old;
    assert.equal(h.backend.calls[0].stops, 1);
    assert.equal(h.session.state.phase, 'failed');
    assert.equal(h.session.state.index, 0);
});

test('failed cancellation never permits overlapping speech or an automatic continuation', async () => {
    const h = await setup('continuous');
    const first = h.session.play(); await tick();
    h.backend.calls[0].stop = async () => { throw new Error('cannot stop'); };
    assert.equal((await h.session.move(1)).status, 'failed');
    assert.equal(h.session.state.phase, 'failed');
    assert.equal(h.backend.calls.length, 1);
    h.backend.calls[0].finish(); await first;
    assert.equal(h.backend.calls.length, 1);
});

test('phase notifications are published for the current run only', async () => {
    const h = await setup();
    const originalSpeak = h.backend.speak;
    let phase;
    h.backend.speak = (text, options, notify) => { phase = notify; return originalSpeak(text, options); };
    const run = h.session.play(); await tick();
    phase('generating', 'Cloud'); assert.equal(h.session.state.phase, 'generating');
    phase('playing', 'Cloud'); assert.equal(h.session.state.phase, 'playing');
    h.session.interrupt();
    phase('generating', 'Cloud'); assert.equal(h.session.state.phase, 'stopped');
    await h.playback.stop(); await run;
    phase('playing', 'Cloud'); assert.equal(h.session.state.phase, 'stopped');
});

test('listeners can cancel before enqueueing audio and after the last sentence without starting stale work', async () => {
    const h = await setup();
    h.session.subscribe(state => { if (state.phase === 'playing') h.session.interrupt(); });
    assert.equal((await h.session.play()).status, 'cancelled');
    assert.equal(h.backend.calls.length, 0);
    const other = await setup('continuous');
    other.session.subscribe(state => { if (state.options && state.phase === 'ready') other.session.interrupt(); });
    assert.equal((await other.session.play()).status, 'cancelled');
    assert.equal(other.backend.calls.length, 0);
});

test('disposal clears state, cancels speech, removes subscribers, and prevents future actions', async () => {
    const h = await setup('continuous');
    const run = h.session.play(); await tick();
    await h.session.dispose(); assert.equal((await run).status, 'cancelled');
    assert.equal(h.session.state.passage, undefined);
    assert.equal(h.session.listeners.size, 0);
    await h.session.load(passage('ignored'), 'manual');
    await h.session.play(); await h.session.move(1); await h.session.select(0); await h.session.setMode('manual');
    assert.equal(h.backend.calls.length, 1);
});
