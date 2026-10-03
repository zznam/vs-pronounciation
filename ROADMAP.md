# Extension review and feature priorities

Review date: 2026-10-02. Baseline: repository commit `5a34d49`, extension version `0.0.2`.

## Findings addressed in this change

| Priority | Baseline finding | Impact and resolution |
| --- | --- | --- |
| High | The `say` dependency directly inserted text into Festival Scheme expressions. Its Linux stop implementation targeted `child.pid + 2`. | Quotes could escape the text expression, and stopping could target an unrelated process. Replaced the dependency with a small native adapter that escapes Festival text, validates voice names, and owns a dedicated Linux process group. macOS and Windows receive text through stdin; no shell is used. |
| High | Speech failures were ignored, and missing child-process executables had no error listener in the dependency. | Failures could be silent or unhandled. Native process, input-stream, and exit failures now produce visible errors with setup guidance. |
| Medium | New requests immediately stopped and restarted shared dependency state; deactivation did nothing. | Old callbacks could affect new playback, and audio survived deactivation. Requests now wait for prior process closure; only the latest queued request can start. Cleanup cancels speech. |
| Medium | No tests, no coverage command, missing ESLint configuration. | Regressions had no automated detection and lint failed immediately. Added behavioral tests, coverage gates, working lint, and a three-platform CI matrix. |
| Medium | No local extension-host requirement. | Audio could run on a remote machine. `extensionKind: ["ui"]` keeps the native engine beside desktop VS Code. |
| Low | Linux setup instructions specified eSpeak even though the backend used Festival; F5 had no launch configuration. | Corrected platform requirements, added debug configuration and an extension-host smoke test. |
| Low | Six development dependency audit findings, including five marked high severity. | Updated lint tooling and lockfile; removed unused type and runtime packages. Verify the current audit separately because advisory results change over time. |

## Features included

- Read the word at the cursor when no text is selected, with an opt-out setting.
- Replay the last passage with current voice and speed, without persistent history.
- Choose an installed voice through settings and speed through settings or the Command Palette.
- Stop playback from a visible status-bar button or context menu.
- Preserve existing command IDs and shortcuts while correcting user-facing spelling.

## Recommended next work

These are proposed features, not implemented behavior. Effort is relative: small, medium, or large. Prioritize the first two before adding storage or network services.

| Order | Feature | Why it is useful | Scope / acceptance criteria | Effort |
| --- | --- | --- | --- | --- |
| 1 | Installed voice picker with a preview | Removes guesswork from voice names and exposes available languages. | List actual local voices with language labels; preview a fixed phrase; save only on selection; preserve the previous choice on cancellation; test missing/empty voice inventories on each OS. | Medium |
| 2 | Sentence stepping and bounded practice loops | Supports listening practice and long passages without repeatedly selecting text. | Previous/next sentence, repeat 2–5 times, configurable gap, and immediate cancellation during a gap. Handle abbreviations, decimals, and non-Latin punctuation; avoid unlimited repeat by default. | Medium |
| 3 | Optional spoken code identifiers | Makes reading code names like `getHTTPResponse` or `user_id` useful. | Opt-in transformation with predictable camelCase, acronym, and snake_case handling; retain ordinary prose, URLs, numbers, and non-Latin text. | Small |
| 4 | Multi-selection reading in document order | Makes comparing several terms or examples faster. | Define ordering and pauses; skip empty selections; a replacement command and Stop must cancel the whole sequence. | Medium |
| 5 | Explicit vocabulary bookmarks | Helps language learners revisit chosen words with context. | Save only on request; provide remove/export/clear controls; keep automatic replay history in memory; define storage limits and workspace behavior first. | Medium |
| 6 | Optional dictionary definitions and IPA | Provides pronunciation detail beyond TTS. | Choose a licensed source, show language and provenance, handle heteronyms and unavailable entries, and make remote requests explicit and opt-in. TTS output alone cannot supply reliable IPA. | Large |
| 7 | Audio export | Lets users keep a short practice clip. | Native save dialog, format supported by each engine, cancellable export, cleanup of partial files, and platform-specific tests. | Medium |

Avoid implementing pause/resume as restart-from-the-beginning: it would misrepresent the behavior. True pause/resume and word highlighting need an engine interface with reliable progress or timing information. Cloud voices would also add credentials, latency, cost, and privacy choices; local playback should remain usable on its own.

## Remaining verification and release work

Verified locally on 2026-10-02:

- `npm run check`: 38 tests passed; 100% measured lines, branches, and functions in extension JavaScript; lint passed.
- `npm audit`: zero reported vulnerabilities.
- `npm run test:integration` with VS Code 1.138.0 on macOS: activation, commands, and three real `say` audio-file generations passed.
- `npx @vscode/vsce package`: produced a 10.7 KB VSIX with runtime source and documentation; test and development files excluded.

The CI matrix is configured but has not been run remotely as part of this review.

1. Native Windows and Linux tests should generate audio to a file and verify cancellation, Unicode behavior, missing/invalid voices, and engine errors. The unit tests simulate those platform boundaries; running them on three operating systems does not validate installed speech engines.
2. Exercise a real Linux process group with an audio-player descendant to verify complete cancellation. The regression test currently checks the group target and signal with a simulated process.
3. Add extension-host runs on the minimum supported VS Code release and current stable, and test Remote SSH/WSL placement. Only the available local host can be verified during this review.
4. Add packaging validation in release CI, set the intended Marketplace publisher, and choose the release version before publishing.
5. Keep coverage gates, but judge new tests by behavior and failures they detect. The initial 100% JavaScript coverage result does not cover the PowerShell runtime, Festival parser, audible output, or all VS Code lifecycle behavior.

## Architecture boundaries

- `extension.js`: VS Code activation/deactivation entry point.
- `src/extension.js`: text selection, commands, settings, and user feedback.
- `src/playback.js`: cancellation and request ordering, independent of VS Code and the operating system.
- `src/speech-backend.js`: native command construction and owned subprocess lifecycle.

Keep feature logic above the backend boundary so additional engines can be added without weakening request ordering or platform tests.
