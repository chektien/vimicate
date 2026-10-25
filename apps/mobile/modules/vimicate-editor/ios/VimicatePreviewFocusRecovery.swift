import UIKit

/// The keyboard owner, not a disposable preview, owns this bounded recovery.
/// A nil responder is only observed; it never authorizes activating a keyboard.
final class VimicatePreviewFocusRecovery {
    private weak var owner: UIView?
    private let requested: () -> Bool
    private weak var recoveryWindow: UIWindow?
    private var timer: Timer?
    private var deadline = 0.0

    init(owner: UIView, requested: @escaping () -> Bool) {
        self.owner = owner
        self.requested = requested
    }

    func responderDidResign() {
        stop()
        guard requested(), let window = owner?.window else { return }
        recoveryWindow = window
        deadline = ProcessInfo.processInfo.systemUptime + 5
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.reconcile() }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func reconcile() {
        guard requested(), let owner, let window = recoveryWindow, owner.window === window, window.isKeyWindow,
              UIApplication.shared.applicationState == .active,
              !UIAccessibility.isVoiceOverRunning, !UIAccessibility.isSwitchControlRunning,
              ProcessInfo.processInfo.systemUptime < deadline else { stop(); return }
        if owner.isFirstResponder { stop(); return }
        var ancestor: UIResponder? = owner
        while let current = ancestor {
            if let controller = current as? UIViewController, controller.presentedViewController != nil { stop(); return }
            ancestor = current.next
        }
        // UIKit can clear the responder before detaching a preview subtree.
        // Keep observing through that gap, but only restore after an explicitly
        // marked inline document demonstrably takes focus in this same window.
        guard let current = Self.firstResponder(in: window) else { return }
        var view: UIView? = current
        while let candidate = view {
            if candidate.accessibilityIdentifier == "vimicate.inline-document-preview" {
                stop() // terminal before UIKit callbacks can reenter
                _ = owner.becomeFirstResponder()
                return
            }
            view = candidate.superview
        }
        stop() // another input, modal or HTML interaction owns its handoff
    }

    func stop() { timer?.invalidate(); timer = nil; recoveryWindow = nil }
    deinit { stop() }

    private static func firstResponder(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        for child in view.subviews {
            if let found = firstResponder(in: child) { return found }
        }
        return nil
    }
}
