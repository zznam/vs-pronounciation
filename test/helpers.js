const { EventEmitter } = require('node:events');

const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fakeBackend({ autoStop = true } = {}) {
    const calls = [];
    return {
        calls,
        speak(text, options) {
            const result = deferred();
            const call = {
                text, options, done: result.promise, stops: 0,
                finish: result.resolve, fail: result.reject,
                async stop() {
                    call.stops++;
                    if (autoStop) result.resolve();
                    await result.promise.catch(() => {});
                }
            };
            calls.push(call);
            return call;
        }
    };
}

function fakeChild() {
    const child = new EventEmitter();
    child.pid = 321;
    child.stdin = new EventEmitter();
    child.stdin.end = (input, encoding) => { child.input = input; child.encoding = encoding; };
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.kills = [];
    child.kill = signal => {
        child.kills.push(signal);
        setImmediate(() => child.emit('close', null, signal));
        return true;
    };
    return child;
}

function fakeEditor(text, { empty = false, word = 'cursor-word' } = {}) {
    const selection = { isEmpty: empty, active: { line: 0, character: 2 } };
    const range = word === undefined || word === null ? undefined : { word };
    const reads = [];
    return {
        selection, reads,
        document: {
            getText(requestedRange) {
                reads.push(requestedRange);
                if (!requestedRange) throw new Error('Must never read the full document accidentally');
                return requestedRange === selection ? text : word;
            },
            getWordRangeAtPosition: () => range
        }
    };
}

function documentEditor(content, line = 0) {
    const lines = content.split('\n');
    const offsetAt = position => lines.slice(0, position.line).reduce((total, text) => total + text.length + 1, 0) + position.character;
    const positionAt = offset => {
        let index = 0;
        while (index < lines.length - 1 && offset > lines[index].length) offset -= lines[index++].length + 1;
        return { line: index, character: offset };
    };
    return {
        selection: { active: { line } }, selections: [],
        document: {
            lineCount: lines.length, lineAt: index => ({ text: lines[index] }), offsetAt, positionAt,
            getText: range => range ? content.slice(offsetAt(range.start), offsetAt(range.end)) : content
        }
    };
}

function fakeVscode() {
    const handlers = new Map();
    const info = [], errors = [], updates = [], contexts = [];
    const settings = {};
    const status = {
        visible: false, disposed: 0,
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() { this.disposed++; this.visible = false; }
    };
    const config = {
        get: (key, fallback) => settings[key] ?? fallback,
        async update(key, value, target) { settings[key] = value; updates.push({ key, value, target }); }
    };
    const vscode = {
        Range: class { constructor(start, end) { this.start = start; this.end = end; } },
        StatusBarAlignment: { Right: 2 }, ConfigurationTarget: { Global: 1 },
        commands: {
            registerCommand(name, handler) {
                handlers.set(name, handler);
                return { dispose: () => handlers.delete(name) };
            },
            async executeCommand(...args) { contexts.push(args); }
        },
        window: {
            activeTextEditor: undefined,
            createStatusBarItem: () => status,
            showInformationMessage: message => { info.push(message); },
            showErrorMessage: message => { errors.push(message); },
            showInputBox: async () => undefined,
            showQuickPick: async () => undefined
        },
        env: { clipboard: { readText: async () => '' } },
        workspace: { getConfiguration: () => config }
    };
    return { vscode, handlers, info, errors, updates, contexts, settings, status, config };
}

module.exports = { tick, deferred, fakeBackend, fakeChild, fakeEditor, fakeVscode, documentEditor };
