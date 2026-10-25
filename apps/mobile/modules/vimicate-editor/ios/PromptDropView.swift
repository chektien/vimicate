import ExpoModulesCore
import UIKit

final class PromptDropView: ExpoView, UIDropInteractionDelegate {
  let onDrop = EventDispatcher()
  var sessionKey = ""
  var enabled = false { didSet { if !enabled { showTarget(false) } } }
  weak var coordinator: PromptDropCoordinator?
  private let targetBorder = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIDropInteraction(delegate: self))
    targetBorder.fillColor = UIColor.clear.cgColor
    targetBorder.strokeColor = UIColor(red: 184.0 / 255, green: 187.0 / 255, blue: 38.0 / 255, alpha: 1).cgColor
    targetBorder.lineWidth = 2
    targetBorder.lineDashPattern = [6, 4]
    targetBorder.isHidden = true
    layer.addSublayer(targetBorder)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    targetBorder.frame = bounds
    targetBorder.path = UIBezierPath(rect: bounds.insetBy(dx: 2, dy: 2)).cgPath
    targetBorder.zPosition = 100
  }

  private func accepts(_ session: UIDropSession) -> Bool {
    enabled && !sessionKey.isEmpty && coordinator?.canRegister == true &&
      !session.items.isEmpty && session.items.count <= PromptDropPolicy.maximumCount &&
      session.items.allSatisfy { PromptDropPolicy.representation($0.itemProvider.registeredTypeIdentifiers,
        suggestedName: $0.itemProvider.suggestedName) != nil }
  }
  private func showTarget(_ visible: Bool) { targetBorder.isHidden = !visible }
  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool { accepts(session) }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
    let accepted = accepts(session)
    showTarget(accepted)
    return UIDropProposal(operation: accepted ? .copy : .forbidden)
  }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidExit session: UIDropSession) { showTarget(false) }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnd session: UIDropSession) { showTarget(false) }
  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    showTarget(false)
    guard accepts(session), let id = coordinator?.register(session.items.map(\.itemProvider)) else { return }
    onDrop(["id": id, "sessionKey": sessionKey])
  }
}
