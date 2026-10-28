import Foundation

public struct VoiceStore: Sendable {
    public let directory: URL
    public init(directory: URL = URL.applicationSupportDirectory.appending(path: "VoiceOutbox", directoryHint: .isDirectory)) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var url = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }
    public func audio(_ id: UUID) -> URL { directory.appending(path: "\(id.uuidString).wav") }
    public func metadata(_ id: UUID) -> URL { directory.appending(path: "\(id.uuidString).json") }
    public func save(_ job: VoiceJob) throws { try JSONEncoder().encode(job).write(to: metadata(job.id), options: .atomic) }
    public func jobs() -> [VoiceJob] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.pathExtension == "json" }.compactMap { try? JSONDecoder().decode(VoiceJob.self, from: Data(contentsOf: $0)) }.sorted { $0.created < $1.created }
    }
    public func remove(_ id: UUID) { try? FileManager.default.removeItem(at: metadata(id)); try? FileManager.default.removeItem(at: audio(id)) }
    public func purge() {
        for job in jobs() where job.created < Date().addingTimeInterval(-86400) { remove(job.id) }
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for url in urls where url.pathExtension == "wav" {
            let modified = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            if let modified, modified < Date().addingTimeInterval(-86400) { try? FileManager.default.removeItem(at: url) }
        }
    }
    public func receive(_ source: URL, job: VoiceJob) throws {
        guard job.created > Date().addingTimeInterval(-86400), job.created < Date().addingTimeInterval(60),
              (try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? Int ?? 0) <= 1_100_000 else { throw VoiceError.invalidRecording }
        let existing = jobs().first(where: { $0.id == job.id })
        guard existing != nil || jobs().count < 20 else { throw VoiceError.queueFull }
        if existing?.text == nil, !FileManager.default.fileExists(atPath: audio(job.id).path) { try FileManager.default.copyItem(at: source, to: audio(job.id)) }
        var received = existing ?? job
        // A retransmission explicitly retries the same immutable message ID.
        received.error = nil
        try save(received)
    }
}
public enum VoiceError: LocalizedError {
    case microphoneDenied, recordingFailed, invalidRecording, speechUnavailable, noSpeech, queueFull
    public var errorDescription: String? {
        switch self {
        case .microphoneDenied: "Allow microphone access in Settings to speak."
        case .recordingFailed: "Could not record. Please try again."
        case .invalidRecording: "This recording could not be sent. Please record it again."
        case .speechUnavailable: "Speech recognition is unavailable on this iPhone."
        case .noSpeech: "No speech was recognized. Please try again."
        case .queueFull: "Send or discard your waiting messages before recording more."
        }
    }
}
