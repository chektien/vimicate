import Foundation
import XCTest
@testable import VimicateFilePreview

final class FileShareStreamStoreTests: XCTestCase {
    private func root() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
    func testStreamsBeyondLegacyCeilingWithExactBytesAndReleasesPrivateDirectory() throws {
        let root = try root()
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        let size = 33 * 1024 * 1024 + 17
        let id = try store.begin(filename: "original.bin", size: Double(size))
        let directory = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first)
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)
        var offset = 0
        while offset < size {
            let bytes = Data(repeating: UInt8((offset / VimicateFileShareStreamStore.chunkBytes) % 251),
                             count: min(VimicateFileShareStreamStore.chunkBytes, size - offset))
            try store.append(id: id, offset: Double(offset), dataBase64: bytes.base64EncodedString())
            offset += bytes.count
        }
        try store.prepare(id: id)
        var file: VimicateInlinePreviewFile? = try store.take(id: id)
        let handle = try FileHandle(forReadingFrom: XCTUnwrap(file?.url))
        offset = 0
        while offset < size {
            let bytes = try XCTUnwrap(handle.read(upToCount: min(VimicateFileShareStreamStore.chunkBytes, size - offset)))
            XCTAssertEqual(bytes, Data(repeating: UInt8((offset / VimicateFileShareStreamStore.chunkBytes) % 251), count: bytes.count))
            offset += bytes.count
        }
        XCTAssertEqual(try handle.offset(), UInt64(size))
        try handle.close()
        store.cancel(id: id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path))
        file = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }
    func testNeverPresentsIncompleteBytesAndDropsCustodyOnError() throws {
        let root = try root()
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        let id = try store.begin(filename: "original.bin", size: 1)
        XCTAssertThrowsError(try store.prepare(id: id))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        XCTAssertThrowsError(try store.append(id: id, offset: 0, dataBase64: "YQ=="))
    }
    func testRejectsTraversalInvalidCountsWrongOffsetsAndNoncanonicalOversizedChunks() throws {
        let root = try root()
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        for filename in ["../secret", "a/b", "a\\b", ".", "..", "a\nfile", "", String(repeating: "a", count: 256)] {
            XCTAssertThrowsError(try store.begin(filename: filename, size: 1))
        }
        for size in [-1.0, Double.infinity, Double.nan, 1.5, 9007199254740992] {
            XCTAssertThrowsError(try store.begin(filename: "test.bin", size: size))
        }
        for (offset, encoded) in [(1.0, "YQ=="), (0, "YQ==\n"), (0, "YR=="), (0, "YWI="),
                                  (0, String(repeating: "A", count: 262148))] {
            let id = try store.begin(filename: "original.bin", size: 1)
            XCTAssertThrowsError(try store.append(id: id, offset: offset, dataBase64: encoded))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        }
    }
    func testDiskChecksFailBeforeAllocationAndDuringTransfer() throws {
        let root = try root()
        var available: Int64 = 0
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in available })
        XCTAssertThrowsError(try store.begin(filename: "original.bin", size: 1)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Not enough free space"))
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        available = Int64.max
        let id = try store.begin(filename: "original.bin", size: 1)
        available = 0
        XCTAssertThrowsError(try store.append(id: id, offset: 0, dataBase64: "YQ=="))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testCancellationPreventsAppendAndTakeWithoutCancellingAnotherID() throws {
        let root = try root()
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        let id = try store.begin(filename: "original.bin", size: 1)
        XCTAssertThrowsError(try store.begin(filename: "other.bin", size: 1))
        store.cancel(id: "unrelated")
        try store.append(id: id, offset: 0, dataBase64: "YQ==")
        store.cancel(id: id)
        XCTAssertThrowsError(try store.take(id: id))
        XCTAssertThrowsError(try store.append(id: id, offset: 0, dataBase64: "YQ=="))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        let empty = try store.begin(filename: "empty.bin", size: 0)
        try store.append(id: empty, offset: 0, dataBase64: "")
        try store.prepare(id: empty)
        _ = try store.take(id: empty)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testDestroyAndBackgroundCancellationRemovePartialTransfers() throws {
        let root = try root()
        var store: VimicateFileShareStreamStore? = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        _ = try store?.begin(filename: "original.bin", size: 1)
        store = nil
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        _ = try store?.begin(filename: "original.bin", size: 1)
        store?.cancel()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testBackgroundOrScopeCancellationAfterFinalizationPreventsQueuedPresentation() throws {
        let root = try root()
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        let id = try store.begin(filename: "original.bin", size: 1)
        try store.append(id: id, offset: 0, dataBase64: "YQ==")
        try store.prepare(id: id)
        store.cancel()
        XCTAssertThrowsError(try store.take(id: id))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }
    func testCrashRecoveryReapsOnlyExpiredOwnedDirectoriesNotSymlinksOrFreshTransfers() throws {
        let root = try root()
        for name in ["vimicate-share-old", "vimicate-share-fresh", "unrelated"] {
            let dir = root.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
            if name != "vimicate-share-fresh" {
                try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -7200)], ofItemAtPath: dir.path)
            }
        }
        let link = root.appendingPathComponent("vimicate-share-link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root.appendingPathComponent("unrelated"))
        let store = VimicateFileShareStreamStore(root: root, capacity: { _ in Int64.max })
        _ = try store.begin(filename: "new.bin", size: 0)
        let names = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertFalse(names.contains("vimicate-share-old"))
        XCTAssertTrue(names.contains("vimicate-share-fresh")); XCTAssertTrue(names.contains("unrelated"))
        XCTAssertTrue(names.contains("vimicate-share-link"))
    }
}
