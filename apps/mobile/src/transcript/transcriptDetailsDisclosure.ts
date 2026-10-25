import { plainTranscriptMarkdownLine, type CompiledMarkdownLine } from './transcriptMarkdown';

export type DisclosureLine = {
  lineInMessage: number;
  compiled: CompiledMarkdownLine;
  foldKey?: string;
  fold?: { expanded: boolean; hiddenLineCount: number; endSourceRow: number };
};

type DisclosureBlock = { end: number; bodyStart: number; label: string };
const opening = /^<details>(?:\s*<summary>(.*?)<\/summary>)?$/;
const summary = /^<summary>(.*?)<\/summary>$/;

/** Keep source coordinates intact while replacing only complete disclosures. */
export function projectTranscriptDetailsDisclosure(
  messageID: string,
  compiled: readonly CompiledMarkdownLine[],
  firstSourceRow: number,
  expandedKeys: ReadonlySet<string>,
): DisclosureLine[] {
  const result: DisclosureLine[] = [];
  for (let index = 0; index < compiled.length; index += 1) {
    const block = disclosureAt(compiled, index);
    if (!block) {
      const line = compiled[index]!;
      if (line.kind !== 'blank') result.push({ lineInMessage: index, compiled: line });
      continue;
    }
    const foldKey = `${messageID}:details:${index}`;
    const expanded = expandedKeys.has(foldKey);
    const hiddenLineCount = block.end - index;
    const marker = hiddenLineCount === 1 ? 'line' : 'lines';
    result.push({
      lineInMessage: index,
      compiled: plainTranscriptMarkdownLine(expanded ? block.label : `${block.label}  … [${hiddenLineCount} ${marker} folded]`),
      foldKey,
      fold: { expanded, hiddenLineCount, endSourceRow: firstSourceRow + (expanded ? index : block.end) },
    });
    if (expanded) {
      for (let body = block.bodyStart; body < block.end; body += 1) {
        const line = compiled[body]!;
        if (line.kind !== 'blank') result.push({ lineInMessage: body, compiled: line });
      }
    }
    index = block.end;
  }
  return result;
}

function disclosureAt(lines: readonly CompiledMarkdownLine[], start: number): DisclosureBlock | null {
  const line = lines[start];
  if (!line || line.kind === 'code' || line.kind === 'fence') return null;
  const match = line.source.trim().match(opening);
  if (!match) return null;
  let label = match[1]?.trim() || 'Details';
  let bodyStart = start + 1;
  const next = lines[bodyStart];
  if (match[1] === undefined && next && next.kind !== 'code' && next.kind !== 'fence') {
    const text = next.source.trim();
    if (text.startsWith('<summary')) {
      const parsed = text.match(summary);
      if (!parsed) return null;
      label = parsed[1]?.trim() || 'Details';
      bodyStart += 1;
    }
  }
  let depth = 1;
  for (let index = bodyStart; index < lines.length; index += 1) {
    const candidate = lines[index]!;
    if (candidate.kind === 'code' || candidate.kind === 'fence') continue;
    const text = candidate.source.trim();
    if (opening.test(text)) depth += 1;
    else if (text === '</details>') {
      depth -= 1;
      if (depth === 0) return { end: index, bodyStart, label };
    }
  }
  return null;
}
