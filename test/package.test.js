const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyVsix } = require('../scripts/verify-vsix');

test('package verification rejects unexpected files, missing runtime code and stale source contents', async () => {
    const root = path.resolve(__dirname, '..');
    const manifest = require('../package.json');
    const files = ['package.json', 'extension.js', 'README.md', 'LICENSE.md', manifest.icon,
        ...(await fs.readdir(path.join(root, 'src'))).filter(file => file.endsWith('.js')).map(file => `src/${file}`)];
    const entries = new Map(await Promise.all(files.map(async file => [`extension/${file}`, await fs.readFile(path.join(root, file))])));
    const verify = map => verifyVsix('fixture.vsix', root, async () => map);
    assert.match(await verify(entries), /exact runtime\/asset contents/);
    for (const file of ['graft/.cache/session.json', '.env', 'test/private.txt', 'src/notes.txt', '../private.txt']) {
        await assert.rejects(verify(new Map([...entries, [`extension/${file}`, Buffer.from('private')]])), /Unexpected file/);
    }
    const missing = new Map(entries); missing.delete('extension/src/credentials.js');
    await assert.rejects(verify(missing), /Missing runtime/);
    const stale = new Map(entries); stale.set('extension/src/extension.js', Buffer.from('old code'));
    await assert.rejects(verify(stale), /differs from source/);
    const changedManifest = new Map(entries); changedManifest.set('extension/package.json', Buffer.from(JSON.stringify({ ...manifest, version: '0.0.0' })));
    await assert.rejects(verify(changedManifest), /manifest must match/);
});
