# Pronunciation

<img src="assets/icon.png" width="96" height="96" alt="Pronunciation speech bubble and waveform logo">

Read selected text or the word at your cursor aloud in desktop VS Code. Use offline system voices or connect OpenAI, ElevenLabs, or a custom OpenAI-compatible TTS API. Includes voice and speed settings, replay, and a Stop control. Local speech is the default and requires no account. There are no runtime npm dependencies.

## Read, replay, and stop

Select a word, sentence, or passage, then right-click and choose **Pronunciation: Read Selection or Word**. With no selection, the same command reads the word at your cursor. It never falls back to reading the entire document. For multiple selections, the default command reads the primary selection. Use **Read All Selections** to read all nonempty selections in document order; overlapping selections are merged. Line-break pauses depend on the installed voice.

| Command | macOS | Windows / Linux |
| --- | --- | --- |
| Read Selection or Word | Cmd+Ctrl+P | Ctrl+Alt+P |
| Stop | Cmd+Ctrl+S | Ctrl+Alt+S |
| Replay Last Text | Cmd+Ctrl+R | Ctrl+Alt+R |
| Set Speed | Command Palette | Command Palette |

While speech is playing, click **Stop pronunciation** in the status bar or use Stop from the editor context menu. A new request stops the previous one before starting. Stopping also cancels any pending replacement. Closing or disabling the extension stops playback.

Replay uses the last requested passage with your **current** connection, voice and speed, even after switching editors. Passage text is retained in memory and cleared when the extension deactivates. Local speech never sends text to a cloud service. With an API connection selected, requested text is sent to that service and generation may incur charges. Passages are limited to 50,000 characters to keep accidental large selections manageable.

API playback splits long passages into chunks of at most 2,000 characters, preferring sentence and whitespace boundaries and keeping Unicode character sequences intact. Each chunk is generated and played in order. Stop cancels the current request or audio and prevents the remaining chunks from starting. Status shows the connection name and **Generating** or **Playing**.

The last completed API passage is kept as temporary WAV files for session replay. Replay reuses those files when text, connection settings, and credentials match, avoiding another API request. New passages, preference changes, **Clear Replay Text**, and normal shutdown remove cached audio. Previews use separate temporary audio and do not replace replay. Clear Replay during playback defers deletion of files in use until playback ends. An unexpected process exit can leave temporary audio in the operating system's temporary directory; there is no permanent history or export feature.

## More reading options

Use the Command Palette for **Read Current Line**, **Read Current Paragraph** (bounded by blank lines), **Read Entire Document**, **Read All Selections**, **Read Typed Text**, and **Read Clipboard**. The document command is explicit; ordinary cursor reading still never reads the entire file. Clipboard access happens only when you invoke its command. Typed and clipboard text work without an editor. **Clear Replay Text** removes the in-memory passage without interrupting current playback.

Optional settings can split code identifiers (`getHTTPResponse` becomes `get HTTP Response`), collapse repeated whitespace, and replace whole words such as `SQL` with `sequel`. Replacements are case-sensitive, literal, and applied once before identifier splitting. Replay retains the prepared passage, so replacements cannot compound on each replay. Text preparation settings use the originating document’s resource scope.

```json
{
  "pronounciation.speakCodeIdentifiers": true,
  "pronounciation.normalizeWhitespace": true,
  "pronounciation.replacements": { "SQL": "sequel" },
  "pronounciation.maxTextLength": 5000
}
```

The passage limit applies before and after preparation. Its default is 50,000 characters and can be lowered to any positive integer. Oversized text is rejected with guidance and never silently truncated.

## Guided reading sessions

Run **Start Reading Session** to capture the primary selection, or the current paragraph when nothing is selected. Loading is silent. **Reading Session from Entire Document**, **Reading Session from Typed Text**, and **Reading Session from Clipboard** offer explicit alternative sources; clipboard access happens only on invocation.

- **Play Reading Session** reads the current sentence. The default **manual** mode waits after that sentence. **Continuous** mode reads from the current sentence to the end.
- **Next Sentence** and **Previous Sentence** stop current playback and read the chosen sentence using the session's mode. They do not wrap at the ends. **Choose Session Sentence** selects a position without speaking.
- **Set Reading Session Mode** changes only the current session and stops playback. Set `pronounciation.reading.mode` to `continuous` to change the default for newly loaded sessions.
- **Stop** retains the passage and current position. Play then restarts the current sentence from its beginning. The status bar shows the sentence number and connection while speaking.
- **Clear Reading Session** stops playback, discards the session snapshot, and clears temporary audio. Ordinary **Replay Last Text** retains its existing passage; guided reading does not overwrite it.

A session captures original text and prepares each sentence once with the source document's pronunciation settings. Later document edits do not alter that captured passage. Reload the session to use edited text or changed replacement settings. The input and complete prepared passage both obey the existing character limit. Sessions remain in memory only and are discarded when the extension deactivates.

`pronounciation.reading.locale` accepts language tags such as `en`, `vi`, `zh`, and `ja`; its default `auto` uses the VS Code interface language. This controls sentence boundaries, not the speaking voice or automatic language detection. Segmentation uses the host's Unicode rules, with targeted English/Vietnamese title and Latin-initial handling. Blank lines always separate paragraphs. Unusual abbreviations and lowercase sentence starts can still be grouped differently from human expectations; select a shorter passage when needed.

**Practice Reading Session** repeats the current sentence three times by default, with two seconds of silence between renditions. Configure `pronounciation.practice.repeatCount` from 2–5 and `pronounciation.practice.gapSeconds` from 0–10 (fractional seconds are allowed). Manual mode finishes after the current sentence's repetitions. Continuous mode practices every remaining sentence, with the same gap between sentences and no trailing gap after completion. Connection, voice, speed, and practice settings are captured for the run; subsequent changes apply on the next Practice or navigation request.

During a practice run, the status bar shows the repetition number and retains Stop during silent gaps. Stop cancels the timer immediately and keeps the current sentence. Practice restarts that sentence's repetitions; Play reads it once. Previous/Next retain the most recent Play or Practice choice while restarting at the chosen sentence. New reading requests, previews, mode changes, Clear Reading Session, and deactivation cancel pending practice gaps. Matching API audio is reused for successive repeats, avoiding additional synthesis requests for the same sentence.

Voice, speed, and connection settings are captured at the start of each Play or navigation run. Changes take effect on the next run. A new ordinary read or voice preview interrupts the session sequence. Failures stop automatic advancement and retain the current sentence. API sessions send one sentence at a time (with the existing chunk limit for long sentences); replaying the matching last sentence reuses temporary audio. Revisiting earlier sentences can generate audio again and incur charges.

The native sidebar, bookmarks, and presets are planned as separate follow-up PRs; they are not part of these changes.

## Settings

Open Settings and search for **Pronunciation**.

| Setting | Default | Purpose |
| --- | --- | --- |
| `pronounciation.voice` | `""` | Installed voice name; empty uses the system default. Machine setting because installed voices differ between computers. |
| `pronounciation.speed` | `1` | Relative speed, from `0.25` to `3`. User setting; the Set Speed command provides common presets. |
| `pronounciation.readWordAtCursor` | `true` | Allow reading the cursor word when there is no selection. |

For example, `"pronounciation.speed": 0.75` slows speech down. Exact timing depends on the operating system and voice. Changes apply to the next read or replay, not to audio already playing.

### Voice and speed controls

With Local speech active, use **Choose Voice** to list voices on your computer. macOS and Windows show locale labels; Festival entries show their engine name. **System default** clears a configured voice, including one that has been uninstalled. **Preview Voice** plays a fixed phrase with the chosen voice and current speed without saving the choice or replacing replay text. Preview uses the same Stop control as normal speech. No voice list is cached: reopen the picker after installing voices. Discovery times out after five seconds and is cancelled on deactivation.

**Set Speed** includes presets from 0.25× through 3× and marks the current speed. **Set Custom Speed** accepts any number in that range. **Speak Faster** and **Speak Slower** adjust by 0.25×, clamped at the endpoints; **Reset Speed** returns to 1×. These commands save your user preferences for the next read. **Open Settings** opens settings filtered to the `pronounciation` prefix.

With an API connection active, voice and speed controls update that profile instead of your local preferences. ElevenLabs uses 0.7–1.2×; local, OpenAI and custom connections use 0.25–3×. API profiles start at 1×. The same command ID now displays **Choose Voice** and lists voices for the selected provider. OpenAI voices depend on the selected model. ElevenLabs lists account voices, with a manual voice ID option; custom APIs use manual IDs. Discovery is cancellable on deactivation. API previews use the same Stop control without saving the previewed choice.

### Connect a TTS API

1. Run **Pronunciation: Manage TTS Connections**, choose **Add connection**, and select OpenAI, ElevenLabs, or Custom OpenAI-compatible API.
2. Enter a name, model, voice, and speed. OpenAI defaults to `gpt-4o-mini-tts` and `marin`; ElevenLabs defaults to `eleven_multilingual_v2`. If discovery needs an account key, enter model/voice IDs manually, then edit the connection after setting its key.
3. Run **Pronunciation: Set API Key** and choose the connection. Keys use masked input and VS Code's encrypted SecretStorage. They are stored on this computer separately from settings and are not synced between machines. **Remove API Key** deletes a stored key.
4. Run **Pronunciation: Test Connection** to play a fixed sample without replacing replay text. Testing and API previews may incur generation charges.
5. Run **Pronunciation: Choose TTS Connection** to activate it, then use any existing reading command. Select **Local speech** to return to offline voices.

Manage Connections also edits or removes profiles. Removing the active profile selects Local speech and deletes its key. Changing a custom endpoint through this command discards the old key; set the destination's key again. Voice, speed and connection changes affect the next request, while current playback keeps its original settings.

`pronounciation.tts.profiles` stores non-secret connection metadata and `pronounciation.tts.activeProfile` stores the selected ID (`local` by default). Both are machine settings. Existing settings and keybindings work without migration. Custom connections require a complete speech URL, accepting an OpenAI-compatible JSON request with `input`, `model`, `voice`, `speed`, and `response_format: "wav"`, and returning PCM WAV audio. Bearer authentication is optional for custom endpoints. HTTPS is required except for HTTP on `localhost`, `127.0.0.1`, or `::1`; redirects are rejected.

Requests time out after 60 seconds and audio responses are capped at 32 MiB per chunk. There are no automatic retries. Errors distinguish authentication, quota/rate limits, connection failures and incompatible audio without displaying provider payloads or credentials. **Read locally** continues from the failed chunk with local preferences; **Manage connections** opens setup. These actions expire after a newer read or Stop.

Provider documentation: [OpenAI speech API](https://developers.openai.com/api/docs/guides/text-to-speech), [ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [VS Code SecretStorage](https://code.visualstudio.com/api/advanced-topics/remote-extensions#persisting-secrets).

Voice discovery follows the native [Windows installed-voice API](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.getinstalledvoices?view=netframework-4.8.1) and [Festival voice registry](https://github.com/festvox/festival/blob/master/lib/voices.scm). A listed voice can still fail to speak if its installation is incomplete.

The existing `pronounciation.*` command and setting prefix is intentionally preserved for compatibility with keyboard customizations. The displayed name is **Pronunciation**.

## Platform setup

API WAV playback uses `afplay` on macOS, Windows PowerShell `System.Media.SoundPlayer` on Windows, and `paplay` or `aplay` on Linux. Linux users can install `pulseaudio-utils` or `alsa-utils`. Player availability is checked before generating API audio. This does not require Festival unless you also use local speech.

- **macOS:** Uses the built-in `say` command. Run `say -v '?'` in Terminal to list installed voice names. For example, set the voice to `Samantha` if installed.
- **Windows:** Uses Windows PowerShell and `System.Speech`. Install the desired desktop speech voice in Windows. Not every Windows online or Narrator voice is available to `System.Speech`.
- **Linux:** Uses **Festival**, not eSpeak. On Debian/Ubuntu, install it with `sudo apt install festival festvox-kallpc16k`. Leave voice empty or use an installed Festival function such as `voice_kal_diphone`. Voice names may contain only letters, digits, and underscores after `voice_`. Language and Unicode pronunciation quality depend on the installed Festival voice.

The extension runs beside the desktop UI, so speech uses your local computer in Remote SSH, WSL, and container workspaces. Install it locally. Browser-only VS Code is not supported.

If playback fails, the extension reports an error with an **Open Settings** action to adjust the voice and speed. For a missing engine, follow the setup guidance in the notification. For an unavailable voice, clear the voice setting and retry with the default. Check your system audio output if playback completes but is inaudible.

## Development and tests

Use Node.js **22.13 or later** for development (Node 22 is used in CI). Desktop VS Code 1.75 or later is the extension's declared runtime minimum.

```sh
npm ci
npm run check
```

`npm run check` runs ESLint and the Node test runner with coverage gates of **95% lines, 90% branches, and 95% functions** across `extension.js` and `src/`. `npm test` runs the same unit tests without coverage. No test framework or speech engine is needed for these tests; subprocess and VS Code boundaries are simulated. CI runs these checks on macOS, Windows, and Linux.

The suite covers selection handling, Unicode and quoted input, command contributions, settings, replay, status controls, missing engines, process failures, cancellation, rapid request replacement, and cleanup. Coverage measures JavaScript paths; it does not prove native engine behavior or audio quality on every platform.

API tests use mocked provider boundaries and a local HTTP server; they need no paid credentials. They cover auth headers, request/response formats, chunking, cancellation, replay cache cleanup, connection editing, secure key commands, and fallback. Paid OpenAI and ElevenLabs integrations still require a separate live check using your own credentials before claiming account-specific verification.

Run `npm run test:audio` to play silent WAV fixtures through the actual platform player and verify cancellation and cleanup. This needs a working system audio output (outside a sandbox that blocks CoreAudio on macOS). CI includes a native audio job on macOS, Windows and Linux; Linux uses a PulseAudio null sink. Passing this smoke test verifies process playback and cancellation, not audible speech quality.

Press **F5** to launch an Extension Development Host using the included debug configuration.

### Real extension-host smoke test

Set `VSCODE_EXECUTABLE_PATH` to the installed VS Code **application executable** (not a Windows `.cmd` launcher), then run `npm run test:integration`. On macOS the executable name is listed by:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' '/Applications/Visual Studio Code.app/Contents/Info.plist'
```

Use that name in `/Applications/Visual Studio Code.app/Contents/MacOS/<executable>` for `VSCODE_EXECUTABLE_PATH`. On Windows, use the absolute path to `Code.exe`. On Linux, use the actual application executable, with a graphical session or `xvfb-run`.

This test opens a temporary VS Code profile, verifies activation and commands, and removes the test profile afterward. On macOS it also exercises reading commands through the real `say` engine, directing output to temporary AIFF files instead of speakers. On every platform it uses a local HTTP fixture to exercise custom API requests, Unicode chunking, real WAV playback, cached replay, and cache clearing without paid credentials. The platform WAV player and a working audio output are required. This optional test is separate from the unit-test CI matrix.

## Packaging

```sh
npm run check
npm run package
```

The package command uses the pinned VSCE development dependency, writes `artifacts/pronunciation.vsix`, and verifies that its manifest matches the source, every runtime module and license is present, and tests, development tools, environment files, and dependencies are excluded. CI builds this archive and retains it as an artifact without publishing to the Marketplace. Dependency and GitHub Actions update PRs are scheduled weekly with Dependabot.

Install the generated `.vsix` using **Extensions: Install from VSIX**. Publishing requires configuring a Marketplace publisher; no publisher account is assumed here.

See [ROADMAP.md](ROADMAP.md) for the review findings, next feature priorities, and remaining test gaps.

## References

- [VS Code extension-host placement](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Festival command and text modes](https://www.cstr.ed.ac.uk/projects/festival/manual/festival_7.html) and [duration controls](https://www.cstr.ed.ac.uk/projects/festival/manual/festival_19.html)
- [Windows SpeechSynthesizer](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer?view=netframework-4.8.1)
