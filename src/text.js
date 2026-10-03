const MAX_TEXT_LENGTH = 50000;

function textLimit(config) {
    const limit = config.get('maxTextLength', MAX_TEXT_LENGTH);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TEXT_LENGTH) {
        throw new Error('Maximum passage length must be an integer between 1 and 50,000.');
    }
    return limit;
}

function prepareText(text, config) {
    const limit = textLimit(config);
    if (text.length > limit) throw new Error(`Select a shorter passage (up to ${limit.toLocaleString('en-US')} characters).`);
    let result = text.trim();
    const replacements = config.get('replacements', {});
    // Match whole Unicode words. Replacement values are literal data, never regular expressions.
    result = result.replace(/[\p{L}\p{N}_]+/gu, word =>
        Object.hasOwn(replacements, word) && typeof replacements[word] === 'string' ? replacements[word] : word);
    if (config.get('speakCodeIdentifiers', false)) {
        // Leave URLs, paths, email addresses, dotted names, and non-Latin words intact.
        result = result.replace(/(?<![\p{L}\p{N}_./:@-])[A-Za-z][A-Za-z0-9_]*(?![\p{L}\p{N}_./:@-])/gu,
            word => word.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' '));
    }
    if (config.get('normalizeWhitespace', false)) result = result.replace(/\s+/gu, ' ');
    result = result.trim();
    if (result.length > limit) throw new Error(`Prepared text exceeds the ${limit.toLocaleString('en-US')} character limit. Shorten the passage or replacements.`);
    return result;
}

function getLine(editor) {
    return editor.document.lineAt(editor.selection.active.line).text;
}

function getParagraph(editor) {
    const { document } = editor;
    let start = editor.selection.active.line;
    let end = start;
    if (!document.lineAt(start).text.trim()) return '';
    while (start > 0 && document.lineAt(start - 1).text.trim()) start--;
    while (end + 1 < document.lineCount && document.lineAt(end + 1).text.trim()) end++;
    const lines = [];
    for (let line = start; line <= end; line++) lines.push(document.lineAt(line).text);
    return lines.join('\n');
}

function getSelections(editor, makeRange) {
    const { document } = editor;
    const ranges = editor.selections.filter(selection => !selection.isEmpty).map(selection => ({
        start: document.offsetAt(selection.start), end: document.offsetAt(selection.end)
    })).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of ranges) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
    }
    return merged.map(range => document.getText(makeRange(document.positionAt(range.start), document.positionAt(range.end))).trim())
        .filter(Boolean).join('\n');
}

module.exports = { MAX_TEXT_LENGTH, textLimit, prepareText, getLine, getParagraph, getSelections };
