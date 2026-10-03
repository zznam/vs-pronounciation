const { discoverVoices } = require('./voices');

const PREVIEW_TEXT = 'Hello. This is a preview of your pronunciation voice.';

function validateSpeed(value) {
    const speed = Number(value);
    return value.trim() && Number.isFinite(speed) && speed >= 0.25 && speed <= 3
        ? undefined : 'Enter a number from 0.25 to 3.';
}

function createVoiceControls(vscode, preview, discover = discoverVoices) {
    let disposed = false;
    const pending = new Set();
    const config = () => vscode.workspace.getConfiguration('pronounciation');

    async function save(key, value) {
        if (disposed) return;
        try { await config().update(key, value, vscode.ConfigurationTarget.Global); }
        catch (error) { if (!disposed) void vscode.window.showErrorMessage(`Could not save pronunciation ${key}: ${error.message}`); }
    }

    async function pickVoice() {
        if (disposed) return;
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
            const current = config().get('speed', 1);
            const choice = await vscode.window.showQuickPick([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(speed => ({
                label: `${speed}×`, description: [speed === 1 ? 'Normal speed' : '', speed === current ? 'Current speed' : ''].filter(Boolean).join(' · '), speed
            })), { placeHolder: 'Choose pronunciation speed for the next playback' });
            if (choice) await save('speed', choice.speed);
        },
        async setCustomSpeed() {
            const value = await vscode.window.showInputBox({ title: 'Pronunciation: Set Custom Speed',
                value: String(config().get('speed', 1)), prompt: 'Relative speed from 0.25 to 3.', validateInput: validateSpeed });
            if (value !== undefined && !validateSpeed(value)) await save('speed', Number(value));
        },
        faster() { return save('speed', Math.min(3, Math.round((config().get('speed', 1) + 0.25) * 100) / 100)); },
        slower() { return save('speed', Math.max(0.25, Math.round((config().get('speed', 1) - 0.25) * 100) / 100)); },
        resetSpeed() { return save('speed', 1); },
        async setVoice() {
            const choice = await pickVoice();
            if (choice) await save('voice', choice.voice);
        },
        async previewVoice() {
            const choice = await pickVoice();
            if (choice && !disposed) return preview(PREVIEW_TEXT, { voice: choice.voice, speed: config().get('speed', 1) });
        },
        openSettings() { return vscode.commands.executeCommand('workbench.action.openSettings', 'pronounciation'); }
    };
    return { commands, dispose() { disposed = true; for (const controller of pending) controller.abort(); pending.clear(); } };
}

module.exports = { createVoiceControls, validateSpeed, PREVIEW_TEXT };
