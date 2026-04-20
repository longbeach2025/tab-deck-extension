const STORAGE_KEY = "tabDeckData";
const SYNC_META_KEY = "tabDeckSyncMeta";
const SYNC_CHUNK_PREFIX = "tabDeckSyncChunk_";
const SYNC_CHUNK_SIZE = 7000;
const SYNC_SOFT_LIMIT_BYTES = 90000;

let lastStorageStatus = {
  mode: "sync",
  synced: true,
  message: "Chrome sync is active."
};

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
      theme: "system"
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
    settings: { theme: "system", ...(deck.settings || {}) },
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

export async function loadDeck() {
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

  try {
    await writeSyncDeck(normalized);
    setSyncStatus("Chrome sync is active.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    lastStorageStatus = {
      mode: "local",
      synced: false,
      message: `Sync failed; saved locally. ${reason}`
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
    const reason = error instanceof Error ? error.message : String(error);
    lastStorageStatus = {
      mode: "local",
      synced: false,
      message: `Could not read Chrome sync; using local data. ${reason}`
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
    mode: "sync",
    synced: true,
    message
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
