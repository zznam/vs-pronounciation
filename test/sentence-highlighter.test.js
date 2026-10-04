const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSentenceHighlighter } = require('../src/sentence-highlighter');
const { createPassage } = require('../src/session-text');
const { ReadingSession } = require('../src/reading-session');
const { Playback } = require('../src/playback');
const { registerExtension } = require('../src/extension');
const { fakeVscode, fakeBackend, documentEditor, tick } = require('./helpers');

function editor(content = 'SQL works. Xin chào 😀! 你好。こんにちは。', uri = 'file:///source.txt') {
    const value = documentEditor(content);
    value.selection = { isEmpty: true, active: { line: 0, character: 3 } };
    value.document.uri = { toString: () => uri }; value.document.version = 4;
    value.decorated = []; value.revealed = [];
    value.setDecorations = (type, ranges) => value.decorated.push({ type, ranges });
    value.revealRange = (range, kind) => value.revealed.push({ range, kind });
    return value;
}
async function setup(t, text, offset = 0) {
    const h = fakeVscode(), backend = fakeBackend();
    const source = editor(text);
    h.vscode.window.visibleTextEditors = [source]; h.vscode.window.activeTextEditor = source;
    const session = new ReadingSession(new Playback(backend, () => {}, () => {}), () => ({}));
    const highlighter = createSentenceHighlighter(h.vscode, session);
    const load = () => session.load(createPassage(source.document.getText().slice(offset), h.config, 'en', {
        uri: source.document.uri, version: source.document.version, offset
    }), 'manual');
    await load();
    t.after(async () => { highlighter.dispose(); await session.dispose(); });
    return { ...h, backend, source, session, highlighter, load };
}
function rangeText(editor) { return editor.decorated.at(-1).ranges.map(range => editor.document.getText(range)); }

test('highlight uses original UTF-16 source ranges through replacements, emoji, combining marks, and paragraph offsets', async t => {
    const text = 'Skip.\r\n\r\n  SQL works. Xin cha\u0300o 😀! 你好。こんにちは。';
    const h = await setup(t, text, 9);
    const selection = h.source.selection;
    h.settings.replacements = { SQL: 'structured query language' }; await h.load();
    assert.equal(h.session.state.passage.sentences[0].text, 'structured query language works.');
    const expected = ['SQL works.', 'Xin cha\u0300o 😀!', '你好。', 'こんにちは。'];
    for (let index = 0; index < expected.length; index++) {
        await h.session.select(index);
        assert.deepEqual(rangeText(h.source), [expected[index]]);
        assert.ok(h.source.decorated.at(-1).ranges[0] instanceof h.vscode.Range);
    }
    assert.equal(h.source.selection, selection); assert.equal(h.source.revealed.length, 0);
    assert.equal(h.backend.calls.length, 0); assert.equal(h.session.state.sourceValid, true);
    assert.equal(h.decorations[0].options.backgroundColor.id, 'editor.findMatchHighlightBackground');
    assert.equal(h.decorations[0].options.borderColor.id, 'editor.findMatchHighlightBorder');
    assert.equal(h.decorations[0].options.rangeBehavior, h.vscode.DecorationRangeBehavior.ClosedClosed);
});

test('highlight survives Stop, follows current position, and clears when the session is cleared', async t => {
    const h = await setup(t);
    const run = h.session.move(1); await tick();
    assert.deepEqual(rangeText(h.source), ['Xin chào 😀!']);
    await h.session.stop(); await run;
    assert.deepEqual(rangeText(h.source), ['Xin chào 😀!']); assert.equal(h.source.revealed.length, 0);
    await h.session.clear(); assert.deepEqual(rangeText(h.source), []);
    assert.equal(h.session.state.sourceValid, false); assert.equal(h.session.state.following, false);
});

test('edits permanently invalidate this snapshot while captured speech continues; reloading captures a new source version', async t => {
    const h = await setup(t); h.settings['reading.autoFollow'] = true;
    const run = h.session.play(); await tick();
    assert.equal(h.source.revealed.length, 1);
    h.source.document.version++;
    h.events.emit('change', { document: h.source.document, contentChanges: [{ text: 'changed' }] });
    assert.deepEqual(rangeText(h.source), []); assert.equal(h.session.state.sourceValid, false);
    assert.equal(h.session.state.following, false); assert.equal(h.session.state.phase, 'playing');
    assert.equal(h.backend.calls[0].stops, 0);
    h.source.document.version--; // Undo/reopen with a matching version must not revive an invalid snapshot.
    h.events.emit('visible'); assert.deepEqual(rangeText(h.source), []);
    h.backend.calls[0].finish(); await run;
    await h.load(); assert.equal(h.session.state.sourceValid, true); assert.deepEqual(rangeText(h.source), ['SQL works.']);
    const again = h.session.play(); await tick(); assert.equal(h.source.revealed.length, 2);
    await h.session.stop(); await again;
});

test('unrelated and metadata-only events keep decorations; closing the source invalidates even after reopening', async t => {
    const h = await setup(t); const other = editor('Other.', 'file:///other.txt');
    h.events.emit('change', { document: other.document, contentChanges: [{ text: 'new' }] });
    h.events.emit('close', other.document);
    h.events.emit('change', { document: h.source.document, contentChanges: [] });
    assert.equal(h.session.state.sourceValid, true);
    h.events.emit('close', h.source.document);
    assert.deepEqual(rangeText(h.source), []); assert.equal(h.session.state.sourceValid, false);
    h.events.emit('visible'); assert.deepEqual(rangeText(h.source), []);
    await h.load(); assert.deepEqual(rangeText(h.source), ['SQL works.']);
    h.source.document.version++;
    h.events.emit('visible'); assert.equal(h.session.state.sourceValid, false);
});

test('follow is opt-in, only scrolls visible source editors, preserves focus and selection, and avoids repeated phase scrolling', async t => {
    const h = await setup(t);
    const other = editor('Other.', 'file:///other.txt');
    h.vscode.window.activeTextEditor = other;
    const run = h.session.play(); await tick(); assert.equal(h.source.revealed.length, 0);
    await h.highlighter.commands.toggleReadingFollow();
    assert.deepEqual(h.updates, [{ key: 'reading.autoFollow', value: true, target: h.vscode.ConfigurationTarget.Global }]);
    assert.equal(h.source.revealed.length, 1);
    assert.equal(h.source.revealed[0].kind, h.vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    assert.equal(h.vscode.window.activeTextEditor, other);
    h.session.update({ phase: 'generating' }); h.session.update({ phase: 'playing' }); h.session.update({ phase: 'gap' });
    assert.equal(h.source.revealed.length, 1);
    h.vscode.window.visibleTextEditors = [other]; h.events.emit('visible');
    assert.deepEqual(rangeText(h.source), []); assert.equal(other.revealed.length, 0);
    h.vscode.window.visibleTextEditors = [h.source, other]; h.events.emit('visible');
    assert.equal(h.source.revealed.length, 2);
    await h.session.stop(); await run;
    await h.session.select(1); assert.equal(h.source.revealed.length, 2, 'Silent selection does not scroll');
    const next = h.session.play(); await tick(); assert.equal(h.source.revealed.length, 3);
    await h.highlighter.commands.toggleReadingFollow();
    assert.equal(h.session.state.following, false);
    await h.session.stop(); await next;
});

test('all visible copies decorate, but following chooses the active source editor; preferences remain independent', async t => {
    const h = await setup(t), split = editor();
    h.vscode.window.visibleTextEditors.push(split); h.vscode.window.activeTextEditor = split;
    h.events.emit('visible'); assert.deepEqual(rangeText(split), ['SQL works.']);
    await h.config.update('reading.autoFollow', true);
    await h.config.update('reading.highlightSentence', false);
    assert.deepEqual(rangeText(h.source), []); assert.deepEqual(rangeText(split), []);
    const run = h.session.play(); await tick();
    assert.equal(split.revealed.length, 1); assert.equal(h.source.revealed.length, 0);
    await h.config.update('reading.highlightSentence', true);
    assert.deepEqual(rangeText(split), ['SQL works.']);
    const count = split.decorated.length;
    h.events.emit('configuration', { affectsConfiguration: () => false });
    assert.equal(split.decorated.length, count);
    await h.session.stop(); await run;
});

test('typed/clipboard passages never decorate, and source edits without visible editors still invalidate following', async t => {
    const h = await setup(t);
    h.vscode.window.visibleTextEditors = []; h.events.emit('visible');
    h.events.emit('change', { document: h.source.document, contentChanges: [{ text: 'edit' }] });
    h.vscode.window.visibleTextEditors = [h.source]; h.events.emit('visible');
    assert.deepEqual(rangeText(h.source), []);
    await h.session.load(createPassage('Typed. Text.', h.config, 'en'), 'manual');
    await h.config.update('reading.autoFollow', true);
    const run = h.session.play(); await tick();
    assert.equal(h.session.state.sourceValid, false); assert.equal(h.session.state.following, false);
    assert.deepEqual(rangeText(h.source), []); assert.equal(h.source.revealed.length, 0);
    await h.session.stop(); await run;
});

test('disposal clears decorations and listeners, tolerates closed editors, and ignores late actions', async t => {
    const h = await setup(t);
    assert.equal(h.events.listenerCount('visible'), 1);
    h.source.setDecorations = () => { throw new Error('Editor closed'); };
    h.highlighter.dispose(); h.highlighter.dispose();
    assert.equal(h.events.eventNames().length, 0); assert.equal(h.decorations[0].disposed, true);
    await h.highlighter.commands.toggleReadingFollow(); assert.deepEqual(h.updates, []);
    await h.session.select(1);
});

test('the contributed toggle updates only auto-follow and deactivation removes its decoration', async () => {
    const h = fakeVscode(); const extension = registerExtension(h.vscode, { subscriptions: [] }, fakeBackend(), async () => []);
    await h.handlers.get('pronounciation.toggleReadingFollow')();
    assert.equal(h.settings['reading.autoFollow'], true);
    assert.equal(h.updates.length, 1);
    await extension.dispose();
    assert.equal(h.decorations[0].disposed, true); assert.equal(h.events.eventNames().length, 0);
});
