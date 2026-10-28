import Foundation
import Observation
import TalkBugsCore
import WatchConnectivity
import WatchKit

@MainActor @Observable final class WatchModel: NSObject, WCSessionDelegate {
    let room = RoomModel()
    let recorder = VoiceRecorder()
    let store = VoiceStore()
    private(set) var pending: [VoiceJob] = []
    private(set) var paired = UserDefaults.standard.bool(forKey: "pairedRoom")
    var error: String?
    private var recordingJob: VoiceJob?
    override init() {
        super.init(); store.purge(); pending = store.jobs()
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.environment["TALK_BUGS_TEST_ROOM"] != nil { paired = true }
        #endif
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }
    func refresh() {
        store.purge(); pending = store.jobs()
        guard WCSession.default.activationState == .activated else { return }
        apply(WCSession.default.receivedApplicationContext)
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(["sync": true], replyHandler: { @Sendable reply in
                let data = Context(reply)
                Task { @MainActor in self.apply(data.value) }
            }, errorHandler: { @Sendable _ in })
        }
        transferPending()
    }
    private func apply(_ context: [String: Any]) {
        if let raw = context["room"] as? String, let id = UUID(uuidString: raw), !recorder.isRecording {
            paired = true; UserDefaults.standard.set(true, forKey: "pairedRoom"); room.join(id)
        }
        if let receipts = context["receipts"] as? [String: String] {
            for var job in store.jobs() {
                guard let result = receipts[job.id.uuidString] else { continue }
                if result == "sent" || result == "discarded" {
                    store.remove(job.id); UserDefaults.standard.removeObject(forKey: "transferred.\(job.id)")
                    if result == "sent" { WKInterfaceDevice.current().play(.success) }
                }
                else { job.error = result; try? store.save(job) }
            }
        }
        pending = store.jobs()
    }
    func toggleRecording() async {
        guard !recorder.isStarting else { return }
        if recorder.isRecording { recorder.stop(); return }
        guard paired else { error = "Open talk-bugs on your iPhone first."; return }
        guard pending.count < 20 else { error = VoiceError.queueFull.localizedDescription; return }
        let job = VoiceJob(room: room.room, session: room.session)
        recordingJob = job; error = nil
        do {
            try await recorder.start(at: store.audio(job.id)) { [weak self] success in
                guard let self else { return }
                self.recordingJob = nil
                guard success else { self.store.remove(job.id); self.error = VoiceError.recordingFailed.localizedDescription; return }
                do { try self.store.save(job); self.pending = self.store.jobs(); self.transferPending() }
                catch { self.error = error.localizedDescription }
            }
            WKInterfaceDevice.current().play(.start)
        } catch { recordingJob = nil; store.remove(job.id); self.error = error.localizedDescription }
    }
    func cancelRecording() {
        recorder.cancel(); if let job = recordingJob { store.remove(job.id) }; recordingJob = nil
    }
    func transferPending() {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let active = Set(session.outstandingFileTransfers.compactMap { $0.file.metadata?["id"] as? String })
        for job in store.jobs() where job.error == nil && !active.contains(job.id.uuidString) {
            // A completed file transfer is not a delivered chat message. Keep the source until the iPhone acknowledges posting.
            if UserDefaults.standard.bool(forKey: "transferred.\(job.id)") { continue }
            guard let data = try? JSONEncoder().encode(job) else { continue }
            session.transferFile(store.audio(job.id), metadata: ["id": job.id.uuidString, "job": data])
        }
    }
    func retry(_ id: UUID) {
        guard var job = store.jobs().first(where: { $0.id == id }) else { return }
        job.error = nil; try? store.save(job); pending = store.jobs()
        UserDefaults.standard.removeObject(forKey: "transferred.\(job.id)")
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(["retry": id.uuidString], replyHandler: { @Sendable _ in }, errorHandler: { @Sendable _ in })
        }
        transferPending()
    }
    func discard(_ id: UUID) {
        WCSession.default.transferUserInfo(["discard": id.uuidString])
        for transfer in WCSession.default.outstandingFileTransfers where transfer.file.metadata?["id"] as? String == id.uuidString { transfer.cancel() }
        store.remove(id); UserDefaults.standard.removeObject(forKey: "transferred.\(id)"); pending = store.jobs()
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {
        Task { @MainActor in self.refresh() }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let context = Context(applicationContext)
        Task { @MainActor in self.apply(context.value) }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in self.refresh() } }
    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: (any Error)?) {
        guard let raw = fileTransfer.file.metadata?["id"] as? String, let id = UUID(uuidString: raw) else { return }
        let message = error?.localizedDescription
        Task { @MainActor in
            if let message, var job = self.store.jobs().first(where: { $0.id == id }) { job.error = message; try? self.store.save(job) }
            else if self.store.jobs().contains(where: { $0.id == id }) { UserDefaults.standard.set(true, forKey: "transferred.\(id)") }
            self.pending = self.store.jobs(); self.refresh()
        }
    }
}
private struct Context: @unchecked Sendable {
    let value: [String: Any]
    init(_ value: [String: Any]) { self.value = value }
}
