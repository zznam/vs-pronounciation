const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { spawn: spawnChild, execFile: execNative } = require('node:child_process');

const WINDOWS_AUDIO = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '$file = [Console]::In.ReadToEnd() | ConvertFrom-Json',
    'Add-Type -AssemblyName System',
    '$player = New-Object System.Media.SoundPlayer',
    'try { $player.SoundLocation = $file; $player.Load(); $player.PlaySync() } finally { $player.Dispose() }'
].join('\n');

function createAudioPlayer({ platform = process.platform, env = process.env, access = fs.access, spawn = spawnChild, execFile = execNative } = {}) {
    let command;
    async function available(name) {
        const paths = (env.PATH || '').split(platform === 'win32' ? ';' : ':');
        const join = platform === 'win32' ? path.win32.join : path.posix.join;
        for (const directory of paths.filter(Boolean)) {
            const candidate = join(directory, name);
            try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; }
            catch { /* Try the next PATH entry. */ }
        }
    }
    return {
        async ensureReady() {
            const names = platform === 'darwin' ? ['afplay'] : platform === 'win32' ? ['powershell.exe'] : platform === 'linux' ? ['paplay', 'aplay'] : [];
            for (const name of names) {
                command = await available(name);
                if (command) break;
            }
            if (!command) throw new Error(platform === 'linux' ? 'API audio needs paplay or aplay. Install a PulseAudio or ALSA player.' : 'The system WAV audio player is unavailable.');
            if (platform === 'win32') await new Promise((resolve, reject) => {
                execFile(command, ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System; $p = New-Object System.Media.SoundPlayer; $p.Dispose()"],
                    { windowsHide: true, timeout: 5000, shell: false }, error => error ? reject(new Error('Windows WAV playback is unavailable. Check PowerShell and System.Media.')) : resolve());
            });
        },
        play(file) {
            if (!command) throw new Error('Check WAV player availability before playback.');
            const args = platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_AUDIO] : [file];
            const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
            let finished = false;
            let cancelled = false;
            let inputError = false;
            const done = new Promise((resolve, reject) => {
                child.once('error', () => { finished = true; reject(new Error('Could not start the WAV audio player.')); });
                child.stdin.on('error', () => { inputError = true; });
                child.once('close', (code, signal) => {
                    finished = true;
                    if (cancelled) resolve();
                    else if (code !== 0 || signal || inputError) reject(new Error('WAV playback failed. Check the system audio output.'));
                    else resolve();
                });
                child.stdin.end(platform === 'win32' ? JSON.stringify(file) : '', 'utf8');
            });
            return { done, async stop() {
                if (!finished && !cancelled) {
                    try { child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
                    cancelled = true;
                }
                await done.catch(() => {});
            } };
        }
    };
}

module.exports = { createAudioPlayer };
