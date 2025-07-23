const vscode = require('vscode');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const say = require('say');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    let disposable = vscode.commands.registerCommand('pronounciation.pronounce', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        let word = editor.document.getText(selection).trim();

        if (!word) {
            vscode.window.showInformationMessage('No text selected');
            return;
        }

        // Use macOS say command for better quality
        say.stop();
        say.speak(word);
        // No temp files needed

        // Remove all the chunking and download code
    });

    let disposableStop = vscode.commands.registerCommand('pronounciation.stop', () => {
      say.stop();
    });
    context.subscriptions.push(disposableStop);

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}; 