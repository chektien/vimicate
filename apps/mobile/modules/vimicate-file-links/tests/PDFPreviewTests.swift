import Foundation
import PDFKit
import XCTest
@testable import VimicateFilePreview

final class PDFPreviewTests: XCTestCase {
    private func fixture() throws -> Data {
        let document = PDFDocument()
        let page = PDFPage()
        page.setBounds(CGRect(x: 0, y: 0, width: 600, height: 900), for: .mediaBox)
        let field = PDFAnnotation(bounds: CGRect(x: 20, y: 20, width: 200, height: 40), forType: .widget, withProperties: nil)
        field.widgetFieldType = .text
        field.widgetStringValue = "Synthetic form value"
        field.isReadOnly = false
        page.addAnnotation(field)
        document.insert(page, at: 0)
        return try XCTUnwrap(document.dataRepresentation())
    }

    func testPreparedPDFKeepsOriginalBytesAndMakesFormFieldsReadOnly() throws {
        let data = try fixture()
        let owner = VimicateInlinePreviewPreparation()
        let ready = expectation(description: "prepared")
        owner.prepare(.init(dataBase64: data.base64EncodedString(), filename: "form.pdf", mimeType: "application/pdf")) { result in
            do {
                let file = try result.get()
                let document = try XCTUnwrap(file.pdfDocument)
                XCTAssertEqual(document.pageCount, 1)
                let field = try XCTUnwrap(document.page(at: 0)?.annotations.first)
                XCTAssertTrue(field.isReadOnly)
                XCTAssertEqual(field.widgetStringValue, "Synthetic form value")
                XCTAssertEqual(try Data(contentsOf: file.url), data, "Preview must not rewrite shared original bytes")
            } catch { XCTFail("\(error)") }
            ready.fulfill()
        }
        wait(for: [ready], timeout: 5)
        withExtendedLifetime(owner) {}
    }

    func testInvalidPDFSettlesErrorAndSharingStillPreservesExactBytes() throws {
        let data = Data("not a PDF".utf8)
        let input = VimicateInlinePreviewStaging.Input(dataBase64: data.base64EncodedString(), filename: "invalid.pdf", mimeType: "application/pdf")
        let owner = VimicateInlinePreviewPreparation()
        let ready = expectation(description: "rejected")
        owner.prepare(input) { result in
            switch result {
            case .success: XCTFail("Invalid PDF was published")
            case let .failure(error): XCTAssertEqual(error as? VimicateInlinePreviewStaging.Failure, .invalidPDF)
            }
            ready.fulfill()
        }
        wait(for: [ready], timeout: 5)
        let share = try VimicateInlinePreviewStaging.stageForSharing(input)
        XCTAssertNil(share.pdfDocument)
        XCTAssertEqual(try Data(contentsOf: share.url), data)
        withExtendedLifetime(owner) {}
    }
}
