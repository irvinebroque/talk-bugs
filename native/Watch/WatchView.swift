import SwiftUI

struct WatchView: View {
    @Bindable var model: WatchModel
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !model.paired {
                        Text("Open talk-bugs on your iPhone to join a room.").font(.footnote)
                        Button("Connect") { model.refresh() }
                    } else {
                        if model.room.messages.isEmpty { Text("No messages yet").foregroundStyle(.secondary) }
                        ForEach(model.room.messages.suffix(20)) { message in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(message.speaker.id == model.room.selfID ? "You" : message.speaker.name).font(.caption2).foregroundStyle(.secondary)
                                Text(message.text).font(.body)
                            }
                        }
                    }
                    ForEach(model.pending) { job in
                        VStack(alignment: .leading) {
                            Text(job.error ?? "Waiting for iPhone…").font(.caption2).foregroundStyle(.secondary)
                            Button("Retry") { model.retry(job.id) }
                            if job.error != nil { Button("Discard", role: .destructive) { model.discard(job.id) } }
                        }
                    }
                    if let error = model.error { Text(error).font(.caption2).foregroundStyle(.red) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
            }
            .defaultScrollAnchor(.bottom)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 4) {
                    if model.recorder.isRecording { Text("\(model.recorder.elapsed)s / 30s").font(.caption2).monospacedDigit() }
                    Button {
                        Task { await model.toggleRecording() }
                    } label: { Label(model.recorder.isRecording ? "Send" : "Speak", systemImage: model.recorder.isRecording ? "stop.fill" : "mic.fill") }
                    .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                    .disabled(!model.paired || model.recorder.isStarting).handGestureShortcut(.primaryAction)
                    .accessibilityIdentifier("speak")
                    if model.recorder.isRecording { Button("Cancel", role: .cancel) { model.cancelRecording() }.font(.caption2) }
                }.padding(.top, 4).background(.background)
            }
            .navigationTitle("talk-bugs")
        }
    }
}
