/**
 * Per-day, per-deck overrides for newCardsPerDay / reviewsPerDay.
 *
 * Anki calls these "Custom Study" actions: temporarily raise today's caps
 * so cards held back by the daily limit become eligible. Bumps reset at
 * local midnight via date-scoped storage keys — no migration, no cleanup.
 *
 * Stored in localStorage rather than Dexie because:
 *   - they're operational, per-device, and shouldn't sync.
 *   - they auto-expire by date, so old keys becoming stale is harmless.
 */

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function storageKey(kind: 'new' | 'review', deckId: string): string {
  return `mandao:bump:${kind}:${deckId}:${todayKey()}`;
}

function read(kind: 'new' | 'review', deckId: string): number {
  try {
    const v = localStorage.getItem(storageKey(kind, deckId));
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

function write(kind: 'new' | 'review', deckId: string, value: number): void {
  try {
    localStorage.setItem(storageKey(kind, deckId), String(Math.max(0, value)));
  } catch {
    // localStorage unavailable; bumps remain session-effective via callers' refetch.
  }
}

export function getNewLimitBumpToday(deckId: string): number {
  return read('new', deckId);
}

export function getReviewLimitBumpToday(deckId: string): number {
  return read('review', deckId);
}

export function addNewLimitBumpToday(deckId: string, amount: number): void {
  write('new', deckId, read('new', deckId) + amount);
}

export function addReviewLimitBumpToday(deckId: string, amount: number): void {
  write('review', deckId, read('review', deckId) + amount);
}
