# Tab Deck Sync 21000 Incident Report

Date: 2026-05-02 to 2026-05-03
Environment: dev Supabase project `fdqxmqyngpjmsayvcxeu`, user `chens_dev_2@luex.in`
User ID: `bf28d625-2bb2-40ca-8122-49cd76c6befe`

## Executive Summary

Clicking `Sync now` on the MacBook Chrome profile produced a Supabase error:

```text
code: 21000
message: ON CONFLICT DO UPDATE command cannot affect row a second time
hint: Ensure that no rows proposed for insertion within the same command have duplicate constrained values.
```

The direct cause was a polluted local `chrome.storage.local.tabDeckData` deck. The local deck contained duplicate `link.id` values inside `collection.items`; when the deck was pushed, the cloud upsert payload contained the same constrained `id` more than once, causing PostgreSQL/Supabase to reject the statement with `21000`.

The incident was not caused by Phase 5 search ranking itself. Phase 5 search/UI activity exposed the polluted local deck because UI actions, background capture, and sync paths call whole-deck save/sync functions. The search code was primarily read-only, but the surrounding save/sync system allowed polluted local state to propagate toward cloud sync.

The incident was recovered successfully:

```json
{
  "localTotalItems": 3320,
  "localUniqueIds": 3320,
  "localDuplicateGroups": 0,
  "cloudActiveLinks": 3320,
  "cloudSoftDeletedLinks": 0,
  "cloudEmbeddingReady1024": 3320,
  "syncNow": "success",
  "pendingLocalChanges": "No"
}
```

During recovery, two temporary safety locks were introduced:

- `SYNC_LOCKED`: temporarily blocked cloud push while local data was still polluted.
- `AUTO_CAPTURE_LOCKED`: blocked background auto-save capture and cleared the `tabDeckAutoSave` alarm during recovery.

After local and cloud recovery, `SYNC_LOCKED` was set back to `false` for manual sync validation. `AUTO_CAPTURE_LOCKED` remains `true` because the auto-save design needs a separate follow-up fix: auto-save must be decoupled from the `saveDeck()` cloud sync path.

## Data Model Context

`Toby Imported (Preprocessed)` is a **space**, not a collection.

It was created from the Toby export/import pipeline during Phase 4 and contains:

- 1 space: `Toby Imported (Preprocessed)`
- 245 imported collections
- 3320 imported links
- 3320 links with preprocess/embedding data ready in cloud

Account context:

- `chens@luex.in`: production user, not affected.
- `chens_dev@luex.in`: dev user with small hand-built test data, not the main incident target.
- `chens_dev_2@luex.in`: dev user used for Phase 5 large-corpus search validation; affected by this incident.

Clean source of truth for the large corpus:

```text
supabase/init/alpha27/tab-deck-alpha27-init-bundle.json
```

Clean init bundle properties:

```json
{
  "bundleLinks": 3320,
  "bundleCollections": 245,
  "duplicateIds": 0,
  "duplicateCollectionUrls": 0
}
```

## Timeline

### 2026-05-01: Sync now failed with 21000

Observed in Status Center:

```text
Cloud sync failed; saved locally.
code: 21000;
message: ON CONFLICT DO UPDATE command cannot affect row a second time;
hint: Ensure that no rows proposed for insertion within the same command have duplicate constrained values.
```

Initial local diagnosis found:

```text
duplicate_link_id_count = 47
```

The first duplicate sample showed exact duplicate JSON objects in the same collection, often adjacent at item indexes `4,5`.

### 2026-05-02: Clean bundle and cloud were checked

The clean init bundle was verified to have no duplicate link IDs.

Cloud active rows were verified to have no duplicate active IDs. The 47 locally duplicated IDs were all still active in cloud.

Cloud had 47 different clean-bundle IDs soft-deleted at one timestamp:

```text
2026-05-01T16:03:23.822+00:00
```

This established the first incident mechanism:

1. Local deck was missing 47 clean IDs.
2. `markDeletedRows` interpreted those missing local IDs as deletions and soft-deleted them in cloud.
3. The same local payload also contained 47 duplicate link IDs.
4. `safeUpsertLinks` then failed with `21000`.

### 2026-05-02: Recovery locks added

Temporary cloud push lock:

```text
944441f fix(sync): temporarily lock cloud push during 21000 recovery
```

Background auto-capture lock:

```text
f7381cb fix(sync): lock background auto capture during recovery
```

After pulling/reloading on MacBook, DevTools confirmed:

```text
[capture-lock] Auto-save alarm cleared because AUTO_CAPTURE_LOCKED=true.
[capture-lock] captureTabsSilently skipped because AUTO_CAPTURE_LOCKED=true.
ALARMS = []
```

### 2026-05-02 to 2026-05-03: Local state drift was discovered

After the first DRY_RUN repair script was generated for the original `47 duplicate / 47 missing` state, the script later refused to run because local state had changed:

```json
{
  "totalItems": 3273,
  "uniqueIds": 3237,
  "duplicateGroups": 36,
  "duplicateExtraCount": 36,
  "missingExpectedIds": 47
}
```

A fresh local export was taken:

```text
backups/sync-21000-incident/local-deck-current-locked-2026-05-02T15-59-18.248Z.json
```

Current locked local deck comparison against clean bundle showed:

```json
{
  "localTotalItems": 3273,
  "localUniqueIds": 3237,
  "localDuplicateGroups": 36,
  "localDuplicateExtraCount": 36,
  "bundleLinks": 3320,
  "missingFromLocalCount": 83,
  "extraLocalIdsCount": 0,
  "extraCollections": [
    {
      "name": "Auto Saved",
      "items": 0
    }
  ]
}
```

Important relationship:

```text
3320 clean links - 83 missing links + 36 duplicate extras = 3273 local items
```

The original 47 missing IDs were still missing. An additional 36 clean IDs were also missing, matching the 36 current duplicate extras.

This proved the local deck had drifted again during recovery attempts/reloads before the background auto-save lock was active.

### 2026-05-03: Current-state repair script was generated and dry-run validated

Generated script:

```text
backups/sync-21000-incident/local-repair-console-script.current-locked.DRY_RUN.js
```

The script was generated from:

- Current locked local deck export
- Clean init bundle

DRY_RUN result:

```text
[21000-repair-current] removed duplicate extras = 36
[21000-repair-current] added missing links = 83
[21000-repair-current] missing target collections = 0
[21000-repair-current] after = totalItems 3320, uniqueIds 3320, duplicateExtraCount 0
[21000-repair-current] DRY_RUN=true; no chrome.storage.local write performed.
```

### 2026-05-03: Cloud status of the 83 missing local IDs was checked

Cloud read-only query for the 83 locally missing IDs:

```json
{
  "missingIdsChecked": 83,
  "rowsFoundInCloud": 83,
  "rowsNotFoundInCloud": 0,
  "deletedAtDistribution": {
    "2026-05-01T16:03:23.822+00:00": 47,
    "ACTIVE_NULL": 36
  },
  "activeCount": 36,
  "softDeletedCount": 47
}
```

Meaning:

- 47 missing local IDs were the cloud rows soft-deleted by the failed sync.
- 36 missing local IDs were still active in cloud; they were only missing locally.

### 2026-05-03: Local repair was executed

The current-state repair script was run with `DRY_RUN=false` in MacBook Chrome DevTools.

Write result:

```text
[21000-repair-current] chrome.storage.local.tabDeckData repaired successfully.
```

Post-local-repair verification:

```json
{
  "updatedAt": "2026-05-02T13:46:45.925Z",
  "spaces": 1,
  "collections": 246,
  "totalItems": 3320,
  "uniqueIds": 3320,
  "duplicateGroups": 0,
  "duplicateExtraCount": 0
}
```

The local deck still has 246 collections because it includes an empty `Auto Saved` collection. That empty collection is not a link duplication problem and was not removed during this repair.

### 2026-05-03: Cloud backup and restore were performed

Cloud backup path:

```text
backups/sync-21000-incident/cloud-dev2-before-restore-2026-05-02T16-25-12.197Z/
```

Backup summary:

```json
{
  "settings": { "rows": 1, "active": 1, "softDeleted": 0 },
  "spaces": { "rows": 1, "active": 1, "softDeleted": 0 },
  "collections": { "rows": 246, "active": 246, "softDeleted": 0 },
  "links": { "rows": 3320, "active": 3273, "softDeleted": 47 }
}
```

Cloud restore updated only the 47 rows with:

```text
deleted_at = 2026-05-01T16:03:23.822+00:00
```

Restore verification:

```json
{
  "updatedRows": 47,
  "activeLinks": 3320,
  "softDeletedLinks": 0,
  "activeRowsFetched": 3320,
  "duplicateActiveIds": 0,
  "embeddingReady1024": 3320
}
```

### 2026-05-03: Manual cloud sync was unlocked and verified

Cloud push was unlocked while background auto-capture stayed locked:

```text
ae81a93 fix(sync): unlock manual cloud sync after recovery
```

Final Status Center verification:

```text
Synced with Supabase. (00:30:48)
Sync status: Supabase cloud sync is active.
Signed in as: chens_dev_2@luex.in
Last synced: 2026/5/3 00:30:48
Pending local changes: No
```

## Technical Evidence

### Local duplicate shape

Duplicates were exact duplicate JSON objects in the same collection:

```json
{
  "sameCollection": true,
  "sameUrl": true,
  "exactSameJson": true
}
```

Most duplicates were adjacent at item indexes `4,5`; a small number were `4,6` or similar.

The duplicate IDs were valid clean-bundle IDs, not random new IDs. Therefore the problem was not invalid ID generation. It was local array corruption/replacement: one valid clean link was duplicated while another valid clean link disappeared.

### Clean bundle was not polluted

The clean init bundle contained:

```json
{
  "totalLinks": 3320,
  "duplicateIds": 0,
  "duplicateCollectionUrls": 0
}
```

Therefore the Phase 4 source bundle was not the source of duplicate IDs.

### Cloud was not polluted with duplicate active rows

Cloud active rows had:

```json
{
  "duplicateSpaceIdCount": 0,
  "duplicateCollectionIdCount": 0,
  "duplicateLinkIdCount": 0,
  "duplicateCollectionUrlCount": 0
}
```

The damaged cloud state was soft deletion, not duplicate insertion.

### `saveDeck` and `pushDeckToCloud` explain the half-failed state

`saveDeck(deck)` sequence:

1. Normalize deck.
2. Write local deck.
3. If cloud is configured, call `pushDeckToCloud(normalized, ...)`.
4. If cloud push fails, queue pending cloud deck.

`pushDeckToCloud` sequence:

1. `flattenDeck(deck, user.id, now)`
2. `markDeletedRows(...)`
3. settings upsert
4. spaces upsert
5. collections upsert
6. `safeUpsertLinks(...)`

The order matters:

- `markDeletedRows` ran before the failing link upsert.
- Therefore 47 cloud rows were soft-deleted before `safeUpsertLinks` failed with `21000`.

### `flattenDeck` did not dedupe links

`flattenDeck` included every item in every `collection.items` array. If local deck had duplicate `link.id`, duplicate rows entered the upsert payload.

This is why Supabase raised `21000`.

### `normalizeDeck` preserved duplicates

`normalizeDeck` filtered invalid items and normalized fields, but did not dedupe `collection.items` by link ID. Therefore duplicate local items survived normalization.

### `mergeItems` was not the likely source

`mergeCollections` uses `mergeItems(localCollection.items, remoteCollection.items)`, and `mergeItems` keys by:

```js
const key = item.url || item.id;
```

Because the duplicate local objects had identical URLs in the same collection, this merge path should collapse them, not create exact adjacent duplicates. The exact origin of the local corruption remains unconfirmed.

### Phase 5 search was read-only

The dual search path reads deck items and ranks results. It does not write `collection.items`.

Search result actions can trigger save paths such as updating opened/modified state, but that would expose an already polluted deck rather than directly creating the duplicate/missing shape.

### Removed preprocess UI was not the source

The removed preprocess/search enhancement code wrote to:

- `tabDeckSearchEnhancementIndex`
- `tabDeckSearchEnhancementMeta`

It did not mutate `tabDeckData.collection.items`.

## Auto-save Design Finding

The incident exposed a design flaw in `tabDeckAutoSave`.

The product goal is valid: automatically capture current browser tabs into an `Auto Saved` collection so users do not lose working context.

The design flaw is that background auto-save uses the same whole-deck `saveDeck()` path as deliberate user edits. That means a background boot/alarm capture can indirectly trigger cloud sync behavior for the entire deck.

Relevant automatic triggers in `src/background.js`:

- `boot()`
- `onInstalled`
- `onStartup`
- `chrome.alarms.onAlarm`
- `chrome.storage.onChanged` for auto-save config

During recovery, MacBook DevTools showed:

```json
{
  "autoSaveMeta": {
    "lastCapturedAt": "2026-05-02T13:42:52.211Z",
    "lastReason": "boot"
  }
}
```

And the alarm existed:

```json
[
  {
    "name": "tabDeckAutoSave",
    "periodInMinutes": 3
  }
]
```

This does not prove auto-save created the original duplicate items. But it proves auto-save was an active background writer during the incident window and could repeatedly call `saveDeck()` while local data was polluted.

Precise assessment:

- Auto-save was not proven to be the original pollution source.
- Auto-save was a credible trigger/amplifier because it could write local deck and trigger sync paths automatically.
- The recovery period drift from `47 duplicate` to `36 duplicate` happened before `AUTO_CAPTURE_LOCKED` was active, consistent with an uncontrolled background writer or reload-time deck mutation.

Design debt to fix separately:

`auto-save` should be decoupled from `saveDeck()` / cloud sync. Background capture should not have the authority to push the entire deck to cloud.

Minimum future design constraints:

- Auto-save should only mutate the `Auto Saved` collection.
- Auto-save should not trigger cloud push directly.
- Auto-save should run invariant checks before writing local deck.
- If local deck has duplicate link IDs, auto-save should abort and surface a diagnostic.
- Manual `Sync now` should be the controlled cloud boundary during recovery/diagnostic states.

## Recovery Artifacts

Local backups and scripts:

```text
backups/sync-21000-incident/local-deck-current-locked-2026-05-02T15-59-18.248Z.json
backups/sync-21000-incident/local-repair-console-script.DRY_RUN.js
backups/sync-21000-incident/local-repair-console-script.current-locked.DRY_RUN.js
```

Cloud backup:

```text
backups/sync-21000-incident/cloud-dev2-before-restore-2026-05-02T16-25-12.197Z/
```

Safety commits:

```text
944441f fix(sync): temporarily lock cloud push during 21000 recovery
f7381cb fix(sync): lock background auto capture during recovery
ae81a93 fix(sync): unlock manual cloud sync after recovery
```

Current safety state after recovery:

```text
src/cloud.js       SYNC_LOCKED = false
src/background.js  AUTO_CAPTURE_LOCKED = true
```

## Final Verified State

MacBook local deck after repair:

```json
{
  "spaces": 1,
  "collections": 246,
  "totalItems": 3320,
  "uniqueIds": 3320,
  "duplicateGroups": 0,
  "duplicateExtraCount": 0
}
```

Cloud after restore:

```json
{
  "activeLinks": 3320,
  "softDeletedLinks": 0,
  "duplicateActiveIds": 0,
  "embeddingReady1024": 3320
}
```

Status Center after manual sync:

```text
Synced with Supabase. (00:30:48)
Sync status: Supabase cloud sync is active.
Signed in as: chens_dev_2@luex.in
Pending local changes: No
```

## Remaining Open Questions

The exact original source of local deck corruption is still unconfirmed.

Known facts:

- It was not in the clean init bundle.
- It was not present as duplicate active rows in cloud.
- It existed in MacBook local `chrome.storage.local.tabDeckData`.
- The local shape was not random: duplicate valid clean links replaced missing valid clean links.
- The drift changed again before background auto-save was locked.

Candidate areas for later investigation:

- Local init/hydration code that writes directly to `chrome.storage.local`.
- Chrome profile persistence across unpacked extension reloads.
- Any reload-time or boot-time code that loads a cloud/local snapshot and rewrites the deck.
- Auto-save interaction with whole-deck save/sync.

These questions do not block the completed recovery, but they must be addressed before re-enabling auto-save.

## Follow-up Required

Do not re-enable `AUTO_CAPTURE_LOCKED=false` until auto-save is redesigned.

Separate design fix required:

```text
Decouple background auto-save from saveDeck() / cloud sync.
```

This should be implemented as its own task, not mixed into incident recovery.
