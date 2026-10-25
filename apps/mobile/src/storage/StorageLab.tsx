import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';
import { Action, Label, Metric, Panel, SectionTitle } from '../ui/Primitives';
import { clearLabCorpus, openLabDatabase, queryWindow, seedCorpus, storageStats, verifyNoOpUpsert, type StorageStats, type StoredMessage } from './storageService';

const emptyStats: StorageStats = { rows: 0, bytes: 0, pageCount: 0, pageSize: 0, integrity: 'pending' };
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function StorageLab({ record }: { record: (message: string) => void }) {
  const [stats, setStats] = useState(emptyStats); const [progress, setProgress] = useState(0); const [busy, setBusy] = useState(false);
  const [windowRows, setWindowRows] = useState<StoredMessage[]>([]); const [queryMs, setQueryMs] = useState(0); const [seedMs, setSeedMs] = useState(0); const [noOp, setNoOp] = useState<number | null>(null);
  const refresh = async () => setStats(await storageStats());
  useEffect(() => { void openLabDatabase().then(refresh).then(() => record('SQLite migration v1 ready')); }, [record]);
  const seed = async () => { setBusy(true); setProgress(0); try { const elapsed = await seedCorpus(6500, setProgress); setSeedMs(elapsed); await refresh(); record(`SQLite seeded 50MB-class corpus in ${elapsed}ms`); } finally { setBusy(false); } };
  const query = async (center: number) => { const started = performance.now(); const rows = await queryWindow(center); setQueryMs(Math.round((performance.now() - started) * 10) / 10); setWindowRows(rows); record(`SQLite queried ${rows.length} row window at ${center}`); };
  return (
    <View style={styles.root}>
      <SectionTitle index="04" title="SQLITE / DURABILITY" detail="WAL, migration ledger, 50 MB-class corpus, indexed windows, idempotent upserts and reopen checks." />
      <View style={styles.metrics}><Metric label="rows" value={stats.rows.toLocaleString()} /><Metric label="db size" value={formatBytes(stats.bytes)} tone={stats.bytes >= 50 * 1024 * 1024 ? 'good' : 'warn'} /><Metric label="integrity" value={stats.integrity} tone={stats.integrity === 'ok' ? 'good' : 'warn'} /><Metric label="query" value={`${queryMs} ms`} /><Metric label="no-op Δ" value={noOp ?? '—'} tone={noOp === 0 ? 'good' : noOp === null ? 'normal' : 'bad'} /></View>
      <View style={styles.actions}><Action label={busy ? `SEEDING ${progress}/6500` : 'SEED ≈50 MB'} active={busy} disabled={busy} onPress={() => void seed()} /><Action label="WINDOW @ 100" disabled={busy || !stats.rows} onPress={() => void query(100)} /><Action label="WINDOW @ 3200" disabled={busy || !stats.rows} onPress={() => void query(3200)} /><Action label="WINDOW @ TAIL" disabled={busy || !stats.rows} onPress={() => void query(stats.rows - 1)} /><Action label="NO-OP UPSERT" disabled={busy || !stats.rows} onPress={() => void verifyNoOpUpsert().then(setNoOp)} /><Action label="INTEGRITY" onPress={() => void refresh()} /><Action label="CLEAR LAB DB" danger disabled={busy} onPress={() => void clearLabCorpus().then(refresh).then(() => setWindowRows([]))} /></View>
      <View style={styles.columns}>
        <Panel style={styles.ledger}><Label tone="accent">storage contract</Label><Text style={styles.copy}>Only bounded windows cross into presentation. The lab never publishes the whole database to React state.</Text><View style={styles.rule}><Label>journal</Label><Text style={styles.value}>WAL</Text></View><View style={styles.rule}><Label>migration</Label><Text style={styles.value}>schema v1</Text></View><View style={styles.rule}><Label>seed time</Label><Text style={styles.value}>{seedMs ? `${seedMs} ms` : '—'}</Text></View><View style={styles.rule}><Label>page census</Label><Text style={styles.value}>{stats.pageCount.toLocaleString()} × {stats.pageSize}</Text></View></Panel>
        <Panel style={styles.rows}><Label tone="good">bounded query window / {windowRows.length || 0}</Label><ScrollView style={styles.rowScroll}>{windowRows.length ? windowRows.map((row) => <View key={row.source_id} style={styles.row}><Text style={styles.ordinal}>{String(row.ordinal).padStart(5, '0')}</Text><Text style={styles.role}>{row.role}</Text><Text numberOfLines={1} style={styles.body}>{row.body.slice(0, 120)}</Text></View>) : <Text style={styles.empty}>Seed the corpus, then query a semantic window.</Text>}</ScrollView></Panel>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 }, metrics: { flexDirection: 'row', gap: space.sm, marginBottom: space.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }, columns: { flex: 1, flexDirection: 'row', gap: space.md }, ledger: { width: 250 }, rows: { flex: 1 },
  copy: { color: colors.inkMuted, fontFamily: type.mono, fontSize: 11, lineHeight: 18, marginVertical: space.md }, rule: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space.sm }, value: { color: colors.inkBright, fontFamily: type.mono, fontSize: 14, marginTop: 3 },
  rowScroll: { flex: 1, marginTop: space.md }, row: { flexDirection: 'row', gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 7 }, ordinal: { width: 48, color: colors.yellow, fontFamily: type.mono, fontSize: 10 }, role: { width: 70, color: colors.aqua, fontFamily: type.mono, fontSize: 10 }, body: { flex: 1, color: colors.inkMuted, fontFamily: type.mono, fontSize: 10 }, empty: { color: colors.faint, fontFamily: type.mono, fontSize: 11 },
});
