import ExpoModulesCore
import UIKit

public class VimicateEditorModule: Module {
  private let drops = PromptDropCoordinator()

  public func definition() -> ModuleDefinition {
    Name("VimicateEditor")
    Constant("supportsPromptDrop") { true }
    AsyncFunction("readDrop") { (id: String, promise: Promise) in
      self.drops.read(id) { result in
        switch result {
        case .success(let files): promise.resolve(files)
        case .failure(let error): promise.reject("E_PROMPT_DROP", error.localizedDescription)
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("discardDrop") { (id: String) in self.drops.discard(id) }.runOnQueue(.main)
    AsyncFunction("releaseDroppedFile") { (uri: String) in self.drops.release(uri) }.runOnQueue(.main)
    OnDestroy { [drops] in DispatchQueue.main.async { drops.invalidate() } }

    AsyncFunction("prepareImageUploadCopy") { (base64: String) in
      try PromptImageUploadCopy.prepare(base64)
    }.runOnQueue(DispatchQueue(label: "vimicate.image-upload"))

    Function("setClipboardText") { (text: String) in
      if Thread.isMainThread {
        UIPasteboard.general.string = text
      } else {
        DispatchQueue.main.sync { UIPasteboard.general.string = text }
      }
    }

    View(VimicateEditorView.self) {
      Events("onTextChange", "onSelectionChange", "onHardwareKey", "onFocusChange", "onEditorTap", "onHardwareKeyboardChange", "onPastedAttachment", "onPastedText")
      Prop("editorState") { (view: VimicateEditorView, state: String) in view.setEditorState(state) }
      Prop("focused") { (view: VimicateEditorView, focused: Bool) in view.setFocused(focused) }
      Prop("cursorVisible") { (view: VimicateEditorView, visible: Bool) in view.setCursorVisible(visible) }
      Prop("captureAllKeys") { (view: VimicateEditorView, capture: Bool) in view.setCaptureAllKeys(capture) }
      Prop("softwareKeyboardEnabled") { (view: VimicateEditorView, enabled: Bool) in view.setSoftwareKeyboardEnabled(enabled) }
      Prop("softwareKeyboardForced") { (view: VimicateEditorView, forced: Bool) in view.setSoftwareKeyboardForced(forced) }
      Prop("routePastedTextExternally") { (view: VimicateEditorView, enabled: Bool) in view.setRoutePastedTextExternally(enabled) }
      Prop("repeatAuthority") { (view: VimicateEditorView, authority: String) in view.setRepeatAuthority(authority) }
      Prop("navigationCommand") { (view: VimicateEditorView, command: String) in view.performNavigationCommand(command) }
      Prop("fontSize") { (view: VimicateEditorView, fontSize: Double) in view.setFontSize(fontSize) }
    }

    View(PromptDropView.self) {
      ViewName("PromptDrop")
      Events("onDrop")
      Prop("sessionKey") { (view: PromptDropView, value: String) in view.sessionKey = value }
      Prop("enabled") { (view: PromptDropView, value: Bool) in view.enabled = value }
      OnViewDidUpdateProps { (view: PromptDropView) in view.coordinator = self.drops }
    }
  }
}
