import { createCollection, getActiveSpace, isSaveableUrl, loadDeck, saveDeck, tabToItem } from "./storage.js";

const AUTO_SAVE_ALARM = "tabDeckAutoSave";
const AUTO_SAVE_COLLECTION_NAME = "Auto Saved";
const AUTO_SAVE_COLLECTION_MAX_ITEMS = 500;
const AUTO_SAVE_CONFIG_KEY = "tabDeckAutoSaveConfig";
const AUTO_SAVE_META_KEY = "tabDeckAutoSaveMeta";
const AUTO_SAVE_ALLOWED_INTERVALS = [3, 5, 10, 15];
const AUTO_SAVE_DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 3
};

let captureInFlight = false;
let captureQueued = false;
let autoSaveConfig = { ...AUTO_SAVE_DEFAULT_CONFIG };

void boot();

async function boot() {
  autoSaveConfig = await getAutoSaveConfig();
  await applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    await captureTabsSilently("boot");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshAutoSaveConfig("installed");
});

chrome.runtime.onStartup.addListener(() => {
  void refreshAutoSaveConfig("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_SAVE_ALARM) {
    return;
  }

  if (!autoSaveConfig.enabled) {
    return;
  }

  void captureTabsSilently("alarm");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[AUTO_SAVE_CONFIG_KEY]) {
    return;
  }

  autoSaveConfig = normalizeAutoSaveConfig(changes[AUTO_SAVE_CONFIG_KEY].newValue);
  void applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    void captureTabsSilently("config-changed");
  }
});

async function refreshAutoSaveConfig(reason) {
  autoSaveConfig = await getAutoSaveConfig();
  await applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    await captureTabsSilently(reason);
  }
}

async function applyAutoSaveAlarm() {
  await chrome.alarms.clear(AUTO_SAVE_ALARM);

  if (!autoSaveConfig.enabled) {
    return;
  }

  await chrome.alarms.create(AUTO_SAVE_ALARM, {
    periodInMinutes: autoSaveConfig.intervalMinutes
  });
}

async function captureTabsSilently(reason) {
  if (!autoSaveConfig.enabled) {
    return;
  }

  if (captureInFlight) {
    captureQueued = true;
    return;
  }

  captureInFlight = true;

  try {
    await runCapture(reason);
  } catch (error) {
    console.warn("[Tab Deck] Silent tab capture failed.", error);
  } finally {
    captureInFlight = false;
    if (captureQueued) {
      captureQueued = false;
      void captureTabsSilently("queued");
    }
  }
}

async function runCapture(reason) {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const extensionRoot = chrome.runtime.getURL("");
  const saveableTabs = tabs.filter((tab) => isSaveableUrl(tab.url) && !tab.url.startsWith(extensionRoot));
  const dedupedTabs = dedupeTabsByUrl(saveableTabs);

  if (dedupedTabs.length === 0) {
    return;
  }

  const signature = buildSignature(dedupedTabs);
  const metaResult = await chrome.storage.local.get(AUTO_SAVE_META_KEY);
  const previousSignature = metaResult[AUTO_SAVE_META_KEY]?.signature || "";

  if (signature === previousSignature) {
    return;
  }

  const deck = await loadDeck();
  const activeSpace = getActiveSpace(deck);
  let autoSaveCollection = activeSpace.collections.find((collection) => collection.name === AUTO_SAVE_COLLECTION_NAME);

  if (!autoSaveCollection) {
    autoSaveCollection = createCollection(AUTO_SAVE_COLLECTION_NAME);
    activeSpace.collections.unshift(autoSaveCollection);
  }

  const existingUrls = new Set(autoSaveCollection.items.map((item) => item.url));
  const newItems = dedupedTabs.filter((tab) => !existingUrls.has(tab.url)).map(tabToItem);

  if (newItems.length === 0) {
    await writeAutoSaveMeta(signature, reason);
    return;
  }

  autoSaveCollection.items.unshift(...newItems);
  autoSaveCollection.items = autoSaveCollection.items.slice(0, AUTO_SAVE_COLLECTION_MAX_ITEMS);
  autoSaveCollection.updatedAt = new Date().toISOString();

  await saveDeck(deck);
  await writeAutoSaveMeta(signature, reason);
}

function dedupeTabsByUrl(tabs) {
  const seen = new Set();
  const unique = [];

  for (const tab of tabs) {
    const url = tab.url || "";

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    unique.push(tab);
  }

  return unique;
}

function buildSignature(tabs) {
  return tabs
    .map((tab) => tab.url || "")
    .filter(Boolean)
    .sort()
    .join("\n");
}

async function writeAutoSaveMeta(signature, reason) {
  await chrome.storage.local.set({
    [AUTO_SAVE_META_KEY]: {
      signature,
      lastCapturedAt: new Date().toISOString(),
      lastReason: reason
    }
  });
}

function normalizeAutoSaveConfig(rawConfig) {
  const next = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const parsedInterval = Number(next.intervalMinutes);

  return {
    enabled: typeof next.enabled === "boolean" ? next.enabled : AUTO_SAVE_DEFAULT_CONFIG.enabled,
    intervalMinutes: AUTO_SAVE_ALLOWED_INTERVALS.includes(parsedInterval)
      ? parsedInterval
      : AUTO_SAVE_DEFAULT_CONFIG.intervalMinutes
  };
}

async function getAutoSaveConfig() {
  const result = await chrome.storage.local.get(AUTO_SAVE_CONFIG_KEY);
  return normalizeAutoSaveConfig(result[AUTO_SAVE_CONFIG_KEY]);
}
