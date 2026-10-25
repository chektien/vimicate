import Foundation
import XCTest
@testable import VimicateFilePreview

final class InlinePreviewStagingTests: XCTestCase {
    private func input(_ name: String = "report.pdf", data: Data = Data("fixture only".utf8), mime: String = "application/pdf") -> VimicateInlinePreviewStaging.Input {
        .init(dataBase64: data.base64EncodedString(), filename: name, mimeType: mime)
    }

    func testFileKeepsExactBytesAndURLUntilItsOwnerReleasesIt() throws {
        let bytes = Data([0, 1, 0xff, 0x41])
        var file: VimicateInlinePreviewFile? = try VimicateInlinePreviewStaging.stage(input(data: bytes))
        let url = try XCTUnwrap(file?.url)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertEqual(url.lastPathComponent, "report.pdf")
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        file = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path))
    }

    func testRejectsNamesThatCouldEscapeThePrivateDirectory() {
        for name in ["", ".", "..", "../report.pdf", "/report.pdf", "a/report.pdf", "a\\report.pdf", "bad\u{0}.pdf", "bad\n.pdf", String(repeating: "é", count: 128)] {
            XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(input(name))) {
                XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .invalidName)
            }
        }
    }

    func testRejectsInvalidNoncanonicalAndWhitespaceBase64() {
        for encoded in ["%PDF", "Zg", "Zh==", "Zg==\n", "Zg==junk", "===="] {
            let invalid = VimicateInlinePreviewStaging.Input(dataBase64: encoded, filename: "report.pdf", mimeType: "application/pdf")
            XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(invalid)) {
                XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .invalidBase64)
            }
        }
    }

    func testEmptyAndOversizedDataNeverBecomeCacheFiles() {
        XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(input(data: Data()))) {
            XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .empty)
        }
        XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(input(data: Data(repeating: 1, count: VimicateInlinePreviewStaging.maximumBytes + 1)))) {
            XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .tooLarge)
        }
    }

    func testAcceptsExactEightMiBBoundAndDeletesOnReplacement() throws {
        var current: VimicateInlinePreviewFile? = try VimicateInlinePreviewStaging.stage(input(data: Data(repeating: 1, count: VimicateInlinePreviewStaging.maximumBytes)))
        let oldURL = try XCTUnwrap(current?.url)
        XCTAssertEqual(try Data(contentsOf: oldURL).count, 8 * 1024 * 1024)
        current = try VimicateInlinePreviewStaging.stage(input("replacement.rtf", data: Data(#"{\rtf1 synthetic}"#.utf8), mime: "application/rtf"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(current?.url.path)))
        current = nil
    }

    func testActiveContentIsRejectedEvenWhenOneTypeLabelLooksHarmless() {
        for value in [input("page.HTML"), input("report.pdf", mime: "text/html; charset=utf-8"), input("picture.svg"), input("link.webloc")] {
            XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(value)) {
                XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .activeContent)
            }
        }
    }

    func testRejectsMacroOfficeExecutablesAndUnknownFormatsRatherThanClaimingQuickLookSupport() {
        for name in ["macro.docm", "macro.xlsm", "macro.pptm", "run.exe", "unknown.bin"] {
            XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(input(name))) {
                XCTAssertEqual($0 as? VimicateInlinePreviewStaging.Failure, .unsupportedType)
            }
        }
    }

    func testOnlyExpiredOwnedDirectoriesAreReapedAfterAnInterruptedLifetime() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let stale = root.appendingPathComponent("vimicate-preview-interrupted")
        let unrelated = root.appendingPathComponent("unrelated-cache")
        let recent = root.appendingPathComponent("vimicate-preview-recent")
        for url in [stale, unrelated, recent] { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false) }
        let old = Date().addingTimeInterval(-VimicateInlinePreviewStaging.maximumLifetime - 60)
        try FileManager.default.setAttributes([.creationDate: old], ofItemAtPath: stale.path)
        try FileManager.default.setAttributes([.creationDate: old], ofItemAtPath: unrelated.path)
        let file = try VimicateInlinePreviewStaging.stage(input(), root: root)
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: recent.path))
        withExtendedLifetime(file) {}
    }

    func testOneDrainingWorkerOnlyStagesLatestReplacementAndNeverPublishesStaleResult() {
        let started = expectation(description: "first started")
        let latest = expectation(description: "latest delivered")
        let gate = DispatchSemaphore(value: 0)
        var stagedNames: [String] = []
        let owner = VimicateInlinePreviewPreparation { value in
            XCTAssertFalse(Thread.isMainThread)
            stagedNames.append(value.filename)
            if value.filename == "first.pdf" {
                started.fulfill()
                _ = gate.wait(timeout: .now() + 2)
            }
            return try VimicateInlinePreviewStaging.stage(value)
        }
        owner.prepare(input("first.pdf")) { _ in XCTFail("Stale publication") }
        wait(for: [started], timeout: 1)
        owner.prepare(input("superseded.pdf")) { _ in XCTFail("Superseded publication") }
        owner.prepare(input("latest.pdf")) { result in
            XCTAssertTrue(Thread.isMainThread)
            XCTAssertEqual(try? result.get().url.lastPathComponent, "latest.pdf")
            latest.fulfill()
        }
        gate.signal()
        wait(for: [latest], timeout: 2)
        XCTAssertEqual(stagedNames, ["first.pdf", "latest.pdf"])
    }

    func testDisposalCannotPublishAndDrainingWorkDeletesItsFile() {
        let started = expectation(description: "started")
        let drained = expectation(description: "drained and deleted")
        let gate = DispatchSemaphore(value: 0)
        var owner: VimicateInlinePreviewPreparation? = .init { value in
            let file = try VimicateInlinePreviewStaging.stage(value)
            let url = file.url
            started.fulfill()
            _ = gate.wait(timeout: .now() + 2)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
                drained.fulfill()
            }
            return file
        }
        owner?.prepare(input()) { _ in XCTFail("Disposed publication") }
        wait(for: [started], timeout: 1)
        owner = nil
        gate.signal()
        wait(for: [drained], timeout: 2)
    }

    func testCancelDropsBothCurrentPublicationAndQueuedReplacement() {
        let started = expectation(description: "started")
        let drained = expectation(description: "drained")
        let gate = DispatchSemaphore(value: 0)
        let owner = VimicateInlinePreviewPreparation { value in
            XCTAssertEqual(value.filename, "first.pdf")
            started.fulfill()
            _ = gate.wait(timeout: .now() + 2)
            DispatchQueue.main.async { drained.fulfill() }
            return try VimicateInlinePreviewStaging.stage(value)
        }
        owner.prepare(input("first.pdf")) { _ in XCTFail("Cancelled publication") }
        wait(for: [started], timeout: 1)
        owner.prepare(input("queued.pdf")) { _ in XCTFail("Queued publication") }
        owner.cancel()
        gate.signal()
        wait(for: [drained], timeout: 2)
        withExtendedLifetime(owner) {}
    }
}
