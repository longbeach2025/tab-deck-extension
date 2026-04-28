# Production Rebuild

Phase 4 rebuilds production data from a known-good init bundle after taking a local backup.

The current trusted baseline is:

```text
supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz
```

Baseline contents:

- 1 active space
- 245 active collections
- 3320 active links
- 3320 links with non-empty `metadata.preprocess`
- 3320 links with ready 1024-dimensional embeddings

## Safety Rules

- `prod:backup` and `prod:plan` are read-only against Supabase.
- `prod:reset` and `prod:init` write to production and require explicit confirmation strings.
- The script refuses to run unless `SUPABASE_URL` points to `nasyehnxazcprqqnsdnv.supabase.co`.
- Production credentials are read from ignored `config/prod.env` by default.
- Backups are written to ignored `backups/prod-rebuild/`.

`config/prod.env` must contain:

```bash
SUPABASE_URL=https://nasyehnxazcprqqnsdnv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
USER_ID=...
```

## Commands

Preview the rebuild:

```bash
npm run prod:plan
```

Back up current production rows for the configured user:

```bash
npm run prod:backup
```

Soft-delete current production rows for the configured user:

```bash
npm run prod:reset -- --confirm RESET_PROD
```

Import the trusted baseline bundle:

```bash
npm run prod:init -- --confirm INIT_PROD
```

Verify after rebuild:

```bash
npm run health-check -- --env prod --env-file config/prod.env
```

## Intended Sequence

1. `npm run prod:plan`
2. `npm run prod:backup`
3. Review backup manifest.
4. `npm run prod:reset -- --confirm RESET_PROD`
5. `npm run prod:init -- --confirm INIT_PROD`
6. `npm run health-check -- --env prod --env-file config/prod.env`

Do not run reset/init without an explicit go-ahead.
