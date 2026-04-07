# Code Review: Offline-First Local Sync (Branch `21-phase-2-offline-support-with-local-first-sync`)

## Summary

This PR adds an offline-first local sync architecture (Phases A-C) that moves all reads to local Dexie (IndexedDB), writes locally first then syncs to Supabase via an outbox queue, and adds PWA support. The approach is sound — it follows the Anki-style USN pattern and uses server-side RPCs for atomic operations.

**19 files changed, ~6000 LOC of new/modified application code** (excluding `package-lock.json`).

---

## Critical / High Severity

### 1. ~~BUG: `pullChanges` does not paginate — silent data loss on large syncs~~ RESOLVED

`pullChanges()` now loops up to 50 pages via `pullOnePage()`, continuing until the USN stops advancing or totalRows < page size.

---

### 2. ~~BUG: Sentence grave processing doesn't cascade to SRS cards and review logs locally~~ RESOLVED

The sentence grave case in `pullOnePage()` now cascades: deletes review logs by card IDs → SRS cards → tokens → sentence. The `srs_card` grave case also cascades to review logs.

---

### 3. ~~BUG: `startSyncListeners` leaks event listeners~~ RESOLVED

`onlineHandler` and `offlineHandler` are stored as module-level variables. `stopSyncListeners()` now calls `removeEventListener` with the stored references. `startSyncListeners()` calls `stopSyncListeners()` first to prevent double-registration.

---

### 4. ~~BUG: Outbox push groups by op type, destroying causal ordering~~ RESOLVED

Outbox ops are now grouped into **consecutive runs** of the same type (preserving creation-time ordering). A `pushOpBatch` dispatcher handles each run. Causal ordering (e.g., ingest before delete) is preserved.

---

### 5. ~~BUG: Hydration doesn't set `lastUsn` — first sync re-downloads everything~~ RESOLVED

`hydrateLocalDb()` now fetches `remote.getMaxUsn()` in parallel with the data pull and saves it as `lastUsn` in `syncMeta`. First `pullChanges` after hydration only fetches genuinely new changes.

---

### 6. ~~BUG: No error handling for hydration failure — user stuck on loading screen forever~~ RESOLVED

The hydration effect in `App.tsx` now has try/catch. On failure, `hydrationError` state is set and a retry screen is shown with the error message and a Retry button.

---

### 7. SECURITY: RPCs use `security definer` — bypasses RLS

All four RPCs use `security definer`, which runs as the function owner, bypassing RLS. They check `auth.uid()` internally. Accepted as a design tradeoff — the RPCs need cross-table access for atomic operations. `pull_changes` returns `row_to_json(*)` which includes `user_id`; this is low-risk since the user can only see their own data, but worth excluding in a future pass.

---

## Medium Severity

### 8. ~~BUG: Partial batch failure marks untried ops as failed~~ RESOLVED

Sequential ops (ingestBundle, updateTags) now use `pushSequential()` which tries each op individually and throws a `PartialBatchError` containing separate `succeeded` and `failed` ID lists. The caller handles partial success correctly.

---

### 9. ~~`deleteAllUserData` creates an outbox storm~~ RESOLVED (prior commit)

Replaced N per-entity outbox ops with a single `deleteAllData` op type. Server-side handler does bulk `DELETE` via RLS.

---

### 10. ~~`sync_graves` gets duplicate tombstones~~ RESOLVED (prior commit)

Added unique index `(user_id, entity_type, entity_id)` on `sync_graves`. The `apply_delete_ops` RPC now uses `ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET usn = nextval(...), deleted_at = ...`.

---

### 11. ~~`ensureDefaultDeck` makes a network call in repo facade — breaks offline~~ RESOLVED

The facade now tries `getCachedUserIdOrThrow()` first (synchronous, no network), falling back to `getUserId()` only if the cache is cold. Since the auth listener populates the cache on login, offline ingestion works.

---

### 12. `updateTags` uses direct Supabase write, not an RPC

`pushUpdateTags` uses `.from('sentences').update({ tags })`. This is RLS-protected and the `bump_sync_meta` trigger auto-sets USN + updated_at. Accepted — a dedicated RPC would add complexity without meaningful benefit since the trigger handles sync metadata.

---

## Low Severity / Improvements

### 13. ~~Duplicated row mappers across 3 files~~ RESOLVED

Extracted shared `meaningFromRow`, `sentenceFromRow`, etc. into `src/db/mappers.ts`. Both `remoteRepo.ts` and `syncEngine.ts` now import from the shared module.

### 14. ~~`SyncIndicator` time display never refreshes~~ RESOLVED

Added a 30-second interval tick in `SyncIndicator` to force re-renders, keeping the "Xm ago" tooltip fresh.

### 15. ~~PWA manifest references icons that may not exist~~ RESOLVED

Created `public/favicon.svg` with the 道 character. Updated manifest to use SVG icon instead of non-existent PNG files. For full PWA installability on all platforms, raster PNGs should be generated in a future pass.

### 16. ~~`syncStore.setStatus` has confusing `undefined` semantics~~ RESOLVED

`setStatus` now conditionally omits `errorMessage` when status is `'error'` (preserving the existing message), and clears it to `null` for other statuses.

### 17. No `sync_graves` cleanup / retention policy

Tombstones accumulate forever. For long-lived accounts, this table will grow unbounded. **Future work**: add a TTL-based cleanup (e.g., delete graves older than 90 days) or a periodic vacuum.

### 18. ~~`isHydrated` is true forever once set — no way to force re-hydration~~ RESOLVED

Added `LOCAL_SCHEMA_VERSION` constant to `hydrate.ts`. `isHydrated()` now checks that the stored `schemaVersion` matches the current version. Bumping the constant forces re-hydration on next app load.

---

## Additional Findings (Second Review Pass)

### 19. ~~SECURITY: RPCs allow cross-user references via client-supplied foreign IDs~~ RESOLVED

`apply_review_ops` trusted `card_id` without verifying it belongs to `auth.uid()`. `apply_ingest_bundle` trusted `parent_meaning_id`, `child_meaning_id`, `sentence_id`, `meaning_id`, `deck_id` without ownership checks. While IDs are random UUIDs making exploitation unlikely, defense-in-depth requires verification.

Added `EXISTS` ownership checks in all three RPCs before inserting child rows:
- `apply_review_ops`: verifies `card_id` belongs to user
- `apply_ingest_bundle`: verifies `parent_meaning_id`, `child_meaning_id`, `sentence_id`, `meaning_id`, `deck_id` all belong to user
- `apply_delete_ops`: already checked `user_id = uid` in WHERE clauses

### 20. ~~`deleteAllUserData` can leave client permanently empty with no recovery path~~ RESOLVED

If the user goes offline after local wipe but before the `deleteAllData` op pushes, local data is gone and the server still has data. But `lastHydratedAt` was still set, so the app would never rehydrate.

Fixed: `deleteAllUserData` now clears `lastHydratedAt`, `lastUsn`, and `schemaVersion` from `syncMeta`, so the app will rehydrate from the server on next boot.

### 21. ~~Failed ops are silently dead — UI can show "synced" with permanently unsent mutations~~ RESOLVED

After `MAX_ATTEMPTS`, ops were marked `failed` but `runSync()` only counted `pending` ops before setting status to `synced`.

Fixed: `runSync()` now also counts `failed` ops. If any exist, it sets an error status: "N operation(s) failed permanently" instead of claiming sync success.

### 22. ~~`apply_review_ops` comment/contract mismatch~~ RESOLVED

The comment said "idempotent via op_id" but the `ON CONFLICT` was on `id` (PK). Both the PK and the `op_id` unique index protect against duplicates — updated the comment to accurately describe the two dedup layers.

---

## Architecture Notes (Not Bugs)

- **Global `sync_usn_seq`**: USNs are shared across all users, causing per-user gaps. This works correctly but is unusual — Anki uses per-collection USNs. The tradeoff (simplicity) seems reasonable given the scale.
- **No conflict resolution for most entity types**: Sentences, meanings, etc. use last-write-wins (the pull just overwrites local). Only SRS cards have explicit merge logic (last-answered-wins). This is acceptable for the current single-user-multiple-devices use case.
- **The outbox is persisted in IndexedDB**: Good choice — survives page reloads and browser crashes. Failed ops will retry on next sync cycle.
- **Multi-tab**: `syncInProgress` is module-scoped per tab. Two tabs can race on the outbox. Review ops are idempotent via `op_id`; other ops rely on `ON CONFLICT DO NOTHING`. Acceptable for now; a `BroadcastChannel` lock could be added later.
- **No automated test coverage**: No `*.test.*` / `*.spec.*` files exist. High-value tests would cover: outbox lifecycle (pending → inflight → success/retry/failed), inflight recovery, listener registration, pull convergence, and RPC ownership/idempotency rules.

---

## Summary of Priority Actions

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | **Critical** | `pullChanges` doesn't paginate — data loss on large syncs | **RESOLVED** |
| 2 | **Critical** | Sentence graves don't cascade to local SRS cards/review logs | **RESOLVED** |
| 3 | **High** | Event listeners leak on each login/logout cycle | **RESOLVED** |
| 4 | **High** | Causal ordering destroyed by grouping outbox ops by type | **RESOLVED** |
| 5 | **High** | Hydration doesn't set `lastUsn` — doubles first sync | **RESOLVED** |
| 6 | **High** | No error handling for hydration failure — infinite loading | **RESOLVED** |
| 7 | **Medium** | `security definer` RPCs bypass RLS | Accepted (design) |
| 8 | **Medium** | Partial batch failure marks untried ops as failed | **RESOLVED** |
| 9 | **Medium** | `deleteAllUserData` creates N individual outbox ops | **RESOLVED** |
| 10 | **Medium** | Tombstone deduplication is a no-op | **RESOLVED** |
| 11 | **Medium** | `ensureDefaultDeck` breaks offline (network call) | **RESOLVED** |
| 12 | **Medium** | `updateTags` bypasses RPC pattern, no idempotency | Accepted (RLS+trigger) |
| 13 | Low | Duplicated row mappers | **RESOLVED** |
| 14 | Low | SyncIndicator time never refreshes | **RESOLVED** |
| 15 | Low | PWA manifest references missing icons | **RESOLVED** |
| 16 | Low | `setStatus` confusing semantics | **RESOLVED** |
| 17 | Low | No `sync_graves` cleanup policy | Future work |
| 18 | Low | No way to force re-hydration | **RESOLVED** |
| 19 | **Critical** | RPCs allow cross-user references via foreign IDs | **RESOLVED** |
| 20 | **High** | `deleteAllUserData` leaves client with no recovery path | **RESOLVED** |
| 21 | **High** | Failed ops invisible to UI — false "synced" status | **RESOLVED** |
| 22 | **Medium** | `apply_review_ops` comment/contract mismatch | **RESOLVED** |
