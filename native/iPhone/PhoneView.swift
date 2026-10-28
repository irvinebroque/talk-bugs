import SwiftUI
import TalkBugsCore

struct PhoneView: View {
    @Bindable var model: PhoneModel
    @State private var newRoom = false
    @State private var history = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text(model.room.connected ? "Connected" : "Connecting…")
                    Spacer()
                    Text("\(model.room.participants.count) in room")
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal).padding(.bottom, 8)
                GeometryReader { geometry in
                    if model.room.conversation.incoming.isEmpty {
                        ContentUnavailableView(model.room.participants.contains { $0.id != model.room.selfID } ? "Waiting for someone to speak" : "No one else here", systemImage: "bubble.left", description: Text("Read their words here."))
                    } else if model.room.conversation.incoming.count == 1 {
                        IncomingSpeakerView(speaker: model.room.conversation.incoming[0]).padding()
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 24) {
                                ForEach(model.room.conversation.incoming) { speaker in
                                    IncomingSpeakerView(speaker: speaker).padding(.bottom, 12)
                                        .frame(height: max(180, (geometry.size.height - 56) / 2))
                                        .overlay(alignment: .bottom) { Divider() }
                                }
                            }.padding()
                        }.defaultScrollAnchor(.top)
                    }
                }
                Divider()
                VStack(spacing: 10) {
                    PushToTalkButton(recording: model.recorder.isRecording, begin: model.beginRecording, end: model.endRecording)
                        .tint(.primary)
                    ZStack {
                        Color.clear
                        if model.processing { ProgressView("Sending…").font(.caption) }
                    }.frame(height: 20)
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
                    if let error = model.error ?? model.room.error { Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier("recording-error") }
                }.padding()
            }
            .navigationTitle("talk-bugs").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("New room", systemImage: "plus") { newRoom = true }.labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarTrailing) { Button("History", systemImage: "clock.arrow.circlepath") { history = true }.labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarTrailing) { ShareLink(item: model.room.inviteURL) { Label("Invite", systemImage: "square.and.arrow.up") } }
            }
            .sheet(isPresented: $history) {
                NavigationStack {
                    RoomHistoryView(room: model.room)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { history = false } } }
                }
            }
            .confirmationDialog("Open a new room?", isPresented: $newRoom) {
                Button("New room") { model.cancelRecording(); model.room.newRoom() }.accessibilityIdentifier("confirm-new-room")
            }
        }
    }
}
