const { createVoiceControls } = require('./voice-controls');
const { Playback } = require('./playback');
const { MAX_TEXT_LENGTH, prepareText, getLine, getParagraph, getSelections } = require('./text');

function getText(editor, readWordAtCursor) {
    if (!editor.selection.isEmpty) return editor.document.getText(editor.selection).trim();
    if (!readWordAtCursor) return '';
    const range = editor.document.getWordRangeAtPosition(editor.selection.active);
    // getText(undefined) reads the entire document, so an absent range must be handled explicitly.
    return range ? editor.document.getText(range).trim() : '';
}

function registerExtension(vscode, context, backend, discoverVoices) {
    let lastText = '';
    let disposed = false;
    let inputRequest = 0;
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.name = 'Pronunciation playback';
    status.text = '$(primitive-square) Stop pronunciation';
    status.tooltip = 'Stop reading aloud';
    status.command = 'pronounciation.stop';
    const playback = new Playback(backend, speaking => {
        if (disposed) return;
        if (speaking) status.show();
        else status.hide();
        void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', speaking);
    }, error => { void vscode.window.showErrorMessage(`Pronunciation: ${error.message}`); });
    void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', false);
    const voiceControls = createVoiceControls(vscode, (text, options) => playback.speak(text, options), discoverVoices);

    function speak(text, document) {
        const config = vscode.workspace.getConfiguration('pronounciation', document);
        lastText = text;
        return playback.speak(text, { voice: config.get('voice', ''), speed: config.get('speed', 1) });
    }

    function read(text, document) {
        if (disposed) return;
        ++inputRequest;
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
            const text = await vscode.window.showInputBox({ title: 'Pronunciation: Read Typed Text', prompt: 'Enter a word or passage to read aloud using your local speech engine.' });
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
        },
        stop() { ++inputRequest; return playback.stop(); },
        repeat() {
            ++inputRequest;
            if (!lastText) return vscode.window.showInformationMessage('Pronounce some text first, then replay it here.');
            return speak(lastText);
        },
        ...voiceControls.commands
    };
    for (const [name, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(`pronounciation.${name}`, handler));
    }
    const extension = {
        dispose() {
            if (!disposed) {
                disposed = true;
                voiceControls.dispose();
                lastText = '';
                status.dispose();
                void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', false);
            }
            return playback.dispose();
        }
    };
    context.subscriptions.push(extension);
    return extension;
}

module.exports = { registerExtension, getText, MAX_TEXT_LENGTH };
