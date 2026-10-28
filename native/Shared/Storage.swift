import Foundation
import Security
import TalkBugsCore

enum Identity {
    static func session() -> UUID {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "talk-bugs", kSecAttrAccount as String: "session", kSecReturnData as String: true]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data, let text = String(data: data, encoding: .utf8), let id = UUID(uuidString: text) { return id }
        let id = UUID()
        var insert = query
        insert.removeValue(forKey: kSecReturnData as String)
        insert[kSecValueData as String] = Data(id.uuidString.utf8)
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
        return id
    }
}
