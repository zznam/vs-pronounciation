# Guided reading delivery

The first wave adds immutable multilingual reading sessions, manual/continuous playback, sentence navigation, explicit source commands, progress, and cancellation-aware playback outcomes.

| Wave | Branch | Status / prerequisite |
| --- | --- | --- |
| 1 | `codex/reading-sessions` | Merged in PR #10. |
| 2 | `codex/repeat-practice` | In review: [PR #11](https://github.com/zznam/vs-pronounciation/pull/11). |
| 2 | `codex/sentence-highlighting` | In review: [PR #12](https://github.com/zznam/vs-pronounciation/pull/12). |
| 3 | `codex/practice-sidebar` | Planned after both wave 2 PRs merge. |
| 4 | `codex/vocabulary-bookmarks` | Planned after the sidebar merges. |
| 4 | `codex/practice-presets` | Planned after the sidebar merges. |

Use one managed worktree and one PR per topic, each targeting updated `main`. Include tests and documentation in every PR. Revalidate sibling branches after shared-file changes. Automatic merging and Marketplace publishing are excluded.

---

# Improvement brainstorm and delivery plan

Implemented after the original offline batches: configurable TTS connections for OpenAI, ElevenLabs and OpenAI-compatible custom APIs, encrypted API keys, guided native controls, sequential long-passage playback, session audio replay, and explicit local recovery. Local speech remains the default. See README.md for setup and privacy behavior. The cloud exclusions below describe the original batches rather than the current extension.

Planning date: 2026-10-03. These 34 ideas build on the existing offline speech engine, replay, and Stop controls. A, B, and C identify [reading PR #2](https://github.com/zznam/vs-pronounciation/pull/2), [voice PR #3](https://github.com/zznam/vs-pronounciation/pull/3), and [reliability PR #4](https://github.com/zznam/vs-pronounciation/pull/4), all targeting `main`; features become available when their PR merges. Backlog items are ideas only. No cloud service, credential, persistent speech history, or Marketplace publication is included in these batches.

| # | Feature or improvement | Benefit and acceptance criteria | Priority | Effort | Delivery |
| --- | --- | --- | --- | --- | --- |
| 1 | Read current line | Speak the cursor line without manual selection; blank lines give guidance. | High | S | A: Reading |
| 2 | Read current paragraph | Use surrounding blank-line boundaries, including the start and end of a file. | High | S | A |
| 3 | Explicit whole-document reading | Separate command, subject to the same passage limit. | Medium | S | A |
| 4 | Read all selections | Sort by document position, merge overlaps, skip empty ranges. | High | M | A |
| 5 | Read typed text | Practice a word without opening or modifying a file. Cancellation retains replay. | High | S | A |
| 6 | Read clipboard | Access clipboard only on invocation; handle empty content and access errors. | Medium | S | A |
| 7 | Speak code identifiers | Opt-in camelCase, acronym, and snake_case splitting; preserve URLs and paths. | High | S | A |
| 8 | Normalize whitespace | Opt-in collapse of repeated whitespace and line breaks. | Medium | S | A |
| 9 | Pronunciation replacements | Literal, case-sensitive Unicode whole-word replacements, applied once. | High | M | A |
| 10 | Adjustable passage limit | Validate both input and replacement expansion; never truncate silently. | High | S | A |
| 11 | Clear replay memory | Explicit privacy control without stopping current playback. | High | S | A |
| 12 | Resource-scoped preparation | Respect per-folder text preparation settings for the originating editor. | Medium | S | A |
| 13 | Installed voice picker | Discover actual voices on each supported desktop OS. | High | M | B: Voices |
| 14 | Voice language labels | Show native locale labels where available; do not infer unsupported metadata. | High | S | B |
| 15 | Restore system default voice | Explicit picker entry removes a stale configured voice. | High | S | B |
| 16 | Preview a voice | Fixed sample through normal playback; preview does not replace replay memory. | High | M | B |
| 17 | Custom speaking speed | Validated numeric input across 0.25–3; cancellation makes no changes. | Medium | S | B |
| 18 | Faster/slower commands | Bounded 0.25 increments without reopening Settings. | Medium | S | B |
| 19 | Reset speed | Return to normal speed in one command. | Medium | S | B |
| 20 | Full-range speed presets | Include slowest and fastest supported rates and show the active rate. | Medium | S | B |
| 21 | Open extension settings | Direct command opens Pronunciation-filtered Settings. | Medium | S | B |
| 22 | Signal-exit failure detection | A process killed externally must not appear to finish successfully. | High | S | C: Reliability |
| 23 | Festival stdout error detection | Detect Scheme errors even when the process exits with code zero. | High | M | C |
| 24 | Speech error recovery action | Open filtered voice/speed settings from an error; dismissal and deactivation make no changes. | High | S | C |
| 25 | Package validation in CI | Produce a VSIX and verify required runtime files and excluded test files. | High | M | C |
| 26 | Maintenance automation | Reviewable dependency updates and reusable bug/feature issue forms. | Medium | S | C |
| 27 | Sentence stepping | Previous/next sentence with abbreviation, decimal, and non-Latin punctuation handling. | High | M | Backlog |
| 28 | Bounded practice loops | Repeat 2–5 times with cancellable gaps; no unlimited default loop. | High | M | Backlog |
| 29 | Audio export | Native save dialog, supported formats, cancellation, and partial-file cleanup. | Medium | M | Backlog |
| 30 | Explicit vocabulary bookmarks | Opt-in storage with limits and remove/export/clear controls. | Medium | M | Backlog |
| 31 | Dictionary definitions and IPA | Licensed source, language and provenance, explicit opt-in networking. | Medium | L | Backlog |
| 32 | True pause/resume and highlighting | Requires reliable native progress/timing; never label restart as resume. | Medium | L | Backlog |
| 33 | Native Windows/Linux audio smoke tests | Generate actual audio and verify cancellation and Unicode on those engines. | High | M | Backlog |
| 34 | Minimum-host and Remote SSH/WSL checks | Validate declared VS Code minimum and local extension placement. | High | M | Backlog |

Keep the existing `pronounciation.*` IDs and shortcuts for compatibility. New speech inputs use the same cancellation coordinator and local backend. Unit tests validate boundaries and request ordering; native audio tests are required before claiming full platform verification.

---

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
