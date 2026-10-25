// Markdown destinations are URI-escaped; structured paths and MEDIA lines are
// literal filesystem paths. Decode only at this boundary, never twice in a URL.
export function decodedMarkdownImagePath(source: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/__openclaw__/assistant-media') || source.startsWith('/api/chat/media/outgoing/')) return source;
  try { return decodeURIComponent(source); } catch { return source; }
}

export function markdownImageSources(text: string) {
  return Array.from(text.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/g), match => {
    const rawSource = match[2] ?? match[3] ?? '';
    return { rawSource, source: decodedMarkdownImagePath(rawSource), alt: match[1] ?? '' };
  });
}
