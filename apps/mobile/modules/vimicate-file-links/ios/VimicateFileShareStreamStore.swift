import Foundation

/// One private disk stream. No URL crosses the bridge and no complete-file Data is allocated.
/// The lock serializes destruction/background cancellation with off-main bounded writes.
final class VimicateFileShareStreamStore {
    static let chunkBytes = 196608
    static let idleLifetime: TimeInterval = 5 * 60
    private let lock = NSLock()
    private let root: URL
    private let capacity: (URL) throws -> Int64
    private let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "vimicate.share.expiry"))
    private var transfer: Transfer?

    private struct Transfer {
        let id: String
        let size: Int64
        let file: VimicateInlinePreviewFile
        let handle: FileHandle
        var received: Int64 = 0
        var prepared = false
        var preparing = false
        var deadline = Date().addingTimeInterval(idleLifetime)
    }
    enum Failure: LocalizedError {
        case invalid, busy, space, incomplete, expired
        var errorDescription: String? {
            switch self {
            case .invalid: return "Invalid original file transfer."
            case .busy: return "A file download is already in progress."
            case .space: return "Not enough free space on this device."
            case .incomplete: return "The original file download is incomplete."
            case .expired: return "The file download expired. Try again."
            }
        }
    }

    init(root: URL = FileManager.default.temporaryDirectory,
         capacity: @escaping (URL) throws -> Int64 = { url in
             let attributes = try FileManager.default.attributesOfFileSystem(forPath: url.path)
             return (attributes[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
         }) {
        self.root = root; self.capacity = capacity
        timer.setEventHandler { [weak self] in self?.expire() }
        timer.resume()
    }

    func begin(filename: String, size: Double) throws -> String {
        lock.lock(); defer { lock.unlock() }
        guard transfer == nil else { throw Failure.busy }
        guard !filename.isEmpty, filename != ".", filename != "..", filename.utf8.count <= 255,
              !filename.contains("/"), !filename.contains("\\"),
              !filename.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              size.isFinite, size >= 0, size <= 9007199254740991, size.rounded(.down) == size else {
            throw Failure.invalid
        }
        let expected = Int64(size)
        try checkSpace(expected)
        removeExpiredDirectories()
        let id = UUID().uuidString
        let directory = root.appendingPathComponent("vimicate-share-" + id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        do {
            var excluded = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            let url = directory.appendingPathComponent(filename, isDirectory: false)
            guard FileManager.default.createFile(atPath: url.path, contents: nil,
                                                attributes: [.posixPermissions: 0o600]) else { throw Failure.invalid }
            let file = VimicateInlinePreviewFile(url: url, directory: directory)
            transfer = Transfer(id: id, size: expected, file: file, handle: try FileHandle(forWritingTo: url))
            timer.schedule(deadline: .now() + Self.idleLifetime)
            return id
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    func append(id: String, offset: Double, dataBase64: String) throws {
        lock.lock(); defer { lock.unlock() }
        guard var next = transfer, next.id == id else { throw Failure.invalid }
        do {
            guard next.deadline > Date() else { throw Failure.expired }
            guard !next.prepared, !next.preparing else { throw Failure.invalid }
            let count = Int(min(Int64(Self.chunkBytes), next.size - next.received))
            guard offset == Double(next.received), dataBase64.utf8.count == ((count + 2) / 3) * 4,
                  let data = Data(base64Encoded: dataBase64), data.count == count,
                  data.base64EncodedString() == dataBase64 else { throw Failure.invalid }
            try checkSpace(Int64(count))
            try next.handle.write(contentsOf: data)
            next.received += Int64(count)
            next.deadline = Date().addingTimeInterval(Self.idleLifetime)
            transfer = next
            timer.schedule(deadline: .now() + Self.idleLifetime)
        } catch {
            clear()
            throw error
        }
    }

    /// Close off-main, keeping the opaque ID cancellable until UIKit claims it.
    func prepare(id: String) throws {
        lock.lock()
        guard var next = transfer, next.id == id, !next.prepared, !next.preparing else {
            lock.unlock(); throw Failure.invalid
        }
        next.preparing = true
        transfer = next
        lock.unlock()
        do {
            guard next.deadline > Date() else { throw Failure.expired }
            guard next.received == next.size else { throw Failure.incomplete }
            // Sequential writes are visible to readers after close. This private
            // disposable snapshot does not need an unbounded durability fsync.
            let written = try next.handle.offset()
            try next.handle.close()
            guard written == UInt64(next.size) else { throw Failure.incomplete }
        } catch {
            try? next.handle.close()
            lock.lock()
            if transfer?.id == id { clear() }
            lock.unlock()
            throw error
        }
        lock.lock(); defer { lock.unlock() }
        // Cancellation detaches custody without closing an in-flight worker's
        // handle. That worker retains it until it has drained.
        guard transfer?.id == id else { throw Failure.invalid }
        next.prepared = true
        next.preparing = false
        transfer = next
    }

    /// Main-queue claim performs no file I/O. Cancel/background can revoke a finalized stream.
    func take(id: String) throws -> VimicateInlinePreviewFile {
        lock.lock(); defer { lock.unlock() }
        guard let next = transfer, next.id == id, next.prepared, next.deadline > Date() else { throw Failure.invalid }
        transfer = nil
        timer.schedule(deadline: .distantFuture)
        return next.file
    }

    func cancel(id: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        if id == nil || transfer?.id == id { clear() }
    }
    private func clear() {
        if transfer?.preparing != true { try? transfer?.handle.close() }
        transfer = nil
        timer.schedule(deadline: .distantFuture)
    }
    private func checkSpace(_ bytes: Int64) throws {
        guard try capacity(root) >= bytes + 16 * 1024 * 1024 else { throw Failure.space }
    }
    private func expire() {
        lock.lock(); defer { lock.unlock() }
        if let transfer, transfer.deadline <= Date() { clear() }
    }
    /// Crash recovery reaps only our expired non-symlink directories.
    private func removeExpiredDirectories() {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey]
        guard let children = try? FileManager.default.contentsOfDirectory(at: root,
            includingPropertiesForKeys: Array(keys)) else { return }
        for child in children where child.lastPathComponent.hasPrefix("vimicate-share-") {
            guard let values = try? child.resourceValues(forKeys: keys), values.isDirectory == true,
                  values.isSymbolicLink != true, let date = values.contentModificationDate,
                  Date().timeIntervalSince(date) > VimicateInlinePreviewStaging.maximumLifetime else { continue }
            try? FileManager.default.removeItem(at: child)
        }
    }
    deinit { timer.cancel(); if transfer?.preparing != true { try? transfer?.handle.close() } }
}
