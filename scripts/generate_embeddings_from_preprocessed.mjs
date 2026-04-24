#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_ENDPOINT = "https://api.deepseek.com/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const EMBEDDING_VERSION = "emb-v1";

function parseArgs(argv) {
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    force: false
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
    if (token === "--batch-size" && next) {
      args.batchSize = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--endpoint" && next) {
      args.endpoint = next;
      i += 1;
      continue;
    }
    if (token === "--model" && next) {
      args.model = next;
      i += 1;
      continue;
    }
    if (token === "--provider" && next) {
      args.provider = next;
      i += 1;
      continue;
    }
    if (token === "--force") {
      args.force = true;
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
    "  EMBEDDING_API_KEY=... node scripts/generate_embeddings_from_preprocessed.mjs \\",
    "    --input /path/to/toby-preprocessed.json \\",
    "    --output /path/to/toby-preprocessed-embedded.json \\",
    "    [--endpoint https://api.deepseek.com/embeddings] [--model text-embedding-3-small]",
    "",
    "Notes:",
    "  - Uses OpenAI-compatible embeddings request format: { model, input: [...] }",
    "  - Default endpoint is set to DeepSeek embeddings URL.",
    "  - This script updates metadata.preprocess.embedding* fields in each link."
  ].join("\n");
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso() {
  return new Date().toISOString();
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function buildEmbeddingInput(link) {
  const preprocess = link.metadata?.preprocess || {};
  const title = safeText(preprocess.cleanTitle) || safeText(link.title);
  const summary = safeText(preprocess.summary);
  const domain = safeText(preprocess.domain);
  const topics = Array.isArray(preprocess.topics) ? preprocess.topics.map(safeText).filter(Boolean).join(", ") : "";
  const keywords = Array.isArray(preprocess.keywords)
    ? preprocess.keywords.map(safeText).filter(Boolean).join(", ")
    : "";
  const contentType = safeText(preprocess.contentType);
  return [title, summary, domain, contentType, topics, keywords, safeText(link.url)].filter(Boolean).join(" | ");
}

function shouldProcess(link, inputHash, args) {
  if (args.force) {
    return true;
  }
  const preprocess = link.metadata?.preprocess || {};
  if (preprocess.embeddingStatus !== "ready") {
    return true;
  }
  if (safeText(preprocess.embeddingInputHash) !== inputHash) {
    return true;
  }
  if (!Array.isArray(preprocess.embedding) || preprocess.embedding.length === 0) {
    return true;
  }
  return false;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

async function callEmbeddings(endpoint, apiKey, model, inputBatch, maxRetries = 4) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: inputBatch
        })
      });
      if (!response.ok) {
        const text = await response.text();
        if (attempt < maxRetries && isRetryable(response.status)) {
          const waitMs = Math.min(8000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
          await sleep(waitMs);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.data) ? payload.data : [];
      const embeddings = list.map((item) => item?.embedding).filter((item) => Array.isArray(item));
      if (embeddings.length !== inputBatch.length) {
        throw new Error(`Embedding response size mismatch: expected=${inputBatch.length}, actual=${embeddings.length}`);
      }
      return embeddings;
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = Math.min(8000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
      await sleep(waitMs);
    }
  }
  throw new Error("Unexpected retry loop exit.");
}

function assertBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Invalid preprocessed bundle JSON.");
  }
  if (!bundle.rows || !Array.isArray(bundle.rows.links)) {
    throw new Error("Bundle rows.links not found.");
  }
}

async function writeOutput(outputPath, bundle) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(bundle, null, 2), "utf8");
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
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer.");
  }

  const apiKey = safeText(process.env.EMBEDDING_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("Provide EMBEDDING_API_KEY (or DEEPSEEK_API_KEY / OPENAI_API_KEY).");
  }

  const raw = await fs.readFile(args.input, "utf8");
  const bundle = JSON.parse(raw);
  assertBundle(bundle);

  const provider = safeText(args.provider) || (args.endpoint.includes("deepseek") ? "deepseek" : "openai-compatible");
  const links = bundle.rows.links;

  const candidates = [];
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    const preprocess = link.metadata?.preprocess || {};
    const inputText = buildEmbeddingInput(link);
    const inputHash = sha1(inputText);
    if (shouldProcess(link, inputHash, args)) {
      candidates.push({ index: i, inputText, inputHash, preprocess });
    }
  }

  console.log(
    `[embedding] total=${links.length}, pending=${candidates.length}, model=${args.model}, batchSize=${args.batchSize}`
  );

  const batches = chunk(candidates, args.batchSize);
  let ready = 0;
  let failed = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const inputs = batch.map((item) => item.inputText);
    try {
      const embeddings = await callEmbeddings(args.endpoint, apiKey, args.model, inputs);
      const processedAt = nowIso();
      for (let i = 0; i < batch.length; i += 1) {
        const item = batch[i];
        const link = links[item.index];
        const preprocess = link.metadata?.preprocess || {};
        const vector = embeddings[i];
        link.metadata.preprocess = {
          ...preprocess,
          embeddingVersion: EMBEDDING_VERSION,
          embeddingProvider: provider,
          embeddingModel: args.model,
          embeddingStatus: "ready",
          embeddingInputHash: item.inputHash,
          embeddingDim: vector.length,
          embeddingUpdatedAt: processedAt,
          embeddingError: "",
          embedding: vector
        };
        ready += 1;
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      for (const item of batch) {
        const link = links[item.index];
        const preprocess = link.metadata?.preprocess || {};
        link.metadata.preprocess = {
          ...preprocess,
          embeddingVersion: EMBEDDING_VERSION,
          embeddingProvider: provider,
          embeddingModel: args.model,
          embeddingStatus: "failed",
          embeddingInputHash: item.inputHash,
          embeddingUpdatedAt: nowIso(),
          embeddingError: errorText
        };
        failed += 1;
      }
    }

    bundle.generatedAt = nowIso();
    await writeOutput(args.output, bundle);
    const done = ready + failed;
    const percent = candidates.length === 0 ? 100 : Math.floor((done / candidates.length) * 100);
    console.log(`[checkpoint] ready=${ready} failed=${failed} done=${done}/${candidates.length} (${percent}%)`);
  }

  bundle.generatedAt = nowIso();
  await writeOutput(args.output, bundle);
  console.log(`[done] output=${args.output} ready=${ready} failed=${failed}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
