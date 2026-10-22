const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Playback } = require('../src/playback');
const { registerExtension } = require('../src/extension');
const { fakeBackend, fakeVscode, fakeEditor, deferred, tick } = require('./helpers');
const { until } = require('./tts-helpers');

function coordinator() {
    const backend = fakeBackend();
    const states = [], phases = [], errors = [];
    const playback = new Playback(backend, state => states.push(state), error => errors.push(error.message), (...phase) => phases.push(phase));
    return { backend, playback, states, phases, errors };
}

test('practice plays exactly the selected number of repeats with one continuous Stop control', async () => {
    const h = coordinator();
    const run = h.playback.speak('hello', { speed: 0.5 }, undefined, { count: 3, gapMs: 0 });
    for (let round = 1; round <= 3; round++) {
        // A zero-length gap still yields to a timer, allowing Stop between rounds.
        await until(() => h.backend.calls.length === round);
        assert.equal(h.backend.calls.at(-1).text, 'hello');
        assert.deepEqual(h.backend.calls.at(-1).options, { speed: 0.5 });
        h.backend.calls.at(-1).finish();
    }
    await run;
    assert.deepEqual(h.states, [true, false]);
    assert.deepEqual(h.phases.filter(p => p[0] === 'playing').map(p => p[2]), [{ round: 1, rounds: 3 }, { round: 2, rounds: 3 }, { round: 3, rounds: 3 }]);
});

test('Stop, replacement reads and deactivation cancel practice gaps immediately', async () => {
    for (const action of ['stop', 'replacement', 'dispose']) {
        const h = coordinator();
        const run = h.playback.speak('practice', {}, undefined, { count: 5, gapMs: 10000 });
        await tick(); h.backend.calls[0].finish(); await tick();
        assert.equal(h.phases.at(-1)[0], 'waiting');
        if (action === 'replacement') {
            const replacement = h.playback.speak('new', {});
            await tick();
            assert.equal(h.backend.calls[1].text, 'new');
            h.backend.calls[1].finish(); await replacement;
        } else await h.playback[action]();
        await run;
        assert.equal(h.backend.calls.length, action === 'replacement' ? 2 : 1);
        assert.deepEqual(h.errors, []);
        assert.equal(h.states.at(-1), false);
    }
});

test('Stop cancels active practice audio and a failure prevents all later repeats', async () => {
    for (const failure of [false, true]) {
        const h = coordinator();
        const run = h.playback.speak('practice', {}, undefined, { count: 2, gapMs: 0 });
        await tick();
        if (failure) h.backend.calls[0].fail(new Error('unavailable'));
        else await h.playback.stop();
        await run;
        assert.equal(h.backend.calls.length, 1);
        assert.deepEqual(h.errors, failure ? ['unavailable'] : []);
        assert.equal(h.states.at(-1), false);
    }
});

test('clearing practice finishes the current utterance and cancels future repeats or a pending gap', async () => {
    for (const inGap of [false, true]) {
        const h = coordinator();
        const run = h.playback.speak('practice', {}, undefined, { count: 2, gapMs: 10000 });
        await tick();
        if (inGap) { h.backend.calls[0].finish(); await tick(); }
        h.playback.finishPractice();
        assert.equal(h.backend.calls[0].stops, 0);
        h.backend.calls[0].finish(); await run;
        assert.equal(h.backend.calls.length, 1);
    }
});

test('invalid repeat counts and gaps fail before speech starts', async () => {
    const h = coordinator();
    for (const practice of [{ count: 1, gapMs: 0 }, { count: 6, gapMs: 0 }, { count: 2.5, gapMs: 0 },
        { count: 2, gapMs: -1 }, { count: 2, gapMs: 10001 }, { count: 2, gapMs: NaN }]) await h.playback.speak('hello', {}, undefined, practice);
    assert.equal(h.errors.length, 6);
    assert.equal(h.backend.calls.length, 0);
});

async function extensionSetup(t) {
    const h = fakeVscode(); const backend = fakeBackend();
    const extension = registerExtension(h.vscode, { subscriptions: [] }, backend);
    t.after(() => extension.dispose());
    const run = name => h.handlers.get(`pronounciation.${name}`)();
    h.vscode.window.activeTextEditor = fakeEditor('SQL'); h.settings.replacements = { SQL: 'sequel', sequel: 'wrong' };
    const first = run('pronounce'); await tick(); backend.calls[0].finish(); await first;
    return { ...h, backend, extension, run };
}

test('practice uses prepared replay text without an editor and shows accessible progress until stopped', async t => {
    const h = await extensionSetup(t); h.vscode.window.activeTextEditor = undefined;
    await h.run('practice'); assert.equal(h.backend.calls.length, 1);
    h.vscode.window.showQuickPick = async choices => choices[0]; h.settings.practiceGap = 10000;
    const run = h.run('practice'); await tick();
    assert.equal(h.backend.calls[1].text, 'sequel');
    assert.match(h.status.accessibilityInformation.label, /Repeat 1\/2/);
    h.backend.calls[1].finish(); await tick(); assert.match(h.status.text, /Practice gap/);
    await h.run('stop'); await run; assert.equal(h.backend.calls.length, 2);
    await h.run('clearReplay'); await h.run('practice'); assert.match(h.info.at(-1), /Pronounce some text first/);
});

test('stale practice pickers cannot revive audio after Stop, Clear Replay, a new read or deactivation', async t => {
    for (const action of ['stop', 'clearReplay', 'readInput', 'dispose']) {
        const h = await extensionSetup(t); const choice = deferred();
        h.vscode.window.showQuickPick = () => choice.promise;
        const run = h.run('practice');
        if (action === 'dispose') await h.extension.dispose(); else await h.run(action);
        choice.resolve({ count: 2 }); await run;
        assert.equal(h.backend.calls.length, 1);
    }
});
