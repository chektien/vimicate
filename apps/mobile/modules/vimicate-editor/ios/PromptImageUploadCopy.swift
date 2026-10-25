import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Creates an in-memory derivative only; never modifies or removes staged originals.
enum PromptImageUploadCopy {
  static let totalBytes = 18 * 1024 * 1024
  static let uploadBytes = 5 * 1024 * 1024

  static func prepare(_ base64: String) throws -> [String: Any] {
    guard base64.utf8.count <= 4 * ((totalBytes + 2) / 3),
          let data = Data(base64Encoded: base64), data.count <= totalBytes,
          let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw failure("Image could not be read within the 18 MB total attachment budget.")
    }
    guard CGImageSourceGetCount(source) == 1 else {
      throw failure("This animated or multi-page image cannot be optimized without losing frames. The original is unchanged; attach a static screenshot instead.")
    }
    for dimension in [4096, 3072, 2048, 1024] {
      let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: dimension,
        kCGImageSourceShouldCacheImmediately: true]
      guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { continue }
      for quality in [0.9, 0.8, 0.65] {
        let encoded = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(encoded, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        if CGImageDestinationFinalize(destination), encoded.length <= uploadBytes {
          return ["dataBase64": (encoded as Data).base64EncodedString(), "byteCount": encoded.length, "mimeType": "image/jpeg"]
        }
      }
    }
    throw failure("Could not prepare a readable image upload copy. The original is unchanged.")
  }

  private static func failure(_ description: String) -> NSError {
    NSError(domain: "VimicateImageUpload", code: 1, userInfo: [NSLocalizedDescriptionKey: description])
  }
}
