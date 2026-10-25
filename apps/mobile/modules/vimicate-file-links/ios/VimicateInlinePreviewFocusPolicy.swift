import Foundation

/// An inline preview may repair an unsolicited handoff into its own subtree,
/// but never acquire focus or undo an explicit handoff by the user/app.
enum VimicateInlinePreviewFocusPolicy {
    enum Responder { case original, preview, other, absent }
    enum Decision { case wait, restore, stop }

    static func decide(responder: Responder, authorityValid: Bool,
                       accessibilityActive: Bool) -> Decision {
        guard authorityValid, !accessibilityActive else { return .stop }
        switch responder {
        case .original: return .wait
        case .preview: return .restore
        case .other, .absent: return .stop
        }
    }
}
