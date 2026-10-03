const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProviders, validateProfile, validateWav, splitPassage, speedRange } = require('../src/tts-providers');
const { profile, wav } = require('./tts-helpers');

test('provider requests use the appropriate endpoint, auth header, voice, model, speed and WAV format', async () => {
    const calls = [];
    const provider = createProviders({ audioRequest: async (...args) => { calls.push(args); return wav(); } });
    const signal = new AbortController().signal;
    await provider.synthesize(profile(), 'Xin chào 😀', 'secret', signal);
    assert.equal(calls[0][0], 'https://api.openai.com/v1/audio/speech');
    assert.deepEqual(calls[0][1], { key: 'secret', header: 'Authorization', signal, body: { input: 'Xin chào 😀', model: 'gpt-4o-mini-tts', voice: 'marin', speed: 1, response_format: 'wav' } });
    await provider.synthesize(profile({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: 'voice/id', speed: 0.7 }), 'hello', 'key');
    assert.equal(calls[1][0], 'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=wav_24000');
    assert.equal(calls[1][1].header, 'xi-api-key');
    assert.deepEqual(calls[1][1].body, { text: 'hello', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 0.7 } });
    await provider.synthesize(profile({ provider: 'custom', endpoint: 'http://localhost:8000/v1/audio/speech' }), 'test', '');
    assert.equal(calls[2][0], 'http://localhost:8000/v1/audio/speech');
    await assert.rejects(provider.synthesize(profile(), 'test', ''), /needs an API key/);
});

test('invalid connections and incompatible audio fail without executing or accepting text responses', async () => {
    for (const invalid of [null, {}, profile({ id: 'local' }), profile({ provider: 'unknown' }), profile({ name: '\n' }), profile({ voice: 1 }), profile({ speed: NaN }), profile({ speed: 3.1 }), profile({ provider: 'elevenlabs', speed: 0.25 }), profile({ provider: 'custom', endpoint: 'http://example.com/speech' })]) {
        assert.throws(() => validateProfile(invalid));
    }
    assert.deepEqual(speedRange('elevenlabs'), [0.7, 1.2]);
    assert.deepEqual(speedRange('openai'), [0.25, 3]);
    assert.throws(() => validateWav(Buffer.from('{}')), /WAV/);
    assert.throws(() => validateWav(Buffer.alloc(100)), /WAV/);
    const invalid = Buffer.alloc(44); invalid.write('RIFF'); invalid.write('WAVE', 8);
    assert.throws(() => validateWav(invalid), /invalid/);
    const compressed = wav(); compressed.writeUInt16LE(3, 20); assert.throws(() => validateWav(compressed), /unsupported/);
    const truncated = wav(); truncated.writeUInt32LE(5000, 40); assert.throws(() => validateWav(truncated), /invalid/);
    const malformed = wav(); malformed.writeUInt32LE(5000, 16); assert.throws(() => validateWav(malformed), /invalid/);
    const streaming = wav(); streaming.writeUInt32LE(0xffffffff, 4); streaming.writeUInt32LE(0xffffffff, 40);
    assert.deepEqual(validateWav(streaming), wav());
    await assert.rejects(createProviders({ audioRequest: async () => Buffer.from('error') }).synthesize(profile(), 'test', 'key'), /WAV/);
});

test('chunking preserves all text, sentences, whitespace and Unicode boundaries within the limit', () => {
    for (const text of ['', 'short', 'x'.repeat(50000), 'Hello world. '.repeat(500), '中文。日本語！ '.repeat(500), 'x'.repeat(1999) + '😀' + 'y'.repeat(2001), ' word'.repeat(1000), 'x'.repeat(1999) + '\nnext', 'a'.repeat(1999) + 'a\u0301' + '👩‍👩‍👧‍👦'.repeat(200)]) {
        const chunks = splitPassage(text);
        assert.equal(chunks.join(''), text);
        assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 2000));
        assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
    }
    assert.equal(splitPassage('Hello. ' + 'x'.repeat(2000))[0], 'Hello. ');
    assert.throws(() => splitPassage('a' + '\u0301'.repeat(2001)), /character sequence/);
});

test('OpenAI inventories are model-specific, while custom APIs use manual IDs', async () => {
    const providers = createProviders();
    assert.ok((await providers.voices(profile())).some(v => v.id === 'marin'));
    assert.ok(!(await providers.voices(profile({ model: 'tts-1' }))).some(v => v.id === 'marin'));
    assert.deepEqual(await providers.voices(profile({ provider: 'custom' })), []);
    assert.ok((await providers.models('openai')).includes('tts-1'));
    assert.deepEqual(await providers.models('custom'), []);
});

test('ElevenLabs inventories paginate voices and filter models without exposing provider payloads', async () => {
    const calls = [];
    const provider = createProviders({ jsonRequest: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/models')) return [{ model_id: 'tts', can_do_text_to_speech: true }, { model_id: 'stt', can_do_text_to_speech: false }, {}];
        return calls.length === 1 ? { voices: [{ voice_id: 'v1', name: 'First', labels: { language: 'vi' } }, {}], has_more: true, next_page_token: 'next token' }
            : { voices: [{ voice_id: 'v2', name: 'Second' }], has_more: false };
    } });
    assert.deepEqual(await provider.voices(profile({ provider: 'elevenlabs' }), 'key'), [{ id: 'v1', name: 'First', locale: 'vi' }, { id: 'v2', name: 'Second', locale: '' }]);
    assert.match(calls[1].url, /next_page_token=next%20token/);
    assert.equal(calls[0].options.header, 'xi-api-key');
    assert.deepEqual(await provider.models('elevenlabs', 'key'), ['tts']);
    await assert.rejects(createProviders({ jsonRequest: async () => ({}) }).voices(profile({ provider: 'elevenlabs' })), /unreadable voice/);
    await assert.rejects(createProviders({ jsonRequest: async () => ({}) }).models('elevenlabs'), /unreadable model/);
    await assert.rejects(createProviders({ jsonRequest: async () => ({ voices: [], has_more: true, next_page_token: 'same' }) }).voices(profile({ provider: 'elevenlabs' })), /pagination/);
});
