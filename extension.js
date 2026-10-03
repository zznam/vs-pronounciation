const { registerExtension } = require('./src/extension');
const { createSpeechBackend } = require('./src/speech-backend');

let extension;

function activate(context) {
    extension = registerExtension(require('vscode'), context, createSpeechBackend());
}

function deactivate() {
    return extension?.dispose();
}

module.exports = { activate, deactivate };
