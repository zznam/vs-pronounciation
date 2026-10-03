const { createVoiceControls } = require('./voice-controls');
const { Playback } = require('./playback');
const { createSentenceHighlighter } = require('./sentence-highlighter');
const { MAX_TEXT_LENGTH, prepareText, getLine, getParagraph, getSelections } = require('./text');
const { createTtsBackend } = require('./tts-backend');
const { createTtsControls } = require('./tts-controls');
const { ReadingSession } = require('./reading-session');
const { createReadingControls } = require('./reading-controls');

function getText(editor, readWordAtCursor) {
    if (!editor.selection.isEmpty) return editor.document.getText(editor.selection).trim();
    if (!readWordAtCursor) return '';
    const range = editor.document.getWordRangeAtPosition(editor.selection.active);
    // getText(undefined) reads the entire document, so an absent range must be handled explicitly.
    return range ? editor.document.getText(range).trim() : '';
}

function registerExtension(vscode, context, backend, discoverVoices, ttsDependencies = {}) {
    let lastText = '';
    let disposed = false;
    let inputRequest = 0;
    let disposal;
    function renderStatus(name, phase) {
        const state = readingSession?.state;
        const position = state && (state.phase === 'generating' || state.phase === 'playing')
            ? `Sentence ${state.index + 1}/${state.passage.sentences.length} · ` : '';
        status.text = `$(primitive-square) ${position}${name} · ${phase === 'generating' ? 'Generating' : 'Playing'}`;
    }
    const speech = createTtsBackend(backend, { secrets: context.secrets, ...ttsDependencies });
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.name = 'Pronunciation playback';
    status.text = '$(primitive-square) Stop pronunciation';
    status.tooltip = 'Stop reading aloud';
    status.command = 'pronounciation.stop';
    const playback = new Playback(speech, (speaking, options) => {
        if (disposed) return;
        if (speaking) {
            renderStatus(options?.profile?.name || 'Local speech', options?.profile ? 'generating' : 'playing');
            status.show();
        }
        else status.hide();
        void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', speaking);
    }, (error, request) => {
        const inputToken = inputRequest;
        const actions = error.cloud ? ['Read locally', 'Manage connections'] : ['Open Settings'];
        void Promise.resolve(vscode.window.showErrorMessage(`Pronunciation: ${error.message}`, ...actions)).then(action => {
            if (disposed || request !== playback.request || inputToken !== inputRequest) return;
            if (action === 'Open Settings') return vscode.commands.executeCommand('workbench.action.openSettings', 'pronounciation');
            if (action === 'Manage connections') return ttsControls.commands.manageTtsConnections();
            if (action === 'Read locally') {
                readingSession.interrupt();
                const config = vscode.workspace.getConfiguration('pronounciation');
                return playback.speak(error.remainingText, { voice: config.get('voice', ''), speed: config.get('speed', 1), preview: true });
            }
        }).catch(() => {});
    }, (phase, name) => {
        renderStatus(name, phase);
    });
    void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', false);
    const readingSession = new ReadingSession(playback, passage => speechOptions(passage.source?.uri));
    const publishSession = state => {
        if (disposed) return;
        const count = state.passage?.sentences.length || 0;
        for (const [key, value] of Object.entries({ sessionLoaded: count > 0, sessionHasPrevious: state.index > 0, sessionHasNext: state.index + 1 < count })) {
            void vscode.commands.executeCommand('setContext', `pronounciation.${key}`, value);
        }
    };
    context.subscriptions.push(readingSession.subscribe(publishSession));
    publishSession(readingSession.state);
    const preview = (text, options) => { ++inputRequest; readingSession.interrupt(); return playback.speak(text, { ...options, preview: true }); };
    const ttsControls = createTtsControls(vscode, context, preview, () => speech.clearReplay(), ttsDependencies.providers);
    const voiceControls = createVoiceControls(vscode, preview, discoverVoices, ttsControls);
    const highlighter = createSentenceHighlighter(vscode, readingSession);

    const readingControls = createReadingControls(vscode, readingSession, {
        claim: () => ++inputRequest,
        isCurrent: request => !disposed && request === inputRequest,
        clearAudio: () => speech.clearReplay()
    });

    function speechOptions(document) {
        const config = vscode.workspace.getConfiguration('pronounciation', document);
        const profile = ttsControls.active(document);
        return profile ? { profile } : { voice: config.get('voice', ''), speed: config.get('speed', 1) };
    }

    function speak(text, document) {
        readingSession.interrupt();
        lastText = text;
        return playback.speak(text, speechOptions(document));
    }

    function read(text, document) {
        if (disposed) return;
        ++inputRequest;
        readingSession.interrupt();
        try {
            const prepared = prepareText(text, vscode.workspace.getConfiguration('pronounciation', document));
            if (!prepared) return vscode.window.showInformationMessage('Select some text or place the cursor on a word.');
            return speak(prepared, document);
        } catch (error) {
            return vscode.window.showInformationMessage(error.message);
        }
    }

    function readEditor(extract) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return vscode.window.showInformationMessage('Open an editor to pronounce text.');
        return read(extract(editor), editor.document);
    }

    const commands = {
        pronounce() {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return vscode.window.showInformationMessage('Open an editor to pronounce text.');
            const config = vscode.workspace.getConfiguration('pronounciation', editor.document);
            const text = getText(editor, config.get('readWordAtCursor', true));
            return read(text, editor.document);
        },
        readLine() { return readEditor(getLine); },
        readParagraph() { return readEditor(getParagraph); },
        readDocument() { return readEditor(editor => editor.document.getText()); },
        readAllSelections() { return readEditor(editor => getSelections(editor, (start, end) => new vscode.Range(start, end))); },
        async readInput() {
            const request = ++inputRequest;
            const text = await vscode.window.showInputBox({ title: 'Pronunciation: Read Typed Text', prompt: 'Enter a word or passage to read aloud using your selected TTS connection.' });
            if (text !== undefined && request === inputRequest) return read(text);
        },
        async readClipboard() {
            const request = ++inputRequest;
            try {
                const text = await vscode.env.clipboard.readText();
                if (request === inputRequest) return read(text);
            } catch (error) { if (!disposed && request === inputRequest) return vscode.window.showErrorMessage(`Could not read clipboard: ${error.message}`); }
        },
        clearReplay() {
            lastText = '';
            void vscode.window.showInformationMessage('Pronunciation replay text cleared.');
            return speech.clearReplay();
        },
        stop() { ++inputRequest; return readingSession.stop(); },
        repeat() {
            ++inputRequest;
            if (!lastText) return vscode.window.showInformationMessage('Pronounce some text first, then replay it here.');
            return speak(lastText);
        },
        ...readingControls.commands,
        ...voiceControls.commands,
        ...highlighter.commands,
        ...ttsControls.commands
    };
    for (const [name, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(`pronounciation.${name}`, async () => {
            try { return await handler(); }
            catch (error) { if (!disposed) return vscode.window.showErrorMessage(`Pronunciation: ${error.message}`); }
        }));
    }
    const extension = {
        session: readingSession,
        dispose() {
            if (!disposed) {
                disposed = true;
                ++inputRequest;
                for (const key of ['sessionLoaded', 'sessionHasPrevious', 'sessionHasNext']) void vscode.commands.executeCommand('setContext', `pronounciation.${key}`, false);
                highlighter.dispose();
                disposal = readingSession.dispose().then(() => playback.dispose()).then(() => speech.dispose());
                voiceControls.dispose();
                ttsControls.dispose();
                lastText = '';
                status.dispose();
                void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', false);
            }
            return disposal;
        }
    };
    context.subscriptions.push(extension);
    return extension;
}

module.exports = { registerExtension, getText, MAX_TEXT_LENGTH };
