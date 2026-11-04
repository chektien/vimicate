import { z } from 'zod';

// OpenClaw 2026.10.8 session-row-fields. Compact omission is unknown detail,
// never a deletion receipt. Keep non-detail fields authoritative on every read.
const detailFields = [
  'contextWindows', 'contextWindowDefault', 'thinkingLevels', 'thinkingOptions',
  'thinkingDefault', 'toolOverrides', 'providerReview', 'nativeRuntimeConsent',
  'contextBudgetStatus', 'agentRuntime', 'pluginExtensions',
] as const;
const runtimeSchema = z.looseObject({ id: z.string().optional() }).nullable().optional();
const rowSchema = z.looseObject({
  // Gateway leaves identity strings unbounded; a long legitimate key must not
  // reject the whole census.
  key: z.string().trim().min(1),
  rowMode: z.literal('compact').optional(),
  sessionId: z.string().optional(),
  lifecycleRevision: z.string().optional(),
  sessionModelRevision: z.string().optional(),
  agentRuntime: runtimeSchema,
});
const payloadSchema = z.looseObject({
  sessions: z.array(rowSchema).max(1000),
  defaults: z.looseObject({ agentRuntime: runtimeSchema }).optional(),
}).refine(payload => new Set(payload.sessions.map(row => row.key)).size === payload.sessions.length);
type Row = z.infer<typeof rowSchema>;
type Detail = Pick<Row, 'sessionId' | 'lifecycleRevision' | 'sessionModelRevision'> & { fields: Record<string, unknown> };
type Read = (params: Record<string, unknown>) => Promise<unknown>;
// Event-patched census is reused at most this long before a full reconciling read.
export const EVENT_CENSUS_MAX_AGE_MS = 30_000;
// Lifecycle snapshots may omit token totals that are not fresh; keep the last known.
const retainedWhenAbsent = [...detailFields, 'totalTokens', 'totalTokensFresh'];

/** One connection owns at most one bounded census of retained detail facts. */
export class SessionCensus {
  private details: Map<string, Detail> | null = null;
  private epoch = 0;
  private issued = 0;
  private committed = 0;
  private last: { payload: Record<string, unknown>; sessions: Record<string, unknown>[]; fetchedAt: number } | null = null;
  private dirty = true;
  private patched = false;

  clear() { this.epoch++; this.details = null; this.last = null; this.dirty = true; this.patched = false; }

  /** A change notice without a usable row: the next read must fetch. */
  invalidate() { this.dirty = true; }

  /**
   * Applies a `sessions.changed` row snapshot to the last census, so routine
   * activity does not refetch the whole list. Unknown keys, new incarnations or
   * model inputs, or a read already in flight fall back to a fetch.
   */
  applyEventRow(value: unknown) {
    const parsed = rowSchema.safeParse(value);
    const last = this.last;
    if (!parsed.success || !last || this.issued !== this.committed) { this.dirty = true; return false; }
    const row = parsed.data;
    const index = last.sessions.findIndex(existing => existing.key === row.key);
    const existing = index >= 0 ? last.sessions[index]! : undefined;
    if (!existing || !compatible(this.details?.get(row.key), row)) { this.dirty = true; return false; }
    const retained = Object.fromEntries(retainedWhenAbsent.filter(field => Object.hasOwn(existing, field) && !Object.hasOwn(row, field)).map(field => [field, existing[field]]));
    const { rowMode: _mode, ...current } = row;
    const sessions = [...last.sessions]; sessions[index] = { ...retained, ...current };
    this.last = { ...last, sessions }; this.patched = true;
    return true;
  }

  async read(request: Read, refreshDetails = false, now = Date.now()): Promise<Record<string, unknown>> {
    const cached = this.last;
    // Only change-notice rows justify reuse; any other caller asks the Gateway.
    if (!refreshDetails && this.patched && !this.dirty && cached && now - cached.fetchedAt < EVENT_CENSUS_MAX_AGE_MS) return { ...cached.payload, sessions: cached.sessions };
    const epoch = this.epoch; const revision = ++this.issued; const previous = this.details;
    const ownsConnection = () => { if (epoch !== this.epoch) throw new Error('Session census connection retired'); };
    const read = async (full: boolean) => {
      const value = await request({ limit: 1000, ...(full ? {} : { rowMode: 'compact' }) });
      ownsConnection();
      const result = payloadSchema.safeParse(value);
      if (!result.success || (full && result.data.sessions.some(row => row.rowMode === 'compact'))) throw new Error('Invalid session census payload');
      return result.data;
    };
    let payload = await read(refreshDetails || !previous);
    // New membership, incarnation or model inputs need fresh detail authority.
    // Never expose an unknown runtime as the configured default in the meantime.
    if (payload.sessions.some(row => row.rowMode === 'compact' && !compatible(previous?.get(row.key), row))) payload = await read(true);
    const sessions = payload.sessions.map(row => {
      if (row.rowMode !== 'compact') return row;
      return { ...previous!.get(row.key)!.fields, ...row };
    });
    // A late concurrent read may finish for its caller, but cannot roll back the
    // newer cache. Disconnect also retires requests already off the transport.
    if (revision > this.committed) {
      this.committed = revision;
      if (revision === this.issued) { this.last = { payload, sessions, fetchedAt: now }; this.dirty = false; this.patched = false; }
      this.details = new Map(sessions.map(row => [row.key, {
        sessionId: row.sessionId, lifecycleRevision: row.lifecycleRevision, sessionModelRevision: row.sessionModelRevision,
        fields: Object.fromEntries(detailFields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])),
      }]));
    }
    return { ...payload, sessions };
  }
}

function compatible(previous: Detail | undefined, row: Row) {
  return previous !== undefined && previous.sessionId === row.sessionId
    && previous.lifecycleRevision === row.lifecycleRevision && previous.sessionModelRevision === row.sessionModelRevision;
}
