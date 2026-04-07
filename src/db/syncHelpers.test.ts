import { describe, it, expect } from 'vitest';
import { computeSafeUsn, groupConsecutiveRuns, type TableStats } from './syncHelpers';
import type { SyncOp } from './localDb';

// ============================================================
// computeSafeUsn
// ============================================================

describe('computeSafeUsn', () => {
  const PAGE = 1000;

  it('advances to max USN when no table is truncated', () => {
    const stats: TableStats[] = [
      { maxUsn: 500, count: 200 },
      { maxUsn: 800, count: 300 },
      { maxUsn: 300, count: 50 },
    ];
    const { safeUsn, anyTruncated } = computeSafeUsn(stats, 0, PAGE);
    expect(safeUsn).toBe(800);
    expect(anyTruncated).toBe(false);
  });

  it('returns lastUsn when all tables are empty', () => {
    const stats: TableStats[] = [
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
    ];
    const { safeUsn, anyTruncated } = computeSafeUsn(stats, 42, PAGE);
    expect(safeUsn).toBe(42);
    expect(anyTruncated).toBe(false);
  });

  it('uses min of truncated tables when one table hits page size', () => {
    // meanings returned 1000 rows (max USN 1500)
    // sentences returned 500 rows (max USN 2000)
    // Without the fix, cursor would jump to 2000 and skip meanings 1501-1999
    const stats: TableStats[] = [
      { maxUsn: 1500, count: 1000 }, // truncated
      { maxUsn: 2000, count: 500 },  // not truncated
    ];
    const { safeUsn, anyTruncated } = computeSafeUsn(stats, 0, PAGE);
    expect(safeUsn).toBe(1500);
    expect(anyTruncated).toBe(true);
  });

  it('uses min across multiple truncated tables', () => {
    const stats: TableStats[] = [
      { maxUsn: 1200, count: 1000 }, // truncated
      { maxUsn: 1800, count: 1000 }, // truncated
      { maxUsn: 3000, count: 100 },  // not truncated
    ];
    const { safeUsn, anyTruncated } = computeSafeUsn(stats, 0, PAGE);
    expect(safeUsn).toBe(1200);
    expect(anyTruncated).toBe(true);
  });

  it('handles all tables truncated at same USN', () => {
    const stats: TableStats[] = [
      { maxUsn: 1000, count: 1000 },
      { maxUsn: 1000, count: 1000 },
    ];
    const { safeUsn, anyTruncated } = computeSafeUsn(stats, 0, PAGE);
    expect(safeUsn).toBe(1000);
    expect(anyTruncated).toBe(true);
  });

  it('does not regress past lastUsn when no data returned', () => {
    const stats: TableStats[] = [
      { maxUsn: 0, count: 0 },
    ];
    const { safeUsn } = computeSafeUsn(stats, 500, PAGE);
    expect(safeUsn).toBe(500);
  });

  it('handles the exact scenario from the review: meanings 1000@1500, sentences 500@2000', () => {
    const stats: TableStats[] = [
      { maxUsn: 1500, count: 1000 },
      { maxUsn: 2000, count: 500 },
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
      { maxUsn: 0, count: 0 },
    ];
    const { safeUsn } = computeSafeUsn(stats, 0, PAGE);
    // Must NOT be 2000 — must be 1500 (the truncated table's max)
    expect(safeUsn).toBe(1500);
  });
});

// ============================================================
// groupConsecutiveRuns
// ============================================================

function makeOp(op: SyncOp['op'], id: number): SyncOp {
  return {
    id,
    op,
    payload: {},
    status: 'pending',
    attempts: 0,
    createdAt: id,
    deviceId: 'test',
    opId: `op-${id}`,
  };
}

describe('groupConsecutiveRuns', () => {
  it('returns empty array for empty input', () => {
    expect(groupConsecutiveRuns([])).toEqual([]);
  });

  it('groups a single op into one run', () => {
    const ops = [makeOp('reviewCard', 1)];
    const runs = groupConsecutiveRuns(ops);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(1);
  });

  it('groups consecutive same-type ops together', () => {
    const ops = [
      makeOp('reviewCard', 1),
      makeOp('reviewCard', 2),
      makeOp('reviewCard', 3),
    ];
    const runs = groupConsecutiveRuns(ops);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it('splits different types into separate runs', () => {
    const ops = [
      makeOp('ingestBundle', 1),
      makeOp('reviewCard', 2),
      makeOp('deleteEntity', 3),
    ];
    const runs = groupConsecutiveRuns(ops);
    expect(runs).toHaveLength(3);
    expect(runs[0][0].op).toBe('ingestBundle');
    expect(runs[1][0].op).toBe('reviewCard');
    expect(runs[2][0].op).toBe('deleteEntity');
  });

  it('preserves causal ordering: ingest → review → delete for same entity', () => {
    const ops = [
      makeOp('ingestBundle', 1),
      makeOp('reviewCard', 2),
      makeOp('reviewCard', 3),
      makeOp('deleteEntity', 4),
    ];
    const runs = groupConsecutiveRuns(ops);
    expect(runs).toHaveLength(3);
    expect(runs[0].map((o) => o.id)).toEqual([1]);
    expect(runs[1].map((o) => o.id)).toEqual([2, 3]);
    expect(runs[2].map((o) => o.id)).toEqual([4]);
  });

  it('creates separate runs for interleaved types', () => {
    const ops = [
      makeOp('ingestBundle', 1),
      makeOp('updateTags', 2),
      makeOp('ingestBundle', 3),
    ];
    const runs = groupConsecutiveRuns(ops);
    expect(runs).toHaveLength(3);
    expect(runs[0][0].op).toBe('ingestBundle');
    expect(runs[1][0].op).toBe('updateTags');
    expect(runs[2][0].op).toBe('ingestBundle');
  });
});
