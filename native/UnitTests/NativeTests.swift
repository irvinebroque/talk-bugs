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
