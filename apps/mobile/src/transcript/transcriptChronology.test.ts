import { describe, expect, it } from 'vitest';
import { transcriptChronology, transcriptTimestamp } from './transcriptChronology';

describe('transcript chronology', () => {
  it('keeps undated rows transparent and emits dividers only when the dated day changes', () => {
    const now = new Date(2026, 7, 25, 8, 30);
    const chronology = transcriptChronology([
      { id: 'a', role: 'assistant', text: 'a', timestamp: String(new Date(2026, 7, 24, 20, 4).getTime()) },
      { id: 'b', role: 'tool', text: 'b' },
      { id: 'c', role: 'assistant', text: 'c', timestamp: String(new Date(2026, 7, 24, 22, 9).getTime()) },
      { id: 'd', role: 'user', text: 'd', timestamp: String(new Date(2026, 7, 25, 8, 13).getTime()) },
    ], now);
    expect(chronology.map((value) => value.dividerLabel)).toEqual(['Yesterday', undefined, undefined, 'Today']);
    expect(chronology[3]).toMatchObject({ timeLabel: '08:13', focusedTimeLabel: 'Aug 25, 08:13' });
  });

  it('accepts ISO, unix-second, and unix-millisecond gateway timestamps', () => {
    expect(transcriptTimestamp('2026-08-25T00:13:00Z')).not.toBeNull();
    expect(transcriptTimestamp('1787616780')?.getTime()).toBe(1_787_616_780_000);
    expect(transcriptTimestamp('1787616780000')?.getTime()).toBe(1_787_616_780_000);
  });
});
