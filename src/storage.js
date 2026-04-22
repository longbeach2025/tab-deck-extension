import {
  clearPendingCloudDeck,
  fetchCloudDeck,
  formatCloudError,
  isCloudConfigured,
  isCloudReady,
  pushDeckToCloud,
  queuePendingCloudDeck
} from "./cloud.js";

const STORAGE_KEY = "tabDeckData";
const SYNC_META_KEY = "tabDeckSyncMeta";
const SYNC_CHUNK_PREFIX = "tabDeckSyncChunk_";
const SYNC_CHUNK_SIZE = 7000;
const SYNC_SOFT_LIMIT_BYTES = 90000;
const MAX_TOMBSTONES = 500;

const DEFAULT_STATUS = {
  mode: "sync",
  synced: true,
  message: "Chrome sync is active.",
  lastSyncedAt: null,
  pendingLocalChanges: false,
  lastError: ""
};
let lastStorageStatus = { ...DEFAULT_STATUS };

export function makeId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultDeck() {
  const spaceId = makeId("space");
  const collectionId = makeId("collection");

  return {
    version: 1,
    updatedAt: nowIso(),
    activeSpaceId: spaceId,
    settings: {
      theme: "system",
      recentlyDeleted: [],
      tombstones: []
    },
    spaces: [
      {
        id: spaceId,
        name: "Workspace",
        createdAt: nowIso(),
        collections: [
          {
            id: collectionId,
            name: "Inbox",
            notes: "",
            createdAt: nowIso(),
            updatedAt: nowIso(),
            items: []
          }
        ]
      }
    ]
  };
}

function normalizeDeck(deck) {
  if (!deck || !Array.isArray(deck.spaces) || deck.spaces.length === 0) {
    return defaultDeck();
  }

  const normalized = {
    version: 1,
    updatedAt: deck.updatedAt || nowIso(),
    settings: {
      theme: "system",
      ...(deck.settings || {}),
      recentlyDeleted: normalizeRecentlyDeleted(deck.settings?.recentlyDeleted || []),
      tombstones: normalizeTombstones(deck.settings?.tombstones || [])
    },
    activeSpaceId: deck.activeSpaceId || deck.spaces[0].id,
    spaces: deck.spaces.map((space) => ({
      id: space.id || makeId("space"),
      name: space.name || "Workspace",
      createdAt: space.createdAt || nowIso(),
      collections: Array.isArray(space.collections)
        ? space.collections.map((collection) => ({
            id: collection.id || makeId("collection"),
            name: collection.name || "Untitled",
            notes: collection.notes || "",
            createdAt: collection.createdAt || nowIso(),
            updatedAt: collection.updatedAt || nowIso(),
            items: Array.isArray(collection.items)
              ? collection.items
                  .filter((item) => item && item.url)
                  .map((item) => ({
                    id: item.id || makeId("link"),
                    title: item.title || item.url,
                    url: item.url,
                    favIconUrl: compactFavIconUrl(item.favIconUrl),
                    addedAt: item.addedAt || nowIso()
                  }))
              : []
          }))
        : []
    }))
  };

  if (!normalized.spaces.some((space) => space.id === normalized.activeSpaceId)) {
    normalized.activeSpaceId = normalized.spaces[0].id;
  }

  return normalized;
}

function normalizeRecentlyDeleted(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry && typeof entry === "object" && (entry.type === "collection" || entry.type === "link"))
    .map((entry) => ({
      id: entry.id || makeId("deleted"),
      type: entry.type,
      deletedAt: entry.deletedAt || nowIso(),
      spaceId: entry.spaceId || "",
      collectionId: entry.collectionId || "",
      collection: entry.collection || null,
      link: entry.link || null
    }))
    .slice(0, 50);
}

function tombstoneKey(entry) {
  if (entry.type === "collection") {
    return `collection:${entry.spaceId || ""}:${entry.collectionId || ""}`;
  }

  if (entry.type === "link") {
    return `link:${entry.spaceId || ""}:${entry.collectionId || ""}:${entry.url || ""}`;
  }

  return "";
}

function normalizeTombstones(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalized = entries
    .filter((entry) => entry && typeof entry === "object" && (entry.type === "collection" || entry.type === "link"))
    .map((entry) => ({
      id: entry.id || makeId("tombstone"),
      type: entry.type,
      deletedAt: entry.deletedAt || nowIso(),
      spaceId: entry.spaceId || "",
      collectionId: entry.collectionId || "",
      url: entry.type === "link" ? entry.url || "" : ""
    }))
    .filter((entry) => {
      if (!entry.collectionId) {
        return false;
      }

      if (entry.type === "link" && !entry.url) {
        return false;
      }

      return true;
    })
    .sort((a, b) => safeTs(b.deletedAt) - safeTs(a.deletedAt));

  const map = new Map();

  for (const entry of normalized) {
    const key = tombstoneKey(entry);

    if (!key) {
      continue;
    }

    const existing = map.get(key);

    if (!existing || safeTs(entry.deletedAt) > safeTs(existing.deletedAt)) {
      map.set(key, entry);
    }
  }

  return Array.from(map.values()).sort((a, b) => safeTs(b.deletedAt) - safeTs(a.deletedAt)).slice(0, MAX_TOMBSTONES);
}

function safeTs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseLaterTimestamp(a, b) {
  return safeTs(a) >= safeTs(b) ? (a || b || nowIso()) : (b || a || nowIso());
}

function cloneCollection(collection) {
  return {
    id: collection.id,
    name: collection.name,
    notes: collection.notes,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    items: Array.isArray(collection.items)
      ? collection.items.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          favIconUrl: compactFavIconUrl(item.favIconUrl),
          addedAt: item.addedAt
        }))
      : []
  };
}

function mergeItems(localItems, remoteItems) {
  const merged = new Map();

  for (const item of [...remoteItems, ...localItems]) {
    const key = item.url || item.id;

    if (!key) {
      continue;
    }

    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        id: item.id || makeId("link"),
        title: item.title || item.url || "Untitled",
        url: item.url,
        favIconUrl: compactFavIconUrl(item.favIconUrl),
        addedAt: item.addedAt || nowIso()
      });
      continue;
    }

    const newer = safeTs(item.addedAt) >= safeTs(existing.addedAt) ? item : existing;
    merged.set(key, {
      id: newer.id || existing.id || makeId("link"),
      title: newer.title || existing.title || newer.url || "Untitled",
      url: newer.url || existing.url,
      favIconUrl: compactFavIconUrl(newer.favIconUrl) || compactFavIconUrl(existing.favIconUrl),
      addedAt: chooseLaterTimestamp(newer.addedAt, existing.addedAt)
    });
  }

  return Array.from(merged.values()).sort((a, b) => safeTs(b.addedAt) - safeTs(a.addedAt));
}

function mergeCollections(localCollection, remoteCollection) {
  const preferred = safeTs(localCollection.updatedAt) >= safeTs(remoteCollection.updatedAt) ? localCollection : remoteCollection;
  return {
    id: preferred.id || makeId("collection"),
    name: preferred.name || "Untitled",
    notes: preferred.notes || "",
    createdAt: localCollection.createdAt || remoteCollection.createdAt || nowIso(),
    updatedAt: chooseLaterTimestamp(localCollection.updatedAt, remoteCollection.updatedAt),
    items: mergeItems(localCollection.items || [], remoteCollection.items || [])
  };
}

function mergeSpaceCollections(localSpace, remoteSpace) {
  const mergedCollections = [];
  const remoteById = new Map((remoteSpace.collections || []).map((collection) => [collection.id, cloneCollection(collection)]));
  const seenIds = new Set();

  for (const localCollection of localSpace.collections || []) {
    if (remoteById.has(localCollection.id)) {
      mergedCollections.push(mergeCollections(cloneCollection(localCollection), remoteById.get(localCollection.id)));
      seenIds.add(localCollection.id);
      continue;
    }

    mergedCollections.push(cloneCollection(localCollection));
    seenIds.add(localCollection.id);
  }

  for (const remoteCollection of remoteSpace.collections || []) {
    if (!seenIds.has(remoteCollection.id)) {
      mergedCollections.push(cloneCollection(remoteCollection));
    }
  }

  return mergedCollections.sort((a, b) => safeTs(b.updatedAt) - safeTs(a.updatedAt));
}

function mergeDecks(localDeck, remoteDeck) {
  const local = normalizeDeck(localDeck);
  const remote = normalizeDeck(remoteDeck);
  const mergedSpaces = [];
  const remoteById = new Map(remote.spaces.map((space) => [space.id, space]));
  const seenSpaceIds = new Set();

  for (const localSpace of local.spaces) {
    const remoteSpace = remoteById.get(localSpace.id);

    if (remoteSpace) {
      const mergedCollections = mergeSpaceCollections(localSpace, remoteSpace);
      mergedSpaces.push({
        id: localSpace.id,
        name: localSpace.name || remoteSpace.name || "Workspace",
        createdAt: localSpace.createdAt || remoteSpace.createdAt || nowIso(),
        collections: mergedCollections
      });
      seenSpaceIds.add(localSpace.id);
      continue;
    }

    mergedSpaces.push({
      id: localSpace.id,
      name: localSpace.name || "Workspace",
      createdAt: localSpace.createdAt || nowIso(),
      collections: (localSpace.collections || []).map(cloneCollection)
    });
    seenSpaceIds.add(localSpace.id);
  }

  for (const remoteSpace of remote.spaces) {
    if (!seenSpaceIds.has(remoteSpace.id)) {
      mergedSpaces.push({
        id: remoteSpace.id,
        name: remoteSpace.name || "Workspace",
        createdAt: remoteSpace.createdAt || nowIso(),
        collections: (remoteSpace.collections || []).map(cloneCollection)
      });
    }
  }

  const activeSpaceId =
    mergedSpaces.some((space) => space.id === local.activeSpaceId)
      ? local.activeSpaceId
      : mergedSpaces.some((space) => space.id === remote.activeSpaceId)
        ? remote.activeSpaceId
        : mergedSpaces[0]?.id;

  const mergedRecentlyDeleted = normalizeRecentlyDeleted([
    ...(local.settings?.recentlyDeleted || []),
    ...(remote.settings?.recentlyDeleted || [])
  ]).sort((a, b) => safeTs(b.deletedAt) - safeTs(a.deletedAt));
  const mergedTombstones = normalizeTombstones([...(local.settings?.tombstones || []), ...(remote.settings?.tombstones || [])]);
  const resolvedSpaces = applyTombstones(mergedSpaces, mergedTombstones);

  return normalizeDeck({
    version: 1,
    updatedAt: chooseLaterTimestamp(local.updatedAt, remote.updatedAt),
    activeSpaceId,
    settings: {
      theme: local.settings?.theme || remote.settings?.theme || "system",
      recentlyDeleted: mergedRecentlyDeleted,
      tombstones: mergedTombstones
    },
    spaces: resolvedSpaces
  });
}

function applyTombstones(spaces, tombstones) {
  if (!Array.isArray(spaces) || spaces.length === 0 || !Array.isArray(tombstones) || tombstones.length === 0) {
    return spaces;
  }

  const collectionTombstones = tombstones.filter((entry) => entry.type === "collection");
  const linkTombstones = tombstones.filter((entry) => entry.type === "link");

  return spaces.map((space) => {
    const filteredCollections = (space.collections || [])
      .filter((collection) => {
        return !collectionTombstones.some((entry) => {
          const sameSpace = !entry.spaceId || entry.spaceId === space.id;
          return sameSpace && entry.collectionId === collection.id;
        });
      })
      .map((collection) => {
        const filteredItems = (collection.items || []).filter((item) => {
          return !linkTombstones.some((entry) => {
            const sameSpace = !entry.spaceId || entry.spaceId === space.id;
            const sameCollection = entry.collectionId === collection.id;
            return sameSpace && sameCollection && entry.url === item.url;
          });
        });

        return {
          ...collection,
          items: filteredItems
        };
      });

    return {
      ...space,
      collections: filteredCollections
    };
  });
}

export async function loadDeck() {
  const cloudDeck = await loadCloudDeck();

  if (cloudDeck) {
    return cloudDeck;
  }

  const [localDeck, syncDeck] = await Promise.all([readLocalDeck(), readSyncDeck()]);

  if (localDeck && syncDeck) {
    const localUpdatedAt = Date.parse(localDeck.updatedAt || "");
    const syncUpdatedAt = Date.parse(syncDeck.updatedAt || "");
    const deck = syncUpdatedAt >= localUpdatedAt ? syncDeck : localDeck;

    if (localUpdatedAt > syncUpdatedAt) {
      await saveDeck(deck);
    } else {
      await writeLocalDeck(deck);
      setSyncStatus("Chrome sync is active.");
    }

    return normalizeDeck(deck);
  }

  if (syncDeck) {
    await writeLocalDeck(syncDeck);
    setSyncStatus("Chrome sync is active.");
    return normalizeDeck(syncDeck);
  }

  if (localDeck) {
    await saveDeck(localDeck);
    return normalizeDeck(localDeck);
  }

  const deck = defaultDeck();
  await saveDeck(deck);
  return deck;
}

export async function saveDeck(deck) {
  const normalized = normalizeDeck({
    ...deck,
    updatedAt: nowIso()
  });

  await writeLocalDeck(normalized);

  if (await isCloudConfigured()) {
    try {
      if (!(await isCloudReady())) {
        await queuePendingCloudDeck(normalized);
        lastStorageStatus = {
          ...lastStorageStatus,
          mode: "cloud",
          synced: false,
          message: "Supabase configured; sign in to sync. Saved locally.",
          pendingLocalChanges: true
        };
        return lastStorageStatus;
      }

      await pushDeckToCloud(normalized);
      lastStorageStatus = {
        ...lastStorageStatus,
        mode: "cloud",
        synced: true,
        message: "Supabase cloud sync is active.",
        lastSyncedAt: nowIso(),
        pendingLocalChanges: false,
        lastError: ""
      };
      return lastStorageStatus;
    } catch (error) {
      await queuePendingCloudDeck(normalized);
      const reason = formatCloudError(error);
      lastStorageStatus = {
        ...lastStorageStatus,
        mode: "cloud",
        synced: false,
        message: `Cloud sync failed; saved locally. ${reason}`,
        pendingLocalChanges: true,
        lastError: reason
      };
      console.warn("[Tab Deck] Cloud sync failed; data was saved locally.", error);
      return lastStorageStatus;
    }
  }

  try {
    await writeSyncDeck(normalized);
    setSyncStatus("Chrome sync is active.");
  } catch (error) {
    const reason = formatCloudError(error);
    lastStorageStatus = {
      ...lastStorageStatus,
      mode: "local",
      synced: false,
      message: `Sync failed; saved locally. ${reason}`,
      pendingLocalChanges: true,
      lastError: reason
    };
    console.warn("[Tab Deck] Sync failed; data was saved locally.", error);
  }

  return lastStorageStatus;
}

async function readLocalDeck() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ? normalizeDeck(result[STORAGE_KEY]) : null;
}

async function writeLocalDeck(deck) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeDeck(deck) });
}

async function readSyncDeck() {
  try {
    const metaResult = await chrome.storage.sync.get(SYNC_META_KEY);
    const meta = metaResult[SYNC_META_KEY];

    if (!meta || !Array.isArray(meta.chunks) || meta.chunks.length === 0) {
      return null;
    }

    const chunkResult = await chrome.storage.sync.get(meta.chunks);
    const payload = meta.chunks.map((key) => chunkResult[key] || "").join("");

    if (!payload) {
      return null;
    }

    setSyncStatus("Chrome sync is active.");
    return normalizeDeck(JSON.parse(payload));
  } catch (error) {
    const reason = formatCloudError(error);
    lastStorageStatus = {
      ...lastStorageStatus,
      mode: "local",
      synced: false,
      message: `Could not read Chrome sync; using local data. ${reason}`,
      lastError: reason
    };
    console.warn("[Tab Deck] Could not read Chrome sync.", error);
    return null;
  }
}

async function writeSyncDeck(deck) {
  const normalized = normalizeDeck(deck);
  const payload = JSON.stringify(normalized);
  const payloadSize = byteLength(payload);

  if (payloadSize > SYNC_SOFT_LIMIT_BYTES) {
    throw new Error("Saved deck is too large for Chrome sync. Use export or a backend for larger archives.");
  }

  const previousMetaResult = await chrome.storage.sync.get(SYNC_META_KEY);
  const previousChunks = previousMetaResult[SYNC_META_KEY]?.chunks || [];
  const chunks = splitPayload(payload);
  const chunkKeys = chunks.map((_, index) => `${SYNC_CHUNK_PREFIX}${index}`);
  const values = {
    [SYNC_META_KEY]: {
      version: normalized.version,
      updatedAt: normalized.updatedAt,
      byteLength: payloadSize,
      chunks: chunkKeys
    }
  };

  chunks.forEach((chunk, index) => {
    values[chunkKeys[index]] = chunk;
  });

  await chrome.storage.sync.set(values);

  const staleChunks = previousChunks.filter((key) => !chunkKeys.includes(key));

  if (staleChunks.length > 0) {
    await chrome.storage.sync.remove(staleChunks);
  }
}

function splitPayload(payload) {
  const chunks = [];

  for (let index = 0; index < payload.length; index += SYNC_CHUNK_SIZE) {
    chunks.push(payload.slice(index, index + SYNC_CHUNK_SIZE));
  }

  return chunks;
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function setSyncStatus(message) {
  lastStorageStatus = {
    ...lastStorageStatus,
    mode: "sync",
    synced: true,
    message,
    lastSyncedAt: nowIso(),
    pendingLocalChanges: false,
    lastError: ""
  };
}

export function getStorageStatus() {
  return lastStorageStatus;
}

export function isDeckStorageChange(areaName, changes) {
  if (areaName !== "sync") {
    return false;
  }

  return Object.keys(changes).some((key) => key === SYNC_META_KEY || key.startsWith(SYNC_CHUNK_PREFIX));
}

export async function syncDeckWithCloud() {
  const cloudDeck = await loadCloudDeck();
  return cloudDeck || loadDeck();
}

async function loadCloudDeck() {
  if (!(await isCloudConfigured())) {
    return null;
  }

  if (!(await isCloudReady())) {
    lastStorageStatus = {
      ...lastStorageStatus,
      mode: "cloud",
      synced: false,
      message: "Supabase configured; sign in to sync."
    };
    return null;
  }

  try {
    const [localDeck, remoteDeck] = await Promise.all([readLocalDeck(), fetchCloudDeck()]);

    if (remoteDeck && localDeck) {
      const localIsStarter = isStarterDeck(localDeck);
      const remoteIsStarter = isStarterDeck(remoteDeck);

      if (localIsStarter && !remoteIsStarter) {
        await writeLocalDeck(remoteDeck);
        await clearPendingCloudDeck();
        setCloudStatus("Supabase cloud sync is active.");
        return normalizeDeck(remoteDeck);
      }

      if (!localIsStarter && remoteIsStarter) {
        await pushDeckToCloud(localDeck);
        setCloudStatus("Supabase cloud sync is active.");
        return normalizeDeck(localDeck);
      }

      const mergedDeck = mergeDecks(localDeck, remoteDeck);
      await writeLocalDeck(mergedDeck);
      await pushDeckToCloud(mergedDeck);
      await clearPendingCloudDeck();
      setCloudStatus("Supabase cloud sync is active. Merged local and cloud changes.");
      return mergedDeck;
    }

    if (remoteDeck) {
      await writeLocalDeck(remoteDeck);
      setCloudStatus("Supabase cloud sync is active.");
      return normalizeDeck(remoteDeck);
    }

    if (localDeck) {
      await pushDeckToCloud(localDeck);
      setCloudStatus("Migrated local deck to Supabase.");
      return normalizeDeck(localDeck);
    }

    const deck = defaultDeck();
    await writeLocalDeck(deck);
    await pushDeckToCloud(deck);
    setCloudStatus("Supabase cloud sync is active.");
    return normalizeDeck(deck);
  } catch (error) {
    const reason = formatCloudError(error);
    lastStorageStatus = {
      ...lastStorageStatus,
      mode: "cloud",
      synced: false,
      message: `Cloud sync unavailable; using local data. ${reason}`,
      lastError: reason
    };
    console.warn("[Tab Deck] Cloud sync unavailable.", error);
    return null;
  }
}

function setCloudStatus(message) {
  lastStorageStatus = {
    ...lastStorageStatus,
    mode: "cloud",
    synced: true,
    message,
    lastSyncedAt: nowIso(),
    pendingLocalChanges: false,
    lastError: ""
  };
}

function isStarterDeck(deck) {
  const normalized = normalizeDeck(deck);

  if (countItems(normalized) > 0 || normalized.spaces.length !== 1) {
    return false;
  }

  const [space] = normalized.spaces;

  if (space.name !== "Workspace" || space.collections.length !== 1) {
    return false;
  }

  const [collection] = space.collections;
  return collection.name === "Inbox" && !collection.notes && collection.items.length === 0;
}

export function getActiveSpace(deck) {
  return deck.spaces.find((space) => space.id === deck.activeSpaceId) || deck.spaces[0];
}

export function createCollection(name, items = []) {
  return {
    id: makeId("collection"),
    name: name || "Untitled",
    notes: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    items
  };
}

export function tabToItem(tab) {
  return {
    id: makeId("link"),
    title: tab.title || tab.url || "Untitled",
    url: tab.url,
    favIconUrl: compactFavIconUrl(tab.favIconUrl),
    addedAt: nowIso()
  };
}

function compactFavIconUrl(favIconUrl) {
  if (!favIconUrl || favIconUrl.length > 512 || favIconUrl.startsWith("data:")) {
    return "";
  }

  return favIconUrl;
}

export function isSaveableUrl(url) {
  if (!url) {
    return false;
  }

  return /^(https?:|file:)/.test(url);
}

export function getHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function countItems(deck) {
  return deck.spaces.reduce(
    (total, space) =>
      total +
      space.collections.reduce((spaceTotal, collection) => spaceTotal + collection.items.length, 0),
    0
  );
}

export function serializeDeck(deck) {
  return JSON.stringify(normalizeDeck(deck), null, 2);
}

function parseImportJson(rawJson) {
  try {
    return JSON.parse(rawJson);
  } catch {
    throw new Error("Import file is not valid JSON.");
  }
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

function parseTobyImportObject(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lists)) {
    return null;
  }

  const collections = parsed.lists
    .filter((list) => list && typeof list === "object")
    .map((list) => {
      const seenUrls = new Set();
      const cards = Array.isArray(list.cards) ? list.cards : [];
      const labels = Array.isArray(list.labels) ? list.labels.map(readTobyLabel).filter(Boolean) : [];
      const notes = labels.length > 0 ? `Imported from Toby. Labels: ${labels.join(", ")}` : "Imported from Toby.";
      const items = cards
        .map((card) => ({
          url: typeof card?.url === "string" ? card.url.trim() : "",
          title:
            (typeof card?.customTitle === "string" && card.customTitle.trim()) ||
            (typeof card?.title === "string" && card.title.trim()) ||
            ""
        }))
        .filter((card) => {
          if (!isSaveableUrl(card.url)) {
            return false;
          }

          if (seenUrls.has(card.url)) {
            return false;
          }

          seenUrls.add(card.url);
          return true;
        });

      return {
        name: typeof list.title === "string" && list.title.trim() ? list.title.trim() : "Untitled Toby List",
        notes,
        items
      };
    });

  const totalItems = collections.reduce((sum, collection) => sum + collection.items.length, 0);

  if (collections.length === 0 || totalItems === 0) {
    throw new Error("Toby export was detected, but no valid links were found.");
  }

  return {
    version: parsed.version,
    collections,
    stats: {
      collectionCount: collections.length,
      itemCount: totalItems
    }
  };
}

export function buildSpaceFromTobyImport(tobyImport, spaceName = "") {
  const importedAt = nowIso();
  const resolvedName = spaceName?.trim() || `Toby Import ${new Date(importedAt).toLocaleDateString()}`;

  return {
    id: makeId("space"),
    name: resolvedName,
    createdAt: importedAt,
    collections: tobyImport.collections.map((collection) => ({
      id: makeId("collection"),
      name: collection.name,
      notes: collection.notes,
      createdAt: importedAt,
      updatedAt: importedAt,
      items: collection.items.map((item) => ({
        id: makeId("link"),
        title: item.title || item.url,
        url: item.url,
        favIconUrl: "",
        addedAt: importedAt
      }))
    }))
  };
}

export function parseImportPayload(rawJson) {
  const parsed = parseImportJson(rawJson);

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.spaces)) {
    return {
      source: "tab-deck",
      deck: normalizeDeck(parsed)
    };
  }

  const tobyImport = parseTobyImportObject(parsed);

  if (tobyImport) {
    return {
      source: "toby",
      tobyImport
    };
  }

  throw new Error("Import file format is not supported. Use a Tab Deck backup JSON or Toby export JSON.");
}

export function parseDeckImport(rawJson) {
  const payload = parseImportPayload(rawJson);

  if (payload.source !== "tab-deck") {
    throw new Error("Import file does not look like a Tab Deck backup.");
  }

  return payload.deck;
}
