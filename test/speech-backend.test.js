const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSpeechCommand, createSpeechBackend } = require('../src/speech-backend');
const { fakeChild, tick } = require('./helpers');

test('macOS sends long, Unicode, and option-like text over stdin', () => {
    const text = '-o /tmp/should-not-exist "Xin chào" $(echo unsafe)\n' + 'x'.repeat(50000);
    const command = buildSpeechCommand('darwin', text, { voice: 'Samantha', speed: 0.5 });
    assert.deepEqual(command, { command: 'say', args: ['-r', '88', '-v', 'Samantha'], input: text });
    assert.deepEqual(buildSpeechCommand('darwin', 'hello').args, ['-r', '175']);
});

test('Windows passes selected text and voice as JSON rather than executable script', () => {
    const text = "'); Write-Output PWNED; # Xin chào 😀";
    const voice = "voice'; Write-Output PWNED; #";
    const normal = buildSpeechCommand('win32', 'hello');
    const malicious = buildSpeechCommand('win32', text, { voice, speed: 0.5 });
    assert.deepEqual(normal.args, malicious.args);
    assert.equal(malicious.command, 'powershell.exe');
    assert.deepEqual(JSON.parse(malicious.input), { text, voice, rate: -6 });
    assert.equal(JSON.parse(normal.input).rate, 0);
    assert.equal(JSON.parse(buildSpeechCommand('win32', 'hi', { speed: 3 }).input).rate, 10);
});

test('Festival escapes Scheme string delimiters and preserves Unicode', () => {
    const command = buildSpeechCommand('linux', 'hello\\"); (system "unsafe") ; Xin chào\n\t\0', { voice: 'voice_kal_diphone', speed: 0.5 });
    assert.equal(command.command, 'festival');
    assert.deepEqual(command.args, ['--pipe']);
    assert.equal(command.input, '(voice_kal_diphone)\n(Parameter.set \'Duration_Stretch 2)\n' + String.raw`(SayText "hello\\\"); (system \"unsafe\") ; Xin chào   ")` + '\n');
    assert.equal(buildSpeechCommand('linux', 'hello').input, '(Parameter.set \'Duration_Stretch 1)\n(SayText "hello")\n');
});

test('Festival rejects executable voice expressions', () => {
    for (const voice of ['(system "unsafe")', 'voice_test) (quit', 'voice_test\n', 'Alex']) {
        assert.throws(() => buildSpeechCommand('linux', 'hello', { voice }), /Festival voice names/);
    }
});

test('invalid text, voice, speed, and unsupported platforms fail before spawning', () => {
    for (const text of ['', ' \n ', undefined, 42]) {
        assert.throws(() => buildSpeechCommand('darwin', text), /Select some text/);
    }
    for (const speed of [0, -1, 0.24, 3.01, NaN, Infinity, '1']) {
        assert.throws(() => buildSpeechCommand('darwin', 'hello', { speed }), /between 0.25 and 3/);
    }
    for (const voice of [null, 1, 'bad\0voice']) {
        assert.throws(() => buildSpeechCommand('darwin', 'hello', { voice }), /valid voice name/);
    }
    assert.throws(() => buildSpeechCommand('freebsd', 'hello'), /not supported/);
});

function setup(platform = 'darwin', overrides = {}) {
    const child = fakeChild();
    const spawned = [], killed = [];
    const backend = createSpeechBackend({
        platform,
        spawn: (...args) => { spawned.push(args); return child; },
        kill: (...args) => { killed.push(args); setImmediate(() => child.emit('close', null, 'SIGKILL')); },
        ...overrides
    });
    return { child, spawned, killed, backend };
}

test('spawns without a shell, writes UTF-8, and waits for process close', async () => {
    const h = setup();
    const playback = h.backend.speak('Xin chào');
    assert.equal(h.child.input, 'Xin chào');
    assert.equal(h.child.encoding, 'utf8');
    assert.deepEqual(h.spawned[0][2], { shell: false, windowsHide: true, detached: false, stdio: ['pipe', 'ignore', 'pipe'] });
    let finished = false;
    playback.done.then(() => { finished = true; });
    await tick();
    assert.equal(finished, false);
    h.child.emit('close', 0, null);
    await playback.done;
    await playback.stop();
    assert.deepEqual(h.child.kills, []);
});

test('missing engines produce setup instructions without an unhandled stdin error', async () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
        const h = setup(platform);
        const playback = h.backend.speak('hello');
        const rejected = assert.rejects(playback.done, platform === 'linux' ? /Install Festival/ : /available on this computer/);
        h.child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
        h.child.stdin.emit('error', new Error('EPIPE'));
        h.child.emit('close', -2, null);
        await rejected;
        await playback.stop();
    }
});

test('other process errors are caught', async () => {
    const h = setup();
    const playback = h.backend.speak('hello');
    const rejected = assert.rejects(playback.done, /could not start/);
    h.child.emit('error', new Error('permission denied'));
    h.child.emit('close', 1, null);
    await rejected;
});

test('nonzero exits, broken pipes, and Festival errors do not report success', async () => {
    for (const kind of ['exit', 'stdin', 'festival']) {
        const h = setup('linux');
        const playback = h.backend.speak('hello');
        const rejected = assert.rejects(playback.done, /could not speak/);
        if (kind === 'stdin') h.child.stdin.emit('error', new Error('EPIPE'));
        if (kind === 'festival') h.child.stderr.emit('data', 'x'.repeat(5000) + 'SIOD ERROR: unknown voice');
        h.child.emit('close', kind === 'exit' ? 1 : 0, null);
        await rejected;
    }
});

test('cancellation kills the owned child only once and waits for closure', async () => {
    const h = setup();
    const playback = h.backend.speak('hello');
    await Promise.all([playback.stop(), playback.stop(), playback.done]);
    assert.deepEqual(h.child.kills, ['SIGKILL']);
});

test('Linux cancellation kills the owned process group instead of guessing an adjacent PID', async () => {
    const h = setup('linux');
    const playback = h.backend.speak('hello');
    await playback.stop();
    assert.deepEqual(h.killed, [[-321, 'SIGKILL']]);
    assert.equal(h.spawned[0][2].detached, true);
    assert.deepEqual(h.child.kills, []);
});

test('a child without a PID is never used as a process-group target', async () => {
    const h = setup('linux');
    h.child.pid = undefined;
    const playback = h.backend.speak('hello');
    await playback.stop();
    assert.deepEqual(h.killed, []);
});

test('process-exit races during cancellation are harmless', async () => {
    const h = setup('linux', { kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); } });
    const playback = h.backend.speak('hello');
    const stop = playback.stop();
    h.child.emit('close', 0, null);
    await stop;
});

test('a failed cancellation can be retried', async () => {
    let attempts = 0;
    const h = setup('linux', { kill: () => {
        if (++attempts === 1) throw Object.assign(new Error('denied'), { code: 'EPERM' });
        setImmediate(() => h.child.emit('close', null, 'SIGKILL'));
    } });
    const playback = h.backend.speak('hello');
    await assert.rejects(playback.stop(), /denied/);
    await playback.stop();
    assert.equal(attempts, 2);
});
