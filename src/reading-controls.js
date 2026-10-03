const { createPassage, editorPassage, readingMode } = require('./session-text');

function createReadingControls(vscode, session, { claim, isCurrent, clearAudio }) {
    async function load(text, source, request) {
        if (!isCurrent(request)) return;
        const config = vscode.workspace.getConfiguration('pronounciation', source?.uri);
        const passage = createPassage(text, config, vscode.env.language, source);
        const mode = readingMode(config.get('reading.mode', 'manual'));
        await session.load(passage, mode);
        if (isCurrent(request)) void vscode.window.showInformationMessage(`Reading session ready: ${passage.sentences.length} sentence(s). Use Play Reading Session to begin.`);
    }

    function startEditor(wholeDocument = false) {
        const request = claim();
        const editor = vscode.window.activeTextEditor;
        if (!editor) return vscode.window.showInformationMessage('Open an editor to start a reading session.');
        const input = editorPassage(editor, wholeDocument, (start, end) => new vscode.Range(start, end));
        return load(input.text, input.source, request);
    }

    function withSession(action) {
        claim();
        if (!session.state.passage) return vscode.window.showInformationMessage('Start a reading session first.');
        return action();
    }

    return {
        commands: {
            startSession() { return startEditor(); },
            startDocumentSession() { return startEditor(true); },
            async startInputSession() {
                const request = claim();
                const text = await vscode.window.showInputBox({ title: 'Pronunciation: Reading Session from Typed Text', prompt: 'Enter a passage. Play Reading Session starts speech after it is loaded.' });
                if (text !== undefined) return load(text, undefined, request);
            },
            async startClipboardSession() {
                const request = claim();
                try {
                    const text = await vscode.env.clipboard.readText();
                    return await load(text, undefined, request);
                } catch (error) {
                    if (isCurrent(request)) throw error;
                }
            },
            playSession() { return withSession(() => session.play()); },
            practiceSession() { return withSession(() => session.practice()); },
            previousSentence() { return withSession(() => session.move(-1)); },
            nextSentence() { return withSession(() => session.move(1)); },
            async chooseSentence() {
                const request = claim();
                const { passage, index } = session.state;
                if (!passage) return vscode.window.showInformationMessage('Start a reading session first.');
                const picked = await vscode.window.showQuickPick(passage.sentences.map((sentence, position) => ({
                    label: `${position + 1}. ${sentence.original.replace(/\s+/gu, ' ')}`,
                    description: position === index ? 'Current sentence' : '', index: position
                })), { placeHolder: 'Choose a sentence; Play Reading Session starts speech', matchOnDescription: true });
                if (picked && isCurrent(request) && session.state.passage === passage) return session.select(picked.index);
            },
            async setReadingMode() {
                const request = claim();
                if (!session.state.passage) return vscode.window.showInformationMessage('Start a reading session first.');
                const mode = session.state.mode;
                const picked = await vscode.window.showQuickPick([
                    { label: 'Manual', mode: 'manual', detail: 'Read one sentence, then wait.' },
                    { label: 'Continuous', mode: 'continuous', detail: 'Read from the current sentence to the end.' }
                ].map(item => ({ ...item, description: item.mode === mode ? 'Current mode' : '' })), { placeHolder: 'Choose a mode for this reading session' });
                if (picked && isCurrent(request)) return session.setMode(picked.mode);
            },
            async clearSession() {
                claim();
                await session.clear();
                await clearAudio();
            }
        }
    };
}

module.exports = { createReadingControls };
