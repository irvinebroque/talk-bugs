import SwiftUI
import WidgetKit

struct SpeakEntry: TimelineEntry { let date: Date }
struct SpeakProvider: TimelineProvider {
    func placeholder(in context: Context) -> SpeakEntry { SpeakEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (SpeakEntry) -> Void) { completion(SpeakEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SpeakEntry>) -> Void) {
        completion(Timeline(entries: [SpeakEntry(date: .now)], policy: .never))
    }
}
@main struct SpeakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.irvinebroque.talk-bugs.watch.speak", provider: SpeakProvider()) { _ in
            Image(systemName: "mic.fill")
                .font(.title2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "talk-bugs://talk"))
                .accessibilityLabel("Speak in talk-bugs")
        }
        .configurationDisplayName("Speak")
        .description("Open talk-bugs and speak.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner])
    }
}
