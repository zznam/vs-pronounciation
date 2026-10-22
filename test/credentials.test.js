const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeApiKey, readApiKey } = require('../src/credentials');
const { profile } = require('./tts-helpers');

test('credentials stay bound to their provider and complete normalized endpoint through manual settings edits', async () => {
    const custom = profile({ provider: 'custom', endpoint: 'https://example.com:443/speech?account=1' });
    const secrets = { get: async () => encodeApiKey(custom, ' private-key ') };
    assert.equal(await readApiKey(secrets, { ...custom, endpoint: 'https://example.com/speech?account=1', voice: 'new', speed: 0.5 }), 'private-key');
    for (const changed of [profile(), { ...custom, endpoint: 'https://another.example/speech?account=1' },
        { ...custom, endpoint: 'https://example.com/other?account=1' }, { ...custom, endpoint: 'https://example.com/speech?account=2' }]) {
        await assert.rejects(readApiKey(secrets, changed), /Set API Key again/);
    }
    const openai = { get: async () => encodeApiKey(profile(), 'openai-key') };
    assert.equal(await readApiKey(openai, profile({ model: 'tts-1', voice: 'alloy' })), 'openai-key');
    await assert.rejects(readApiKey(openai, custom), /Set API Key again/);
    await assert.rejects(readApiKey(openai, profile({ provider: 'elevenlabs' })), /Set API Key again/);
});

test('absent keys remain optional; legacy, corrupt and unbound keys require explicit replacement without revealing them', async () => {
    assert.equal(await readApiKey({ get: async () => undefined }, profile()), '');
    for (const stored of ['legacy-private-key', 'null', '{}', '{"version":2}', '{"version":1,"key":1}', '{"version":1,"key":"secret","destination":"custom:wrong"}']) {
        await assert.rejects(readApiKey({ get: async () => stored }, profile()), error => /Set API Key again/.test(error.message) && !error.message.includes(stored));
    }
});
