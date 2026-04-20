import { describe, it, expect } from 'vitest';
import { SyncError, isPermanentSyncError, syncErrorFrom } from './syncEngine';

describe('isPermanentSyncError', () => {
  it('flags 23xxx (integrity constraint violations) as permanent', () => {
    expect(isPermanentSyncError(new SyncError('CHECK violation', '23514'))).toBe(true);
    expect(isPermanentSyncError(new SyncError('FK violation', '23503'))).toBe(true);
    expect(isPermanentSyncError(new SyncError('unique violation', '23505'))).toBe(true);
    expect(isPermanentSyncError(new SyncError('not null', '23502'))).toBe(true);
  });

  it('flags 42xxx (syntax / definition) as permanent', () => {
    expect(isPermanentSyncError(new SyncError('missing column', '42703'))).toBe(true);
    expect(isPermanentSyncError(new SyncError('bad function sig', '42883'))).toBe(true);
  });

  it('flags 58xxx (system errors) as permanent', () => {
    expect(isPermanentSyncError(new SyncError('system', '58000'))).toBe(true);
  });

  it('does not flag 22xxx (data exceptions) or 40xxx (txn rollback)', () => {
    expect(isPermanentSyncError(new SyncError('divide by zero', '22012'))).toBe(false);
    expect(isPermanentSyncError(new SyncError('serialization', '40001'))).toBe(false);
  });

  it('does not flag errors without a code', () => {
    expect(isPermanentSyncError(new SyncError('unknown'))).toBe(false);
  });

  it('does not flag plain Error or other thrown values', () => {
    expect(isPermanentSyncError(new Error('network timeout'))).toBe(false);
    expect(isPermanentSyncError('string error')).toBe(false);
    expect(isPermanentSyncError(null)).toBe(false);
    expect(isPermanentSyncError(undefined)).toBe(false);
  });
});

describe('syncErrorFrom', () => {
  it('preserves message and code from a Supabase error-shaped object', () => {
    const wrapped = syncErrorFrom({ message: 'CHECK violation', code: '23514' });
    expect(wrapped).toBeInstanceOf(SyncError);
    expect(wrapped.message).toBe('CHECK violation');
    expect(wrapped.code).toBe('23514');
  });

  it('uses a fallback message when none provided', () => {
    const wrapped = syncErrorFrom(null, 'fallback');
    expect(wrapped.message).toBe('fallback');
    expect(wrapped.code).toBeUndefined();
  });
});
