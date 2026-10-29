import Foundation
import Testing
@testable import TalkBugsCore

struct CoreTests {
    @Test func invitationsOnlyAcceptOurRooms() {
        let room = UUID()
        #expect(RoomLink.parse(RoomLink.url(room)) == room)
        #expect(RoomLink.url(room).host == "talkbugs.com")
        #expect(RoomLink.parse(URL(string: "https://talk-bugs.roundtrip.workers.dev/r/\(room)")!) == room)
        #expect(RoomLink.parse(URL(string: "https://talkbugs.com.evil.test/r/\(room)")!) == nil)
        #expect(RoomLink.parse(URL(string: "talk-bugs://room/\(room)")!) == room)
        #expect(RoomLink.parse(URL(string: "https://example.com/r/\(room)")!) == nil)
        #expect(RoomLink.parse(URL(string: "https://talk-bugs.roundtrip.workers.dev/r/nope")!) == nil)
        #expect(RoomLink.parse(URL(string: "http://talk-bugs.roundtrip.workers.dev/r/\(room)")!) == nil)
    }
    @Test func transcriptContainsOnlyTextAndProtocolFields() throws {
        let id = UUID(), text = "A completed spoken message."
        let data = try JSONEncoder().encode(Transcript(id: id, text: text))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(json.keys) == Set(["type", "utteranceId", "revision", "text", "final"]))
        #expect(json["utteranceId"] as? String == id.uuidString.lowercased())
        #expect(json["text"] as? String == text)
        #expect(json["final"] as? Bool == true)
    }
    @Test func transferredRecordingSurvivesRelaunchAndRetriesKeepItsIdentity() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VoiceStore(directory: directory)
        let source = directory.appending(path: "source.wav")
        try Data(repeating: 0, count: 32000).write(to: source)
        let job = VoiceJob(room: UUID(), session: UUID())
        try store.receive(source, job: job)
        var stored = try #require(VoiceStore(directory: directory).jobs().first)
        #expect(stored == job)
        stored.text = "Keep this transcription for retries"; stored.error = "Offline"
        try store.save(stored)
        try FileManager.default.removeItem(at: store.audio(job.id))
        try store.receive(source, job: job)
        let retry = try #require(store.jobs().first)
        #expect(retry.id == job.id && retry.session == job.session && retry.room == job.room)
        #expect(retry.text == stored.text && retry.error == nil)
        #expect(store.jobs().count == 1)
        #expect(!FileManager.default.fileExists(atPath: store.audio(job.id).path))
        store.remove(job.id)
        #expect(store.jobs().isEmpty)
    }
    @Test func incomingAudioAndQueueAreBounded() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VoiceStore(directory: directory), source = directory.appending(path: "source.wav")
        try Data(repeating: 0, count: 1_100_001).write(to: source)
        #expect(throws: (any Error).self) { try store.receive(source, job: VoiceJob(room: UUID(), session: UUID())) }
        try Data(repeating: 0, count: 100).write(to: source)
        for _ in 0..<20 { try store.receive(source, job: VoiceJob(room: UUID(), session: UUID())) }
        #expect(throws: (any Error).self) { try store.receive(source, job: VoiceJob(room: UUID(), session: UUID())) }
        #expect(store.jobs().count == 20)
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"] != nil))
    func realHTTPClientsExchangeTextAndRetryWithoutDuplicates() async throws {
        let base = try #require(URL(string: ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"]!))
        let room = UUID()
        let one = RoomAPI(baseURL: base, room: room, session: UUID())
        let two = RoomAPI(baseURL: base, room: room, session: UUID())
        let three = RoomAPI(baseURL: base, room: room, session: UUID())
        let (initial, _) = try await one.snapshot()
        #expect(initial?.messages.isEmpty == true)
        _ = try await two.snapshot(); _ = try await three.snapshot()
        let messages = (0..<3).map { Transcript(id: UUID(), text: "Native speaker \($0)") }
        async let a: Void = one.send(messages[0])
        async let b: Void = two.send(messages[1])
        async let c: Void = three.send(messages[2])
        _ = try await (a,b,c)
        try await one.send(messages[0])
        let (snapshot, etag) = try await two.snapshot()
        #expect(snapshot?.messages.count == 3)
        #expect(snapshot?.participants.count == 3)
        #expect(Set(snapshot!.messages.map(\.text)) == Set(messages.map(\.text)))
        let (unchanged, _) = try await two.snapshot(etag: etag)
        #expect(unchanged == nil)
        let isolated = RoomAPI(baseURL: base, room: UUID(), session: UUID())
        let (empty, _) = try await isolated.snapshot()
        #expect(empty?.messages.isEmpty == true)
        await one.leave(); await two.leave(); await three.leave(); await isolated.leave()
    }
}
