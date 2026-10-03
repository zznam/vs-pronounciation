const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readingLocale, readingMode, splitSentences, createPassage, editorPassage } = require('../src/session-text');
const { documentEditor } = require('./helpers');

const config = (values = {}) => ({ get: (key, fallback) => values[key] ?? fallback });

for (const [locale, text, expected] of [
    ['en', 'Dr. Smith paid 3.14 dollars. J. R. R. Tolkien wrote books. "Ready?" Yes!', ['Dr. Smith paid 3.14 dollars.', 'J. R. R. Tolkien wrote books.', '"Ready?"', 'Yes!']],
    ['vi', 'TS. Nguyễn nói: “Xin chào!” Bạn khỏe không? Tôi khỏe.', ['TS. Nguyễn nói: “Xin chào!”', 'Bạn khỏe không?', 'Tôi khỏe.']],
    ['zh', '你好。我们来练习发音！你准备好了吗？', ['你好。', '我们来练习发音！', '你准备好了吗？']],
    ['ja', 'こんにちは。発音を練習しましょう！準備はいいですか？', ['こんにちは。', '発音を練習しましょう！', '準備はいいですか？']]
]) {
    test(`sentence boundaries and exact source offsets for ${locale}`, () => {
        const sentences = splitSentences(text, locale);
        assert.deepEqual(sentences.map(sentence => sentence.original), expected);
        for (const sentence of sentences) assert.equal(text.slice(sentence.start, sentence.end), sentence.original);
    });
}

test('whitespace, blank paragraphs, CRLF, combining marks, and emoji preserve UTF-16 offsets', () => {
    const text = '  Dr.\r\n \r\nSmith is here.\r\n\r\nCafe\u0301 👨‍👩‍👧‍👦!\n\n\n你好。  ';
    const sentences = splitSentences(text, 'en');
    assert.deepEqual(sentences.map(sentence => sentence.original), ['Dr.', 'Smith is here.', 'Cafe\u0301 👨‍👩‍👧‍👦!', '你好。']);
    for (const sentence of sentences) assert.equal(text.slice(sentence.start, sentence.end), sentence.original);
    assert.deepEqual(splitSentences('One without punctuation\n\nAnother paragraph', 'en').map(s => s.original), ['One without punctuation', 'Another paragraph']);
    assert.deepEqual(splitSentences('One\r\rTwo', 'en').map(s => s.original), ['One', 'Two']);
    assert.deepEqual(splitSentences('  \n\n  ', 'en'), []);
});

test('title handling keeps normal sentence endings, quoted endings, and the pronoun I separate', () => {
    assert.deepEqual(splitSentences('I. Another sentence. "Dr." Smith left.', 'en').map(s => s.original), ['I.', 'Another sentence.', '"Dr."', 'Smith left.']);
    assert.deepEqual(splitSentences('Prof. Nguyễn met Mr. Smith. Goodbye.', 'en').map(s => s.original), ['Prof. Nguyễn met Mr. Smith.', 'Goodbye.']);
});

test('locale defaults to the interface language, accepts canonical tags, and rejects invalid or unsupported values', () => {
    assert.equal(readingLocale(), 'en');
    assert.equal(readingLocale('auto', 'vi'), 'vi');
    assert.equal(readingLocale('zh-cn'), 'zh-CN');
    for (const value of ['', 'en_US', 'xx', 3, null]) assert.throws(() => readingLocale(value), /Reading locale/);
    assert.equal(readingMode('manual'), 'manual');
    assert.equal(readingMode('continuous'), 'continuous');
    assert.throws(() => readingMode('loop'), /Reading mode/);
});

test('passages prepare sentences once while retaining frozen original text and source ranges', () => {
    const values = { replacements: { SQL: 'sequel. Listen', sequel: 'wrong' }, speakCodeIdentifiers: true, normalizeWhitespace: true };
    const source = { uri: 'file:///test.txt', version: 4, offset: 11 };
    const text = '  SQL works. GetHTTPResponse is ready.  ';
    const passage = createPassage(text, config(values), 'en', source);
    values.replacements.SQL = 'changed'; source.offset = 99;
    assert.equal(passage.original, text);
    assert.equal(passage.source.offset, 11);
    assert.deepEqual(passage.sentences.map(s => s.text), ['sequel. Listen works.', 'Get HTTP Response is ready.']);
    assert.equal(text.slice(passage.sentences[0].start, passage.sentences[0].end), 'SQL works.');
    for (const value of [passage, passage.source, passage.sentences, ...passage.sentences]) assert.ok(Object.isFrozen(value));
    assert.equal(createPassage('hello', config(), 'vi').locale, 'vi');
    assert.equal(createPassage('hello', config({ 'reading.locale': 'ja' }), 'en').locale, 'ja');
});

test('limits cover raw input, each transformed sentence, and aggregate transformed text', () => {
    assert.throws(() => createPassage('longer', config({ maxTextLength: 5 }), 'en'), /up to 5/);
    assert.throws(() => createPassage('x', config({ maxTextLength: 5, replacements: { x: 'longer' } }), 'en'), /Prepared text exceeds/);
    assert.throws(() => createPassage('x. X.', config({ maxTextLength: 7, replacements: { x: 'four', X: 'four' } }), 'en'), /Prepared text exceeds/);
    assert.throws(() => createPassage('hello', config({ maxTextLength: 0 }), 'en'), /Maximum passage length/);
    assert.throws(() => createPassage(' \n\n ', config(), 'en'), /nonempty paragraph/);
    assert.throws(() => createPassage('remove', config({ replacements: { remove: '' } }), 'en'), /nonempty paragraph/);
    const passage = createPassage('remove\n\nHello.', config({ replacements: { remove: '' } }), 'en');
    assert.deepEqual(passage.sentences.map(s => s.original), ['Hello.']);
});

test('editor source extraction handles selection, paragraphs, blank lines, and explicit whole documents', () => {
    const editor = documentEditor('First line\nSecond line\n\nLast paragraph', 1);
    editor.document.uri = 'file:///document.txt'; editor.document.version = 6;
    editor.selection.isEmpty = true;
    const range = (start, end) => ({ start, end });
    const input = editorPassage(editor, false, range);
    assert.equal(input.text, 'First line\nSecond line');
    assert.deepEqual(input.source, { uri: editor.document.uri, version: 6, offset: 0 });
    editor.selection.active.line = 3;
    assert.equal(editorPassage(editor, false, range).source.offset, 24);
    assert.equal(editorPassage(editor, false, range).text, 'Last paragraph');
    editor.selection.active.line = 2;
    assert.equal(editorPassage(editor, false, range).text, '');
    editor.selection = { isEmpty: false, start: { line: 1, character: 7 }, end: { line: 1, character: 11 } };
    assert.equal(editorPassage(editor, false, range).text, 'line');
    assert.equal(editorPassage(editor, false, range).source.offset, 18);
    assert.equal(editorPassage(editor, true, range).text, 'First line\nSecond line\n\nLast paragraph');
});
