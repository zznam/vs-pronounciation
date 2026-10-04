// Run by VS Code's Extension Development Host, not by node --test.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const http = require('node:http');
const { wav } = require('../tts-helpers');

async function run() {
    const root = path.resolve(__dirname, '../..');
    const extension = vscode.extensions.all.find(item => item.extensionPath === root);
    assert.ok(extension, 'Development extension must be discoverable');
    const originalSpawn = childProcess.spawn;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-audio-'));
    const recordings = [];
    let server;
    try {
        // Exercise the real macOS engine silently by redirecting its audio to a temporary file.
        childProcess.spawn = (command, args, options) => {
            if (process.platform !== 'darwin' || command !== 'say') return originalSpawn(command, args, options);
            const recording = { file: path.join(temp, `${recordings.length}.aiff`) };
            recordings.push(recording);
            const child = originalSpawn(command, [...args, '-o', recording.file], options);
            recording.done = new Promise(resolve => child.once('close', resolve));
            const originalEnd = child.stdin.end;
            child.stdin.end = function(input, ...rest) {
                recording.text = input;
                return originalEnd.call(this, input, ...rest);
            };
            return child;
        };
        await extension.activate();
        await require('./highlighting').highlighting();
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
            const sessionDocument = await vscode.workspace.openTextDocument({ content: 'Dr. Smith is here. Another sentence.', language: 'plaintext' });
            const sessionEditor = await vscode.window.showTextDocument(sessionDocument);
            sessionEditor.selection = new vscode.Selection(0, 0, 0, sessionDocument.getText().length);
            await vscode.commands.executeCommand('pronounciation.startSession');
            // Edits after loading must not change the immutable spoken snapshot.
            await sessionEditor.edit(edit => edit.replace(sessionEditor.selection, 'Edited document.'));
            const sessionStart = recordings.length;
            await vscode.commands.executeCommand('pronounciation.playSession');
            await vscode.commands.executeCommand('pronounciation.nextSentence');
            await vscode.commands.executeCommand('pronounciation.previousSentence');
            assert.deepEqual(recordings.slice(sessionStart).map(recording => recording.text), ['Dr. Smith is here.', 'Another sentence.', 'Dr. Smith is here.']);
            await vscode.commands.executeCommand('pronounciation.clearSession');
            await require('./practice').practice({ recordings, local: true });
            for (const recording of recordings) {
                const audio = await fs.readFile(recording.file);
                assert.equal(audio.subarray(0, 4).toString(), 'FORM');
                assert.ok(audio.length > 1000, 'Speech engine must generate audio frames');
            }
        }
        await vscode.commands.executeCommand('pronounciation.stop');
        // Exercise a real custom API request and native WAV playback without paid credentials.
        const apiTexts = [];
        server = http.createServer(async (request, response) => {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            assert.equal(body.response_format, 'wav');
            apiTexts.push(body.input);
            response.writeHead(200, { 'Content-Type': 'audio/wav' });
            response.end(wav(0.1));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const config = vscode.workspace.getConfiguration('pronounciation');
        const profile = { id: 'integration-api', name: 'Integration API', provider: 'custom', model: 'test-model', voice: 'test-voice', speed: 1,
            endpoint: `http://127.0.0.1:${server.address().port}/speech` };
        await config.update('tts.profiles', [profile], vscode.ConfigurationTarget.Global);
        await config.update('tts.activeProfile', profile.id, vscode.ConfigurationTarget.Global);
        const document = await vscode.workspace.openTextDocument({ content: 'Xin chào 😀 ' + 'word '.repeat(500), language: 'plaintext' });
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(0, 0, 0, document.getText().length);
        await vscode.commands.executeCommand('pronounciation.pronounce');
        assert.equal(apiTexts.join(''), document.getText().trim());
        assert.equal(apiTexts.length, 2);
        await vscode.commands.executeCommand('pronounciation.repeat');
        assert.equal(apiTexts.length, 2, 'Replay must reuse generated audio');
        await vscode.commands.executeCommand('pronounciation.clearReplay');
        await vscode.commands.executeCommand('pronounciation.pronounce');
        assert.equal(apiTexts.length, 4, 'Clearing replay must discard cached audio');
        const sessionText = 'Dr. Smith is here. Xin chào! 你好。こんにちは。';
        const sessionDocument = await vscode.workspace.openTextDocument({ content: sessionText, language: 'plaintext' });
        await vscode.window.showTextDocument(sessionDocument);
        await config.update('reading.mode', 'continuous', vscode.ConfigurationTarget.Global);
        await config.update('reading.locale', 'en', vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('pronounciation.startDocumentSession');
        const sessionStart = apiTexts.length;
        await vscode.commands.executeCommand('pronounciation.playSession');
        assert.deepEqual(apiTexts.slice(sessionStart), ['Dr. Smith is here.', 'Xin chào!', '你好。', 'こんにちは。']);
        await vscode.commands.executeCommand('pronounciation.playSession');
        assert.equal(apiTexts.length, sessionStart + 4, 'Session replay must reuse the final sentence audio');
        await vscode.commands.executeCommand('pronounciation.clearSession');
        const replayStart = apiTexts.length;
        await vscode.commands.executeCommand('pronounciation.repeat');
        assert.equal(apiTexts.slice(replayStart).join(''), document.getText().trim(), 'Sessions must preserve ordinary replay text');
        await require('./practice').practice({ apiTexts, local: false });
        await config.update('reading.mode', undefined, vscode.ConfigurationTarget.Global);
        await config.update('reading.locale', undefined, vscode.ConfigurationTarget.Global);
        await config.update('tts.activeProfile', 'local', vscode.ConfigurationTarget.Global);
        await config.update('tts.profiles', [], vscode.ConfigurationTarget.Global);
        process.stdout.write(`Extension-host reading sessions passed on VS Code ${vscode.version} (${process.platform}).\n`);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        childProcess.spawn = originalSpawn;
        await fs.rm(temp, { recursive: true, force: true });
    }
}

module.exports = { run };
