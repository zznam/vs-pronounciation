const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAudioPlayer } = require('../src/audio-player');
const { fakeChild } = require('./helpers');

function setup(platform, overrides = {}) {
    const child = fakeChild();
    const calls = [];
    const player = createAudioPlayer({ platform, env: { PATH: platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin' },
        access: async () => {}, spawn: (...args) => { calls.push(args); return child; }, execFile: (cmd, args, options, callback) => callback(), ...overrides });
    return { child, calls, player };
}

test('native WAV players use fixed commands, shell-free arguments and Windows JSON paths', async () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
        const h = setup(platform);
        await h.player.ensureReady();
        const file = 'Xin chào " $(unsafe).wav';
        const run = h.player.play(file);
        assert.equal(h.calls[0][2].shell, false);
        assert.equal(h.calls[0][2].windowsHide, true);
        if (platform === 'win32') {
            assert.match(h.calls[0][0], /powershell.exe$/);
            assert.equal(JSON.parse(h.child.input), file);
            assert.ok(!h.calls[0][1].join(' ').includes(file));
        } else {
            assert.deepEqual(h.calls[0][1], [file]);
            assert.match(h.calls[0][0], platform === 'darwin' ? /afplay$/ : /paplay$/);
        }
        h.child.emit('close', 0, null); await run.done; await run.stop();
        assert.deepEqual(h.child.kills, []);
    }
});

test('preflight searches PATH, prefers paplay, falls back to aplay only when absent, and reports missing players', async () => {
    const h = setup('linux', { env: { PATH: '/missing:/usr/bin' }, access: async file => { if (file !== '/usr/bin/aplay') throw new Error('missing'); } });
    await h.player.ensureReady(); const run = h.player.play('test.wav');
    assert.equal(h.calls[0][0], '/usr/bin/aplay'); await run.stop();
    for (const platform of ['linux', 'darwin', 'freebsd']) {
        const missing = setup(platform, { env: {}, access: async () => { throw new Error('missing'); } });
        await assert.rejects(missing.player.ensureReady(), platform === 'linux' ? /paplay or aplay/ : /unavailable/);
        assert.throws(() => missing.player.play('test.wav'), /availability/);
    }
    await assert.rejects(setup('win32', { execFile: (cmd, args, opts, callback) => callback(new Error('no System.Media')) }).player.ensureReady(), /Windows WAV/);
});

test('player failures are visible and cancellation kills only its child once', async () => {
    for (const type of ['start', 'exit', 'signal', 'stdin', 'stop']) {
        const h = setup('darwin'); await h.player.ensureReady(); const run = h.player.play('test.wav');
        if (type === 'stop') {
            await Promise.all([run.stop(), run.stop()]);
            assert.deepEqual(h.child.kills, ['SIGKILL']);
        } else {
            const failure = assert.rejects(run.done, /WAV/);
            if (type === 'start') h.child.emit('error', new Error('private path'));
            if (type === 'stdin') h.child.stdin.emit('error', new Error('EPIPE'));
            h.child.emit('close', type === 'exit' ? 1 : 0, type === 'signal' ? 'SIGTERM' : null);
            await failure;
        }
    }
});

test('failed player cancellation can be retried and exit races are harmless', async () => {
    const h = setup('darwin'); await h.player.ensureReady(); const run = h.player.play('test.wav');
    h.child.kill = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
    await assert.rejects(run.stop(), /denied/);
    h.child.kill = () => { setImmediate(() => h.child.emit('close', 0, null)); throw Object.assign(new Error('gone'), { code: 'ESRCH' }); };
    await run.stop();
});
