import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// RTF is passive rich text, not a remote Quick Look scene that can take the
/// keyboard responder. Called only by the single bounded preparation worker.
enum VimicateRTFPreviewPolicy {
    static let maximumBytes = 256 * 1024
    static let maximumCharacters = 32 * 1024
    enum Failure: LocalizedError {
        case tooLarge, malformed, complex
        var errorDescription: String? {
            switch self {
            case .tooLarge: return "This RTF is too large for inline preview. You can still share the complete file."
            case .malformed: return "This RTF is malformed and could not be previewed."
            case .complex: return "This RTF uses unsupported embedded content or formatting. You can still share the complete file."
            }
        }
    }

    static func attributedText(_ data: Data) throws -> NSAttributedString {
        guard data.count <= maximumBytes else { throw Failure.tooLarge }
        let bytes = Array(data)
        guard bytes.starts(with: Array(#"{\rtf1"#.utf8)), bytes.count > 6,
              bytes[6] == 92 || bytes[6] == 32 || bytes[6] == 9 || bytes[6] == 10 || bytes[6] == 13 else { throw Failure.malformed }
        var index = 0, depth = 0, groups = 0
        // Reject unbounded nesting, binary/embedded payloads and enormous layout
        // parameters before Apple's importer. Escaped braces are not groups.
        while index < bytes.count {
            let byte = bytes[index]; index += 1
            if byte == 123 { depth += 1; groups += 1; guard depth <= 64, groups <= 4096 else { throw Failure.complex } }
            else if byte == 125 { depth -= 1; guard depth >= 0 else { throw Failure.malformed } }
            else if byte == 92, index < bytes.count {
                let start = index
                while index < bytes.count, isLetter(bytes[index]) { index += 1 }
                if index == start { index += 1; continue }
                let word = String(decoding: bytes[start..<index], as: UTF8.self)
                guard !["pict", "object", "objdata", "bin", "NeXTGraphic"].contains(word) else { throw Failure.complex }
                if index < bytes.count, bytes[index] == 45 { index += 1 }
                var value = 0
                while index < bytes.count, bytes[index] >= 48, bytes[index] <= 57 {
                    value = value * 10 + Int(bytes[index] - 48)
                    guard value <= 1_000_000 else { throw Failure.complex }
                    index += 1
                }
                if word == "fs", value > 192 { throw Failure.complex }
                if word == "uc", value > 16 { throw Failure.complex }
            }
        }
        guard depth == 0 else { throw Failure.malformed }
        let text = try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
        guard text.length <= maximumCharacters else { throw Failure.tooLarge }
        var hasAttachment = false
        text.enumerateAttribute(.attachment, in: NSRange(location: 0, length: text.length)) { value, _, stop in
            if value != nil { hasAttachment = true; stop.pointee = true }
        }
        guard !hasAttachment else { throw Failure.complex }
        // Preserve the old preview's no-external-link contract, including
        // accessibility actions, without changing authored link appearance.
        let passive = NSMutableAttributedString(attributedString: text)
        passive.removeAttribute(.link, range: NSRange(location: 0, length: passive.length))
        return passive
    }

    private static func isLetter(_ byte: UInt8) -> Bool {
        (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
    }
}
