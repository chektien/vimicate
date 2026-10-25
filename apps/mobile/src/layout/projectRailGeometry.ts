// Wide enough for roughly two long monospace project-name words once the
// ordinal, disclosure and star affordances are accounted for, while leaving
// most of the iPad width to the transcript.
export const PROJECT_RAIL_WIDTH = 224;
export const PROJECT_RAIL_LIST_LEFT_INSET = 4;
export const PROJECT_CARD_LEFT_INSET = 2;

export function projectCardRightInset(isThread: boolean) {
  // Root cards already reserve a star-button column. Starless children need
  // their own breathing room for the age and status indicator in either sort.
  return isThread ? 8 : 3;
}

export function projectRailPinchSurfaceStyle(compactDrawer: boolean) {
  return compactDrawer
    ? { flex: 1, width: '100%' as const, minHeight: 0, overflow: 'hidden' as const }
    : { flex: 0, width: PROJECT_RAIL_WIDTH, height: '100%' as const, minHeight: 0, overflow: 'hidden' as const };
}
