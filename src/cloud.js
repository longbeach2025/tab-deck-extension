import { createClient } from "./vendor/supabase-js.js";

const CLOUD_CONFIG_KEY = "tabDeckCloudConfig";
const CLOUD_PENDING_DECK_KEY = "tabDeckPendingCloudDeck";
const TABLES = {
  settings: "tab_deck_user_settings",
  spaces: "tab_deck_spaces",
  collections: "tab_deck_collections",
  links: "tab_deck_links"
};
const CLOUD_PAGE_SIZE = 1000;

let client;
let clientSignature = "";

export async function getCloudConfig() {
  const result = await chrome.storage.local.get(CLOUD_CONFIG_KEY);
  return normalizeConfig(result[CLOUD_CONFIG_KEY]);
}

export async function saveCloudConfig(config) {
  const normalized = normalizeConfig(config);
  await chrome.storage.local.set({ [CLOUD_CONFIG_KEY]: normalized });
  resetClient();
  return normalized;
}

export async function clearCloudConfig() {
  await chrome.storage.local.remove([CLOUD_CONFIG_KEY, CLOUD_PENDING_DECK_KEY]);
  resetClient();
}

export async function isCloudConfigured() {
  const config = await getCloudConfig();
  return Boolean(config.supabaseUrl && config.anonKey);
}

export async function getCloudClient() {
  const config = await getCloudConfig();

  if (!config.supabaseUrl || !config.anonKey) {
    return null;
  }

  const signature = `${config.supabaseUrl}|${config.anonKey}`;

  if (!client || clientSignature !== signature) {
    client = createClient(config.supabaseUrl, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          "x-application-name": "tab-deck-extension"
        }
      }
    });
    clientSignature = signature;
  }

  return client;
}

export async function getCloudSession() {
  const supabase = await getCloudClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export async function getCloudUser() {
  const session = await getCloudSession();
  return session?.user || null;
}

export async function signInCloud(email, password) {
  const supabase = await getRequiredClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  return data.user;
}

export async function signUpCloud(email, password) {
  const supabase = await getRequiredClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOutCloud() {
  const supabase = await getCloudClient();

  if (!supabase) {
    return;
  }

  await supabase.auth.signOut();
}

export function formatCloudError(error) {
  const message = extractCloudErrorMessage(error);

  if (looksLikeFetchFailure(message)) {
    return "Network request failed (Failed to fetch). Check Supabase URL, network/proxy/firewall, then click Sync now.";
  }

  return message;
}

export async function isCloudReady() {
  try {
    return Boolean(await getCloudUser());
  } catch {
    return false;
  }
}

function extractCloudErrorMessage(error) {
  if (error instanceof Error) {
    return sanitizeCloudErrorText(error.message || String(error));
  }

  if (error && typeof error === "object") {
    const message = sanitizeCloudErrorText(error.message);
    const code = sanitizeCloudErrorText(error.code);
    const hint = sanitizeCloudErrorText(error.hint);
    const statusText = sanitizeCloudErrorText(error.statusText);
    const details = sanitizeCloudErrorDetails(error.details);
    const parts = [
      code ? `code: ${code}` : "",
      message ? `message: ${message}` : "",
      details ? `details: ${details}` : "",
      hint ? `hint: ${hint}` : "",
      statusText ? `status: ${statusText}` : ""
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join("; ");
    }

    try {
      return sanitizeCloudErrorText(JSON.stringify(error));
    } catch {
      return "Unknown cloud error object.";
    }
  }

  return sanitizeCloudErrorText(String(error));
}

function sanitizeCloudErrorText(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (text.includes(" at chrome-extension://")) {
    return text.split(" at chrome-extension://")[0].trim();
  }

  return text;
}

function sanitizeCloudErrorDetails(value) {
  const text = sanitizeCloudErrorText(value);

  if (!text || looksLikeStackTrace(text)) {
    return "";
  }

  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function looksLikeStackTrace(value) {
  return /(?:\s|^)at\s+[^\s]+\s+\(/.test(String(value || ""));
}

function looksLikeFetchFailure(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("failed to fetch") || text.includes("networkerror") || text.includes("load failed");
}

export async function fetchCloudDeck() {
  const supabase = await getRequiredClient();
  const user = await getRequiredUser();

  const [settingsResult, spaces, collections, links] = await Promise.all([
    supabase.from(TABLES.settings).select("*").eq("user_id", user.id).maybeSingle(),
    fetchAllRows(() =>
      supabase
        .from(TABLES.spaces)
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    ),
    fetchAllRows(() =>
      supabase
        .from(TABLES.collections)
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    ),
    fetchAllRows(() =>
      supabase
        .from(TABLES.links)
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    )
  ]);

  if (settingsResult.error) {
    throw settingsResult.error;
  }

  if (spaces.length === 0) {
    return null;
  }

  const collectionsBySpace = groupBy(collections, "space_id");
  const linksByCollection = groupBy(links, "collection_id");
  const deckSpaces = spaces.map((space) => ({
    id: space.id,
    name: space.name,
    createdAt: toIso(space.created_at),
    collections: (collectionsBySpace.get(space.id) || []).map((collection) => ({
      id: collection.id,
      name: collection.name,
      notes: collection.notes || "",
      createdAt: toIso(collection.created_at),
      updatedAt: toIso(collection.updated_at),
      lastModifiedAt: toIso(collection.updated_at),
      source: collection.metadata?.source || "manual",
      timeAccuracy: collection.metadata?.timeAccuracy || "exact",
      importedAt: collection.metadata?.importedAt || "",
      importBatchId: collection.metadata?.importBatchId || "",
      items: (linksByCollection.get(collection.id) || []).map((link) => ({
        id: link.id,
        title: link.title,
        url: link.url,
        favIconUrl: link.fav_icon_url || "",
        addedAt: toIso(link.created_at),
        lastModifiedAt: toIso(link.updated_at || link.created_at),
        lastOpenedAt: link.metadata?.lastOpenedAt || "",
        source: link.metadata?.source || "manual",
        timeAccuracy: link.metadata?.timeAccuracy || "exact",
        importedAt: link.metadata?.importedAt || "",
        importBatchId: link.metadata?.importBatchId || ""
      }))
    }))
  }));
  const activeSpaceId = settingsResult.data?.active_space_id || deckSpaces[0].id;

  return {
    version: 1,
    updatedAt: getLatestUpdatedAt([settingsResult.data, ...spaces, ...collections, ...links]),
    activeSpaceId: deckSpaces.some((space) => space.id === activeSpaceId) ? activeSpaceId : deckSpaces[0].id,
    settings: {
      theme: settingsResult.data?.theme || "system",
      recentlyDeleted: Array.isArray(settingsResult.data?.recently_deleted) ? settingsResult.data.recently_deleted : [],
      tombstones: Array.isArray(settingsResult.data?.tombstones) ? settingsResult.data.tombstones : []
    },
    spaces: deckSpaces
  };
}

export async function pushDeckToCloud(deck) {
  const supabase = await getRequiredClient();
  const user = await getRequiredUser();
  const now = new Date().toISOString();
  const payload = flattenDeck(deck, user.id, now);

  await markDeletedRows(supabase, user.id, payload, now);

  await throwIfSupabaseError(
    supabase.from(TABLES.settings).upsert(payload.settings, { onConflict: "user_id" })
  );

  if (payload.spaces.length > 0) {
    await throwIfSupabaseError(
      supabase.from(TABLES.spaces).upsert(payload.spaces, { onConflict: "id" })
    );
  }

  if (payload.collections.length > 0) {
    await throwIfSupabaseError(
      supabase.from(TABLES.collections).upsert(payload.collections, { onConflict: "id" })
    );
  }

  if (payload.links.length > 0) {
    await throwIfSupabaseError(
      supabase.from(TABLES.links).upsert(payload.links, { onConflict: "id" })
    );
  }

  await clearPendingCloudDeck();
}

export async function queuePendingCloudDeck(deck) {
  await chrome.storage.local.set({ [CLOUD_PENDING_DECK_KEY]: deck });
}

export async function syncPendingCloudDeck() {
  const result = await chrome.storage.local.get(CLOUD_PENDING_DECK_KEY);

  if (!result[CLOUD_PENDING_DECK_KEY] || !(await isCloudReady())) {
    return false;
  }

  await pushDeckToCloud(result[CLOUD_PENDING_DECK_KEY]);
  return true;
}

export async function clearPendingCloudDeck() {
  await chrome.storage.local.remove(CLOUD_PENDING_DECK_KEY);
}

function normalizeConfig(config) {
  return {
    supabaseUrl: String(config?.supabaseUrl || "").trim().replace(/\/$/, ""),
    anonKey: String(config?.anonKey || "").trim()
  };
}

async function getRequiredClient() {
  const supabase = await getCloudClient();

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

async function getRequiredUser() {
  const user = await getCloudUser();

  if (!user) {
    throw new Error("Sign in to Supabase first.");
  }

  return user;
}

function resetClient() {
  client = null;
  clientSignature = "";
}

async function throwIfSupabaseError(request) {
  const result = await request;

  if (result.error) {
    throw result.error;
  }

  return result;
}

function groupBy(rows, key) {
  const groups = new Map();

  for (const row of rows) {
    const value = row[key];
    const group = groups.get(value) || [];
    group.push(row);
    groups.set(value, group);
  }

  return groups;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function getLatestUpdatedAt(rows) {
  const timestamps = rows
    .filter(Boolean)
    .map((row) => Date.parse(row.updated_at || row.created_at || ""))
    .filter(Number.isFinite);
  const latest = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  return new Date(latest).toISOString();
}

function flattenDeck(deck, userId, timestamp) {
  const settings = {
    user_id: userId,
    active_space_id: deck.activeSpaceId || deck.spaces[0]?.id || null,
    theme: deck.settings?.theme || "system",
    recently_deleted: Array.isArray(deck.settings?.recentlyDeleted) ? deck.settings.recentlyDeleted : [],
    tombstones: Array.isArray(deck.settings?.tombstones) ? deck.settings.tombstones : [],
    updated_at: timestamp
  };
  const spaces = [];
  const collections = [];
  const links = [];

  deck.spaces.forEach((space, spaceIndex) => {
    spaces.push({
      id: space.id,
      user_id: userId,
      name: space.name,
      sort_order: spaceIndex,
      created_at: space.createdAt || timestamp,
      updated_at: timestamp,
      deleted_at: null
    });

    space.collections.forEach((collection, collectionIndex) => {
      collections.push({
        id: collection.id,
        user_id: userId,
        space_id: space.id,
        name: collection.name,
        notes: collection.notes || "",
        sort_order: collectionIndex,
        created_at: collection.createdAt || timestamp,
        updated_at: collection.lastModifiedAt || collection.updatedAt || timestamp,
        metadata: {
          source: collection.source || "manual",
          timeAccuracy: collection.timeAccuracy || "exact",
          importedAt: collection.importedAt || "",
          importBatchId: collection.importBatchId || ""
        },
        deleted_at: null
      });

      collection.items.forEach((item, itemIndex) => {
        links.push({
          id: item.id,
          user_id: userId,
          collection_id: collection.id,
          title: item.title || item.url,
          url: item.url,
          fav_icon_url: item.favIconUrl || "",
          sort_order: itemIndex,
          created_at: item.addedAt || timestamp,
          updated_at: item.lastOpenedAt || item.lastModifiedAt || item.addedAt || timestamp,
          metadata: {
            source: item.source || "manual",
            timeAccuracy: item.timeAccuracy || "exact",
            importedAt: item.importedAt || "",
            importBatchId: item.importBatchId || "",
            lastOpenedAt: item.lastOpenedAt || ""
          },
          deleted_at: null
        });
      });
    });
  });

  return { settings, spaces, collections, links };
}

async function markDeletedRows(supabase, userId, payload, timestamp) {
  const [remoteSpaces, remoteCollections, remoteLinks] = await Promise.all([
    fetchAllRows(() => supabase.from(TABLES.spaces).select("id").eq("user_id", userId).is("deleted_at", null).order("id")),
    fetchAllRows(() =>
      supabase.from(TABLES.collections).select("id").eq("user_id", userId).is("deleted_at", null).order("id")
    ),
    fetchAllRows(() => supabase.from(TABLES.links).select("id").eq("user_id", userId).is("deleted_at", null).order("id"))
  ]);

  const deletes = [
    markDeletedForTable(supabase, TABLES.links, userId, remoteLinks, payload.links, timestamp),
    markDeletedForTable(supabase, TABLES.collections, userId, remoteCollections, payload.collections, timestamp),
    markDeletedForTable(supabase, TABLES.spaces, userId, remoteSpaces, payload.spaces, timestamp)
  ];

  await Promise.all(deletes);
}

async function fetchAllRows(buildQuery) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + CLOUD_PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);

    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < CLOUD_PAGE_SIZE) {
      break;
    }

    from += CLOUD_PAGE_SIZE;
  }

  return rows;
}

async function markDeletedForTable(supabase, table, userId, remoteRows, localRows, timestamp) {
  const localIds = new Set(localRows.map((row) => row.id));
  const deletedIds = remoteRows.map((row) => row.id).filter((id) => !localIds.has(id));

  if (deletedIds.length === 0) {
    return;
  }

  const { error } = await supabase
    .from(table)
    .update({ deleted_at: timestamp, updated_at: timestamp })
    .eq("user_id", userId)
    .in("id", deletedIds);

  if (error) {
    throw error;
  }
}
