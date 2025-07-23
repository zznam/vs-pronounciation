This is a Visual Studio Code extension that adds an option to the right-click menu in the editor to pronounce the selected text.

## How to use

1. Open Visual Studio Code
2. Open a file
3. Select some text (word, sentence, or paragraph) in the editor
4. Right-click on the selection and select "Pronounciation" at the bottom of the menu
   OR use the keyboard shortcut: Cmd+Ctrl+P (on macOS) or Ctrl+Alt+P (on other platforms)
5. The pronunciation will be spoken using the system's text-to-speech

**Stop Pronunciation:** Use Cmd+Ctrl+S (macOS) or Ctrl+Alt+S (other) to stop current audio. New requests automatically stop ongoing pronunciation.

This extension now uses a cross-platform TTS library. On Linux, you may need to install 'espeak' (e.g., sudo apt install espeak). Audio quality varies by OS.

## How to install

For development:

1. Clone the repository
2. Open the folder in VS Code
3. Press F5 to debug and run the extension

To package and install:

1. Install vsce: npm install -g vsce
2. Run vsce package
3. Install the .vsix file in VS Code