const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTtsControls, TEST_TEXT, DISCLOSURE, required } = require('../src/tts-controls');
const { secretKey } = require('../src/tts-backend');
const { controlsEnvironment, profile } = require('./tts-helpers');
const { deferred, tick } = require('./helpers');

function setup(providers = { voices: async () => [{ id: 'marin', name: 'Marin', locale: 'en' }], models: async () => ['gpt-4o-mini-tts'] }) {
    const h = controlsEnvironment();
    const picks = [], inputs = [], inputOptions = [], previews = [];
    let invalidations = 0;
    h.vscode.window.showQuickPick = async choices => {
        const select = picks.shift();
        return typeof select === 'function' ? select(choices) : select;
    };
    h.vscode.window.showInputBox = async options => { inputOptions.push(options); return inputs.shift(); };
    const controls = createTtsControls(h.vscode, h.context, (...args) => previews.push(args), async () => { invalidations++; }, providers);
    const run = name => controls.commands[name]();
    return { ...h, picks, inputs, inputOptions, previews, controls, run, invalidations: () => invalidations };
}
const first = choices => choices[0];
const manual = choices => choices.at(-1);

test('guided OpenAI setup saves a complete profile and no credentials; cancelled setup never saves partial data', async () => {
    const h = setup();
    h.picks.push('Add connection', first, first, first);
    h.inputs.push('My OpenAI', '1');
    await h.run('manageTtsConnections');
    const saved = h.settings['tts.profiles'][0];
    assert.deepEqual({ ...saved, id: 'generated' }, profile({ id: 'generated', name: 'My OpenAI' }));
    assert.match(saved.id, /^[0-9a-f-]{36}$/);
    assert.equal(h.secretCalls.length, 0);
    assert.match(h.inputOptions[0].prompt, /incur charges/);
    assert.equal(h.inputOptions[1].validateInput('0'), 'Enter a number from 0.25 to 3.');
    assert.equal(h.inputOptions[1].validateInput('1'), undefined);
    assert.match(DISCLOSURE, /AI-generated/);
    for (const input of ['', '\n', '\0', undefined]) assert.ok(required(input));
    assert.equal(required(' key '), undefined);
    const cancelled = setup();
    await cancelled.run('manageTtsConnections');
    cancelled.picks.push('Add connection'); await cancelled.run('manageTtsConnections');
    cancelled.picks.push('Add connection', first); await cancelled.run('manageTtsConnections');
    cancelled.picks.push('Add connection', first); cancelled.inputs.push('Name'); await cancelled.run('manageTtsConnections');
    cancelled.picks.push('Add connection', first, first); cancelled.inputs.push('Name'); await cancelled.run('manageTtsConnections');
    cancelled.picks.push('Add connection', first, first, first); cancelled.inputs.push('Name'); await cancelled.run('manageTtsConnections');
    assert.deepEqual(cancelled.updates, []);
});

test('custom setup validates URLs and supports manually supplied model and voice IDs', async () => {
    const h = setup();
    h.picks.push('Add connection', manual, manual, manual);
    h.inputs.push('Local server', 'http://localhost:8000/v1/audio/speech', 'custom-model', 'custom-voice', '0.5');
    await h.run('manageTtsConnections');
    const saved = h.settings['tts.profiles'][0];
    assert.equal(saved.provider, 'custom'); assert.equal(saved.model, 'custom-model'); assert.equal(saved.voice, 'custom-voice'); assert.equal(saved.speed, 0.5);
    assert.match(h.inputOptions[1].validateInput('http://example.com/speech'), /HTTPS/);
    assert.equal(h.inputOptions[1].validateInput('http://localhost/speech'), undefined);
    const cancel = setup(); cancel.picks.push('Add connection', manual); cancel.inputs.push('Name');
    await cancel.run('manageTtsConnections'); assert.deepEqual(cancel.updates, []);
});

test('ElevenLabs setup supports discovery failure, manual IDs and conservative speed bounds', async () => {
    const h = setup({ models: async () => { throw new Error('secret'); }, voices: async () => { throw new Error('secret'); } });
    h.picks.push('Add connection', choices => choices[1], manual, manual);
    h.inputs.push('Eleven', 'eleven_multilingual_v2', 'voice-id', '1.2');
    await h.run('manageTtsConnections');
    assert.equal(h.settings['tts.profiles'][0].provider, 'elevenlabs');
    assert.equal(h.inputOptions.at(-1).validateInput('0.25'), 'Enter a number from 0.7 to 1.2.');
    assert.ok(h.info.every(message => !message.includes('secret')));
    assert.equal(h.info.length, 3);
});

test('editing commits only complete changes and endpoint edits discard the old credential', async () => {
    const h = setup(); const p = profile({ provider: 'custom', endpoint: 'https://old.example/speech' });
    h.settings['tts.profiles'] = [p]; h.keys.set(secretKey(p.id), 'old-key');
    h.picks.push('Edit connection', first, manual, manual);
    h.inputs.push('Edited', 'https://new.example/speech', 'model', 'voice', '1');
    await h.run('manageTtsConnections');
    assert.equal(h.settings['tts.profiles'][0].endpoint, 'https://new.example/speech');
    assert.equal(h.keys.has(secretKey(p.id)), false);
    assert.deepEqual(h.secretCalls, [['delete', secretKey(p.id)]]);
    const edit = setup(); edit.settings['tts.profiles'] = [profile()]; edit.picks.push('Edit connection', first);
    await edit.run('manageTtsConnections'); assert.deepEqual(edit.updates, []);
});

test('selection, removal and missing active IDs preserve local settings and manage secrets separately', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p]; h.settings.voice = 'Alex';
    h.picks.push(choices => choices[1]); await h.run('chooseTtsConnection');
    assert.deepEqual(h.controls.active(), p); assert.equal(h.settings.voice, 'Alex');
    h.picks.push(first); await h.run('chooseTtsConnection'); assert.equal(h.controls.active(), undefined);
    h.settings['tts.activeProfile'] = p.id; h.picks.push('Remove connection', first);
    await h.run('manageTtsConnections'); assert.deepEqual(h.settings['tts.profiles'], []); assert.equal(h.settings['tts.activeProfile'], 'local');
    assert.deepEqual(h.secretCalls, [['delete', secretKey(p.id)]]);
    h.settings['tts.activeProfile'] = 'missing'; assert.throws(() => h.controls.active(), /missing/);
    h.settings['tts.profiles'] = [p, p]; h.settings['tts.activeProfile'] = p.id; assert.throws(() => h.controls.active(), /duplicated/);
    for (const invalid of [{}, [null], [{ id: 1, name: 'test' }], [{ id: 'test', name: 1 }]]) {
        h.settings['tts.profiles'] = invalid;
        assert.throws(() => h.controls.active(), /list of named/);
    }
});

test('API key commands use masked input and encrypted storage; cancellations do not update credentials', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p];
    await h.run('setApiKey'); await h.run('removeApiKey');
    h.picks.push(first); await h.run('setApiKey'); assert.deepEqual(h.secretCalls, []);
    h.picks.push(first); h.inputs.push('  private-key  '); await h.run('setApiKey');
    assert.equal(h.inputOptions[1].password, true);
    assert.equal(h.keys.get(secretKey(p.id)), 'private-key'); assert.deepEqual(h.updates, []);
    h.picks.push(first); await h.run('removeApiKey'); assert.equal(h.keys.size, 0); assert.equal(h.invalidations(), 2);
});

test('test connection uses fixed preview text and selected profile or local preferences without saving', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p]; h.settings.voice = 'Alex'; h.settings.speed = 0.5;
    await h.run('testTtsConnection');
    h.picks.push(first); await h.run('testTtsConnection');
    h.picks.push(choices => choices[1]); await h.run('testTtsConnection');
    assert.deepEqual(h.previews, [[TEST_TEXT, { voice: 'Alex', speed: 0.5 }], [TEST_TEXT, { profile: p }]]);
    assert.deepEqual(h.updates, []);
});

test('preference writes target only the active unchanged profile, preserving local values and stale edits', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p]; h.settings['tts.activeProfile'] = p.id;
    await h.controls.savePreference(p, 'speed', 0.5);
    assert.equal(h.settings['tts.profiles'][0].speed, 0.5); assert.equal(h.settings.speed, undefined);
    await h.controls.savePreference(p, 'speed', 2); assert.equal(h.updates.length, 1);
    await h.controls.savePreference(undefined, 'speed', 2); assert.equal(h.updates.length, 1);
    h.settings['tts.activeProfile'] = 'local'; await h.controls.savePreference(p, 'speed', 2); assert.equal(h.updates.length, 1);
    await h.controls.savePreference(undefined, 'speed', 0.75); assert.equal(h.settings.speed, 0.75);
    h.controls.dispose(); await h.controls.savePreference(undefined, 'speed', 1); assert.equal(h.settings.speed, 0.75);
});

test('cancelled/manual voice and model picks and failed writes leave settings intact', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p];
    assert.equal(await h.controls.voice(p), undefined);
    h.picks.push(manual); assert.equal(await h.controls.voice(p), undefined);
    h.picks.push('Edit connection', first, manual); h.inputs.push('Name'); await h.run('manageTtsConnections');
    h.picks.push('Remove connection'); await h.run('manageTtsConnections');
    h.picks.push(first); h.config.update = async () => { throw new Error('read only'); }; await h.run('chooseTtsConnection');
    assert.match(h.errors[0], /read only/); assert.equal(h.updates.length, 0);
});

test('deactivation aborts discovery and discards late picks, keys and tests', async () => {
    const response = deferred(); let signal;
    const h = setup({ voices: async (p, key, inputSignal) => { signal = inputSignal; return response.promise; }, models: async () => [] });
    const pick = h.controls.voice(profile()); await tick(); h.controls.dispose(); assert.ok(signal.aborted);
    response.reject(new Error('late')); await pick; await h.run('setApiKey'); assert.deepEqual(h.errors, []); assert.deepEqual(h.info, []);
    for (const command of ['chooseTtsConnection', 'setApiKey', 'removeApiKey', 'testTtsConnection', 'manageTtsConnections']) {
        const late = setup(); late.settings['tts.profiles'] = [profile()]; const selected = deferred();
        late.vscode.window.showQuickPick = () => selected.promise;
        const run = late.run(command); late.controls.dispose(); selected.resolve({ profile: profile() }); await run;
        assert.deepEqual(late.updates, []); assert.deepEqual(late.secretCalls, []); assert.deepEqual(late.previews, []);
    }
});

test('connection or credential editors cannot overwrite concurrent edits or deletion', async () => {
    const h = setup(); const p = profile(); h.settings['tts.profiles'] = [p]; h.picks.push('Edit connection', first, first, first); h.inputs.push('Edited');
    h.vscode.window.showInputBox = async options => {
        if (options.title === 'TTS connection speed') { h.settings['tts.profiles'] = []; return '1'; }
        return h.inputs.shift();
    };
    await h.run('manageTtsConnections'); assert.deepEqual(h.updates, []);
    const keys = setup(); keys.settings['tts.profiles'] = [p]; keys.picks.push(first);
    keys.vscode.window.showInputBox = async () => { keys.settings['tts.profiles'] = []; return 'key'; };
    await keys.run('setApiKey'); assert.deepEqual(keys.secretCalls, []);
});
