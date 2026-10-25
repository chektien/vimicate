import Foundation
#if canImport(UIKit)
import UIKit
#endif
import UniformTypeIdentifiers

// Main-queue owner of provider tickets and app-owned copies. Provider URLs are
// transient: copy inside their callback, never send them across the JS bridge.
final class PromptDropCoordinator {
  private final class Transfer {
    let id = UUID().uuidString
    let providers: [NSItemProvider]
    var progress: Progress?
    var timeout: DispatchWorkItem?
    var completion: ((Result<[[String: Any]], Error>) -> Void)?
    var files: [[String: Any]] = []
    var bytes = 0
    init(_ providers: [NSItemProvider]) { self.providers = providers }
  }
  private var pending: Transfer?
  private var owned: [String: (url: URL, bytes: Int, batch: String)] = [:]
  private let root: URL
  private var backgroundObserver: NSObjectProtocol?
  private var disposed = false
  var canRegister: Bool { !disposed && pending == nil }

  init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("vimicate-prompt-drops")) {
    self.root = root
    // Drafts are process-local. Retire copies left behind by a terminated app.
    try? FileManager.default.removeItem(at: root)
    #if canImport(UIKit)
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
      object: nil, queue: .main) { [weak self] _ in
      self?.fail("File drop interrupted when Vimicate left the foreground. Drop the files again.")
    }
    #endif
  }
  deinit { if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) } }

  func register(_ providers: [NSItemProvider]) -> String? {
    guard canRegister, !providers.isEmpty, providers.count <= PromptDropPolicy.maximumCount else { return nil }
    let transfer = Transfer(providers); pending = transfer
    let timeout = DispatchWorkItem { [weak self, weak transfer] in
      guard let self, let transfer, self.pending === transfer else { return }
      self.fail("File drop timed out. Make sure the files are downloaded, then try again.")
    }
    transfer.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
    return transfer.id
  }

  func read(_ id: String, completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
    guard let transfer = pending, transfer.id == id, transfer.completion == nil else {
      completion(.failure(Self.error("This file drop has expired. Drop the files again."))); return
    }
    transfer.completion = completion
    loadNext(transfer)
  }

  func discard(_ id: String) {
    if pending?.id == id { fail("File drop cancelled.") }
    for uri in owned.filter({ $0.value.batch == id }).map(\.key) { release(uri) }
  }
  func release(_ uri: String) {
    guard let file = owned.removeValue(forKey: uri) else { return }
    Self.removeCopy(file.url)
  }
  func invalidate() {
    disposed = true; fail("File drop cancelled.")
    for uri in Array(owned.keys) { release(uri) }
    try? FileManager.default.removeItem(at: root)
  }
  private static func error(_ message: String) -> NSError {
    NSError(domain: "VimicatePromptDrop", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func fail(_ message: String) {
    guard let transfer = pending else { return }
    pending = nil; transfer.timeout?.cancel(); transfer.progress?.cancel()
    for file in transfer.files { if let uri = file["uri"] as? String { release(uri) } }
    transfer.completion?(.failure(Self.error(message))); transfer.completion = nil
  }

  private func loadNext(_ transfer: Transfer) {
    guard pending === transfer else { return }
    let index = transfer.files.count
    if index == transfer.providers.count {
      pending = nil; transfer.timeout?.cancel(); transfer.progress = nil
      transfer.completion?(.success(transfer.files)); transfer.completion = nil
      return
    }
    let provider = transfer.providers[index]
    guard let identifier = PromptDropPolicy.representation(provider.registeredTypeIdentifiers, suggestedName: provider.suggestedName),
      let type = UTType(identifier) else { fail("This drop contains an unsupported item. Drop files or images instead."); return }
    let name = PromptDropPolicy.filename(provider.suggestedName, type: type)
    let destination = root.appendingPathComponent(transfer.id).appendingPathComponent(UUID().uuidString).appendingPathComponent(name)
    let remaining = min(PromptDropPolicy.maximumBytes - transfer.bytes,
      64 * PromptDropPolicy.maximumBytes - owned.values.reduce(0) { $0 + $1.bytes })
    transfer.progress = provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self, weak transfer] url, error in
      let result: Result<Int, Error>
      do {
        guard let url, error == nil else { throw Self.error("A dropped file could not be read. Download it in Files and try again.") }
        result = .success(try Self.copy(url, to: destination, maximumBytes: remaining))
      } catch { result = .failure(error) }
      DispatchQueue.main.async { [weak self, weak transfer] in
        guard let self, let transfer, self.pending === transfer else {
          Self.removeCopy(destination); return
        }
        switch result {
        case .failure(let error):
          Self.removeCopy(destination); self.fail(error.localizedDescription)
        case .success(let size):
          let uri = destination.absoluteString
          self.owned[uri] = (destination, size, transfer.id)
          transfer.bytes += size
          transfer.files.append(["uri": uri, "filename": name,
            "mimeType": type.preferredMIMEType ?? "application/octet-stream", "byteCount": size])
          self.loadNext(transfer)
        }
      }
    }
  }

  private static func removeCopy(_ url: URL) {
    try? FileManager.default.removeItem(at: url)
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    let batch = url.deletingLastPathComponent().deletingLastPathComponent()
    if (try? FileManager.default.contentsOfDirectory(atPath: batch.path).isEmpty) == true {
      try? FileManager.default.removeItem(at: batch)
    }
  }

  // Streaming bounds prevent an oversized/cloud-backed provider from creating
  // an unbounded memory allocation or copy. Directories/symlinks are not files.
  static func copy(_ source: URL, to destination: URL, maximumBytes: Int) throws -> Int {
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else { throw error("Drop individual files, not folders.") }
    guard let size = values.fileSize, size > 0 else { throw error("A dropped file is empty or its size is unavailable.") }
    guard size <= maximumBytes else { throw error("Attachments exceed the 18 MB total per-message budget, or the draft cache is full.") }
    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
      throw error("A dropped file could not be staged.")
    }
    let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
    let output = try FileHandle(forWritingTo: destination); defer { try? output.close() }
    var total = 0
    while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
      total += chunk.count
      guard total <= maximumBytes else { throw error("Attachments exceed the 18 MB total per-message budget.") }
      try output.write(contentsOf: chunk)
    }
    guard total > 0 else { throw error("The dropped file is empty.") }
    return total
  }
}
