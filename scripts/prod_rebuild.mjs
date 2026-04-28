#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const gunzip = promisify(zlib.gunzip);
const PROD_HOST = "nasyehnxazcprqqnsdnv.supabase.co";
const DEFAULT_ENV_FILE = "config/prod.env";
const DEFAULT_BACKUP_DIR = "backups/prod-rebuild";
const DEFAULT_BUNDLE = "supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz";
const DEFAULT_BATCH_SIZE = 200;
const TABLES = {
  settings: "tab_deck_user_settings",
  spaces: "tab_deck_spaces",
  collections: "tab_deck_collections",
  links: "tab_deck_links"
};

function parseArgs(argv) {
  const args = {
    command: argv[0] || "",
    envFile: DEFAULT_ENV_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    bundle: DEFAULT_BUNDLE,
    batchSize: DEFAULT_BATCH_SIZE
  };

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--env-file" && next) {
      args.envFile = next;
      i += 1;
      continue;
    }
    if (token === "--backup-dir" && next) {
      args.backupDir = next;
      i += 1;
      continue;
    }
    if (token === "--bundle" && next) {
      args.bundle = next;
      i += 1;
      continue;
    }
    if (token === "--user-id" && next) {
      args.userId = next;
      i += 1;
      continue;
    }
    if (token === "--confirm" && next) {
      args.confirm = next;
      i += 1;
      continue;
    }
    if (token === "--batch-size" && next) {
      args.batchSize = Number.parseInt(next, 10);
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
    "  npm run prod:backup",
    "  npm run prod:plan",
    "  npm run prod:reset -- --confirm RESET_PROD",
    "  npm run prod:init -- --confirm INIT_PROD",
    "",
    "Options:",
    `  --env-file <path>     Default ${DEFAULT_ENV_FILE}`,
    `  --backup-dir <path>   Default ${DEFAULT_BACKUP_DIR}`,
    `  --bundle <path>       Default ${DEFAULT_BUNDLE}`,
    "  --user-id <uuid>      Overrides USER_ID from env file",
    "  --batch-size <n>      Default 200",
    "",
    "Safety:",
    `  Target host must be ${PROD_HOST}.`,
    "  reset requires --confirm RESET_PROD.",
    "  init requires --confirm INIT_PROD."
  ].join("\n");
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertUuid(text, fieldName) {
  const value = safeText(text);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }
  return value;
}

function parseEnvText(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function loadEnvFile(envFile) {
  const text = await fs.readFile(envFile, "utf8");
  return parseEnvText(text);
}

async function loadRuntime(args) {
  const fileEnv = await loadEnvFile(args.envFile);
  const env = { ...fileEnv, ...process.env };
  const supabaseUrl = safeText(env.SUPABASE_URL);
  const serviceRoleKey = safeText(env.SUPABASE_SERVICE_ROLE_KEY);
  const userId = assertUuid(args.userId || env.USER_ID, "USER_ID");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Checked ${args.envFile}.`);
  }
  const host = new URL(supabaseUrl).host;
  if (host !== PROD_HOST) {
    throw new Error(`Refusing prod rebuild target ${host}. Expected ${PROD_HOST}.`);
  }
  return { supabaseUrl, serviceRoleKey, userId, host };
}

function createSupabase(runtime) {
  return createClient(runtime.supabaseUrl, runtime.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function fetchAllByUser(supabase, table, userId) {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("*").eq("user_id", userId).range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`${table} fetch failed: ${error.message}`);
    }
    if (!data || data.length === 0) {
      break;
    }
    out.push(...data);
    if (data.length < pageSize) {
      break;
    }
  }
  return out;
}

async function fetchCurrentRows(supabase, userId) {
  const [settings, spaces, collections, links] = await Promise.all([
    fetchAllByUser(supabase, TABLES.settings, userId),
    fetchAllByUser(supabase, TABLES.spaces, userId),
    fetchAllByUser(supabase, TABLES.collections, userId),
    fetchAllByUser(supabase, TABLES.links, userId)
  ]);
  return { settings, spaces, collections, links };
}

function isActive(row) {
  return row?.deleted_at == null;
}

function summarizeRows(rows) {
  return {
    settings: rows.settings.length,
    spaces: rows.spaces.length,
    collections: rows.collections.length,
    links: rows.links.length,
    active: {
      spaces: rows.spaces.filter(isActive).length,
      collections: rows.collections.filter(isActive).length,
      links: rows.links.filter(isActive).length
    },
    deleted: {
      spaces: rows.spaces.filter((row) => !isActive(row)).length,
      collections: rows.collections.filter((row) => !isActive(row)).length,
      links: rows.links.filter((row) => !isActive(row)).length
    }
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupProd(supabase, runtime, args) {
  const createdAt = new Date().toISOString();
  const outputDir = path.resolve(args.backupDir, `prod-backup-${timestamp()}`);
  const rows = await fetchCurrentRows(supabase, runtime.userId);
  const manifest = {
    createdAt,
    targetHost: runtime.host,
    userId: runtime.userId,
    counts: summarizeRows(rows),
    files: {
      settings: "tab_deck_user_settings.json",
      spaces: "tab_deck_spaces.json",
      collections: "tab_deck_collections.json",
      links: "tab_deck_links.json"
    }
  };

  await writeJson(path.join(outputDir, manifest.files.settings), rows.settings);
  await writeJson(path.join(outputDir, manifest.files.spaces), rows.spaces);
  await writeJson(path.join(outputDir, manifest.files.collections), rows.collections);
  await writeJson(path.join(outputDir, manifest.files.links), rows.links);
  await writeJson(path.join(outputDir, "manifest.json"), manifest);
  console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
}

async function readMaybeGzip(inputPath) {
  const buffer = await fs.readFile(inputPath);
  if (inputPath.endsWith(".gz")) {
    return (await gunzip(buffer)).toString("utf8");
  }
  return buffer.toString("utf8");
}

async function loadBundle(inputPath) {
  const raw = await readMaybeGzip(inputPath);
  const bundle = JSON.parse(raw);
  if (!bundle?.rows || !Array.isArray(bundle.rows.spaces) || !Array.isArray(bundle.rows.collections) || !Array.isArray(bundle.rows.links)) {
    throw new Error("Invalid init bundle: missing rows.spaces/collections/links arrays.");
  }
  return bundle;
}

async function planProd(supabase, runtime, args) {
  const rows = await fetchCurrentRows(supabase, runtime.userId);
  const bundle = await loadBundle(args.bundle);
  const current = summarizeRows(rows);
  const target = {
    settings: 1,
    spaces: bundle.rows.spaces.length,
    collections: bundle.rows.collections.length,
    links: bundle.rows.links.length,
    active: {
      spaces: bundle.rows.spaces.length,
      collections: bundle.rows.collections.length,
      links: bundle.rows.links.length
    },
    deleted: {
      spaces: 0,
      collections: 0,
      links: 0
    }
  };
  console.log(
    JSON.stringify(
      {
        targetHost: runtime.host,
        userId: runtime.userId,
        mode: "soft reset current user then import bundle",
        bundle: {
          path: args.bundle,
          exportedAt: bundle.meta?.exportedAt || "",
          activeSpaceId: bundle.meta?.activeSpaceId || bundle.rows.spaces[0]?.id || "",
          counts: bundle.meta?.counts || target.active
        },
        current,
        expectedAfterRebuild: target,
        destructiveCommandsRequireConfirm: {
          reset: "RESET_PROD",
          init: "INIT_PROD"
        }
      },
      null,
      2
    )
  );
}

async function softDeleteTable(supabase, table, userId, batchSize) {
  const rows = await fetchAllByUser(supabase, table, userId);
  const activeRows = rows.filter(isActive);
  const now = new Date().toISOString();
  for (const [index, part] of chunk(activeRows, batchSize).entries()) {
    const ids = part.map((row) => row.id);
    const { error } = await supabase.from(table).update({ deleted_at: now, updated_at: now }).eq("user_id", userId).in("id", ids);
    if (error) {
      throw new Error(`${table} soft delete failed on batch ${index + 1}: ${error.message}`);
    }
    console.log(`[reset] ${table} batch ${index + 1} rows=${ids.length}`);
  }
  return activeRows.length;
}

async function resetProd(supabase, runtime, args) {
  if (args.confirm !== "RESET_PROD") {
    throw new Error("Refusing reset without --confirm RESET_PROD.");
  }
  const links = await softDeleteTable(supabase, TABLES.links, runtime.userId, args.batchSize);
  const collections = await softDeleteTable(supabase, TABLES.collections, runtime.userId, args.batchSize);
  const spaces = await softDeleteTable(supabase, TABLES.spaces, runtime.userId, args.batchSize);
  const { error } = await supabase
    .from(TABLES.settings)
    .update({ active_space_id: null, updated_at: new Date().toISOString() })
    .eq("user_id", runtime.userId);
  if (error) {
    throw new Error(`${TABLES.settings} reset failed: ${error.message}`);
  }
  console.log(`[reset] settings active_space_id cleared`);
  console.log(`[done] soft-deleted spaces=${spaces} collections=${collections} links=${links}`);
}

function withUserId(rows, userId) {
  return rows.map((row) => ({
    ...row,
    user_id: userId,
    deleted_at: row.deleted_at ?? null
  }));
}

async function upsertBatches(supabase, table, rows, batchSize) {
  for (const [index, part] of chunk(rows, batchSize).entries()) {
    const { error } = await supabase.from(table).upsert(part, { onConflict: "id" });
    if (error) {
      throw new Error(`${table} upsert failed on batch ${index + 1}: ${error.message}`);
    }
    console.log(`[init] ${table} batch ${index + 1} rows=${part.length}`);
  }
}

async function initProd(supabase, runtime, args) {
  if (args.confirm !== "INIT_PROD") {
    throw new Error("Refusing init without --confirm INIT_PROD.");
  }
  const bundle = await loadBundle(args.bundle);
  const spaces = withUserId(bundle.rows.spaces, runtime.userId);
  const collections = withUserId(bundle.rows.collections, runtime.userId);
  const links = withUserId(bundle.rows.links, runtime.userId);
  await upsertBatches(supabase, TABLES.spaces, spaces, args.batchSize);
  await upsertBatches(supabase, TABLES.collections, collections, args.batchSize);
  await upsertBatches(supabase, TABLES.links, links, args.batchSize);
  const activeSpaceId = bundle.meta?.activeSpaceId || spaces[0]?.id || null;
  const { error } = await supabase.from(TABLES.settings).upsert(
    {
      user_id: runtime.userId,
      active_space_id: activeSpaceId,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) {
    throw new Error(`${TABLES.settings} upsert failed: ${error.message}`);
  }
  console.log(`[init] settings active_space_id=${activeSpaceId}`);
  console.log(`[done] imported spaces=${spaces.length} collections=${collections.length} links=${links.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !["backup", "plan", "reset", "init"].includes(args.command)) {
    console.log(usage());
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer.");
  }
  const runtime = await loadRuntime(args);
  const supabase = createSupabase(runtime);
  if (args.command === "backup") {
    await backupProd(supabase, runtime, args);
    return;
  }
  if (args.command === "plan") {
    await planProd(supabase, runtime, args);
    return;
  }
  if (args.command === "reset") {
    await resetProd(supabase, runtime, args);
    return;
  }
  await initProd(supabase, runtime, args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
