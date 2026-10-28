import ExpoModulesCore
import UIKit

struct VimicateFileShareAnchor: Record {
    @Field var x: Double = 0
    @Field var y: Double = 0
    @Field var width: Double = 0
    @Field var height: Double = 0
}

/// One explicit share at a time. UIKit owns the chooser; this owns the complete
/// staged bytes until dismissal, cancellation, timeout, or module destruction.
final class VimicateFileShareCoordinator {
    private let preparation = VimicateInlinePreviewPreparation(stager: { try VimicateInlinePreviewStaging.stageForSharing($0) })
    private var generation = UUID()
    private var pending: Promise?
    private var file: VimicateInlinePreviewFile?
    private weak var activity: UIActivityViewController?
    private var expiry: Timer?
    private var streamID: String?

    func share(_ input: VimicateInlinePreviewStaging.Input, anchor: VimicateFileShareAnchor?,
               from presenter: UIViewController, promise: Promise) {
        guard pending == nil else {
            promise.reject("E_FILE_SHARE_BUSY", "A file share is already open.")
            return
        }
        guard canPresent(presenter) else {
            promise.reject("E_FILE_SHARE_VIEW", "Return to the active Files pane before sharing.")
            return
        }
        pending = promise
        let id = generation
        preparation.prepare(input) { [weak self, weak presenter] result in
            guard let self, self.generation == id else { return }
            switch result {
            case let .failure(error): self.fail(error.localizedDescription)
            case let .success(file):
                guard let presenter, self.canPresent(presenter) else {
                    self.fail("The Files pane is no longer available for sharing.")
                    return
                }
                self.present(file, anchor: anchor, from: presenter, id: id)
            }
        }
    }

    func shareStaged(_ file: VimicateInlinePreviewFile, id: String, anchor: VimicateFileShareAnchor?,
                     from presenter: UIViewController, promise: Promise) {
        guard pending == nil, canPresent(presenter) else {
            promise.reject("E_FILE_SHARE_VIEW", "The share sheet cannot be presented right now.")
            return
        }
        pending = promise
        streamID = id
        present(file, anchor: anchor, from: presenter, id: generation)
    }

    func cancel(id: String) {
        if streamID == id { invalidate() }
    }

    private func present(_ file: VimicateInlinePreviewFile, anchor: VimicateFileShareAnchor?,
                         from presenter: UIViewController, id: UUID) {
        self.file = file
        let controller = UIActivityViewController(activityItems: [file.url], applicationActivities: nil)
        controller.completionWithItemsHandler = { [weak self] _, completed, _, error in
            guard let self, self.generation == id else { return }
            if let error { self.fail(error.localizedDescription) }
            else { self.finish(completed ? "shared" : "cancelled") }
        }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = self.sourceRect(anchor, in: presenter.view)
            // Any side: a tall share sheet (contacts + apps + actions) anchored
            // mid-screen overflowed below the button with only up/down allowed,
            // hiding its action rows. Beside the button it gets full height.
            popover.permittedArrowDirections = .any
        }
        self.activity = controller
        presenter.present(controller, animated: true)
        self.expiry = Timer.scheduledTimer(withTimeInterval: VimicateInlinePreviewStaging.maximumLifetime,
            repeats: false) { [weak self] _ in
            guard let self, self.generation == id else { return }
            self.invalidate()
        }
    }

    private func canPresent(_ presenter: UIViewController) -> Bool {
        UIApplication.shared.applicationState == .active && presenter.viewIfLoaded?.window != nil &&
            presenter.view.window?.windowScene?.activationState == .foregroundActive &&
            !presenter.isBeingDismissed && presenter.presentedViewController == nil
    }

    private func sourceRect(_ anchor: VimicateFileShareAnchor?, in view: UIView) -> CGRect {
        if let anchor, [anchor.x, anchor.y, anchor.width, anchor.height].allSatisfy({ $0.isFinite }),
           anchor.width > 0, anchor.height > 0 {
            let rect = view.convert(CGRect(x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height), from: view.window)
            let clipped = rect.intersection(view.bounds)
            if !clipped.isNull && !clipped.isEmpty { return clipped }
        }
        return CGRect(x: view.bounds.midX, y: view.bounds.maxY - 44, width: 1, height: 1)
    }

    private func finish(_ status: String) {
        let promise = pending
        clear()
        promise?.resolve(["status": status])
    }
    private func fail(_ message: String) {
        let promise = pending
        clear()
        promise?.reject("E_FILE_SHARE", message)
    }
    private func clear() {
        generation = UUID()
        preparation.cancel()
        expiry?.invalidate()
        expiry = nil
        pending = nil
        streamID = nil
        activity = nil
        file = nil
    }
    func invalidate() {
        let controller = activity
        // Retain bytes until the activity is actually detached.
        let retainedFile = file
        controller?.completionWithItemsHandler = nil
        controller?.dismiss(animated: false) { withExtendedLifetime(retainedFile) {} }
        finish("cancelled")
    }
    deinit { expiry?.invalidate() }
}
