import XCTest
@testable import VimicateFatalDiagnostics

final class VimicateFatalDiagnosticTests: XCTestCase {
    func testOriginatingSetterIsRetainedSeparatelyFromComponentLocations() {
        let message = "Unhandled JS Exception: Error: depth exceeded\n at FlashList (main.jsbundle:1:800)"
        let origin = VimicateFatalOrigin(summary: "Error: depth exceeded", frames: [
            "at dispatchSetState (/private/container/main.jsbundle:1:300)",
            "at anonymous (main.jsbundle:1:400)",
            "PRIVATE PROSE"
        ], at: 100)
        let result = VimicateFatalDiagnostic.retained(message, at: 200, version: "1", build: "2",
            originatingStack: origin.matchingFrames(message, at: 200))
        XCTAssertTrue(result.contains("originating JS stack:\ndispatchSetState @ main.jsbundle:1:300\nanonymous @ main.jsbundle:1:400"))
        XCTAssertTrue(result.contains("stack locations (as reported):\nFlashList @ main.jsbundle:1:800"))
        XCTAssertFalse(result.contains("PRIVATE"))
        XCTAssertFalse(result.contains("/private"))
    }

    func testPendingOriginCannotAttachToAnotherOrStaleFatal() {
        let origin = VimicateFatalOrigin(summary: "Error: first", frames: ["at setter (main.jsbundle:1:100)"], at: 100)
        XCTAssertEqual(origin.matchingFrames("Unhandled JS Exception: Error: first", at: 5100).count, 1)
        XCTAssertTrue(origin.matchingFrames("Unhandled JS Exception: Error: second", at: 200).isEmpty)
        XCTAssertTrue(origin.matchingFrames("Unhandled JS Exception: Error: first", at: 5101).isEmpty)
        XCTAssertTrue(origin.matchingFrames("Unhandled JS Exception: Error: first", at: 99).isEmpty)
    }

    func testOriginRemainsBoundedAndPrecedesLongComponentStackAndContext() {
        let frames = (1...100).map { "at setter\($0) (main.jsbundle:1:\($0))" }
        let result = VimicateFatalDiagnostic.retained("failure\n" + frames.joined(separator: "\n"), at: 1, version: "1", build: "2",
            preFatalContext: Array(repeating: String(repeating: "context ", count: 100), count: 8), originatingStack: frames)
        XCTAssertTrue(result.contains("originating JS stack:\nsetter1 @"))
        XCTAssertFalse(result.contains("setter17 @"))
        XCTAssertTrue(result.contains("[diagnostic shortened]"))
        XCTAssertLessThanOrEqual(result.count, 4096)
    }

    func testReportedRenderErrorRetainsLocationsBeyondTheOldBreadcrumbCeiling() {
        let message = """
        Unhandled JS Exception: Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.

        This error is located at:
            at FlashList (address at /var/mobile/Containers/Data/Application/PRIVATE-CONTAINER/Library/Application Support/.expo-internal/bundle.hbc:1:342198)
            at TranscriptPane (address at /var/mobile/Containers/Data/Application/PRIVATE-CONTAINER/Library/Application Support/.expo-internal/bundle.hbc:1:951203)
        """
        let result = VimicateFatalDiagnostic.retained(message, at: 1788156476586, version: "0.1.1", build: "202608302350")
        XCTAssertTrue(result.contains("Maximum update depth exceeded"))
        XCTAssertTrue(result.contains("FlashList @ bundle.hbc:1:342198"))
        XCTAssertTrue(result.contains("TranscriptPane @ bundle.hbc:1:951203"))
        XCTAssertFalse(result.contains("PRIVATE-CONTAINER"))
    }

    func testRetainsNativeIdentityAndRedactsMessageSecrets() {
        let result = VimicateFatalDiagnostic.retained("failure token=secret developer@example.com", at: 123, version: "0.1.1", build: "7")
        XCTAssertTrue(result.hasPrefix("at=123 build=0.1.1(7) fatal.native"))
        XCTAssertFalse(result.contains("secret"))
        XCTAssertFalse(result.contains("developer@example.com"))
    }

    func testRetainsOnlyBoundedPrivacySafePreFatalContext() {
        let context = (1...12).map { index in
            "viewport.content ds=opaque items=\(index) token=secret developer@example.com"
        }
        let result = VimicateFatalDiagnostic.retained(
            "failure",
            at: 123,
            version: "0.1.1",
            build: "7",
            preFatalContext: context
        )

        XCTAssertTrue(result.contains("pre-fatal context (oldest to newest):"))
        XCTAssertFalse(result.contains("items=4"))
        XCTAssertTrue(result.contains("items=5"))
        XCTAssertTrue(result.contains("items=12"))
        XCTAssertFalse(result.contains("secret"))
        XCTAssertFalse(result.contains("developer@example.com"))
        XCTAssertLessThanOrEqual(result.count, 4_096)
    }

    func testDoesNotRetainArbitraryMultilineExceptionContent() {
        let result = record("failure\nPRIVATE TRANSCRIPT CONTENT\nrequest={\"secret\":\"hidden\"}\n    at recover (index.bundle:1:100)")
        XCTAssertFalse(result.contains("PRIVATE"))
        XCTAssertFalse(result.contains("hidden"))
        XCTAssertTrue(result.contains("recover @ index.bundle:1:100"))
    }

    func testDropsContainerPathsAndURLQueryCredentialsButKeepsCoordinates() {
        let result = record("failure\n    at recover (address at https://private.example/index.bundle?token=secret:1:100)\n    at run (/Users/Person/private/app.js:20:30)")
        XCTAssertTrue(result.contains("recover @ index.bundle:1:100"))
        XCTAssertTrue(result.contains("run @ app.js:20:30"))
        for secret in ["private.example", "token", "secret", "Person", "/Users/"] {
            XCTAssertFalse(result.contains(secret))
        }
    }

    func testBoundsFramesAndMarksShortening() {
        let frames = (1...200).map { "    at frame\($0) (index.bundle:1:\($0))" }.joined(separator: "\n")
        let result = record("failure\n" + frames)
        XCTAssertTrue(result.contains("frame16 @"))
        XCTAssertFalse(result.contains("frame17 @"))
        XCTAssertTrue(result.contains("[diagnostic shortened]"))
        XCTAssertLessThanOrEqual(result.count, 4_096)
    }

    func testBoundsInputAndDoesNotInventAStackWhenUnavailable() {
        let result = record(String(repeating: "x", count: 50_000))
        XCTAssertLessThanOrEqual(result.count, 4_096)
        XCTAssertTrue(result.contains("stack locations unavailable"))
        XCTAssertTrue(result.contains("[diagnostic shortened]"))
    }

    func testAcceptsCRLFAndUnicodeWithoutExpandingStoredPayload() {
        let result = record("failure 中文\r\n    at recover (address at /private/测试.js:123:456)\r\n")
        XCTAssertTrue(result.contains("recover @ 测试.js:123:456"))
        XCTAssertTrue(result.contains("failure 中文"))
    }

    func testMalformedFramesAreNotMistakenForStackLocations() {
        let result = record("failure\n    at example@test.com (index.bundle:1:100)\n    at recover (index.bundle:not:coordinates)\n    at recover (arbitrary content)")
        XCTAssertTrue(result.contains("stack locations unavailable"))
        XCTAssertFalse(result.contains("example@test.com"))
        XCTAssertFalse(result.contains("arbitrary content"))
    }

    private func record(_ message: String) -> String {
        VimicateFatalDiagnostic.retained(message, at: 123, version: "0.1.1", build: "7")
    }
}
