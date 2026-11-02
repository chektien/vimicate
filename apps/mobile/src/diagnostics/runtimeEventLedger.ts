import { sgtTimestamp } from './latestFatalDiagnostic';

const KEY = 'diagnostics.runtimeEvents.v1';
const LIMIT = 40;
let lines: string[] | null = null;
let loading: Promise<string[]> | null = null;

// Storage loads on demand so recording never adds SQLite to an import graph.
// Workspace writes are held while the scene is inactive, so background-only
// events persist when the app returns to the foreground, not before.
let storeModule: Promise<typeof import('../storage/workspaceStore')> | null = null;
const store = () => storeModule ??= import('../storage/workspaceStore').catch((error: unknown) => { storeModule = null; throw error; });

/** Bounded launch/lifecycle/connection/memory breadcrumbs that survive a kill. */
export function recordRuntimeEvent(kind: string, detail = '', at = Date.now()) {
  const line = `${at} ${kind}${detail ? ` ${bounded(detail)}` : ''}`;
  void append(line).catch(() => undefined);
}

export async function runtimeEventLines() {
  try { return [...await loaded(await store())]; } catch { return []; }
}

export function runtimeEventText(events: readonly string[]) {
  const formatted = events.flatMap((line) => {
    const match = /^(\d{10,}) (.+)$/.exec(line);
    return match ? [`${sgtTimestamp(Number(match[1]))} ${match[2]}`] : [];
  });
  return `runtime events (persisted across launches, SGT, oldest to newest)\n${formatted.length ? formatted.join('\n') : '(none)'}`;
}

async function append(line: string) {
  const persistence = await store();
  const current = await loaded(persistence);
  current.push(line);
  if (current.length > LIMIT) current.splice(0, current.length - LIMIT);
  await persistence.saveValue(KEY, JSON.stringify(current));
}

function loaded(persistence: Awaited<ReturnType<typeof store>>) {
  if (lines) return Promise.resolve(lines);
  loading ??= persistence.loadValue(KEY).then((value) => {
    lines ??= parsed(value);
    return lines;
  });
  return loading;
}

function parsed(value: string | null) {
  try {
    const decoded: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(decoded) ? decoded.filter((line): line is string => typeof line === 'string').slice(-LIMIT) : [];
  } catch { return []; }
}

function bounded(detail: string) {
  return detail
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<redacted>/')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}
