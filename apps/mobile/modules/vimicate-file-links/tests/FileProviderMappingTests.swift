import Foundation
import XCTest
@testable import VimicateFilePreview

final class FileProviderMappingTests: XCTestCase {
    func testCloudAliasRejectsABroaderRemoteHomeBookmark() {
        let target = "/Users/fixture/icloud/Downloads/result.csv"
        XCTAssertEqual(
            VimicateFileProviderMapping.eligibleRoots(
                for: target,
                roots: ["/Users/fixture", "/Users/fixture/icloud", "/Users/fixture/icloud/Downloads"]
            ),
            ["/Users/fixture/icloud/Downloads", "/Users/fixture/icloud"]
        )
        XCTAssertNil(VimicateFileProviderMapping.remoteHomeRoot(for: target))
    }

    func testCanonicalCloudDocsPathRejectsABroaderRemoteHomeBookmark() {
        let target = "/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/Downloads/result.csv"
        XCTAssertEqual(
            VimicateFileProviderMapping.eligibleRoots(
                for: target,
                roots: [
                    "/Users/fixture",
                    "/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/Downloads",
                ]
            ),
            ["/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/Downloads"]
        )
        XCTAssertNil(VimicateFileProviderMapping.remoteHomeRoot(for: target))
    }

    func testOrdinaryHostPathStillUsesTheLongestApprovedHomeBookmark() {
        let target = "/Users/fixture/projects/example/README.md"
        XCTAssertEqual(
            VimicateFileProviderMapping.eligibleRoots(
                for: target,
                roots: ["/Users/fixture", "/Users/fixture/projects", "/Users/other"]
            ),
            ["/Users/fixture/projects", "/Users/fixture"]
        )
        XCTAssertEqual(VimicateFileProviderMapping.remoteHomeRoot(for: target), "/Users/fixture")
    }

    func testAUserSelectedExactFileOverridesItsBroadProviderRoot() {
        let target = "/Users/fixture/repos/example-research/feedback/amended.docx"
        XCTAssertEqual(
            VimicateFileProviderMapping.eligibleRoots(
                for: target,
                roots: ["/Users/fixture", target]
            ),
            [target, "/Users/fixture"]
        )
        let selectedURL = URL(fileURLWithPath: "/provider/selected-amended.docx")
        XCTAssertEqual(
            VimicateFileProviderMapping.providerURL(
                rootURL: selectedURL,
                mappingRoot: target,
                hostPath: target,
                isDirectory: false
            ),
            selectedURL
        )
    }

    func testRemoteHomeMappingNamesTheFirstHostSegmentItsProviderRootMustContain() {
        let hostDirectory = "/Users/fixture/repos/example-research/feedback/2026-01-02-example-letter-review"
        XCTAssertEqual(VimicateFileProviderMapping.remoteHomeRoot(for: hostDirectory), "/Users/fixture")
        XCTAssertEqual(
            VimicateFileProviderMapping.firstRelativeSegment(of: hostDirectory, from: "/Users/fixture"),
            "repos"
        )
        XCTAssertNil(
            VimicateFileProviderMapping.firstRelativeSegment(of: "/Users/fixture", from: "/Users/fixture")
        )
    }

    func testAProviderRootDeeperThanTheApprovedHomeMisprojectsEveryDescendant() {
        let hostFile = "/Users/fixture/repos/example-research/feedback/2026-01-02-example-letter-review/letter.md"
        let hostDirectory = "/Users/fixture/repos/example-research/feedback/2026-01-02-example-letter-review"
        XCTAssertEqual(VimicateFileProviderMapping.hostDirectory(for: hostFile), hostDirectory)

        // A provider root that actually backs /Users/fixture/repos, approved as /Users/fixture.
        let providerRoot = URL(fileURLWithPath: "/provider/remote-root")
        XCTAssertEqual(
            VimicateFileProviderMapping.relativeSuffix(of: hostFile, from: "/Users/fixture"),
            "repos/example-research/feedback/2026-01-02-example-letter-review/letter.md"
        )
        XCTAssertEqual(
            VimicateFileProviderMapping.providerURL(
                rootURL: providerRoot,
                mappingRoot: "/Users/fixture",
                hostPath: hostFile,
                isDirectory: false
            )?.path,
            "/provider/remote-root/repos/example-research/feedback/2026-01-02-example-letter-review/letter.md"
        )

        // The containing-folder grant resolves the same file under that same root.
        let containingFolder = providerRoot
            .appendingPathComponent("example-research/feedback/2026-01-02-example-letter-review", isDirectory: true)
        XCTAssertEqual(
            VimicateFileProviderMapping.providerURL(
                rootURL: containingFolder,
                mappingRoot: hostDirectory,
                hostPath: hostFile,
                isDirectory: false
            )?.path,
            "/provider/remote-root/example-research/feedback/2026-01-02-example-letter-review/letter.md"
        )
        XCTAssertEqual(
            VimicateFileProviderMapping.eligibleRoots(for: hostFile, roots: ["/Users/fixture", hostDirectory]),
            [hostDirectory, "/Users/fixture"]
        )
    }
}
