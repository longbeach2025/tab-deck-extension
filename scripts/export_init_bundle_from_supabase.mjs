#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const gzip = promisify(zlib.gzip);
const DEFAULT_BATCH_SIZE = 1000;

function parseArgs(argv) {
  const args = {
    outputDir: "supabase/init/alpha27",
    activeOnly: true,
    includeUnreferenced: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--user-id" && next) {
      args.userId = next;
      i += 1;
      continue;
    }
    if (token === "--output-dir" && next) {
      args.outputDir = next;
      i += 1;
      continue;
    }
    if (token === "--include-soft-deleted") {
      args.activeOnly = false;
      continue;
    }
    if (token === "--include-unreferenced") {
      args.includeUnreferenced = true;
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
    "  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export_init_bundle_from_supabase.mjs \\",
    "    --user-id <auth_user_uuid> [--output-dir supabase/init/alpha27]",
    "",
    "Options:",
    "  --include-soft-deleted   Export soft deleted rows as well (default: active only)",
    "  --include-unreferenced   Keep all active spaces/collections even if no exported link references them"
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

async function fetchAllByUser(supabase, table, userId) {
  const all = [];
  for (let from = 0; ; from += DEFAULT_BATCH_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .range(from, from + DEFAULT_BATCH_SIZE - 1);
    if (error) {
      throw new Error(`${table} fetch failed: ${error.message}`);
    }
    if (!data || data.length === 0) {
      break;
    }
    all.push(...data);
    if (data.length < DEFAULT_BATCH_SIZE) {
      break;
    }
  }
  return all;
}

function keepActiveOnly(rows, enabled) {
  if (!enabled) {
    return rows;
  }
  return rows.filter((row) => row.deleted_at == null);
}

function keepReferenced(spaces, collections, links, includeUnreferenced) {
  if (includeUnreferenced) {
    return { spaces, collections, links };
  }

  const collectionIds = new Set(links.map((link) => link.collection_id));
  const collectionsReferenced = collections.filter((collection) => collectionIds.has(collection.id));
  const spaceIds = new Set(collectionsReferenced.map((collection) => collection.space_id));
  const spacesReferenced = spaces.filter((space) => spaceIds.has(space.id));

  return {
    spaces: spacesReferenced,
    collections: collectionsReferenced,
    links
  };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.userId) {
    throw new Error(`Missing --user-id.\n\n${usage()}`);
  }

  const userId = assertUuid(args.userId, "--user-id");
  const supabaseUrl = safeText(process.env.SUPABASE_URL);
  const serviceRoleKey = safeText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const spacesRaw = await fetchAllByUser(supabase, "tab_deck_spaces", userId);
  const collectionsRaw = await fetchAllByUser(supabase, "tab_deck_collections", userId);
  const linksRaw = await fetchAllByUser(supabase, "tab_deck_links", userId);
  const settingsRaw = await fetchAllByUser(supabase, "tab_deck_user_settings", userId);

  const spaces = keepActiveOnly(spacesRaw, args.activeOnly);
  const collections = keepActiveOnly(collectionsRaw, args.activeOnly);
  const links = keepActiveOnly(linksRaw, args.activeOnly);

  const filtered = keepReferenced(spaces, collections, links, args.includeUnreferenced);

  const activeSpaceId =
    filtered.spaces.find((space) => space.id === settingsRaw[0]?.active_space_id)?.id || filtered.spaces[0]?.id || null;
  const exportedAt = new Date().toISOString();
  const bundle = {
    meta: {
      format: "tab-deck-init-bundle-v1",
      exportedAt,
      sourceVersion: "0.2.0-alpha.27",
      activeOnly: args.activeOnly,
      sourceUserId: userId,
      activeSpaceId,
      counts: {
        spaces: filtered.spaces.length,
        collections: filtered.collections.length,
        links: filtered.links.length
      }
    },
    rows: {
      spaces: filtered.spaces,
      collections: filtered.collections,
      links: filtered.links
    }
  };

  const outputDir = path.resolve(args.outputDir);
  const jsonPath = path.join(outputDir, "tab-deck-alpha27-init-bundle.json");
  const gzPath = `${jsonPath}.gz`;
  const manifestPath = path.join(outputDir, "manifest.json");

  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  const gz = await gzip(Buffer.from(json, "utf8"), { level: 9 });

  await writeFile(jsonPath, json);
  await writeFile(gzPath, gz);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        createdAt: exportedAt,
        files: {
          json: path.basename(jsonPath),
          gzip: path.basename(gzPath)
        },
        ...bundle.meta
      },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify(
      {
        outputDir,
        jsonPath,
        gzPath,
        manifestPath,
        counts: bundle.meta.counts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
