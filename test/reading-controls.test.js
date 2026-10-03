const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerExtension } = require('../src/extension');
const { fakeVscode, fakeBackend, fakeEditor, documentEditor, tick, deferred } = require('./helpers');

function setup(t) {
    const h = fakeVscode();
    h.vscode.env.language = 'en';
    h.backend = fakeBackend();
    h.extension = registerExtension(h.vscode, { subscriptions: [] }, h.backend, async () => []);
    h.session = h.extension.session;
    h.run = name => h.handlers.get(`pronounciation.${name}`)();
    h.load = async (text = 'First sentence. Second sentence.') => {
        h.vscode.window.showInputBox = async () => text;
        await h.run('startInputSession');
    };
    t.after(() => h.extension.dispose());
    return h;
}

function editor(text, line = 0) {
    const value = documentEditor(text, line);
    value.selection.isEmpty = true;
    value.document.uri = 'file:///source.txt'; value.document.version = 9;
    return value;
}

test('session commands load editor scopes silently and respect resource preparation and locale', async t => {
    const h = setup(t);
    await h.run('startSession'); assert.match(h.info.at(-1), /Open an editor/);
    const document = editor('Not this paragraph.\n\nSQL works. Another sentence.', 2);
    h.vscode.window.activeTextEditor = document;
    const scopes = [];
    h.vscode.workspace.getConfiguration = (section, scope) => { scopes.push(scope); return h.config; };
    h.settings.replacements = { SQL: 'sequel' };
    h.settings['reading.locale'] = 'vi';
    await h.run('startSession');
    assert.equal(h.backend.calls.length, 0);
    assert.equal(h.session.state.passage.original, 'SQL works. Another sentence.');
    assert.equal(h.session.state.passage.source.offset, 21);
    assert.equal(h.session.state.passage.locale, 'vi');
    assert.ok(scopes.every(scope => scope === document.document.uri));
    const play = h.run('playSession'); await tick();
    assert.equal(h.backend.calls[0].text, 'sequel works.');
    assert.match(h.status.text, /Sentence 1\/2/);
    assert.equal(h.status.command, 'pronounciation.stop');
    await h.run('stop'); await play;
    document.selection = { isEmpty: false, start: { line: 2, character: 11 }, end: { line: 2, character: 28 } };
    await h.run('startSession'); assert.equal(h.session.state.passage.original, 'Another sentence.');
    await h.run('startDocumentSession');
    assert.equal(h.session.state.passage.original, 'Not this paragraph.\n\nSQL works. Another sentence.');
    assert.equal(h.session.state.passage.source.offset, 0);
});

test('invalid input preserves a loaded session, and selecting a mode or sentence does not change settings', async t => {
    const h = setup(t);
    await h.load(); const previous = h.session.state.passage;
    await h.load(' '); assert.equal(h.session.state.passage, previous);
    assert.match(h.errors.at(-1), /nonempty paragraph/);
    h.settings['reading.mode'] = 'invalid';
    await h.load('New text.'); assert.equal(h.session.state.passage, previous);
    assert.match(h.errors.at(-1), /Reading mode/);
    await h.run('chooseSentence'); await h.run('setReadingMode');
    h.vscode.window.showQuickPick = async choices => choices[1];
    await h.run('chooseSentence'); assert.equal(h.session.state.index, 1);
    await h.run('setReadingMode'); assert.equal(h.session.state.mode, 'continuous');
    assert.deepEqual(h.updates, []); assert.equal(h.backend.calls.length, 0);
    await h.run('clearSession'); assert.equal(h.session.state.passage, undefined);
    for (const command of ['playSession', 'previousSentence', 'nextSentence', 'chooseSentence', 'setReadingMode']) await h.run(command);
    assert.match(h.info.at(-1), /Start a reading session first/);
});

test('navigation commands share Stop, preserve snapshots, and do not replace ordinary replay', async t => {
    const h = setup(t);
    h.vscode.window.activeTextEditor = fakeEditor('ordinary replay');
    const ordinary = h.run('pronounce'); await tick(); h.backend.calls[0].finish(); await ordinary;
    await h.load();
    const next = h.run('nextSentence'); await tick();
    assert.equal(h.backend.calls[1].text, 'Second sentence.');
    const previous = h.run('previousSentence'); await tick();
    assert.equal(h.backend.calls[2].text, 'First sentence.');
    await h.run('stop'); await Promise.all([next, previous]);
    const replay = h.run('repeat'); await tick();
    assert.equal(h.backend.calls[3].text, 'ordinary replay');
    await h.run('stop'); await replay;
    assert.equal(h.session.state.passage.original, 'First sentence. Second sentence.');
    await h.run('clearSession');
    assert.ok(h.contexts.some(entry => entry[1] === 'pronounciation.sessionLoaded' && entry[2] === false));
});

test('ordinary reading and voice preview replace a continuous session without advancing it', async t => {
    const h = setup(t);
    h.settings['reading.mode'] = 'continuous'; await h.load();
    const first = h.run('playSession'); await tick();
    h.vscode.window.activeTextEditor = editor('ordinary');
    const ordinary = h.run('readLine'); await tick();
    assert.equal(h.session.state.phase, 'stopped');
    h.backend.calls[1].finish(); await Promise.all([first, ordinary]);
    assert.deepEqual(h.backend.calls.map(call => call.text), ['First sentence.', 'ordinary']);
    const second = h.run('playSession'); await tick();
    h.vscode.window.showQuickPick = async choices => choices[0];
    const preview = h.run('previewVoice'); await tick();
    assert.match(h.backend.calls[3].text, /preview/);
    await h.run('stop'); await Promise.all([second, preview]);
    assert.equal(h.backend.calls.length, 4);
});

test('clipboard loading is explicit and supports no editor, cancellation, and current errors', async t => {
    const h = setup(t);
    let reads = 0;
    h.vscode.env.clipboard.readText = async () => { reads++; return '你好。再见。'; };
    assert.equal(reads, 0); await h.run('startClipboardSession');
    assert.equal(reads, 1); assert.equal(h.session.state.passage.sentences.length, 2);
    assert.equal(h.session.state.passage.source, undefined);
    h.vscode.env.clipboard.readText = async () => { throw new Error('clipboard unavailable'); };
    await h.run('startClipboardSession'); assert.match(h.errors.at(-1), /clipboard unavailable/);
    h.vscode.window.showInputBox = async () => undefined;
    await h.run('startInputSession'); assert.equal(h.session.state.passage.sentences.length, 2);
});

test('late input and clipboard results cannot replace a session after Stop or a newer request', async t => {
    const h = setup(t); await h.load(); const initial = h.session.state.passage;
    const input = deferred(); h.vscode.window.showInputBox = () => input.promise;
    const pending = h.run('startInputSession'); await h.run('stop');
    input.resolve('Late passage'); await pending; assert.equal(h.session.state.passage, initial);
    const clipboard = deferred(); h.vscode.env.clipboard.readText = () => clipboard.promise;
    const pendingClipboard = h.run('startClipboardSession'); await h.load('New passage');
    clipboard.resolve('Stale'); await pendingClipboard; assert.equal(h.session.state.passage.original, 'New passage');
    const lateError = deferred(); h.vscode.env.clipboard.readText = () => lateError.promise;
    const failedClipboard = h.run('startClipboardSession'); await h.run('clearSession');
    lateError.reject(new Error('stale failure')); await failedClipboard; assert.deepEqual(h.errors, []);
});

test('stale sentence and mode pickers cannot affect a replaced session or play after deactivation', async t => {
    const h = setup(t); await h.load();
    const choice = deferred(); h.vscode.window.showQuickPick = () => choice.promise;
    const pending = h.run('chooseSentence'); await h.load('Replacement.');
    choice.resolve({ index: 1 }); await pending; assert.equal(h.session.state.index, 0);
    const mode = deferred(); h.vscode.window.showQuickPick = () => mode.promise;
    const pendingMode = h.run('setReadingMode'); await h.run('stop');
    mode.resolve({ mode: 'continuous' }); await pendingMode; assert.equal(h.session.state.mode, 'manual');
    const input = deferred(); h.vscode.window.showInputBox = () => input.promise;
    const pendingInput = h.run('startInputSession');
    await h.extension.dispose(); input.resolve('private'); await pendingInput;
    assert.equal(h.session.state.passage, undefined); assert.equal(h.backend.calls.length, 0);
});

test('Stop prevents queued navigation and clear removes memory without altering legacy replay text', async t => {
    const h = setup(t); await h.load();
    const first = h.run('playSession');
    const next = h.run('nextSentence');
    await h.run('stop'); await Promise.all([first, next]);
    assert.equal(h.backend.calls.length, 0);
    assert.equal(h.session.state.index, 1);
    await h.run('clearSession');
    assert.equal(h.session.state.passage, undefined);
    assert.equal(h.session.state.options, undefined);
    assert.equal(h.status.visible, false);
});
