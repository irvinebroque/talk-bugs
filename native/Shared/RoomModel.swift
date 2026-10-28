import Foundation
import Observation
import TalkBugsCore

@MainActor @Observable final class RoomModel {
    private(set) var room: UUID
    private(set) var encrypted = false
    private(set) var roomKey: String?
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
        let saved = UserDefaults.standard.string(forKey: "room").flatMap(UUID.init(uuidString:))
        room = saved ?? UUID()
        encrypted = saved == nil || UserDefaults.standard.bool(forKey: "encryptedRoom")
        if encrypted {
            roomKey = saved == nil ? RoomCrypto.generateKey() : RoomKeys.load(room)
            if let roomKey { do { try RoomKeys.save(roomKey, room: room) } catch { self.error = error.localizedDescription } }
        }
        #if DEBUG && targetEnvironment(simulator)
        if let value = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_ROOM"], let id = UUID(uuidString: value) {
            room = id; roomKey = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_KEY"]; encrypted = roomKey != nil
            if let roomKey { try? RoomKeys.save(roomKey, room: room) }
        }
        if let value = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"], let url = URL(string: value) { baseURL = url }
        #endif
        UserDefaults.standard.set(room.uuidString, forKey: "room")
        UserDefaults.standard.set(encrypted, forKey: "encryptedRoom")
    }
    var api: RoomAPI { RoomAPI(baseURL: baseURL, room: room, session: session, key: roomKey, encrypted: encrypted) }
    var inviteURL: URL { RoomLink.url(room, key: roomKey, encrypted: encrypted) }
    func newRoom() { join(UUID(), key: RoomCrypto.generateKey(), encrypted: true) }
    func join(_ id: UUID, key: String? = nil, encrypted: Bool = false, session newSession: UUID? = nil) {
        let encrypted = encrypted || key != nil
        if !encrypted && RoomKeys.load(id) != nil { error = RoomCryptoError.missingKey.localizedDescription; return }
        if encrypted {
            guard let key else { error = RoomCryptoError.missingKey.localizedDescription; return }
            do { try RoomKeys.save(key, room: id) } catch { self.error = error.localizedDescription; return }
        }
        guard room != id || roomKey != key || self.encrypted != encrypted || (newSession != nil && newSession != session) else { return }
        self.encrypted = encrypted; self.roomKey = key
        UserDefaults.standard.set(encrypted, forKey: "encryptedRoom")
        let wasActive = polling != nil
        pause(); room = id;
        if let newSession { session = newSession; Identity.adopt(newSession) }
        conversation = Conversation(); messages = []; participants = []; selfID = nil; etag = nil
        UserDefaults.standard.set(id.uuidString, forKey: "room"); onRoomChange?()
        if wasActive { resume() }
    }
    func resume() {
        guard polling == nil else { return }
        if encrypted && roomKey == nil { roomKey = RoomKeys.load(room) }
        guard !encrypted || roomKey != nil else { error = RoomCryptoError.missingKey.localizedDescription; return }
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
                    self.connected = false; self.error = (error as? RoomCryptoError)?.localizedDescription ?? "Trying to reconnect…"
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
