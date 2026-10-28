# talk-bugs

A minimal group chat: **speak to contribute, read to receive**. No typed message inputs, audio playback, accounts, or third-party application backend. The React UI uses default neutral shadcn/ui components and system fonts; Cloudflare Workers serves the app, and one SQLite-backed Durable Object coordinates each room.

Live app: [talk-bugs.roundtrip.workers.dev](https://talk-bugs.roundtrip.workers.dev).

## Native iPhone and Apple Watch apps

The SwiftUI apps in [`native/`](native/README.md) use push-to-talk: hold the microphone button to speak, then release to send the completed turn. Watch recordings go to the paired iPhone for local transcription; only text goes to Cloudflare. Native clients share rooms with browser clients through HTTPS snapshots and transcript posts. See the native README for Xcode setup, controls/complications, tests, and the simulator/hardware validation boundary.

## Run the web app

```sh
npm ci
npm run dev
```

Open the printed localhost URL to enter a new room immediately. Copy its invite link and open it in separate browser windows to join as different people. Reloading a room link keeps the same room; the New room action opens a fresh one. A localhost link is only reachable on the same computer; deploy for remote participants.

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npx wrangler deploy --dry-run
npm run deploy
```

Deployment uses your authenticated Wrangler account (`npx wrangler login` if needed). No API keys or secrets are required. The `ROOMS` binding and SQLite migration are declared in `wrangler.jsonc`. The compatibility date is October 26, 2026, the newest date supported by the installed local runtime when this project was created. After changing bindings, run `npm run cf-typegen` and commit the generated `worker-configuration.d.ts`.

Browser tests use installed Google Chrome (`channel: "chrome"`). To run in CI without Chrome, install it with `npx playwright install chrome`, or adjust the Playwright project to an installed Chromium build.

## Browser speech recognition

talk-bugs uses `SpeechRecognition` or `webkitSpeechRecognition`, with `continuous = true` and `interimResults = true`. When the optional `available()` check confirms that the English (`en-US`) pack is installed, it sets `processLocally = true`. Otherwise it uses standard browser recognition, including when the local check fails or a pack would need downloading. A local language-unavailable error switches the next user-initiated attempt to standard recognition.

Standard recognition may send audio to the browser vendor’s service. Only text reaches the Cloudflare application backend. Browser application code does not record, upload, or play audio. The native apps temporarily record audio locally, as described above. There is no typed fallback. Browsers without either recognition constructor can still read and invite.

Hold the microphone button to speak; release it to finish the turn. With the button focused, holding Space or Enter works too. The microphone also stops when the window loses focus, the tab becomes hidden, or the room disconnects. Reconnection never restarts it without a fresh press. HTTPS or localhost and microphone permission are required.

Tests simulate the speech engine and exercise the real UI, WebSockets, and local Cloudflare runtime. They do not validate microphone hardware, a particular language pack, or real transcription accuracy. Check those manually in a supported browser before relying on transcription.

## How simultaneous streaming works

```text
Browser A: microphone → browser recognition → revision snapshots ─┐
Browser B: microphone → browser recognition → revision snapshots ─┤
Browser C: microphone → browser recognition → revision snapshots ─┤
                                                             ▼
                                           One Durable Object per room
                                            SQLite + WebSocket fan-out
                                                             │
                              ┌──────────────────────────────┼─────────┐
                              ▼                              ▼         ▼
                          A reads text                   B reads text  C reads text
```

Each recognition result has a random **utterance ID** and an increasing **revision**. A payload contains the complete current text, a revision, and a final flag. Partial speech recognition revises earlier words, so append-only token deltas would produce incorrect text. Small complete snapshots make correction, retries, and recovery straightforward. There is no shared transcription buffer between participants.

The client coalesces interim updates to the latest revision every **100 ms**. Final results flush immediately. The same WebSocket carries upstream text, downstream revisions, presence, and acknowledgments. This avoids separate POST/SSE channels and supports independent concurrent speakers without turn-taking. Browser recognition latency and network round trips still apply; the 100 ms interval is an application batching limit, not an end-to-end latency promise.

The server namespaces utterance IDs by a server-derived participant identity, rejects stale/duplicate revisions, and assigns a stable order when a phrase first arrives. Revisions replace the existing row; final rows cannot be rewritten. The UI displays a live phrase in lighter text, then fixes it in place when finalized. Different speakers can have live rows at the same time. There is no need for a CRDT: participants only revise their own phrases, and the room object orders all accepted changes.

Every accepted revision is written synchronously to Durable Object SQLite before acknowledgment and broadcast. Persisting interim text costs more storage writes than ephemeral-only drafts but preserves in-progress messages across hibernation and supports reliable snapshots. All socket identity/rate state uses `serializeAttachment()`; no correctness-critical state depends on the object staying in memory. The hibernation API and automatic ping/pong responses let idle rooms sleep without dropping their sockets.

On reconnect, the server sends authoritative history and presence. The client retries only its latest unacknowledged revision per phrase; acknowledgments and revision checks prevent duplicate messages. The pending queue lives in page memory, so unsent words do **not** survive closing/reloading the page. Previously acknowledged text does survive. A new page gets a fresh participant identity, while an ordinary reconnect keeps the same identity. Disconnects mark unfinished phrases as interrupted; alarms also mark stale drafts after 45 seconds. Slow connections are closed and recovered rather than accumulating an unlimited client send buffer.

## Boundaries

- Up to 24 connected participants per room, 4,000 characters per phrase, 20 KB per frame, and 160 updates per 10 seconds per participant. At most four unfinished phrases per participant.
- Clients show the latest 200 phrases. The server retains the recent window plus any still-active older drafts. Stored text expires after 24 hours; alarms perform cleanup without a permanent server timer.
- Room UUIDs are bearer invitations. Anyone with a link can read its history and join. This is not an authenticated workspace or end-to-end encrypted messenger.
- Same-origin checks, schema validation, server-owned speaker IDs, parameterized SQL, React text escaping, and a Content Security Policy protect the normal app boundary. The protocol rejects binary frames. The voice-only constraint is enforced by the UI; a hostile custom client could manufacture text, since browsers cannot prove that text originated from speech.
- No audio is sent through Cloudflare. JavaScript and styles are hosted alongside the app; the app has no analytics or external runtime assets.

The repository includes protocol tests plus browser/integration coverage for overlapping speakers, corrections, immutable finals, room isolation, disconnect/retry recovery, permission errors, standard and prefixed recognition fallbacks, unsupported browsers, mobile layout, and binary payload rejection.

## References

- [MDN: on-device Web Speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API#on-device_speech_recognition)
- [Cloudflare: Durable Object WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [shadcn/ui](https://ui.shadcn.com/docs/)
