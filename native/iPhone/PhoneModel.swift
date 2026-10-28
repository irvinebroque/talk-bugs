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
    private(set) var pending: [VoiceJob] = []
    private(set) var processing = false
    var error: String?
    var onChange: (() -> Void)?
    var receipts: [String: String] { UserDefaults.standard.dictionary(forKey: "receipts") as? [String: String] ?? [:] }
    init() { store.purge(); reload() }
    func reload() { store.purge(); pending = store.jobs() }
    func toggleRecording() async {
        guard !recorder.isStarting else { return }
        if recorder.isRecording { recorder.stop(); return }
        guard pending.count < 20 else { error = VoiceError.queueFull.localizedDescription; return }
        let job = VoiceJob(room: room.room, session: room.session)
        error = nil; recordingJob = job
        #if DEBUG && targetEnvironment(simulator)
        if let text = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_TRANSCRIPT"] {
            // UI-test speech source; compiled out of every device build.
            recordingJob = nil
            var testJob = job; testJob.text = text
            do { try store.save(testJob); reload(); process() } catch { self.error = error.localizedDescription }
            return
        }
        #endif
        do {
            try await recorder.start(at: store.audio(job.id)) { [weak self] success in
                guard let self else { return }
                self.recordingJob = nil
                guard success else { self.store.remove(job.id); self.error = VoiceError.recordingFailed.localizedDescription; return }
                do { try self.store.save(job); self.reload(); self.process() }
                catch { self.error = error.localizedDescription }
            }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } catch { recordingJob = nil; store.remove(job.id); self.error = error.localizedDescription }
    }
    func cancelRecording() {
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
