#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_CHECKPOINT_SIZE = 50;
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const PREPROCESS_VERSION = "deepseek-preprocess-v1";
const EMBEDDING_VERSION = "emb-v1";

function parseArgs(argv) {
  const args = {
    concurrency: DEFAULT_CONCURRENCY,
    checkpointSize: DEFAULT_CHECKPOINT_SIZE,
    model: DEFAULT_MODEL,
    endpoint: DEFAULT_ENDPOINT,
    resume: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--input" && next) {
      args.input = next;
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      args.output = next;
      i += 1;
      continue;
    }
    if (token === "--space-name" && next) {
      args.spaceName = next;
      i += 1;
      continue;
    }
    if (token === "--concurrency" && next) {
      args.concurrency = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--checkpoint-size" && next) {
      args.checkpointSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--model" && next) {
      args.model = next;
      i += 1;
      continue;
    }
    if (token === "--endpoint" && next) {
      args.endpoint = next;
      i += 1;
      continue;
    }
    if (token === "--no-resume") {
      args.resume = false;
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
    "  DEEPSEEK_API_KEY=... node scripts/toby_preprocess_deepseek.mjs \\",
    "    --input /path/to/toby-export.json \\",
    "    --output /path/to/toby-preprocessed.json \\",
    "    [--space-name \"Toby Import\"] [--concurrency 5] [--checkpoint-size 50]",
    "",
    "Notes:",
    "  - This script does metadata extraction only (title/url/domain/meta-description).",
    "  - It does not fetch article body text.",
    "  - Output can be imported by scripts/import_preprocessed_to_supabase.mjs."
  ].join("\n");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix, stableInput) {
  const hash = crypto.createHash("sha1").update(stableInput).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readTobyLabel(label) {
  if (typeof label === "string") {
    return label.trim();
  }
  if (!label || typeof label !== "object") {
    return "";
  }
  return String(label.title || label.name || label.value || "").trim();
}

function isSaveableUrl(url) {
  const text = safeText(url);
  if (!text) {
    return false;
  }
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    if (parsed.protocol === "https:" && parsed.hostname === "chrome.google.com") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parseTobyImportObject(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.lists)) {
    throw new Error("Input is not a valid Toby export JSON (missing lists).");
  }

  const collections = raw.lists
    .filter((list) => list && typeof list === "object")
    .map((list, listIndex) => {
      const seen = new Set();
      const cards = Array.isArray(list.cards) ? list.cards : [];
      const labels = Array.isArray(list.labels) ? list.labels.map(readTobyLabel).filter(Boolean) : [];
      const notes = labels.length > 0 ? `Imported from Toby. Labels: ${labels.join(", ")}` : "Imported from Toby.";

      const items = cards
        .map((card, cardIndex) => ({
          sourceIndex: `${listIndex}:${cardIndex}`,
          url: safeText(card?.url),
          title: safeText(card?.customTitle) || safeText(card?.title) || "",
          description: safeText(card?.description) || safeText(card?.excerpt) || safeText(card?.metaDescription) || ""
        }))
        .filter((card) => {
          if (!isSaveableUrl(card.url)) {
            return false;
          }
          if (seen.has(card.url)) {
            return false;
          }
          seen.add(card.url);
          return true;
        });

      return {
        index: listIndex,
        name: safeText(list.title) || "Untitled Toby List",
        notes,
        items
      };
    })
    .filter((collection) => collection.items.length > 0);

  const totalItems = collections.reduce((sum, collection) => sum + collection.items.length, 0);
  if (totalItems === 0) {
    throw new Error("No valid links found in Toby export.");
  }

  return {
    version: raw.version || "",
    collections,
    stats: {
      collectionCount: collections.length,
      itemCount: totalItems
    }
  };
}

function buildBaseBundle(tobyImport, options) {
  const importedAt = nowIso();
  const importBatchId = `toby_batch_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const spaceName = safeText(options.spaceName) || `Toby Import ${new Date(importedAt).toLocaleDateString()}`;
  const spaceId = makeId("space", `${importBatchId}:${spaceName}`);

  const spaces = [
    {
      id: spaceId,
      name: spaceName,
      sort_order: 0,
      created_at: importedAt,
      updated_at: importedAt,
      deleted_at: null
    }
  ];

  const collections = [];
  const links = [];

  tobyImport.collections.forEach((collection, collectionOrder) => {
    const collectionId = makeId(
      "collection",
      `${importBatchId}:${collection.index}:${collection.name}:${collectionOrder}`
    );
    collections.push({
      id: collectionId,
      space_id: spaceId,
      name: collection.name,
      notes: collection.notes,
      metadata: {
        source: "toby_export",
        timeAccuracy: "imported",
        importedAt,
        importBatchId
      },
      sort_order: collectionOrder,
      created_at: importedAt,
      updated_at: importedAt,
      deleted_at: null
    });

    collection.items.forEach((item, itemOrder) => {
      const domain = extractDomain(item.url);
      const stableSeed = `${importBatchId}:${collection.index}:${item.sourceIndex}:${item.url}`;
      const linkId = makeId("link", stableSeed);
      links.push({
        id: linkId,
        collection_id: collectionId,
        title: item.title || item.url,
        url: item.url,
        fav_icon_url: "",
        metadata: {
          source: "toby_export",
          timeAccuracy: "imported",
          importedAt,
          importBatchId,
          preprocess: {
            version: PREPROCESS_VERSION,
            enriched: false,
            processedAt: "",
            provider: "deepseek",
            model: options.model,
            fallbackReason: "pending",
            cleanTitle: item.title || item.url,
            summary: "",
            topics: [],
            contentType: "unknown",
            entities: [],
            language: "unknown",
            keywords: [],
            domain,
            metaDescription: item.description || "",
            inputText: [item.title || "", domain, item.description || "", item.url].filter(Boolean).join(" | "),
            embeddingVersion: EMBEDDING_VERSION,
            embeddingProvider: "",
            embeddingModel: "",
            embeddingStatus: "pending",
            embeddingInputHash: "",
            embeddingDim: 0,
            embeddingUpdatedAt: "",
            embeddingError: "",
            embedding: []
          }
        },
        sort_order: itemOrder,
        created_at: importedAt,
        updated_at: importedAt,
        deleted_at: null
      });
    });
  });

  return {
    schemaVersion: 1,
    generatedAt: importedAt,
    importBatchId,
    preprocessVersion: PREPROCESS_VERSION,
    source: {
      type: "toby_export",
      version: tobyImport.version || ""
    },
    stats: {
      totalCollections: collections.length,
      totalLinks: links.length,
      processedLinks: 0,
      failedLinks: 0
    },
    rows: {
      spaces,
      collections,
      links
    }
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: poolSize }, () => runOne());
  await Promise.all(runners);
  return results;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeArray(values, max = 12) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => safeText(value))
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeObject(raw, fallback) {
  const data = raw && typeof raw === "object" ? raw : {};
  const cleanTitle = safeText(data.clean_title) || safeText(data.cleanTitle) || fallback.cleanTitle;
  const summary = safeText(data.summary).slice(0, 220);
  const contentType = safeText(data.content_type) || safeText(data.contentType) || "unknown";
  const language = safeText(data.language) || "unknown";
  return {
    cleanTitle,
    summary,
    topics: sanitizeArray(data.topics),
    contentType: contentType || "unknown",
    entities: sanitizeArray(data.entities),
    language,
    keywords: sanitizeArray(data.keywords)
  };
}

function buildPrompt(link) {
  const preprocess = link.metadata?.preprocess || {};
  const fallback = {
    cleanTitle: safeText(link.title) || safeText(link.url)
  };
  const domain = safeText(preprocess.domain);
  const metaDescription = safeText(preprocess.metaDescription);

  const system = [
    "You are a strict JSON generator for tab metadata extraction.",
    "Return exactly one JSON object and no extra text.",
    "Schema:",
    "{",
    '  "clean_title": "string",',
    '  "summary": "string <= 50 Chinese characters or <= 140 English chars",',
    '  "topics": ["string"],',
    '  "content_type": "report|news|tutorial|discussion|tool|reference|other",',
    '  "entities": ["string"],',
    '  "language": "zh|en|mixed|other",',
    '  "keywords": ["string"]',
    "}"
  ].join("\n");

  const user = [
    `Title: ${fallback.cleanTitle}`,
    `URL: ${link.url}`,
    `Domain: ${domain || "unknown"}`,
    `Meta Description: ${metaDescription || "none"}`
  ].join("\n");

  return { system, user };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

async function callDeepseek(endpoint, apiKey, model, link, attemptLimit = 4) {
  const prompt = buildPrompt(link);
  let attempt = 0;

  while (attempt < attemptLimit) {
    attempt += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user }
          ]
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        const text = await response.text();
        if (attempt < attemptLimit && shouldRetry(response.status)) {
          const wait = Math.min(8000, 400 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 200);
          await sleep(wait);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("DeepSeek response has empty message content.");
      }

      const parsed = parseJsonSafe(content);
      if (!parsed) {
        throw new Error("DeepSeek response is not valid JSON.");
      }

      return { parsed, elapsedMs };
    } catch (error) {
      clearTimeout(timeout);
      if (attempt >= attemptLimit) {
        throw error;
      }
      const wait = Math.min(8000, 400 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 200);
      await sleep(wait);
    }
  }

  throw new Error("Unexpected retry exit.");
}

async function loadExistingOutput(outputPath) {
  try {
    const text = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.rows || !Array.isArray(parsed.rows.links)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function mergeExistingLinks(baseLinks, existingLinks) {
  const byId = new Map(existingLinks.map((link) => [link.id, link]));
  return baseLinks.map((link) => {
    const existing = byId.get(link.id);
    if (!existing) {
      return link;
    }
    return {
      ...link,
      metadata: {
        ...link.metadata,
        ...existing.metadata,
        preprocess: {
          ...(link.metadata?.preprocess || {}),
          ...(existing.metadata?.preprocess || {})
        }
      }
    };
  });
}

function computeStats(links) {
  let processed = 0;
  let failed = 0;
  for (const link of links) {
    const preprocess = link.metadata?.preprocess || {};
    if (preprocess.enriched) {
      processed += 1;
      continue;
    }
    if (preprocess.fallbackReason && preprocess.fallbackReason !== "pending") {
      failed += 1;
    }
  }
  return { processed, failed };
}

async function writeJson(outputPath, data) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.input || !args.output) {
    throw new Error(`Missing required arguments.\n\n${usage()}`);
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(args.checkpointSize) || args.checkpointSize <= 0) {
    throw new Error("--checkpoint-size must be a positive integer.");
  }

  const apiKey = safeText(process.env.DEEPSEEK_API_KEY);
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required.");
  }

  const inputText = await fs.readFile(args.input, "utf8");
  const parsedInput = JSON.parse(inputText);
  const tobyImport = parseTobyImportObject(parsedInput);
  let bundle = buildBaseBundle(tobyImport, args);

  if (args.resume) {
    const existing = await loadExistingOutput(args.output);
    if (existing) {
      bundle.rows.links = mergeExistingLinks(bundle.rows.links, existing.rows.links || []);
    }
  }

  const allLinks = bundle.rows.links;
  const pendingIndexes = [];
  for (let i = 0; i < allLinks.length; i += 1) {
    const preprocess = allLinks[i].metadata?.preprocess || {};
    if (!preprocess.enriched) {
      pendingIndexes.push(i);
    }
  }

  const startedAt = Date.now();
  console.log(
    `[preprocess] total=${allLinks.length}, pending=${pendingIndexes.length}, concurrency=${args.concurrency}, model=${args.model}`
  );

  for (let offset = 0; offset < pendingIndexes.length; offset += args.checkpointSize) {
    const slice = pendingIndexes.slice(offset, offset + args.checkpointSize);
    await mapLimit(slice, args.concurrency, async (index) => {
      const link = allLinks[index];
      const preprocess = link.metadata.preprocess || {};
      const fallback = {
        cleanTitle: safeText(link.title) || safeText(link.url)
      };

      try {
        const { parsed, elapsedMs } = await callDeepseek(args.endpoint, apiKey, args.model, link);
        const sanitized = sanitizeObject(parsed, fallback);
        link.metadata.preprocess = {
          ...preprocess,
          ...sanitized,
          enriched: true,
          fallbackReason: "",
          processedAt: nowIso(),
          elapsedMs
        };
      } catch (error) {
        link.metadata.preprocess = {
          ...preprocess,
          enriched: false,
          fallbackReason: error instanceof Error ? error.message : String(error),
          processedAt: nowIso()
        };
      }
    });

    const { processed, failed } = computeStats(allLinks);
    bundle.stats.processedLinks = processed;
    bundle.stats.failedLinks = failed;
    bundle.generatedAt = nowIso();
    await writeJson(args.output, bundle);
    const percent = Math.floor((processed / allLinks.length) * 100);
    console.log(`[checkpoint] processed=${processed}/${allLinks.length} (${percent}%), failed=${failed}`);
  }

  const finishedAt = Date.now();
  const { processed, failed } = computeStats(allLinks);
  bundle.stats.processedLinks = processed;
  bundle.stats.failedLinks = failed;
  bundle.generatedAt = nowIso();
  bundle.runtimeMs = finishedAt - startedAt;
  await writeJson(args.output, bundle);
  console.log(`[done] output=${args.output} processed=${processed}/${allLinks.length} failed=${failed}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
