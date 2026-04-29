import fs from "node:fs";
import zlib from "node:zlib";

const DEFAULT_BUNDLE = "supabase/init/alpha27/tab-deck-alpha27-init-bundle.json.gz";
const TOP_LIMIT = 5;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "that",
  "this",
  "those",
  "these",
  "看",
  "那个",
  "这个",
  "一下",
  "一下子",
  "关于",
  "相关",
  "一篇",
  "文章",
  "链接",
  "网址",
  "那篇",
  "我",
  "之前",
  "最近"
]);

const TERM_EXPANSIONS = {
  bug: ["issue", "error", "fix", "报错", "错误", "问题"],
  issue: ["bug", "error", "问题", "故障"],
  error: ["bug", "issue", "报错", "失败"],
  fix: ["patch", "resolved", "修复"],
  pagination: ["paging", "page", "分页", "翻页"],
  sync: ["synchronization", "同步"],
  docs: ["documentation", "guide", "manual", "文档", "教程"],
  api: ["endpoint", "sdk", "接口"],
  auth: ["authentication", "login", "oauth", "登录", "鉴权"]
};

const HOST_ALIASES = {
  github: ["github.com"],
  supabase: ["supabase.com"],
  openai: ["openai.com"],
  notion: ["notion.so"],
  youtube: ["youtube.com"],
  twitter: ["twitter.com", "x.com"],
  x: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
  stackoverflow: ["stackoverflow.com"]
};

const BASELINE_QUERIES = [
  "肥厚型心肌病",
  "办公室出租 三里屯",
  "guard passing bjj",
  "stablecoin curve finance",
  "以太坊 POS ETC",
  "胡塞武装 红海",
  "1Password password generator",
  "jiu-jitsu solo drills",
  "Coinmetro withdrawal times",
  "脑动脉硬化 辅助疗法",
  "github auth api",
  "youtube motorcycle review",
  "政府债 赤字",
  "Kadena 主网上线",
  "passive income mining infrastructure",
  "BT 中途岛",
  "twitter 零下二度",
  "openai docs",
  "supabase sync error",
  "分页 bug"
];

const BASELINE_EXPECTATIONS = [
  {
    query: "twitter 零下二度",
    topHostIncludes: "twitter.com",
    topTitleIncludes: "零下二度"
  },
  {
    query: "BT 中途岛",
    topHostIncludes: "btdx8.com",
    topTitleIncludes: "中途岛",
    forbiddenTopHostIncludes: ["youtube.com", "jinse.com"]
  },
  {
    query: "Kadena 主网上线",
    topTitleIncludes: "Kadena",
    forbiddenTopTitleIncludes: ["Kadenai Marketplace"]
  },
  {
    query: "Coinmetro withdrawal times",
    topHostIncludes: "coinmetrohelp.zendesk.com",
    topTitleIncludes: "withdrawal times",
    forbiddenTopHostIncludes: ["nytimes.com"]
  },
  {
    query: "肥厚型心肌病",
    topTitleIncludes: "肥厚型心肌病",
    minResults: 3
  },
  {
    query: "胡塞武装 红海",
    topHostIncludes: "nytimes.com",
    topTitleIncludes: "胡塞武装"
  }
];

function parseArgs(argv) {
  const args = {
    bundle: DEFAULT_BUNDLE,
    query: "",
    json: false,
    assert: false,
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      args.bundle = argv[index + 1] || args.bundle;
      index += 1;
    } else if (arg === "--query") {
      args.query = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--assert") {
      args.assert = true;
    } else if (arg === "--quiet") {
      args.quiet = true;
    }
  }

  return args;
}

function readBundle(bundlePath) {
  const buffer = fs.readFileSync(bundlePath);
  const raw = bundlePath.endsWith(".gz") ? zlib.gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  return JSON.parse(raw);
}

function normalizeRows(bundle) {
  const spacesById = new Map((bundle.rows?.spaces || []).filter((row) => !row.deleted_at).map((row) => [row.id, row]));
  const collectionsById = new Map(
    (bundle.rows?.collections || []).filter((row) => !row.deleted_at).map((row) => [row.id, row])
  );

  return (bundle.rows?.links || [])
    .filter((row) => !row.deleted_at)
    .map((link) => {
      const collection = collectionsById.get(link.collection_id) || {};
      const space = spacesById.get(collection.space_id) || {};
      const metadata = link.metadata && typeof link.metadata === "object" ? link.metadata : {};
      return {
        id: link.id,
        title: link.title || "",
        url: link.url || "",
        addedAt: link.created_at || link.updated_at || "",
        updatedAt: link.updated_at || link.created_at || "",
        metadata,
        collectionName: collection.name || "",
        collectionNotes: collection.notes || "",
        spaceName: space.name || ""
      };
    });
}

function tokenize(value) {
  return (String(value || "").toLowerCase().match(/[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff._-]*/g) || [])
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function expandTerms(keywords) {
  const terms = new Set();
  for (const keyword of keywords) {
    terms.add(keyword);
    for (const mapped of TERM_EXPANSIONS[keyword] || []) {
      terms.add(mapped.toLowerCase());
    }
  }
  return Array.from(terms);
}

function extractHostFilter(input) {
  const explicitDomainMatch = input.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/);
  if (explicitDomainMatch?.[0]) {
    return explicitDomainMatch[0].toLowerCase();
  }

  for (const token of tokenize(input)) {
    if (HOST_ALIASES[token]) {
      return normalizeHostAliasValue(HOST_ALIASES[token]);
    }
  }
  return "";
}

function normalizeHostAliasValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).join("|");
}

function getHostFilterCandidates(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function createCriteria(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const host = extractHostFilter(normalized);
  const hostPattern = host ? new RegExp(host.replace(/\./g, "\\."), "g") : null;
  const keywordInput = hostPattern ? normalized.replace(hostPattern, " ") : normalized;
  const keywords = tokenize(keywordInput).filter((token) => !STOP_WORDS.has(token));
  return {
    query: normalized,
    host,
    terms: expandTerms(keywords)
  };
}

function getHost(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function preprocessTerms(item) {
  const preprocess = item.metadata?.preprocess && typeof item.metadata.preprocess === "object" ? item.metadata.preprocess : {};
  return [
    preprocess.domain,
    preprocess.summary,
    preprocess.language,
    ...(Array.isArray(preprocess.topics) ? preprocess.topics : []),
    ...(Array.isArray(preprocess.keywords) ? preprocess.keywords : []),
    ...(Array.isArray(preprocess.entities) ? preprocess.entities : [])
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function matches(item, criteria) {
  const host = getHost(item.url);
  const hostFilters = getHostFilterCandidates(criteria.host);
  if (hostFilters.length > 0 && !hostFilters.some((candidate) => host.includes(candidate))) {
    return false;
  }
  if (criteria.terms.length === 0) {
    return true;
  }

  const values = [
    item.title,
    item.url,
    host,
    item.collectionName,
    item.collectionNotes,
    item.spaceName,
    ...preprocessTerms(item)
  ].map((value) => String(value || "").toLowerCase());

  return criteria.terms.some((term) => values.some((value) => doesTermMatchValue(term, value)));
}

function recencyScore(item) {
  const ts = Date.parse(item.updatedAt || item.addedAt || "");
  if (!Number.isFinite(ts)) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (ageDays <= 1) return 8;
  if (ageDays <= 7) return 6;
  if (ageDays <= 30) return 4;
  if (ageDays <= 90) return 2;
  return 0;
}

function scoreItem(item, criteria) {
  const title = String(item.title || "").toLowerCase();
  const url = String(item.url || "").toLowerCase();
  const host = getHost(item.url);
  const collectionName = String(item.collectionName || "").toLowerCase();
  const collectionNotes = String(item.collectionNotes || "").toLowerCase();
  const spaceName = String(item.spaceName || "").toLowerCase();
  const enhancementTerms = preprocessTerms(item);
  let score = 0;

  for (const term of criteria.terms) {
    if (doesTermMatchValue(term, title)) score += 8;
    if (doesTermMatchValue(term, url)) score += 5;
    if (doesTermMatchValue(term, host)) score += 4;
    if (doesTermMatchValue(term, collectionName)) score += 3;
    if (doesTermMatchValue(term, collectionNotes)) score += 2;
    if (doesTermMatchValue(term, spaceName)) score += 1;
    for (const enhancementTerm of enhancementTerms) {
      if (doesTermMatchValue(term, enhancementTerm)) score += 4;
    }
  }

  if (criteria.query.length >= 4 && (title.includes(criteria.query) || url.includes(criteria.query))) {
    score += 12;
  }
  return score + recencyScore(item);
}

function doesTermMatchValue(term, normalizedValue) {
  const normalizedTerm = String(term || "").toLowerCase();
  if (!normalizedTerm) {
    return false;
  }
  if (/^[a-z0-9][a-z0-9._-]*$/.test(normalizedTerm)) {
    return tokenize(normalizedValue).some((token) => token === normalizedTerm || token.split(/[._-]+/).includes(normalizedTerm));
  }
  return String(normalizedValue || "").includes(normalizedTerm);
}

function runQuery(items, query) {
  const criteria = createCriteria(query);
  const results = items
    .filter((item) => matches(item, criteria))
    .map((item) => ({ item, score: scoreItem(item, criteria) }))
    .sort((a, b) => b.score - a.score || Date.parse(b.item.updatedAt || "") - Date.parse(a.item.updatedAt || ""));

  return {
    query,
    terms: criteria.terms,
    host: criteria.host,
    resultCount: results.length,
    top: results.slice(0, TOP_LIMIT).map((entry) => ({
      score: Number(entry.score.toFixed(2)),
      title: entry.item.title,
      host: getHost(entry.item.url),
      url: entry.item.url
    }))
  };
}

function printText(results) {
  for (const result of results) {
    console.log(`\n# ${result.query}`);
    console.log(`terms=${result.terms.join(", ") || "-"} host=${result.host || "-"} matches=${result.resultCount}`);
    for (const [index, entry] of result.top.entries()) {
      console.log(`${index + 1}. [${entry.score}] ${entry.title} (${entry.host})`);
    }
  }
}

function assertBaselineResults(results) {
  const byQuery = new Map(results.map((result) => [result.query, result]));
  const failures = [];

  for (const expectation of BASELINE_EXPECTATIONS) {
    const result = byQuery.get(expectation.query);
    if (!result) {
      failures.push(`${expectation.query}: missing result`);
      continue;
    }

    const top = result.top[0];
    if (!top) {
      failures.push(`${expectation.query}: expected at least one result`);
      continue;
    }

    if (typeof expectation.minResults === "number" && result.resultCount < expectation.minResults) {
      failures.push(`${expectation.query}: expected >=${expectation.minResults} results, got ${result.resultCount}`);
    }

    if (expectation.topHostIncludes && !top.host.includes(expectation.topHostIncludes)) {
      failures.push(`${expectation.query}: top host expected to include ${expectation.topHostIncludes}, got ${top.host}`);
    }

    if (expectation.topTitleIncludes && !top.title.toLowerCase().includes(expectation.topTitleIncludes.toLowerCase())) {
      failures.push(`${expectation.query}: top title expected to include ${expectation.topTitleIncludes}, got ${top.title}`);
    }

    const forbiddenHosts = Array.isArray(expectation.forbiddenTopHostIncludes) ? expectation.forbiddenTopHostIncludes : [];
    for (const forbiddenHost of forbiddenHosts) {
      const match = result.top.find((entry) => entry.host.includes(forbiddenHost));
      if (match) {
        failures.push(`${expectation.query}: top ${TOP_LIMIT} unexpectedly included host ${forbiddenHost}: ${match.title}`);
      }
    }

    const forbiddenTitles = Array.isArray(expectation.forbiddenTopTitleIncludes) ? expectation.forbiddenTopTitleIncludes : [];
    for (const forbiddenTitle of forbiddenTitles) {
      const match = result.top.find((entry) => entry.title.toLowerCase().includes(forbiddenTitle.toLowerCase()));
      if (match) {
        failures.push(`${expectation.query}: top ${TOP_LIMIT} unexpectedly included title ${forbiddenTitle}: ${match.title}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[ai-search-baseline] assertion failed: ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[ai-search-baseline] assertions ok (${BASELINE_EXPECTATIONS.length})`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundle = readBundle(args.bundle);
  const items = normalizeRows(bundle);
  const queries = args.query
    ? [args.query]
    : args.assert
      ? Array.from(new Set([...BASELINE_QUERIES, ...BASELINE_EXPECTATIONS.map((expectation) => expectation.query)]))
      : BASELINE_QUERIES;
  const results = queries.map((query) => runQuery(items, query));

  if (args.json) {
    console.log(JSON.stringify({ bundle: args.bundle, itemCount: items.length, results }, null, 2));
    return;
  }

  if (!args.quiet) {
    console.log(`[ai-search-baseline] bundle=${args.bundle} items=${items.length} queries=${queries.length}`);
    printText(results);
  }
  if (args.assert) {
    assertBaselineResults(results);
  }
}

main();
