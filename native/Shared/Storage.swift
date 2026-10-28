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
