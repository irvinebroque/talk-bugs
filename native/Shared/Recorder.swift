import AVFoundation
import Foundation
import Observation
import TalkBugsCore

@MainActor @Observable final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    private(set) var isRecording = false
    private(set) var isStarting = false
    private(set) var elapsed = 0
    private var recorder: AVAudioRecorder?
    private var generation = 0
    private var timer: Task<Void, Never>?
    private var completion: ((Bool) -> Void)?
    private var interrupted: NSObjectProtocol?
    override init() {
        super.init()
        interrupted = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
    }
    func start(at url: URL, completion: @escaping (Bool) -> Void) async throws {
        guard !isRecording, !isStarting else { throw VoiceError.recordingFailed }
        isStarting = true
        let attempt = generation
        defer { isStarting = false }
        guard await AVAudioApplication.requestRecordPermission() else { throw VoiceError.microphoneDenied }
        guard attempt == generation else { throw CancellationError() }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
        recorder.delegate = self
        guard recorder.record(forDuration: 30) else { try? session.setActive(false); throw VoiceError.recordingFailed }
        self.recorder = recorder; self.completion = completion; isRecording = true; elapsed = 0
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self, self.isRecording else { return }
                self.elapsed = Int(self.recorder?.currentTime ?? 0)
            }
        }
    }
    func stop() { recorder?.stop() }
    func cancel() { generation += 1; completion = nil; recorder?.stop(); finish(false) }
    private func finish(_ success: Bool, expected: ObjectIdentifier? = nil) {
        guard isRecording else { return }
        if let expected, recorder.map(ObjectIdentifier.init) != expected { return }
        isRecording = false; timer?.cancel(); timer = nil
        recorder = nil
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
