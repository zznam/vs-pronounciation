const { validateEndpoint } = require('./api-client');

function secretKey(id) { return `pronounciation.tts.apiKey.${id}`; }

function destination(profile) {
    return profile.provider === 'custom' ? `custom:${validateEndpoint(profile.endpoint).href}` : profile.provider;
}

function encodeApiKey(profile, key) {
    return JSON.stringify({ version: 1, destination: destination(profile), key: key.trim() });
}

async function readApiKey(secrets, profile) {
    const stored = await secrets.get(secretKey(profile.id));
    if (!stored) return '';
    let credential;
    try { credential = JSON.parse(stored); } catch { /* Legacy keys have no verified destination. */ }
    if (credential?.version !== 1 || typeof credential.key !== 'string' || credential.destination !== destination(profile)) {
        throw new Error('Set API Key again for this connection. The saved key is not bound to this provider and endpoint.');
    }
    return credential.key;
}

module.exports = { secretKey, encodeApiKey, readApiKey };
