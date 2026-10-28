import Foundation
import Observation
import TalkBugsCore

@MainActor @Observable final class RoomModel {
    private(set) var room: UUID
    private(set) var session = Identity.session()
    private(set) var conversation = Conversation()
    private(set) var messages: [ChatMessage] = []
    private(set) var participants: [Participant] = []
    private(set) var selfID: String?
    private(set) var connected = false
    var error: String?
    private var polling: Task<Void, Never>?
    private var etag: String?
    var baseURL: URL = RoomLink.origin
    var onRoomChange: (() -> Void)?
    init() {
        room = UserDefaults.standard.string(forKey: "room").flatMap(UUID.init(uuidString:)) ?? UUID()
        #if DEBUG && targetEnvironment(simulator)
        if let value = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_ROOM"], let id = UUID(uuidString: value) { room = id }
        if let value = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"], let url = URL(string: value) { baseURL = url }
        #endif
        UserDefaults.standard.set(room.uuidString, forKey: "room")
    }
    var api: RoomAPI { RoomAPI(baseURL: baseURL, room: room, session: session) }
    func join(_ id: UUID, session newSession: UUID? = nil) {
        guard room != id || (newSession != nil && newSession != session) else { return }
        let wasActive = polling != nil
        pause(); room = id;
        if let newSession { session = newSession; Identity.adopt(newSession) }
        conversation = Conversation(); messages = []; participants = []; selfID = nil; etag = nil
        UserDefaults.standard.set(id.uuidString, forKey: "room"); onRoomChange?()
        if wasActive { resume() }
    }
    func resume() {
        guard polling == nil else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let requestedRoom = self.room
                    let (snapshot, tag) = try await self.api.snapshot(etag: self.etag)
                    guard !Task.isCancelled, requestedRoom == self.room else { return }
                    self.etag = tag; self.connected = true; self.error = nil
                    if let snapshot { self.selfID = snapshot.participant.id; self.participants = snapshot.participants; self.messages = snapshot.messages.filter { !$0.text.isEmpty }; self.conversation.update(participants: snapshot.participants, messages: self.messages, selfID: snapshot.participant.id) }
                } catch {
                    guard !Task.isCancelled else { return }
                    self.connected = false; self.error = "Trying to reconnect…"
                }
                try? await Task.sleep(for: .seconds(self.connected ? 1 : 3))
            }
        }
    }
    func pause() {
        polling?.cancel(); polling = nil; connected = false
        // Phone and Watch share an identity. Let its presence lease expire rather
        // than marking the other active device offline when this one backgrounds.
    }
}
