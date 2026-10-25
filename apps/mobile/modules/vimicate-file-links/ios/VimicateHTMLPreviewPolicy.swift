import Foundation

/// HTML has its own renderer; it never inherits Quick Look or host-file access.
enum VimicateHTMLPreviewPolicy {
    static let maximumBytes = 1024 * 1024
    static let contentPolicy = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    static let networkRules = #"[{"trigger":{"url-filter":"^[a-zA-Z][a-zA-Z0-9+.-]*://"},"action":{"type":"block"}}]"#
    enum Failure: LocalizedError {
        case invalidHTML
        var errorDescription: String? { "HTML preview requires a complete UTF-8 HTML file no larger than 1 MiB." }
    }

    static func document(_ input: VimicateInlinePreviewStaging.Input) throws -> String {
        let ext = (input.filename as NSString).pathExtension.lowercased()
        guard ["html", "htm"].contains(ext),
              input.dataBase64.utf8.count <= ((maximumBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: input.dataBase64), data.count <= maximumBytes,
              data.base64EncodedString() == input.dataBase64,
              let source = String(data: data, encoding: .utf8) else { throw Failure.invalidHTML }
        // A policy before all authored markup cannot be relaxed by later metadata.
        // Leave the author's viewport and appearance intact; WK owns pinch/scroll.
        return "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"\(contentPolicy)\">" + source
    }

    static func allowsNavigation(to destination: URL?, current: URL?, initial: Bool) -> Bool {
        guard let destination else { return false }
        if initial && destination.absoluteString == "about:blank" { return true }
        guard let current, destination.fragment != nil else { return false }
        var lhs = URLComponents(url: destination, resolvingAgainstBaseURL: false)
        var rhs = URLComponents(url: current, resolvingAgainstBaseURL: false)
        lhs?.fragment = nil
        rhs?.fragment = nil
        return lhs == rhs
    }
}
