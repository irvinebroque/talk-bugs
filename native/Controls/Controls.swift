import AppIntents
import SwiftUI
import WidgetKit

@main struct TalkBugsWidgets: WidgetBundle {
    var body: some Widget { TalkControl() }
}
struct TalkControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.irvinebroque.talk-bugs.speak") {
            ControlWidgetButton(action: TalkIntent()) { Label("Speak", systemImage: "mic.fill") }
        }.displayName("Speak in talk-bugs").description("Open your conversation and speak.")
    }
}
