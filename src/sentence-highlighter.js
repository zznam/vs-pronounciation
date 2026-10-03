function createSentenceHighlighter(vscode, session) {
    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
        border: '1px solid',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    let passage, invalid = false, disposed = false, refreshing = false, followed;
    let decorated = new Set();
    const uri = value => value?.toString();
    const matches = document => passage?.source && uri(document.uri) === uri(passage.source.uri);
    const clearEditor = editor => {
        // A document/editor can disappear between the visibility event and cleanup.
        try { editor.setDecorations(decoration, []); } catch { /* Closed editor. */ }
    };

    function refresh() {
        if (disposed || refreshing) return;
        refreshing = true;
        try {
            const state = session.state;
            if (passage !== state.passage) { passage = state.passage; invalid = false; followed = undefined; }
            const visible = vscode.window.visibleTextEditors;
            const editors = visible.filter(editor => matches(editor.document));
            if (editors.some(editor => editor.document.version !== passage.source.version)) invalid = true;
            const config = vscode.workspace.getConfiguration('pronounciation', passage?.source?.uri);
            const autoFollow = config.get('reading.autoFollow', false);
            const sourceValid = Boolean(passage?.source && !invalid);
            const following = autoFollow && sourceValid;
            const highlight = sourceValid && config.get('reading.highlightSentence', true);
            const next = new Set(highlight ? editors : []);
            for (const editor of decorated) if (!next.has(editor)) clearEditor(editor);
            decorated = next;
            const sentence = passage?.sentences[state.index];
            const rangeFor = editor => new vscode.Range(
                editor.document.positionAt(passage.source.offset + sentence.start),
                editor.document.positionAt(passage.source.offset + sentence.end)
            );
            for (const editor of decorated) editor.setDecorations(decoration, [rangeFor(editor)]);
            if (following && ['generating', 'playing', 'gap'].includes(state.phase) && editors.length) {
                const editor = editors.includes(vscode.window.activeTextEditor) ? vscode.window.activeTextEditor : editors[0];
                if (!followed || followed.editor !== editor || followed.index !== state.index) {
                    editor.revealRange(rangeFor(editor), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                    followed = { editor, index: state.index };
                }
            } else followed = undefined;
            if (state.sourceValid !== sourceValid || state.autoFollow !== autoFollow || state.following !== following) {
                session.update({ sourceValid, autoFollow, following });
            }
            void vscode.commands.executeCommand('setContext', 'pronounciation.readingFollow', autoFollow);
            void vscode.commands.executeCommand('setContext', 'pronounciation.readingSourceValid', sourceValid);
        } finally { refreshing = false; }
    }

    const subscriptions = [
        session.subscribe(refresh),
        vscode.window.onDidChangeVisibleTextEditors(refresh),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (matches(event.document) && (event.contentChanges.length || event.document.version !== passage.source.version)) {
                invalid = true; refresh();
            }
        }),
        vscode.workspace.onDidCloseTextDocument(document => { if (matches(document)) { invalid = true; refresh(); } }),
        vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('pronounciation.reading')) refresh(); })
    ];
    refresh();
    return {
        commands: {
            async toggleReadingFollow() {
                if (disposed) return;
                const config = vscode.workspace.getConfiguration('pronounciation');
                await config.update('reading.autoFollow', !config.get('reading.autoFollow', false), vscode.ConfigurationTarget.Global);
                refresh();
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const subscription of subscriptions) subscription.dispose();
            for (const editor of decorated) clearEditor(editor);
            decorated.clear();
            decoration.dispose();
            void vscode.commands.executeCommand('setContext', 'pronounciation.readingSourceValid', false);
        }
    };
}
module.exports = { createSentenceHighlighter };
