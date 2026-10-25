import Foundation

/// One balanced grant, retained by the read job and then by the visible preview.
final class VimicateFileAccessLease {
    private let lock = NSLock()
    private var release: (() -> Void)?

    init(release: @escaping () -> Void) { self.release = release }

    func close() {
        lock.lock()
        let action = release
        release = nil
        lock.unlock()
        action?()
    }

    deinit { close() }
}

/// Main-queue owner; at most one coordinated read, including a cancelled read
/// that has not drained yet. No retry loop, file copy or additional media cache.
final class VimicateFilePreviewPreparation {
    enum Outcome {
        case ready(URL, VimicateFileAccessLease)
        case unavailable(String)
        case cancelled
    }

    typealias Reader = (URL, NSFileCoordinator) throws -> URL
    private final class Job {
        let coordinator = NSFileCoordinator()
        let lease: VimicateFileAccessLease
        var completion: ((Outcome) -> Void)?
        var deadline: DispatchWorkItem?

        init(lease: VimicateFileAccessLease, completion: @escaping (Outcome) -> Void) {
            self.lease = lease
            self.completion = completion
        }
    }

    private var job: Job?
    private let timeout: TimeInterval
    private let reader: Reader
    var isBusy: Bool { job != nil }

    init(timeout: TimeInterval = 30, reader: @escaping Reader = VimicateFilePreviewPreparation.read) {
        self.timeout = timeout
        self.reader = reader
    }

    @discardableResult
    func prepare(url: URL, lease: VimicateFileAccessLease, completion: @escaping (Outcome) -> Void) -> Bool {
        precondition(Thread.isMainThread)
        guard job == nil else { return false }
        let next = Job(lease: lease, completion: completion)
        job = next
        let deadline = DispatchWorkItem { [weak self] in
            self?.cancel(outcome: .unavailable("Files is still downloading or unavailable. Try this link again when the file is ready."))
        }
        next.deadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: deadline)
        let reader = self.reader
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Result { try reader(url, next.coordinator) }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.job === next else {
                    next.lease.close()
                    return
                }
                self.job = nil
                next.deadline?.cancel()
                guard let completion = next.completion else {
                    next.lease.close()
                    return
                }
                next.completion = nil
                switch result {
                case let .success(readyURL): completion(.ready(readyURL, next.lease))
                case let .failure(error):
                    next.lease.close()
                    completion(.unavailable("The Files item is not ready: \(error.localizedDescription) Try again or check its provider in Files."))
                }
            }
        }
        return true
    }

    func cancel(outcome: Outcome = .cancelled) {
        precondition(Thread.isMainThread)
        guard let job else { return }
        job.deadline?.cancel()
        let completion = job.completion
        job.completion = nil
        job.coordinator.cancel()
        // Cancellation does not imply the accessor has stopped. Its lease stays
        // alive until the worker returns; late success can never present UI.
        completion?(outcome)
    }

    deinit {
        job?.deadline?.cancel()
        job?.coordinator.cancel()
    }

    static func read(url: URL, coordinator: NSFileCoordinator) throws -> URL {
        var coordinationError: NSError?
        var result: Result<URL, Error>?
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            result = Result {
                let values = try coordinatedURL.resourceValues(forKeys: [.isRegularFileKey, .isPackageKey])
                if values.isPackage == true { return coordinatedURL }
                guard values.isRegularFile == true else {
                    throw NSError(domain: "E_FILE_PREVIEW_TYPE", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "Select a readable file, not a folder."])
                }
                let handle = try FileHandle(forReadingFrom: coordinatedURL)
                defer { try? handle.close() }
                guard let firstByte = try handle.read(upToCount: 1), !firstByte.isEmpty else {
                    throw NSError(domain: "E_FILE_PREVIEW_EMPTY", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "The file is empty or its provider has not downloaded it yet."])
                }
                return coordinatedURL
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        return try result.get()
    }
}
