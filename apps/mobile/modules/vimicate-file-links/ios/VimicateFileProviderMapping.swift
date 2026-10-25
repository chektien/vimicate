import Foundation

enum VimicateFileProviderMapping {
    static func hostFilePath(for rawPath: String) -> String? {
        let value = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.hasPrefix("/") || value.hasPrefix("~/") else { return nil }
        let standardized = (value as NSString).standardizingPath
        return standardized == "/" ? nil : standardized
    }

    static func hostDirectory(for rawPath: String) -> String? {
        guard let filePath = hostFilePath(for: rawPath) else { return nil }
        return (filePath as NSString).deletingLastPathComponent
    }

    static func remoteHomeRoot(for hostPath: String) -> String? {
        guard cloudMappingBoundary(for: hostPath) == nil else { return nil }
        if hostPath == "~" || hostPath.hasPrefix("~/") { return "~" }
        let components = hostPath.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.isEmpty else { return nil }
        if components[0] == "Users", components.count >= 2 {
            return "/Users/\(components[1])"
        }
        if components[0] == "home", components.count >= 2 {
            return "/home/\(components[1])"
        }
        if components.count >= 3, components[0] == "var", components[1] == "home" {
            return "/var/home/\(components[2])"
        }
        if components[0] == "root" { return "/root" }
        return nil
    }

    static func eligibleRoots(for hostPath: String, roots: [String]) -> [String] {
        let cloudBoundary = cloudMappingBoundary(for: hostPath)
        return roots.filter { root in
            guard relativeSuffix(of: hostPath, from: root) != nil else { return false }
            guard let cloudBoundary else { return true }
            return root == cloudBoundary || root.hasPrefix(cloudBoundary + "/")
        }.sorted { $0.count > $1.count }
    }

    static func relativeSuffix(of hostPath: String, from mappingRoot: String) -> String? {
        guard hostPath == mappingRoot || hostPath.hasPrefix(mappingRoot + "/") else { return nil }
        return String(hostPath.dropFirst(mappingRoot.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// The one host segment a provider root approved as `mappingRoot` must itself contain.
    static func firstRelativeSegment(of hostPath: String, from mappingRoot: String) -> String? {
        guard let suffix = relativeSuffix(of: hostPath, from: mappingRoot), !suffix.isEmpty else { return nil }
        return suffix.split(separator: "/", omittingEmptySubsequences: true).first.map(String.init)
    }

    static func providerURL(rootURL: URL, mappingRoot: String, hostPath: String, isDirectory: Bool) -> URL? {
        guard let suffix = relativeSuffix(of: hostPath, from: mappingRoot) else { return nil }
        return suffix.isEmpty ? rootURL : rootURL.appendingPathComponent(suffix, isDirectory: isDirectory)
    }

    static func displayPath(_ hostPath: String) -> String {
        let cloudMarkers = [
            "/Library/Mobile Documents/com~apple~CloudDocs/",
            "/icloud/"
        ]
        for marker in cloudMarkers {
            if let range = hostPath.range(of: marker, options: .caseInsensitive) {
                return "iCloud Drive/" + hostPath[range.upperBound...]
            }
        }
        if hostPath.lowercased().hasPrefix("~/icloud/") {
            return "iCloud Drive/" + hostPath.dropFirst("~/icloud/".count)
        }
        return hostPath
    }

    private static func cloudMappingBoundary(for hostPath: String) -> String? {
        let value = hostPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if value == "~/icloud" || value.hasPrefix("~/icloud/") { return "~/icloud" }
        let components = value.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if components.first?.lowercased() == "icloud" { return "/\(components[0])" }
        if components.count >= 3,
           ["Users", "home"].contains(components[0]),
           components[2].lowercased() == "icloud" {
            return "/\(components[0])/\(components[1])/\(components[2])"
        }
        if components.count >= 4,
           components[0] == "var", components[1] == "home",
           components[3].lowercased() == "icloud" {
            return "/var/home/\(components[2])/\(components[3])"
        }
        if components.count >= 5,
           components[0] == "Users", components[2] == "Library",
           components[3] == "Mobile Documents",
           components[4].lowercased() == "com~apple~clouddocs" {
            return "/Users/\(components[1])/Library/Mobile Documents/\(components[4])"
        }
        return nil
    }
}
