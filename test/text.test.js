const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareText, textLimit, getLine, getParagraph, getSelections } = require('../src/text');
const { fakeVscode, documentEditor } = require('./helpers');

test('line and paragraph reading honor blank-line boundaries and EOF', () => {
    const editor = documentEditor('first\nsecond\n  \nXin chào\nこんにちは', 1);
    assert.equal(getLine(editor), 'second');
    assert.equal(getParagraph(editor), 'first\nsecond');
    editor.selection.active.line = 2;
    assert.equal(getParagraph(editor), '');
    editor.selection.active.line = 4;
    assert.equal(getParagraph(editor), 'Xin chào\nこんにちは');
});

test('multi-selection sorts in document order, merges overlaps, and skips empty selections', () => {
    const editor = documentEditor('alpha beta gamma');
    const range = (start, end, isEmpty = false) => ({ start: editor.document.positionAt(start), end: editor.document.positionAt(end), isEmpty });
    editor.selections = [range(11, 16), range(0, 5), range(1, 5), range(8, 8, true), range(5, 6)];
    const makeRange = (start, end) => ({ start, end });
    assert.equal(getSelections(editor, makeRange), 'alpha\ngamma');
    editor.selections = [range(5, 6)];
    assert.equal(getSelections(editor, makeRange), '');
});

test('preparation defaults preserve prose, punctuation, Unicode, and line breaks', () => {
    const h = fakeVscode();
    assert.equal(prepareText('  Xin chào!\nこんにちは getHTTPResponse  ', h.config), 'Xin chào!\nこんにちは getHTTPResponse');
    h.settings.normalizeWhitespace = true;
    assert.equal(prepareText('a\n\t b  c', h.config), 'a b c');
});

test('identifier reading splits acronyms, camelCase, and underscores without changing links', () => {
    const h = fakeVscode();
    h.settings.speakCodeIdentifiers = true;
    assert.equal(prepareText('getHTTPResponse user_id HTTPServer foo2Bar https://getHTTPResponse.test/foo_bar a@fooBar.test /fooBar.js xinChào', h.config),
        'get HTTP Response user id HTTP Server foo2 Bar https://getHTTPResponse.test/foo_bar a@fooBar.test /fooBar.js xinChào');
});

test('dictionary replacements are literal, whole-word, case-sensitive, Unicode, and applied once', () => {
    const h = fakeVscode();
    h.settings.replacements = { SQL: 'sequel', sequel: 'wrong', chào: 'hello', bad: 5, remove: '' };
    assert.equal(prepareText('SQL SQLish sql chào! bad remove $SQL', h.config), 'sequel SQLish sql hello! bad  $sequel');
    h.settings.replacements = { SQL: '$1' };
    assert.equal(prepareText('SQL', h.config), '$1');
});

test('input and replacement expansion limits prevent long speech without truncating content', () => {
    const h = fakeVscode();
    assert.equal(textLimit(h.config), 50000);
    for (const limit of [0, 50001, 1.5, '20']) {
        h.settings.maxTextLength = limit;
        assert.throws(() => textLimit(h.config), /integer between/);
    }
    h.settings.maxTextLength = 5;
    assert.equal(prepareText('12345', h.config), '12345');
    assert.throws(() => prepareText('123456', h.config), /up to 5/);
    h.settings.replacements = { x: 'longer' };
    assert.throws(() => prepareText('x', h.config), /Prepared text exceeds/);
});

test('combining marks stay attached to words during replacement and identifier preparation', () => {
    const h = fakeVscode();
    h.settings.replacements = { cafe: 'wrong', 'cafe\u0301': 'coffee' };
    h.settings.speakCodeIdentifiers = true;
    assert.equal(prepareText('cafe\u0301 cafe\u0301s xinCha\u0300o', h.config), 'coffee cafe\u0301s xinCha\u0300o');
});
