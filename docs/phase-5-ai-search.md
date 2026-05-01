# Phase 5 AI Search Notes

Date: 2026-05-01

## Baseline

- Dev mirror health-check is `ok`.
- Prod read-only health-check is `ok`.
- `test user 2` remains the Phase 5 dataset:
  - 1 active space
  - 245 active collections
  - 3320 active links
  - 3320 preprocess entries
  - 3320 embedding vectors

## Current Search Shape

- `src/app.js` first builds a lexical/filter candidate set with `collectSearchResults()`.
- Ranking starts with `computeSearchScore()`:
  - title match: 8
  - URL match: 5
  - host match: 4
  - collection name: 3
  - collection notes: 2
  - space name: 1
  - local search enhancement terms: 4
  - exact query in title/URL: +12
  - recency score: 0-8
- Vector search now runs as an async semantic supplemental recall step:
  - only when sorting by recent activity
  - only when there is a query/term/filter
  - lexical search still builds the primary result set
  - semantic scoring now evaluates the full active filter-matched corpus, not only the lexical candidate subset
  - top 80 semantic candidates are retained
  - lexical hits remain primary; semantic-only hits are appended as supplemental recall
- Cloud embeddings are fetched by link id if not present locally.
- Cloud sync preserves existing `metadata.preprocess` when local rows lack preprocess.

## Historical Accuracy Risk

The original vector step only reranked lexical candidates and could not recall semantic-only matches from the full 3320-link dataset. If a relevant page was only discoverable through embedding similarity and none of the query terms appeared in title, URL, collection, notes, or preprocess terms, it never reached vector search.

## Full-Corpus Semantic Recall

Full-corpus vector recall is now in implementation. The current design remains a semantic supplemental recall layer, not a replacement for lexical search:

- keep lexical ranking as the primary stable fallback
- retrieve semantic topK from the full active filter-matched corpus
- merge semantic candidates with lexical candidates by id
- preserve explicit user filters as hard constraints
- blend vector score conservatively so exact title/URL/host matches are not displaced by weak semantic matches
- add debug counts for corpus size, vector-scored count, semantic-added count, and elapsed time

Current implementation status in `src/app.js`:

- lexical results are still built first with `collectSearchResults()`
- semantic scoring now runs over `collectSearchCorpusResults()` which reuses the same explicit filters but removes lexical term matching
- lexical hits are reranked conservatively with vector scores
- semantic-only topK hits are appended after lexical hits
- vector state now tracks:
  - `corpusCount`
  - `semanticAddedCount`
  - `orderedResults`

This has passed local code checks but still needs manual UI validation on the active `chenshuo` dev machine before being treated as the new stable Phase 5 checkpoint.

## Baseline Command

```bash
npm run search:baseline
npm run search:baseline -- --query "guard passing bjj"
npm run search:baseline -- --json
npm run search:baseline:assert
npm run search:baseline:assert -- --quiet
```

This reads `supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz` and runs a fixed query set against an app-like lexical/preprocess baseline. Use it before and after search ranking changes.

`npm run search:baseline:assert` checks stable expectations for representative fixed queries. `npm run check` uses the quiet assertion mode so routine checks only print the assertion summary.

## Vector Observability

The UI vector recall label now exposes the key semantic recall counters:

- strategy: `mix`
- topK count
- scored corpus count
- semantic-added count
- elapsed milliseconds when available

Pending state now reports corpus computation rather than only lexical candidate rerank progress.

Manual UI validation showed that the old pure-vector `priority` strategy could over-promote semantically broad Kadena pages and push the exact `Kadena 主网上线` Jinse article down to positions 9/10. Switching to `mix` helped the strategy label, but a vector weight of 12 still pushed the Jinse article below the top 10. The current rerank path uses `mix` with a low vector weight so lexical strength remains the primary ordering signal.

Manual UI validation also showed a second ranking issue when LLM parsing expanded `Kadena 主网上线` to `kadena, 主网上线, mainnet, launch`: English expansion terms over-promoted broad `mainnet accounts` pages. Expansion terms are now downweighted in lexical scoring, and results that cover multiple original user keywords receive an additional coverage bonus.

After the expansion-term weighting fix, manual UI validation for `Kadena 主网上线` passed: the two intended Jinse/TokenGazer results appeared at positions 1 and 2 while vector recall reported `mix Top 80 (110/110 scored, ~9.7s)`.

Manual UI validation also showed that reloading the packaged extension can take 50 seconds to 3-4 minutes before the full dev mirror data area appears. This is tracked as a separate performance observation from search ranking; likely causes include loading the 3320-link cloud deck and large embedded preprocess metadata. One concrete cause was identified after removing the temporary sync lock: startup could merge local+remote decks and push the full 3320-link deck back to Supabase. Startup now accepts the remote deck without pushing when the remote deck is at least as fresh as the local cache.

## Manual UI Check

Build and load the extension with a temporary Chrome profile:

```bash
npm run package
open -na "Google Chrome" --args --user-data-dir=/tmp/tabdeck-phase5-chrome --load-extension=/Users/reclina/tab-deck-extension/dist/unpacked --no-first-run --new-window chrome://newtab/
```

Use dev `test user 2` for UI validation. Suggested queries:

- `twitter 零下二度`
- `BT 中途岛`
- `Kadena 主网上线`
- `Coinmetro withdrawal times`
- `supabase sync error`

Expected behavior:

- fixed lexical queries should match the baseline top results
- `supabase sync error` should be re-tested after LLM + embedding config is present because semantic supplemental recall is no longer deferred in code
- vector recall label should show scored corpus count, semantic-added count, and elapsed time when embedding config is present
- vector recall should report `mix`, not `priority`

Note: `dist/unpacked` is generated by `npm run package`. Local private cloud config files are intentionally ignored and are not copied by the public package script.

## Validation Log

Latest local checks completed:

- `npm run search:baseline`
- `npm run search:baseline:assert -- --quiet`
- `npm run check`
- `npm run build`
- `npm run package`
- dev mirror health-check for `test user 2`: `ok`

Latest code-state note:

- full-corpus semantic supplemental recall has been implemented locally in `src/app.js`
- this code path has passed local `npm run check`
- it still requires manual UI validation on `chenshuo` before checkpoint/commit

The generated `dist/`, `reports/`, local config files, backups, and `supabase/init/` remain git-ignored.

## Console Notes

- Removed the temporary `[sync-lock] pushDeckToCloud skipped because SYNC_LOCKED=true` write lock. Existing environment guards still prevent unpacked dev builds from connecting to prod and packaged prod builds from connecting to dev.
- `[sync-protection] preserving cloud preprocess for link ...` used to log once per preserved link and could flood the extension console during large cloud writes. It now logs one aggregated summary with count and sample ids.
- Browser console messages about remote fonts, remote scripts blocked by extension CSP, and unused preloads are currently classified as low-priority console noise from saved/linked web resources unless they break visible Tab Deck UI behavior.

## Initial Baseline Findings

- Strong exact-topic examples:
  - `肥厚型心肌病` returns 4 highly relevant medical pages.
  - `胡塞武装 红海` returns the expected NYTimes page.
  - `passive income mining infrastructure` ranks the intended Medium article first.
- Noisy examples:
  - Fixed: `BT 中途岛` was dominated by Bitcoin results because short token `bt` matched `bitcoin`, `wbtc`, `tbtc`, and related text. Short alphanumeric tokens now require token equality; the query now ranks the intended Midway movie pages first.
  - Fixed: `Kadena 主网上线` ranked `Kadenai Marketplace` before the intended Kadena article because partial substring scoring treated `kadena` broadly. English/digit terms now require token-boundary matches, and the intended article ranks first.
  - Fixed: `Coinmetro withdrawal times` ranked the intended help page first, but unrelated NYTimes content appeared in top 5 due broad `times` matching. Token-boundary matching removes that false positive.
- Alias/filter issue:
  - Fixed: `twitter 零下二度` previously applied `host=x.com`; older `twitter.com` links were excluded. Host aliases can now map to multiple domains, and this query ranks the intended profile first.
- Empty-result example:
  - `supabase sync error` returns 0 because host alias filtering requires `supabase.com` and no active result also satisfies the expanded sync/error terms.

## Next TODO

1. Manually validate the new semantic supplemental recall path on `chenshuo` with the active Phase 5 profile.
2. Verify whether `supabase sync error` now surfaces useful semantic-only matches when embedding config is present.
3. Decide whether semantic-only hits should remain appended after lexical hits or be interleaved more aggressively.
4. After UI validation, re-run `npm run search:baseline`, `npm run check`, and dev health-check, then checkpoint/commit.
5. Profile startup/cloud deck load time for the 3320-link dev mirror as the next independent performance task.
