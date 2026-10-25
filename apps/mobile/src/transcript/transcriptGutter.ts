export function transcriptGutterLabel(
  sourceRow: number,
  cursorRow: number,
  sourceNavigationIndex?: number,
  cursorNavigationIndex?: number,
) {
  if (sourceRow === cursorRow) return '0';
  if (sourceNavigationIndex !== undefined && cursorNavigationIndex !== undefined) {
    return String(Math.abs(sourceNavigationIndex - cursorNavigationIndex));
  }
  return String(Math.abs(sourceRow - cursorRow));
}
