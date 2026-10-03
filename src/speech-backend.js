const { spawn: spawnChild } = require('node:child_process');

// Only this fixed script is executable; text and voice names arrive as JSON data.
const WINDOWS_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
    'Add-Type -AssemblyName System.Speech',
    '$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'try {',
    'if ($request.voice) { $speech.SelectVoice($request.voice) }',
    '$speech.Rate = $request.rate',
    '$speech.Speak($request.text)',
    '} finally { $speech.Dispose() }'
].join('\n');

function buildSpeechCommand(platform, text, { voice = '', speed = 1 } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Select some text or place the cursor on a word.');
    }
    if (typeof voice !== 'string' || voice.includes('\0')) {
        throw new Error('The pronunciation voice must be a valid voice name.');
    }
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 3) {
        throw new Error('Pronunciation speed must be between 0.25 and 3.');
    }
    if (platform === 'darwin') {
        const args = ['-r', String(Math.round(175 * speed))];
        if (voice) args.push('-v', voice);
        // Standard input avoids option injection and operating-system argument limits.
        return { command: 'say', args, input: text };
    }
    if (platform === 'win32') {
        return {
            command: 'powershell.exe',
            args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
            input: JSON.stringify({ text, voice, rate: Math.max(-10, Math.min(10, Math.round(9 * Math.log(speed)))) })
        };
    }
    if (platform === 'linux') {
        if (voice && (!voice.startsWith('voice_') || voice.length === 6 || /[^a-zA-Z0-9_]/.test(voice))) {
            throw new Error('Festival voice names must start with voice_ and contain only letters, numbers, or underscores.');
        }
        // Festival reads Scheme. Escape string delimiters, and normalize control characters.
        // eslint-disable-next-line no-control-regex -- Remove nonspoken control characters from the Scheme string.
        const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\u0000-\u001f\u007f]/g, ' ');
        return {
            command: 'festival',
            args: ['--pipe'],
            input: `${voice ? `(${voice})\n` : ''}(Parameter.set 'Duration_Stretch ${1 / speed})\n(SayText "${escaped}")\n`
        };
    }
    throw new Error(`Pronunciation is not supported on ${platform}.`);
}

function createSpeechBackend({ platform = process.platform, spawn = spawnChild, kill = process.kill } = {}) {
    return {
        speak(text, options) {
            const spec = buildSpeechCommand(platform, text, options);
            const child = spawn(spec.command, spec.args, {
                shell: false,
                windowsHide: true,
                detached: platform === 'linux',
                stdio: ['pipe', 'ignore', 'pipe']
            });
            let finished = false;
            let cancelled = false;
            let stderr = '';
            let inputError;
            const done = new Promise((resolve, reject) => {
                child.once('error', error => {
                    finished = true;
                    const hint = platform === 'linux'
                        ? 'Install Festival and a voice (for example: sudo apt install festival festvox-kallpc16k).'
                        : `Check that ${spec.command} is available on this computer.`;
                    reject(new Error(error.code === 'ENOENT' ? `${spec.command} was not found. ${hint}` : 'The speech process could not start.'));
                });
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
                // A missing executable or early exit can also close stdin with EPIPE.
                child.stdin.on('error', error => { inputError = error; });
                child.once('close', (code, signal) => {
                    finished = true;
                    if (cancelled) return resolve();
                    if (code !== 0 || inputError || /SIOD ERROR/i.test(stderr)) {
                        reject(new Error(`${spec.command} could not speak (exit ${code}, signal ${signal}). Check your voice setting and system audio setup.`));
                    } else {
                        resolve();
                    }
                });
                child.stdin.end(spec.input, 'utf8');
            });
            return {
                done,
                async stop() {
                    if (!finished && !cancelled) {
                        try {
                            // Kill only the process/group we created, including Festival's audio player.
                            if (platform === 'linux' && child.pid) kill(-child.pid, 'SIGKILL');
                            else child.kill('SIGKILL');
                        } catch (error) {
                            if (error.code !== 'ESRCH') throw error;
                        }
                        cancelled = true;
                    }
                    await done.catch(() => {});
                }
            };
        }
    };
}

module.exports = { buildSpeechCommand, createSpeechBackend };
