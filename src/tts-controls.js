const { randomUUID } = require('node:crypto');
const { createProviders, validateProfile, speedRange } = require('./tts-providers');
const { validateEndpoint } = require('./api-client');
const { secretKey } = require('./tts-backend');

const DISCLOSURE = 'API speech sends text to this service, may incur charges, and uses AI-generated voices.';
const TEST_TEXT = 'Hello. This is a test of your text to speech connection.';

function createTtsControls(vscode, context, preview, invalidate, providers = createProviders()) {
    let disposed = false;
    const pending = new Set();
    const config = () => vscode.workspace.getConfiguration('pronounciation');
    function profiles(current = config()) {
        const list = current.get('tts.profiles', []);
        if (!Array.isArray(list) || list.some(profile => !profile || typeof profile.id !== 'string' || typeof profile.name !== 'string')) {
            throw new Error('TTS profiles must be a list of named connections with IDs. Fix tts.profiles in Pronunciation settings.');
        }
        return list;
    }
    function active(resource) {
        const currentConfig = vscode.workspace.getConfiguration('pronounciation', resource);
        const id = currentConfig.get('tts.activeProfile', 'local');
        if (id === 'local') return;
        const matches = profiles(currentConfig).filter(profile => profile.id === id);
        if (matches.length !== 1) throw new Error('The selected TTS connection is missing or duplicated. Choose a TTS connection.');
        return { ...validateProfile(matches[0]) };
    }
    async function saveProfiles(next) {
        if (disposed) return;
        await config().update('tts.profiles', next, vscode.ConfigurationTarget.Global);
        await invalidate();
    }
    async function savePreference(profile, key, value) {
        if (disposed) return;
        if (profile) {
            if (active()?.id !== profile.id) return;
            const latest = profiles();
            const original = latest.find(item => item.id === profile.id);
            // A stale picker must not overwrite an edited or removed connection.
            if (JSON.stringify(original) !== JSON.stringify(profile)) return;
            await saveProfiles(latest.map(item => item.id === profile.id ? { ...item, [key]: value } : item));
        } else {
            if (active()) return;
            await config().update(key, value, vscode.ConfigurationTarget.Global);
            await invalidate();
        }
    }
    async function list(kind, profile) {
        const controller = new AbortController();
        pending.add(controller);
        try {
            const key = await context.secrets.get(secretKey(profile.id)) || '';
            if (disposed) return [];
            return kind === 'voices' ? await providers.voices(profile, key, controller.signal) : await providers.models(profile.provider, key, controller.signal);
        } finally { pending.delete(controller); }
    }
    async function voice(profile) {
        let voices = [];
        if (profile.provider !== 'custom') {
            try { voices = await list('voices', profile); }
            catch { if (!disposed) void vscode.window.showInformationMessage('Could not list API voices. You can enter a voice ID manually.'); }
        }
        if (disposed) return;
        const choice = await vscode.window.showQuickPick([
            ...voices.map(item => ({ label: item.name, voice: item.id, description: [item.locale, item.id === profile.voice ? 'Current voice' : ''].filter(Boolean).join(' · ') })),
            { label: 'Enter voice ID manually', manual: true }
        ], { placeHolder: 'Choose a voice for this TTS connection', matchOnDescription: true });
        if (!choice || disposed) return;
        if (!choice.manual) return choice.voice;
        return vscode.window.showInputBox({ title: 'TTS voice ID', value: profile.voice, validateInput: required, prompt: 'Enter the voice ID accepted by your provider.' });
    }
    async function model(profile) {
        let models = [];
        try { models = await list('models', profile); }
        catch { if (!disposed) void vscode.window.showInformationMessage('Could not list API models. You can enter a model ID manually.'); }
        if (disposed) return;
        const choice = await vscode.window.showQuickPick([...models.map(id => ({ label: id, model: id })), { label: 'Enter model ID manually', manual: true }], { placeHolder: 'Choose a TTS model' });
        if (!choice || disposed) return;
        return choice.manual ? vscode.window.showInputBox({ title: 'TTS model ID', value: profile.model, validateInput: required }) : choice.model;
    }
    async function choose(includeLocal = false) {
        const choices = profiles().map(profile => ({ label: profile.name, description: profile.provider, profile }));
        if (includeLocal) choices.unshift({ label: 'Local speech', description: 'Offline system voices', local: true });
        return vscode.window.showQuickPick(choices, { placeHolder: includeLocal ? 'Choose the connection for your next read' : 'Choose a TTS connection to manage' });
    }
    async function edit(original) {
        const profile = original ? { ...original } : { id: randomUUID(), speed: 1 };
        if (!original) {
            const provider = await vscode.window.showQuickPick(['openai', 'elevenlabs', 'custom'].map(id => ({ label: id === 'custom' ? 'Custom OpenAI-compatible API' : id === 'openai' ? 'OpenAI' : 'ElevenLabs', provider: id })), { placeHolder: DISCLOSURE });
            if (!provider || disposed) return;
            profile.provider = provider.provider;
            profile.model = provider.provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'gpt-4o-mini-tts';
            profile.voice = provider.provider === 'openai' ? 'marin' : '';
        }
        const name = await vscode.window.showInputBox({ title: 'TTS connection name', value: profile.name || '', prompt: DISCLOSURE, validateInput: required });
        if (name === undefined || disposed) return;
        profile.name = name.trim();
        if (profile.provider === 'custom') {
            const endpoint = await vscode.window.showInputBox({ title: 'Speech API URL', value: profile.endpoint || '', prompt: 'Complete OpenAI-compatible speech URL. The response must be WAV audio.', validateInput: value => {
                try { validateEndpoint(value); } catch (error) { return error.message; }
            } });
            if (endpoint === undefined || disposed) return;
            profile.endpoint = validateEndpoint(endpoint).href;
        }
        const selectedModel = await model(profile);
        if (!selectedModel || disposed) return;
        profile.model = selectedModel.trim();
        const selectedVoice = await voice(profile);
        if (!selectedVoice || disposed) return;
        profile.voice = selectedVoice.trim();
        const [min, max] = speedRange(profile.provider);
        const speed = await vscode.window.showInputBox({ title: 'TTS connection speed', value: String(profile.speed), prompt: `${min}–${max}×`, validateInput: value => Number.isFinite(Number(value)) && value.trim() && Number(value) >= min && Number(value) <= max ? undefined : `Enter a number from ${min} to ${max}.` });
        if (speed === undefined || disposed) return;
        profile.speed = Number(speed);
        validateProfile(profile);
        const latest = profiles();
        if (original && JSON.stringify(latest.find(item => item.id === original.id)) !== JSON.stringify(original)) return;
        // A credential is bound to its endpoint; do not carry it to an edited destination.
        if (original && original.endpoint !== profile.endpoint) await context.secrets.delete(secretKey(profile.id));
        if (disposed) return;
        await saveProfiles(original ? latest.map(item => item.id === profile.id ? profile : item) : [...latest, profile]);
        if (!disposed) void vscode.window.showInformationMessage('TTS connection saved. Use Set API Key, Test Connection, then Choose TTS Connection.');
    }
    const actions = {
        async manageTtsConnections() {
            const choice = await vscode.window.showQuickPick(['Add connection', 'Edit connection', 'Remove connection'], { placeHolder: 'Manage TTS connections' });
            if (!choice || disposed) return;
            if (choice === 'Add connection') return edit();
            const selected = await choose();
            if (!selected || disposed) return;
            if (choice === 'Edit connection') return edit(selected.profile);
            await saveProfiles(profiles().filter(item => item.id !== selected.profile.id));
            await context.secrets.delete(secretKey(selected.profile.id));
            if (!disposed && config().get('tts.activeProfile', 'local') === selected.profile.id) await config().update('tts.activeProfile', 'local', vscode.ConfigurationTarget.Global);
        },
        async chooseTtsConnection() {
            const selected = await choose(true);
            if (!selected || disposed) return;
            if (selected.profile) validateProfile(selected.profile);
            await config().update('tts.activeProfile', selected.local ? 'local' : selected.profile.id, vscode.ConfigurationTarget.Global);
            await invalidate();
        },
        async setApiKey() {
            const selected = await choose();
            if (!selected || disposed) return;
            const key = await vscode.window.showInputBox({ title: `API key: ${selected.profile.name}`, password: true, prompt: 'Stored securely on this computer; never written to settings JSON.', validateInput: required });
            if (key === undefined || disposed) return;
            if (JSON.stringify(profiles().find(item => item.id === selected.profile.id)) !== JSON.stringify(selected.profile)) return;
            await context.secrets.store(secretKey(selected.profile.id), key.trim());
            await invalidate();
        },
        async removeApiKey() {
            const selected = await choose();
            if (!selected || disposed) return;
            await context.secrets.delete(secretKey(selected.profile.id));
            await invalidate();
        },
        async testTtsConnection() {
            const selected = await choose(true);
            if (!selected || disposed) return;
            if (selected.local) return preview(TEST_TEXT, { voice: config().get('voice', ''), speed: config().get('speed', 1) });
            return preview(TEST_TEXT, { profile: validateProfile(selected.profile) });
        }
    };
    const commands = Object.fromEntries(Object.entries(actions).map(([name, run]) => [name, async () => {
        if (disposed) return;
        try { await run(); } catch (error) { if (!disposed) void vscode.window.showErrorMessage(`Pronunciation: ${error.message}`); }
    }]));
    return { commands, active, voice, savePreference, dispose() { disposed = true; for (const controller of pending) controller.abort(); pending.clear(); } };
}

function required(value) { return typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value) ? undefined : 'Enter a nonempty single-line value.'; }

module.exports = { createTtsControls, TEST_TEXT, DISCLOSURE, required };
