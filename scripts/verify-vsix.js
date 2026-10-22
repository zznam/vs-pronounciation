const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');

function archiveEntries(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            const entries = new Map();
            zip.on('error', reject);
            zip.on('end', () => resolve(entries));
            zip.on('entry', entry => {
                if (entries.has(entry.fileName)) { zip.close(); return reject(new Error(`Duplicate archive entry: ${entry.fileName}`)); }
                if (entry.uncompressedSize > 5 * 1024 * 1024 || entries.size >= 100) { zip.close(); return reject(new Error('Package exceeds the expected file count or size.')); }
                zip.openReadStream(entry, (error, stream) => {
                    if (error) { zip.close(); return reject(error); }
                    const chunks = [];
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('error', error => { zip.close(); reject(error); });
                    stream.on('end', () => {
                        entries.set(entry.fileName, Buffer.concat(chunks));
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}

async function verifyVsix(file, root = path.resolve(__dirname, '..'), readArchive = archiveEntries) {
    const entries = await readArchive(file);
    const names = new Set(entries.keys());
    const manifest = JSON.parse(entries.get('extension/package.json'));
    const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    assert.deepEqual(manifest, source, 'Packaged manifest must match the source manifest');
    const runtime = await fs.readdir(path.join(root, 'src'));
    const required = ['extension.js', 'LICENSE.md', ...runtime.filter(name => name.endsWith('.js')).map(name => `src/${name}`)];
    for (const name of required) assert.ok(names.has(`extension/${name}`), `Missing runtime or license file: ${name}`);
    assert.ok(names.has('extension/readme.md') || names.has('extension/README.md'), 'Missing README');
    assert.ok(names.has(`extension/${source.main.replace(/^\.\//, '')}`), 'Missing declared extension entry point');
    if (source.icon) assert.ok(names.has(`extension/${source.icon}`), 'Missing declared Marketplace icon');
    const allowed = new Set(['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json',
        'extension/readme.md', 'extension/README.md', ...required.map(name => `extension/${name}`)]);
    if (source.icon) allowed.add(`extension/${source.icon}`);
    for (const name of names) {
        assert.ok(allowed.has(name), `Unexpected file in package: ${name}`);
        // VSCE rewrites README links for the Marketplace. Runtime/assets must stay byte-identical.
        if (name.startsWith('extension/') && !/^extension\/readme\.md$/i.test(name)) {
            const relative = name.slice('extension/'.length);
            assert.deepEqual(entries.get(name), await fs.readFile(path.join(root, relative)), `Packaged file differs from source: ${relative}`);
        }
    }
    return `Verified ${names.size} VSIX entries, ${required.length} required runtime/license files, exact runtime/asset contents, and no unexpected files.`;
}

if (require.main === module) {
    verifyVsix(process.argv[2]).then(message => process.stdout.write(`${message}\n`)).catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { verifyVsix, archiveEntries };
