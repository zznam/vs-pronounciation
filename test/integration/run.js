const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyVsix, archiveEntries } = require('../../scripts/verify-vsix');

async function main() {
    const executable = process.env.VSCODE_EXECUTABLE_PATH;
    if (!executable) throw new Error('Set VSCODE_EXECUTABLE_PATH to the VS Code application executable. See README.md.');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-vscode-'));
    let root = path.resolve(__dirname, '../..');
    let tests = path.join(__dirname, 'index.js');
    try {
        // Keep compatibility runs on the requested host version, in an isolated profile.
        const settings = path.join(temp, 'user', 'User', 'settings.json');
        await fs.mkdir(path.dirname(settings), { recursive: true });
        await fs.writeFile(settings, JSON.stringify({ 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false }));
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        if (process.argv.includes('--package')) {
            const archive = path.join(root, 'artifacts', 'pronunciation.vsix');
            process.stdout.write(`${await verifyVsix(archive, root)}\n`);
            root = path.join(temp, 'packaged');
            for (const [name, data] of await archiveEntries(archive)) {
                if (!name.startsWith('extension/')) continue;
                const destination = path.join(root, name.slice('extension/'.length));
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.writeFile(destination, data);
            }
            // Keep the test module under the development root so VS Code attributes its API calls correctly.
            for (const file of ['integration/index.js', 'integration/practice.js', 'integration/highlighting.js', 'helpers.js', 'tts-helpers.js']) {
                const destination = path.join(root, 'test', file);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.copyFile(path.join(__dirname, '..', file), destination);
            }
            tests = path.join(root, 'test', 'integration', 'index.js');
        }
        env.PRONUNCIATION_EXTENSION_ROOT = root;
        const child = spawn(executable, [
            '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-extensions', '--disable-workspace-trust',
            `--user-data-dir=${path.join(temp, 'user')}`, `--extensions-dir=${path.join(temp, 'extensions')}`,
            `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${tests}`
        ], { env, stdio: 'inherit', timeout: 120000, killSignal: 'SIGKILL' });
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
