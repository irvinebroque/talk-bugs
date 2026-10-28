import AVFoundation
import Speech
import TalkBugsCore

actor LocalTranscriber {
    func transcribe(_ url: URL) async throws -> String {
        let locale = Locale(identifier: "en-US")
        let text: String
        if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) {
            let module = SpeechTranscriber(locale: locale, preset: .transcription)
            try await install(module)
            let analyzer = SpeechAnalyzer(modules: [module])
            let results = Task {
                var parts: [String] = []
                for try await result in module.results { parts.append(String(result.text.characters)) }
                return parts.joined(separator: " ")
            }
            do {
                text = try await withTaskCancellationHandler {
                    try Task.checkCancellation()
                    try await analyzer.start(inputAudioFile: await audioFile(url, for: module), finishAfterFile: true)
                    return try await results.value
                } onCancel: {
                    results.cancel()
                    Task { await analyzer.cancelAndFinishNow() }
                }
            } catch { results.cancel(); await analyzer.cancelAndFinishNow(); throw error }
        } else if let locale = await DictationTranscriber.supportedLocale(equivalentTo: locale) {
            let module = DictationTranscriber(locale: locale, preset: .shortDictation)
            try await install(module)
            let analyzer = SpeechAnalyzer(modules: [module])
            let results = Task {
                var parts: [String] = []
                for try await result in module.results { parts.append(String(result.text.characters)) }
                return parts.joined(separator: " ")
            }
            do {
                text = try await withTaskCancellationHandler {
                    try Task.checkCancellation()
                    try await analyzer.start(inputAudioFile: await audioFile(url, for: module), finishAfterFile: true)
                    return try await results.value
                } onCancel: {
                    results.cancel()
                    Task { await analyzer.cancelAndFinishNow() }
                }
            } catch { results.cancel(); await analyzer.cancelAndFinishNow(); throw error }
        } else { throw VoiceError.speechUnavailable }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw VoiceError.noSpeech }
        guard trimmed.utf16.count <= 4000 else { throw VoiceError.invalidRecording }
        return trimmed
    }
    private func audioFile(_ url: URL, for module: any SpeechModule) async throws -> AVAudioFile {
        // The recorder writes 16 kHz mono PCM; AVAudioFile supplies floating-point
        // processing buffers to the analyzer while retaining the sample rate.
        guard !(await module.availableCompatibleAudioFormats).isEmpty else { throw VoiceError.speechUnavailable }
        let file = try AVAudioFile(forReading: url)
        guard file.processingFormat.sampleRate == 16000, file.processingFormat.channelCount == 1,
              file.length > 0, file.length <= 16000 * 31 else { throw VoiceError.invalidRecording }
        return file
    }
    private func install(_ module: any SpeechModule) async throws {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) { try await request.downloadAndInstall() }
    }
}
