const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Playback } = require('../src/playback');
const { fakeBackend, tick } = require('./helpers');

function setup(options) {
    const backend = fakeBackend(options);
    const states = [], errors = [];
    const playback = new Playback(backend, state => states.push(state), error => errors.push(error.message));
    return { backend, states, errors, playback };
}

test('shows playback state until speech finishes', async () => {
    const h = setup();
    const run = h.playback.speak('hello', { speed: 0.5 });
    await tick();
    assert.deepEqual(h.states, [true]);
    assert.deepEqual(h.backend.calls[0].options, { speed: 0.5 });
    h.backend.calls[0].finish();
    await run;
    assert.deepEqual(h.states, [true, false]);
    assert.equal(h.playback.current, null);
});

test('waits for old speech to exit and starts only the newest queued request', async () => {
    const h = setup({ autoStop: false });
    const first = h.playback.speak('first');
    await tick();
    const second = h.playback.speak('second');
    const third = h.playback.speak('third');
    await tick();
    assert.equal(h.backend.calls.length, 1);
    h.backend.calls[0].finish();
    await tick();
    assert.deepEqual(h.backend.calls.map(call => call.text), ['first', 'third']);
    h.backend.calls[1].finish();
    await Promise.all([first, second, third]);
    assert.deepEqual(h.states, [true, false, true, false]);
});

test('stop cancels pending replacement as well as active speech', async () => {
    const h = setup({ autoStop: false });
    const first = h.playback.speak('first');
    await tick();
    const second = h.playback.speak('second');
    const stop = h.playback.stop();
    h.backend.calls[0].finish();
    await Promise.all([first, second, stop]);
    assert.equal(h.backend.calls.length, 1);
    assert.deepEqual(h.errors, []);
});

test('stop before a speech request starts prevents audio', async () => {
    const h = setup();
    await Promise.all([h.playback.speak('hello'), h.playback.stop()]);
    assert.equal(h.backend.calls.length, 0);
});

test('a cancelled request failing does not report a stale error', async () => {
    const h = setup({ autoStop: false });
    const first = h.playback.speak('first');
    await tick();
    const second = h.playback.speak('second');
    h.backend.calls[0].fail(new Error('cancelled'));
    await tick();
    assert.deepEqual(h.errors, []);
    assert.equal(h.playback.current, h.backend.calls[1]);
    h.backend.calls[1].finish();
    await Promise.all([first, second]);
});

test('asynchronous errors clear state, notify once, and allow retry', async () => {
    const h = setup();
    const first = h.playback.speak('first');
    await tick();
    h.backend.calls[0].fail(new Error('missing voice'));
    await first;
    assert.deepEqual(h.errors, ['missing voice']);
    assert.deepEqual(h.states, [true, false]);
    const retry = h.playback.speak('retry');
    await tick();
    h.backend.calls[1].finish();
    await retry;
});

test('synchronous backend failures are reported without a stuck speaking state', async () => {
    const h = setup();
    h.backend.speak = () => { throw new Error('bad voice'); };
    await h.playback.speak('hello');
    assert.deepEqual(h.states, []);
    assert.deepEqual(h.errors, ['bad voice']);
});

test('failed stop is reported and does not start overlapping speech', async () => {
    const h = setup();
    const first = h.playback.speak('first');
    await tick();
    h.backend.calls[0].stop = async () => { throw new Error('cannot stop'); };
    await h.playback.speak('second');
    await h.playback.stop();
    assert.equal(h.backend.calls.length, 1);
    assert.deepEqual(h.errors, ['cannot stop', 'cannot stop']);
    h.backend.calls[0].finish();
    await first;
});

test('deactivation stops active audio and prevents future requests', async () => {
    const h = setup();
    const run = h.playback.speak('hello');
    await tick();
    await h.playback.dispose();
    await h.playback.speak('ignored');
    await h.playback.dispose();
    await run;
    assert.equal(h.backend.calls.length, 1);
    assert.equal(h.backend.calls[0].stops, 1);
    assert.deepEqual(h.errors, []);
});

test('deactivation suppresses late stop failures', async () => {
    const h = setup();
    const run = h.playback.speak('hello');
    await tick();
    h.backend.calls[0].stop = async () => { throw new Error('already shutting down'); };
    await h.playback.dispose();
    h.backend.calls[0].fail(new Error('late failure'));
    await run;
    assert.deepEqual(h.errors, []);
});


test('playback outcomes distinguish normal completion, queued cancellation, and failure', async () => {
    const h = setup();
    const completed = h.playback.speak('complete'); await tick();
    h.backend.calls[0].finish(); assert.equal((await completed).status, 'completed');
    const cancelled = h.playback.speak('cancel'); await h.playback.stop();
    assert.equal((await cancelled).status, 'cancelled');
    const failure = new Error('failed');
    const failed = h.playback.speak('failure'); await tick();
    h.backend.calls[1].fail(failure);
    assert.deepEqual(await failed, { status: 'failed', error: failure });
});

test('a superseded Stop failure is silent and cannot supply a recovery action for newer playback', async () => {
    const h = setup();
    const first = h.playback.speak('first'); await tick();
    let reject;
    h.backend.calls[0].stop = () => new Promise((resolve, no) => { reject = no; });
    const stop = h.playback.stop();
    const failure = reject;
    h.backend.calls[0].stop = async () => h.backend.calls[0].finish();
    const second = h.playback.speak('second'); await tick();
    failure(new Error('obsolete failure')); assert.equal((await stop).status, 'cancelled');
    assert.deepEqual(h.errors, []);
    h.backend.calls[1].finish(); await Promise.all([first, second]);
});
