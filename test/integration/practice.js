const assert = require('node:assert/strict');
const vscode = require('vscode');
const { setTimeout, clearTimeout } = require('node:timers');

async function practice({ recordings, apiTexts, local }) {
    const config = vscode.workspace.getConfiguration('pronounciation');
    const command = name => vscode.commands.executeCommand(`pronounciation.${name}`);
    const update = (key, value) => config.update(key, value, vscode.ConfigurationTarget.Global);
    const text = 'Practice this sentence. Then this sentence.';
    const document = await vscode.workspace.openTextDocument({ content: text });
    await vscode.window.showTextDocument(document);
    await update('reading.mode', 'continuous');
    await update('practice.repeatCount', 2);
    await update('practice.gapSeconds', 0.01);
    try {
        await command('startDocumentSession');
        const start = local ? recordings.length : apiTexts.length;
        await command('practiceSession');
        if (local) {
            assert.deepEqual(recordings.slice(start).map(item => item.text), ['Practice this sentence.', 'Practice this sentence.', 'Then this sentence.', 'Then this sentence.']);
        } else {
            assert.deepEqual(apiTexts.slice(start), ['Practice this sentence.', 'Then this sentence.'], 'Practice reuses temporary API audio');
        }
        await update('practice.gapSeconds', 10);
        await command('startDocumentSession');
        // The real-host command must settle promptly when Stop cancels an active run.
        // Controller tests exercise the exact gap boundary; this checks native transport cleanup.
        const before = recordings?.length;
        const run = command('practiceSession');
        if (local) {
            for (let retry = 0; retry < 200 && recordings.length === before; retry++) await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(recordings.length > before, 'Practice must start native speech');
            await recordings[before].done;
            await new Promise(resolve => setTimeout(resolve, 10));
        } else await new Promise(resolve => setTimeout(resolve, 750));
        await command('stop');
        let timer;
        try {
            await Promise.race([run, new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Practice did not cancel promptly')), 2000);
            })]);
        } finally { clearTimeout(timer); }
        await command('clearSession');
    } finally {
        for (const key of ['reading.mode', 'practice.repeatCount', 'practice.gapSeconds']) await update(key, undefined);
    }
}
module.exports = { practice };
