/** Legacy assistant display compatibility, not file access authority. Every
 * local source still goes through the authenticated Gateway media route. */
export function mediaDirectiveLines(text: string): Map<number, string | null> {
  const directives = new Map<number, string | null>();
  let fence: { marker: string; length: number } | null = null;
  for (const [index, line] of text.split('\n').entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      const run = marker[1]!;
      if (!fence && !(run[0] === '`' && marker[2]!.includes('`'))) fence = { marker: run[0]!, length: run.length };
      else if (fence && run[0] === fence.marker && run.length >= fence.length && !marker[2]!.trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^ {0,3}MEDIA:[ \t]*(.*?)[ \t\r]*$/i);
    if (!match) continue;
    const payload = match[1]!.trim();
    const source = /^(["'`]).*\1$/s.test(payload) ? payload.slice(1, -1).trim() : payload;
    directives.set(index, validImageReference(source) ? source : null);
  }
  return directives;
}

function validImageReference(source: string) {
  if (!source || source.length > 4096 || /[\u0000-\u001f\u007f]/.test(source)) return false;
  let decoded = source;
  try { for (let count = 0; count < 3 && /%[0-9a-f]{2}/i.test(decoded); count += 1) decoded = decodeURIComponent(decoded); }
  catch { return false; }
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(decoded) || /[\u0000-\u001f\u007f]/.test(decoded)) return false;
  if (/^media:\/\/(?:inbound|outgoing)\/[^\s/]+(?:\?[^\s]*)?$/i.test(source)) return true;
  if (!/\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)(?:[?#].*)?$/i.test(source)) return false;
  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source); const host = url.hostname.toLowerCase().replace(/\.+$/, '');
      return !url.username && !url.password && host.includes('.') && !/^[\d.]+$/.test(host)
        && !/(?:^|\.)(?:localhost|local|internal)$/.test(host) && host !== 'metadata.google.internal';
    } catch { return false; }
  }
  if (/^file:\/\//i.test(source)) return source.startsWith('file:///');
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('~') && !source.startsWith('~/')) return false;
  return true;
}
