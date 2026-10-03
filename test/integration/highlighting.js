const assert = require('node:assert/strict');
const vscode = require('vscode');
const { setTimeout: delay } = require('node:timers/promises');
const { ReadingSession } = require('../../src/reading-session');
const { Playback } = require('../../src/playback');
const { createPassage } = require('../../src/session-text');
const { createSentenceHighlighter } = require('../../src/sentence-highlighter');
const { fakeBackend } = require('../helpers');

async function until(check) {
    for (let retry = 0; retry < 100; retry++) {
        if (check()) return;
        await delay(20);
    }
    assert.fail('Editor event was not delivered');
}
async function highlighting() {
    const document = await vscode.workspace.openTextDocument({ content: 'Skip.\n\nSQL works. Xin cha\u0300o 😀! 你好。こんにちは。' });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(2, 3, 2, 3);
    const selection = editor.selection;
    const decorated = [], revealed = [], wrappers = new Map();
    const wrap = value => {
        if (!value) return value;
        if (!wrappers.has(value)) wrappers.set(value, {
            document: value.document,
            setDecorations(type, ranges) { decorated.push({ editor: value, ranges }); value.setDecorations(type, ranges); },
            revealRange(range, kind) { revealed.push({ editor: value, range }); value.revealRange(range, kind); }
        });
        return wrappers.get(value);
    };
    const host = {
        Range: vscode.Range, ThemeColor: vscode.ThemeColor,
        DecorationRangeBehavior: vscode.DecorationRangeBehavior, TextEditorRevealType: vscode.TextEditorRevealType,
        ConfigurationTarget: vscode.ConfigurationTarget, workspace: vscode.workspace, commands: vscode.commands,
        window: {
            createTextEditorDecorationType: vscode.window.createTextEditorDecorationType,
            onDidChangeVisibleTextEditors: vscode.window.onDidChangeVisibleTextEditors,
            get activeTextEditor() { return wrap(vscode.window.activeTextEditor); },
            get visibleTextEditors() { return vscode.window.visibleTextEditors.map(wrap); }
        }
    };
    const backend = fakeBackend();
    const session = new ReadingSession(new Playback(backend, () => {}, error => { throw error; }), () => ({}));
    const highlighter = createSentenceHighlighter(host, session);
    const config = vscode.workspace.getConfiguration('pronounciation');
    const load = () => session.load(createPassage(document.getText().slice(7), config, 'en', { uri: document.uri, version: document.version, offset: 7 }), 'manual');
    try {
        await load();
        assert.equal(document.getText(decorated.at(-1).ranges[0]), 'SQL works.');
        assert.ok(editor.selection.isEqual(selection));
        await session.select(1);
        assert.equal(document.getText(decorated.at(-1).ranges[0]), 'Xin cha\u0300o 😀!');
        assert.equal(revealed.length, 0);
        const run = session.play(); await until(() => backend.calls.length === 1);
        assert.equal(revealed.length, 0);
        await highlighter.commands.toggleReadingFollow();
        await until(() => revealed.length === 1);
        assert.ok(editor.selection.isEqual(selection));
        assert.equal(vscode.window.activeTextEditor, editor);
        await editor.edit(edit => edit.insert(new vscode.Position(2, 0), 'Edited. '));
        await until(() => session.state.sourceValid === false);
        assert.deepEqual(decorated.at(-1).ranges, []);
        assert.equal(session.state.phase, 'playing');
        assert.equal(backend.calls[0].text, 'Xin cha\u0300o 😀!');
        await session.stop(); await run;
        await load(); assert.equal(session.state.sourceValid, true);
        // Discard the dirty test document without involving a user confirmation dialog.
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await until(() => session.state.sourceValid === false);
        assert.equal(session.state.following, false);
        assert.deepEqual(decorated.at(-1).ranges, []);
    } finally {
        highlighter.dispose(); await session.dispose();
        await config.update('reading.autoFollow', undefined, vscode.ConfigurationTarget.Global);
    }
    process.stdout.write(`Source decoration and follow tests passed on VS Code ${vscode.version}.\n`);
}
module.exports = { highlighting };
