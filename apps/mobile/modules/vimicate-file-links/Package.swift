// swift-tools-version: 5.9
import PackageDescription

// Compiles the actual Foundation leaf used by the iOS module, not a test copy.
let package = Package(
    name: "VimicateFilePreview",
    platforms: [.macOS(.v13)],
    products: [.library(name: "VimicateFilePreview", targets: ["VimicateFilePreview"])],
    targets: [
        .target(name: "VimicateFilePreview", path: "ios", exclude: [
            "VimicateFileLinksModule.swift", "VimicateFileLinkCoordinator.swift",
            "VimicateFilePreviewController.swift",
            "VimicateFilePreviewView.swift", "VimicateRTFPreviewTextView.swift",
            "VimicateInlinePreviewFocus.swift",
            "VimicateHTMLPreviewView.swift", "VimicateFileShareCoordinator.swift",
            "VimicateFileLinks.podspec"
        ], sources: [
            "VimicateFileBookmarkStore.swift",
            "VimicateFilePreviewPreparation.swift",
            "VimicateInlinePreviewStaging.swift", "VimicateRTFPreviewPolicy.swift",
            "VimicateInlinePreviewFocusPolicy.swift",
            "VimicateHTMLPreviewPolicy.swift",
            "VimicateFileShareStreamStore.swift",
            "VimicateFileProviderMapping.swift"
        ]),
        .testTarget(name: "VimicateFilePreviewTests", dependencies: ["VimicateFilePreview"], path: "tests")
    ]
)
