const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { requestApi, requestJson, validateEndpoint } = require('../src/api-client');
const { wav } = require('./tts-helpers');

async function server(t, handler) {
    const listener = http.createServer(handler);
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    t.after(() => { listener.closeAllConnections(); listener.close(); });
    return `http://127.0.0.1:${listener.address().port}/speech`;
}

test('custom URLs permit encrypted endpoints and loopback, rejecting plaintext remote URLs and embedded credentials', () => {
    for (const url of ['https://example.com/v1/audio/speech', 'http://localhost:80/speech', 'http://127.0.0.1/speech', 'http://[::1]/speech']) assert.ok(validateEndpoint(url));
    for (const url of ['', 'invalid', 'http://example.com/speech', 'ftp://localhost/file', 'https://user:pass@example.com/speech', 'https://example.com/speech#fragment']) assert.throws(() => validateEndpoint(url));
});

test('HTTP boundary transmits exact UTF-8 JSON and bearer credentials, and reads bounded WAV audio', async t => {
    const url = await server(t, async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Bearer private-key');
        assert.equal(req.headers['content-type'], 'application/json');
        assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { input: 'Xin chào 😀' });
        res.end(wav());
    });
    assert.deepEqual(await requestApi(url, { key: 'private-key', body: { input: 'Xin chào 😀' } }), wav());
});

test('inventory requests use GET and provider auth, and malformed JSON produces a safe error', async t => {
    let valid = true;
    const url = await server(t, (req, res) => {
        assert.equal(req.method, 'GET');
        assert.equal(req.headers['xi-api-key'], 'key');
        res.end(valid ? '{"voices":[]}' : 'sensitive invalid response');
    });
    assert.deepEqual(await requestJson(url, { key: 'key', header: 'xi-api-key' }), { voices: [] });
    valid = false;
    await assert.rejects(requestJson(url, { key: 'key', header: 'xi-api-key' }), /unreadable list/);
});

test('HTTP errors and redirects are sanitized, never retried or followed', async t => {
    let status = 401;
    let calls = 0;
    const url = await server(t, (req, res) => { calls++; res.writeHead(status, { Location: 'https://example.com/leak' }); res.end('secret-key selected-text'); });
    for (const [code, message] of [[401, /permissions/], [403, /permissions/], [429, /quota/], [302, /redirects/], [500, /HTTP 500/], [422, /HTTP 422/]]) {
        status = code;
        await assert.rejects(requestApi(url), error => message.test(error.message) && !/secret-key|selected-text/.test(error.message));
    }
    assert.equal(calls, 6);
});

test('oversized responses, timeouts, aborts and broken connections terminate requests', async t => {
    let mode = 'large';
    const url = await server(t, (req, res) => {
        if (mode === 'large') res.end(Buffer.alloc(1024));
        if (mode === 'broken') { res.write('start'); res.socket.destroy(); }
        if (mode === 'partial') { res.write('start'); setImmediate(() => res.socket.destroy()); }
    });
    await assert.rejects(requestApi(url, { maxBytes: 10 }), /allowed size/);
    mode = 'hang';
    await assert.rejects(requestApi(url, { timeout: 20 }), /timed out/);
    const controller = new AbortController();
    const request = requestApi(url, { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await assert.rejects(requestApi(url, { signal: controller.signal }), { name: 'AbortError' });
    mode = 'broken';
    await assert.rejects(requestApi(url), /connect|interrupted/);
    mode = 'partial';
    await assert.rejects(requestApi(url), /interrupted/);
    await assert.rejects(requestApi(url, { key: 'invalid\nheader' }), /Could not start/);
});
