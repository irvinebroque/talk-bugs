import AppIntents
import Foundation

struct TalkIntent: AppIntent {
    static let title: LocalizedStringResource = "Speak in talk-bugs"
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "https://talkbugs.com/talk")!))
    }
}
struct TalkShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: TalkIntent(), phrases: ["Speak in \(.applicationName)"], shortTitle: "Speak", systemImageName: "mic.fill")
    }
}
