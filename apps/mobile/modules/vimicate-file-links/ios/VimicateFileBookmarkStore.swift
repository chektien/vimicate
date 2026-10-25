import Foundation

/// Owns only persisted host-prefix to Files-provider bookmark mappings.
final class VimicateFileBookmarkStore {
    private static let defaultsKey = "org.vimicate.rn.file-link-bookmarks"

    func mappedURL(for hostPath: String, isDirectory: Bool) -> (url: URL, accessURL: URL)? {
        let matches = VimicateFileProviderMapping.eligibleRoots(
            for: hostPath,
            roots: Array(bookmarks().keys)
        )
        for root in matches {
            guard let accessURL = securityScopedURL(for: root) else { continue }
            guard let url = VimicateFileProviderMapping.providerURL(
                rootURL: accessURL,
                mappingRoot: root,
                hostPath: hostPath,
                isDirectory: isDirectory
            ) else {
                accessURL.stopAccessingSecurityScopedResource()
                continue
            }
            return (url, accessURL)
        }
        return nil
    }

    func storeBookmark(for hostPath: String, selectedURL: URL) throws {
        let bookmark = try selectedURL.bookmarkData(
            options: .minimalBookmark,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        var values = bookmarks()
        values[hostPath] = bookmark.base64EncodedString()
        UserDefaults.standard.set(values, forKey: Self.defaultsKey)
    }

    private func bookmarks() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: Self.defaultsKey) as? [String: String] ?? [:]
    }

    private func securityScopedURL(for hostPath: String) -> URL? {
        guard let encoded = bookmarks()[hostPath], let data = Data(base64Encoded: encoded) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [.withoutUI],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ), !stale, url.startAccessingSecurityScopedResource() else { return nil }
        return url
    }
}
