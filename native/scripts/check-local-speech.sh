#!/bin/bash
# Runs the production transcriber against a generated voice fixture on macOS 26+.
set -euo pipefail
cd "$(dirname "$0")/.."
check_dir=$(mktemp -d)
trap 'rm -rf "$check_dir"' EXIT
sed '/import TalkBugsCore/d' iPhone/LocalTranscriber.swift > "$check_dir/LocalTranscriber.swift"
cat > "$check_dir/Main.swift" <<'SWIFT'
import Foundation
@main struct Main {
    static func main() async throws {
        let text = try await LocalTranscriber().transcribe(URL(fileURLWithPath: CommandLine.arguments[1]))
        guard text.lowercased().contains("hello from the watch"), text.lowercased().contains("read each other") else { fatalError("Unexpected transcript: \(text)") }
        print("Local speech passed:", text)
        if let server = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_SERVER"], let base = URL(string: server) {
            let room = ProcessInfo.processInfo.environment["TALK_BUGS_TEST_ROOM"].flatMap(UUID.init(uuidString:)) ?? UUID()
            let sender = RoomAPI(baseURL: base, room: room, session: UUID())
            let reader = RoomAPI(baseURL: base, room: room, session: UUID())
            let message = Transcript(id: UUID(), text: text)
            try await sender.send(message)
            try await sender.send(message)
            let (snapshot, _) = try await reader.snapshot()
            guard snapshot?.messages.filter({ $0.utteranceId == message.utteranceId }).count == 1, snapshot?.messages.contains(where: { $0.text == text }) == true else { fatalError("Text delivery or idempotency failed") }
            print("Audio → local speech → HTTPS → room → second client passed. Room:", room.uuidString.lowercased())
            await sender.leave(); await reader.leave()
        }
    }
}
SWIFT
swiftc -parse-as-library Core/Sources/TalkBugsCore/Models.swift Core/Sources/TalkBugsCore/VoiceStore.swift Core/Sources/TalkBugsCore/RoomAPI.swift "$check_dir/LocalTranscriber.swift" "$check_dir/Main.swift" -o "$check_dir/check"
"$check_dir/check" UnitTests/Fixtures/voice.wav
