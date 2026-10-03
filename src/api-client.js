const http = require('node:http');
const https = require('node:https');
const { setTimeout, clearTimeout } = require('node:timers');

function abortError() {
    return Object.assign(new Error('Speech request cancelled.'), { name: 'AbortError' });
}

function validateEndpoint(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a complete speech API URL.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
        throw new Error('Speech URLs must use HTTPS, or HTTP on localhost, without embedded credentials or fragments.');
    }
    return url;
}

function requestApi(endpoint, { key = '', header = 'Authorization', body, signal, timeout = 60000, maxBytes = 32 * 1024 * 1024 } = {}) {
    const url = validateEndpoint(endpoint);
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        let settled = false;
        let response;
        let request;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            if (error) { reject(error); response?.destroy(); request?.destroy(); }
            else resolve(value);
        };
        const cancel = () => finish(abortError());
        const timer = setTimeout(() => finish(new Error('Speech API timed out after waiting for a response.')), timeout);
        signal?.addEventListener('abort', cancel, { once: true });
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers = { Accept: body === undefined ? 'application/json' : 'audio/wav' };
        if (key) headers[header] = header === 'Authorization' ? `Bearer ${key}` : key;
        if (payload !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        try {
            request = (url.protocol === 'https:' ? https : http).request(url, { method: payload === undefined ? 'GET' : 'POST', headers }, incoming => {
                response = incoming;
                const code = response.statusCode;
                if (code < 200 || code >= 300) {
                    const message = code === 401 || code === 403 ? 'Speech API rejected the key or account permissions.'
                        : code === 429 ? 'Speech API quota or rate limit reached. Check your provider account.'
                            : code >= 300 && code < 400 ? 'Speech API redirects are not allowed. Use the final speech URL.'
                                : `Speech API returned HTTP ${code}. Check the model, voice, and provider account.`;
                    return finish(new Error(message));
                }
                let size = 0;
                const chunks = [];
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > maxBytes) return finish(new Error('Speech API response exceeds the allowed size.'));
                    chunks.push(chunk);
                });
                response.on('end', () => finish(undefined, Buffer.concat(chunks)));
                response.on('error', () => finish(new Error('Speech API connection interrupted.')));
                response.on('aborted', () => finish(new Error('Speech API connection interrupted.')));
            });
            request.on('error', () => finish(new Error('Could not connect to the speech API. Check the endpoint and network.')));
            request.end(payload);
        } catch { finish(new Error('Could not start the speech API request. Check the endpoint and API key.')); }
    });
}

async function requestJson(endpoint, options) {
    const data = await requestApi(endpoint, { ...options, maxBytes: 1024 * 1024 });
    try { return JSON.parse(data.toString('utf8')); }
    catch { throw new Error('Speech API returned an unreadable list.'); }
}

module.exports = { requestApi, requestJson, validateEndpoint, abortError };
