import Foundation
import PDFKit

/// A preview owns this private directory until its controller has detached.
final class VimicateInlinePreviewFile {
    let url: URL
    let attributedText: NSAttributedString?
    private(set) var pdfDocument: PDFDocument?
    private let directory: URL

    init(url: URL, directory: URL, attributedText: NSAttributedString? = nil) {
        self.url = url; self.directory = directory; self.attributedText = attributedText
    }
    /// Run on the existing preparation worker, never scan PDF pages on the UI thread.
    func preparePDF() throws {
        guard url.pathExtension.lowercased() == "pdf" else { return }
        guard let document = PDFDocument(url: url), !document.isLocked, document.pageCount > 0 else {
            throw VimicateInlinePreviewStaging.Failure.invalidPDF
        }
        for index in 0..<document.pageCount {
            for annotation in document.page(at: index)?.annotations ?? [] { annotation.isReadOnly = true }
        }
        pdfDocument = document
    }
    deinit { try? FileManager.default.removeItem(at: directory) }
}

/// Byte staging policy. No host paths, provider grants or app state.
enum VimicateInlinePreviewStaging {
    static let maximumBytes = 8 * 1024 * 1024
    static let maximumShareBytes = 32 * 1024 * 1024
    static let maximumLifetime: TimeInterval = 30 * 60
    struct Input: Equatable {
        let dataBase64: String
        let filename: String
        let mimeType: String
    }
    enum Failure: LocalizedError {
        case invalidName, invalidBase64, tooLarge, shareTooLarge, empty, activeContent, unsupportedType, invalidPDF
        var errorDescription: String? {
            switch self {
            case .invalidName: return "The file name is not a safe basename."
            case .invalidBase64: return "The file data is not valid base64."
            case .tooLarge: return "Files are limited to 8 MiB."
            case .shareTooLarge: return "Sharing is limited to 32 MiB."
            case .empty: return "The file is empty."
            case .invalidPDF: return "This PDF cannot be previewed. Share the complete file to open it elsewhere."
            case .activeContent, .unsupportedType: return "This file type is not available for inline preview."
            }
        }
    }

    static func stage(_ input: Input, root: URL = FileManager.default.temporaryDirectory) throws -> VimicateInlinePreviewFile {
        try stage(input, root: root, sharing: false)
    }

    static func stageForSharing(_ input: Input, root: URL = FileManager.default.temporaryDirectory) throws -> VimicateInlinePreviewFile {
        try stage(input, root: root, sharing: true)
    }

    private static func stage(_ input: Input, root: URL, sharing: Bool) throws -> VimicateInlinePreviewFile {
        let name = input.filename
        guard !name.isEmpty, name != ".", name != "..", name.utf8.count <= 255,
              !name.contains("/"), !name.contains("\\"),
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw Failure.invalidName
        }
        let ext = (name as NSString).pathExtension.lowercased()
        let mime = input.mimeType.split(separator: ";", maxSplits: 1).first?.lowercased().trimmingCharacters(in: .whitespaces) ?? ""
        // Sharing preserves any complete file. Quick Look has a narrower renderer allowlist.
        if !sharing {
            guard !["html", "htm", "xhtml", "svg", "svgz", "js", "mjs", "url", "webloc", "app"].contains(ext),
                  !["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript"].contains(mime) else {
                throw Failure.activeContent
            }
            guard ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "pages", "numbers", "key",
                   "mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "mp4", "m4v", "mov", "zip"].contains(ext) else {
                throw Failure.unsupportedType
            }
        }
        let limit = sharing ? maximumShareBytes : maximumBytes
        guard input.dataBase64.utf8.count <= ((limit + 2) / 3) * 4 else { throw sharing ? Failure.shareTooLarge : Failure.tooLarge }
        guard let data = Data(base64Encoded: input.dataBase64), data.base64EncodedString() == input.dataBase64 else {
            throw Failure.invalidBase64
        }
        guard sharing || !data.isEmpty else { throw Failure.empty }
        guard data.count <= limit else { throw sharing ? Failure.shareTooLarge : Failure.tooLarge }
        let attributedText = !sharing && ext == "rtf" ? try VimicateRTFPreviewPolicy.attributedText(data) : nil
        removeExpiredFiles(in: root)
        let directory = root.appendingPathComponent("vimicate-preview-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        do {
            let url = directory.appendingPathComponent(name, isDirectory: false)
            try data.write(to: url, options: .atomic)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var excluded = directory
            try excluded.setResourceValues(values)
            return VimicateInlinePreviewFile(url: url, directory: directory, attributedText: attributedText)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    /// A process crash cannot run deinit. Reap only our expired private cache
    /// directories on the next staging attempt; never follow a symlink.
    private static func removeExpiredFiles(in root: URL) {
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey, .creationDateKey]
        guard let children = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: Array(keys)) else { return }
        let cutoff = Date().addingTimeInterval(-maximumLifetime)
        for child in children where child.lastPathComponent.hasPrefix("vimicate-preview-") {
            guard let values = try? child.resourceValues(forKeys: keys), values.isDirectory == true,
                  values.isSymbolicLink != true, let created = values.creationDate, created < cutoff else { continue }
            try? FileManager.default.removeItem(at: child)
        }
    }
}

/// Main-thread owner. One worker and one replaceable latest request, never a
/// growing queue of base64 payloads. Cancelled work drains without publication.
final class VimicateInlinePreviewPreparation {
    typealias Input = VimicateInlinePreviewStaging.Input
    typealias Stager = (Input) throws -> VimicateInlinePreviewFile
    private final class Job {
        var completion: ((Result<VimicateInlinePreviewFile, Error>) -> Void)?
        init(_ completion: @escaping (Result<VimicateInlinePreviewFile, Error>) -> Void) { self.completion = completion }
    }
    private var job: Job?
    private var pending: (Input, (Result<VimicateInlinePreviewFile, Error>) -> Void)?
    private let stager: Stager

    init(stager: @escaping Stager = {
        let file = try VimicateInlinePreviewStaging.stage($0)
        try file.preparePDF()
        return file
    }) { self.stager = stager }

    func prepare(_ input: Input, completion: @escaping (Result<VimicateInlinePreviewFile, Error>) -> Void) {
        precondition(Thread.isMainThread)
        if let job {
            job.completion = nil
            pending = (input, completion)
            return
        }
        let next = Job(completion)
        job = next
        let stager = self.stager
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Result { try stager(input) }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.job === next else { return }
                self.job = nil
                next.completion?(result)
                if let pending = self.pending {
                    self.pending = nil
                    self.prepare(pending.0, completion: pending.1)
                }
            }
        }
    }

    func cancel() {
        precondition(Thread.isMainThread)
        job?.completion = nil
        pending = nil
    }
}
