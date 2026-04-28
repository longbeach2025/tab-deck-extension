#!/usr/bin/env node

import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const gunzip = promisify(zlib.gunzip);

const DEFAULT_INPUT = "supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_BATCH_SLEEP_MS = 300;
const PREVIEW_COUNT = 10;
const REPORT_DIR = "/Users/reclina/Downloads";

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    dryRun: false,
    limit: 0,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    batchSleepMs: DEFAULT_BATCH_SLEEP_MS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--input" && next) {
      args.input = next;
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--limit" && next) {
      args.limit = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--batch-size" && next) {
      args.batchSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--concurrency" && next) {
      args.concurrency = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--batch-sleep-ms" && next) {
      args.batchSleepMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/patch-embeddings-from-backup.js \\",
    "    [--input supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz] [--dry-run] [--limit 20]",
    "",
    "Options:",
    `  --batch-size <n>        default ${DEFAULT_BATCH_SIZE}`,
    `  --concurrency <n>       default ${DEFAULT_CONCURRENCY}`,
    `  --batch-sleep-ms <n>    default ${DEFAULT_BATCH_SLEEP_MS}`,
    "  --dry-run               do not write, only report plan",
    "  --limit <n>             process only first n candidate backup links"
  ].join("\n");
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function mapWithConcurrency(items, worker, concurrency) {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const out = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return out;
}

function hasEmbedding(preprocess) {
  return Array.isArray(preprocess?.embedding) && preprocess.embedding.length > 0;
}

async function readBackupBundle(inputPath) {
  const raw = await fs.readFile(inputPath);
  const text = inputPath.endsWith(".gz") ? (await gunzip(raw)).toString("utf8") : raw.toString("utf8");
  const parsed = JSON.parse(text);
  const links = Array.isArray(parsed?.rows?.links) ? parsed.rows.links : [];
  return {
    links
  };
}

async function fetchExistingLinksByIds(supabase, userId, ids) {
  const result = new Map();
  const slices = chunk(ids, 200);
  for (const slice of slices) {
    const { data, error } = await supabase
      .from("tab_deck_links")
      .select("id,deleted_at,metadata")
      .eq("user_id", userId)
      .in("id", slice);
    if (error) {
      throw new Error(`fetch existing links failed: ${error.message}`);
    }
    for (const row of data || []) {
      result.set(row.id, row);
    }
  }
  return result;
}

async function fetchAllByUser(supabase, table, userId, select = "*") {
  const page = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await supabase.from(table).select(select).eq("user_id", userId).range(from, from + page - 1);
    if (error) {
      throw new Error(`${table} backup fetch failed: ${error.message}`);
    }
    if (!data || data.length === 0) {
      break;
    }
    out.push(...data);
    if (data.length < page) {
      break;
    }
    from += page;
  }
  return out;
}

async function createPrePatchBackupOrThrow(supabase, userId) {
  const stamp = createStamp();
  const backupDir = path.join(REPORT_DIR, `tab-deck-pre-patch-backup-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });

  const [spaces, collections, links] = await Promise.all([
    fetchAllByUser(supabase, "tab_deck_spaces", userId, "*"),
    fetchAllByUser(supabase, "tab_deck_collections", userId, "*"),
    fetchAllByUser(supabase, "tab_deck_links", userId, "*")
  ]);

  await Promise.all([
    fs.writeFile(path.join(backupDir, "tab_deck_spaces.json"), `${JSON.stringify(spaces, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(backupDir, "tab_deck_collections.json"), `${JSON.stringify(collections, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(backupDir, "tab_deck_links.json"), `${JSON.stringify(links, null, 2)}\n`, "utf8")
  ]);

  const manifest = {
    createdAt: new Date().toISOString(),
    userId,
    counts: {
      spaces: spaces.length,
      collections: collections.length,
      links: links.length
    }
  };
  await fs.writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    backupDir,
    manifest
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer.");
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(args.batchSleepMs) || args.batchSleepMs < 0) {
    throw new Error("--batch-sleep-ms must be >= 0.");
  }
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw new Error("--limit must be >= 0.");
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const userId = String(process.env.USER_ID || "975d195f-1f87-40c8-aa96-336ae9fd8a35").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let prePatchBackup = null;
  if (!args.dryRun) {
    prePatchBackup = await createPrePatchBackupOrThrow(supabase, userId);
  }

  const bundle = await readBackupBundle(args.input);
  const backupWithEmb = bundle.links
    .filter((link) => hasEmbedding(link?.metadata?.preprocess))
    .map((link) => ({
      id: link.id,
      title: String(link.title || ""),
      preprocess: link.metadata.preprocess
    }));

  const candidateInput = args.limit > 0 ? backupWithEmb.slice(0, args.limit) : backupWithEmb;
  const ids = candidateInput.map((row) => row.id);
  const existingById = await fetchExistingLinksByIds(supabase, userId, ids);

  const planned = [];
  const skipStats = {
    missing: 0,
    softDeleted: 0,
    hasEmbeddingAlready: 0
  };

  for (const row of candidateInput) {
    const existing = existingById.get(row.id);
    if (!existing) {
      skipStats.missing += 1;
      continue;
    }
    if (existing.deleted_at) {
      skipStats.softDeleted += 1;
      continue;
    }
    if (hasEmbedding(existing?.metadata?.preprocess)) {
      skipStats.hasEmbeddingAlready += 1;
      continue;
    }
    planned.push({
      id: row.id,
      title: row.title,
      backupPreprocess: row.preprocess,
      existingMetadata: existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}
    });
  }

  const summary = {
    mode: args.dryRun ? "dry-run" : "write",
    inputPath: args.input,
    userId,
    backupLinksWithEmbedding: backupWithEmb.length,
    selectedByLimit: candidateInput.length,
    planPatchCount: planned.length,
    skip: skipStats
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    prePatchBackup,
    patched: 0,
    failuresCount: 0,
    failures: []
  };

  const reportPath = path.join(REPORT_DIR, `tab-deck-patch-report-${createStamp()}.json`);

  if (args.dryRun) {
    report.preview = planned.slice(0, PREVIEW_COUNT).map((item) => ({
      id: item.id,
      title: item.title
    }));
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ reportPath }, null, 2));
    return;
  }

  let patched = 0;
  const failures = [];
  const batches = chunk(planned, args.batchSize);
  let nextProgressPatchCount = 100;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    await mapWithConcurrency(
      batch,
      async (item) => {
        try {
          const mergedMetadata = {
            ...item.existingMetadata,
            preprocess: item.backupPreprocess
          };
          const { data, error } = await supabase
            .from("tab_deck_links")
            .update({ metadata: mergedMetadata })
            .eq("user_id", userId)
            .eq("id", item.id)
            .is("deleted_at", null)
            .select("id");
          if (error) {
            throw new Error(error.message);
          }
          if (!data || data.length === 0) {
            throw new Error("no row updated (possibly deleted_at changed or RLS blocked)");
          }
          patched += 1;
        } catch (error) {
          failures.push({
            id: item.id,
            title: item.title,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },
      args.concurrency
    );

    while (patched >= nextProgressPatchCount) {
      console.log(`[progress] patched=${patched}/${planned.length} failures=${failures.length}`);
      nextProgressPatchCount += 100;
    }

    if (batchIndex === batches.length - 1) {
      console.log(
        `[progress] batch ${batchIndex + 1}/${batches.length} patched=${patched} failures=${failures.length} totalPlan=${planned.length}`
      );
    }

    if (batchIndex < batches.length - 1 && args.batchSleepMs > 0) {
      await sleep(args.batchSleepMs);
    }
  }

  report.patched = patched;
  report.failuresCount = failures.length;
  report.failures = failures;
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ reportPath }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
