import { captureTabsToSessionBuffer, isSaveableUrl } from "./storage.js";

const AUTO_SAVE_ALARM = "tabDeckAutoSave";
const AUTO_SAVE_CONFIG_KEY = "tabDeckAutoSaveConfig";
const AUTO_SAVE_META_KEY = "tabDeckAutoSaveMeta";
const AUTO_SAVE_ALLOWED_INTERVALS = [3, 5, 10, 15];
const AUTO_SAVE_DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 3
};
const CAPTURE_DEBOUNCE_MS = 1200;

let captureInFlight = false;
let captureQueued = false;
let captureTimer = null;
let queuedReason = "";
let autoSaveConfig = { ...AUTO_SAVE_DEFAULT_CONFIG };

void boot();

async function boot() {
  autoSaveConfig = await getAutoSaveConfig();
  await applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    scheduleCapture("boot");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshAutoSaveConfig("installed");
});

chrome.runtime.onStartup.addListener(() => {
  void refreshAutoSaveConfig("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SAVE_ALARM && autoSaveConfig.enabled) {
    scheduleCapture("alarm");
  }
});

chrome.tabs.onCreated.addListener(() => {
  scheduleCapture("tabs.onCreated");
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    scheduleCapture("tabs.onUpdated");
  }
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleCapture("tabs.onRemoved");
});

chrome.tabs.onActivated.addListener(() => {
  scheduleCapture("tabs.onActivated");
});

chrome.windows.onFocusChanged.addListener(() => {
  scheduleCapture("windows.onFocusChanged");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[AUTO_SAVE_CONFIG_KEY]) {
    return;
  }

  autoSaveConfig = normalizeAutoSaveConfig(changes[AUTO_SAVE_CONFIG_KEY].newValue);
  void applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    scheduleCapture("config-changed");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "tabDeck.captureTabsNow") {
    return false;
  }

  void captureTabsNow(message.reason || "manual-message")
    .then((meta) => sendResponse({ ok: true, meta }))
    .catch((error) => {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});

async function refreshAutoSaveConfig(reason) {
  autoSaveConfig = await getAutoSaveConfig();
  await applyAutoSaveAlarm();

  if (autoSaveConfig.enabled) {
    scheduleCapture(reason);
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

function scheduleCapture(reason) {
  if (!autoSaveConfig.enabled) {
    return;
  }

  queuedReason = reason || queuedReason || "scheduled";

  if (captureTimer) {
    clearTimeout(captureTimer);
  }

  captureTimer = setTimeout(() => {
    captureTimer = null;
    void captureTabsNow(queuedReason || "scheduled");
    queuedReason = "";
  }, CAPTURE_DEBOUNCE_MS);
}

async function captureTabsNow(reason) {
  if (!autoSaveConfig.enabled) {
    const meta = {
      reason,
      status: "skipped",
      skipReason: "disabled",
      tabCount: 0,
      saveableCount: 0,
      capturedCount: 0,
      newCount: 0,
      signature: ""
    };
    await writeAutoSaveMeta(meta);
    return meta;
  }

  if (captureInFlight) {
    captureQueued = true;
    return {
      reason,
      status: "queued",
      tabCount: 0,
      saveableCount: 0,
      capturedCount: 0,
      newCount: 0
    };
  }

  captureInFlight = true;

  try {
    const meta = await runCapture(reason);
    return meta;
  } catch (error) {
    console.warn("[Tab Deck] Session buffer capture failed.", error);
    const meta = {
      reason,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      tabCount: 0,
      saveableCount: 0,
      capturedCount: 0,
      newCount: 0,
      signature: ""
    };
    await writeAutoSaveMeta(meta);
    return meta;
  } finally {
    captureInFlight = false;
    if (captureQueued) {
      captureQueued = false;
      scheduleCapture("queued");
    }
  }
}

async function runCapture(reason) {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const extensionRoot = chrome.runtime.getURL("");
  const saveableTabs = tabs.filter((tab) => isSaveableUrl(tab.url) && !tab.url.startsWith(extensionRoot));
  const uniqueTabs = dedupeTabsByUrl(saveableTabs);
  const signature = buildSignature(uniqueTabs);
  const buffer = await captureTabsToSessionBuffer(uniqueTabs, { reason });
  const meta = {
    reason,
    status: uniqueTabs.length > 0 ? "saved" : "skipped",
    skipReason: uniqueTabs.length > 0 ? "" : "no-saveable-tabs",
    tabCount: tabs.length,
    saveableCount: saveableTabs.length,
    capturedCount: uniqueTabs.length,
    newCount: Number.isFinite(buffer.inserted) ? buffer.inserted : uniqueTabs.length,
    signature
  };

  await writeAutoSaveMeta(meta);
  return {
    ...meta,
    bufferUpdatedAt: buffer.updatedAt
  };
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

async function writeAutoSaveMeta(meta) {
  await chrome.storage.local.set({
    [AUTO_SAVE_META_KEY]: {
      signature: meta.signature || "",
      lastCapturedAt: new Date().toISOString(),
      lastReason: meta.reason,
      status: meta.status || "saved",
      skipReason: meta.skipReason || "",
      error: meta.error || "",
      tabCount: Number.isFinite(meta.tabCount) ? meta.tabCount : 0,
      saveableCount: Number.isFinite(meta.saveableCount) ? meta.saveableCount : 0,
      capturedCount: Number.isFinite(meta.capturedCount) ? meta.capturedCount : 0,
      newCount: Number.isFinite(meta.newCount) ? meta.newCount : 0
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
