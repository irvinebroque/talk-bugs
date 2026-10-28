import Foundation
import CryptoKit

public struct Sealed: Codable, Equatable, Sendable {
    public let v: Int
    public let iv: String
    public let ciphertext: String
}
public enum RoomCryptoError: LocalizedError {
    case missingKey, invalidMessage
    public var errorDescription: String? {
        switch self {
        case .missingKey: "Open the full invite link to unlock this room."
        case .invalidMessage: "Could not decrypt a message. Check the original invite link."
        }
    }
}
public struct RoomCrypto: Sendable {
    private let key: SymmetricKey
    public init(key: String) throws {
        guard Self.validKey(key), let data = Data(base64url: key) else { throw RoomCryptoError.missingKey }
        self.key = SymmetricKey(data: data)
    }
    public static func generateKey() -> String { SymmetricKey(size: .bits256).withUnsafeBytes { Data($0).base64url } }
    public static func validKey(_ key: String) -> Bool { key.count == 43 && Data(base64url: key)?.count == 32 }
    public static func keyID(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    public static func speakerID(_ session: UUID) -> String {
        SHA256.hash(data: Data(session.uuidString.lowercased().utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func context(room: UUID, speaker: String, id: String, revision: Int, final: Bool) throws -> Data {
        guard speaker.count == 64, speaker.allSatisfy({ "0123456789abcdef".contains($0) }), UUID(uuidString: id) != nil,
              revision > 0, Int64(revision) <= 9_007_199_254_740_991 else { throw RoomCryptoError.invalidMessage }
        return Data("talk-bugs:e2ee:v1\n\(room.uuidString.lowercased())\n\(speaker)\n\(id.lowercased())\n\(revision)\n\(final ? 1 : 0)".utf8)
    }
    public func seal(_ transcript: Transcript, room: UUID, speaker: String) throws -> Transcript {
        guard transcript.text.utf16.count <= 4000 else { throw RoomCryptoError.invalidMessage }
        let aad = try context(room: room, speaker: speaker, id: transcript.utteranceId, revision: transcript.revision, final: transcript.final)
        let box = try AES.GCM.seal(Data(transcript.text.utf8), using: key, authenticating: aad)
        var wire = transcript
        wire.text = ""
        wire.sealed = Sealed(v: 1, iv: box.nonce.withUnsafeBytes { Data($0).base64url }, ciphertext: (box.ciphertext + box.tag).base64url)
        return wire
    }
    public func open(_ message: ChatMessage, room: UUID) throws -> ChatMessage {
        guard let sealed = message.sealed, sealed.v == 1, message.text.isEmpty,
              message.id == "\(message.speaker.id)/\(message.utteranceId)", ["live", "final", "interrupted"].contains(message.status),
              let iv = Data(base64url: sealed.iv), iv.count == 12,
              let bytes = Data(base64url: sealed.ciphertext), bytes.count >= 16, bytes.count <= 12016 else { throw RoomCryptoError.invalidMessage }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: bytes.dropLast(16), tag: bytes.suffix(16))
            let aad = try context(room: room, speaker: message.speaker.id, id: message.utteranceId, revision: message.revision, final: message.status == "final")
            let data = try AES.GCM.open(box, using: key, authenticating: aad)
            guard let text = String(data: data, encoding: .utf8), text.utf16.count <= 4000 else { throw RoomCryptoError.invalidMessage }
            var result = message; result.text = text; return result
        } catch { throw RoomCryptoError.invalidMessage }
    }
}
private extension Data {
    var base64url: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64url value: String) {
        guard !value.isEmpty, value.allSatisfy({ "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".contains($0) }) else { return nil }
        let base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard let bytes = Data(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)), bytes.base64url == value else { return nil }
        self = bytes
    }
}
