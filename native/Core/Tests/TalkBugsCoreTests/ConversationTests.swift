import Foundation
import XCTest
@testable import TalkBugsCore

final class ConversationTests: XCTestCase {
    private func person(_ id: String) throws -> Participant {
        try JSONDecoder().decode(Participant.self, from: Data("{\"id\":\"\(id)\",\"name\":\"Participant \(id)\"}".utf8))
    }
    private func message(_ id: String, _ speaker: Participant, _ text: String, order: Int, status: String = "final") -> ChatMessage {
        ChatMessage(id: id, utteranceId: id, speaker: speaker, revision: 1, text: text, status: status, order: order, startedAt: 0, updatedAt: 0)
    }
    func testIncomingOnlyKeepsCurrentAndPreviousWithoutReordering() throws {
        let me = try person("1"), a = try person("2"), b = try person("3")
        var view = Conversation()
        let first = message("a", a, "Which aisle?", order: 1)
        let second = message("b", b, "Near the fruit.", order: 2, status: "live")
        let own = message("self", me, "Own speech", order: 3)
        view.update(participants: [me, a, b], messages: [first, second, own], selfID: me.id)
        XCTAssertEqual(view.incoming.map(\.id), [a.id, b.id])
        let next = message("a2", a, "I can see you.", order: 4)
        view.update(participants: [b, me, a], messages: [first, second, own, next], selfID: me.id)
        XCTAssertEqual(view.incoming.map(\.id), [a.id, b.id])
        XCTAssertEqual(view.incoming[0].current?.text, "I can see you.")
        XCTAssertEqual(view.incoming[0].previous?.text, "Which aisle?")
        XCTAssertEqual(view.incoming[1].current?.status, "live")
        view.update(participants: [me, b], messages: [first, second, own, next], selfID: me.id)
        XCTAssertEqual(view.incoming.map(\.id), [a.id, b.id])
        XCTAssertFalse(view.incoming[0].online)
        XCTAssertEqual(view.incoming[0].current?.text, "I can see you.")
    }
    func testRetractionsPreservePreviousWordsAndNewRoomsReset() throws {
        let me = try person("1"), a = try person("2")
        var view = Conversation()
        view.update(participants: [me, a], messages: [message("a", a, "Keep this", order: 1), message("b", a, "", order: 2)], selfID: me.id)
        XCTAssertEqual(view.incoming[0].current?.text, "Keep this")
        XCTAssertNil(view.incoming[0].previous)
        view = Conversation(); view.update(participants: [me], messages: [], selfID: me.id)
        XCTAssertTrue(view.incoming.isEmpty)
    }
    func testSilentParticipantsDoNotTakeReadingSpaceAndNewSpeakersAppend() throws {
        let me = try person("1"), silent = try person("2"), speaker = try person("3")
        var view = Conversation()
        view.update(participants: [me, silent, speaker], messages: [], selfID: me.id)
        XCTAssertTrue(view.incoming.isEmpty)
        let first = message("first", speaker, "Keep my place", order: 1)
        view.update(participants: [me, silent, speaker], messages: [first], selfID: me.id)
        XCTAssertEqual(view.incoming.map(\.id), [speaker.id])
        view.update(participants: [silent, me, speaker], messages: [first, message("next", silent, "Now joining in", order: 2)], selfID: me.id)
        XCTAssertEqual(view.incoming.map(\.id), [speaker.id, silent.id])
    }
}
