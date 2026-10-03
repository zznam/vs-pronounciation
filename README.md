# Pronunciation

Read selected text or the word at your cursor aloud in desktop VS Code. Uses your computer's speech engine, with voice and speed settings, replay, and a Stop control. No account, cloud API, or runtime npm dependencies are required.

## Read, replay, and stop

Select a word, sentence, or passage, then right-click and choose **Pronunciation: Read Selection or Word**. With no selection, the same command reads the word at your cursor. It never falls back to reading the entire document. For multiple selections, only the primary selection is read.

| Command | macOS | Windows / Linux |
| --- | --- | --- |
| Read Selection or Word | Cmd+Ctrl+P | Ctrl+Alt+P |
| Stop | Cmd+Ctrl+S | Ctrl+Alt+S |
| Replay Last Text | Cmd+Ctrl+R | Ctrl+Alt+R |
| Set Speed | Command Palette | Command Palette |

While speech is playing, click **Stop pronunciation** in the status bar or use Stop from the editor context menu. A new request stops the previous one before starting. Stopping also cancels any pending replacement. Closing or disabling the extension stops playback.

Replay uses the last requested passage with your **current** voice and speed, even after switching editors. Only that passage is retained in memory; it is cleared when the extension deactivates. The extension does not write selected text to disk or send it to a cloud service. Passages are limited to 50,000 characters to keep accidental large selections manageable.

## Settings

Open Settings and search for **Pronunciation**.

| Setting | Default | Purpose |
| --- | --- | --- |
| `pronounciation.voice` | `""` | Installed voice name; empty uses the system default. Machine setting because installed voices differ between computers. |
| `pronounciation.speed` | `1` | Relative speed, from `0.25` to `3`. User setting; the Set Speed command provides common presets. |
| `pronounciation.readWordAtCursor` | `true` | Allow reading the cursor word when there is no selection. |

For example, `"pronounciation.speed": 0.75` slows speech down. Exact timing depends on the operating system and voice. Changes apply to the next read or replay, not to audio already playing.

### Voice and speed controls

Use **Choose Installed Voice** to list voices on your computer. macOS and Windows show locale labels; Festival entries show their engine name. **System default** clears a configured voice, including one that has been uninstalled. **Preview Voice** plays a fixed phrase with the chosen voice and current speed without saving the choice or replacing replay text. Preview uses the same Stop control as normal speech. No voice list is cached: reopen the picker after installing voices. Discovery times out after five seconds and is cancelled on deactivation.

**Set Speed** includes presets from 0.25× through 3× and marks the current speed. **Set Custom Speed** accepts any number in that range. **Speak Faster** and **Speak Slower** adjust by 0.25×, clamped at the endpoints; **Reset Speed** returns to 1×. These commands save your user preferences for the next read. **Open Settings** opens settings filtered to the `pronounciation` prefix.

Voice discovery follows the native [Windows installed-voice API](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.getinstalledvoices?view=netframework-4.8.1) and [Festival voice registry](https://github.com/festvox/festival/blob/master/lib/voices.scm). A listed voice can still fail to speak if its installation is incomplete.

The existing `pronounciation.*` command and setting prefix is intentionally preserved for compatibility with keyboard customizations. The displayed name is **Pronunciation**.

## Platform setup

- **macOS:** Uses the built-in `say` command. Run `say -v '?'` in Terminal to list installed voice names. For example, set the voice to `Samantha` if installed.
- **Windows:** Uses Windows PowerShell and `System.Speech`. Install the desired desktop speech voice in Windows. Not every Windows online or Narrator voice is available to `System.Speech`.
- **Linux:** Uses **Festival**, not eSpeak. On Debian/Ubuntu, install it with `sudo apt install festival festvox-kallpc16k`. Leave voice empty or use an installed Festival function such as `voice_kal_diphone`. Voice names may contain only letters, digits, and underscores after `voice_`. Language and Unicode pronunciation quality depend on the installed Festival voice.

The extension runs beside the desktop UI, so speech uses your local computer in Remote SSH, WSL, and container workspaces. Install it locally. Browser-only VS Code is not supported.

If playback fails, the extension reports an error. For a missing engine, follow the setup guidance in the notification. For an unavailable voice, clear the voice setting and retry with the default. Check your system audio output if playback completes but is inaudible.

## Development and tests

Use Node.js **22.13 or later** for development (Node 22 is used in CI). Desktop VS Code 1.75 or later is the extension's declared runtime minimum.

```sh
npm ci
npm run check
```

`npm run check` runs ESLint and the Node test runner with coverage gates of **95% lines, 90% branches, and 95% functions** across `extension.js` and `src/`. `npm test` runs the same unit tests without coverage. No test framework or speech engine is needed for these tests; subprocess and VS Code boundaries are simulated. CI runs these checks on macOS, Windows, and Linux.

The suite covers selection handling, Unicode and quoted input, command contributions, settings, replay, status controls, missing engines, process failures, cancellation, rapid request replacement, and cleanup. Coverage measures JavaScript paths; it does not prove native engine behavior or audio quality on every platform.

Press **F5** to launch an Extension Development Host using the included debug configuration.

### Real extension-host smoke test

Set `VSCODE_EXECUTABLE_PATH` to the installed VS Code **application executable** (not a Windows `.cmd` launcher), then run `npm run test:integration`. On macOS the executable name is listed by:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' '/Applications/Visual Studio Code.app/Contents/Info.plist'
```

Use that name in `/Applications/Visual Studio Code.app/Contents/MacOS/<executable>` for `VSCODE_EXECUTABLE_PATH`. On Windows, use the absolute path to `Code.exe`. On Linux, use the actual application executable, with a graphical session or `xvfb-run`.

This test opens a temporary VS Code profile, verifies activation and commands, and removes the test profile afterward. On macOS it also exercises selection, replay, and cursor-word reading through the real `say` engine, directing output to temporary AIFF files instead of speakers. Windows and Linux currently receive activation checks only; native audio still needs platform-specific verification. This optional test is separate from the unit-test CI matrix.

## Packaging

```sh
npm run check
npx @vscode/vsce package
```

Install the generated `.vsix` using **Extensions: Install from VSIX**. Publishing requires configuring a Marketplace publisher; no publisher account is assumed here.

See [ROADMAP.md](ROADMAP.md) for the review findings, next feature priorities, and remaining test gaps.

## References

- [VS Code extension-host placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Festival command and text modes](https://www.cstr.ed.ac.uk/projects/festival/manual/festival_7.html) and [duration controls](https://www.cstr.ed.ac.uk/projects/festival/manual/festival_19.html)
- [Windows SpeechSynthesizer](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer?view=netframework-4.8.1)
