# Tab Deck Phase 1 / 2 / 4 Work Report

Date: 2026-04-28
Repo: `/Users/reclina/tab-deck-extension`

This report is meant to let us resume Phase 5 quickly without rereading the full chat history.

## Current State

- `main` is clean and pushed to `origin/main`.
- Current HEAD at the time of writing: `cf0283f fix(prod): soft-delete rows without partial upsert`.
- Production data has been rebuilt from the trusted alpha27 init bundle.
- Dev has two separate users:
  - `test user 1`: small 30-link seed dataset for UI and flow checks.
  - `test user 2`: 3320-link prod mirror for AI Search and embedding work.

## Phase 1: Development / Production Physical Isolation

Goal:

- Keep dev and prod physically separated.
- Prevent dev Chrome from ever connecting to prod Supabase.
- Preserve a small seed dataset for fast UI testing.

What was implemented:

- Dev Supabase project created manually:
  - `tab-deck-dev-reclina`
  - URL host: `fdqxmqyngpjmsayvcxeu.supabase.co`
- Local dev config files created and ignored:
  - `config/cloud-config.dev-reclina.json`
  - `config/dev-reclina.env`
- Git ignore rules added for:
  - `config/cloud-config.dev-*.json`
  - `config/cloud-config.prod.json`
  - `config/machine-unbind.json`
  - `config/*.env`
- Machine binding UI and storage path used by the extension:
  - `tabDeckMachineBinding`
  - `selected_machine`
  - `chrome_profile_path`

Key code changes:

- Build guard and cloud config loader work in `src/cloud.js`.
- Machine binding UI gate lives in `src/app.js`.
- `readPackagedJson()` uses `chrome.runtime.getURL(...)` and `fetch(...)`.
- `validateCloudConfig()` now refuses mismatched environments/machines.
- `validateSupabaseUrl()` now enforces host allowlists.

Important commits:

- `ad37134 feat(env): add dev/prod isolation with per-machine binding`
- `7331777 fix(cloud): enforce Supabase host build guard`
- `cf0283f fix(prod): soft-delete rows without partial upsert`

Validation done:

- Dev Chrome build guard verified by forcing dev config to prod URL.
- `ensureCloudEnvironment()` threw the expected build-guard error.
- No requests were sent to production during the final verification.
- Dev `pending local changes: No` was confirmed in the UI.

Phase 1 output artifacts:

- Dev seed fixture:
  - `fixtures/dev-seed-data.json`
- Dev seed import/verification:
  - `npm run dev:seed` succeeded
  - Dev counts for `test user 1`: 1 space, 3 collections, 30 links

## Phase 2: Data Health Monitoring

Goal:

- Detect data loss before users notice it.
- Provide a read-only early warning system for dev and prod.
- Track snapshot deltas and trigger clear alarms on dangerous drops.

What was implemented:

- `scripts/health_check.mjs`
- `npm run health-check`
- `docs/health-check.md`
- `reports/health/` added to `.gitignore`
- `npm run check` now includes the health-check script syntax check

Health rules implemented:

- `active spaces > 3` is an ERROR.
- orphan collections are an ERROR.
- orphan links are an ERROR.
- duplicate active collection groups are an ERROR.
- empty link URLs are an ERROR.
- empty link titles are a WARN.
- `preprocess present` dropping from `>0` to `0` is an ERROR.
- `preprocess non-empty` dropping from `>0` to `0` is an ERROR.
- embedding ready/vector counts decreasing is an ERROR.
- active links changing by more than 1% between snapshots is a WARN.

Report format:

- JSON report written locally to `reports/health/<env>-latest.json`
- Timestamped snapshot also written locally
- Terminal summary includes:
  - totals
  - active counts
  - preprocess counts
  - embedding counts
  - active space breakdown
  - duplicate collection details

Important commits:

- `4d7c059 feat(health): add Supabase data health check`
- `6acdb9a feat(health): include space breakdown in reports`

Validation done:

- Dev health-check on `test user 1` passed.
- Dev health-check on `test user 2` passed after mirror import.
- Prod health-check initially exposed the real production problem:
  - active spaces were 11
  - duplicate collections existed
  - preprocess/embedding had been lost in the active data path
- After Phase 4 rebuild, prod health-check returned `ok` for the restored baseline.

Useful report files:

- `reports/health/prod-latest.json`
- `reports/health/user2/dev-latest.json`

## Phase 4: Production Cleanup + Rebuild

Goal:

- Preserve what is useful.
- Back up the current production state.
- Rebuild production from the trusted alpha27 baseline.
- Restore the 3320-link embedding set so AI Search works again.

Trusted baseline used:

- `supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz`
- Bundle contents:
  - 1 active space
  - 245 active collections
  - 3320 active links
  - 3320 preprocess entries
  - 3320 ready embeddings
  - 1024-dimensional embeddings

Baseline provenance:

- Exported at: `2026-04-24T05:46:37.602Z`
- Source user: `975d195f-1f87-40c8-aa96-336ae9fd8a35`
- Gzip verified with `gzip -t`

Production backup work:

- Read-only backup command added:
  - `npm run prod:backup`
- Local backup directory:
  - `backups/prod-rebuild/`
- Backup files are ignored by git.

Current latest backup:

- `backups/prod-rebuild/prod-backup-2026-04-28T09-21-11-235Z`
- Counts captured:
  - settings: 1
  - spaces: 17
  - collections: 523
  - links: 6916
  - active spaces: 1 after rebuild
  - active collections: 245 after rebuild
  - active links: 3320 after rebuild

Production rebuild workflow added:

- `scripts/prod_rebuild.mjs`
- `npm run prod:plan`
- `npm run prod:backup`
- `npm run prod:reset`
- `npm run prod:init`
- `docs/prod-rebuild.md`

Safety gates:

- Target host must be `nasyehnxazcprqqnsdnv.supabase.co`.
- `prod:reset` requires `--confirm RESET_PROD`.
- `prod:init` requires `--confirm INIT_PROD`.
- `prod:backup` and `prod:plan` are read-only.
- Reset uses soft delete, not hard delete.

Production issue encountered and fixed:

- Initial reset implementation used partial `upsert` and failed because `collection_id` is non-null.
- Fix changed reset to:
  - `update({ deleted_at, updated_at }).eq("user_id", userId).in("id", ids)`

Important commits:

- `3d9828d feat(prod): add protected rebuild workflow`
- `cf0283f fix(prod): soft-delete rows without partial upsert`

Phase 4 execution result:

- `prod:backup` succeeded.
- `prod:reset` succeeded after the fix.
- `prod:init` succeeded from the alpha27 bundle.
- Final prod health-check returned `ok`.

Final restored prod status:

```text
active spaces: 1
active collections: 245
active links: 3320
preprocess present: 3320
preprocess nonEmpty: 3320
embeddingReady: 3320
embeddingVector: 3320
```

## Dev Mirror For Phase 5

Why this matters:

- Phase 5 is AI Search optimization.
- A 3320-link mirror in dev is much better than only using the 30-link seed.
- We now have both small and large dev datasets.

Dev users:

- `test user 1`
  - current small seed
  - good for UI and workflow regression
- `test user 2`
  - email: `chens_dev_2@luex.in`
  - user_id: `bf28d625-2bb2-40ca-8122-49cd76c6befe`
  - imported prod mirror bundle

Dev mirror result for `test user 2`:

- 1 space
- 245 collections
- 3320 links
- 3320 preprocess entries
- 3320 embeddings
- health-check status: `ok`

Separate report path:

- `reports/health/user2/dev-latest.json`

## Useful Commands

```bash
npm run health-check -- --env dev --machine reclina
npm run health-check -- --env dev --machine reclina --user-id bf28d625-2bb2-40ca-8122-49cd76c6befe --report-dir reports/health/user2
npm run health-check -- --env prod --env-file config/prod.env
npm run prod:plan
npm run prod:backup
```

## Key Files

- [src/cloud.js](/Users/reclina/tab-deck-extension/src/cloud.js)
- [src/app.js](/Users/reclina/tab-deck-extension/src/app.js)
- [scripts/health_check.mjs](/Users/reclina/tab-deck-extension/scripts/health_check.mjs)
- [scripts/prod_rebuild.mjs](/Users/reclina/tab-deck-extension/scripts/prod_rebuild.mjs)
- [docs/health-check.md](/Users/reclina/tab-deck-extension/docs/health-check.md)
- [docs/prod-rebuild.md](/Users/reclina/tab-deck-extension/docs/prod-rebuild.md)

## Resume Point For Phase 5

- Keep `test user 1` untouched.
- Use `test user 2` for AI Search tuning and performance checks.
- Start by running health-check against `test user 2` and then iterate on embedding/search behavior.
- The prod baseline is now stable and backed up, so Phase 5 can focus on AI Search without reopening the previous data-loss problem.
