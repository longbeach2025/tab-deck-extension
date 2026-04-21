import {
  countItems,
  createCollection,
  getActiveSpace,
  getHost,
  getStorageStatus,
  isSaveableUrl,
  isDeckStorageChange,
  loadDeck,
  makeId,
  refreshDeckFromCloud,
  saveDeck,
  tabToItem
} from "./storage.js";
import {
  getCloudConfig,
  getCloudUser,
  saveCloudConfig,
  signInCloud,
  signOutCloud,
  signUpCloud
} from "./cloud.js";

let deck;
let liveTabs = [];
let selectedTabIds = new Set();
let query = "";

const elements = {
  deckStats: document.querySelector("#deckStats"),
  cloudStatus: document.querySelector("#cloudStatus"),
  cloudUrlInput: document.querySelector("#cloudUrlInput"),
  cloudAnonKeyInput: document.querySelector("#cloudAnonKeyInput"),
  cloudEmailInput: document.querySelector("#cloudEmailInput"),
  cloudPasswordInput: document.querySelector("#cloudPasswordInput"),
  saveCloudConfigButton: document.querySelector("#saveCloudConfigButton"),
  signInCloudButton: document.querySelector("#signInCloudButton"),
  signUpCloudButton: document.querySelector("#signUpCloudButton"),
  signOutCloudButton: document.querySelector("#signOutCloudButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
  searchInput: document.querySelector("#searchInput"),
  spaceList: document.querySelector("#spaceList"),
  addSpaceButton: document.querySelector("#addSpaceButton"),
  refreshTabsButton: document.querySelector("#refreshTabsButton"),
  saveSelectedButton: document.querySelector("#saveSelectedButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  closeAfterSave: document.querySelector("#closeAfterSave"),
  liveTabs: document.querySelector("#liveTabs"),
  activeSpaceMeta: document.querySelector("#activeSpaceMeta"),
  activeSpaceName: document.querySelector("#activeSpaceName"),
  renameSpaceButton: document.querySelector("#renameSpaceButton"),
  deleteSpaceButton: document.querySelector("#deleteSpaceButton"),
  newCollectionButton: document.querySelector("#newCollectionButton"),
  emptyCreateButton: document.querySelector("#emptyCreateButton"),
  emptyState: document.querySelector("#emptyState"),
  collectionGrid: document.querySelector("#collectionGrid"),
  collectionTemplate: document.querySelector("#collectionTemplate")
};

init();

async function init() {
  deck = await loadDeck();
  await refreshLiveTabs();
  bindEvents();
  bindStorageSyncEvents();
  render();
  await renderCloudControls();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    renderCollections();
  });

  elements.addSpaceButton.addEventListener("click", addSpace);
  elements.refreshTabsButton.addEventListener("click", refreshAndRenderLiveTabs);
  elements.saveSelectedButton.addEventListener("click", saveSelectedTabs);
  elements.saveAllButton.addEventListener("click", saveAllTabs);
  elements.newCollectionButton.addEventListener("click", addCollection);
  elements.emptyCreateButton.addEventListener("click", addCollection);
  elements.renameSpaceButton.addEventListener("click", renameActiveSpace);
  elements.deleteSpaceButton.addEventListener("click", deleteActiveSpace);
  elements.saveCloudConfigButton.addEventListener("click", saveCloudSettings);
  elements.signInCloudButton.addEventListener("click", signInToCloud);
  elements.signUpCloudButton.addEventListener("click", signUpForCloud);
  elements.signOutCloudButton.addEventListener("click", signOutOfCloud);
  elements.syncNowButton.addEventListener("click", syncNow);
}

function bindStorageSyncEvents() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (!isDeckStorageChange(areaName, changes)) {
      return;
    }

    deck = await loadDeck();
    render();
  });
}

async function refreshLiveTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const extensionRoot = chrome.runtime.getURL("");

  liveTabs = tabs
    .filter((tab) => isSaveableUrl(tab.url) && !tab.url.startsWith(extensionRoot))
    .sort((a, b) => a.index - b.index);

  selectedTabIds = new Set(liveTabs.map((tab) => tab.id));
}

async function refreshAndRenderLiveTabs() {
  await refreshLiveTabs();
  renderLiveTabs();
}

function render() {
  renderStats();
  renderSpaces();
  renderHeader();
  renderLiveTabs();
  renderCollections();
}

function renderStats() {
  const status = getStorageStatus();
  const syncLabel =
    status.mode === "cloud" ? (status.synced ? "Supabase sync on" : "Cloud pending") : status.synced ? "Chrome sync on" : "Local fallback";
  elements.deckStats.textContent = `${deck.spaces.length} spaces, ${countItems(deck)} saved links · ${syncLabel}`;
  elements.deckStats.title = status.message;

  if (elements.cloudStatus) {
    elements.cloudStatus.textContent = status.message;
    elements.cloudStatus.classList.toggle("warning", !status.synced);
  }
}

async function renderCloudControls() {
  const config = await getCloudConfig();
  const user = await getCloudUser().catch(() => null);
  elements.cloudUrlInput.value = config.supabaseUrl;
  elements.cloudAnonKeyInput.value = config.anonKey;
  elements.cloudStatus.textContent = user ? `Signed in as ${user.email || user.id}` : getStorageStatus().message;
  elements.signOutCloudButton.disabled = !user;
  elements.syncNowButton.disabled = !user;
}

function renderSpaces() {
  elements.spaceList.replaceChildren();

  for (const space of deck.spaces) {
    const button = document.createElement("button");
    button.className = `space-button ${space.id === deck.activeSpaceId ? "active" : ""}`;
    button.type = "button";
    button.dataset.spaceId = space.id;

    const name = document.createElement("span");
    name.textContent = space.name;

    const count = document.createElement("small");
    count.textContent = `${space.collections.length}`;

    button.append(name, count);
    button.addEventListener("click", async () => {
      deck.activeSpaceId = space.id;
      await persistAndRender();
    });

    elements.spaceList.append(button);
  }
}

function renderHeader() {
  const activeSpace = getActiveSpace(deck);
  const linkCount = activeSpace.collections.reduce((total, collection) => total + collection.items.length, 0);
  elements.activeSpaceName.textContent = activeSpace.name;
  elements.activeSpaceMeta.textContent = `${activeSpace.collections.length} collections, ${linkCount} links`;
  elements.deleteSpaceButton.disabled = deck.spaces.length <= 1;
}

function renderLiveTabs() {
  elements.liveTabs.replaceChildren();

  if (liveTabs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No saveable tabs in this window.";
    elements.liveTabs.append(empty);
    return;
  }

  for (const tab of liveTabs) {
    const row = document.createElement("label");
    row.className = "live-tab";
    row.draggable = true;
    row.dataset.tabId = String(tab.id);

    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-tabdeck-tab-id", String(tab.id));
      event.dataTransfer.effectAllowed = "copy";
    });

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = selectedTabIds.has(tab.id);
    check.addEventListener("change", () => {
      if (check.checked) {
        selectedTabIds.add(tab.id);
      } else {
        selectedTabIds.delete(tab.id);
      }
    });

    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.alt = "";
    icon.src = tab.favIconUrl || "";
    icon.addEventListener("error", () => icon.removeAttribute("src"));

    const textWrap = document.createElement("span");
    textWrap.className = "tab-text";

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url;

    const host = document.createElement("span");
    host.className = "tab-host";
    host.textContent = getHost(tab.url);

    textWrap.append(title, host);
    row.append(check, icon, textWrap);
    elements.liveTabs.append(row);
  }
}

function renderCollections() {
  const activeSpace = getActiveSpace(deck);
  elements.collectionGrid.replaceChildren();

  const filteredCollections = activeSpace.collections
    .map((collection) => ({
      collection,
      items: filterItems(collection)
    }))
    .filter(({ collection, items }) => {
      if (!query) {
        return true;
      }

      return collection.name.toLowerCase().includes(query) || collection.notes.toLowerCase().includes(query) || items.length;
    });

  elements.emptyState.classList.toggle("hidden", activeSpace.collections.length > 0);

  for (const { collection, items } of filteredCollections) {
    elements.collectionGrid.append(renderCollectionCard(collection, items));
  }

  if (activeSpace.collections.length > 0 && filteredCollections.length === 0) {
    const noResults = document.createElement("p");
    noResults.className = "no-results";
    noResults.textContent = "No matching collections or links.";
    elements.collectionGrid.append(noResults);
  }
}

function renderCollectionCard(collection, visibleItems) {
  const fragment = elements.collectionTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".collection-card");
  const nameInput = fragment.querySelector(".collection-name");
  const notesInput = fragment.querySelector(".collection-notes");
  const openAllButton = fragment.querySelector(".open-all");
  const deleteButton = fragment.querySelector(".delete-collection");
  const form = fragment.querySelector(".add-link-form");
  const titleInput = fragment.querySelector(".link-title-input");
  const urlInput = fragment.querySelector(".link-url-input");
  const dropZone = fragment.querySelector(".drop-zone");
  const linkList = fragment.querySelector(".link-list");

  card.dataset.collectionId = collection.id;
  nameInput.value = collection.name;
  notesInput.value = collection.notes;
  openAllButton.disabled = collection.items.length === 0;

  nameInput.addEventListener("change", async () => {
    collection.name = nameInput.value.trim() || "Untitled";
    collection.updatedAt = new Date().toISOString();
    await persistAndRender();
  });

  notesInput.addEventListener("change", async () => {
    collection.notes = notesInput.value.trim();
    collection.updatedAt = new Date().toISOString();
    await persistAndRender();
  });

  openAllButton.addEventListener("click", () => openCollection(collection));
  deleteButton.addEventListener("click", () => deleteCollection(collection.id));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = normalizeUrl(urlInput.value.trim());

    if (!url) {
      urlInput.focus();
      return;
    }

    collection.items.unshift({
      id: makeId("link"),
      title: titleInput.value.trim() || getHost(url),
      url,
      favIconUrl: "",
      addedAt: new Date().toISOString()
    });
    collection.updatedAt = new Date().toISOString();
    titleInput.value = "";
    urlInput.value = "";
    await persistAndRender();
  });

  for (const target of [dropZone, card]) {
    target.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer.types || []);

      if (types.includes("application/x-tabdeck-tab-id")) {
        event.preventDefault();
        card.classList.add("drag-over");
      }
    });

    target.addEventListener("dragleave", () => card.classList.remove("drag-over"));

    target.addEventListener("drop", async (event) => {
      const tabId = Number(event.dataTransfer.getData("application/x-tabdeck-tab-id"));
      const tab = liveTabs.find((candidate) => candidate.id === tabId);
      card.classList.remove("drag-over");

      if (tab) {
        await addTabsToCollection([tab], collection);
      }
    });
  }

  for (const item of visibleItems) {
    linkList.append(renderLinkRow(item, collection));
  }

  if (visibleItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted compact";
    empty.textContent = collection.items.length === 0 ? "No links yet." : "No links match search.";
    linkList.append(empty);
  }

  return fragment;
}

function renderLinkRow(item, collection) {
  const row = document.createElement("div");
  row.className = "link-row";

  const link = document.createElement("a");
  link.href = item.url;
  link.title = item.url;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: item.url });
  });

  const icon = document.createElement("img");
  icon.className = "favicon";
  icon.alt = "";
  icon.src = item.favIconUrl || faviconFromUrl(item.url);
  icon.addEventListener("error", () => icon.removeAttribute("src"));

  const text = document.createElement("span");
  text.className = "tab-text";

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = item.title || item.url;

  const host = document.createElement("span");
  host.className = "tab-host";
  host.textContent = getHost(item.url);

  text.append(title, host);
  link.append(icon, text);

  const removeButton = document.createElement("button");
  removeButton.className = "icon-button";
  removeButton.type = "button";
  removeButton.title = "Remove link";
  removeButton.setAttribute("aria-label", "Remove link");
  removeButton.textContent = "X";
  removeButton.addEventListener("click", async () => {
    collection.items = collection.items.filter((candidate) => candidate.id !== item.id);
    collection.updatedAt = new Date().toISOString();
    await persistAndRender();
  });

  row.append(link, removeButton);
  return row;
}

function filterItems(collection) {
  if (!query) {
    return collection.items;
  }

  return collection.items.filter((item) => {
    return [item.title, item.url, getHost(item.url)].some((value) => value.toLowerCase().includes(query));
  });
}

async function addSpace() {
  const name = prompt("Space name");

  if (!name || !name.trim()) {
    return;
  }

  const space = {
    id: makeId("space"),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    collections: [createCollection("Inbox")]
  };

  deck.spaces.unshift(space);
  deck.activeSpaceId = space.id;
  await persistAndRender();
}

async function renameActiveSpace() {
  const activeSpace = getActiveSpace(deck);
  const name = prompt("Rename space", activeSpace.name);

  if (!name || !name.trim()) {
    return;
  }

  activeSpace.name = name.trim();
  await persistAndRender();
}

async function deleteActiveSpace() {
  if (deck.spaces.length <= 1) {
    return;
  }

  const activeSpace = getActiveSpace(deck);
  const confirmed = confirm(`Delete "${activeSpace.name}" and all collections inside it?`);

  if (!confirmed) {
    return;
  }

  deck.spaces = deck.spaces.filter((space) => space.id !== activeSpace.id);
  deck.activeSpaceId = deck.spaces[0].id;
  await persistAndRender();
}

async function addCollection() {
  const name = prompt("Collection name", "New collection");

  if (!name || !name.trim()) {
    return;
  }

  getActiveSpace(deck).collections.unshift(createCollection(name.trim()));
  await persistAndRender();
}

async function deleteCollection(collectionId) {
  const activeSpace = getActiveSpace(deck);
  const collection = activeSpace.collections.find((candidate) => candidate.id === collectionId);

  if (!collection) {
    return;
  }

  const confirmed = confirm(`Delete "${collection.name}"?`);

  if (!confirmed) {
    return;
  }

  activeSpace.collections = activeSpace.collections.filter((candidate) => candidate.id !== collectionId);
  await persistAndRender();
}

async function saveSelectedTabs() {
  const tabs = liveTabs.filter((tab) => selectedTabIds.has(tab.id));
  await saveTabsFlow(tabs);
}

async function saveAllTabs() {
  await saveTabsFlow(liveTabs);
}

async function saveTabsFlow(tabs) {
  if (tabs.length === 0) {
    return;
  }

  const activeSpace = getActiveSpace(deck);
  const defaultName = `${new Date().toLocaleDateString()} session`;
  const collectionName = prompt("Save tabs to collection", defaultName);

  if (!collectionName || !collectionName.trim()) {
    return;
  }

  const collection = createCollection(collectionName.trim());
  activeSpace.collections.unshift(collection);
  await addTabsToCollection(tabs, collection, { closeAfterSave: elements.closeAfterSave.checked });
}

async function addTabsToCollection(tabs, collection, options = {}) {
  const existingUrls = new Set(collection.items.map((item) => item.url));
  const items = tabs
    .filter((tab) => isSaveableUrl(tab.url) && !existingUrls.has(tab.url))
    .map(tabToItem);

  collection.items.unshift(...items);
  collection.updatedAt = new Date().toISOString();
  await persistAndRender();

  if (options.closeAfterSave && tabs.length > 0) {
    await chrome.tabs.remove(tabs.map((tab) => tab.id));
    await refreshAndRenderLiveTabs();
  }
}

async function openCollection(collection) {
  for (const item of collection.items) {
    await chrome.tabs.create({ url: item.url, active: false });
  }
}

async function persistAndRender() {
  await saveDeck(deck);
  render();
}

async function saveCloudSettings() {
  await runCloudAction(async () => {
    await saveCloudConfig({
      supabaseUrl: elements.cloudUrlInput.value,
      anonKey: elements.cloudAnonKeyInput.value
    });
    deck = await loadDeck();
    return "Supabase config saved. Sign in to sync.";
  });
}

async function signInToCloud() {
  await runCloudAction(async () => {
    await signInCloud(elements.cloudEmailInput.value.trim(), elements.cloudPasswordInput.value);
    deck = await refreshDeckFromCloud();
    elements.cloudPasswordInput.value = "";
    return "Signed in and synced.";
  });
}

async function signUpForCloud() {
  await runCloudAction(async () => {
    const result = await signUpCloud(elements.cloudEmailInput.value.trim(), elements.cloudPasswordInput.value);
    elements.cloudPasswordInput.value = "";

    if (result.session) {
      deck = await refreshDeckFromCloud();
      return "Signed up and synced.";
    }

    return "Account created. Check your email to confirm, then sign in.";
  });
}

async function signOutOfCloud() {
  await runCloudAction(async () => {
    await signOutCloud();
    deck = await loadDeck();
    return "Signed out. Sign in to resume Supabase sync.";
  });
}

async function syncNow() {
  await runCloudAction(async () => {
    deck = await refreshDeckFromCloud();
    return "Synced from Supabase.";
  });
}

async function runCloudAction(action) {
  setCloudBusy(true);
  let finalMessage = "";
  let isWarning = false;

  try {
    const message = await action();
    render();
    finalMessage = message || "";
  } catch (error) {
    finalMessage = error instanceof Error ? error.message : String(error);
    isWarning = true;
  } finally {
    setCloudBusy(false);
    await renderCloudControls();

    if (finalMessage) {
      showCloudMessage(finalMessage, isWarning);
    }
  }
}

function showCloudMessage(message, isWarning = false) {
  elements.cloudStatus.textContent = message;
  elements.cloudStatus.classList.toggle("warning", isWarning);
}

function setCloudBusy(isBusy) {
  for (const button of [
    elements.saveCloudConfigButton,
    elements.signInCloudButton,
    elements.signUpCloudButton,
    elements.signOutCloudButton,
    elements.syncNowButton
  ]) {
    button.disabled = isBusy;
  }
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  const candidate = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;

  try {
    const url = new URL(candidate);
    if (!isSaveableUrl(url.href)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function faviconFromUrl(url) {
  try {
    const host = new URL(url).origin;
    return `${host}/favicon.ico`;
  } catch {
    return "";
  }
}
