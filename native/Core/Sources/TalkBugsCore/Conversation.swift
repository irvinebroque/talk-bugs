import Foundation

public struct IncomingSpeaker: Identifiable, Equatable, Sendable {
    public var id: String { person.id }
    public let person: Participant
    public let current: ChatMessage?
    public let previous: ChatMessage?
    public let online: Bool
}

// Remember the order people first speak. New turns, reconnects, and departures never reorder readers.
public struct Conversation: Sendable {
    private var people: [Participant] = []
    public private(set) var incoming: [IncomingSpeaker] = []
    public init() {}
    public mutating func update(participants: [Participant], messages: [ChatMessage], selfID: String) {
        for person in messages.filter({ !$0.text.isEmpty }).sorted(by: { $0.order < $1.order }).map(\.speaker) where !people.contains(where: { $0.id == person.id }) {
            people.append(person)
        }
        incoming = people.filter { $0.id != selfID }.map { person in
            let turns = messages.filter { $0.speaker.id == person.id && !$0.text.isEmpty }.sorted { $0.order < $1.order }
            return IncomingSpeaker(person: person, current: turns.last, previous: turns.dropLast().last,
                                   online: participants.contains { $0.id == person.id })
        }
    }
}
