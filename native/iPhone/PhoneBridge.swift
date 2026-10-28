import Foundation
import TalkBugsCore
import WatchConnectivity

@MainActor final class PhoneBridge: NSObject, WCSessionDelegate {
    let model: PhoneModel
    init(model: PhoneModel) {
        self.model = model
        super.init()
        model.onChange = { [weak self] in self?.sync() }
        model.room.onRoomChange = { [weak self] in self?.sync() }
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }
    func sync() {
        guard WCSession.default.activationState == .activated, WCSession.default.isWatchAppInstalled else { return }
        try? WCSession.default.updateApplicationContext(["room": model.room.room.uuidString, "receipts": model.receipts])
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {
        Task { @MainActor in self.sync(); self.model.receive() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // WCSession owns the source only until this delegate returns: copy synchronously.
        guard let data = file.metadata?["job"] as? Data,
              let job = try? JSONDecoder().decode(VoiceJob.self, from: data) else { return }
        do {
            let copy = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".wav")
            try FileManager.default.copyItem(at: file.fileURL, to: copy)
            Task { @MainActor in self.model.receiveFile(copy, job: job) }
        } catch {
            Task { @MainActor in self.model.error = "A Watch recording could not be received. Try again on the Watch." }
        }
    }
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let raw = userInfo["discard"] as? String, let id = UUID(uuidString: raw) else { return }
        Task { @MainActor in self.model.discard(id) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        let retry = (message["retry"] as? String).flatMap(UUID.init(uuidString:))
        // Reply through a Sendable wrapper because WatchConnectivity callbacks predate Swift concurrency.
        let reply = Reply(replyHandler)
        Task { @MainActor in
            if let retry { self.model.retry(retry) }
            reply.call(["room": self.model.room.room.uuidString, "receipts": self.model.receipts])
            self.model.receive()
        }
    }
}
private struct Reply: @unchecked Sendable {
    let call: ([String: Any]) -> Void
    init(_ call: @escaping ([String: Any]) -> Void) { self.call = call }
}
