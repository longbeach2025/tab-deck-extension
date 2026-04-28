#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TABLES = {
  settings: "tab_deck_user_settings",
  spaces: "tab_deck_spaces",
  collections: "tab_deck_collections",
  links: "tab_deck_links"
};
const DEFAULT_FIXTURE = "fixtures/dev-seed-data.json";
const DEFAULT_BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = {
    command: argv[0] || "",
    fixture: DEFAULT_FIXTURE,
    batchSize: DEFAULT_BATCH_SIZE
  };

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--machine" && next) {
      args.machine = next;
      i += 1;
      continue;
    }
    if (token === "--fixture" && next) {
      args.fixture = next;
      i += 1;
      continue;
    }
    if (token === "--user-id" && next) {
      args.userId = next;
      i += 1;
      continue;
    }
    if (token === "--batch-size" && next) {
      args.batchSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... node scripts/dev_data.mjs seed",
    "  SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... node scripts/dev_data.mjs reset",
    "  SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... node scripts/dev_data.mjs capture-seed",
    "",
    "Options:",
    "  --machine reclina|chenshuo      Override hostname-based machine detection",
    `  --fixture <path>               Default ${DEFAULT_FIXTURE}`,
    "  --user-id <uuid>               Overrides USER_ID"
  ].join("\n");
}

function normalizeMachine(value) {
  const machine = String(value || "").trim().toLowerCase();
  if (machine.includes("reclina")) {
    return "reclina";
  }
  if (machine.includes("chenshuo")) {
    return "chenshuo";
  }
  return machine === "reclina" || machine === "chenshuo" ? machine : "";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadDevConfig(machine) {
  const configPath = path.join("config", `cloud-config.dev-${machine}.json`);
  const config = await readJson(configPath);
  if (config.environment !== "dev") {
    throw new Error(`${configPath} must use environment=dev.`);
  }
  if (config.machine !== machine) {
    throw new Error(`${configPath} machine mismatch: expected ${machine}, got ${config.machine || "empty"}.`);
  }
  if (!String(config.supabaseUrl || "").includes(".supabase.co")) {
    throw new Error(`${configPath} must contain a Supabase project URL.`);
  }
  return config;
}

function assertUuid(text, fieldName) {
  const value = String(text || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }
  return value;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function withUserId(rows, userId) {
  return rows.map((row) => ({
    ...row,
    user_id: userId
  }));
}

async function upsertBatches(supabase, table, rows, batchSize) {
  for (const [index, batch] of chunk(rows, batchSize).entries()) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict: table === TABLES.settings ? "user_id" : "id" });
    if (error) {
      throw new Error(`${table} upsert failed on batch ${index + 1}: ${error.message}`);
    }
    console.log(`[seed] ${table} batch ${index + 1} rows=${batch.length}`);
  }
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

async function resetDevData(supabase, userId) {
  for (const table of [TABLES.links, TABLES.collections, TABLES.spaces, TABLES.settings]) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`${table} reset failed: ${error.message}`);
    }
    console.log(`[reset] cleared ${table}`);
  }
}

async function seedDevData(supabase, userId, fixturePath, batchSize) {
  const fixture = await readJson(fixturePath);
  const rows = fixture.rows || {};
  if (!Array.isArray(rows.spaces) || !Array.isArray(rows.collections) || !Array.isArray(rows.links)) {
    throw new Error(`${fixturePath} must contain rows.spaces, rows.collections, and rows.links arrays.`);
  }

  await resetDevData(supabase, userId);
  await upsertBatches(supabase, TABLES.spaces, withUserId(rows.spaces, userId), batchSize);
  await upsertBatches(supabase, TABLES.collections, withUserId(rows.collections, userId), batchSize);
  await upsertBatches(supabase, TABLES.links, withUserId(rows.links, userId), batchSize);

  if (rows.settings) {
    await upsertBatches(supabase, TABLES.settings, withUserId([rows.settings], userId), batchSize);
  }
}

async function captureSeed(supabase, userId, fixturePath, machine) {
  const [spaces, collections, links, settingsRows] = await Promise.all([
    fetchAllByUser(supabase, TABLES.spaces, userId),
    fetchAllByUser(supabase, TABLES.collections, userId),
    fetchAllByUser(supabase, TABLES.links, userId),
    fetchAllByUser(supabase, TABLES.settings, userId)
  ]);

  const stripUserId = (row) => {
    const { user_id: _userId, ...rest } = row;
    return rest;
  };
  const fixture = {
    version: 1,
    source: `tab-deck-dev-${machine}`,
    capturedAt: new Date().toISOString(),
    rows: {
      spaces: spaces.map(stripUserId),
      collections: collections.map(stripUserId),
      links: links.map(stripUserId),
      settings: settingsRows[0] ? stripUserId(settingsRows[0]) : null
    }
  };

  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`[capture] wrote ${fixturePath}: spaces=${spaces.length} collections=${collections.length} links=${links.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!["seed", "reset", "capture-seed"].includes(args.command)) {
    console.log(usage());
    process.exitCode = 1;
    return;
  }

  const machine = normalizeMachine(args.machine || process.env.TAB_DECK_MACHINE || os.hostname());
  if (!machine) {
    throw new Error(`Cannot infer dev machine from hostname ${os.hostname()}. Pass --machine reclina|chenshuo.`);
  }

  const config = await loadDevConfig(machine);
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for dev seed/reset/capture.");
  }
  const userId = assertUuid(args.userId || process.env.USER_ID, "USER_ID");
  const supabase = createClient(config.supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  if (args.command === "reset") {
    await resetDevData(supabase, userId);
    return;
  }

  if (args.command === "seed") {
    await seedDevData(supabase, userId, args.fixture, args.batchSize);
    return;
  }

  await captureSeed(supabase, userId, args.fixture, machine);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
