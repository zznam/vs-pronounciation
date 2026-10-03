// Run by VS Code's Extension Development Host, not by node --test.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
    const root = path.resolve(__dirname, '../..');
    const extension = vscode.extensions.all.find(item => item.extensionPath === root);
    assert.ok(extension, 'Development extension must be discoverable');
    const originalSpawn = childProcess.spawn;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-audio-'));
    const recordings = [];
    try {
        // Exercise the real macOS engine silently by redirecting its audio to a temporary file.
        childProcess.spawn = (command, args, options) => {
            if (process.platform !== 'darwin' || command !== 'say') return originalSpawn(command, args, options);
            const recording = { file: path.join(temp, `${recordings.length}.aiff`) };
            recordings.push(recording);
            const child = originalSpawn(command, [...args, '-o', recording.file], options);
            const originalEnd = child.stdin.end;
            child.stdin.end = function(input, ...rest) {
                recording.text = input;
                return originalEnd.call(this, input, ...rest);
            };
            return child;
        };
        await extension.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const { command } of require('../../package.json').contributes.commands) {
            assert.ok(commands.includes(command));
        }
        await vscode.commands.executeCommand('pronounciation.stop');
        assert.equal(vscode.workspace.getConfiguration('pronounciation').get('speed'), 1);
        if (process.platform === 'darwin') {
            const document = await vscode.workspace.openTextDocument({ content: 'Hello world.\nGoodbye world.', language: 'plaintext' });
            const editor = await vscode.window.showTextDocument(document);
            editor.selection = new vscode.Selection(0, 0, 0, 5);
            await vscode.commands.executeCommand('pronounciation.pronounce');
            editor.selection = new vscode.Selection(1, 2, 1, 2);
            await vscode.commands.executeCommand('pronounciation.repeat');
            await vscode.commands.executeCommand('pronounciation.pronounce');
            await vscode.commands.executeCommand('pronounciation.readLine');
            await vscode.commands.executeCommand('pronounciation.readParagraph');
            await vscode.commands.executeCommand('pronounciation.readDocument');
            editor.selections = [new vscode.Selection(1, 0, 1, 7), new vscode.Selection(0, 0, 0, 5)];
            await vscode.commands.executeCommand('pronounciation.readAllSelections');
            await vscode.commands.executeCommand('pronounciation.clearReplay');
            assert.deepEqual(recordings.map(recording => recording.text), ['Hello', 'Hello', 'Goodbye', 'Goodbye world.', 'Hello world.\nGoodbye world.', 'Hello world.\nGoodbye world.', 'Hello\nGoodbye']);
            for (const recording of recordings) {
                const audio = await fs.readFile(recording.file);
                assert.equal(audio.subarray(0, 4).toString(), 'FORM');
                assert.ok(audio.length > 1000, 'Speech engine must generate audio frames');
            }
        }
        await vscode.commands.executeCommand('pronounciation.stop');
    } finally {
        childProcess.spawn = originalSpawn;
        await fs.rm(temp, { recursive: true, force: true });
    }
}

module.exports = { run };
