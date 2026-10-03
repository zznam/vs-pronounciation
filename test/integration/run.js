const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
    const executable = process.env.VSCODE_EXECUTABLE_PATH;
    if (!executable) throw new Error('Set VSCODE_EXECUTABLE_PATH to the VS Code application executable. See README.md.');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-vscode-'));
    const root = path.resolve(__dirname, '../..');
    try {
        // Keep compatibility runs on the requested host version, in an isolated profile.
        const settings = path.join(temp, 'user', 'User', 'settings.json');
        await fs.mkdir(path.dirname(settings), { recursive: true });
        await fs.writeFile(settings, JSON.stringify({ 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false }));
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(executable, [
            '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-extensions', '--disable-workspace-trust',
            `--user-data-dir=${path.join(temp, 'user')}`, `--extensions-dir=${path.join(temp, 'extensions')}`,
            `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(__dirname, 'index.js')}`
        ], { env, stdio: 'inherit' });
        await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', code => code === 0 ? resolve() : reject(new Error(`VS Code tests exited with code ${code}`)));
        });
    } finally {
        await fs.rm(temp, { recursive: true, force: true });
    }
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
