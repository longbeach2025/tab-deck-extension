# Data Health Check

Tab Deck includes a read-only Supabase health check for early warning before data loss reaches users.

## Commands

```bash
npm run health-check
npm run health-check -- --env dev --machine reclina
npm run health-check -- --env prod --env-file config/prod.env
```

Default target is `dev`. Production must be selected explicitly with `--env prod`.

The script reads credentials from:

- `config/dev-<machine>.env` for dev, unless `--env-file` is passed
- `config/prod.env` for prod, unless `--env-file` is passed
- current shell environment values override file values

Required values:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
USER_ID=... # optional; when omitted, checks all users
```

## Reports

Reports are written to ignored local files:

```text
reports/health/<env>-latest.json
reports/health/<env>-<timestamp>.json
```

Each run compares against the previous `<env>-latest.json` snapshot when present.

## Hard Rules

The script exits non-zero on `ERROR`:

- active spaces exceed 3
- active collections reference missing spaces
- active links reference missing collections
- duplicate active collection groups exist
- active links have empty URLs
- preprocess present count drops from `>0` to `0`
- preprocess non-empty count drops from `>0` to `0`
- embedding ready count decreases
- embedding vector count decreases

The script prints `WARN` but exits zero when there are warnings only:

- active links change by more than 1% versus previous snapshot
- active links have empty titles
- settings rows point to missing active spaces

## Notes

This script is intentionally read-only. It never repairs data, deletes rows, or writes Supabase records.
