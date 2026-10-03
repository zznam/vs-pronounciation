const { discoverVoices } = require('./voices');
const { speedRange } = require('./tts-providers');

const PREVIEW_TEXT = 'Hello. This is a preview of your pronunciation voice.';

function validateSpeed(value, min = 0.25, max = 3) {
    const speed = Number(value);
    return value.trim() && Number.isFinite(speed) && speed >= min && speed <= max
        ? undefined : `Enter a number from ${min} to ${max}.`;
}

function createVoiceControls(vscode, preview, discover = discoverVoices, tts) {
    let disposed = false;
    const pending = new Set();
    const config = () => vscode.workspace.getConfiguration('pronounciation');

    async function save(key, value, profile) {
        if (disposed) return;
        try {
            if (tts) await tts.savePreference(profile, key, value);
            else await config().update(key, value, vscode.ConfigurationTarget.Global);
        }
        catch (error) { if (!disposed) void vscode.window.showErrorMessage(`Could not save pronunciation ${key}: ${error.message}`); }
    }

    async function pickVoice(profile) {
        if (disposed) return;
        if (profile) {
            const voice = await tts.voice(profile);
            return voice === undefined ? undefined : { voice };
        }
        const controller = new AbortController();
        pending.add(controller);
        let voices;
        try { voices = await discover({ signal: controller.signal }); }
        catch (error) { if (!disposed) void vscode.window.showErrorMessage(`Pronunciation: ${error.message}`); return; }
        finally { pending.delete(controller); }
        if (disposed) return;
        const current = config().get('voice', '');
        const choices = [{ label: 'System default', voice: '', description: current === '' ? 'Current voice' : '' },
            ...voices.map(voice => ({ label: voice.name, voice: voice.name,
                description: [voice.locale || 'Festival voice', voice.name === current ? 'Current voice' : ''].filter(Boolean).join(' · ') }))];
        return vscode.window.showQuickPick(choices, { placeHolder: voices.length ? 'Choose an installed pronunciation voice' : 'No named voices found; use the system default', matchOnDescription: true });
    }

    const commands = {
        async setSpeed() {
            const profile = tts?.active();
            const current = profile ? profile.speed : config().get('speed', 1);
            const [min, max] = speedRange(profile?.provider);
            const presets = [...new Set([min, 0.25, 0.5, 0.75, 1, 1.2, 1.25, 1.5, 2, 3, max])].filter(speed => speed >= min && speed <= max && (profile?.provider === 'elevenlabs' || speed !== 1.2)).sort((a, b) => a - b);
            const choice = await vscode.window.showQuickPick(presets.map(speed => ({
                label: `${speed}×`, description: [speed === 1 ? 'Normal speed' : '', speed === current ? 'Current speed' : ''].filter(Boolean).join(' · '), speed
            })), { placeHolder: 'Choose pronunciation speed for the next playback' });
            if (choice) await save('speed', choice.speed, profile);
        },
        async setCustomSpeed() {
            const profile = tts?.active();
            const [min, max] = speedRange(profile?.provider);
            const validate = profile ? value => validateSpeed(value, min, max) : validateSpeed;
            const value = await vscode.window.showInputBox({ title: 'Pronunciation: Set Custom Speed',
                value: String(profile ? profile.speed : config().get('speed', 1)), prompt: `Relative speed from ${min} to ${max}.`, validateInput: validate });
            if (value !== undefined && !validate(value)) await save('speed', Number(value), profile);
        },
        faster() { return step(0.25); },
        slower() { return step(-0.25); },
        resetSpeed() { return save('speed', 1, tts?.active()); },
        async setVoice() {
            const profile = tts?.active();
            const choice = await pickVoice(profile);
            if (choice) await save('voice', choice.voice, profile);
        },
        async previewVoice() {
            const profile = tts?.active();
            const choice = await pickVoice(profile);
            if (choice && !disposed) return preview(PREVIEW_TEXT, profile ? { profile: { ...profile, voice: choice.voice } } : { voice: choice.voice, speed: config().get('speed', 1) });
        },
        openSettings() { return vscode.commands.executeCommand('workbench.action.openSettings', 'pronounciation'); }
    };
    function step(amount) {
        const profile = tts?.active();
        const [min, max] = speedRange(profile?.provider);
        const current = profile ? profile.speed : config().get('speed', 1);
        return save('speed', Math.max(min, Math.min(max, Math.round((current + amount) * 100) / 100)), profile);
    }
    return { commands, dispose() { disposed = true; for (const controller of pending) controller.abort(); pending.clear(); } };
}

module.exports = { createVoiceControls, validateSpeed, PREVIEW_TEXT };
