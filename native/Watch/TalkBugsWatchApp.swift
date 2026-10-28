import SwiftUI

@main struct TalkBugsWatchApp: App {
    @State private var model = WatchModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            WatchView(model: model)
                .onOpenURL { _ in /* The complication opens the hold-to-talk control. */ }
                .task { model.refresh(); if model.paired && phase == .active { model.room.resume() } }
                .onChange(of: model.paired) { _, paired in if paired && phase == .active { model.room.resume() } }
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { model.refresh(); if model.paired && phase == .active { model.room.resume() } }
            else { model.endRecording(); if phase == .background { model.room.pause() } }
        }
    }
}
