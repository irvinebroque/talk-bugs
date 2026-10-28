import Foundation

public struct RoomAPI: Sendable {
    public let baseURL: URL
    public let room: UUID
    public let session: UUID
    private let key: String?
    private let encrypted: Bool
    private let transport: URLSession
    public init(baseURL: URL = RoomLink.origin, room: UUID, session: UUID, key: String? = nil, encrypted: Bool = false, transport: URLSession = .shared) {
        self.key = key; self.encrypted = encrypted || key != nil
        self.baseURL = baseURL; self.room = room; self.session = session; self.transport = transport
    }
    private func request(_ path: String, method: String = "GET") throws -> URLRequest {
        if encrypted { _ = try RoomCrypto(key: key ?? "") }
        var request = URLRequest(url: baseURL.appending(path: "api/\(encrypted ? "encrypted-rooms" : "rooms")/\(room.uuidString.lowercased())/\(path)"))
        request.httpMethod = method; request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(session.uuidString.lowercased())", forHTTPHeaderField: "Authorization")
        return request
    }
    public func snapshot(etag: String? = nil) async throws -> (Snapshot?, String?) {
        var request = try request("snapshot")
        request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        let (data, response) = try await transport.data(for: request)
        let http = try checked(response, data: data, accepting: [200, 304])
        if http.statusCode == 304 { return (nil, http.value(forHTTPHeaderField: "ETag") ?? etag) }
        var snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        if encrypted {
            let crypto = try RoomCrypto(key: key ?? "")
            snapshot.messages = try snapshot.messages.map { try crypto.open($0, room: room) }
        } else if snapshot.messages.contains(where: { $0.sealed != nil }) { throw RoomCryptoError.invalidMessage }
        return (snapshot, http.value(forHTTPHeaderField: "ETag") ?? etag)
    }
    public func send(_ transcript: Transcript) async throws {
        var request = try request("transcript", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let wire = encrypted ? try RoomCrypto(key: key ?? "").seal(transcript, room: room, speaker: RoomCrypto.speakerID(session)) : transcript
        request.httpBody = try JSONEncoder().encode(wire)
        let (data, response) = try await transport.data(for: request)
        _ = try checked(response, data: data, accepting: [200])
        struct Acknowledgement: Decodable { let type: String; let utteranceId: String; let revision: Int }
        let ack = try JSONDecoder().decode(Acknowledgement.self, from: data)
        guard ack.type == "ack", ack.utteranceId == transcript.utteranceId, ack.revision >= transcript.revision else { throw URLError(.badServerResponse) }
    }
    public func leave() async {
        _ = try? await transport.data(for: request("leave", method: "POST"))
    }
    private func checked(_ response: URLResponse, data: Data, accepting: [Int]) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard accepting.contains(http.statusCode) else { throw APIError(status: http.statusCode, message: String(data: data, encoding: .utf8) ?? "Could not reach the room.") }
        return http
    }
}
public struct APIError: LocalizedError, Sendable {
    public let status: Int
    public let message: String
    public var errorDescription: String? { message }
}
