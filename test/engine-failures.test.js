const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSpeechBackend } = require('../src/speech-backend');
const { registerExtension } = require('../src/extension');
const { fakeChild, fakeVscode, fakeBackend, fakeEditor, deferred, tick } = require('./helpers');

test('Festival stdout errors split across chunks survive later noisy output', async () => {
    for (const marker of ['SIOD ERROR: malformed expression', 'SIOD: unknown voice kal_diphone']) {
        const child = fakeChild();
        let stdio;
        const backend = createSpeechBackend({ platform: 'linux', spawn: (_command, _args, options) => { stdio = options.stdio; return child; } });
        const speech = backend.speak('hello');
        const failed = assert.rejects(speech.done, /could not speak/);
        assert.deepEqual(stdio, ['pipe', 'pipe', 'pipe']);
        child.stdout.emit('data', marker.slice(0, 4));
        child.stdout.emit('data', marker.slice(4));
        child.stdout.emit('data', 'noise'.repeat(5000));
        child.emit('close', 0, null);
        await failed;
    }
});

test('normal Festival stdout is drained and stderr does not combine with stdout into a false error', async () => {
    const child = fakeChild();
    const speech = createSpeechBackend({ platform: 'linux', spawn: () => child }).speak('hello');
    child.stdout.emit('data', 'SIOD ');
    child.stderr.emit('data', 'ERROR: unrelated log without SIOD prefix');
    child.stdout.emit('data', 'normal voice output');
    child.emit('close', 0, null);
    await speech.done;
});

test('signal termination is reported even if an adapter also supplies exit code zero', async () => {
    const child = fakeChild();
    const speech = createSpeechBackend({ spawn: () => child }).speak('hello');
    const failed = assert.rejects(speech.done, /signal SIGTERM/);
    child.emit('close', 0, 'SIGTERM');
    await failed;
});

function setup(notification) {
    const h = fakeVscode();
    h.backend = fakeBackend();
    h.vscode.window.showErrorMessage = notification;
    h.extension = registerExtension(h.vscode, { subscriptions: [] }, h.backend);
    h.vscode.window.activeTextEditor = fakeEditor('hello');
    h.fail = async () => {
        const run = h.handlers.get('pronounciation.pronounce')();
        await tick();
        h.backend.calls.at(-1).fail(new Error('voice missing'));
        await run;
        await tick();
    };
    return h;
}

test('speech error recovery opens filtered settings only when requested', async () => {
    let options;
    const h = setup(async (...args) => { options = args; return 'Open Settings'; });
    await h.fail();
    assert.deepEqual(options, ['Pronunciation: voice missing', 'Open Settings']);
    assert.ok(h.contexts.some(args => args[0] === 'workbench.action.openSettings' && args[1] === 'pronounciation'));
    await h.extension.dispose();
    const dismissed = setup(async () => undefined);
    await dismissed.fail();
    assert.ok(!dismissed.contexts.some(args => args[0] === 'workbench.action.openSettings'));
    await dismissed.extension.dispose();
});

test('late recovery choices and notification failures are safe after deactivation', async () => {
    const answer = deferred();
    const h = setup(() => answer.promise);
    await h.fail();
    await h.extension.dispose();
    answer.resolve('Open Settings');
    await tick();
    assert.ok(!h.contexts.some(args => args[0] === 'workbench.action.openSettings'));
    const failure = setup(async () => { throw new Error('notification closed'); });
    await failure.fail();
    await failure.extension.dispose();
});
