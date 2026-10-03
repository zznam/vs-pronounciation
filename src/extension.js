const { Playback } = require('./playback');

const MAX_TEXT_LENGTH = 50000;

function getText(editor, readWordAtCursor) {
    if (!editor.selection.isEmpty) return editor.document.getText(editor.selection).trim();
    if (!readWordAtCursor) return '';
    const range = editor.document.getWordRangeAtPosition(editor.selection.active);
    // getText(undefined) reads the entire document, so an absent range must be handled explicitly.
    return range ? editor.document.getText(range).trim() : '';
}

function registerExtension(vscode, context, backend) {
    let lastText = '';
    let disposed = false;
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
    }, error => {
        void Promise.resolve(vscode.window.showErrorMessage(`Pronunciation: ${error.message}`, 'Open Settings')).then(action => {
            if (action === 'Open Settings' && !disposed) return vscode.commands.executeCommand('workbench.action.openSettings', 'pronounciation');
        }).catch(() => {});
    });
    void vscode.commands.executeCommand('setContext', 'pronounciation.speaking', false);

    function speak(text) {
        const config = vscode.workspace.getConfiguration('pronounciation');
        lastText = text;
        return playback.speak(text, { voice: config.get('voice', ''), speed: config.get('speed', 1) });
    }

    const commands = {
        pronounce() {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return vscode.window.showInformationMessage('Open an editor to pronounce text.');
            const config = vscode.workspace.getConfiguration('pronounciation');
            const text = getText(editor, config.get('readWordAtCursor', true));
            if (!text) return vscode.window.showInformationMessage('Select some text or place the cursor on a word.');
            if (text.length > MAX_TEXT_LENGTH) {
                return vscode.window.showInformationMessage('Select a shorter passage (up to 50,000 characters).');
            }
            return speak(text);
        },
        stop() { return playback.stop(); },
        repeat() {
            if (!lastText) return vscode.window.showInformationMessage('Pronounce some text first, then replay it here.');
            return speak(lastText);
        },
        async setSpeed() {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
            const choice = await vscode.window.showQuickPick(speeds.map(speed => ({
                label: `${speed}×`, description: speed === 1 ? 'Normal speed' : '', speed
            })), { placeHolder: 'Choose pronunciation speed for the next playback' });
            if (!choice || disposed) return;
            try {
                await vscode.workspace.getConfiguration('pronounciation').update('speed', choice.speed, vscode.ConfigurationTarget.Global);
            } catch (error) {
                void vscode.window.showErrorMessage(`Could not save pronunciation speed: ${error.message}`);
            }
        }
    };
    for (const [name, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(`pronounciation.${name}`, handler));
    }
    const extension = {
        dispose() {
            if (!disposed) {
                disposed = true;
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
