import Foundation

/// A UITextView.text assignment rebuilds the document and transiently reveals
/// its end before the controlled caret returns. The editor applies only the
/// changed graphemes so TextKit retains layout and the reader's viewport.
enum ControlledTextReplacement {
  static func changedRange(from previous: String, to text: String) -> (range: NSRange, replacement: String) {
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
    return (NSRange(start..<end, in: previous), String(text[nextStart..<nextEnd]))
  }
}
