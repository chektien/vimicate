import { Alert, Linking } from 'react-native';
import type { TranscriptLinkTarget } from './transcriptMarkdown';

export function transcriptLinkAccessibilityLabel(target: TranscriptLinkTarget) {
  if (target.kind === 'web') return `Open web link ${target.url}`;
  const name = target.path.split('/').filter(Boolean).at(-1) ?? target.path;
  return `Open file ${name}`;
}

export function transcriptLinkAccessibilityHint(target: TranscriptLinkTarget) {
  return target.kind === 'web'
    ? 'Opens in the browser'
    : 'Opens in project Files when this transcript belongs to an available project';
}

export async function openTranscriptLink(target: TranscriptLinkTarget) {
  if (target.kind === 'web') {
    try { await Linking.openURL(target.url); }
    catch { Alert.alert('Could not open web link', 'The browser could not open this link.'); }
    return;
  }
  // Only a workspace-scoped Files owner can resolve a host path. A remembered
  // iOS provider bookmark cannot prove it refers to the same host folder.
  Alert.alert('File location unavailable', 'Open this file link from a connected workspace so its exact location can be resolved.');
}
