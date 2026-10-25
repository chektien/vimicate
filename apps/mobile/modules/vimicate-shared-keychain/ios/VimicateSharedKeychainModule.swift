import ExpoModulesCore
import Security

public final class VimicateSharedKeychainModule: Module {
    private static let accessGroup = "EXAMPLETEAM.org.vimicate.shared"

    private enum Record: String {
        case identity
        case credential
        case endpoint

        var service: String {
            switch self {
            case .identity:
                "org.vimicate.openclaw-device"
            case .credential:
                "org.vimicate.gateway"
            case .endpoint:
                "org.vimicate.gateway.endpoint"
            }
        }

        var account: String {
            switch self {
            case .identity:
                "identity"
            case .credential, .endpoint:
                "default-local"
            }
        }
    }

    public func definition() -> ModuleDefinition {
        Name("VimicateSharedKeychain")

        AsyncFunction("getItem") { (recordName: String) -> String? in
            let record = try Self.record(named: recordName)
            guard let data = try Self.load(record) else { return nil }
            guard let value = String(data: data, encoding: .utf8) else {
                throw SharedKeychainException("The shared \(record.rawValue) record is not UTF-8 JSON.")
            }
            return value
        }

        AsyncFunction("setItem") { (recordName: String, value: String) in
            let record = try Self.record(named: recordName)
            guard let data = value.data(using: .utf8) else {
                throw SharedKeychainException("The shared \(record.rawValue) record is not UTF-8 JSON.")
            }
            try Self.save(data, record: record)
        }
    }

    private static func record(named name: String) throws -> Record {
        guard let record = Record(rawValue: name) else {
            throw SharedKeychainException("Unsupported Vimicate shared-Keychain record.")
        }
        return record
    }

    /// Mirrors native Vimicate exactly. Expo SecureStore adds a generic-key
    /// attribute and service suffix, so it cannot read these native records.
    private static func baseQuery(_ record: Record) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: record.service,
            kSecAttrAccount as String: record.account
        ]
        // Contributor builds keep these records in their own default access
        // group. Absence of the flag preserves the installed migration path.
        if Bundle.main.object(forInfoDictionaryKey: "VimicateKeychainScope") as? String != "application" {
            query[kSecAttrAccessGroup as String] = self.accessGroup
        }
        return query
    }

    private static func load(_ record: Record) throws -> Data? {
        var query = self.baseQuery(record)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else {
                throw SharedKeychainException("The shared \(record.rawValue) record had an unexpected Keychain type.")
            }
            return data
        case errSecItemNotFound:
            return nil
        default:
            throw SharedKeychainException("Unable to read the shared \(record.rawValue) record (Keychain status \(status)).")
        }
    }

    private static func save(_ data: Data, record: Record) throws {
        let query = self.baseQuery(record)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw SharedKeychainException("Unable to update the shared \(record.rawValue) record (Keychain status \(updateStatus)).")
        }
        var createQuery = query
        attributes.forEach { createQuery[$0.key] = $0.value }
        let addStatus = SecItemAdd(createQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw SharedKeychainException("Unable to create the shared \(record.rawValue) record (Keychain status \(addStatus)).")
        }
    }
}

private struct SharedKeychainException: Error, LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { self.message }
}
