# talk-bugs for iPhone and Apple Watch

Native SwiftUI clients for the same Cloudflare rooms as the web app. Open the app, invite someone, hold **Hold to talk** while speaking, then release to send. Recording stops after 30 seconds. Everyone reads text; there is no keyboard, dictation text field, or audio playback.

The main screen shows other people’s latest and previous turns. History includes everyone’s words, including your own. iPhone speaker sections keep their positions; Watch groups have a stable vertically paged view with one page per person. Neither view automatically scrolls on transcript corrections.

The native apps send completed messages. Multiple people can record simultaneously; the Durable Object orders messages when their text arrives. The existing browser client still streams partial transcripts.

## Build and run

Open `talk-bugs.xcodeproj` in Xcode 26 or newer. Choose **TalkBugs** and an iPhone simulator, or **TalkBugsWatch** and a paired Watch simulator. Deployment targets are iOS 26 and watchOS 26. The checked-in project is ready to open; regenerate it after editing `project.yml` with:

```sh
brew install xcodegen
xcodegen generate --spec native/project.yml
```

For hardware, select your Apple development team for the app and both widget extensions, and connect a paired iPhone and Watch. The current team is `WL8UPH7Q7H`. If the team or bundle ID changes, update `public/.well-known/apple-app-site-association` and redeploy the Worker so HTTPS room invitations continue to open the app.

Start on the iPhone: its room and participant identity are passed to the Watch through WatchConnectivity. Sharing that identity keeps your own messages out of both incoming views. Invite links open that room in the native app when installed, or the web app otherwise. `talk-bugs://room/<room-uuid>` is also supported. The plus button creates another room. Pending recordings retain the room in which they were recorded.

Add **Speak in talk-bugs** to iPhone Control Center, the Lock Screen controls, or an Action button shortcut. The Watch face **Speak** complication and iPhone shortcuts open the conversation without turning on the microphone. Hold the in-app control to record. VoiceOver also exposes explicit Start speaking and Finish speaking accessibility actions. Microphone permission is requested on the first hold; if the permission sheet interrupts the hold, hold again after allowing access. The app's shortcut URL is `https://talk-bugs.roundtrip.workers.dev/talk` (or `talk-bugs://talk`).

## Audio and delivery

- iPhone records 16 kHz mono PCM locally. `SpeechAnalyzer` with `SpeechTranscriber` performs on-device recognition, with `DictationTranscriber` for devices without the newer transcriber. English (`en-US`) speech assets are downloaded from Apple when needed. There is no cloud recognition fallback.
- Watch records locally and sends its file to the paired iPhone using `WCSession.transferFile`. The iPhone transcribes it, then posts **only text** to Cloudflare. An unavailable iPhone delays sending; the Watch is not an independent transcription device.
- A durable outbox holds up to 20 recordings. The iPhone deletes audio after transcription and retains text for retry. The Watch keeps its recording until the phone confirms that Cloudflare acknowledged the message. Files are excluded from backups; jobs older than 24 hours are purged on launch/refresh.
- Retry preserves the message and participant IDs. Final messages cannot be overwritten. A failed message remains visible with Retry; server history is limited to 200 messages and 24 hours, so retries outside that retained window are not an indefinite deduplication guarantee.
- Native readers poll authenticated HTTPS snapshots every second while active, with ETags and a three-second retry after network errors. Background readers pause; the shared phone/Watch presence expires through its lease when neither device is polling. This version does not send APNs notifications or keep the Watch display awake. Losing the foreground ends a recording just like releasing the control; finishing transcription and delivery may continue within the OS execution budget.
- The iPhone attempts to finish received recordings during its background execution allowance. If iOS suspends it, work resumes when the app next runs. WatchConnectivity schedules delivery opportunistically; it does not promise instant transfer while the phone is locked or unavailable.

No speech audio reaches the application backend. The server accepts only small JSON transcript requests, and rejects audio bodies. Apple handles microphone access, local speech assets, and the Watch-to-phone transport. Room links remain bearer invitations, without accounts or end-to-end encryption.

## Validation

From the repository root, with `npm run dev` running:

```sh
TALK_BUGS_TEST_SERVER=http://127.0.0.1:5173 swift test --package-path native/Core
xcodebuild -project native/talk-bugs.xcodeproj -scheme TalkBugs \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath native/DerivedData CODE_SIGNING_ALLOWED=NO test
```

Core tests exercise three concurrent real HTTP clients, room isolation, retries, conditional snapshots, invitation parsing, and durable bounded recording queues. XCUITest exercises the actual app UI and real local Worker, with a controlled transcription result compiled only into **Debug simulator** builds. No test speech source or server override is present in device builds. The native speech test uses a synthesized audio fixture and runs the actual transcriber when the runtime supports it.

On Apple Silicon macOS 26+, test the production local transcription code with:

```sh
native/scripts/check-local-speech.sh
# Also post the recognized text through the real API and read it as a second client:
TALK_BUGS_TEST_SERVER=https://talk-bugs.roundtrip.workers.dev \
  native/scripts/check-local-speech.sh
```

The fixture says: “Hello from the watch. We can read each other without hearing each other.” It was generated with the macOS Samantha voice; it contains no user recording.

### Simulator limits

Apple explicitly does not support [`transferFile` in Simulator](https://developer.apple.com/documentation/watchconnectivity/wcsession/transferfile(_:metadata:)). Paired simulators can exercise room context synchronization and HTTPS reading, but cannot prove the audio transfer link. This installed iOS simulator advertises dictation locales but supplies no compatible on-device speech formats; its real speech test is skipped with that reason. The same production transcriber has been exercised successfully on macOS against the fixture and the deployed API.

Hardware validation is still needed for microphone capture, Watch file delivery, locked-phone/background execution, speech assets on the target phone, haptics and physical hold gestures, and Lock Screen/Watch complication launches. Simulator success is not a claim that these hardware paths have passed. This repository does not publish or submit the native apps to the App Store.

### Validation performed on October 27, 2026

- 5 protocol tests, 17 browser/Worker integration tests, 5 Swift core tests, and 3 native unit/UI tests passed. One real iOS speech test was skipped for the simulator limitation above.
- Unsigned Release builds succeeded for the iPhone app, embedded Watch app, iPhone control extension, and Watch complication extension. Release binaries were checked to exclude simulator test overrides.
- The production transcription implementation converted the audio fixture locally on macOS, posted the text to the deployed Worker, retried without a duplicate, and read it through a second Swift client. The resulting text was verified in Chrome and on both native simulator screens.
- The three-client Swift integration test passed against the deployed Worker, including concurrent posts, room isolation, and ETag responses. The hosted Apple association file returned valid JSON with the app's team/bundle ID.
- Paired simulators synchronized the selected room via WatchConnectivity. Audio file transfer and hardware capture remain unvalidated for the reasons above.

### Push-to-talk validation

The web interaction is covered with mouse, touch, and Space/Enter holds; release outside the control; cancellation; focus loss; key repeat; and a delayed speech startup after release. Native UI tests cover hold-to-send, quick taps, release outside the control, persistence, and shortcuts that leave the microphone off. A native recorder test verifies that releasing during a pending permission request prevents a later start.

### Incoming conversation validation

Browser tests cover concurrent speakers without own-text distractions, stable positions during long partial revisions, manual scroll preservation, departures, two-turn context, full history, identity after reload, and one hold spanning several recognition results/restarts. Swift core tests cover the same speaker ordering and current/previous selection. Native UI tests cover incoming corrections, stable speaker positions, previous-turn context, own-text history, and the hold interaction. Speech-source and physical-device limitations above still apply.
