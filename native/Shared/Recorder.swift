import AVFoundation
import Foundation
import Observation
import TalkBugsCore

@MainActor @Observable final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    private(set) var isRecording = false
    private(set) var isStarting = false
    private var recorder: AVAudioRecorder?
    private var generation = 0
    private var completion: ((Bool) -> Void)?
    private var interrupted: NSObjectProtocol?
    private var startedAt: Date?
    private let requestPermission: @MainActor () async -> Bool
    var duration: TimeInterval { recorder?.currentTime ?? startedAt.map { Date().timeIntervalSince($0) } ?? 0 }
    init(requestPermission: @escaping @MainActor () async -> Bool = { await AVAudioApplication.requestRecordPermission() }) {
        self.requestPermission = requestPermission
        super.init()
        interrupted = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
    }
    func start(at url: URL, completion: @escaping (Bool) -> Void) async throws {
        try Task.checkCancellation()
        guard !isRecording, !isStarting else { throw VoiceError.recordingFailed }
        isStarting = true
        let attempt = generation
        defer { isStarting = false }
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["TALK_BUGS_TEST_TRANSCRIPT"] != nil {
            self.completion = completion; startedAt = Date(); isRecording = true
            return
        }
        #endif
        guard await requestPermission() else { throw VoiceError.microphoneDenied }
        try Task.checkCancellation()
        guard attempt == generation else { throw CancellationError() }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
        recorder.delegate = self
        guard recorder.record(forDuration: 30) else { try? session.setActive(false); throw VoiceError.recordingFailed }
        self.recorder = recorder; self.completion = completion; isRecording = true; startedAt = Date()
    }
    func stop() {
        if isStarting { generation += 1 }
        if let recorder { recorder.stop() } else { finish(true) }
    }
    func cancel() { generation += 1; completion = nil; recorder?.stop(); finish(false) }
    private func finish(_ success: Bool, expected: ObjectIdentifier? = nil) {
        guard isRecording else { return }
        if let expected, recorder.map(ObjectIdentifier.init) != expected { return }
        isRecording = false
        recorder = nil; startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let done = completion; completion = nil; done?(success)
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor in self.finish(flag, expected: id) }
    }
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor in self.finish(false, expected: id) }
    }
}
