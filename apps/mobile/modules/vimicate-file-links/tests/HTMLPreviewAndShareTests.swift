import Foundation
import XCTest
@testable import VimicateFilePreview

final class HTMLPreviewAndShareTests: XCTestCase {
    private func input(_ source: String, name: String = "mock.html") -> VimicateInlinePreviewStaging.Input {
        .init(dataBase64: Data(source.utf8).base64EncodedString(), filename: name, mimeType: "text/html")
    }
    func testHTMLPreservesInteractiveDocumentAfterIsolationPolicy() throws {
        let source = "<!doctype html><html><button onclick=\"this.textContent='Done'\">Run</button><script>let a = 1;</script></html>"
        let rendered = try VimicateHTMLPreviewPolicy.document(input(source))
        XCTAssertTrue(rendered.hasSuffix(source))
        XCTAssertTrue(rendered.hasPrefix("<!doctype html><meta http-equiv=\"Content-Security-Policy\""))
        XCTAssertTrue(rendered.contains("connect-src 'none'"))
        XCTAssertTrue(rendered.contains("form-action 'none'"))
        XCTAssertTrue(rendered.contains("base-uri 'none'"))
    }
    func testHTMLRejectsIncompleteEncodingInvalidUTF8AndOversizedInput() {
        for encoded in ["Zg", "Zg==\n", Data([0xff]).base64EncodedString(), Data(repeating: 65, count: 1024 * 1024 + 1).base64EncodedString()] {
            XCTAssertThrowsError(try VimicateHTMLPreviewPolicy.document(.init(dataBase64: encoded, filename: "mock.html", mimeType: "text/html")))
        }
        XCTAssertThrowsError(try VimicateHTMLPreviewPolicy.document(input("hello", name: "payload.svg")))
    }
    func testHTMLNavigationAllowsOnlyInitialDocumentAndSameDocumentAnchors() {
        let base = URL(string: "about:blank")!
        XCTAssertTrue(VimicateHTMLPreviewPolicy.allowsNavigation(to: base, current: nil, initial: true))
        XCTAssertTrue(VimicateHTMLPreviewPolicy.allowsNavigation(to: URL(string: "about:blank#details"), current: base, initial: false))
        for candidate in ["https://example.com/#details", "file:///private/data#x", "javascript:alert(1)", "data:text/html,hello", "about:blank"] {
            XCTAssertFalse(VimicateHTMLPreviewPolicy.allowsNavigation(to: URL(string: candidate), current: base, initial: false))
        }
    }
    func testSharePreservesOriginalHTMLAndEmptyFilesWithoutRenderingThem() throws {
        for source in ["<script>alert('exact')</script>", ""] {
            var file: VimicateInlinePreviewFile? = try VimicateInlinePreviewStaging.stageForSharing(input(source))
            let url = try XCTUnwrap(file?.url)
            XCTAssertEqual(try Data(contentsOf: url), Data(source.utf8))
            XCTAssertEqual(url.lastPathComponent, "mock.html")
            file = nil
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        }
    }
    func testShareCannotEscapeDirectoryOrStageOversizedFiles() {
        XCTAssertThrowsError(try VimicateInlinePreviewStaging.stageForSharing(input("x", name: "../../secret")))
        let oversized = VimicateInlinePreviewStaging.Input(dataBase64: Data(repeating: 0, count: 32 * 1024 * 1024 + 1).base64EncodedString(), filename: "big.bin", mimeType: "application/octet-stream")
        XCTAssertThrowsError(try VimicateInlinePreviewStaging.stageForSharing(oversized))
    }
    func testSharingHasIndependentCeilingAndRemovesTheCompleteOriginalAfterRelease() throws {
        let original = Data(repeating: 0xa5, count: 8 * 1024 * 1024 + 17)
        let input = VimicateInlinePreviewStaging.Input(dataBase64: original.base64EncodedString(), filename: "original.pdf", mimeType: "application/pdf")
        XCTAssertThrowsError(try VimicateInlinePreviewStaging.stage(input))
        var file: VimicateInlinePreviewFile? = try VimicateInlinePreviewStaging.stageForSharing(input)
        let url = try XCTUnwrap(file?.url)
        XCTAssertEqual(try Data(contentsOf: url), original)
        file = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
