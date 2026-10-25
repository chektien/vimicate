import UIKit

/// Passive inline document. Scrolling stays native; typing and navigation stay
/// with Vimicate's existing keyboard owner, even after asynchronous rendering.
final class VimicateRTFPreviewTextView: UITextView {
    override var canBecomeFirstResponder: Bool { false }

    init(text: NSAttributedString) {
        super.init(frame: .zero, textContainer: nil)
        isEditable = false
        isSelectable = false
        dataDetectorTypes = []
        backgroundColor = .white
        textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        attributedText = text
        accessibilityLabel = "RTF file preview"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}
