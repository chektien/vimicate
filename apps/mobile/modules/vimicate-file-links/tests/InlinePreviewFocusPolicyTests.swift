import XCTest
@testable import VimicateFilePreview

final class InlinePreviewFocusPolicyTests: XCTestCase {
    private typealias Policy = VimicateInlinePreviewFocusPolicy

    func testOnlyUnsolicitedFocusInsidePreviewIsRestored() {
        XCTAssertEqual(Policy.decide(responder: .preview, authorityValid: true,
            accessibilityActive: false), .restore)
        XCTAssertEqual(Policy.decide(responder: .original, authorityValid: true,
            accessibilityActive: false), .wait)
    }

    func testNewOwnerAndExplicitResignationEndProtection() {
        for responder in [Policy.Responder.other, .absent] {
            XCTAssertEqual(Policy.decide(responder: responder, authorityValid: true,
                accessibilityActive: false), .stop)
        }
    }

    func testAccessibilityRelinquishesOwnership() {
        for responder in [Policy.Responder.original, .preview, .other, .absent] {
            XCTAssertEqual(Policy.decide(responder: responder, authorityValid: true,
                accessibilityActive: true), .stop)
        }
    }

    func testDetachInactiveWindowModalAndExpiryCannotRestoreFocus() {
        for responder in [Policy.Responder.original, .preview, .other, .absent] {
            XCTAssertEqual(Policy.decide(responder: responder, authorityValid: false,
                accessibilityActive: false), .stop)
        }
    }
}
