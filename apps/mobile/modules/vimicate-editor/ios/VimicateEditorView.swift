import ExpoModulesCore
import GameController
import OSLog
import UIKit
import UniformTypeIdentifiers

private let vimicatePasteLogger = Logger(subsystem: "org.vimicate.rn.dev", category: "clipboard")

private final class VimicateKeyRepeat {
  private var initialTimer: Timer?
  private var intervalTimer: Timer?
  private var heldUsage: UIKeyboardHIDUsage?

  func start(usage: UIKeyboardHIDUsage, fire: @escaping () -> Void) {
    cancel()
    heldUsage = usage
    initialTimer = scheduledTimer(after: 0.22, repeats: false) { [weak self] in
      guard let self, self.heldUsage == usage else { return }
      fire()
      self.intervalTimer = self.scheduledTimer(after: 0.030, repeats: true) { [weak self] in
        guard let self, self.heldUsage == usage else { return }
        fire()
      }
    }
  }

  func cancel(usage: UIKeyboardHIDUsage) {
    guard heldUsage == usage else { return }
    cancel()
  }

  func cancel() {
    initialTimer?.invalidate()
    intervalTimer?.invalidate()
    initialTimer = nil
    intervalTimer = nil
    heldUsage = nil
  }

  private func scheduledTimer(after interval: TimeInterval, repeats: Bool, fire: @escaping () -> Void) -> Timer {
    let timer = Timer(timeInterval: interval, repeats: repeats) { _ in fire() }
    RunLoop.main.add(timer, forMode: .common)
    return timer
  }
}

private struct ControlledEditorState: Decodable {
  let revision: Int
  let authority: Int
  let text: String
  let mode: String
  let selectionStart: Int
  let selectionEnd: Int
  let scope: String?
}

private struct ControlledNavigationCommand: Decodable {
  let revision: Int
  let key: String
  let editorRevision: Int?
  let scope: String?
}

private final class HardwareKeyboardTextView: UITextView, UITextPasteDelegate {
  var vimMode = "insert" { didSet { updateCursor() } }
  var cursorVisible = true { didSet { updateCursor() } }
  var captureAllKeys = false
  var routePastedTextExternally = false
  var applyingControlledState = false
  var onHardwareKey: ((String, Bool, Bool, Bool, Bool, Bool, String, Int, Int) -> Void)?
  var onPasteImage: (([NSItemProvider]) -> Bool)?
  var onPasteText: ((String) -> Void)?
  var onTouchSelectionActivity: (() -> Void)?
  var onEditorTouchBegan: (() -> Void)?
  private let blockCursor = UIView()
  private let keyRepeat = VimicateKeyRepeat()
  private var lastTouchEventTimestamp: TimeInterval = -1
  private var deliveredShiftedFindUntilRelease: String?

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    pasteDelegate = self
    blockCursor.backgroundColor = UIColor(red: 0.84, green: 0.47, blue: 0.59, alpha: 0.55)
    blockCursor.isUserInteractionEnabled = false
    addSubview(blockCursor)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var keyCommands: [UIKeyCommand]? {
    let controls: [(String, UIKeyModifierFlags)] = [
      (UIKeyCommand.inputEscape, []),
      ("h", .control),
      ("j", .control),
      ("k", .control),
      ("l", .control),
      ("f", .control),
      ("b", .control),
      ("d", .control),
      ("u", .control),
      ("v", .control),
      ("e", .control),
      ("y", .control),
      ("r", .control),
      ("[", .control),
      (UIKeyCommand.inputLeftArrow, .control),
      (UIKeyCommand.inputRightArrow, .control),
      (UIKeyCommand.inputUpArrow, .control),
      (UIKeyCommand.inputDownArrow, .control),
      ("=", .command),
      ("=", [.command, .shift]),
      ("-", .command),
      ("/", .command)
    ]
    let systemPasteCommand = UIKeyCommand(
      input: "v",
      modifierFlags: .command,
      action: #selector(handlePasteKeyCommand(_:))
    )
    systemPasteCommand.wantsPriorityOverSystemBehavior = true
    let shiftedFindCommands: [(String, UIKeyModifierFlags)] = [("f", .shift), ("t", .shift)]
    return (controls + shiftedFindCommands).map { input, modifiers in
      let command = UIKeyCommand(
        input: input,
        modifierFlags: modifiers,
        action: #selector(handleHardwareKeyCommand(_:))
      )
      command.wantsPriorityOverSystemBehavior = true
      if input == "/", modifiers == .command { command.title = "Keyboard Shortcuts" }
      return command
    } + [systemPasteCommand] + (super.keyCommands ?? [])
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    guard let key = presses.first?.key else {
      super.pressesBegan(presses, with: event)
      return
    }
    let flags = key.modifierFlags
    let value = normalizedKey(key)
    let command = flags.contains(.command)
    let control = flags.contains(.control)
    let option = flags.contains(.alternate)
    let shift = flags.contains(.shift)
    let shiftedFindCommandOwnsPress = vimMode == "normal"
      && !control && !option && !command
      && ["f", "t"].contains(value)
      && (shift || semanticShiftFallback(key, normalized: value, flags: flags))
    // The UIKeyCommand normally consumes Cmd-V before raw presses arrive. Keep
    // this fallback on UIKit's responder path if iPadOS delivers the press
    // directly (for example during a transient command-discovery transition).
    if command, value == "v" {
      vimicatePasteLogger.info("hardware Cmd-V forwarded to UIKit")
      super.pressesBegan(presses, with: event)
      return
    }

    // Modifier-only UIPresses carry no semantic character. They may precede
    // the chord's real key, and forwarding an empty key would cancel an active
    // Vim operator before Shift-F/T arrives.
    guard !value.isEmpty else { return }

    if shiftedFindCommandOwnsPress {
      // UIKit may surface this chord through raw presses, UIKeyCommand, or
      // both, depending on the attached keyboard and responder transition.
      // The first path owns the press until key-up; UITextView never receives
      // a second insertion-path copy that could clear the pending Vim target.
      if deliveredShiftedFindUntilRelease != value {
        deliveredShiftedFindUntilRelease = value
        emitHardwareKey(value, shift: true, control: false, option: false, command: false, isRepeat: false)
      }
      return
    }

    prepareImmediateModeTransition(key: value, control: control)
    if captureAllKeys || vimMode == "normal" || value == "escape" || control {
      emitHardwareKey(value, shift: shift, control: control, option: option, command: command, isRepeat: false)
      if isRepeatable(value: value, control: control, option: option, command: command) {
        let usage = key.keyCode
        keyRepeat.start(usage: usage) { [weak self] in
          self?.emitHardwareKey(value, shift: shift, control: control, option: option, command: command, isRepeat: true)
        }
      }
      return
    }
    super.pressesBegan(presses, with: event)
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    presses.compactMap(\.key).forEach { keyRepeat.cancel(usage: $0.keyCode) }
    let deliveredKeyEnded = presses.compactMap(\.key).contains { normalizedKey($0) == deliveredShiftedFindUntilRelease }
    if deliveredKeyEnded {
      deliveredShiftedFindUntilRelease = nil
      return
    }
    super.pressesEnded(presses, with: event)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    keyRepeat.cancel()
    deliveredShiftedFindUntilRelease = nil
    super.pressesCancelled(presses, with: event)
  }

  override func resignFirstResponder() -> Bool {
    keyRepeat.cancel()
    deliveredShiftedFindUntilRelease = nil
    return super.resignFirstResponder()
  }

  func cancelKeyRepeat() {
    keyRepeat.cancel()
    deliveredShiftedFindUntilRelease = nil
  }

  override func paste(itemProviders: [NSItemProvider]) {
    vimicatePasteLogger.info("paste(itemProviders:) received \(itemProviders.count, privacy: .public) providers")
    if onPasteImage?(itemProviders) == true { return }
    if routePastedTextExternally, routePastedText(from: itemProviders) { return }
    super.paste(itemProviders: itemProviders)
  }

  override func paste(_ sender: Any?) {
    // `paste(_:)` is UIKit's explicit, user-authorized edit action for both
    // the edit menu and Cmd-V. UITextView automatically negotiates text, but
    // on physical iPadOS it does not forward image-only pasteboard contents to
    // `paste(itemProviders:)`. Read providers only at this standard-action
    // boundary so images can become prompt attachments without any eager
    // pasteboard inspection while menus, focus, or layout are changing.
    let providers = UIPasteboard.general.itemProviders
    vimicatePasteLogger.info("standard paste action received \(providers.count, privacy: .public) providers")
    if onPasteImage?(providers) == true { return }
    if routePastedTextExternally, routePastedText(from: providers) { return }
    super.paste(sender)
  }

  func textPasteConfigurationSupporting(
    _ textPasteConfigurationSupporting: UITextPasteConfigurationSupporting,
    transform item: UITextPasteItem
  ) {
    let providers = [item.itemProvider]
    vimicatePasteLogger.info("UITextPasteDelegate received provider types \(item.itemProvider.registeredTypeIdentifiers, privacy: .public)")
    if onPasteImage?(providers) == true {
      item.setNoResult()
      return
    }
    if routePastedTextExternally, routePastedText(from: providers) {
      item.setNoResult()
      return
    }
    item.setDefaultResult()
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    if target != nil, event?.type == .touches {
      // UITextView's private interaction descendants often own the eventual
      // touch, so the scroll view's touchesBegan override is not guaranteed.
      // Only an accepted editor hit may claim prompt ownership. UIKit also
      // probes rejected/outside/disabled views while routing other touches.
      notifyTouchInteraction(event)
    }
    return target
  }

  private func routePastedText(from itemProviders: [NSItemProvider]) -> Bool {
    let typeIdentifiers = [UTType.utf8PlainText.identifier, UTType.plainText.identifier]
    guard let match = typeIdentifiers.lazy.compactMap({ typeIdentifier in
      itemProviders.first(where: { $0.hasItemConformingToTypeIdentifier(typeIdentifier) }).map { ($0, typeIdentifier) }
    }).first else { return false }
    match.0.loadItem(forTypeIdentifier: match.1, options: nil) { [weak self] item, _ in
      let text: String?
      if let value = item as? String {
        text = value
      } else if let value = item as? NSAttributedString {
        text = value.string
      } else if let data = item as? Data {
        text = String(data: data, encoding: .utf8)
      } else if let url = item as? URL {
        text = try? String(contentsOf: url, encoding: .utf8)
      } else {
        text = nil
      }
      guard let text, !text.isEmpty else { return }
      DispatchQueue.main.async { [weak self] in self?.onPasteText?(text) }
    }
    return true
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    notifyTouchInteraction(event)
    super.touchesBegan(touches, with: event)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    onTouchSelectionActivity?()
    super.touchesMoved(touches, with: event)
  }

  private func notifyTouchInteraction(_ event: UIEvent?) {
    let timestamp = event?.timestamp ?? CACurrentMediaTime()
    guard timestamp != lastTouchEventTimestamp else { return }
    lastTouchEventTimestamp = timestamp
    onTouchSelectionActivity?()
    onEditorTouchBegan?()
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    // Building the edit menu must not inspect UIPasteboard: that eager read
    // can trigger iOS's app-level paste permission before the user chooses an
    // action. Advertise Paste here; UIKit supplies authorized item providers
    // to UITextPasteDelegate only after an explicit Paste or Cmd-V action.
    if action == #selector(UIResponderStandardEditActions.paste(_:)) { return true }
    return super.canPerformAction(action, withSender: sender)
  }

  @objc private func handlePasteKeyCommand(_ sender: UIKeyCommand) {
    vimicatePasteLogger.info("hardware Cmd-V invoked explicit paste action")
    paste(sender)
  }

  @objc private func handleHardwareKeyCommand(_ sender: UIKeyCommand) {
    guard let input = sender.input else { return }
    let value = normalizedCommandInput(input)
    let control = sender.modifierFlags.contains(.control)
    let option = sender.modifierFlags.contains(.alternate)
    let command = sender.modifierFlags.contains(.command)
    let shiftedFindCommand = !control && !option && !command && ["f", "t"].contains(value)
    let shift = sender.modifierFlags.contains(.shift) || shiftedFindCommand
    if vimMode == "insert", shift, !control, !option, !command, ["f", "t"].contains(value) {
      // UIKit can cache a responder's command list across an Insert -> Normal
      // transition. Keep the shifted commands registered continuously and
      // preserve ordinary uppercase entry explicitly while Insert owns text.
      insertText(value.uppercased())
      return
    }
    if vimMode == "normal", shiftedFindCommand {
      if deliveredShiftedFindUntilRelease == value { return }
      deliveredShiftedFindUntilRelease = value
    }
    prepareImmediateModeTransition(key: value, control: control)
    emitHardwareKey(
      value,
      shift: shift,
      control: control,
      option: option,
      command: command,
      isRepeat: false
    )
  }

  private func prepareImmediateModeTransition(key: String, control: Bool) {
    guard key == "escape" || (control && key == "[") else { return }
    // React state arrives on a later bridge turn. Switch the native routing
    // authority now so a fast Escape+Enter cannot leak Enter into UITextView
    // as a newline before the controlled Normal-mode commit returns.
    vimMode = "normal"
  }

  private func emitHardwareKey(_ key: String, shift: Bool, control: Bool, option: Bool, command: Bool, isRepeat: Bool) {
    onHardwareKey?(
      key,
      shift,
      control,
      option,
      command,
      isRepeat,
      text ?? "",
      selectedRange.location,
      selectedRange.location + selectedRange.length
    )
  }

  private func isRepeatable(value: String, control: Bool, option: Bool, command: Bool) -> Bool {
    guard !control, !option, !command else { return false }
    if ["escape", "enter", "tab"].contains(value) { return false }
    return value.count == 1 || ["backspace", "delete", "up", "down", "left", "right"].contains(value)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateCursor()
  }

  override func setContentOffset(_ contentOffset: CGPoint, animated: Bool) {
    // UIKit also requests animated scrolling while applying selectedRange.
    // A held Vim motion must not keep restarting an animation behind the
    // current cursor. Controlled mutations also own immediate placement;
    // touch scrolling and native Insert-mode requests stay native.
    super.setContentOffset(contentOffset, animated: vimMode == "normal" || applyingControlledState ? false : animated)
  }

  func updateCursor() {
    let accent = UIColor(red: 0.84, green: 0.47, blue: 0.59, alpha: 1)
    guard cursorVisible else {
      tintColor = .clear
      blockCursor.isHidden = true
      return
    }
    tintColor = vimMode == "normal" && selectedRange.length == 0 ? .clear : accent
    guard vimMode == "normal", selectedRange.length == 0, isFirstResponder, let position = selectedTextRange?.start else {
      blockCursor.isHidden = true
      return
    }
    var rect = caretRect(for: position)
    rect.size.width = max(8, (font?.pointSize ?? 14) * 0.6)
    rect.size.height = max(rect.height, font?.lineHeight ?? rect.height)
    blockCursor.frame = rect.integral
    blockCursor.isHidden = false
  }

  private func normalizedKey(_ key: UIKey) -> String {
    let usage = Int(key.keyCode.rawValue)
    let letterA = Int(UIKeyboardHIDUsage.keyboardA.rawValue)
    let letterZ = Int(UIKeyboardHIDUsage.keyboardZ.rawValue)
    if (letterA...letterZ).contains(usage), let scalar = UnicodeScalar(97 + usage - letterA) {
      return String(Character(scalar))
    }
    switch key.keyCode {
    case .keyboardEscape: return "escape"
    case .keyboardReturnOrEnter, .keypadEnter: return "enter"
    case .keyboardDeleteOrBackspace: return "backspace"
    case .keyboardDeleteForward: return "delete"
    case .keyboardTab: return "tab"
    case .keyboardUpArrow: return "up"
    case .keyboardDownArrow: return "down"
    case .keyboardLeftArrow: return "left"
    case .keyboardRightArrow: return "right"
    default: return key.charactersIgnoringModifiers
    }
  }

  private func semanticShiftFallback(_ key: UIKey, normalized: String, flags: UIKeyModifierFlags) -> Bool {
    guard flags.intersection([.control, .command, .alternate]).isEmpty,
          normalized.count == 1,
          key.characters.count == 1
    else { return false }
    return key.characters != normalized
  }

  private func normalizedCommandInput(_ input: String) -> String {
    switch input {
    case UIKeyCommand.inputEscape: return "escape"
    case "\r", "\n": return "enter"
    case UIKeyCommand.inputUpArrow: return "up"
    case UIKeyCommand.inputDownArrow: return "down"
    case UIKeyCommand.inputLeftArrow: return "left"
    case UIKeyCommand.inputRightArrow: return "right"
    default: return input.lowercased()
    }
  }
}

final class VimicateEditorView: ExpoView, UITextViewDelegate {
  let onTextChange = EventDispatcher()
  let onSelectionChange = EventDispatcher()
  let onHardwareKey = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onEditorTap = EventDispatcher()
  let onHardwareKeyboardChange = EventDispatcher()
  let onPastedAttachment = EventDispatcher()
  let onPastedText = EventDispatcher()

  private let editor = HardwareKeyboardTextView()
  private let hardwareCaptureInputView = UIView(frame: .zero)
  private var applyingProps = false
  private var appliedStateRevision = -1
  private var appliedEditorScope = ""
  private var appliedTextAuthority = 0
  private var appliedNavigationCommandRevision = 0
  private var requestedFocus = false
  private lazy var previewFocusRecovery = VimicatePreviewFocusRecovery(owner: editor) { [weak self] in self?.requestedFocus == true }
  private var softwareKeyboardEnabled = false
  private var softwareKeyboardForced = false
  private let acceptanceForcesSoftwareKeyboard = ProcessInfo.processInfo.arguments.contains(
    "--vimicate-acceptance-software-keyboard"
  )
  private var lastReportedHardwareKeyboardConnected: Bool?
  private var repeatAuthority = ""
  private var recentlyEmittedTexts: [String] = []
  private var touchSelectionDeadline = 0.0
  private var caretRevealScheduled = false
  private var pendingCaretReveal: NSRange?
  private var pendingImmediateCaretReveal = false
  private var controlledSelection = NSRange(location: 0, length: 0)
  private var focusObservers: [NSObjectProtocol] = []
  private var observedTextInteractionRecognizers = Set<ObjectIdentifier>()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    editor.delegate = self
    // The enclosing prompt surface owns file drops; UITextView must not insert
    // URLs or attributed image content into the controlled plain-text draft.
    if let interaction = editor.textDropInteraction { editor.removeInteraction(interaction) }
    editor.backgroundColor = .clear
    editor.textColor = UIColor(red: 0.92, green: 0.86, blue: 0.70, alpha: 1)
    editor.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
    editor.autocorrectionType = .no
    editor.autocapitalizationType = .none
    editor.smartDashesType = .no
    editor.smartQuotesType = .no
    editor.spellCheckingType = .no
    if #available(iOS 18.0, *) { editor.writingToolsBehavior = .none }
    editor.inputAssistantItem.leadingBarButtonGroups = []
    editor.inputAssistantItem.trailingBarButtonGroups = []
    editor.keyboardDismissMode = .none
    editor.isScrollEnabled = true
    editor.alwaysBounceHorizontal = false
    editor.showsHorizontalScrollIndicator = false
    editor.textContainer.widthTracksTextView = true
    editor.textContainer.lineBreakMode = .byWordWrapping
    editor.pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [
      UTType.plainText.identifier,
      UTType.utf8PlainText.identifier,
      UTType.rtf.identifier,
      UTType.png.identifier,
      UTType.jpeg.identifier,
      UTType.heic.identifier,
      UTType.image.identifier
    ])
    // Keep the hardware-key responder alive without covering the workspace.
    editor.inputView = hardwareCaptureInputView
    editor.textContainerInset = UIEdgeInsets(top: 5, left: 9, bottom: 5, right: 9)
    editor.onHardwareKey = { [weak self] key, shift, control, option, command, isRepeat, text, selectionStart, selectionEnd in
      self?.onHardwareKey([
        "key": key,
        "shift": shift,
        "control": control,
        "option": option,
        "command": command,
        "isRepeat": isRepeat,
        "text": text,
        "selectionStart": selectionStart,
        "selectionEnd": selectionEnd,
        "textAuthority": self?.appliedTextAuthority ?? -1
      ])
    }
    editor.onPasteImage = { [weak self] providers in self?.stagePastedImage(from: providers) ?? false }
    editor.onPasteText = { [weak self] text in self?.onPastedText(["text": text]) }
    editor.onTouchSelectionActivity = { [weak self] in self?.touchSelectionDeadline = CACurrentMediaTime() + 0.8 }
    editor.onEditorTouchBegan = { [weak self] in
      guard let self else { return }
      // Enter native Insert routing immediately, before the bridge turn, but
      // leave selection placement to UITextView. The final touched word/caret
      // is republished by textViewDidChangeSelection below.
      self.editor.vimMode = "insert"
      self.handleEditorInteraction(selection: self.editor.selectedRange)
    }
    addSubview(editor)
    installTextInteractionObservers()

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
      NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.suspendKeyboardOwnership() },
      NotificationCenter.default.addObserver(
        forName: UIApplication.willResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.suspendKeyboardOwnership() },
      NotificationCenter.default.addObserver(
        forName: UIWindow.didResignKeyNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let self,
              let resignedWindow = notification.object as? UIWindow,
              resignedWindow === self.window
        else { return }
        self.suspendKeyboardOwnership()
      },
      NotificationCenter.default.addObserver(
        forName: .GCKeyboardDidConnect,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.reconcileSoftwareKeyboard() },
      NotificationCenter.default.addObserver(
        forName: .GCKeyboardDidDisconnect,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.reconcileSoftwareKeyboard() }
    ]
  }

  deinit { focusObservers.forEach { NotificationCenter.default.removeObserver($0) } }

  private func handleEditorInteraction(selection: NSRange) {
    // The prompt editor intentionally retains a stable focus request while
    // hardware keys are routed across panes. UIKit can still drop first
    // responder during a project switch, suspension, or test-runner handoff.
    // Because the React `focused` prop remains true, that recovery cannot rely
    // on another prop transition: an explicit prompt tap must reconcile the
    // native responder immediately and once more after the React focus commit.
    requestedFocus = true
    reconcileFocus()
    onEditorTap([
      "selectionStart": selection.location,
      "selectionEnd": selection.location + selection.length
    ])
    DispatchQueue.main.async { [weak self] in self?.reconcileFocus() }
  }

  private func installTextInteractionObservers() {
    // Do not add another recognizer. UITextView installs selection gestures
    // on private descendant interaction views as well as on the scroll view
    // itself. Observe those existing recognizers recursively so the native
    // single/double/triple-tap graph and selection handles remain the only
    // gesture authority.
    var pendingViews: [UIView] = [editor]
    while let view = pendingViews.popLast() {
      pendingViews.append(contentsOf: view.subviews)
      for recognizer in view.gestureRecognizers ?? [] {
        guard recognizer is UITapGestureRecognizer || recognizer is UILongPressGestureRecognizer else { continue }
        let identity = ObjectIdentifier(recognizer)
        guard observedTextInteractionRecognizers.insert(identity).inserted else { continue }
        recognizer.addTarget(self, action: #selector(observeNativeTextInteraction(_:)))
      }
    }
  }

  @objc private func observeNativeTextInteraction(_ recognizer: UIGestureRecognizer) {
    let acceptedState = recognizer is UITapGestureRecognizer
      ? recognizer.state == .ended
      : recognizer.state == .began || recognizer.state == .changed || recognizer.state == .ended
    guard acceptedState else { return }
    touchSelectionDeadline = CACurrentMediaTime() + 0.8
    editor.vimMode = "insert"
    handleEditorInteraction(selection: editor.selectedRange)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.handleEditorInteraction(selection: self.editor.selectedRange)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    editor.frame = bounds
    installTextInteractionObservers()
    reconcileFocus()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { previewFocusRecovery.stop() }
    installTextInteractionObservers()
    reconcileSoftwareKeyboard()
    reconcileFocus()
  }

  func setEditorState(_ encoded: String) {
    guard let data = encoded.data(using: .utf8),
          let state = try? JSONDecoder().decode(ControlledEditorState.self, from: data)
    else { return }

    // Expo prop delivery is asynchronous. A held h/l burst may calculate the
    // right monotonic cursor states in JS but still deliver an older snapshot
    // after a newer one. Never let that late snapshot move the native caret
    // backwards. Equal revisions remain idempotently applicable so native
    // selection drift can still be reconciled.
    guard state.revision >= appliedStateRevision else { return }
    appliedStateRevision = state.revision
    let scopeChanged = appliedEditorScope != (state.scope ?? "")
    if scopeChanged { touchSelectionDeadline = 0 }
    appliedEditorScope = state.scope ?? ""

    let forceText = state.authority != appliedTextAuthority
    if forceText { appliedTextAuthority = state.authority }
    if !forceText, !scopeChanged,
       editor.vimMode == "insert",
       state.mode == "insert",
       !editor.text.utf16.elementsEqual(state.text.utf16),
       (recentlyEmittedTexts.contains(where: { $0.utf16.elementsEqual(state.text.utf16) }) || editor.text.utf16.starts(with: state.text.utf16))
    {
      return
    }

    let length = (state.text as NSString).length
    let lower = max(0, min(state.selectionStart, length))
    let upper = max(lower, min(state.selectionEnd, length))
    let range = NSRange(location: lower, length: upper - lower)
    controlledSelection = range
    let modeChanged = editor.vimMode != state.mode
    let textChanged = !editor.text.utf16.elementsEqual(state.text.utf16)

    // Text, mode, and cursor form one controlled commit. Applying them in
    // separate Expo props let UITextView's text assignment move a freshly
    // changed `cw` caret to end-of-buffer when prop delivery was reordered.
    applyingProps = true
    editor.applyingControlledState = true
    if textChanged {
      if editor.text.isEmpty { editor.text = state.text }
      else { replaceControlledText(state.text) }
    }
    // UIKit typing undo stores ranges in the old document. JS owns controlled
    // edits/history, so those ranges must never survive a replacement or scope
    // handoff (including equal-text threads). Ordinary native echoes keep undo.
    if textChanged || scopeChanged || forceText { editor.undoManager?.removeAllActions() }
    editor.vimMode = state.mode
    let nativeTouchOwnsSelection = CACurrentMediaTime() <= touchSelectionDeadline && state.mode == "insert"
    if !nativeTouchOwnsSelection, editor.selectedRange != range { editor.selectedRange = range }
    applyingProps = false
    editor.applyingControlledState = false
    if modeChanged { editor.cancelKeyRepeat() }
    editor.updateCursor()
    if editor.cursorVisible { scheduleCaretReveal(range, immediately: textChanged) }
  }
  private func replaceControlledText(_ text: String) {
    let previous = editor.text ?? ""
    var start = previous.startIndex
    var nextStart = text.startIndex
    while start < previous.endIndex, nextStart < text.endIndex,
          previous[start].unicodeScalars.elementsEqual(text[nextStart].unicodeScalars) {
      previous.formIndex(after: &start)
      text.formIndex(after: &nextStart)
    }
    var end = previous.endIndex
    var nextEnd = text.endIndex
    while end > start, nextEnd > nextStart {
      let prior = previous.index(before: end)
      let nextPrior = text.index(before: nextEnd)
      guard previous[prior].unicodeScalars.elementsEqual(text[nextPrior].unicodeScalars) else { break }
      end = prior
      nextEnd = nextPrior
    }
    // A UITextView.text assignment rebuilds the document and transiently
    // reveals its end before the controlled caret returns. Apply only the
    // changed graphemes so TextKit retains layout and the reader's viewport.
    editor.textStorage.replaceCharacters(in: NSRange(start..<end, in: previous), with: String(text[nextStart..<nextEnd]))
  }
  func setCaptureAllKeys(_ capture: Bool) {
    if editor.captureAllKeys != capture { editor.cancelKeyRepeat() }
    editor.captureAllKeys = capture
  }
  func setSoftwareKeyboardEnabled(_ enabled: Bool) {
    softwareKeyboardEnabled = enabled
    reconcileSoftwareKeyboard()
  }
  func setSoftwareKeyboardForced(_ forced: Bool) {
    softwareKeyboardForced = forced
    reconcileSoftwareKeyboard()
  }
  func setRoutePastedTextExternally(_ enabled: Bool) {
    editor.routePastedTextExternally = enabled
  }
  func setCursorVisible(_ visible: Bool) {
    editor.cursorVisible = visible
    applyingProps = true
    if visible {
      if editor.selectedRange != controlledSelection { editor.selectedRange = controlledSelection }
    } else if editor.selectedRange.length > 0 {
      // Keep the Vim selection in the controlled model while removing UIKit's
      // highlight and handles from an unfocused prompt. The responder remains
      // alive for workspace hardware-key capture without showing a ghost
      // selection in the inactive pane.
      editor.selectedRange = NSRange(location: controlledSelection.location, length: 0)
    }
    applyingProps = false
    editor.updateCursor()
    if visible { scheduleCaretReveal(NSRange(location: controlledSelection.location, length: 0)) }
  }
  func setRepeatAuthority(_ authority: String) {
    guard authority != repeatAuthority else { return }
    repeatAuthority = authority
    editor.cancelKeyRepeat()
  }
  func performNavigationCommand(_ encoded: String) {
    guard let data = encoded.data(using: .utf8),
          let command = try? JSONDecoder().decode(ControlledNavigationCommand.self, from: data),
          command.revision > appliedNavigationCommandRevision
    else { return }
    let halfPage = command.key == "halfPageUp" || command.key == "halfPageDown"
    if halfPage {
      guard command.editorRevision == appliedStateRevision,
            command.scope == appliedEditorScope,
            !editor.captureAllKeys, editor.cursorVisible, editor.vimMode == "normal" else { return }
    }
    appliedNavigationCommandRevision = command.revision

    // Toolbar arrows are explicit text-navigation controls, not synthetic
    // hardware events. Let UITextView perform the same wrapped-line-aware
    // movement as iOS and then publish its resulting selection as deliberate
    // user input so React cannot restore the previous controlled caret.
    let direction: UITextLayoutDirection
    let collapseTowardStart: Bool
    switch command.key {
    case "left": direction = .left; collapseTowardStart = true
    case "right": direction = .right; collapseTowardStart = false
    case "up": direction = .up; collapseTowardStart = true
    case "down": direction = .down; collapseTowardStart = false
    case "halfPageUp": direction = .up; collapseTowardStart = true
    case "halfPageDown": direction = .down; collapseTowardStart = false
    default: return
    }
    requestedFocus = true
    reconcileFocus()
    if halfPage {
      moveHalfPage(down: command.key == "halfPageDown")
    } else if let selection = editor.selectedTextRange {
      let destination: UITextPosition?
      if selection.isEmpty {
        destination = editor.position(from: selection.end, in: direction, offset: 1)
      } else {
        // A native arrow first collapses an active selection toward the arrow
        // edge. A subsequent press advances one text position from there.
        destination = collapseTowardStart ? selection.start : selection.end
      }
      if let destination,
         let collapsed = editor.textRange(from: normalCursorPosition(destination), to: normalCursorPosition(destination)) {
        editor.selectedTextRange = collapsed
      }
    }
    controlledSelection = editor.selectedRange
    editor.updateCursor()
    var selectionEvent: [String: Any] = [
      "selectionStart": editor.selectedRange.location,
      "selectionEnd": editor.selectedRange.location + editor.selectedRange.length,
      "userInitiated": true
    ]
    if halfPage {
      selectionEvent["editorRevision"] = appliedStateRevision
      selectionEvent["scope"] = appliedEditorScope
    }
    onSelectionChange(selectionEvent)
    if editor.cursorVisible { scheduleCaretReveal(editor.selectedRange) }
  }
  private func normalCursorPosition(_ position: UITextPosition) -> UITextPosition {
    guard editor.vimMode == "normal" else { return position }
    let text = (editor.text ?? "") as NSString
    let location = editor.offset(from: editor.beginningOfDocument, to: position)
    guard location > 0, location <= text.length,
          location == text.length || [10, 13].contains(Int(text.character(at: location))),
          ![10, 13].contains(Int(text.character(at: location - 1))) else { return position }
    // A Vim block cursor belongs to the last grapheme, not the insertion slot
    // after it. NSString's composed range preserves emoji and combining marks.
    let previous = text.rangeOfComposedCharacterSequence(at: location - 1).location
    return editor.position(from: editor.beginningOfDocument, offset: previous) ?? position
  }
  private func moveHalfPage(down: Bool) {
    editor.layoutIfNeeded()
    guard let selection = editor.selectedTextRange else { return }
    let origin = editor.caretRect(for: selection.start)
    let visibleHeight = max(1, editor.bounds.height - editor.adjustedContentInset.top - editor.adjustedContentInset.bottom)
    let distance = visibleHeight / 2 * (down ? 1 : -1)
    guard let candidate = editor.closestPosition(to: CGPoint(x: origin.minX, y: origin.midY + distance)) else { return }
    let destination = normalCursorPosition(candidate)
    guard let collapsed = editor.textRange(from: destination, to: destination) else { return }
    let offset = editor.contentOffset
    editor.selectedTextRange = collapsed
    let target = editor.caretRect(for: destination)
    let minY = -editor.adjustedContentInset.top
    let maxY = max(minY, editor.contentSize.height - editor.bounds.height + editor.adjustedContentInset.bottom)
    editor.setContentOffset(CGPoint(x: offset.x, y: max(minY, min(maxY, offset.y + target.minY - origin.minY))), animated: false)
  }
  func setFontSize(_ fontSize: Double) {
    let bounded = max(10, min(24, fontSize))
    editor.font = UIFont.monospacedSystemFont(ofSize: bounded, weight: .regular)
    editor.updateCursor()
  }
  func setFocused(_ focused: Bool) {
    requestedFocus = focused
    if !focused { previewFocusRecovery.stop() }
    if focused { reconcileFocus() }
    if !focused && editor.isFirstResponder { _ = editor.resignFirstResponder() }
  }


  private func reconcileFocus() {
    guard requestedFocus,
          UIApplication.shared.applicationState == .active,
          let window,
          window.isKeyWindow,
          !editor.isFirstResponder
    else { return }
    if !editor.becomeFirstResponder() {
      DispatchQueue.main.async { [weak self] in
        guard let self,
              self.requestedFocus,
              UIApplication.shared.applicationState == .active,
              self.window?.isKeyWindow == true,
              !self.editor.isFirstResponder
        else { return }
        _ = self.editor.becomeFirstResponder()
      }
    }
  }

  private func reconcileSoftwareKeyboard() {
    let hardwareKeyboardConnected = GCKeyboard.coalesced != nil
    if lastReportedHardwareKeyboardConnected != hardwareKeyboardConnected {
      lastReportedHardwareKeyboardConnected = hardwareKeyboardConnected
      onHardwareKeyboardChange(["connected": hardwareKeyboardConnected])
    }
    let shouldShowSoftwareKeyboard = acceptanceForcesSoftwareKeyboard
      || (softwareKeyboardEnabled && (softwareKeyboardForced || !hardwareKeyboardConnected))
    let softwareKeyboardIsShown = editor.inputView == nil
    guard shouldShowSoftwareKeyboard != softwareKeyboardIsShown else { return }
    editor.inputView = shouldShowSoftwareKeyboard ? nil : hardwareCaptureInputView
    if editor.isFirstResponder { editor.reloadInputViews() }
  }

  private func suspendKeyboardOwnership() {
    editor.cancelKeyRepeat()
    if editor.isFirstResponder { _ = editor.resignFirstResponder() }
    previewFocusRecovery.stop()
  }

  private func scheduleCaretReveal(_ range: NSRange, immediately: Bool = false) {
    pendingCaretReveal = NSRange(location: range.location, length: 0)
    pendingImmediateCaretReveal = pendingImmediateCaretReveal || immediately
    guard !caretRevealScheduled else { return }
    caretRevealScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.caretRevealScheduled = false
      guard self.editor.cursorVisible, let pending = self.pendingCaretReveal else { return }
      self.pendingCaretReveal = nil
      let immediate = self.pendingImmediateCaretReveal
      self.pendingImmediateCaretReveal = false
      self.editor.applyingControlledState = immediate
      defer { self.editor.applyingControlledState = false }
      self.editor.layoutIfNeeded()
      if self.editor.vimMode == "normal" || immediate,
         let layout = self.editor.textLayoutManager,
         let content = layout.textContentManager,
         let location = content.location(content.documentRange.location, offsetBy: pending.location) {
        layout.ensureLayout(for: NSTextRange(location: location))
      }
      if self.editor.vimMode == "normal" || immediate,
         let position = self.editor.position(from: self.editor.beginningOfDocument, offset: pending.location) {
        // Resolve the caret after selection layout, including large jumps in
        // long wrapped drafts. scrollRangeToVisible can animate toward an
        // earlier TextKit estimate and leave the new cursor offscreen.
        let caret = self.editor.caretRect(for: position)
        self.editor.scrollRectToVisible(caret.insetBy(dx: 0, dy: -5), animated: false)
        // Scrolling into a previously unlaid-out long-draft viewport can
        // refine TextKit's estimated line positions. Resolve that viewport
        // and its caret before this frame, not through a later animation.
        self.editor.textLayoutManager?.textViewportLayoutController.layoutViewport()
        let laidOutCaret = self.editor.caretRect(for: position)
        self.editor.scrollRectToVisible(laidOutCaret.insetBy(dx: 0, dy: -5), animated: false)
      } else {
        self.editor.scrollRangeToVisible(pending)
      }
    }
  }

  private typealias PastedImageRepresentation = (provider: NSItemProvider, typeIdentifier: String, mimeType: String, fileExtension: String)

  private func stagePastedImage(from providers: [NSItemProvider]) -> Bool {
    vimicatePasteLogger.info("stagePastedImage evaluating \(providers.count, privacy: .public) providers")
    let candidates: [(UTType, String, String)] = [
      (.png, "image/png", "png"),
      (.jpeg, "image/jpeg", "jpg"),
      (.heic, "image/heic", "heic")
    ]
    let representations = providers.flatMap { provider in
      candidates.compactMap { type, mimeType, fileExtension in
        provider.hasItemConformingToTypeIdentifier(type.identifier)
          ? PastedImageRepresentation(provider, type.identifier, mimeType, fileExtension)
          : nil
      }
    }
    if !representations.isEmpty {
      loadPastedImageRepresentation(representations, index: 0, fallbackProviders: providers)
      return true
    }
    guard let provider = providers.first(where: { $0.canLoadObject(ofClass: UIImage.self) }) else { return false }
    loadPastedImageObject(from: provider)
    return true
  }

  private func loadPastedImageRepresentation(_ representations: [PastedImageRepresentation], index: Int, fallbackProviders: [NSItemProvider]) {
    guard representations.indices.contains(index) else {
      if let provider = fallbackProviders.first(where: { $0.canLoadObject(ofClass: UIImage.self) }) {
        loadPastedImageObject(from: provider)
      } else {
        DispatchQueue.main.async { [weak self] in self?.onPastedAttachment(["error": "Pasted image could not be read."]) }
      }
      return
    }
    let representation = representations[index]
    representation.provider.loadDataRepresentation(forTypeIdentifier: representation.typeIdentifier) { [weak self] data, _ in
      guard let self else { return }
      guard let data, !data.isEmpty else {
        self.loadPastedImageRepresentation(representations, index: index + 1, fallbackProviders: fallbackProviders)
        return
      }
      DispatchQueue.main.async { [weak self] in
        self?.finishPastedImage(data: data, mimeType: representation.mimeType, fileExtension: representation.fileExtension)
      }
    }
  }

  private func loadPastedImageObject(from provider: NSItemProvider) {
    provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
      guard let image = object as? UIImage, let data = image.pngData(), !data.isEmpty else {
        DispatchQueue.main.async { [weak self] in self?.onPastedAttachment(["error": "Pasted image could not be read."]) }
        return
      }
      DispatchQueue.main.async { [weak self] in self?.finishPastedImage(data: data, mimeType: "image/png", fileExtension: "png") }
    }
  }

  private func finishPastedImage(data originalData: Data, mimeType originalMimeType: String, fileExtension originalFileExtension: String) {
    let data = originalData
    let mimeType = originalMimeType
    let fileExtension = originalFileExtension
    guard data.count <= PromptImageUploadCopy.totalBytes else {
      onPastedAttachment(["error": "Pasted image exceeds the 18 MB total attachment budget."])
      return
    }

    do {
      let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("VimicateClipboard", isDirectory: true)
      try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
      let timestamp = Int(Date().timeIntervalSince1970)
      let filename = "pasted-screenshot-\(timestamp).\(fileExtension)"
      let url = base.appendingPathComponent("\(UUID().uuidString)-\(filename)")
      try data.write(to: url, options: .atomic)
      onPastedAttachment([
        "uri": url.absoluteString,
        "filename": filename,
        "mimeType": mimeType,
        "byteCount": data.count
      ])
    } catch {
      onPastedAttachment(["error": "Pasted image could not be staged."])
    }
  }

  func textViewDidChange(_ textView: UITextView) {
    guard !applyingProps else { return }
    recentlyEmittedTexts.append(textView.text ?? "")
    if recentlyEmittedTexts.count > 512 { recentlyEmittedTexts.removeFirst(recentlyEmittedTexts.count - 512) }
    onTextChange([
      "text": textView.text ?? "",
      "selectionStart": textView.selectedRange.location,
      "selectionEnd": textView.selectedRange.location + textView.selectedRange.length,
      "textAuthority": appliedTextAuthority
    ])
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    editor.updateCursor()
    guard !applyingProps else { return }
    let userInitiated = CACurrentMediaTime() <= touchSelectionDeadline
    if userInitiated { controlledSelection = textView.selectedRange }
    onSelectionChange([
      "selectionStart": textView.selectedRange.location,
      "selectionEnd": textView.selectedRange.location + textView.selectedRange.length,
      "userInitiated": userInitiated
    ])
    // A native word selection or handle drag can complete after the wrapper's
    // observation tap. Republish the final range with the focus/mode event so
    // the controlled React commit cannot collapse it back to an older caret.
    if userInitiated { handleEditorInteraction(selection: textView.selectedRange) }
  }

  func textViewDidBeginEditing(_ textView: UITextView) { previewFocusRecovery.stop(); onFocusChange(["focused": true]) }
  func textViewDidEndEditing(_ textView: UITextView) {
    onFocusChange(["focused": false])
    previewFocusRecovery.responderDidResign()
  }

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    editor.vimMode != "normal" && !editor.captureAllKeys
  }
}
