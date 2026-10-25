export function projectFilesStatusPosition(files: {
  region: 'list' | 'preview'; selectedIndex: number;
  previewNavigation: { cursor: { row: number; column: number } };
}) {
  if (files.region === 'preview') {
    return `${files.previewNavigation.cursor.row + 1}:${files.previewNavigation.cursor.column + 1}`;
  }
  return `${files.selectedIndex + 1}`;
}
