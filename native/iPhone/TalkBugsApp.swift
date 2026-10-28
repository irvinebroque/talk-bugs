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
        if let invite = RoomLink.invitation(url) { model.cancelRecording(); model.room.join(invite.room, key: invite.key) }
        else if url.path.hasPrefix("/e/") || url.host == "encrypted-room" { model.error = RoomCryptoError.missingKey.localizedDescription }
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
            else { model.endRecording(); if phase == .background { model.room.pause() } }
        }
    }
}
