import SwiftUI

struct WatchView: View {
    @Bindable var model: WatchModel
    @State private var pending = false
    var body: some View {
        NavigationStack {
            Group {
                if !model.paired {
                    VStack {
                        Text("Open talk-bugs on your iPhone to join a room.").font(.footnote)
                        Button("Connect") { model.refresh() }
                    }
                } else if model.room.conversation.incoming.isEmpty {
                    Text(model.room.participants.contains { $0.id != model.room.selfID } ? "Waiting for someone to speak." : "Waiting for someone to join.").font(.callout).foregroundStyle(.secondary)
                } else if model.room.conversation.incoming.count == 1 {
                    IncomingSpeakerView(speaker: model.room.conversation.incoming[0])
                } else {
                    // One stable page per person keeps simultaneous speakers readable on the small screen.
                    TabView {
                        ForEach(model.room.conversation.incoming) { speaker in
                            IncomingSpeakerView(speaker: speaker).tag(speaker.id)
                        }
                    }.tabViewStyle(.verticalPage)
                }
            }
            .padding(.horizontal, 4)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 4) {
                    ZStack {
                        Color.clear
                        if !model.pending.isEmpty {
                            Button("\(model.pending.count) waiting") { pending = true }.font(.caption2)
                        }
                    }.frame(height: 20)
                    if let error = model.error { Text(error).font(.caption2).foregroundStyle(.red) }
                    PushToTalkButton(recording: model.recorder.isRecording, begin: model.beginRecording, end: model.endRecording)
                        .tint(.white).foregroundStyle(.black).disabled(!model.paired)
                }.padding(.top, 4).background(.background)
            }
            .navigationTitle("talk-bugs")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { RoomHistoryView(room: model.room) } label: {
                        Label("History", systemImage: "clock.arrow.circlepath")
                    }
                }
            }
            .sheet(isPresented: $pending) {
                ScrollView {
                    ForEach(model.pending) { job in
                        VStack(alignment: .leading) {
                            Text(job.error ?? "Waiting for iPhone…").font(.caption2)
                            Button("Retry") { model.retry(job.id) }
                            if job.error != nil { Button("Discard", role: .destructive) { model.discard(job.id) } }
                        }
                    }
                }.navigationTitle("Waiting")
            }
        }
    }
}
