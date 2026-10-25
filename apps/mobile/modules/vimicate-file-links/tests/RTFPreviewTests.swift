import Foundation
import XCTest
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif
@testable import VimicateFilePreview

final class RTFPreviewTests: XCTestCase {
    private let synthetic = Data(#"{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}\f0\fs24 Synthetic {\ul underlined} words.\par Unicode \u233? text.}"#.utf8)

    func testRTFIsPreparedAsRichTextOffMainInsteadOfHandedToQuickLook() {
        let done = expectation(description: "RTF prepared")
        let owner = VimicateInlinePreviewPreparation()
        owner.prepare(.init(dataBase64: synthetic.base64EncodedString(), filename: "synthetic.rtf", mimeType: "application/rtf")) { result in
            do {
                let file = try result.get()
                let text = try XCTUnwrap(file.attributedText)
                XCTAssertEqual(text.string, "Synthetic underlined words.\nUnicode é text.")
                XCTAssertNotNil(text.attribute(.underlineStyle, at: 10, effectiveRange: nil))
            } catch { XCTFail("\(error)") }
            done.fulfill()
        }
        wait(for: [done], timeout: 2)
    }

    func testLargeMalformedAndEmbeddedRTFAreRejectedBeforeSystemConversion() {
        let inputs = [Data(repeating: 32, count: 256 * 1024 + 1), Data("not RTF".utf8),
            Data(#"{\rtf1 {\ul unclosed}"#.utf8), Data((#"{\rtf1 "# + String(repeating: "{", count: 65) + "x" + String(repeating: "}", count: 65) + "}").utf8),
            Data(#"{\rtf1 {\pict\pngblip 00}}"#.utf8), Data(#"{\rtf1\bin4 test}"#.utf8),
            Data(#"{\rtf1\fs999999999999 text}"#.utf8), Data(#"{\rtf1 {\NeXTGraphic private.png}}"#.utf8)]
        for data in inputs { XCTAssertThrowsError(try VimicateRTFPreviewPolicy.attributedText(data)) }
    }

    func testRenderedTextHasABoundAndEscapedBracesRemainLiteral() throws {
        XCTAssertThrowsError(try VimicateRTFPreviewPolicy.attributedText(Data((#"{\rtf1 "# + String(repeating: "x", count: 32 * 1024 + 1) + "}").utf8)))
        let text = try VimicateRTFPreviewPolicy.attributedText(Data(#"{\rtf1 Literal \{braces\} and \\ slash.}"#.utf8))
        XCTAssertEqual(text.string, "Literal {braces} and \\ slash.")
    }

    func testHyperlinksRemainVisibleWithoutAnExternalOpenAction() throws {
        let text = try VimicateRTFPreviewPolicy.attributedText(Data(#"{\rtf1 {\field{\*\fldinst HYPERLINK "https://example.invalid"}{\fldrslt Synthetic link}}}"#.utf8))
        XCTAssertEqual(text.string, "Synthetic link")
        XCTAssertNil(text.attribute(.link, at: 0, effectiveRange: nil))
    }

    func testSharingPreservesRTFBytesWithoutParsingOrPreviewBounds() throws {
        let data = Data(repeating: 1, count: 256 * 1024 + 1)
        let file = try VimicateInlinePreviewStaging.stageForSharing(.init(dataBase64: data.base64EncodedString(), filename: "synthetic.rtf", mimeType: "application/rtf"))
        XCTAssertEqual(try Data(contentsOf: file.url), data)
        XCTAssertNil(file.attributedText)
    }
}
