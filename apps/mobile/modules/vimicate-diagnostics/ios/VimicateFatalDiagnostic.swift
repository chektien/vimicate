import Foundation

// A single pending origin belongs to the native diagnostics owner. It is
// consumed by the next fatal, and accepted only for the same error within 5s.
// No timer, retry, transcript contents or application state is retained here.
struct VimicateFatalOrigin {
    private let summary: String
    private let frames: [String]
    private let timestamp: Int64

    init(summary: String, frames: [String], at timestamp: Int64) {
        self.summary = Self.summaryKey(summary)
        self.frames = frames.prefix(16).map { String($0.prefix(512)) }
        self.timestamp = timestamp
    }

    func matchingFrames(_ message: String, at now: Int64) -> [String] {
        guard timestamp >= 0, now >= timestamp, now - timestamp <= 5_000,
              !summary.isEmpty, Self.summaryKey(message) == summary else { return [] }
        return frames
    }

    private static func summaryKey(_ message: String) -> String {
        var first = String(message.prefix(16_384)).components(separatedBy: .newlines).first ?? ""
        let nativePrefix = "Unhandled JS Exception: "
        if first.hasPrefix(nativePrefix) { first.removeFirst(nativePrefix.count) }
        return VimicateFatalDiagnostic.bounded(first, limit: 220)
    }
}

enum VimicateFatalDiagnostic {
    private static let inputLimit = 16_384
    private static let frameLimit = 16
    private static let framePattern = try! NSRegularExpression(
        pattern: #"^\s*at ([A-Za-z_$][A-Za-z0-9_$.<> -]{0,95}) \((?:address at )?(.+):([0-9]{1,12}):([0-9]{1,12})\)\s*$"#
    )

    static func retained(
        _ message: String,
        at milliseconds: Int64,
        version: String,
        build: String,
        preFatalContext: [String] = [],
        originatingStack: [String] = []
    ) -> String {
        let input = String(message.prefix(inputLimit))
        let lines = input.components(separatedBy: .newlines)
        let summary = bounded(lines.first ?? "unknown fatal", limit: 220)
        let frames = lines.compactMap(stackLocation)
        let origin = originatingStack.prefix(frameLimit).compactMap { stackLocation(String($0.prefix(512))) }
        let originRecord = origin.isEmpty ? "" : "originating JS stack:\n" + origin.joined(separator: "\n") + "\n"
        let locations = frames.isEmpty
            ? "stack locations unavailable"
            : "stack locations (as reported):\n" + frames.prefix(frameLimit).joined(separator: "\n")
        // Keep symbolication coordinates, not arbitrary multiline exception
        // payloads. Component-stack locations are not the originating JS stack.
        let context = preFatalContext
            .suffix(8)
            .map { bounded($0, limit: 300) }
            .filter { !$0.isEmpty }
        let contextRecord = context.isEmpty
            ? ""
            : "\npre-fatal context (oldest to newest):\n" + context.joined(separator: "\n")
        let record = "at=\(milliseconds) build=\(version)(\(build)) fatal.native \(summary)\n\(originRecord)\(locations)\(contextRecord)"
        let shortened = message.count > inputLimit
            || frames.count > frameLimit
            || originatingStack.count > frameLimit
            || (lines.first?.count ?? 0) > 220
            || record.count > 4_000
        return String(record.prefix(4_000)) + (shortened ? "\n[diagnostic shortened]" : "")
    }

    private static func stackLocation(_ line: String) -> String? {
        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard let match = framePattern.firstMatch(in: line, range: range) else { return nil }
        let value = line as NSString
        let name = bounded(value.substring(with: match.range(at: 1)), limit: 96)
        let path = value.substring(with: match.range(at: 2))
        let withoutQuery = path.components(separatedBy: CharacterSet(charactersIn: "?#")).first ?? ""
        let file = bounded((withoutQuery.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent, limit: 64)
        guard !file.isEmpty else { return nil }
        return "\(name) @ \(file):\(value.substring(with: match.range(at: 3))):\(value.substring(with: match.range(at: 4)))"
    }

    static func bounded(_ message: String, limit: Int = 380) -> String {
        String(message
            .replacingOccurrences(
                of: #"(token|credential|signature)=\S+"#,
                with: "$1=<redacted>",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#,
                with: "<email>",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"/Users/[^/\s]+/"#,
                with: "/Users/<redacted>/",
                options: .regularExpression
            )
            .replacingOccurrences(of: #"[A-Za-z0-9_-]{40,}"#, with: "<redacted>", options: .regularExpression)
            .prefix(limit))
    }
}
