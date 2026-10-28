import Foundation

public struct Participant: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
}
public struct ChatMessage: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let utteranceId: String
    public let speaker: Participant
    public let revision: Int
    public var text: String
    public let status: String
    public let order: Int
    public let startedAt: Double
    public let updatedAt: Double
    public var sealed: Sealed? = nil
}
public struct Snapshot: Codable, Sendable {
    public let participant: Participant
    enum CodingKeys: String, CodingKey { case participant = "self", participants, messages }
    public let participants: [Participant]
    public var messages: [ChatMessage]
}
public struct Transcript: Codable, Equatable, Sendable {
    public let type = "transcript"
    public let utteranceId: String
    public let revision: Int
    public var text: String
    public let final: Bool
    public var sealed: Sealed? = nil
    public init(id: UUID, text: String, revision: Int = 1, final: Bool = true) {
        utteranceId = id.uuidString.lowercased(); self.text = text
        self.revision = revision; self.final = final
    }
    enum CodingKeys: String, CodingKey { case type, utteranceId, revision, text, final, sealed }
}
public struct RoomInvite: Equatable, Sendable {
    public let room: UUID
    public let key: String?
}
public enum RoomLink {
    public static let origin = URL(string: "https://talk-bugs.roundtrip.workers.dev")!
    public static func url(_ room: UUID, key: String? = nil, encrypted: Bool = false) -> URL {
        var parts = URLComponents(url: origin.appending(path: "\(encrypted || key != nil ? "e" : "r")/\(room.uuidString.lowercased())"), resolvingAgainstBaseURL: false)!
        if let key { parts.fragment = "key=\(key)" }
        return parts.url!
    }
    public static func invitation(_ url: URL) -> RoomInvite? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "talk-bugs", ["room", "encrypted-room"].contains(url.host), parts.count == 1, let room = UUID(uuidString: parts[0]) {
            return invite(room: room, encrypted: url.host == "encrypted-room", fragment: url.fragment)
        }
        guard url.scheme == "https", url.host == origin.host, url.port == nil, url.user == nil, url.password == nil,
              parts.count == 2, ["r", "e"].contains(parts[0]), let room = UUID(uuidString: parts[1]) else { return nil }
        return invite(room: room, encrypted: parts[0] == "e", fragment: url.fragment)
    }
    private static func invite(room: UUID, encrypted: Bool, fragment: String?) -> RoomInvite? {
        if !encrypted { return fragment == nil ? RoomInvite(room: room, key: nil) : nil }
        guard let fragment, fragment.hasPrefix("key=") else { return nil }
        let key = String(fragment.dropFirst(4))
        return RoomCrypto.validKey(key) ? RoomInvite(room: room, key: key) : nil
    }
    // Legacy parser must never strip a secret from an encrypted invitation.
    public static func parse(_ url: URL) -> UUID? {
        guard let invite = invitation(url), invite.key == nil else { return nil }
        return invite.room
    }
}
public struct VoiceJob: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let room: UUID
    public let session: UUID
    public let created: Date
    public var text: String?
    public var error: String?
    public var encrypted: Bool? = nil
    public var keyID: String? = nil
    public init(id: UUID = UUID(), room: UUID, session: UUID, encrypted: Bool = false, keyID: String? = nil) {
        self.encrypted = encrypted ? true : nil
        self.keyID = keyID
        self.id = id; self.room = room; self.session = session; created = Date()
    }
}
