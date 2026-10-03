const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyVsix } = require('./verify-vsix');

async function main() {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'artifacts', 'pronunciation.vsix');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const executable = path.join(path.dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');
    const result = spawnSync(process.execPath, [executable, 'package', '--out', output], { cwd: root, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`VSIX packaging failed (exit ${result.status}, signal ${result.signal}).`);
    process.stdout.write(`${await verifyVsix(output, root)}\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
