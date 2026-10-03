const { test } = require('node:test');
const assert = require('node:assert/strict');
const { voiceCommand, parseVoices, discoverVoices } = require('../src/voices');
const { fakeChild } = require('./helpers');

test('native inventory commands are fixed scripts with no shell or voice input', () => {
    assert.deepEqual(voiceCommand('darwin'), { command: 'say', args: ['-v', '?'], input: '' });
    const windows = voiceCommand('win32');
    assert.equal(windows.command, 'powershell.exe');
    assert.match(windows.args.at(-1), /GetInstalledVoices/);
    assert.match(windows.args.at(-1), /Where-Object.*Enabled/);
    assert.match(windows.args.at(-1), /OutputEncoding/);
    assert.match(voiceCommand('linux').input, /\(voice.list\)/);
    assert.throws(() => voiceCommand('freebsd'), /not supported/);
});

test('macOS inventory preserves Unicode and multiword voice names, normalizes locales, and deduplicates', () => {
    const voices = parseVoices('darwin', 'Bad News  en_US # Hello\nAmélie fr_CA # Bonjour\nBad News en_US # Hello\nnoise\n');
    assert.deepEqual(voices, [{ name: 'Amélie', locale: 'fr-CA' }, { name: 'Bad News', locale: 'en-US' }]);
    assert.deepEqual(parseVoices('darwin', ''), []);
});

test('Windows JSON accepts empty inventories and ignores unusable records without executing content', () => {
    assert.deepEqual(parseVoices('win32', '\uFEFF[{"name":"A voice","locale":"vi-VN"},{"name":"B"},null,{"name":""},{"name":1},{"name":"bad\\nvoice"}]'),
        [{ name: 'A voice', locale: 'vi-VN' }, { name: 'B', locale: '' }]);
    assert.deepEqual(parseVoices('win32', '[]'), []);
    for (const input of ['not json', '{}', 'null']) assert.throws(() => parseVoices('win32', input), /unreadable voice list/);
});

test('Festival inventory only accepts marked symbols and constructs safe voice function names', () => {
    assert.deepEqual(parseVoices('linux', 'Festival startup\nPRONUNCIATION_VOICE\tkal_diphone\nPRONUNCIATION_VOICE\t(system unsafe)\nPRONUNCIATION_VOICE\tkal_diphone\n'),
        [{ name: 'voice_kal_diphone', locale: '' }]);
    assert.throws(() => parseVoices('freebsd', ''), /not supported/);
});

test('discovery bounds time/output, sends Festival script via UTF-8 stdin, and tolerates EPIPE', async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const voices = await discoverVoices({ platform: 'linux', signal: controller.signal,
        execFile(command, args, options, callback) {
            assert.equal(command, 'festival');
            assert.deepEqual(args, ['--pipe']);
            assert.equal(options.shell, false);
            assert.equal(options.timeout, 5000);
            assert.equal(options.maxBuffer, 1024 * 1024);
            assert.equal(options.signal, controller.signal);
            callback(null, 'PRONUNCIATION_VOICE\tkal_diphone\n');
            return child;
        }
    });
    child.stdin.emit('error', new Error('EPIPE'));
    assert.match(child.input, /voice.list/);
    assert.equal(child.encoding, 'utf8');
    assert.equal(voices[0].name, 'voice_kal_diphone');
});

test('discovery exposes missing-engine, timeout, malformed-output, and cancellation failures', async () => {
    for (const [platform, error, stdout, message] of [
        ['linux', { code: 'ENOENT' }, '', /Install Festival/],
        ['darwin', { code: 'ENOENT' }, '', /system speech/],
        ['win32', { killed: true }, '', /five seconds/],
        ['win32', null, 'invalid', /unreadable/],
        ['darwin', { name: 'AbortError' }, '', error => error.name === 'AbortError']
    ]) {
        await assert.rejects(discoverVoices({ platform, execFile: (_command, _args, _options, callback) => {
            callback(error, stdout); return fakeChild();
        } }), message);
    }
});

test('real macOS inventory lists at least one installed local voice', { skip: process.platform !== 'darwin' }, async () => {
    const voices = await discoverVoices();
    assert.ok(voices.length > 0);
    assert.ok(voices.every(voice => voice.name && voice.locale));
});
