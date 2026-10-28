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
    public let text: String
    public let status: String
    public let order: Int
    public let startedAt: Double
    public let updatedAt: Double
}
public struct Snapshot: Codable, Sendable {
    public let participant: Participant
    enum CodingKeys: String, CodingKey { case participant = "self", participants, messages }
    public let participants: [Participant]
    public let messages: [ChatMessage]
}
public struct Transcript: Codable, Equatable, Sendable {
    public let type = "transcript"
    public let utteranceId: String
    public let revision: Int
    public let text: String
    public let final: Bool
    public init(id: UUID, text: String, revision: Int = 1, final: Bool = true) {
        utteranceId = id.uuidString.lowercased(); self.text = text
        self.revision = revision; self.final = final
    }
    enum CodingKeys: String, CodingKey { case type, utteranceId, revision, text, final }
}
public enum RoomLink {
    public static let origin = URL(string: "https://talk-bugs.roundtrip.workers.dev")!
    public static func url(_ room: UUID) -> URL { origin.appending(path: "r/\(room.uuidString.lowercased())") }
    public static func parse(_ url: URL) -> UUID? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "talk-bugs", url.host == "room", parts.count == 1 { return UUID(uuidString: parts[0]) }
        guard url.scheme == "https", url.host == origin.host, parts.count == 2, parts[0] == "r" else { return nil }
        return UUID(uuidString: parts[1])
    }
}
public struct VoiceJob: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let room: UUID
    public let session: UUID
    public let created: Date
    public var text: String?
    public var error: String?
    public init(id: UUID = UUID(), room: UUID, session: UUID) {
        self.id = id; self.room = room; self.session = session; created = Date()
    }
}
