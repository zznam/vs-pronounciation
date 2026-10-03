const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const manifest = require('../package.json');
const { registerExtension, getText, MAX_TEXT_LENGTH } = require('../src/extension');
const { fakeBackend, fakeVscode, fakeEditor, deferred, tick } = require('./helpers');

function setup(discoverVoices) {
    const h = fakeVscode();
    h.backend = fakeBackend();
    h.context = { subscriptions: [] };
    h.extension = registerExtension(h.vscode, h.context, h.backend, discoverVoices);
    h.run = name => h.handlers.get(`pronounciation.${name}`)();
    return h;
}

test('selection takes precedence and preserves punctuation and Unicode', () => {
    assert.equal(getText(fakeEditor('  Xin chào!\nこんにちは  '), true), 'Xin chào!\nこんにちは');
    assert.equal(getText(fakeEditor('   '), true), '');
});

test('empty selection falls back to the cursor word only when enabled', () => {
    const editor = fakeEditor('', { empty: true, word: ' hello ' });
    assert.equal(getText(editor, true), 'hello');
    assert.equal(getText(editor, false), '');
    assert.equal(editor.reads.length, 1);
});

test('cursor over whitespace never reads the entire document', () => {
    const editor = fakeEditor('private document', { empty: true, word: null });
    assert.equal(getText(editor, true), '');
    assert.equal(editor.reads.length, 0);
});

test('manifest commands match registration and preserve existing keyboard shortcuts', async () => {
    const h = setup();
    assert.deepEqual([...h.handlers.keys()].sort(), manifest.contributes.commands.map(command => command.command).sort());
    for (const contribution of [...manifest.contributes.keybindings, ...manifest.contributes.menus['editor/context']]) {
        assert.ok(h.handlers.has(contribution.command), contribution.command);
    }
    assert.equal(manifest.contributes.keybindings.find(binding => binding.command === 'pronounciation.pronounce').mac, 'cmd+ctrl+p');
    assert.deepEqual(manifest.extensionKind, ['ui']);
    await h.extension.dispose();
    for (const disposable of h.context.subscriptions) await disposable.dispose();
    assert.equal(h.handlers.size, 0);
    assert.equal(h.status.disposed, 1);
});

test('missing editor, empty selection, disabled cursor fallback, and excessive text give guidance', async () => {
    const h = setup();
    await h.run('pronounce');
    h.vscode.window.activeTextEditor = fakeEditor('   ');
    await h.run('pronounce');
    h.vscode.window.activeTextEditor = fakeEditor('', { empty: true });
    h.settings.readWordAtCursor = false;
    await h.run('pronounce');
    h.vscode.window.activeTextEditor = fakeEditor('x'.repeat(MAX_TEXT_LENGTH + 1));
    await h.run('pronounce');
    assert.equal(h.info.length, 4);
    assert.match(h.info[0], /Open an editor/);
    assert.match(h.info[3], /50,000/);
    assert.equal(h.backend.calls.length, 0);
    await h.extension.dispose();
});

test('reads the cursor word with configured voice and speed, and updates the Stop control', async () => {
    const h = setup();
    h.settings.voice = 'Samantha';
    h.settings.speed = 0.75;
    h.vscode.window.activeTextEditor = fakeEditor('', { empty: true, word: 'hello' });
    const run = h.run('pronounce');
    await tick();
    assert.equal(h.backend.calls[0].text, 'hello');
    assert.deepEqual(h.backend.calls[0].options, { voice: 'Samantha', speed: 0.75 });
    assert.equal(h.status.visible, true);
    assert.equal(h.status.command, 'pronounciation.stop');
    assert.deepEqual(h.contexts.at(-1), ['setContext', 'pronounciation.speaking', true]);
    await h.run('stop');
    await run;
    assert.equal(h.status.visible, false);
    assert.deepEqual(h.contexts.at(-1), ['setContext', 'pronounciation.speaking', false]);
    await h.extension.dispose();
});

test('replay works without an editor and uses the latest voice and speed settings', async () => {
    const h = setup();
    await h.run('repeat');
    assert.match(h.info[0], /Pronounce some text first/);
    h.vscode.window.activeTextEditor = fakeEditor('original');
    const first = h.run('pronounce');
    await tick();
    h.backend.calls[0].finish();
    await first;
    h.vscode.window.activeTextEditor = undefined;
    h.settings.speed = 0.5;
    h.settings.voice = 'Alex';
    const replay = h.run('repeat');
    await tick();
    assert.equal(h.backend.calls[1].text, 'original');
    assert.deepEqual(h.backend.calls[1].options, { voice: 'Alex', speed: 0.5 });
    h.backend.calls[1].finish();
    await replay;
    await h.extension.dispose();
});

test('invalid selections do not replace the remembered text', async () => {
    const h = setup();
    h.vscode.window.activeTextEditor = fakeEditor('remember me');
    const first = h.run('pronounce');
    await tick();
    h.backend.calls[0].finish();
    await first;
    h.vscode.window.activeTextEditor = fakeEditor('   ');
    await h.run('pronounce');
    const replay = h.run('repeat');
    await tick();
    assert.equal(h.backend.calls[1].text, 'remember me');
    h.backend.calls[1].finish();
    await replay;
    await h.extension.dispose();
});

test('preview uses the playback coordinator and Stop without replacing replay text', async () => {
    const h = setup(async () => [{ name: 'Samantha', locale: 'en-US' }]);
    h.vscode.window.activeTextEditor = fakeEditor('remember me');
    const original = h.run('pronounce');
    await tick();
    h.vscode.window.showQuickPick = async choices => choices[1];
    const preview = h.run('previewVoice');
    await tick();
    assert.equal(h.backend.calls[0].stops, 1);
    assert.match(h.backend.calls[1].text, /preview/);
    assert.equal(h.backend.calls[1].options.voice, 'Samantha');
    await h.run('stop');
    await Promise.all([original, preview]);
    const replay = h.run('repeat');
    await tick();
    assert.equal(h.backend.calls[2].text, 'remember me');
    h.backend.calls[2].finish();
    await replay;
    await h.extension.dispose();
});

test('speed picker updates global preferences, while dismissal does nothing', async () => {
    const h = setup();
    await h.run('setSpeed');
    assert.deepEqual(h.updates, []);
    h.vscode.window.showQuickPick = async choices => choices.find(choice => choice.speed === 0.75);
    await h.run('setSpeed');
    assert.deepEqual(h.updates, [{ key: 'speed', value: 0.75, target: h.vscode.ConfigurationTarget.Global }]);
    await h.extension.dispose();
});

test('speed preference failures are visible and do not throw from the command', async () => {
    const h = setup();
    h.vscode.window.showQuickPick = async choices => choices[0];
    h.config.update = async () => { throw new Error('read only settings'); };
    await h.run('setSpeed');
    assert.match(h.errors[0], /Could not save pronunciation speed: read only settings/);
    await h.extension.dispose();
});

test('a picker resolving after deactivation does not update settings', async () => {
    const h = setup();
    const choice = deferred();
    h.vscode.window.showQuickPick = () => choice.promise;
    const run = h.run('setSpeed');
    await h.extension.dispose();
    choice.resolve({ speed: 2 });
    await run;
    assert.deepEqual(h.updates, []);
});

test('speech errors are visible and remove the Stop control', async () => {
    const h = setup();
    h.vscode.window.activeTextEditor = fakeEditor('hello');
    const run = h.run('pronounce');
    await tick();
    h.backend.calls[0].fail(new Error('engine missing'));
    await run;
    assert.deepEqual(h.errors, ['Pronunciation: engine missing']);
    assert.equal(h.status.visible, false);
    await h.extension.dispose();
});

test('deactivation stops speech, clears replay text, and disposes the status bar once', async () => {
    const h = setup();
    h.vscode.window.activeTextEditor = fakeEditor('hello');
    const run = h.run('pronounce');
    await tick();
    await h.extension.dispose();
    await h.extension.dispose();
    await run;
    await h.run('repeat');
    assert.equal(h.backend.calls[0].stops, 1);
    assert.equal(h.status.disposed, 1);
    assert.match(h.info[0], /Pronounce some text first/);
    assert.deepEqual(h.contexts.at(-1), ['setContext', 'pronounciation.speaking', false]);
});

test('public entry point activates and deactivates against the VS Code API', async t => {
    const h = fakeVscode();
    const originalLoad = Module._load;
    t.mock.method(Module, '_load', function(request, ...args) {
        return request === 'vscode' ? h.vscode : originalLoad.call(this, request, ...args);
    });
    const entry = require('../extension');
    assert.equal(entry.deactivate(), undefined);
    const context = { subscriptions: [] };
    entry.activate(context);
    assert.ok(h.handlers.has('pronounciation.pronounce'));
    await h.handlers.get('pronounciation.stop')();
    await entry.deactivate();
    for (const disposable of context.subscriptions) await disposable.dispose();
    assert.equal(h.status.disposed, 1);
});
