# Code Review: Offline-First Local Sync (Branch `21-phase-2-offline-support-with-local-first-sync`)

## Summary

This PR adds an offline-first local sync architecture (Phases A-C) that moves all reads to local Dexie (IndexedDB), writes locally first then syncs to Supabase via an outbox queue, and adds PWA support. The approach is sound — it follows the Anki-style USN pattern and uses server-side RPCs for atomic operations.

**19 files changed, ~6000 LOC of new/modified application code** (excluding `package-lock.json`).

---

## Critical / High Severity

### 1. BUG: `pullChanges` does not paginate — silent data loss on large syncs

`pullChanges()` calls the RPC with `max_rows: 1000` but **never loops**. If a user has more than 1000 changes in any table since their last sync, the rest are silently dropped. The `lastUsn` is updated to the max seen, so the truncated rows may never be fetched.

```ts
// src/db/syncEngine.ts — pullChanges()
const { data, error } = await supabase.rpc('pull_changes', {
  last_usn: lastUsn,
  max_rows: 1000,
});
```

The SQL applies `LIMIT max_rows` **per table independently**:

```sql
select * from meanings where user_id = uid and usn > last_usn order by usn limit max_rows
```

So if there are 1500 meanings and 500 sentences changed, you get 1000 meanings (missing 500) and all 500 sentences. The client saves `maxUsn` based on what it received, potentially skipping over the missing 500 meanings forever.

**Fix**: Loop `pullChanges` until every table returns fewer than `max_rows` rows, or change the RPC to use a single global USN cursor across all tables.

---

### 2. BUG: Sentence grave processing doesn't cascade to SRS cards and review logs locally

When a sentence tombstone arrives via pull, only tokens and the sentence itself are deleted:

```ts
// src/db/syncEngine.ts — pullChanges() graves handler
case 'sentence':
  await localDb.sentenceTokens.where('sentenceId').equals(entity_id).delete();
  await localDb.sentences.delete(entity_id);
  break;
```

Compare with the local delete which properly cascades:

```ts
// src/db/localRepo.ts — deleteSentenceById()
const cards = await localDb.srsCards.where('sentenceId').equals(id).toArray();
const cardIds = cards.map((c) => c.id);
if (cardIds.length > 0) {
  await localDb.reviewLogs.where('cardId').anyOf(cardIds).delete();
}
await localDb.srsCards.where('sentenceId').equals(id).delete();
```

Server-side FK cascades delete the related `srs_cards` and `review_logs`, but those cascade deletes don't fire the `bump_sync_meta` trigger (it's `BEFORE INSERT OR UPDATE`, not delete), so no tombstones are created for the cascaded records. Result: **orphaned SRS cards and review logs accumulate in the local DB**, causing phantom cards in the review queue and incorrect stats.

---

### 3. BUG: `startSyncListeners` leaks event listeners

Anonymous functions are passed to `addEventListener`, but `stopSyncListeners` only clears the interval/timer — **never calls `removeEventListener`**:

```ts
// src/db/syncEngine.ts
export function startSyncListeners(): void {
  window.addEventListener('online', () => { ... });
  window.addEventListener('offline', () => { ... });
  // ...
}

export function stopSyncListeners(): void {
  // Only clears periodicInterval and syncTimer
  // Never removes event listeners!
}
```

Each login/logout cycle adds new listeners that never get cleaned up. After several cycles, `runSync()` will fire multiple times per online event.

**Fix**: Store the listener references and remove them in `stopSyncListeners`.

---

### 4. BUG: Outbox push groups by op type, destroying causal ordering

```ts
// src/db/syncEngine.ts — pushOutbox()
const groups = new Map<string, SyncOp[]>();
for (const op of pending) {
  const arr = groups.get(op.op) || [];
  arr.push(op);
  groups.set(op.op, arr);
}
```

Operations are grouped by type, meaning all `ingestBundle` ops execute before any `deleteEntity` ops (or vice versa depending on Map iteration order). If a user creates a sentence then immediately deletes it, the delete could hit the server before the ingest. While the RPCs use `ON CONFLICT DO NOTHING`, this can still create orphaned tombstones or cause confusion.

---

### 5. BUG: Hydration doesn't set `lastUsn` — first sync re-downloads everything

`hydrateLocalDb()` sets `lastHydratedAt` but not `lastUsn`:

```ts
// src/db/hydrate.ts
await localDb.syncMeta.put({
  key: 'lastHydratedAt',
  value: Date.now(),
});
```

After hydration, `pullChanges()` uses `lastUsn = 0` and re-fetches the entire dataset that was just downloaded. For a user with significant data, this doubles the initial load time and bandwidth.

**Fix**: Track the max USN from the hydrated data and save it as `lastUsn`.

---

### 6. BUG: No error handling for hydration failure — user stuck on loading screen forever

In `App.tsx`, the async IIFE has no try/catch around `hydrateLocalDb()`:

```ts
// src/App.tsx
(async () => {
  const hydrated = await isHydrated();
  if (!hydrated) {
    setHydrating(true);
    await hydrateLocalDb();  // If this throws, user is stuck forever
    if (cancelled) return;
    setHydrating(false);
  }
  await loadCedict();
  // ...
```

If the network request fails during hydration (user has a Supabase account but is offline on first login), the promise rejects silently, `setHydrating(false)` never fires, and the user is stuck on "Syncing data..." with no way to recover except refreshing.

---

### 7. SECURITY: RPCs use `security definer` — bypasses RLS

All four RPCs (`pull_changes`, `apply_review_ops`, `apply_ingest_bundle`, `apply_delete_ops`) use `security definer`, which runs them as the function owner (typically superuser), bypassing RLS entirely. While they do check `auth.uid()`, a single auth bug could leak data across users. Additionally, `pull_changes` uses `row_to_json(*)` which returns all columns including `user_id` to the client.

Consider using `security invoker` (the default) and relying on RLS for defense-in-depth, or at minimum exclude `user_id` from the returned JSON.

---

## Medium Severity

### 8. BUG: Partial batch failure marks untried ops as failed

In `pushOutbox`, `ingestBundle` ops are processed sequentially:

```ts
case 'ingestBundle':
  for (const op of ops) await pushIngestBundle(op);
```

But error handling is at the group level:

```ts
succeeded.push(...ops.map((o) => o.id!));
} catch (e) {
  console.error(`Sync push failed for ${opType}:`, e);
  failed.push(...ops.map((o) => o.id!));
}
```

If the 3rd of 5 ingest bundles fails, ops 4 and 5 are never attempted, yet all 5 are marked as failed with incremented attempt counters. After `MAX_ATTEMPTS`, ops that were never actually tried could be permanently marked `failed`.

---

### 9. `deleteAllUserData` creates an outbox storm

If a user has 500 sentences + 1000 meanings + 1 deck, this creates 1501 individual outbox entries:

```ts
// src/db/repo.ts
export async function deleteAllUserData(): Promise<void> {
  const sentences = await local.getAllSentences();
  const meanings = await local.getAllMeanings();
  const decks = await localDb.decks.toArray();
  await local.deleteAllUserData();
  for (const s of sentences) {
    await enqueue({ op: 'deleteEntity', payload: { ... } });
  }
  // ... same for meanings and decks
```

This should be a single "nuke all" RPC call. The server already has `DELETE ... WHERE user_id = uid` which is far more efficient. Also, if the user goes offline after local delete but before the outbox drains, the server data will permanently diverge.

---

### 10. `sync_graves` gets duplicate tombstones

The `ON CONFLICT (id) DO NOTHING` clause in `apply_delete_ops` is ineffective because `id` has a `gen_random_uuid()` default — every insert gets a unique ID, so the conflict never triggers:

```sql
insert into sync_graves (user_id, entity_type, entity_id)
values (uid, etype, eid)
on conflict (id) do nothing;
```

Should use a unique index on `(user_id, entity_type, entity_id)` for proper deduplication.

---

### 11. `ensureDefaultDeck` makes a network call in repo facade — breaks offline

```ts
// src/db/repo.ts
export async function ensureDefaultDeck(): Promise<string> {
  const userId = await getRemoteUserId();  // May call supabase.auth.getUser()
  return local.ensureDefaultDeck(userId);
}
```

`getRemoteUserId()` may call `supabase.auth.getUser()` which requires network. During offline ingestion, this would fail. The user ID should be cached locally during login.

---

### 12. `updateTags` uses direct Supabase write, not an RPC

`pushUpdateTags` bypasses the RPC pattern, doing a raw `.update()`:

```ts
// src/db/syncEngine.ts
async function pushUpdateTags(op: SyncOp): Promise<void> {
  const { id, tags } = op.payload;
  const { error } = await supabase
    .from('sentences')
    .update({ tags })
    .eq('id', id);
```

This lacks idempotency guarantees. If the sentence doesn't exist on the server yet (still in outbox as an ingestBundle), this silently fails. It's also inconsistent with the other sync ops.

---

## Low Severity / Improvements

### 13. Duplicated row mappers across 3 files

`meaningFromRow`, `sentenceFromRow`, etc. exist in `remoteRepo.ts`, `syncEngine.ts`, and are structurally identical. Adding a new field to a schema type requires updates in multiple places. Extract these into a shared `mappers.ts`.

### 14. `SyncIndicator` time display never refreshes

`formatTimeAgo` computes time from `Date.now()` at render time, but the component only re-renders when the sync store changes. "Just now" stays forever until the next sync.

### 15. PWA manifest references icons that may not exist

`vite.config.ts` references `/pwa-192x192.png` and `/pwa-512x512.png` — verify these exist in `public/`.

### 16. `syncStore.setStatus` has confusing `undefined` semantics

```ts
setStatus: (status) => set({ status, errorMessage: status === 'error' ? undefined : null }),
```

Setting `errorMessage: undefined` in a Zustand `set()` call actually sets the field to `undefined`, losing the existing error message. If the intent is to preserve it, this should omit the `errorMessage` key entirely (using a conditional spread or separate logic).

### 17. No `sync_graves` cleanup / retention policy

Tombstones in `sync_graves` accumulate forever. For long-lived accounts, this table will grow unbounded. Consider adding a TTL or periodic cleanup.

### 18. `isHydrated` is true forever once set — no way to force re-hydration

If the local database is corrupted or the schema changes, there's no mechanism to force re-hydration since `lastHydratedAt` persists. The `sync_schema` table exists for forced full-sync detection but is never used client-side.

---

## Architecture Notes (Not Bugs)

- **Global `sync_usn_seq`**: USNs are shared across all users, causing per-user gaps. This works correctly but is unusual — Anki uses per-collection USNs. The tradeoff (simplicity) seems reasonable given the scale.
- **No conflict resolution for most entity types**: Sentences, meanings, etc. use last-write-wins (the pull just overwrites local). Only SRS cards have explicit merge logic (last-answered-wins). This is acceptable for the current single-user-multiple-devices use case.
- **The outbox is persisted in IndexedDB**: Good choice — survives page reloads and browser crashes. Failed ops will retry on next sync cycle.

---

## Summary of Priority Actions

| # | Severity | Issue |
|---|----------|-------|
| 1 | **Critical** | `pullChanges` doesn't paginate — data loss on large syncs |
| 2 | **Critical** | Sentence graves don't cascade to local SRS cards/review logs |
| 3 | **High** | Event listeners leak on each login/logout cycle |
| 4 | **High** | Causal ordering destroyed by grouping outbox ops by type |
| 5 | **High** | Hydration doesn't set `lastUsn` — doubles first sync |
| 6 | **High** | No error handling for hydration failure — infinite loading |
| 7 | **Medium** | `security definer` RPCs bypass RLS |
| 8 | **Medium** | Partial batch failure marks untried ops as failed |
| 9 | **Medium** | `deleteAllUserData` creates N individual outbox ops |
| 10 | **Medium** | Tombstone deduplication is a no-op |
| 11 | **Medium** | `ensureDefaultDeck` breaks offline (network call) |
| 12 | **Medium** | `updateTags` bypasses RPC pattern, no idempotency |

**Recommendation**: Fix issues 1–6 before merging, as they can cause data loss or broken UX in production.
