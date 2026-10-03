const { prepareText, textLimit } = require('./text');

function readingLocale(value = 'auto', language = 'en') {
    try {
        if (typeof value !== 'string' || !value.trim()) throw new Error();
        const locale = Intl.getCanonicalLocales(value === 'auto' ? language : value)[0];
        if (!locale || !Intl.Segmenter.supportedLocalesOf([locale]).length) throw new Error();
        return locale;
    } catch {
        throw new Error('Reading locale must be auto or a supported language tag such as en, vi, zh, or ja.');
    }
}

function readingMode(value) {
    if (value !== 'manual' && value !== 'continuous') throw new Error('Reading mode must be manual or continuous.');
    return value;
}

function splitSentences(text, locale) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    const sentences = [];
    const paragraphEnds = [...text.matchAll(/\r?\n[ \t]*\r?\n|\r[ \t]*\r(?!\n)/g)].map(match => match.index + match[0].length);
    paragraphEnds.push(text.length);
    let start = 0;
    for (const end of paragraphEnds) {
        let previous;
        for (const { segment, index } of segmenter.segment(text.slice(start, end))) {
            const original = segment.trim();
            if (!original) continue;
            const offset = start + index + segment.length - segment.trimStart().length;
            // ICU splits titles such as "Dr. Smith". Tailor common English/Vietnamese
            // titles and Latin initials, but never join across a paragraph boundary.
            const title = previous && /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|TS|ThS|GS|PGS)\.$/iu.test(previous.original);
            const initial = previous && /(?:^|\s)[A-HJ-Z]\.$/u.test(previous.original) && /^\p{Lu}/u.test(original);
            if (previous && /^\p{L}/u.test(original) && (title || initial)) {
                previous.end = offset + original.length;
                previous.original = text.slice(previous.start, previous.end);
            } else {
                previous = { original, start: offset, end: offset + original.length };
                sentences.push(previous);
            }
        }
        start = end;
    }
    return sentences;
}

function createPassage(text, config, language, source) {
    const limit = textLimit(config);
    if (text.length > limit) throw new Error(`Select a shorter passage (up to ${limit.toLocaleString('en-US')} characters).`);
    const locale = readingLocale(config.get('reading.locale', 'auto'), language);
    const sentences = splitSentences(text, locale).map(sentence => ({ ...sentence, text: prepareText(sentence.original, config) })).filter(sentence => sentence.text);
    if (!sentences.length) throw new Error('Select text or place the cursor in a nonempty paragraph to start a reading session.');
    // Count the complete prepared passage, including separators, rather than granting
    // every individual sentence its own full passage allowance.
    if (sentences.map(sentence => sentence.text).join('\n').length > limit) {
        throw new Error(`Prepared text exceeds the ${limit.toLocaleString('en-US')} character limit. Shorten the passage or replacements.`);
    }
    return Object.freeze({
        original: text, locale,
        source: source ? Object.freeze({ ...source }) : undefined,
        sentences: Object.freeze(sentences.map(sentence => Object.freeze(sentence)))
    });
}

function editorPassage(editor, wholeDocument, makeRange) {
    const { document, selection } = editor;
    let offset = 0;
    let text;
    if (wholeDocument) text = document.getText();
    else if (!selection.isEmpty) {
        offset = document.offsetAt(selection.start);
        text = document.getText(selection);
    } else {
        let start = selection.active.line;
        let end = start;
        if (document.lineAt(start).text.trim()) {
            while (start > 0 && document.lineAt(start - 1).text.trim()) start--;
            while (end + 1 < document.lineCount && document.lineAt(end + 1).text.trim()) end++;
        }
        const range = makeRange({ line: start, character: 0 }, { line: end, character: document.lineAt(end).text.length });
        offset = document.offsetAt(range.start);
        text = document.getText(range);
    }
    return { text, source: { uri: document.uri, version: document.version, offset } };
}

module.exports = { readingLocale, readingMode, splitSentences, createPassage, editorPassage };
