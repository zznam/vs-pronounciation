const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');

function archiveEntries(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            const names = new Set();
            let manifest;
            zip.on('error', reject);
            zip.on('end', () => resolve({ names, manifest }));
            zip.on('entry', entry => {
                names.add(entry.fileName);
                if (entry.fileName !== 'extension/package.json') return zip.readEntry();
                if (entry.uncompressedSize > 1024 * 1024) { zip.close(); return reject(new Error('Packaged manifest exceeds 1 MiB.')); }
                zip.openReadStream(entry, (error, stream) => {
                    if (error) { zip.close(); return reject(error); }
                    const chunks = [];
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('error', error => { zip.close(); reject(error); });
                    stream.on('end', () => {
                        try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                        catch (error) { zip.close(); return reject(error); }
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}

async function verifyVsix(file, root = path.resolve(__dirname, '..')) {
    const { names, manifest } = await archiveEntries(file);
    const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    assert.deepEqual(manifest, source, 'Packaged manifest must match the source manifest');
    const runtime = await fs.readdir(path.join(root, 'src'));
    const required = ['extension.js', 'LICENSE.md', ...runtime.filter(name => name.endsWith('.js')).map(name => `src/${name}`)];
    for (const name of required) assert.ok(names.has(`extension/${name}`), `Missing runtime or license file: ${name}`);
    assert.ok(names.has('extension/readme.md') || names.has('extension/README.md'), 'Missing README');
    assert.ok(names.has(`extension/${source.main.replace(/^\.\//, '')}`), 'Missing declared extension entry point');
    if (source.icon) assert.ok(names.has(`extension/${source.icon}`), 'Missing declared Marketplace icon');
    for (const name of names) {
        assert.ok(!/^extension\/(?:test|scripts|node_modules|coverage|artifacts|\.git|\.github|\.vscode)(?:\/|$)/.test(name), `Development file leaked into package: ${name}`);
        assert.ok(!/(?:^|\/)\.env(?:\.|$)/.test(name), `Environment file leaked into package: ${name}`);
    }
    return `Verified ${names.size} VSIX entries, ${required.length} required runtime/license files, and matching command contributions.`;
}

if (require.main === module) {
    verifyVsix(process.argv[2]).then(message => process.stdout.write(`${message}\n`)).catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { verifyVsix };
