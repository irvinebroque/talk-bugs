import SwiftUI
import TalkBugsCore

struct PhoneView: View {
    @Bindable var model: PhoneModel
    @State private var newRoom = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text(model.room.connected ? "Connected" : "Connecting…")
                    Spacer()
                    Text("\(model.room.participants.count) in room")
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal).padding(.bottom, 8)
                ScrollViewReader { scroll in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 20) {
                            if model.room.messages.isEmpty {
                                ContentUnavailableView("No messages yet", systemImage: "bubble.left", description: Text("Invite someone, then hold to talk."))
                            }
                            ForEach(model.room.messages) { message in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(message.speaker.id == model.room.selfID ? "You" : message.speaker.name).fontWeight(.medium)
                                        Text(Date(timeIntervalSince1970: message.startedAt / 1000), style: .time).foregroundStyle(.secondary)
                                    }.font(.caption)
                                    Text(message.text).textSelection(.enabled)
                                        .foregroundStyle(message.status == "live" ? .secondary : .primary)
                                }.frame(maxWidth: .infinity, alignment: .leading).id(message.id)
                                .accessibilityIdentifier("message-\(message.utteranceId)")
                            }
                        }.padding()
                    }
                    .defaultScrollAnchor(.bottom)
                }
                Divider()
                VStack(spacing: 10) {
                    PushToTalkButton(recording: model.recorder.isRecording, begin: model.beginRecording, end: model.endRecording)
                        .tint(.primary)
                    if model.processing { ProgressView("Sending…").font(.caption) }
                    ForEach(model.pending) { job in
                        if let error = job.error {
                            HStack {
                                Text(error).font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Button("Retry") { model.retry(job.id) }
                                Button("Discard", role: .destructive) { model.discard(job.id) }.disabled(model.processing)
                            }
                        }
                    }
                    if let error = model.error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("recording-error") }
                }.padding()
            }
            .navigationTitle("talk-bugs").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("New room", systemImage: "plus") { newRoom = true }.labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarTrailing) { ShareLink(item: RoomLink.url(model.room.room)) { Label("Invite", systemImage: "square.and.arrow.up") } }
            }
            .confirmationDialog("Open a new room?", isPresented: $newRoom) {
                Button("New room") { model.cancelRecording(); model.room.join(UUID()) }.accessibilityIdentifier("confirm-new-room")
            }
        }
    }
}
