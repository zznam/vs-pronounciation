const { requestApi, requestJson, validateEndpoint } = require('./api-client');

const OPENAI_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
const NEW_VOICES = [...VOICES, 'ballad', 'verse', 'marin', 'cedar'];

function speedRange(provider) { return provider === 'elevenlabs' ? [0.7, 1.2] : [0.25, 3]; }

function validateProfile(profile) {
    if (!profile || !['openai', 'elevenlabs', 'custom'].includes(profile.provider) ||
        !['id', 'name', 'model', 'voice'].every(key => typeof profile[key] === 'string' && profile[key].trim() && !/[\r\n\0]/.test(profile[key])) || profile.id === 'local') {
        throw new Error('TTS connections need a unique ID, name, supported provider, model, and voice. Manage your TTS connections.');
    }
    const [min, max] = speedRange(profile.provider);
    if (!Number.isFinite(profile.speed) || profile.speed < min || profile.speed > max) throw new Error(`Connection speed must be between ${min} and ${max}.`);
    if (profile.provider === 'custom') validateEndpoint(profile.endpoint);
    return profile;
}

function validateWav(audio) {
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Speech API did not return a WAV audio file.');
    }
    let format = false;
    let data = false;
    for (let offset = 12; offset + 8 <= audio.length;) {
        const kind = audio.toString('ascii', offset, offset + 4);
        const size = audio.readUInt32LE(offset + 4);
        if (kind === 'fmt ' && size >= 16 && offset + 24 <= audio.length) {
            const encoding = audio.readUInt16LE(offset + 8);
            const channels = audio.readUInt16LE(offset + 10);
            const rate = audio.readUInt32LE(offset + 12);
            format = encoding === 1 && channels >= 1 && channels <= 2 && rate > 0;
        }
        if (kind === 'data') {
            // Streaming WAV headers can use an unknown-length sentinel.
            data = audio.length > offset + 8 && (size === 0xffffffff || size > 0 && offset + 8 + size <= audio.length);
            if (data && size === 0xffffffff) audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
            break;
        }
        if (size > audio.length - offset - 8) break;
        offset += 8 + size + size % 2;
    }
    if (!format || !data) throw new Error('Speech API returned an invalid or unsupported PCM WAV file.');
    audio.writeUInt32LE(audio.length - 8, 4);
    return audio;
}

function splitPassage(text, limit = 2000) {
    const chunks = [];
    const boundaries = new Set([text.length]);
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) boundaries.add(segment.index);
    let offset = 0;
    while (offset < text.length) {
        let end = Math.min(text.length, offset + limit);
        while (end > offset && !boundaries.has(end)) --end;
        if (end === offset) throw new Error('A single character sequence exceeds the speech request limit. Select shorter text.');
        if (end < text.length) {
            const slice = text.slice(offset, end);
            const breaks = [...slice.matchAll(/[.!?。！？](?:\s+|$)|\s+/gu)].filter(match => boundaries.has(offset + match.index + match[0].length));
            const sentence = breaks.filter(match => /[.!?。！？]/u.test(match[0])).at(-1);
            const boundary = sentence || breaks.at(-1);
            if (boundary) end = offset + boundary.index + boundary[0].length;
        }
        chunks.push(text.slice(offset, end));
        offset = end;
    }
    return chunks;
}

function createProviders({ audioRequest = requestApi, jsonRequest = requestJson } = {}) {
    return {
        async synthesize(profile, text, key, signal) {
            validateProfile(profile);
            if (profile.provider !== 'custom' && !key) throw new Error('This TTS connection needs an API key. Use Set API Key.');
            const eleven = profile.provider === 'elevenlabs';
            const endpoint = eleven ? `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voice)}?output_format=wav_24000`
                : profile.provider === 'openai' ? 'https://api.openai.com/v1/audio/speech' : profile.endpoint;
            const body = eleven ? { text, model_id: profile.model, voice_settings: { speed: profile.speed } }
                : { input: text, model: profile.model, voice: profile.voice, speed: profile.speed, response_format: 'wav' };
            return validateWav(await audioRequest(endpoint, { key, header: eleven ? 'xi-api-key' : 'Authorization', body, signal }));
        },
        async voices(profile, key, signal) {
            if (profile.provider === 'custom') return [];
            if (profile.provider === 'openai') return (profile.model.startsWith('gpt-4o-mini-tts') ? NEW_VOICES : VOICES).map(id => ({ id, name: id }));
            const voices = [];
            let token = '';
            const seen = new Set();
            do {
                const result = await jsonRequest(`https://api.elevenlabs.io/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`, { key, header: 'xi-api-key', signal });
                if (!Array.isArray(result.voices)) throw new Error('Speech API returned an unreadable voice list.');
                voices.push(...result.voices.filter(v => typeof v.voice_id === 'string' && typeof v.name === 'string').map(v => ({ id: v.voice_id, name: v.name, locale: v.labels?.language || '' })));
                token = result.has_more ? result.next_page_token : '';
                if (token && (seen.has(token) || seen.size >= 100)) throw new Error('Speech API voice pagination did not finish. Enter a voice ID manually.');
                seen.add(token);
            } while (token);
            return voices;
        },
        async models(provider, key, signal) {
            if (provider !== 'elevenlabs') return provider === 'openai' ? OPENAI_MODELS : [];
            const models = await jsonRequest('https://api.elevenlabs.io/v1/models', { key, header: 'xi-api-key', signal });
            if (!Array.isArray(models)) throw new Error('Speech API returned an unreadable model list.');
            return models.filter(m => m.can_do_text_to_speech && typeof m.model_id === 'string').map(m => m.model_id);
        }
    };
}

module.exports = { createProviders, validateProfile, validateWav, splitPassage, speedRange };
