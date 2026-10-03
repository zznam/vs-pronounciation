const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceControls, validateSpeed, PREVIEW_TEXT } = require('../src/voice-controls');
const { fakeVscode, deferred } = require('./helpers');

function setup(discover = async () => [{ name: 'Samantha', locale: 'en-US' }]) {
    const h = fakeVscode();
    h.previews = [];
    h.controls = createVoiceControls(h.vscode, (text, options) => h.previews.push({ text, options }), discover);
    h.run = name => h.controls.commands[name]();
    return h;
}

test('voice picker shows native locales/current choice, and saves only explicit selection', async () => {
    const h = setup();
    h.settings.voice = 'Samantha';
    h.vscode.window.showQuickPick = async (choices, options) => {
        assert.equal(options.matchOnDescription, true);
        assert.match(choices[1].description, /en-US.*Current voice/);
        return choices[1];
    };
    await h.run('setVoice');
    assert.deepEqual(h.updates, [{ key: 'voice', value: 'Samantha', target: 1 }]);
    h.vscode.window.showQuickPick = async choices => choices[0];
    await h.run('setVoice');
    assert.equal(h.settings.voice, '');
    h.vscode.window.showQuickPick = async choices => { assert.match(choices[0].description, /Current/); };
    await h.run('setVoice');
    assert.equal(h.updates.length, 2);
});

test('empty voice inventories still offer system default, and Festival has an engine label', async () => {
    const h = setup(async () => []);
    h.vscode.window.showQuickPick = async (choices, options) => {
        assert.equal(choices.length, 1);
        assert.match(options.placeHolder, /No named voices/);
        return choices[0];
    };
    await h.run('setVoice');
    const festival = setup(async () => [{ name: 'voice_kal_diphone', locale: '' }]);
    festival.vscode.window.showQuickPick = async choices => { assert.equal(choices[1].description, 'Festival voice'); };
    await festival.run('setVoice');
});

test('voice preview uses the chosen voice/current speed without saving preferences', async () => {
    const h = setup();
    h.settings.speed = 0.75;
    h.vscode.window.showQuickPick = async choices => choices[1];
    await h.run('previewVoice');
    assert.deepEqual(h.previews, [{ text: PREVIEW_TEXT, options: { voice: 'Samantha', speed: 0.75 } }]);
    assert.deepEqual(h.updates, []);
    h.vscode.window.showQuickPick = async () => undefined;
    await h.run('previewVoice');
    assert.equal(h.previews.length, 1);
});

test('custom speed validates numeric range, preserves preferences on dismissal, and saves globally', async () => {
    for (const value of ['', ' ', 'NaN', 'Infinity', '0', '3.01', '-1', 'slow']) assert.match(validateSpeed(value), /0.25 to 3/);
    for (const value of ['0.25', '3', ' 1.15 ']) assert.equal(validateSpeed(value), undefined);
    const h = setup();
    h.vscode.window.showInputBox = async options => {
        assert.equal(options.value, '1');
        assert.equal(options.validateInput, validateSpeed);
        return '1.15';
    };
    await h.run('setCustomSpeed');
    assert.equal(h.settings.speed, 1.15);
    h.vscode.window.showInputBox = async () => undefined;
    await h.run('setCustomSpeed');
    h.vscode.window.showInputBox = async () => 'invalid';
    await h.run('setCustomSpeed');
    assert.equal(h.updates.length, 1);
});

test('speed presets mark active rate and step controls clamp and reset without float drift', async () => {
    const h = setup();
    h.vscode.window.showQuickPick = async choices => {
        assert.equal(choices[0].speed, 0.25);
        assert.equal(choices.at(-1).speed, 3);
        assert.match(choices.find(choice => choice.speed === 1).description, /Normal speed.*Current speed/);
        return choices[0];
    };
    await h.run('setSpeed');
    await h.run('slower');
    assert.equal(h.settings.speed, 0.25);
    await h.run('faster');
    assert.equal(h.settings.speed, 0.5);
    h.settings.speed = 2.9;
    await h.run('faster');
    assert.equal(h.settings.speed, 3);
    await h.run('resetSpeed');
    assert.equal(h.settings.speed, 1);
    h.settings.speed = 1.1;
    await h.run('slower');
    assert.equal(h.settings.speed, 0.85);
    delete h.settings.speed;
    await h.run('faster');
    assert.equal(h.settings.speed, 1.25);
    delete h.settings.speed;
    await h.run('slower');
    assert.equal(h.settings.speed, 0.75);
    await h.run('openSettings');
    assert.deepEqual(h.contexts.at(-1), ['workbench.action.openSettings', 'pronounciation']);
});

test('discovery and save failures are visible without throwing from commands', async () => {
    const h = setup(async () => { throw new Error('engine missing'); });
    await h.run('setVoice');
    assert.match(h.errors[0], /engine missing/);
    h.config.update = async () => { throw new Error('read only'); };
    await h.run('resetSpeed');
    assert.match(h.errors[1], /Could not save pronunciation speed: read only/);
});

test('deactivation aborts inventory requests and suppresses their late failure notifications', async () => {
    const request = deferred();
    let signal;
    const h = setup(options => { signal = options.signal; return request.promise; });
    const pending = h.run('setVoice');
    h.controls.dispose();
    assert.equal(signal.aborted, true);
    request.reject(new Error('cancelled'));
    await pending;
    await h.run('setVoice');
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.updates, []);
});

test('deactivation while listing or choosing a voice cannot save or preview stale results', async () => {
    const inventory = deferred();
    const h = setup(() => inventory.promise);
    const listing = h.run('setVoice');
    h.controls.dispose();
    inventory.resolve([]);
    await listing;
    const preview = setup();
    preview.vscode.window.showQuickPick = async choices => { preview.controls.dispose(); return choices[1]; };
    await preview.run('previewVoice');
    assert.deepEqual(preview.previews, []);
    const save = setup();
    save.vscode.window.showQuickPick = async choices => { save.controls.dispose(); return choices[1]; };
    await save.run('setVoice');
    assert.deepEqual(save.updates, []);
    const pendingSave = deferred();
    const late = setup();
    late.config.update = () => pendingSave.promise;
    const command = late.run('resetSpeed');
    late.controls.dispose();
    pendingSave.reject(new Error('late failure'));
    await command;
    assert.deepEqual(late.errors, []);
});
