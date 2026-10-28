import SwiftUI

@main struct TalkBugsWatchApp: App {
    @State private var model = WatchModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            WatchView(model: model)
                .onOpenURL { url in
                    if url.scheme == "talk-bugs", url.host == "talk" { Task { await model.toggleRecording() } }
                }
                .task { model.refresh(); if model.paired && phase == .active { model.room.resume() } }
                .onChange(of: model.paired) { _, paired in if paired && phase == .active { model.room.resume() } }
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { model.refresh(); if model.paired && phase == .active { model.room.resume() } }
            else if phase == .background { model.room.pause() }
        }
    }
}
