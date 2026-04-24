# v0.2.0-alpha.27 Release Checklist

## Scope (Keep)

- Public/private separation:
  - Ignore private init data path (`supabase/init/`).
  - Keep private import entry in UI (local file only).
- Private init import flow:
  - Account-gated entry visibility.
  - Local `.json/.json.gz` bundle import into current signed-in Supabase user.
- Offline data pipeline scripts:
  - Toby preprocess, embedding generation, preprocessed import.
  - Init bundle export/import scripts.
- Search pipeline:
  - Structured filtering first.
  - Vector recall integration with adaptive strategy (`priority` for small candidate sets, `mix` for large sets).

## Scope (Do Not Publish)

- Any private init bundle artifacts (`supabase/init/**`).
- Any personal/private source data from Toby exports.
- Secrets or keys.

## Validation Checklist

1. Static checks
- `npm run check` passes.
- `node --check` passes for new/updated scripts.

2. Packaging
- `npm run package` completes.
- Output zip exists in `dist/`.
- `manifest.json` and UI version label are `0.2.27` / `v0.2.0-alpha.27`.

3. Privacy guardrails
- `git status --short` shows no tracked init data files.
- `.gitignore` includes `supabase/init/`.

4. Functional spot checks
- Sign in flow still works.
- Private init button only appears for authorized account.
- Importing a valid init bundle from local file succeeds.
- Search still returns results with vector meta label and fallback behavior.

## Release Steps

1. Commit selected `.27` changes.
2. Create tag `v0.2.0-alpha.27`.
3. Push `main` and tag.
4. Create GitHub release and attach package zip.
