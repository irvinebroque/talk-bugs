import SwiftUI

struct PushToTalkButton: View {
    let recording: Bool
    let begin: () -> Void
    let end: () -> Void
    @GestureState private var held = false

    var body: some View {
        Button {} label: {
            Label(recording ? "Release to send" : "Hold to talk", systemImage: "mic.fill")
                .frame(maxWidth: .infinity).padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .simultaneousGesture(DragGesture(minimumDistance: 0).updating($held) { _, held, _ in held = true })
        // GestureState resets on both release and cancellation, including a system interruption.
        .onChange(of: held) { _, held in if held { begin() } else { end() } }
        .onDisappear(perform: end)
        .accessibilityIdentifier("speak")
        .accessibilityHint("Hold while speaking. Release to send.")
        .accessibilityAction(named: "Start speaking", begin)
        .accessibilityAction(named: "Finish speaking", end)
    }
}
