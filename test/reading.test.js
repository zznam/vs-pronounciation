const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerExtension } = require('../src/extension');
const { fakeVscode, fakeBackend, documentEditor, deferred, tick } = require('./helpers');

function setup() {
    const h = fakeVscode();
    h.backend = fakeBackend();
    h.extension = registerExtension(h.vscode, { subscriptions: [] }, h.backend);
    h.run = name => h.handlers.get(`pronounciation.${name}`)();
    h.finish = async name => {
        const run = h.run(name);
        await tick();
        h.backend.calls.at(-1).finish();
        await run;
    };
    return h;
}

test('editor reading commands extract their explicit scope and share replay and Stop', async () => {
    const h = setup();
    await h.run('readLine');
    assert.match(h.info[0], /Open an editor/);
    const editor = documentEditor('Hello\nworld\n\nGoodbye', 1);
    editor.selections = [{ start: { line: 3, character: 0 }, end: { line: 3, character: 7 }, isEmpty: false }];
    h.vscode.window.activeTextEditor = editor;
    const scopes = [];
    h.vscode.workspace.getConfiguration = (section, scope) => { scopes.push(scope); return h.config; };
    for (const name of ['readLine', 'readParagraph', 'readDocument', 'readAllSelections']) await h.finish(name);
    assert.deepEqual(h.backend.calls.map(call => call.text), ['world', 'Hello\nworld', 'Hello\nworld\n\nGoodbye', 'Goodbye']);
    assert.ok(scopes.every(scope => scope === editor.document));
    const replay = h.run('repeat');
    await tick();
    assert.equal(h.backend.calls.at(-1).text, 'Goodbye');
    await h.run('stop');
    await replay;
    await h.run('clearReplay');
    await h.run('repeat');
    assert.match(h.info.at(-1), /Pronounce some text first/);
    await h.extension.dispose();
});

test('typed and clipboard text need no editor, share normalization, and retain no text on dismissal', async () => {
    const h = setup();
    await h.run('readInput');
    h.vscode.window.showInputBox = async () => 'SQL';
    h.settings.replacements = { SQL: 'sequel', sequel: 'wrong' };
    await h.finish('readInput');
    await h.finish('repeat');
    assert.deepEqual(h.backend.calls.map(call => call.text), ['sequel', 'sequel']);
    h.vscode.env.clipboard.readText = async () => 'Xin chào';
    await h.finish('readClipboard');
    assert.equal(h.backend.calls.at(-1).text, 'Xin chào');
    h.vscode.env.clipboard.readText = async () => '';
    await h.run('readClipboard');
    assert.match(h.info.at(-1), /Select some text/);
    h.vscode.env.clipboard.readText = async () => { throw new Error('unavailable'); };
    await h.run('readClipboard');
    assert.deepEqual(h.errors, ['Could not read clipboard: unavailable']);
    await h.extension.dispose();
});

test('configured input limits and empty transformed input do not overwrite replay', async () => {
    const h = setup();
    h.settings.maxTextLength = 5;
    h.vscode.window.showInputBox = async () => 'hello';
    await h.finish('readInput');
    h.vscode.window.showInputBox = async () => 'too long';
    await h.run('readInput');
    assert.match(h.info.at(-1), /up to 5/);
    h.settings.replacements = { x: '' };
    h.vscode.window.showInputBox = async () => 'x';
    await h.run('readInput');
    await h.finish('repeat');
    assert.equal(h.backend.calls.at(-1).text, 'hello');
    await h.extension.dispose();
});

test('input and clipboard results arriving after deactivation cannot start playback', async () => {
    const h = setup();
    const input = deferred(), clipboard = deferred();
    h.vscode.window.showInputBox = () => input.promise;
    h.vscode.env.clipboard.readText = () => clipboard.promise;
    const pending = [h.run('readInput'), h.run('readClipboard')];
    await h.extension.dispose();
    input.resolve('private');
    clipboard.reject(new Error('late error'));
    await Promise.all(pending);
    assert.equal(h.backend.calls.length, 0);
    assert.deepEqual(h.errors, []);
});

test('Stop and newer reads cancel pending input and clipboard requests', async () => {
    const h = setup();
    const clipboard = deferred(), input = deferred();
    h.vscode.env.clipboard.readText = () => clipboard.promise;
    const pendingClipboard = h.run('readClipboard');
    await h.run('stop');
    clipboard.resolve('stale');
    await pendingClipboard;
    assert.equal(h.backend.calls.length, 0);
    h.vscode.window.showInputBox = () => input.promise;
    const pendingInput = h.run('readInput');
    h.vscode.window.activeTextEditor = documentEditor('new text');
    await h.finish('readLine');
    input.resolve('old text');
    await pendingInput;
    assert.deepEqual(h.backend.calls.map(call => call.text), ['new text']);
    const staleError = deferred();
    h.vscode.env.clipboard.readText = () => staleError.promise;
    const pendingError = h.run('readClipboard');
    await h.finish('repeat');
    staleError.reject(new Error('obsolete'));
    await pendingError;
    assert.deepEqual(h.errors, []);
    await h.extension.dispose();
});
