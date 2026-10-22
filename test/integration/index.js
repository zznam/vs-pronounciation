// Run by VS Code's Extension Development Host, not by node --test.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { wav } = require('../tts-helpers');

async function run() {
    const root = process.env.PRONUNCIATION_EXTENSION_ROOT || path.resolve(__dirname, '../..');
    const extension = vscode.extensions.all.find(item => item.extensionPath === root);
    assert.ok(extension, 'Development extension must be discoverable');
    const originalSpawn = childProcess.spawn;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pronunciation-audio-'));
    const recordings = [];
    const playedFiles = [];
    const documents = [];
    let server;
    try {
        // Exercise the real macOS engine silently by redirecting its audio to a temporary file.
        childProcess.spawn = (command, args, options) => {
            if (process.platform === 'darwin' && path.basename(command) === 'afplay') playedFiles.push(args[0]);
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
        process.stdout.write('Extension activated; checking registered commands and reading flows.\n');
        const commands = await vscode.commands.getCommands(true);
        for (const { command } of require(path.join(root, 'package.json')).contributes.commands) {
            assert.ok(commands.includes(command));
        }
        await vscode.commands.executeCommand('pronounciation.stop');
        assert.equal(vscode.workspace.getConfiguration('pronounciation').get('speed'), 1);
        if (process.platform === 'darwin') {
            const document = await vscode.workspace.openTextDocument({ content: 'Hello world.\nGoodbye world.', language: 'plaintext' });
            documents.push(document);
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
            documents.push(sessionDocument);
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
        process.stdout.write('Reading flows passed; checking custom API and practice playback.\n');
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
        await config.update('practiceGap', 0, vscode.ConfigurationTarget.Global);
        const document = await vscode.workspace.openTextDocument({ content: 'Xin chào 😀 ' + 'word '.repeat(500), language: 'plaintext' });
        documents.push(document);
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(0, 0, 0, document.getText().length);
        await vscode.commands.executeCommand('pronounciation.pronounce');
        assert.equal(apiTexts.join(''), document.getText().trim());
        assert.equal(apiTexts.length, 2);
        process.stdout.write('Custom API chunking passed; checking cached replay.\n');
        await vscode.commands.executeCommand('pronounciation.repeat');
        assert.equal(apiTexts.length, 2, 'Replay must reuse generated audio');
        process.stdout.write('Cached replay passed; checking the practice picker.\n');
        const playsBeforePractice = playedFiles.length;
        let practiced = false;
        const practice = Promise.resolve(vscode.commands.executeCommand('pronounciation.practice')).finally(() => { practiced = true; });
        void practice.catch(() => {});
        // Quick-input presentation crosses the renderer boundary; one fixed delay is racy on busy hosts.
        for (let attempt = 0; attempt < 50 && !practiced; attempt++) {
            await delay(200);
            if (!practiced) await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        }
        assert.ok(practiced, 'Practice picker and playback must finish within ten seconds');
        await practice;
        assert.equal(apiTexts.length, 2, 'Practice must reuse the same generated audio');
        if (process.platform === 'darwin') assert.equal(playedFiles.length - playsBeforePractice, 4, 'Two practice rounds must play both cached parts');
        await vscode.commands.executeCommand('pronounciation.clearReplay');
        await vscode.commands.executeCommand('pronounciation.pronounce');
        assert.equal(apiTexts.length, 4, 'Clearing replay must discard cached audio');
        const sessionText = 'Dr. Smith is here. Xin chào! 你好。こんにちは。';
        const sessionDocument = await vscode.workspace.openTextDocument({ content: sessionText, language: 'plaintext' });
        documents.push(sessionDocument);
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
        await vscode.commands.executeCommand('pronounciation.repeat');
        const cachedFile = playedFiles.at(-1);
        await config.update('tts.activeProfile', 'local', vscode.ConfigurationTarget.Global);
        if (cachedFile) {
            // Settings events are asynchronous; allow deletion to finish before checking the file.
            for (let attempt = 0; attempt < 100; attempt++) {
                try { await fs.access(cachedFile); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
                await delay(10);
            }
            await assert.rejects(fs.access(cachedFile), { code: 'ENOENT' });
        }
        await config.update('tts.profiles', [], vscode.ConfigurationTarget.Global);
        process.stdout.write(`Extension-host checks passed against ${root}: activation, reading, API chunking, cached replay, practice, and settings cleanup.\n`);
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        childProcess.spawn = originalSpawn;
        await fs.rm(temp, { recursive: true, force: true });
        // Discard only documents created by this isolated test to avoid shutdown save prompts.
        for (const document of documents) {
            if (document.isClosed) continue;
            await vscode.window.showTextDocument(document);
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        }
    }
}

module.exports = { run };
