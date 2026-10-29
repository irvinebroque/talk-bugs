import Foundation
import Testing
@testable import TalkBugsCore

struct EncryptionTests {
    struct Fixture: Decodable { let key: String; let room: UUID; let session: UUID; let text: String; let message: ChatMessage }
    private func fixture() throws -> Fixture {
        let url = try #require(Bundle.module.url(forResource: "e2ee-v1", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    @Test func webCryptoVectorAndAuthenticatedContext() throws {
        let f = try fixture(), crypto = try RoomCrypto(key: f.key)
        #expect(RoomCrypto.speakerID(f.session) == f.message.speaker.id)
        #expect(try crypto.open(f.message, room: f.room).text == f.text)
        #expect(throws: (any Error).self) { try crypto.open(f.message, room: UUID()) }
        #expect(throws: (any Error).self) { try RoomCrypto(key: RoomCrypto.generateKey()).open(f.message, room: f.room) }
        var corrupted = f.message
        corrupted.sealed = Sealed(v: 1, iv: "AAAAAAAAAAAAAAAA", ciphertext: f.message.sealed!.ciphertext)
        #expect(throws: (any Error).self) { try crypto.open(corrupted, room: f.room) }
        corrupted = f.message; corrupted.text = "Do not display unencrypted text"
        #expect(throws: (any Error).self) { try crypto.open(corrupted, room: f.room) }
        let transcript = Transcript(id: UUID(), text: f.text)
        let a = try crypto.seal(transcript, room: f.room, speaker: f.message.speaker.id)
        let b = try crypto.seal(transcript, room: f.room, speaker: f.message.speaker.id)
        #expect(a.text.isEmpty && a.sealed?.iv != b.sealed?.iv)
        #expect(!String(data: try JSONEncoder().encode(a), encoding: .utf8)!.contains(f.text))
    }
    @Test func invitationsCannotLoseTheirKeyOrDowngrade() throws {
        let f = try fixture(), url = RoomLink.url(f.room, key: f.key)
        #expect(url.path.hasPrefix("/e/"))
        #expect(RoomLink.invitation(url)?.key == f.key)
        #expect(url.host == "talkbugs.com")
        let oldInvite = URL(string: "https://talk-bugs.roundtrip.workers.dev/e/\(f.room)#key=\(f.key)")!
        #expect(RoomLink.invitation(oldInvite) == RoomLink.invitation(url))
        #expect(RoomLink.parse(url) == nil)
        #expect(RoomLink.invitation(RoomLink.url(f.room, encrypted: true)) == nil)
        #expect(RoomLink.invitation(URL(string: "\(RoomLink.url(f.room))#key=\(f.key)")!) == nil)
        #expect(RoomLink.invitation(URL(string: "talk-bugs://encrypted-room/\(f.room)#key=\(f.key)")!)?.key == f.key)
        #expect(!RoomCrypto.validKey(f.key + "="))
    }
    @Test func queuedWatchRecordingKeepsItsEncryptedRoomWithoutStoringTheKey() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VoiceStore(directory: directory)
        let job = VoiceJob(room: UUID(), session: UUID(), encrypted: true)
        try store.save(job)
        #expect(VoiceStore(directory: directory).jobs().first?.encrypted == true)
        let json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: store.metadata(job.id))) as? [String: Any])
        #expect(json["key"] == nil && json["roomKey"] == nil)
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["TALK_BUGS_INTEROP_KEY"] != nil))
    func browserAndSwiftExchangeEncryptedMessages() async throws {
        let env = ProcessInfo.processInfo.environment
        let base = try #require(URL(string: env["TALK_BUGS_TEST_SERVER"]!))
        let room = try #require(UUID(uuidString: env["TALK_BUGS_INTEROP_ROOM"]!))
        let api = RoomAPI(baseURL: base, room: room, session: UUID(), key: env["TALK_BUGS_INTEROP_KEY"]!)
        let (snapshot, _) = try await api.snapshot()
        #expect(snapshot?.messages.contains(where: { $0.text == "Browser encrypted hello 👋" }) == true)
        let reply = Transcript(id: UUID(), text: "Swift encrypted reply ✓")
        try await api.send(reply); try await api.send(reply)
        let (after, _) = try await api.snapshot()
        #expect(after?.messages.filter { $0.text == reply.text }.count == 1)
        let wrong = RoomAPI(baseURL: base, room: room, session: UUID(), key: RoomCrypto.generateKey())
        await #expect(throws: (any Error).self) { try await wrong.snapshot() }
        let missing = RoomAPI(baseURL: base, room: room, session: UUID(), encrypted: true)
        await #expect(throws: (any Error).self) { try await missing.send(reply) }
        await api.leave()
    }
}
