import Foundation
import XCTest
@testable import VimicateFilePreview

final class FilePreviewPreparationTests: XCTestCase {
    private let fileURL = URL(fileURLWithPath: "/fixture/document.pdf")

    func testCoordinatedReadRejectsAnEmptyPlaceholder() throws {
        let file = try fixture(Data())
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        XCTAssertThrowsError(try VimicateFilePreviewPreparation.read(url: file, coordinator: NSFileCoordinator())) {
            XCTAssertEqual(($0 as NSError).domain, "E_FILE_PREVIEW_EMPTY")
        }
    }

    func testCoordinatedReadReturnsTheReadableFile() throws {
        let file = try fixture(Data("actual downloaded contents".utf8))
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        XCTAssertEqual(try VimicateFilePreviewPreparation.read(url: file, coordinator: NSFileCoordinator()), file)
    }

    func testCoordinatedReadReportsMissingItems() {
        XCTAssertThrowsError(try VimicateFilePreviewPreparation.read(url: fileURL, coordinator: NSFileCoordinator()))
    }

    func testCoordinatedReadRejectsOrdinaryDirectories() throws {
        let file = try fixture(Data([1]))
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        XCTAssertThrowsError(try VimicateFilePreviewPreparation.read(url: file.deletingLastPathComponent(), coordinator: NSFileCoordinator()))
    }

    func testReadRunsOffMainAndTransfersTheLeaseToThePreview() {
        let ready = expectation(description: "ready")
        let redirected = URL(fileURLWithPath: "/fixture/relocated.pdf")
        var released = 0
        var previewLease: VimicateFileAccessLease?
        let operation = VimicateFilePreviewPreparation { _, _ in
            XCTAssertFalse(Thread.isMainThread)
            return redirected
        }
        XCTAssertTrue(operation.prepare(url: fileURL, lease: .init { released += 1 }) { result in
            XCTAssertTrue(Thread.isMainThread)
            guard case let .ready(url, lease) = result else { return XCTFail("Not ready") }
            XCTAssertEqual(url, redirected)
            previewLease = lease
            ready.fulfill()
        })
        wait(for: [ready], timeout: 2)
        XCTAssertEqual(released, 0)
        XCTAssertFalse(operation.isBusy)
        previewLease?.close()
        previewLease?.close()
        XCTAssertEqual(released, 1)
    }

    func testCancelNeverPublishesLateSuccessOrReleasesAnActiveReadGrant() {
        let started = expectation(description: "started")
        let released = expectation(description: "grant released after read")
        let gate = DispatchSemaphore(value: 0)
        let operation = VimicateFilePreviewPreparation { url, _ in
            started.fulfill()
            _ = gate.wait(timeout: .now() + 2)
            return url
        }
        var outcomes = 0
        var releaseCount = 0
        operation.prepare(url: fileURL, lease: .init { releaseCount += 1; released.fulfill() }) {
            guard case .cancelled = $0 else { return XCTFail("Late preview") }
            outcomes += 1
        }
        wait(for: [started], timeout: 1)
        operation.cancel()
        operation.cancel()
        XCTAssertEqual(outcomes, 1)
        XCTAssertEqual(releaseCount, 0)
        XCTAssertTrue(operation.isBusy)
        XCTAssertFalse(operation.prepare(url: fileURL, lease: .init {}) { _ in XCTFail("Overlapping read") })
        gate.signal()
        wait(for: [released], timeout: 2)
        XCTAssertFalse(operation.isBusy)
        XCTAssertEqual(outcomes, 1)
        XCTAssertEqual(releaseCount, 1)
    }

    func testTimeoutIsRecoverableAndStillDrainsTheReadExactlyOnce() {
        let timedOut = expectation(description: "timeout")
        let released = expectation(description: "released")
        let gate = DispatchSemaphore(value: 0)
        let operation = VimicateFilePreviewPreparation(timeout: 0.03) { url, _ in
            _ = gate.wait(timeout: .now() + 2)
            return url
        }
        var outcomes = 0
        var releaseCount = 0
        operation.prepare(url: fileURL, lease: .init { releaseCount += 1; released.fulfill() }) {
            guard case let .unavailable(message) = $0 else { return XCTFail("Wrong timeout result") }
            XCTAssertTrue(message.contains("Try this link again"))
            outcomes += 1
            timedOut.fulfill()
        }
        wait(for: [timedOut], timeout: 1)
        XCTAssertEqual(releaseCount, 0)
        gate.signal()
        wait(for: [released], timeout: 2)
        XCTAssertEqual(outcomes, 1)
        XCTAssertEqual(releaseCount, 1)
    }

    func testReadFailureReleasesAccessAndAllowsANewAttempt() {
        let failed = expectation(description: "failed")
        var released = 0
        let operation = VimicateFilePreviewPreparation { _, _ in throw CocoaError(.fileReadNoPermission) }
        operation.prepare(url: fileURL, lease: .init { released += 1 }) {
            guard case let .unavailable(message) = $0 else { return XCTFail("Wrong failure result") }
            XCTAssertTrue(message.contains("Try again"))
            XCTAssertEqual(released, 1)
            failed.fulfill()
        }
        wait(for: [failed], timeout: 2)
        XCTAssertFalse(operation.isBusy)
        let retried = expectation(description: "new attempt")
        XCTAssertTrue(operation.prepare(url: fileURL, lease: .init {}) { _ in retried.fulfill() })
        wait(for: [retried], timeout: 2)
    }

    func testDisposedOwnerCannotPublishAndDrainsItsLease() {
        let started = expectation(description: "started")
        let released = expectation(description: "released")
        let gate = DispatchSemaphore(value: 0)
        var operation: VimicateFilePreviewPreparation? = .init { url, _ in
            started.fulfill()
            _ = gate.wait(timeout: .now() + 2)
            return url
        }
        operation?.prepare(url: fileURL, lease: .init { released.fulfill() }) { _ in XCTFail("Disposed publication") }
        wait(for: [started], timeout: 1)
        operation = nil
        gate.signal()
        wait(for: [released], timeout: 2)
    }

    func testUnusedLeaseIsBalancedOnDisposal() {
        var released = 0
        var lease: VimicateFileAccessLease? = .init { released += 1 }
        XCTAssertNotNil(lease)
        lease = nil
        XCTAssertEqual(released, 1)
    }

    private func fixture(_ data: Data) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let file = directory.appendingPathComponent("document.txt")
        try data.write(to: file)
        return file
    }
}
