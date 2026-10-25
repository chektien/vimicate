import ExpoModulesCore
import GameController
import UIKit

private func isCommandLineCancel(_ key: UIKey) -> Bool {
  key.keyCode == .keyboardEscape
    || (key.modifierFlags.contains(.control) && key.charactersIgnoringModifiers == "[")
}

private final class VimicateCommandTextField: UITextField {
  var onCancel = {}
  var onComplete: (Bool) -> Void = { _ in }
  var onClear = {}
  var historyEnabled = false
  var onHistory: (Int) -> Void = { _ in }

  override var keyCommands: [UIKeyCommand]? {
    let commands = [
      keyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(cancelCommandLine)),
      keyCommand(input: "[", modifierFlags: .control, action: #selector(cancelCommandLine)),
      keyCommand(input: "\t", modifierFlags: [], action: #selector(completeForward)),
      keyCommand(input: "\t", modifierFlags: .shift, action: #selector(completeBackward)),
      keyCommand(input: "u", modifierFlags: .control, action: #selector(clearCommandLine))
    ]
    let historyCommands = historyEnabled ? [
      keyCommand(input: UIKeyCommand.inputUpArrow, modifierFlags: [], action: #selector(previousCommand)),
      keyCommand(input: UIKeyCommand.inputDownArrow, modifierFlags: [], action: #selector(nextCommand))
    ] : []
    return historyCommands + commands + (super.keyCommands ?? [])
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard let key = presses.first?.key else {
      super.pressesBegan(presses, with: event)
      return
    }
    if isCommandLineCancel(key) {
      onCancel()
      return
    }
    super.pressesBegan(presses, with: event)
  }

  override func insertText(_ text: String) {
    // XCTest and some hardware/IME routes deliver Escape/Ctrl-[ through the
    // UITextInput insertion boundary as the ASCII ESC scalar instead of a
    // UIKeyCommand or UIPressesEvent. Keep that scalar out of the controlled
    // query and give it the same single-cancel meaning.
    if text.unicodeScalars.count == 1, text.unicodeScalars.first?.value == 0x1B {
      onCancel()
      return
    }
    super.insertText(text)
  }

  private func keyCommand(input: String, modifierFlags: UIKeyModifierFlags, action: Selector) -> UIKeyCommand {
    let command = UIKeyCommand(input: input, modifierFlags: modifierFlags, action: action)
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  @objc private func cancelCommandLine() { onCancel() }
  @objc private func completeForward() { onComplete(false) }
  @objc private func completeBackward() { onComplete(true) }
  @objc private func previousCommand() { onHistory(-1) }
  @objc private func nextCommand() { onHistory(1) }
  @objc private func clearCommandLine() { onClear() }
}

final class VimicateCommandInputView: ExpoView, UITextFieldDelegate {
  let onQueryChange = EventDispatcher()
  let onSubmit = EventDispatcher()
  let onCancel = EventDispatcher()
  let onComplete = EventDispatcher()
  let onHistory = EventDispatcher()

  private let input = VimicateCommandTextField()
  private let hardwareCaptureInputView = UIView(frame: .zero)
  private var requestedActive = false
  private var softwareKeyboardEnabled = false
  private var applyingValue = false
  private let textAuthority = CommandInputTextAuthority()
  private var usesAcknowledgedValues = false
  private var focusObservers: [NSObjectProtocol] = []
  private var cancellationPublished = false
  private let acceptanceForcesSoftwareKeyboard = ProcessInfo.processInfo.arguments.contains(
    "--vimicate-acceptance-software-keyboard"
  )

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    input.delegate = self
    input.backgroundColor = .clear
    input.borderStyle = .none
    input.textColor = UIColor(red: 0.98, green: 0.94, blue: 0.78, alpha: 1)
    input.tintColor = UIColor(red: 0.84, green: 0.47, blue: 0.59, alpha: 1)
    input.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    input.autocorrectionType = .no
    input.autocapitalizationType = .none
    input.smartDashesType = .no
    input.smartQuotesType = .no
    input.spellCheckingType = .no
    input.returnKeyType = .go
    input.clearButtonMode = .never
    // The command line owns its compact in-app chrome. Leaving UIKit's input
    // assistant enabled while a hardware keyboard is present produces an
    // otherwise empty, full-width rounded bar below the command line.
    input.inputAssistantItem.leadingBarButtonGroups = []
    input.inputAssistantItem.trailingBarButtonGroups = []
    input.inputAssistantItem.allowsHidingShortcuts = true
    input.inputView = hardwareCaptureInputView
    input.addTarget(self, action: #selector(textDidChange), for: .editingChanged)
    input.onCancel = { [weak self] in self?.publishCancel() }
    input.onComplete = { [weak self] reverse in self?.onComplete(["reverse": reverse]) }
    input.onHistory = { [weak self] direction in self?.onHistory(["direction": direction]) }
    input.onClear = { [weak self] in
      guard let self else { return }
      self.input.text = ""
      self.publishText()
    }
    addSubview(input)

    focusObservers = [
      NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.reconcileFocus() },
      NotificationCenter.default.addObserver(
        forName: UIWindow.didBecomeKeyNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.reconcileFocus() },
    ]
  }

  deinit { focusObservers.forEach { NotificationCenter.default.removeObserver($0) } }

  override func layoutSubviews() {
    super.layoutSubviews()
    input.frame = bounds
    reconcileFocus()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reconcileFocus()
  }

  func setHistoryEnabled(_ enabled: Bool) { input.historyEnabled = enabled }

  func setValue(_ value: String) {
    // Older compatible bundles still use the legacy value property. Once the
    // atomic property is supplied, only that acknowledged path may write text.
    guard !usesAcknowledgedValues else { return }
    applyValue(value)
  }

  func setValueState(_ state: CommandInputValueState) {
    usesAcknowledgedValues = true
    guard textAuthority.acceptsControlledWrite(acknowledging: state.eventCount) else { return }
    applyValue(state.text)
  }

  private func applyValue(_ value: String) {
    guard input.text != value else { return }
    applyingValue = true
    input.text = value
    applyingValue = false
    let end = input.endOfDocument
    input.selectedTextRange = input.textRange(from: end, to: end)
  }

  func setActive(_ active: Bool) {
    requestedActive = active
    if active {
      cancellationPublished = false
      reconcileSoftwareKeyboard()
      reconcileFocus()
      DispatchQueue.main.async { [weak self] in self?.reconcileFocus() }
    } else {
      if input.isFirstResponder { _ = input.resignFirstResponder() }
    }
  }

  func setSoftwareKeyboardEnabled(_ enabled: Bool) {
    softwareKeyboardEnabled = enabled
    reconcileSoftwareKeyboard()
  }

  func setInputAccessibilityLabel(_ label: String) {
    input.accessibilityLabel = label
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    onSubmit([:])
    return false
  }

  @objc private func textDidChange() {
    guard !applyingValue else { return }
    publishText()
  }

  private func publishText() {
    onQueryChange(["text": input.text ?? "", "eventCount": textAuthority.recordNativeEdit()])
  }

  private func reconcileFocus() {
    guard requestedActive,
          UIApplication.shared.applicationState == .active,
          let window,
          window.isKeyWindow
    else { return }
    guard !input.isFirstResponder else { return }
    if !input.becomeFirstResponder() {
      DispatchQueue.main.async { [weak self] in
        guard let self,
              self.requestedActive,
              UIApplication.shared.applicationState == .active,
              self.window?.isKeyWindow == true,
              !self.input.isFirstResponder
        else { return }
        _ = self.input.becomeFirstResponder()
      }
    }
  }

  private func reconcileSoftwareKeyboard() {
    let shouldShow = acceptanceForcesSoftwareKeyboard
      || (softwareKeyboardEnabled && GCKeyboard.coalesced == nil)
    let isShown = input.inputView == nil
    guard shouldShow != isShown else { return }
    input.inputView = shouldShow ? nil : hardwareCaptureInputView
    if input.isFirstResponder { input.reloadInputViews() }
  }

  private func publishCancel() {
    // Every mounted command/search line owns the native responder. Hardware-
    // opened lines suppress software input with `hardwareCaptureInputView`,
    // while touch-opened lines use UIKit's ordinary input view. Keeping one
    // responder prevents Escape from being split between two native editors.
    guard !cancellationPublished else { return }
    cancellationPublished = true
    onCancel([:])
  }
}
