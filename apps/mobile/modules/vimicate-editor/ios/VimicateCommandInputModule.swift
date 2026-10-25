import ExpoModulesCore

struct CommandInputValueState: Record {
  @Field var text: String = ""
  @Field var eventCount: Int = 0
}

public final class VimicateCommandInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VimicateCommandInput")
    Constants(["supportsEventCount": true])

    View(VimicateCommandInputView.self) {
      Events("onQueryChange", "onSubmit", "onCancel", "onComplete", "onHistory")
      Prop("historyEnabled") { (view: VimicateCommandInputView, enabled: Bool) in view.setHistoryEnabled(enabled) }
      Prop("value") { (view: VimicateCommandInputView, value: String) in view.setValue(value) }
      Prop("valueState") { (view: VimicateCommandInputView, state: CommandInputValueState) in view.setValueState(state) }
      Prop("active") { (view: VimicateCommandInputView, active: Bool) in view.setActive(active) }
      Prop("softwareKeyboardEnabled") { (view: VimicateCommandInputView, enabled: Bool) in view.setSoftwareKeyboardEnabled(enabled) }
      Prop("inputAccessibilityLabel") { (view: VimicateCommandInputView, label: String) in view.setInputAccessibilityLabel(label) }
    }
  }
}
