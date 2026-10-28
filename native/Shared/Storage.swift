import Foundation
import Security
import TalkBugsCore

enum Identity {
    private static let fallback = "talk-bugs.session-fallback"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "talk-bugs", kSecAttrAccount as String: "session"]
    }
    static func adopt(_ id: UUID) {
        let data = Data(id.uuidString.utf8)
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        // Unsigned simulator installs can lack Keychain access. Keep their opaque identity
        // in the app container instead of becoming a new participant on every launch.
        if status == errSecSuccess { UserDefaults.standard.removeObject(forKey: fallback) }
        else { UserDefaults.standard.set(id.uuidString, forKey: fallback) }
    }
    static func session() -> UUID {
        var lookup = query
        lookup[kSecReturnData as String] = true
        var item: CFTypeRef?
        if SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data, let text = String(data: data, encoding: .utf8), let id = UUID(uuidString: text) { return id }
        let id = UserDefaults.standard.string(forKey: fallback).flatMap(UUID.init(uuidString:)) ?? UUID()
        adopt(id)
        return id
    }
}

// Room secrets never go into UserDefaults or recording metadata on devices.
enum RoomKeys {
    private static func account(_ room: UUID, id: String?) -> String { room.uuidString.lowercased() + (id.map { ":" + $0 } ?? "") }
    private static func query(_ room: UUID, id: String? = nil) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "talk-bugs.room-keys.v1",
         kSecAttrAccount as String: account(room, id: id)]
    }
    static func save(_ key: String, room: UUID) throws {
        guard RoomCrypto.validKey(key) else { throw RoomCryptoError.missingKey }
        // Keep each key under its fingerprint so correcting an invite cannot
        // change the encryption key of a recording already waiting to be sent.
        if let old = load(room) { try write(old, room: room, id: RoomCrypto.keyID(old)) }
        try write(key, room: room, id: RoomCrypto.keyID(key))
        try write(key, room: room, id: nil)
    }
    private static func write(_ key: String, room: UUID, id: String?) throws {
        let data = Data(key.utf8)
        var status = SecItemUpdate(query(room, id: id) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query(room, id: id)
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        #if DEBUG && targetEnvironment(simulator)
        // Unsigned simulator builds can lack Keychain entitlements. No device fallback.
        if status != errSecSuccess {
            let directory = URL.applicationSupportDirectory.appending(path: "SimulatorRoomKeys")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: directory.appending(path: account(room, id: id)), options: .atomic)
            return
        }
        #endif
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
    static func load(_ room: UUID, id: String? = nil) -> String? {
        var lookup = query(room, id: id); lookup[kSecReturnData as String] = true
        var item: CFTypeRef?
        if SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data, let key = String(data: data, encoding: .utf8), RoomCrypto.validKey(key) { return key }
        #if DEBUG && targetEnvironment(simulator)
        let url = URL.applicationSupportDirectory.appending(path: "SimulatorRoomKeys/\(account(room, id: id))")
        if let data = try? Data(contentsOf: url), let key = String(data: data, encoding: .utf8), RoomCrypto.validKey(key) { return key }
        #endif
        return nil
    }
}
