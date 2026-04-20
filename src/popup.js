import {
  createCollection,
  getActiveSpace,
  getStorageStatus,
  isSaveableUrl,
  isDeckStorageChange,
  loadDeck,
  saveDeck,
  tabToItem
} from "./storage.js";

let deck;

const elements = {
  status: document.querySelector("#popupStatus"),
  spaceSelect: document.querySelector("#spaceSelect"),
  collectionSelect: document.querySelector("#collectionSelect"),
  collectionName: document.querySelector("#collectionName"),
  closeAfterSave: document.querySelector("#popupCloseAfterSave"),
  saveTabButton: document.querySelector("#saveTabButton"),
  saveWindowButton: document.querySelector("#saveWindowButton"),
  openDeckButton: document.querySelector("#openDeckButton")
};

init();

async function init() {
  deck = await loadDeck();
  bindEvents();
  bindStorageSyncEvents();
  render();
}

function bindEvents() {
  elements.spaceSelect.addEventListener("change", async () => {
    deck.activeSpaceId = elements.spaceSelect.value;
    await saveDeck(deck);
    renderCollections();
  });

  elements.collectionName.addEventListener("input", () => {
    elements.collectionSelect.disabled = Boolean(elements.collectionName.value.trim());
  });

  elements.saveTabButton.addEventListener("click", saveCurrentTab);
  elements.saveWindowButton.addEventListener("click", saveCurrentWindow);
  elements.openDeckButton.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") }));
}

function bindStorageSyncEvents() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (!isDeckStorageChange(areaName, changes)) {
      return;
    }

    deck = await loadDeck();
    render();
    setStatus(getStorageStatus().message);
  });
}

function render() {
  renderSpaces();
  renderCollections();
  setStatus(getStorageStatus().message);
}

function renderSpaces() {
  elements.spaceSelect.replaceChildren();

  for (const space of deck.spaces) {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.name;
    option.selected = space.id === deck.activeSpaceId;
    elements.spaceSelect.append(option);
  }
}

function renderCollections() {
  const activeSpace = getActiveSpace(deck);
  elements.collectionSelect.replaceChildren();

  for (const collection of activeSpace.collections) {
    const option = document.createElement("option");
    option.value = collection.id;
    option.textContent = collection.name;
    elements.collectionSelect.append(option);
  }
}

async function saveCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !isSaveableUrl(tab.url)) {
    setStatus("This tab cannot be saved.");
    return;
  }

  await saveTabs([tab]);
}

async function saveCurrentWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const extensionRoot = chrome.runtime.getURL("");
  const saveableTabs = tabs.filter((tab) => isSaveableUrl(tab.url) && !tab.url.startsWith(extensionRoot));

  if (saveableTabs.length === 0) {
    setStatus("No saveable tabs found.");
    return;
  }

  await saveTabs(saveableTabs);
}

async function saveTabs(tabs) {
  const collection = getTargetCollection();
  const existingUrls = new Set(collection.items.map((item) => item.url));
  const items = tabs.filter((tab) => !existingUrls.has(tab.url)).map(tabToItem);

  collection.items.unshift(...items);
  collection.updatedAt = new Date().toISOString();
  const status = await saveDeck(deck);

  if (elements.closeAfterSave.checked) {
    await chrome.tabs.remove(tabs.map((tab) => tab.id));
  }

  elements.collectionName.value = "";
  elements.collectionSelect.disabled = false;
  render();
  setStatus(status.synced ? `${items.length} saved and synced.` : `${items.length} saved locally. Sync needs attention.`);
}

function getTargetCollection() {
  const activeSpace = getActiveSpace(deck);
  const newName = elements.collectionName.value.trim();

  if (newName) {
    const collection = createCollection(newName);
    activeSpace.collections.unshift(collection);
    return collection;
  }

  const selected = activeSpace.collections.find((collection) => collection.id === elements.collectionSelect.value);

  if (selected) {
    return selected;
  }

  const fallback = createCollection("Inbox");
  activeSpace.collections.unshift(fallback);
  return fallback;
}

function setStatus(message) {
  elements.status.textContent = message;
}
