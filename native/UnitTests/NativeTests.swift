import AVFoundation
import Speech
import TalkBugsCore
import XCTest
@testable import TalkBugs

final class NativeTests: XCTestCase {
    func testActualLocalSpeechFromRecordedAudio() async throws {
        let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "voice", withExtension: "wav"))
        let dictation = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US"))
        guard SpeechTranscriber.isAvailable || dictation != nil else { throw XCTSkip("Local Speech modules are unavailable on this simulator. The macOS speech check runs the same implementation.") }
        let text: String
        do { text = try await LocalTranscriber().transcribe(source).lowercased() }
        catch VoiceError.speechUnavailable {
            #if targetEnvironment(simulator)
            guard !SpeechTranscriber.isAvailable else { throw VoiceError.speechUnavailable }
            throw XCTSkip("This simulator advertises dictation locales but provides no compatible on-device audio formats. Run the same speech check on macOS or hardware.")
            #else
            throw VoiceError.speechUnavailable
            #endif
        }
        XCTAssertTrue(text.contains("hello from the watch"), text)
        XCTAssertTrue(text.contains("read each other"), text)
    }
    @MainActor func testReceivedWatchRecordingIsDurableAndRetryable() async throws {
        let model = PhoneModel()
        let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "voice", withExtension: "wav"))
        let job = VoiceJob(room: UUID(), session: UUID())
        // Exercise the exact store boundary used after WatchConnectivity hands off a file.
        try model.store.receive(source, job: job)
        model.reload()
        XCTAssertTrue(model.pending.contains(where: { $0.id == job.id }))
        let relaunched = PhoneModel()
        XCTAssertTrue(relaunched.pending.contains(where: { $0.id == job.id }))
        model.discard(job.id)
        XCTAssertFalse(model.store.jobs().contains(where: { $0.id == job.id }))
        XCTAssertEqual(model.receipts[job.id.uuidString], "discarded")
    }
    @MainActor func testParticipantIdentitySurvivesModelRecreationAndPairedAdoption() {
        let original = Identity.session()
        XCTAssertEqual(Identity.session(), original)
        let paired = UUID()
        Identity.adopt(paired)
        XCTAssertEqual(Identity.session(), paired)
        XCTAssertEqual(RoomModel().session, paired)
        Identity.adopt(original)
    }
    @MainActor func testRoomKeysSurviveRelaunchAndKeepOlderKeysForPendingRecordings() throws {
        let room = UUID(), key = RoomCrypto.generateKey()
        try RoomKeys.save(key, room: room)
        XCTAssertEqual(RoomKeys.load(room), key)
        try RoomKeys.save(RoomCrypto.generateKey(), room: room)
        XCTAssertEqual(RoomKeys.load(room, id: RoomCrypto.keyID(key)), key)
        let model = RoomModel()
        model.join(room, key: key)
        let restored = RoomModel()
        XCTAssertEqual(restored.room, room)
        XCTAssertEqual(restored.roomKey, key)
        XCTAssertTrue(restored.encrypted)
        model.join(room)
        XCTAssertTrue(model.encrypted)
        XCTAssertEqual(model.roomKey, key)
        XCTAssertNotNil(model.error)
    }
    @MainActor func testQueuedEncryptedWatchJobUsesItsOriginalRoomAndKey() async throws {
        let model = PhoneModel()
        model.room.baseURL = URL(string: "http://127.0.0.1:5173")!
        let originalRoom = UUID(), key = RoomCrypto.generateKey()
        try RoomKeys.save(key, room: originalRoom)
        var job = VoiceJob(room: originalRoom, session: UUID(), encrypted: true, keyID: RoomCrypto.keyID(key))
        job.text = "A queued encrypted Watch transcript."
        try model.store.save(job)
        model.room.newRoom()
        // Even a later invite with another key must not change this job's key.
        try RoomKeys.save(RoomCrypto.generateKey(), room: originalRoom)
        model.process()
        for _ in 0..<200 {
            if model.receipts[job.id.uuidString] != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertEqual(model.receipts[job.id.uuidString], "sent")
        let api = RoomAPI(baseURL: model.room.baseURL, room: originalRoom, session: UUID(), key: key)
        let (snapshot, _) = try await api.snapshot()
        XCTAssertEqual(snapshot?.messages.first?.text, job.text)
        let (current, _) = try await model.room.api.snapshot()
        XCTAssertTrue(current?.messages.isEmpty == true)
        // A recording from an older Watch must not lose encryption on retry.
        var legacyJob = VoiceJob(room: originalRoom, session: UUID())
        legacyJob.text = "Never upload these words in plaintext."
        try model.store.save(legacyJob); model.process()
        for _ in 0..<200 {
            if model.receipts[legacyJob.id.uuidString] != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertNotEqual(model.receipts[legacyJob.id.uuidString], "sent")
        XCTAssertNotNil(model.store.jobs().first { $0.id == legacyJob.id }?.error)
        let (legacy, _) = try await RoomAPI(baseURL: model.room.baseURL, room: originalRoom, session: UUID()).snapshot()
        XCTAssertTrue(legacy?.messages.isEmpty == true)
        model.discard(legacyJob.id)
    }
    @MainActor func testReleaseWhilePermissionIsPendingPreventsRecording() async throws {
        var permission: CheckedContinuation<Bool, Never>?
        let recorder = VoiceRecorder(requestPermission: {
            await withCheckedContinuation { permission = $0 }
        })
        let task = Task {
            try await recorder.start(at: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".wav")) { _ in
                XCTFail("A released press must not produce a recording")
            }
        }
        while permission == nil { await Task.yield() }
        recorder.stop()
        permission?.resume(returning: true)
        do { try await task.value; XCTFail("The pending start should be cancelled") }
        catch is CancellationError { }
        XCTAssertFalse(recorder.isRecording)
        XCTAssertFalse(recorder.isStarting)
    }
}
