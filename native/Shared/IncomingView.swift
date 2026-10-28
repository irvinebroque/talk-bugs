import SwiftUI
import TalkBugsCore

struct IncomingSpeakerView: View {
    let speaker: IncomingSpeaker
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(speaker.person.name)
                Spacer()
                Text(speaker.current?.status == "live" ? "Speaking" : speaker.online ? "" : "Left room")
            }.font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let current = speaker.current {
                        Text(current.text)
                            #if os(iOS)
                            .font(.title2).textSelection(.enabled)
                            #else
                            .font(.body)
                            #endif
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("incoming-current-\(speaker.id)")
                        if current.status == "interrupted" { Text("Connection paused").font(.caption2).foregroundStyle(.secondary) }
                        if let previous = speaker.previous {
                            Divider()
                            Text(previous.text).font(.callout).foregroundStyle(.secondary)
                                .accessibilityIdentifier("incoming-previous-\(speaker.id)")
                        }
                    } else {
                        Text("Waiting for them to speak.").font(.callout).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            // Only a new turn resets the reading position; partial revisions stay in place.
            .id(speaker.current?.id ?? speaker.id)
            .defaultScrollAnchor(.top)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("incoming-speaker-\(speaker.id)")
    }
}

struct RoomHistoryView: View {
    let room: RoomModel
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if room.messages.isEmpty { Text("No messages yet.").foregroundStyle(.secondary) }
                ForEach(room.messages) { message in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(message.speaker.id == room.selfID ? "You" : message.speaker.name)
                            Text(Date(timeIntervalSince1970: message.startedAt / 1000), style: .time)
                        }.font(.caption2).foregroundStyle(.secondary)
                        Text(message.text)
                            #if os(iOS)
                            .textSelection(.enabled)
                            #endif
                            .accessibilityIdentifier("history-\(message.utteranceId)")
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding()
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.top, for: .sizeChanges)
        .navigationTitle("History")
        .accessibilityIdentifier("history")
    }
}
