const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerExtension } = require('../src/extension');
const { fakeBackend, fakeEditor, deferred, tick } = require('./helpers');
const { controlsEnvironment, profile, wav, until } = require('./tts-helpers');

async function setup(t) {
    const h = controlsEnvironment();
    h.settings['tts.profiles'] = [profile()]; h.settings['tts.activeProfile'] = 'test-connection';
    const local = fakeBackend(); const syntheses = [], plays = [];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-extension-test-'));
    const providers = { async synthesize(...args) { syntheses.push(args); return wav(); }, voices: async () => [{ id: 'cedar', name: 'Cedar' }], models: async () => ['gpt-4o-mini-tts'] };
    const player = { async ensureReady() {}, play(file) { plays.push(file); return { done: Promise.resolve(), async stop() {} }; } };
    const extension = registerExtension(h.vscode, h.context, local, async () => [], { providers, player, tempRoot: root });
    t.after(async () => { await extension.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return { ...h, local, providers, player, extension, syntheses, plays, root, run: name => h.handlers.get(`pronounciation.${name}`)() };
}

test('API reads show generating/playing and replay cached audio with unchanged profiles', async t => {
    const h = await setup(t); h.vscode.window.activeTextEditor = fakeEditor('Xin chào');
    const generated = deferred(); h.providers.synthesize = () => generated.promise;
    const run = h.run('pronounce'); await until(() => h.status.text.includes('Generating'));
    assert.equal(h.status.visible, true); assert.match(h.status.text, /Test cloud/);
    generated.resolve(wav()); await run; assert.match(h.status.text, /Playing/); assert.equal(h.status.visible, false);
    h.providers.synthesize = () => { throw new Error('Replay must use cache'); };
    await h.run('repeat'); assert.equal(h.plays.length, 2); assert.equal(h.local.calls.length, 0);
    await h.run('clearReplay'); assert.deepEqual(await fs.readdir(h.root), []);
});

test('cloud fallback reads only the failed remainder with local preferences, preserving connection and replay', async t => {
    const h = await setup(t); h.settings.voice = 'Alex'; h.settings.speed = 0.5;
    const text = 'x'.repeat(2000) + 'unplayed'; h.vscode.window.activeTextEditor = fakeEditor(text);
    let count = 0; h.providers.synthesize = async () => { if (++count === 2) throw new Error('quota'); return wav(); };
    h.vscode.window.showErrorMessage = async (message, ...actions) => { assert.match(message, /quota/); assert.deepEqual(actions, ['Read locally', 'Manage connections']); return 'Read locally'; };
    await h.run('pronounce'); await until(() => h.local.calls.length > 0);
    assert.equal(h.local.calls[0].text, 'unplayed'); assert.deepEqual(h.local.calls[0].options, { voice: 'Alex', speed: 0.5 });
    assert.equal(h.settings['tts.activeProfile'], 'test-connection'); h.local.calls[0].finish(); await tick();
    h.providers.synthesize = async (p, value) => { h.syntheses.push(value); return wav(); };
    await h.run('repeat'); assert.equal(h.syntheses.join(''), text);
});

test('Stop and new reads make delayed fallback actions harmless; errors can open connection management', async t => {
    const h = await setup(t); h.vscode.window.activeTextEditor = fakeEditor('old'); h.providers.synthesize = async () => { throw new Error('offline'); };
    const action = deferred(); h.vscode.window.showErrorMessage = () => action.promise;
    await h.run('pronounce'); await h.run('stop'); action.resolve('Read locally'); await tick(); assert.equal(h.local.calls.length, 0);
    const newer = deferred(); h.vscode.window.showErrorMessage = () => newer.promise;
    await h.run('pronounce'); h.vscode.window.activeTextEditor = fakeEditor(' '); await h.run('pronounce'); newer.resolve('Read locally'); await tick(); assert.equal(h.local.calls.length, 0);
    let managed = false; h.vscode.window.showErrorMessage = async () => 'Manage connections';
    h.vscode.window.showQuickPick = async () => { managed = true; };
    h.vscode.window.activeTextEditor = fakeEditor('old'); await h.run('pronounce'); await until(() => managed);
});

test('API voice and speed commands update profile preferences and previews do not save choices or replace replay', async t => {
    const h = await setup(t); h.vscode.window.activeTextEditor = fakeEditor('remember'); await h.run('pronounce');
    h.vscode.window.showQuickPick = async choices => choices.find(choice => choice.voice === 'cedar') || choices.find(choice => choice.speed === 0.5);
    await h.run('setVoice'); assert.equal(h.settings['tts.profiles'][0].voice, 'cedar');
    await h.run('setSpeed'); assert.equal(h.settings['tts.profiles'][0].speed, 0.5);
    await h.run('faster'); assert.equal(h.settings['tts.profiles'][0].speed, 0.75);
    await h.run('slower'); assert.equal(h.settings['tts.profiles'][0].speed, 0.5);
    await h.run('resetSpeed'); assert.equal(h.settings['tts.profiles'][0].speed, 1);
    h.vscode.window.showInputBox = async options => { assert.equal(options.validateInput('3.5'), 'Enter a number from 0.25 to 3.'); return '1.1'; };
    await h.run('setCustomSpeed'); assert.equal(h.settings['tts.profiles'][0].speed, 1.1);
    h.vscode.window.showQuickPick = async choices => choices[0];
    const previous = h.updates.length; await h.run('previewVoice'); assert.equal(h.updates.length, previous);
    await h.run('repeat'); assert.equal(h.syntheses.at(-1)[1], 'remember');
    assert.equal(h.settings.voice, undefined); assert.equal(h.settings.speed, undefined);
});

test('ElevenLabs controls clamp profile speed, and malformed active settings report guidance', async t => {
    const h = await setup(t); h.settings['tts.profiles'] = [profile({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: 'id', speed: 1.2 })];
    await h.run('faster'); assert.equal(h.settings['tts.profiles'][0].speed, 1.2);
    await h.run('slower'); await h.run('slower'); await h.run('slower'); assert.equal(h.settings['tts.profiles'][0].speed, 0.7);
    h.vscode.window.showQuickPick = async choices => { assert.ok(choices.every(item => item.speed >= 0.7 && item.speed <= 1.2)); return choices.at(-1); };
    await h.run('setSpeed'); assert.equal(h.settings['tts.profiles'][0].speed, 1.2);
    h.settings['tts.activeProfile'] = 'missing'; await h.run('setVoice'); assert.match(h.errors[0], /missing/);
});
