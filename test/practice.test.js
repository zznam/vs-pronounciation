const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReadingSession, practiceOptions } = require('../src/reading-session');
const { Playback } = require('../src/playback');
const { createPassage } = require('../src/session-text');
const { fakeBackend, deferred, tick } = require('./helpers');

const passage = text => createPassage(text, { get: (key, fallback) => fallback }, 'en');
async function setup(mode = 'manual', settings = {}) {
    const backend = fakeBackend(), gaps = [], errors = [];
    const options = { voice: 'Alex', speed: 1, profile: { voice: 'first' } };
    const playback = new Playback(backend, () => {}, error => errors.push(error));
    const session = new ReadingSession(playback, () => options, {
        resolvePractice: () => settings,
        delay(ms, signal) {
            const result = deferred();
            signal.addEventListener('abort', () => result.reject(new Error('aborted')), { once: true });
            gaps.push({ ms, signal, ...result });
            return result.promise;
        }
    });
    await session.load(passage('First sentence. Second sentence.'), mode);
    return { backend, playback, session, settings, options, gaps, errors };
}

async function finish(h, index) { h.backend.calls[index].finish(); await tick(); }
async function next(h, index) { h.gaps[index].resolve(); await tick(); }

test('manual practice defaults to three reads with two two-second gaps and visible progress', async () => {
    const h = await setup();
    const run = h.session.practice(); await tick();
    assert.equal(h.session.state.practicing, true);
    for (let index = 0; index < 3; index++) {
        assert.equal(h.session.state.iteration, index + 1);
        assert.equal(h.session.state.iterations, 3);
        assert.equal(h.session.state.index, 0);
        await finish(h, index);
        if (index < 2) {
            assert.equal(h.session.state.phase, 'gap');
            assert.equal(h.gaps[index].ms, 2000);
            assert.equal(h.backend.calls.length, index + 1);
            await next(h, index);
        }
    }
    assert.equal((await run).status, 'completed');
    assert.equal(h.session.state.phase, 'completed');
    assert.deepEqual(h.backend.calls.map(call => call.text), Array(3).fill('First sentence.'));
    assert.equal(h.gaps.length, 2, 'No trailing gap');
    await h.session.dispose();
});

test('continuous practice freezes connection, voice, count and fractional gaps until the next run', async () => {
    const h = await setup('continuous', { repeatCount: 2, gapSeconds: 0.25 });
    const run = h.session.practice(); await tick();
    h.options.voice = 'changed'; h.options.profile.voice = 'changed';
    h.settings.repeatCount = 5; h.settings.gapSeconds = 0;
    for (let index = 0; index < 4; index++) {
        const call = h.backend.calls[index];
        assert.equal(call.options.voice, 'Alex'); assert.equal(call.options.profile.voice, 'first');
        assert.equal(h.session.state.index, Math.floor(index / 2));
        assert.equal(h.session.state.iteration, index % 2 + 1);
        await finish(h, index);
        if (index < 3) { assert.equal(h.gaps[index].ms, 250); await next(h, index); }
    }
    assert.equal((await run).status, 'completed');
    assert.deepEqual(h.backend.calls.map(call => call.text), ['First sentence.', 'First sentence.', 'Second sentence.', 'Second sentence.']);
    const changed = h.session.practice(); await tick();
    assert.equal(h.session.state.iterations, 5); assert.equal(h.session.state.gapSeconds, 0);
    for (let index = 4; index < 9; index++) {
        assert.equal(h.backend.calls[index].options.profile.voice, 'changed');
        await finish(h, index);
    }
    assert.equal((await changed).status, 'completed');
    assert.equal(h.gaps.length, 3);
    await h.session.dispose();
});

test('practice settings validate finite bounds; Play ignores practice settings', async () => {
    assert.deepEqual(practiceOptions(), { repeatCount: 3, gapSeconds: 2 });
    assert.deepEqual(practiceOptions({ repeatCount: 5, gapSeconds: 10 }), { repeatCount: 5, gapSeconds: 10 });
    for (const repeatCount of [1, 6, 2.5, NaN, '3']) assert.throws(() => practiceOptions({ repeatCount }), /integer from 2 to 5/);
    for (const gapSeconds of [-1, 11, NaN, Infinity, '2']) assert.throws(() => practiceOptions({ gapSeconds }), /0 to 10/);
    const h = await setup('manual', { repeatCount: 10 });
    await assert.rejects(h.session.practice(), /integer/);
    assert.equal(h.backend.calls.length, 0); assert.equal(h.session.state.phase, 'failed');
    const play = h.session.play(); await tick(); await finish(h, 0);
    assert.equal((await play).status, 'completed'); assert.equal(h.session.state.practicing, false);
    await h.session.dispose();
});

for (const action of ['stop', 'clear', 'dispose', 'select', 'mode', 'replace', 'ordinary', 'play', 'practice', 'next']) {
    test(`${action} during a gap aborts its timer and prevents stale speech`, async () => {
        const h = await setup();
        const old = h.session.practice(); await tick(); await finish(h, 0);
        assert.equal(h.session.state.phase, 'gap');
        let replacement;
        if (action === 'select') replacement = h.session.select(1);
        else if (action === 'mode') replacement = h.session.setMode('continuous');
        else if (action === 'replace') replacement = h.session.load(passage('New.'), 'manual');
        else if (action === 'ordinary') { h.session.interrupt(); replacement = h.playback.speak('Ordinary.'); }
        else if (action === 'next') replacement = h.session.move(1);
        else replacement = h.session[action]();
        assert.equal(h.gaps[0].signal.aborted, true);
        assert.equal((await old).status, 'cancelled');
        h.gaps[0].resolve(); await tick();
        if (['ordinary', 'play', 'practice', 'next'].includes(action)) {
            assert.equal(h.backend.calls.length, 2);
            if (action === 'next') { assert.equal(h.backend.calls[1].text, 'Second sentence.'); assert.equal(h.session.state.practicing, true); }
            if (action === 'play') assert.equal(h.session.state.iterations, 1);
            await h.session.stop(); await replacement;
        } else { await replacement; assert.equal(h.backend.calls.length, 1); }
        await h.session.dispose();
        assert.equal((await h.session.practice()).status, 'cancelled');
    });
}

test('practice failures stop repetition and retain the current position', async () => {
    const h = await setup('continuous');
    const run = h.session.practice(); await tick();
    h.backend.calls[0].fail(new Error('offline'));
    assert.equal((await run).status, 'failed');
    assert.equal(h.session.state.index, 0); assert.equal(h.session.state.phase, 'failed');
    assert.equal(h.gaps.length, 0); assert.equal(h.errors.length, 1);
    const retry = h.session.practice(); await tick(); await finish(h, 1);
    const rejected = assert.rejects(retry, /timer failed/);
    h.gaps[0].reject(new Error('timer failed')); await rejected;
    assert.equal(h.session.state.phase, 'failed'); assert.equal(h.backend.calls.length, 2);
    await h.session.dispose();
});

test('a delayed gap result and synchronous cancellation listeners cannot continue an obsolete run', async () => {
    const h = await setup(); const pending = deferred();
    h.session.delay = () => pending.promise;
    const old = h.session.practice(); await tick(); await finish(h, 0);
    await h.session.stop(); pending.resolve(); assert.equal((await old).status, 'cancelled');
    const listener = h.session.subscribe(state => { if (state.phase === 'gap') h.session.interrupt(); });
    const run = h.session.practice(); await tick(); await finish(h, 1);
    assert.equal((await run).status, 'cancelled'); assert.equal(h.backend.calls.length, 2);
    listener.dispose(); await h.session.dispose();
});

test('real cancellable timers complete fractional gaps and Stop clears the default two-second wait', async () => {
    const backend = { speak: () => ({ done: Promise.resolve(), stop: async () => {} }) };
    const session = new ReadingSession(new Playback(backend, () => {}, () => {}), () => ({}), {
        resolvePractice: () => ({ repeatCount: 2, gapSeconds: 0.001 })
    });
    await session.load(passage('Hi.'), 'manual');
    assert.equal((await session.practice()).status, 'completed');
    session.resolvePractice = () => ({});
    const gap = deferred(); session.subscribe(state => { if (state.phase === 'gap') gap.resolve(); });
    const run = session.practice(); await gap.promise; await session.stop();
    assert.equal((await run).status, 'cancelled');
    await session.dispose();
});
