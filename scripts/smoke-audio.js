const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout } = require('node:timers/promises');
const { createAudioPlayer } = require('../src/audio-player');
const { wav } = require('../test/tts-helpers');

async function smokeAudio() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-audio-smoke-'));
    let active;
    try {
        const file = path.join(directory, 'Xin chào silence.wav');
        const player = createAudioPlayer();
        await player.ensureReady();
        await fs.writeFile(file, wav(0.1));
        active = player.play(file);
        await active.done;
        await fs.writeFile(file, wav(5));
        active = player.play(file);
        // Attach a rejection handler immediately, including on hosts without an audio device.
        const completion = active.done.then(() => {}, error => { throw error; });
        await Promise.race([completion, setTimeout(200)]);
        await active.stop();
        await completion;
        process.stdout.write(`Native WAV playback and cancellation passed on ${process.platform}.\n`);
    } finally {
        await active?.stop();
        await fs.rm(directory, { recursive: true, force: true });
    }
}

smokeAudio().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
