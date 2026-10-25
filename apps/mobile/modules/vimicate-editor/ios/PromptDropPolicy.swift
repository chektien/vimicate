import Foundation
import UniformTypeIdentifiers

// One representation per provider. Prefer original files/images over URL or text
// fallbacks, so a Safari image is attached rather than its link being inserted.
enum PromptDropPolicy {
  static let maximumCount = 10
  static let maximumBytes = 18 * 1024 * 1024

  static func representation(_ identifiers: [String], suggestedName: String?) -> String? {
    let types = identifiers.compactMap { UTType($0) }
    let supported = types.filter { $0.conforms(to: .data) && !$0.conforms(to: .url) && !$0.conforms(to: .directory) }
    if let image = supported.first(where: { $0.conforms(to: .image) }) { return image.identifier }
    // A naked text selection/link is not a file attachment. Text files dragged
    // from Files have a suggested filename or a file-URL representation.
    let file = suggestedName?.isEmpty == false || types.contains { $0.conforms(to: .fileURL) }
    return supported.first(where: { file || !$0.conforms(to: .text) })?.identifier
  }

  static func filename(_ suggested: String?, type: UTType) -> String {
    let name = (suggested ?? "attachment") as NSString
    var leaf = name.lastPathComponent.replacingOccurrences(of: ":", with: "-")
    leaf = leaf.components(separatedBy: .controlCharacters).joined()
    if leaf.isEmpty || leaf == "." || leaf == ".." { leaf = "attachment" }
    leaf = String(leaf.prefix(180))
    if (leaf as NSString).pathExtension.isEmpty, let ext = type.preferredFilenameExtension { leaf += "." + ext }
    return leaf
  }
}
