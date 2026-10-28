import Foundation

public struct RoomAPI: Sendable {
    public let baseURL: URL
    public let room: UUID
    public let session: UUID
    private let transport: URLSession
    public init(baseURL: URL = RoomLink.origin, room: UUID, session: UUID, transport: URLSession = .shared) {
        self.baseURL = baseURL; self.room = room; self.session = session; self.transport = transport
    }
    private func request(_ path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: "api/rooms/\(room.uuidString.lowercased())/\(path)"))
        request.httpMethod = method; request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(session.uuidString.lowercased())", forHTTPHeaderField: "Authorization")
        return request
    }
    public func snapshot(etag: String? = nil) async throws -> (Snapshot?, String?) {
        var request = request("snapshot")
        request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        let (data, response) = try await transport.data(for: request)
        let http = try checked(response, data: data, accepting: [200, 304])
        return (http.statusCode == 304 ? nil : try JSONDecoder().decode(Snapshot.self, from: data), http.value(forHTTPHeaderField: "ETag") ?? etag)
    }
    public func send(_ transcript: Transcript) async throws {
        var request = request("transcript", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(transcript)
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
