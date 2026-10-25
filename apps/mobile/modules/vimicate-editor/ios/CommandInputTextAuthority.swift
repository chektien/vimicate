import Foundation

/// One mounted command field owns its native edit sequence. Controlled writes
/// carry the edit they were computed from, atomically with their text.
final class CommandInputTextAuthority {
  private(set) var eventCount = 0

  @discardableResult
  func recordNativeEdit() -> Int {
    eventCount += 1
    return eventCount
  }

  func acceptsControlledWrite(acknowledging count: Int) -> Bool {
    count == eventCount
  }
}
