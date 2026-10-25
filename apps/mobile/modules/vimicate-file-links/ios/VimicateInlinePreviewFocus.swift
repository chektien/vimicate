import UIKit

/// Owns only the unsolicited Quick Look responder handoff. No private scene
/// APIs, responder swizzling, keyboard activation or disabled preview gestures.
final class VimicateInlinePreviewFocus {
    private weak var host: UIView?
    private weak var original: UIView?
    private weak var originalWindow: UIWindow?
    private weak var presenter: UIViewController?
    private var timer: Timer?
    private var interaction: VimicatePreviewInteraction?
    private var inactiveObserver: NSObjectProtocol?
    private let deadline = ProcessInfo.processInfo.systemUptime + VimicateInlinePreviewStaging.maximumLifetime

    init(host: UIView, presenter: UIViewController) {
        self.host = host
        self.presenter = presenter
        guard let window = host.window, window.isKeyWindow,
              let original = Self.firstResponder(in: window),
              !original.isDescendant(of: host) else { return }
        self.original = original
        originalWindow = window
        let interaction = VimicatePreviewInteraction { [weak self] in self?.stop() }
        self.interaction = interaction
        host.addGestureRecognizer(interaction)
        inactiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.stop() }
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.reconcile() }
        timer.tolerance = 0.01
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
        reconcile()
    }

    private func reconcile() {
        guard let host, let original, let window = originalWindow else { stop(); return }
        // The usual path is constant-time; do not walk the app's transcript
        // hierarchy on every tick while the original owner still has focus.
        let current = original.isFirstResponder ? original : Self.firstResponder(in: window)
        let responder: VimicateInlinePreviewFocusPolicy.Responder = current === original ? .original
            : current.map { $0.isDescendant(of: host) ? .preview : .other } ?? .absent
        var controller = presenter
        var modalPresented = false
        while let next = controller {
            modalPresented = modalPresented || next.presentedViewController != nil
            controller = next.parent
        }
        let valid = host.window === window && original.window === window && window.isKeyWindow
            && original.canBecomeFirstResponder && !modalPresented
            && UIApplication.shared.applicationState == .active
            && ProcessInfo.processInfo.systemUptime < deadline
        switch VimicateInlinePreviewFocusPolicy.decide(responder: responder, authorityValid: valid,
            accessibilityActive: UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning) {
        case .wait: break
        case .restore:
            // Refusal is terminal: never keep attempting to activate an owner
            // whose own focus policy no longer permits the handoff.
            if !original.becomeFirstResponder() { stop() }
        case .stop: stop()
        }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        if let interaction { host?.removeGestureRecognizer(interaction) }
        interaction = nil
        if let inactiveObserver { NotificationCenter.default.removeObserver(inactiveObserver) }
        inactiveObserver = nil
        original = nil
        originalWindow = nil
    }

    static func firstResponder(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        for child in view.subviews {
            if let found = firstResponder(in: child) { return found }
        }
        return nil
    }

    deinit { stop() }
}

/// Observes touch-down, then fails immediately so native tap, pan and pinch
/// recognizers retain their normal behavior. A deliberate preview interaction
/// relinquishes protection for this mount, including later remote handoffs.
private final class VimicatePreviewInteraction: UIGestureRecognizer {
    private let began: () -> Void
    init(began: @escaping () -> Void) {
        self.began = began
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .failed
        began()
    }
}
