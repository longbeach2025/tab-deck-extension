#!/usr/bin/env node

import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    setActiveSpace: true,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--input" && next) {
      args.input = next;
      i += 1;
      continue;
    }
    if (token === "--batch-size" && next) {
      args.batchSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--user-id" && next) {
      args.userId = next;
      i += 1;
      continue;
    }
    if (token === "--no-set-active-space") {
      args.setActiveSpace = false;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
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
    "  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import_preprocessed_to_supabase.mjs \\",
    "    --input /path/to/toby-preprocessed.json --user-id <auth_user_uuid> [--batch-size 200]",
    "",
    "Options:",
    "  --no-set-active-space    Do not update active_space_id in user settings",
    "  --dry-run                Validate input and print counts only"
  ].join("\n");
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

function assertUuid(text, fieldName) {
  const value = safeText(text);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }
  return value;
}

function assertBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Invalid preprocessed bundle JSON.");
  }
  if (!bundle.rows || !Array.isArray(bundle.rows.spaces) || !Array.isArray(bundle.rows.collections) || !Array.isArray(bundle.rows.links)) {
    throw new Error("Bundle rows are missing (spaces/collections/links).");
  }
  if (bundle.rows.spaces.length === 0) {
    throw new Error("Bundle has no spaces to import.");
  }
}

function withUserId(rows, userId) {
  return rows.map((row) => ({
    ...row,
    user_id: userId
  }));
}

async function upsertBatches(supabase, table, rows, batchSize) {
  if (rows.length === 0) {
    return;
  }
  const slices = chunk(rows, batchSize);
  for (let i = 0; i < slices.length; i += 1) {
    const part = slices[i];
    const { error } = await supabase.from(table).upsert(part, { onConflict: "id" });
    if (error) {
      throw new Error(`${table} upsert failed on batch ${i + 1}/${slices.length}: ${error.message}`);
    }
    console.log(`[upsert] ${table} batch ${i + 1}/${slices.length} rows=${part.length}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.input || !args.userId) {
    throw new Error(`Missing required arguments.\n\n${usage()}`);
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer.");
  }

  const supabaseUrl = safeText(process.env.SUPABASE_URL);
  const serviceRoleKey = safeText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const userId = assertUuid(args.userId, "--user-id");
  const raw = await fs.readFile(args.input, "utf8");
  const bundle = JSON.parse(raw);
  assertBundle(bundle);

  const spaces = withUserId(bundle.rows.spaces, userId);
  const collections = withUserId(bundle.rows.collections, userId);
  const links = withUserId(bundle.rows.links, userId);

  console.log(
    `[import] spaces=${spaces.length} collections=${collections.length} links=${links.length} batchSize=${args.batchSize}`
  );

  if (args.dryRun) {
    console.log("[import] dry run complete, no data written.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const startedAt = Date.now();
  await upsertBatches(supabase, "tab_deck_spaces", spaces, args.batchSize);
  await upsertBatches(supabase, "tab_deck_collections", collections, args.batchSize);
  await upsertBatches(supabase, "tab_deck_links", links, args.batchSize);

  if (args.setActiveSpace) {
    const activeSpaceId = spaces[0].id;
    const payload = {
      user_id: userId,
      active_space_id: activeSpaceId,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("tab_deck_user_settings").upsert(payload, { onConflict: "user_id" });
    if (error) {
      throw new Error(`tab_deck_user_settings upsert failed: ${error.message}`);
    }
    console.log(`[upsert] tab_deck_user_settings active_space_id=${activeSpaceId}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`[done] import completed in ${elapsedMs} ms`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
