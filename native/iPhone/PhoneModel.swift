import Foundation
import Observation
import TalkBugsCore
import UIKit

@MainActor @Observable final class PhoneModel {
    let room = RoomModel()
    let recorder = VoiceRecorder()
    let store = VoiceStore()
    private let transcriber = LocalTranscriber()
    private var work: Task<Void, Never>?
    private var recordingJob: VoiceJob?
    private var recordingTask: Task<Void, Never>?
    private var endingRecording = false
    private(set) var pending: [VoiceJob] = []
    private(set) var processing = false
    var error: String?
    var onChange: (() -> Void)?
    var receipts: [String: String] { UserDefaults.standard.dictionary(forKey: "receipts") as? [String: String] ?? [:] }
    init() { store.purge(); reload() }
    func reload() { store.purge(); pending = store.jobs() }
    func beginRecording() {
        guard recordingJob == nil, !recorder.isStarting, !recorder.isRecording else { return }
        guard pending.count < 20 else { error = VoiceError.queueFull.localizedDescription; return }
        var job = VoiceJob(room: room.room, session: room.session)
        #if DEBUG && targetEnvironment(simulator)
        job.text = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_TRANSCRIPT"]
        #endif
        recordingJob = job; endingRecording = false; error = nil
        recordingTask = Task { [weak self, job] in
            guard let self else { return }
            do {
                try await self.recorder.start(at: self.store.audio(job.id)) { [weak self] success in
                    guard let self, self.recordingJob?.id == job.id else { return }
                    self.recordingJob = nil; self.recordingTask = nil
                    guard success else { self.store.remove(job.id); self.error = VoiceError.recordingFailed.localizedDescription; return }
                    do { try self.store.save(job); self.reload(); self.process() }
                    catch { self.error = error.localizedDescription }
                }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } catch {
                guard self.recordingJob?.id == job.id else { return }
                self.recordingJob = nil; self.recordingTask = nil; self.store.remove(job.id)
                if !(error is CancellationError) { self.error = error.localizedDescription }
            }
        }
    }
    func endRecording() {
        guard recordingJob != nil, !endingRecording else { return }
        endingRecording = true
        // A tap or a released permission request must never become a latched microphone.
        if recorder.isRecording, recorder.duration >= 0.2 { recorder.stop() }
        else { cancelRecording() }
    }
    func cancelRecording() {
        recordingTask?.cancel(); recordingTask = nil
        recorder.cancel()
        if let job = recordingJob { store.remove(job.id) }; recordingJob = nil
    }
    func retry(_ id: UUID) {
        guard var job = store.jobs().first(where: { $0.id == id }) else { return }
        job.error = nil; try? store.save(job); reload(); process()
    }
    func discard(_ id: UUID) { receipt(id, "discarded"); store.remove(id); reload(); onChange?() }
    func receive() { reload(); process() }
    func receiveFile(_ url: URL, job: VoiceJob) {
        defer { try? FileManager.default.removeItem(at: url) }
        if ["sent", "discarded"].contains(receipts[job.id.uuidString]) { onChange?(); return }
        do { try store.receive(url, job: job); receive() }
        catch { receipt(job.id, error.localizedDescription); onChange?() }
    }
    func process() {
        guard work == nil else { return }
        work = Task { [weak self] in
            guard let self else { return }
            let background = UIApplication.shared.beginBackgroundTask(withName: "Finish spoken message") { [weak self] in
                Task { @MainActor in self?.work?.cancel() }
            }
            defer {
                self.processing = false; self.work = nil
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
                self.reload(); self.onChange?()
                if !Task.isCancelled, self.pending.contains(where: { $0.error == nil }) { self.process() }
            }
            for var job in self.store.jobs() where job.error == nil {
                if Task.isCancelled { return }
                self.processing = true
                if ["sent", "discarded"].contains(self.receipts[job.id.uuidString]) { self.store.remove(job.id); continue }
                do {
                    if job.text == nil {
                        job.text = try await self.transcriber.transcribe(self.store.audio(job.id))
                        if self.receipts[job.id.uuidString] == "discarded" { continue }
                        try self.store.save(job)
                        // Once transcribed, keep only text for network retries.
                        try? FileManager.default.removeItem(at: self.store.audio(job.id))
                    }
                    try Task.checkCancellation()
                    try await RoomAPI(baseURL: self.room.baseURL, room: job.room, session: job.session).send(Transcript(id: job.id, text: job.text!))
                    self.receipt(job.id, "sent"); self.store.remove(job.id)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } catch is CancellationError { return }
                catch {
                    if self.receipts[job.id.uuidString] == "discarded" { continue }
                    job.error = error.localizedDescription; try? self.store.save(job)
                    self.receipt(job.id, error.localizedDescription)
                }
                self.reload(); self.onChange?()
            }
        }
    }
    private func receipt(_ id: UUID, _ value: String) {
        var values = receipts
        values[id.uuidString] = value
        var order = UserDefaults.standard.stringArray(forKey: "receiptOrder") ?? []
        order.removeAll { $0 == id.uuidString }; order.append(id.uuidString)
        while order.count > 100 { values.removeValue(forKey: order.removeFirst()) }
        UserDefaults.standard.set(values, forKey: "receipts"); UserDefaults.standard.set(order, forKey: "receiptOrder")
    }
}
