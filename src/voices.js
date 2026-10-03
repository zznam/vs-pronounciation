const { execFile: execNative } = require('node:child_process');

const WINDOWS_VOICES = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    'Add-Type -AssemblyName System.Speech',
    '$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'try {',
    '$voices = @($speech.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {',
    '  @{ name = $_.VoiceInfo.Name; locale = $_.VoiceInfo.Culture.Name }',
    '})',
    'ConvertTo-Json -Compress -InputObject $voices',
    '} finally { $speech.Dispose() }'
].join('\n');

function voiceCommand(platform) {
    if (platform === 'darwin') return { command: 'say', args: ['-v', '?'], input: '' };
    if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_VOICES], input: '' };
    if (platform === 'linux') return {
        command: 'festival', args: ['--pipe'],
        input: '(mapcar (lambda (v) (format t "PRONUNCIATION_VOICE\\t%s\\n" v)) (voice.list))\n(quit)\n'
    };
    throw new Error(`Voice discovery is not supported on ${platform}.`);
}

function parseVoices(platform, output) {
    let voices;
    if (platform === 'win32') {
        try { voices = JSON.parse(output.replace(/^\uFEFF/, '').trim()); }
        catch { throw new Error('The system returned an unreadable voice list.'); }
        if (!Array.isArray(voices)) throw new Error('The system returned an unreadable voice list.');
    } else if (platform === 'darwin') {
        voices = output.split(/\r?\n/).flatMap(line => {
            const match = line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9_-]+)\s+#/);
            return match ? [{ name: match[1].trim(), locale: match[2].replace(/_/g, '-') }] : [];
        });
    } else if (platform === 'linux') {
        voices = output.split(/\r?\n/).flatMap(line => {
            const match = line.match(/^PRONUNCIATION_VOICE\t([A-Za-z0-9_]+)$/);
            return match ? [{ name: `voice_${match[1]}`, locale: '' }] : [];
        });
    } else throw new Error(`Voice discovery is not supported on ${platform}.`);
    const unique = new Map();
    for (const voice of voices) {
        if (!voice || typeof voice.name !== 'string' || !voice.name.trim() || /[\r\n\0]/.test(voice.name)) continue;
        unique.set(voice.name, { name: voice.name, locale: typeof voice.locale === 'string' ? voice.locale : '' });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function discoverVoices({ platform = process.platform, execFile = execNative, signal } = {}) {
    const spec = voiceCommand(platform);
    return new Promise((resolve, reject) => {
        const child = execFile(spec.command, spec.args, {
            encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000,
            maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', signal
        }, (error, stdout) => {
            if (error) {
                if (error.name === 'AbortError') return reject(error);
                const message = error.code === 'ENOENT'
                    ? `${spec.command} was not found. ${platform === 'linux' ? 'Install Festival and a voice.' : 'Check your system speech installation.'}`
                    : 'Could not list system voices. Check the speech engine installation; discovery is limited to five seconds.';
                return reject(new Error(message));
            }
            try { resolve(parseVoices(platform, stdout)); }
            catch (error) { reject(error); }
        });
        // Missing executables can close stdin with EPIPE before execFile's callback reports ENOENT.
        child.stdin.on('error', () => {});
        child.stdin.end(spec.input, 'utf8');
    });
}

module.exports = { voiceCommand, parseVoices, discoverVoices };
