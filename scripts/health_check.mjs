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
const DEFAULT_REPORT_DIR = "reports/health";
const DEFAULT_PAGE_SIZE = 1000;
const MAX_ACTIVE_SPACES = 3;
const ACTIVE_LINK_WARN_RATIO = 0.01;

function parseArgs(argv) {
  const args = {
    env: "dev",
    reportDir: DEFAULT_REPORT_DIR,
    pageSize: DEFAULT_PAGE_SIZE
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--env" && next) {
      args.env = normalizeEnv(next);
      i += 1;
      continue;
    }
    if (token === "--machine" && next) {
      args.machine = normalizeMachine(next);
      i += 1;
      continue;
    }
    if (token === "--env-file" && next) {
      args.envFile = next;
      i += 1;
      continue;
    }
    if (token === "--user-id" && next) {
      args.userId = next;
      i += 1;
      continue;
    }
    if (token === "--report-dir" && next) {
      args.reportDir = next;
      i += 1;
      continue;
    }
    if (token === "--page-size" && next) {
      args.pageSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
  }

  if (!args.env) {
    throw new Error("--env must be dev or prod.");
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  npm run health-check",
    "  npm run health-check -- --env dev [--machine reclina] [--user-id <uuid>]",
    "  npm run health-check -- --env prod --env-file config/prod.env [--user-id <uuid>]",
    "",
    "Environment:",
    "  dev  defaults to config/dev-<machine>.env and config/cloud-config.dev-<machine>.json",
    "  prod requires explicit --env prod and SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or --env-file",
    "",
    "Output:",
    `  ${DEFAULT_REPORT_DIR}/<env>-latest.json plus timestamped JSON snapshots`
  ].join("\n");
}

function normalizeEnv(value) {
  const env = String(value || "").trim().toLowerCase();
  if (env === "dev" || env === "development") {
    return "dev";
  }
  if (env === "prod" || env === "production") {
    return "prod";
  }
  return "";
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

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertUuid(text, fieldName) {
  const value = safeText(text);
  if (!value) {
    return "";
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }
  return value;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
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

async function loadRuntimeConfig(args) {
  const env = args.env;
  const machine = args.machine || normalizeMachine(process.env.TAB_DECK_MACHINE || os.hostname());
  const defaultEnvFile = env === "dev" && machine ? `config/dev-${machine}.env` : "config/prod.env";
  const envFile = args.envFile || defaultEnvFile;
  const fileEnv = parseEnvText(await readTextIfExists(envFile));
  const mergedEnv = { ...fileEnv, ...process.env };

  let supabaseUrl = safeText(mergedEnv.SUPABASE_URL);
  const serviceRoleKey = safeText(mergedEnv.SUPABASE_SERVICE_ROLE_KEY);
  const userId = assertUuid(args.userId || mergedEnv.USER_ID, "USER_ID");

  if (env === "dev") {
    if (!machine) {
      throw new Error(`Cannot infer dev machine from hostname ${os.hostname()}. Pass --machine reclina|chenshuo.`);
    }
    const cloudConfig = await readJsonIfExists(`config/cloud-config.dev-${machine}.json`);
    const cloudUrl = safeText(cloudConfig?.supabaseUrl || cloudConfig?.supabase_url);
    if (!supabaseUrl && cloudUrl) {
      supabaseUrl = cloudUrl;
    }
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Checked ${envFile}.`);
  }

  return {
    env,
    machine: env === "dev" ? machine : "",
    envFile,
    supabaseUrl,
    projectHost: new URL(supabaseUrl).host,
    serviceRoleKey,
    userId
  };
}

async function fetchAll(supabase, table, userId, pageSize) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select("*").range(from, from + pageSize - 1);
    if (userId) {
      query = query.eq("user_id", userId);
    }
    const { data, error } = await query;
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

function isActive(row) {
  return row?.deleted_at == null;
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function preprocessOf(link) {
  return hasObject(link?.metadata?.preprocess) ? link.metadata.preprocess : null;
}

function hasNonEmptyObject(value) {
  return hasObject(value) && Object.keys(value).length > 0;
}

function hasEmbeddingVector(preprocess) {
  return Array.isArray(preprocess?.embedding) && preprocess.embedding.length > 0;
}

function countBy(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function buildDuplicateCollectionGroups(collections) {
  const groups = new Map();
  for (const collection of collections) {
    const key = `${collection.user_id || ""}|${collection.space_id || ""}|${String(collection.name || "").trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(collection.id);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

function summarizeRows(rows) {
  const spaces = rows.spaces;
  const collections = rows.collections;
  const links = rows.links;
  const settings = rows.settings;
  const activeSpaces = spaces.filter(isActive);
  const activeCollections = collections.filter(isActive);
  const activeLinks = links.filter(isActive);
  const activeSpaceIds = new Set(activeSpaces.map((space) => space.id));
  const activeCollectionIds = new Set(activeCollections.map((collection) => collection.id));
  const activeUserIds = new Set([...activeSpaces, ...activeCollections, ...activeLinks].map((row) => row.user_id).filter(Boolean));
  const orphanCollections = activeCollections.filter((collection) => !activeSpaceIds.has(collection.space_id));
  const orphanLinks = activeLinks.filter((link) => !activeCollectionIds.has(link.collection_id));
  const emptyTitleLinks = activeLinks.filter((link) => !safeText(link.title));
  const emptyUrlLinks = activeLinks.filter((link) => !safeText(link.url));
  const duplicateCollections = buildDuplicateCollectionGroups(activeCollections);
  const preprocessPresentCount = countBy(activeLinks, (link) => hasObject(link?.metadata) && "preprocess" in link.metadata);
  const preprocessNonEmptyCount = countBy(activeLinks, (link) => hasNonEmptyObject(preprocessOf(link)));
  const embeddingReadyCount = countBy(activeLinks, (link) => preprocessOf(link)?.embeddingStatus === "ready");
  const embeddingVectorCount = countBy(activeLinks, (link) => hasEmbeddingVector(preprocessOf(link)));
  const embeddingDimCounts = {};
  for (const link of activeLinks) {
    const preprocess = preprocessOf(link);
    if (!hasEmbeddingVector(preprocess)) {
      continue;
    }
    const dim = String(preprocess.embedding.length);
    embeddingDimCounts[dim] = (embeddingDimCounts[dim] || 0) + 1;
  }

  return {
    totals: {
      spaces: spaces.length,
      collections: collections.length,
      links: links.length,
      settings: settings.length
    },
    active: {
      spaces: activeSpaces.length,
      collections: activeCollections.length,
      links: activeLinks.length
    },
    deleted: {
      spaces: spaces.length - activeSpaces.length,
      collections: collections.length - activeCollections.length,
      links: links.length - activeLinks.length
    },
    users: {
      activeUserCount: activeUserIds.size,
      activeUserIds: [...activeUserIds].sort()
    },
    preprocess: {
      present: preprocessPresentCount,
      nonEmpty: preprocessNonEmptyCount
    },
    embeddings: {
      ready: embeddingReadyCount,
      withVector: embeddingVectorCount,
      dimCounts: embeddingDimCounts
    },
    integrity: {
      orphanCollections: orphanCollections.map((collection) => ({
        id: collection.id,
        user_id: collection.user_id,
        space_id: collection.space_id,
        name: collection.name
      })),
      orphanLinks: orphanLinks.map((link) => ({
        id: link.id,
        user_id: link.user_id,
        collection_id: link.collection_id,
        title: link.title
      })),
      duplicateCollections,
      emptyTitleLinks: emptyTitleLinks.map((link) => link.id),
      emptyUrlLinks: emptyUrlLinks.map((link) => link.id),
      settingsWithMissingActiveSpace: settings
        .filter((setting) => setting.active_space_id && !activeSpaceIds.has(setting.active_space_id))
        .map((setting) => ({
          user_id: setting.user_id,
          active_space_id: setting.active_space_id
        }))
    }
  };
}

function addIssue(issues, level, code, message, details = {}) {
  issues.push({ level, code, message, details });
}

function percentChange(previous, current) {
  if (!Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return (current - previous) / previous;
}

function evaluate(summary, previousReport) {
  const issues = [];
  if (summary.active.spaces > MAX_ACTIVE_SPACES) {
    addIssue(issues, "ERROR", "ACTIVE_SPACES_LIMIT", `active spaces ${summary.active.spaces} exceeds ${MAX_ACTIVE_SPACES}`, {
      activeSpaces: summary.active.spaces,
      limit: MAX_ACTIVE_SPACES
    });
  }
  if (summary.integrity.orphanCollections.length > 0) {
    addIssue(issues, "ERROR", "ORPHAN_COLLECTIONS", `${summary.integrity.orphanCollections.length} active collections reference missing spaces`, {
      count: summary.integrity.orphanCollections.length
    });
  }
  if (summary.integrity.orphanLinks.length > 0) {
    addIssue(issues, "ERROR", "ORPHAN_LINKS", `${summary.integrity.orphanLinks.length} active links reference missing collections`, {
      count: summary.integrity.orphanLinks.length
    });
  }
  if (summary.integrity.duplicateCollections.length > 0) {
    addIssue(issues, "ERROR", "DUPLICATE_COLLECTIONS", `${summary.integrity.duplicateCollections.length} duplicate active collection groups found`, {
      groups: summary.integrity.duplicateCollections
    });
  }
  if (summary.integrity.emptyUrlLinks.length > 0) {
    addIssue(issues, "ERROR", "EMPTY_LINK_URLS", `${summary.integrity.emptyUrlLinks.length} active links have empty urls`, {
      ids: summary.integrity.emptyUrlLinks
    });
  }
  if (summary.integrity.emptyTitleLinks.length > 0) {
    addIssue(issues, "WARN", "EMPTY_LINK_TITLES", `${summary.integrity.emptyTitleLinks.length} active links have empty titles`, {
      ids: summary.integrity.emptyTitleLinks
    });
  }
  if (summary.integrity.settingsWithMissingActiveSpace.length > 0) {
    addIssue(issues, "WARN", "SETTINGS_ACTIVE_SPACE_MISSING", `${summary.integrity.settingsWithMissingActiveSpace.length} settings rows point to missing active spaces`, {
      rows: summary.integrity.settingsWithMissingActiveSpace
    });
  }

  const previous = previousReport?.summary;
  const delta = previous
    ? {
        activeSpaces: summary.active.spaces - previous.active.spaces,
        activeCollections: summary.active.collections - previous.active.collections,
        activeLinks: summary.active.links - previous.active.links,
        preprocessPresent: summary.preprocess.present - previous.preprocess.present,
        preprocessNonEmpty: summary.preprocess.nonEmpty - previous.preprocess.nonEmpty,
        embeddingReady: summary.embeddings.ready - previous.embeddings.ready,
        embeddingWithVector: summary.embeddings.withVector - previous.embeddings.withVector
      }
    : null;

  if (previous) {
    if (previous.preprocess.present > 0 && summary.preprocess.present === 0) {
      addIssue(issues, "ERROR", "PREPROCESS_PRESENT_DROPPED_TO_ZERO", "preprocess present count dropped from >0 to 0", {
        previous: previous.preprocess.present,
        current: summary.preprocess.present
      });
    }
    if (previous.preprocess.nonEmpty > 0 && summary.preprocess.nonEmpty === 0) {
      addIssue(issues, "ERROR", "PREPROCESS_NONEMPTY_DROPPED_TO_ZERO", "preprocess non-empty count dropped from >0 to 0", {
        previous: previous.preprocess.nonEmpty,
        current: summary.preprocess.nonEmpty
      });
    }
    if (summary.embeddings.ready < previous.embeddings.ready) {
      addIssue(issues, "ERROR", "EMBEDDING_READY_DECREASED", "embedding ready count decreased", {
        previous: previous.embeddings.ready,
        current: summary.embeddings.ready
      });
    }
    if (summary.embeddings.withVector < previous.embeddings.withVector) {
      addIssue(issues, "ERROR", "EMBEDDING_VECTOR_DECREASED", "embedding vector count decreased", {
        previous: previous.embeddings.withVector,
        current: summary.embeddings.withVector
      });
    }

    const activeLinksChange = percentChange(previous.active.links, summary.active.links);
    if (activeLinksChange !== null && Math.abs(activeLinksChange) > ACTIVE_LINK_WARN_RATIO) {
      addIssue(issues, "WARN", "ACTIVE_LINKS_CHANGED_OVER_1_PERCENT", "active links changed by more than 1%", {
        previous: previous.active.links,
        current: summary.active.links,
        ratio: activeLinksChange
      });
    }
  }

  return {
    status: issues.some((issue) => issue.level === "ERROR") ? "error" : issues.length > 0 ? "warn" : "ok",
    issues,
    delta
  };
}

async function loadPreviousReport(latestPath) {
  return readJsonIfExists(latestPath);
}

function reportFileStamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeReports(report, reportDir, env) {
  await fs.mkdir(reportDir, { recursive: true });
  const latestPath = path.join(reportDir, `${env}-latest.json`);
  const stampedPath = path.join(reportDir, `${env}-${reportFileStamp(new Date(report.generatedAt))}.json`);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(stampedPath, json, "utf8");
  await fs.writeFile(latestPath, json, "utf8");
  return { latestPath, stampedPath };
}

function printSummary(report, paths) {
  const summary = report.summary;
  const evaluation = report.evaluation;
  console.log(`[health-check] env=${report.target.env} host=${report.target.projectHost} status=${evaluation.status}`);
  if (report.target.userIdScope) {
    console.log(`[health-check] scope=user:${report.target.userIdScope}`);
  } else {
    console.log("[health-check] scope=all users");
  }
  console.log(
    `[health-check] totals spaces=${summary.totals.spaces} collections=${summary.totals.collections} links=${summary.totals.links} settings=${summary.totals.settings}`
  );
  console.log(
    `[health-check] active spaces=${summary.active.spaces} collections=${summary.active.collections} links=${summary.active.links}`
  );
  console.log(
    `[health-check] preprocess present=${summary.preprocess.present} nonEmpty=${summary.preprocess.nonEmpty} embeddingReady=${summary.embeddings.ready} embeddingVector=${summary.embeddings.withVector}`
  );
  if (evaluation.delta) {
    console.log(`[health-check] delta ${JSON.stringify(evaluation.delta)}`);
  } else {
    console.log("[health-check] delta unavailable: no previous snapshot");
  }
  for (const issue of evaluation.issues) {
    console.error(`[${issue.level}] ${issue.code}: ${issue.message}`);
  }
  console.log(`[health-check] report ${paths.latestPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const runtime = await loadRuntimeConfig(args);
  const reportDir = path.resolve(args.reportDir);
  const latestPath = path.join(reportDir, `${runtime.env}-latest.json`);
  const previousReport = await loadPreviousReport(latestPath);
  const supabase = createClient(runtime.supabaseUrl, runtime.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const [spaces, collections, links, settings] = await Promise.all([
    fetchAll(supabase, TABLES.spaces, runtime.userId, args.pageSize),
    fetchAll(supabase, TABLES.collections, runtime.userId, args.pageSize),
    fetchAll(supabase, TABLES.links, runtime.userId, args.pageSize),
    fetchAll(supabase, TABLES.settings, runtime.userId, args.pageSize)
  ]);

  const summary = summarizeRows({ spaces, collections, links, settings });
  const evaluation = evaluate(summary, previousReport);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target: {
      env: runtime.env,
      machine: runtime.machine,
      projectHost: runtime.projectHost,
      envFile: runtime.envFile,
      userIdScope: runtime.userId || ""
    },
    summary,
    evaluation
  };
  const paths = await writeReports(report, reportDir, runtime.env);
  printSummary(report, paths);
  if (evaluation.status === "error") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
