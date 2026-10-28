import SwiftUI
import TalkBugsCore

@main struct TalkBugsApp: App {
    @State private var model: PhoneModel
    private let bridge: PhoneBridge
    @Environment(\.scenePhase) private var phase
    init() {
        let model = PhoneModel()
        _model = State(initialValue: model); bridge = PhoneBridge(model: model)
    }
    private func open(_ url: URL) {
        if let room = RoomLink.parse(url) { model.cancelRecording(); model.room.join(room) }
        else if (url.scheme == "talk-bugs" && url.host == "talk") || (url.scheme == "https" && url.host == RoomLink.origin.host && url.path == "/talk") {
            Task { await model.toggleRecording() }
        }
    }
    var body: some Scene {
        WindowGroup {
            PhoneView(model: model)
                .onOpenURL(perform: open)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { open(url) }
                }
                .task { model.room.resume(); model.process(); bridge.sync() }
        }
        .onChange(of: phase) { _, phase in
            if phase == .active { model.room.resume(); model.process(); bridge.sync() }
            else if phase == .background { model.room.pause() }
        }
    }
}
