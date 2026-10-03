const { fakeVscode } = require('./helpers');
const { setTimeout } = require('node:timers/promises');

function wav(seconds = 0.01) {
    const size = Math.round(24000 * seconds) * 2;
    const audio = Buffer.alloc(44 + size);
    audio.write('RIFF'); audio.writeUInt32LE(36 + size, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28);
    audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(size, 40);
    return audio;
}

function profile(overrides = {}) { return { id: 'test-connection', name: 'Test cloud', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'marin', speed: 1, ...overrides }; }

function controlsEnvironment() {
    const h = fakeVscode();
    const keys = new Map();
    const secretCalls = [];
    const context = { subscriptions: [], secrets: {
        async get(id) { return keys.get(id); },
        async store(id, value) { keys.set(id, value); secretCalls.push(['store', id]); },
        async delete(id) { keys.delete(id); secretCalls.push(['delete', id]); }
    } };
    return { ...h, context, keys, secretCalls };
}

async function until(predicate) {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await setTimeout(1);
    }
    throw new Error('Timed out waiting for the test boundary.');
}

module.exports = { wav, profile, controlsEnvironment, until };
