import {
  buildSpaceFromTobyImport,
  countItems,
  createCollection,
  getActiveSpace,
  getHost,
  parseImportPayload,
  getStorageStatus,
  isSaveableUrl,
  isDeckStorageChange,
  loadDeck,
  makeId,
  serializeDeck,
  syncDeckWithCloud,
  saveDeck,
  tabToItem
} from "./storage.js";
import {
  getCloudConfig,
  getCloudUser,
  formatCloudError,
  saveCloudConfig,
  signInCloud,
  signOutCloud,
  signUpCloud
} from "./cloud.js";

let deck;
let liveTabs = [];
let selectedTabIds = new Set();
let query = "";
const searchFilters = {
  spaceId: "all",
  collection: "",
  host: "",
  timeSource: "all",
  dateFrom: "",
  dateTo: "",
  sortBy: "recent_activity"
};
const MAX_RECENTLY_DELETED = 50;
const MAX_TOMBSTONES = 500;
const AUTO_SAVE_COLLECTION_NAME = "Auto Saved";
const AUTO_SAVE_CONFIG_KEY = "tabDeckAutoSaveConfig";
const AUTO_SAVE_META_KEY = "tabDeckAutoSaveMeta";
const AUTO_SAVE_INTERVAL_OPTIONS = [3, 5, 10, 15];
const AUTO_SAVE_DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 3
};
const TITLE_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "will",
  "would",
  "could",
  "should",
  "about",
  "into",
  "http",
  "https",
  "www",
  "com",
  "net",
  "org",
  "html",
  "php",
  "amp",
  "news"
]);

const elements = {
  deckStats: document.querySelector("#deckStats"),
  cloudStatus: document.querySelector("#cloudStatus"),
  cloudUrlInput: document.querySelector("#cloudUrlInput"),
  cloudAnonKeyInput: document.querySelector("#cloudAnonKeyInput"),
  cloudEmailInput: document.querySelector("#cloudEmailInput"),
  cloudPasswordInput: document.querySelector("#cloudPasswordInput"),
  cloudSignedIn: document.querySelector("#cloudSignedIn"),
  cloudMode: document.querySelector("#cloudMode"),
  cloudLastSynced: document.querySelector("#cloudLastSynced"),
  cloudPending: document.querySelector("#cloudPending"),
  cloudErrorDetails: document.querySelector("#cloudErrorDetails"),
  saveCloudConfigButton: document.querySelector("#saveCloudConfigButton"),
  signInCloudButton: document.querySelector("#signInCloudButton"),
  signUpCloudButton: document.querySelector("#signUpCloudButton"),
  signOutCloudButton: document.querySelector("#signOutCloudButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
  exportDeckButton: document.querySelector("#exportDeckButton"),
  importDeckButton: document.querySelector("#importDeckButton"),
  importDeckInput: document.querySelector("#importDeckInput"),
  searchInput: document.querySelector("#searchInput"),
  searchSpaceFilter: document.querySelector("#searchSpaceFilter"),
  searchCollectionFilter: document.querySelector("#searchCollectionFilter"),
  searchHostFilter: document.querySelector("#searchHostFilter"),
  searchTimeSourceFilter: document.querySelector("#searchTimeSourceFilter"),
  searchDateFrom: document.querySelector("#searchDateFrom"),
  searchDateTo: document.querySelector("#searchDateTo"),
  searchSortSelect: document.querySelector("#searchSortSelect"),
  clearSearchFiltersButton: document.querySelector("#clearSearchFiltersButton"),
  spaceList: document.querySelector("#spaceList"),
  addSpaceButton: document.querySelector("#addSpaceButton"),
  refreshTabsButton: document.querySelector("#refreshTabsButton"),
  autoSaveEnabledToggle: document.querySelector("#autoSaveEnabledToggle"),
  autoSaveIntervalSelect: document.querySelector("#autoSaveIntervalSelect"),
  autoSaveLastCaptured: document.querySelector("#autoSaveLastCaptured"),
  selectAllTabs: document.querySelector("#selectAllTabs"),
  saveSelectedButton: document.querySelector("#saveSelectedButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  closeAfterSave: document.querySelector("#closeAfterSave"),
  liveTabs: document.querySelector("#liveTabs"),
  recentlyDeletedList: document.querySelector("#recentlyDeletedList"),
  clearDeletedButton: document.querySelector("#clearDeletedButton"),
  activeSpaceMeta: document.querySelector("#activeSpaceMeta"),
  activeSpaceName: document.querySelector("#activeSpaceName"),
  renameSpaceButton: document.querySelector("#renameSpaceButton"),
  deleteSpaceButton: document.querySelector("#deleteSpaceButton"),
  newCollectionButton: document.querySelector("#newCollectionButton"),
  emptyCreateButton: document.querySelector("#emptyCreateButton"),
  emptyState: document.querySelector("#emptyState"),
  searchResults: document.querySelector("#searchResults"),
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
  await renderAutoSaveControls();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    renderCollections();
    renderSearchResults();
  });
  elements.searchSpaceFilter.addEventListener("change", (event) => {
    searchFilters.spaceId = event.target.value;
    renderCollections();
    renderSearchResults();
  });
  elements.searchCollectionFilter.addEventListener("input", (event) => {
    searchFilters.collection = event.target.value.trim().toLowerCase();
    renderCollections();
    renderSearchResults();
  });
  elements.searchHostFilter.addEventListener("input", (event) => {
    searchFilters.host = event.target.value.trim().toLowerCase();
    renderCollections();
    renderSearchResults();
  });
  elements.searchTimeSourceFilter.addEventListener("change", (event) => {
    searchFilters.timeSource = event.target.value || "all";
    renderCollections();
    renderSearchResults();
  });
  elements.searchDateFrom.addEventListener("change", (event) => {
    searchFilters.dateFrom = event.target.value;
    renderCollections();
    renderSearchResults();
  });
  elements.searchDateTo.addEventListener("change", (event) => {
    searchFilters.dateTo = event.target.value;
    renderCollections();
    renderSearchResults();
  });
  elements.searchSortSelect.addEventListener("change", (event) => {
    searchFilters.sortBy = event.target.value || "recent_activity";
    renderSearchResults();
  });
  elements.clearSearchFiltersButton.addEventListener("click", clearSearchFilters);

  elements.addSpaceButton.addEventListener("click", addSpace);
  elements.refreshTabsButton.addEventListener("click", refreshAndRenderLiveTabs);
  elements.autoSaveEnabledToggle.addEventListener("change", saveAutoSaveControls);
  elements.autoSaveIntervalSelect.addEventListener("change", saveAutoSaveControls);
  elements.clearDeletedButton.addEventListener("click", clearRecentlyDeleted);
  elements.selectAllTabs.addEventListener("change", toggleAllCurrentTabs);
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
  elements.exportDeckButton.addEventListener("click", exportDeckBackup);
  elements.importDeckButton.addEventListener("click", () => elements.importDeckInput.click());
  elements.importDeckInput.addEventListener("change", importDeckBackup);
}

function bindStorageSyncEvents() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (isDeckStorageChange(areaName, changes)) {
      deck = await loadDeck();
      render();
    }

    if (areaName === "local" && (changes[AUTO_SAVE_CONFIG_KEY] || changes[AUTO_SAVE_META_KEY])) {
      await renderAutoSaveControls();
    }
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

function toggleAllCurrentTabs() {
  if (elements.selectAllTabs.checked) {
    selectedTabIds = new Set(liveTabs.map((tab) => tab.id));
  } else {
    selectedTabIds.clear();
  }

  renderLiveTabs();
}

function render() {
  renderStats();
  renderSearchFilters();
  renderSpaces();
  renderHeader();
  renderLiveTabs();
  renderRecentlyDeleted();
  renderSearchResults();
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

  renderCloudDetails();
}

async function renderCloudControls() {
  const config = await getCloudConfig();
  const user = await getCloudUser().catch(() => null);
  elements.cloudUrlInput.value = config.supabaseUrl;
  elements.cloudAnonKeyInput.value = config.anonKey;
  elements.cloudSignedIn.textContent = user ? `Signed in as: ${user.email || user.id}` : "Signed in as: Not signed in";
  elements.signOutCloudButton.disabled = !user;
  elements.syncNowButton.disabled = !user;
  renderCloudDetails();
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
  updateSelectAllTabs();

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
      updateSelectAllTabs();
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

function updateSelectAllTabs() {
  const selectableCount = liveTabs.length;
  const selectedCount = liveTabs.filter((tab) => selectedTabIds.has(tab.id)).length;

  elements.selectAllTabs.disabled = selectableCount === 0;
  elements.selectAllTabs.checked = selectableCount > 0 && selectedCount === selectableCount;
  elements.selectAllTabs.indeterminate = selectedCount > 0 && selectedCount < selectableCount;
}

function renderCollections() {
  const activeSpace = getActiveSpace(deck);
  elements.collectionGrid.replaceChildren();

  const filteredCollections = activeSpace.collections
    .map((collection) => ({
      collection,
      items: filterItems(activeSpace, collection)
    }))
    .filter(({ collection, items }) => {
      return isCollectionMatchFilters(activeSpace, collection) || items.length > 0;
    })
    .sort((a, b) => Number(isAutoSavedCollection(b.collection)) - Number(isAutoSavedCollection(a.collection)));

  elements.emptyState.classList.toggle("hidden", activeSpace.collections.length > 0);

  for (const { collection, items } of filteredCollections) {
    elements.collectionGrid.append(renderCollectionCard(activeSpace, collection, items));
  }

  if (activeSpace.collections.length > 0 && filteredCollections.length === 0) {
    const noResults = document.createElement("p");
    noResults.className = "no-results";
    noResults.textContent = "No matching collections or links.";
    elements.collectionGrid.append(noResults);
  }
}

function renderSearchFilters() {
  const optionValues = new Set(Array.from(elements.searchSpaceFilter.options).map((option) => option.value));

  for (const space of deck.spaces) {
    if (!optionValues.has(space.id)) {
      const option = document.createElement("option");
      option.value = space.id;
      option.textContent = space.name;
      elements.searchSpaceFilter.append(option);
    }
  }

  for (const option of Array.from(elements.searchSpaceFilter.options)) {
    if (option.value !== "all" && !deck.spaces.some((space) => space.id === option.value)) {
      option.remove();
    }
  }

  if (searchFilters.spaceId !== "all" && !deck.spaces.some((space) => space.id === searchFilters.spaceId)) {
    searchFilters.spaceId = "all";
  }

  elements.searchSpaceFilter.value = searchFilters.spaceId;
  elements.searchCollectionFilter.value = searchFilters.collection;
  elements.searchHostFilter.value = searchFilters.host;
  elements.searchTimeSourceFilter.value = searchFilters.timeSource;
  elements.searchDateFrom.value = searchFilters.dateFrom;
  elements.searchDateTo.value = searchFilters.dateTo;
  elements.searchSortSelect.value = searchFilters.sortBy;
}

function isSearchActive() {
  return !!(
    query ||
    searchFilters.collection ||
    searchFilters.host ||
    searchFilters.timeSource !== "all" ||
    searchFilters.dateFrom ||
    searchFilters.dateTo ||
    searchFilters.spaceId !== "all"
  );
}

function renderSearchResults() {
  if (!isSearchActive()) {
    elements.searchResults.classList.add("hidden");
    elements.searchResults.replaceChildren();
    return;
  }

  const results = buildSearchResults();
  elements.searchResults.classList.remove("hidden");
  elements.searchResults.replaceChildren();

  const header = document.createElement("div");
  header.className = "search-results-header";

  const title = document.createElement("h3");
  title.textContent = "Search results";

  const meta = document.createElement("span");
  meta.className = "eyebrow";
  meta.textContent = `${results.length} links`;

  header.append(title, meta);
  elements.searchResults.append(header);

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted compact";
    empty.textContent = "No matching links.";
    elements.searchResults.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "search-results-list";

  for (const result of results) {
    const row = document.createElement("div");
    row.className = "search-result-row";

    const main = document.createElement("div");
    main.className = "search-result-main";

    const link = document.createElement("a");
    link.href = result.item.url;
    link.title = result.item.url;
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      await openItem(result.item);
    });
    applyHighlightedText(link, result.item.title || result.item.url, query);

    const info = document.createElement("div");
    info.className = "search-result-meta";
    const activityLabel = formatDateTimeLabel(getItemActivityIso(result.item));
    const timeSourceLabel = formatTimeSourceLabel(result.item.timeAccuracy);
    applyHighlightedText(
      info,
      `${result.spaceName} / ${result.collectionName} · ${getHost(result.item.url)} · Added ${formatDateLabel(
        result.item.addedAt
      )} · Active ${activityLabel} · ${timeSourceLabel}`,
      query
    );
    info.title = getTimeSourceDescription(result.item.timeAccuracy);

    main.append(link, info);

    const actions = document.createElement("div");
    actions.className = "search-result-actions";

    const openButton = document.createElement("button");
    openButton.className = "icon-button";
    openButton.type = "button";
    openButton.title = "Open result";
    openButton.setAttribute("aria-label", "Open result");
    openButton.textContent = "O";
    openButton.addEventListener("click", async () => {
      await openItem(result.item);
    });

    const moveButton = document.createElement("button");
    moveButton.className = "icon-button";
    moveButton.type = "button";
    moveButton.title = "Move result";
    moveButton.setAttribute("aria-label", "Move result");
    moveButton.textContent = "M";
    moveButton.addEventListener("click", async () => {
      await moveSearchResult(result);
    });

    actions.append(openButton, moveButton);
    row.append(main, actions);
    list.append(row);
  }

  elements.searchResults.append(list);
}

function buildSearchResults() {
  const results = [];

  for (const space of deck.spaces) {
    if (searchFilters.spaceId !== "all" && space.id !== searchFilters.spaceId) {
      continue;
    }

    for (const collection of space.collections) {
      if (searchFilters.collection && !collection.name.toLowerCase().includes(searchFilters.collection)) {
        continue;
      }

      for (const item of collection.items) {
        if (isItemMatchFilters(collection, item, space)) {
          results.push({
            spaceId: space.id,
            spaceName: space.name,
            collectionId: collection.id,
            collectionName: collection.name,
            item
          });
        }
      }
    }
  }

  if (searchFilters.sortBy === "recent_added") {
    results.sort((a, b) => toTimestamp(b.item.addedAt) - toTimestamp(a.item.addedAt));
  } else if (searchFilters.sortBy === "oldest_added") {
    results.sort((a, b) => toTimestamp(a.item.addedAt) - toTimestamp(b.item.addedAt));
  } else {
    results.sort((a, b) => getItemActivityTimestamp(b.item) - getItemActivityTimestamp(a.item));
  }

  return results;
}

function renderRecentlyDeleted() {
  const entries = getRecentlyDeletedEntries();
  elements.recentlyDeletedList.replaceChildren();
  elements.clearDeletedButton.disabled = entries.length === 0;

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted compact";
    empty.textContent = "No deleted items.";
    elements.recentlyDeletedList.append(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "deleted-item";

    const textWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "deleted-title";
    title.textContent = getDeletedEntryTitle(entry);

    const meta = document.createElement("div");
    meta.className = "deleted-meta";
    const deletedAt = entry.deletedAt ? new Date(entry.deletedAt).toLocaleString() : "Unknown time";
    meta.textContent = `${entry.type === "collection" ? "Collection" : "Link"} · ${deletedAt}`;

    textWrap.append(title, meta);

    const restoreButton = document.createElement("button");
    restoreButton.className = "icon-button";
    restoreButton.type = "button";
    restoreButton.title = "Restore";
    restoreButton.setAttribute("aria-label", "Restore");
    restoreButton.textContent = "R";
    restoreButton.addEventListener("click", async () => {
      await restoreDeletedEntry(entry.id);
    });

    row.append(textWrap, restoreButton);
    elements.recentlyDeletedList.append(row);
  }
}

function renderCollectionCard(space, collection, visibleItems) {
  const fragment = elements.collectionTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".collection-card");
  const top = fragment.querySelector(".collection-top");
  const actions = fragment.querySelector(".collection-actions");
  const nameInput = fragment.querySelector(".collection-name");
  const notesInput = fragment.querySelector(".collection-notes");
  const openAllButton = fragment.querySelector(".open-all");
  const suggestSummaryButton = fragment.querySelector(".suggest-summary");
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

  if (isAutoSavedCollection(collection)) {
    card.classList.add("collection-card-auto");

    const badge = document.createElement("span");
    badge.className = "collection-badge";
    badge.textContent = "AUTO";
    top.insertBefore(badge, actions);

    const meta = document.createElement("p");
    meta.className = "collection-system-meta";
    meta.textContent = `Background capture · Last update ${formatDateTimeLabel(collection.updatedAt)}`;
    card.insertBefore(meta, notesInput);
  }

  nameInput.addEventListener("change", async () => {
    collection.name = nameInput.value.trim() || "Untitled";
    touchCollectionModified(collection);
    await persistAndRender();
  });

  notesInput.addEventListener("change", async () => {
    collection.notes = notesInput.value.trim();
    touchCollectionModified(collection);
    await persistAndRender();
  });

  openAllButton.addEventListener("click", () => openCollection(collection));
  suggestSummaryButton.addEventListener("click", async () => {
    await suggestCollectionTitleAndNotes(collection);
  });
  deleteButton.addEventListener("click", () => deleteCollection(collection.id));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = normalizeUrl(urlInput.value.trim());

    if (!url) {
      urlInput.focus();
      return;
    }

    const addedAt = getNowIso();
    collection.items.unshift({
      id: makeId("link"),
      title: titleInput.value.trim() || getHost(url),
      url,
      favIconUrl: "",
      addedAt,
      lastModifiedAt: addedAt,
      lastOpenedAt: "",
      source: "manual",
      timeAccuracy: "exact",
      importedAt: "",
      importBatchId: ""
    });
    touchCollectionModified(collection);
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
    linkList.append(renderLinkRow(space, item, collection));
  }

  if (visibleItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted compact";
    empty.textContent = collection.items.length === 0 ? "No links yet." : "No links match search.";
    linkList.append(empty);
  }

  return fragment;
}

function renderLinkRow(space, item, collection) {
  const row = document.createElement("div");
  row.className = "link-row";

  const link = document.createElement("a");
  link.href = item.url;
  link.title = item.url;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    await openItem(item);
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
  applyHighlightedText(title, item.title || item.url, query);

  const host = document.createElement("span");
  host.className = "tab-host";
  applyHighlightedText(host, getHost(item.url), query);

  const trace = document.createElement("span");
  trace.className = `time-source-badge ${item.timeAccuracy || "exact"}`;
  trace.textContent = formatTimeSourceLabel(item.timeAccuracy);
  trace.title = getTimeSourceDescription(item.timeAccuracy);

  text.append(title, host, trace);
  link.append(icon, text);

  const removeButton = document.createElement("button");
  removeButton.className = "icon-button";
  removeButton.type = "button";
  removeButton.title = "Remove link";
  removeButton.setAttribute("aria-label", "Remove link");
  removeButton.textContent = "X";
  removeButton.addEventListener("click", async () => {
    addRecentlyDeleted({
      type: "link",
      spaceId: space.id,
      collectionId: collection.id,
      link: {
        id: item.id,
        title: item.title,
        url: item.url,
        favIconUrl: item.favIconUrl || "",
        addedAt: item.addedAt,
        lastModifiedAt: item.lastModifiedAt || "",
        lastOpenedAt: item.lastOpenedAt || "",
        source: item.source || "manual",
        timeAccuracy: item.timeAccuracy || "exact",
        importedAt: item.importedAt || "",
        importBatchId: item.importBatchId || ""
      }
    });
    addTombstone({
      type: "link",
      spaceId: space.id,
      collectionId: collection.id,
      url: item.url
    });
    collection.items = collection.items.filter((candidate) => candidate.id !== item.id);
    touchCollectionModified(collection);
    await persistAndRender();
  });

  row.append(link, removeButton);
  return row;
}

function filterItems(space, collection) {
  return collection.items.filter((item) => isItemMatchFilters(collection, item, space));
}

function isCollectionMatchFilters(space, collection) {
  const inSelectedSpace = searchFilters.spaceId === "all" || searchFilters.spaceId === space.id;
  if (!inSelectedSpace) {
    return false;
  }

  if (searchFilters.collection && !collection.name.toLowerCase().includes(searchFilters.collection)) {
    return false;
  }

  if (query) {
    return [space.name, collection.name, collection.notes].some((value) => (value || "").toLowerCase().includes(query));
  }

  return true;
}

function isItemMatchFilters(collection, item, space = getActiveSpace(deck)) {
  const host = getHost(item.url || "").toLowerCase();
  const activityTs = getItemActivityTimestamp(item);
  const searchDateFromTs = searchFilters.dateFrom ? Date.parse(`${searchFilters.dateFrom}T00:00:00`) : 0;
  const searchDateToTs = searchFilters.dateTo ? Date.parse(`${searchFilters.dateTo}T23:59:59.999`) : 0;
  const inSelectedSpace = searchFilters.spaceId === "all" || searchFilters.spaceId === space.id;

  if (!inSelectedSpace) {
    return false;
  }

  if (searchFilters.host && !host.includes(searchFilters.host)) {
    return false;
  }

  if (searchFilters.timeSource !== "all" && (item.timeAccuracy || "exact") !== searchFilters.timeSource) {
    return false;
  }

  if (searchFilters.collection && !collection.name.toLowerCase().includes(searchFilters.collection)) {
    return false;
  }

  if (searchDateFromTs && activityTs < searchDateFromTs) {
    return false;
  }

  if (searchDateToTs && activityTs > searchDateToTs) {
    return false;
  }

  if (!query) {
    return true;
  }

  return [item.title, item.url, host, collection.name, space.name]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(query));
}

function applyHighlightedText(node, text, keyword) {
  node.replaceChildren();
  const value = text || "";
  const term = (keyword || "").trim();

  if (!term) {
    node.textContent = value;
    return;
  }

  const lowerValue = value.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let index = 0;
  let matchIndex = lowerValue.indexOf(lowerTerm, index);

  if (matchIndex < 0) {
    node.textContent = value;
    return;
  }

  while (matchIndex >= 0) {
    if (matchIndex > index) {
      node.append(document.createTextNode(value.slice(index, matchIndex)));
    }

    const mark = document.createElement("mark");
    mark.textContent = value.slice(matchIndex, matchIndex + lowerTerm.length);
    node.append(mark);

    index = matchIndex + lowerTerm.length;
    matchIndex = lowerValue.indexOf(lowerTerm, index);
  }

  if (index < value.length) {
    node.append(document.createTextNode(value.slice(index)));
  }
}

function toTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function getNowIso() {
  return new Date().toISOString();
}

function getItemActivityTimestamp(item) {
  return Math.max(toTimestamp(item.lastOpenedAt), toTimestamp(item.lastModifiedAt), toTimestamp(item.addedAt));
}

function getItemActivityIso(item) {
  const ts = getItemActivityTimestamp(item);
  return ts > 0 ? new Date(ts).toISOString() : "";
}

function touchCollectionModified(collection, timestamp = getNowIso()) {
  collection.updatedAt = timestamp;
  collection.lastModifiedAt = timestamp;
}

function touchItemModified(item, timestamp = getNowIso()) {
  item.lastModifiedAt = timestamp;
}

function touchItemOpened(item, timestamp = getNowIso()) {
  item.lastOpenedAt = timestamp;
}

function formatDateTimeLabel(value) {
  if (!value) {
    return "Unknown";
  }

  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return "Unknown";
  }

  return new Date(ts).toLocaleString();
}

function formatDateLabel(value) {
  if (!value) {
    return "Unknown";
  }

  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return "Unknown";
  }

  return new Date(ts).toLocaleDateString();
}

function formatTimeSourceLabel(timeAccuracy) {
  if (timeAccuracy === "imported") {
    return "Imported time";
  }

  if (timeAccuracy === "estimated") {
    return "Estimated time";
  }

  return "Exact time";
}

function getTimeSourceDescription(timeAccuracy) {
  if (timeAccuracy === "imported") {
    return "Time is from import timestamp, not original creation time.";
  }

  if (timeAccuracy === "estimated") {
    return "Time is estimated from available data.";
  }

  return "Time is captured from direct action in Tab Deck.";
}

async function moveSearchResult(result) {
  const sourceSpace = deck.spaces.find((space) => space.id === result.spaceId);
  if (!sourceSpace) {
    return;
  }

  const sourceCollection = sourceSpace.collections.find((collection) => collection.id === result.collectionId);
  if (!sourceCollection) {
    return;
  }

  const targetName = prompt("Move to collection (same space)", result.collectionName);
  if (!targetName || !targetName.trim()) {
    return;
  }

  const cleanedName = targetName.trim();
  let targetCollection = sourceSpace.collections.find((collection) => collection.name.toLowerCase() === cleanedName.toLowerCase());

  if (!targetCollection) {
    targetCollection = createCollection(cleanedName);
    sourceSpace.collections.unshift(targetCollection);
  }

  if (targetCollection.id === sourceCollection.id) {
    return;
  }

  const item = sourceCollection.items.find((candidate) => candidate.id === result.item.id);
  if (!item) {
    return;
  }

  const existsInTarget = targetCollection.items.some((candidate) => candidate.url === item.url);
  sourceCollection.items = sourceCollection.items.filter((candidate) => candidate.id !== item.id);

  if (!existsInTarget) {
    touchItemModified(item);
    targetCollection.items.unshift(item);
    touchCollectionModified(targetCollection);
  }

  touchCollectionModified(sourceCollection);
  await persistAndRender();
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

  addRecentlyDeleted({
    type: "collection",
    spaceId: activeSpace.id,
    collectionId: collection.id,
    collection: {
      id: collection.id,
      name: collection.name,
      notes: collection.notes,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      lastModifiedAt: collection.lastModifiedAt || collection.updatedAt,
      source: collection.source || "manual",
      timeAccuracy: collection.timeAccuracy || "exact",
      importedAt: collection.importedAt || "",
      importBatchId: collection.importBatchId || "",
      items: collection.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        favIconUrl: item.favIconUrl || "",
        addedAt: item.addedAt,
        lastModifiedAt: item.lastModifiedAt || "",
        lastOpenedAt: item.lastOpenedAt || "",
        source: item.source || "manual",
        timeAccuracy: item.timeAccuracy || "exact",
        importedAt: item.importedAt || "",
        importBatchId: item.importBatchId || ""
      }))
    }
  });
  addTombstone({
    type: "collection",
    spaceId: activeSpace.id,
    collectionId: collection.id
  });
  activeSpace.collections = activeSpace.collections.filter((candidate) => candidate.id !== collectionId);
  await persistAndRender();
}

function getRecentlyDeletedEntries() {
  if (!deck.settings) {
    deck.settings = {};
  }

  if (!Array.isArray(deck.settings.recentlyDeleted)) {
    deck.settings.recentlyDeleted = [];
  }

  return deck.settings.recentlyDeleted;
}

function getTombstones() {
  if (!deck.settings) {
    deck.settings = {};
  }

  if (!Array.isArray(deck.settings.tombstones)) {
    deck.settings.tombstones = [];
  }

  return deck.settings.tombstones;
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

function addTombstone(entry) {
  const key = tombstoneKey(entry);
  if (!key) {
    return;
  }

  const entries = getTombstones();
  const nextEntry = {
    id: makeId("tombstone"),
    deletedAt: new Date().toISOString(),
    ...entry
  };
  const deduped = [nextEntry, ...entries.filter((candidate) => tombstoneKey(candidate) !== key)];
  deck.settings.tombstones = deduped.slice(0, MAX_TOMBSTONES);
}

function removeTombstone(entry) {
  const key = tombstoneKey(entry);
  if (!key) {
    return;
  }

  deck.settings.tombstones = getTombstones().filter((candidate) => tombstoneKey(candidate) !== key);
}

function addRecentlyDeleted(entry) {
  const entries = getRecentlyDeletedEntries();
  entries.unshift({
    id: makeId("deleted"),
    deletedAt: new Date().toISOString(),
    ...entry
  });
  deck.settings.recentlyDeleted = entries.slice(0, MAX_RECENTLY_DELETED);
}

async function restoreDeletedEntry(entryId) {
  const entries = getRecentlyDeletedEntries();
  const index = entries.findIndex((entry) => entry.id === entryId);

  if (index < 0) {
    return;
  }

  const entry = entries[index];
  const activeSpace = getActiveSpace(deck);
  const targetSpace = deck.spaces.find((space) => space.id === entry.spaceId) || activeSpace;

  if (entry.type === "collection" && entry.collection) {
    const collectionIdInUse = targetSpace.collections.some((collection) => collection.id === entry.collection.id);
    const restoredCollection = {
      ...entry.collection,
      id: collectionIdInUse ? makeId("collection") : entry.collection.id,
      source: entry.collection.source || "manual",
      timeAccuracy: entry.collection.timeAccuracy || "exact",
      importedAt: entry.collection.importedAt || "",
      importBatchId: entry.collection.importBatchId || "",
      items: Array.isArray(entry.collection.items)
        ? entry.collection.items.map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            favIconUrl: item.favIconUrl || "",
            addedAt: item.addedAt,
            lastModifiedAt: item.lastModifiedAt || "",
            lastOpenedAt: item.lastOpenedAt || "",
            source: item.source || "manual",
            timeAccuracy: item.timeAccuracy || "exact",
            importedAt: item.importedAt || "",
            importBatchId: item.importBatchId || ""
          }))
        : []
    };
    targetSpace.collections.unshift(restoredCollection);
    removeTombstone({
      type: "collection",
      spaceId: entry.spaceId,
      collectionId: entry.collectionId
    });
  }

  if (entry.type === "link" && entry.link?.url) {
    let targetCollection = targetSpace.collections.find((collection) => collection.id === entry.collectionId);

    if (!targetCollection) {
      targetCollection = createCollection("Recovered");
      targetSpace.collections.unshift(targetCollection);
    }

    const hasSameUrl = targetCollection.items.some((item) => item.url === entry.link.url);
    if (!hasSameUrl) {
      const itemIdInUse = targetCollection.items.some((item) => item.id === entry.link.id);
      targetCollection.items.unshift({
        id: itemIdInUse ? makeId("link") : entry.link.id,
        title: entry.link.title || entry.link.url,
        url: entry.link.url,
        favIconUrl: entry.link.favIconUrl || "",
        addedAt: entry.link.addedAt || getNowIso(),
        lastModifiedAt: entry.link.lastModifiedAt || entry.link.addedAt || getNowIso(),
        lastOpenedAt: entry.link.lastOpenedAt || "",
        source: entry.link.source || "manual",
        timeAccuracy: entry.link.timeAccuracy || "exact",
        importedAt: entry.link.importedAt || "",
        importBatchId: entry.link.importBatchId || ""
      });
      touchCollectionModified(targetCollection);
    }

    removeTombstone({
      type: "link",
      spaceId: entry.spaceId,
      collectionId: entry.collectionId,
      url: entry.link.url
    });
  }

  entries.splice(index, 1);
  deck.settings.recentlyDeleted = entries;
  deck.activeSpaceId = targetSpace.id;
  await persistAndRender();
}

async function clearRecentlyDeleted() {
  const entries = getRecentlyDeletedEntries();
  if (entries.length === 0) {
    return;
  }

  const confirmed = confirm("Clear all recently deleted items?");
  if (!confirmed) {
    return;
  }

  deck.settings.recentlyDeleted = [];
  await persistAndRender();
}

function getDeletedEntryTitle(entry) {
  if (entry.type === "collection") {
    return entry.collection?.name || "Untitled collection";
  }

  if (entry.type === "link") {
    return entry.link?.title || entry.link?.url || "Untitled link";
  }

  return "Unknown item";
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
  clearSearch();
  const savedCount = await addTabsToCollection(tabs, collection, { closeAfterSave: elements.closeAfterSave.checked });
  const status = getStorageStatus();
  showCloudMessage(`Saved ${savedCount} tabs to "${collection.name}". ${status.message}`, !status.synced);
}

async function addTabsToCollection(tabs, collection, options = {}) {
  const existingUrls = new Set(collection.items.map((item) => item.url));
  const items = tabs
    .filter((tab) => isSaveableUrl(tab.url) && !existingUrls.has(tab.url))
    .map(tabToItem);

  collection.items.unshift(...items);
  touchCollectionModified(collection);
  await persistAndRender();

  if (options.closeAfterSave && tabs.length > 0) {
    await chrome.tabs.remove(tabs.map((tab) => tab.id));
    await refreshAndRenderLiveTabs();
  }

  return items.length;
}

async function openCollection(collection) {
  const openedAt = getNowIso();

  for (const item of collection.items) {
    touchItemOpened(item, openedAt);
    await chrome.tabs.create({ url: item.url, active: false });
  }

  await persistAndRender();
}

async function suggestCollectionTitleAndNotes(collection) {
  const items = Array.isArray(collection.items) ? collection.items : [];

  if (items.length < 2) {
    showCloudMessage("Need at least 2 links to suggest title and notes.", true);
    return;
  }

  const { suggestedTitle, suggestedNotes } = buildCollectionSummarySuggestion(collection);

  if (!suggestedTitle && !suggestedNotes) {
    showCloudMessage("Could not extract enough signal to suggest title and notes.", true);
    return;
  }

  if (suggestedTitle) {
    collection.name = suggestedTitle;
  }

  if (suggestedNotes) {
    collection.notes = suggestedNotes;
  }

  touchCollectionModified(collection);
  await persistAndRender();
  showCloudMessage("Generated title and notes from saved links.");
}

function buildCollectionSummarySuggestion(collection) {
  const items = Array.isArray(collection.items) ? collection.items : [];
  const hosts = buildTopHosts(items);
  const keywords = buildTopKeywords(items);
  const titleCandidates = buildTitleCandidates(hosts, keywords);
  const suggestedTitle = titleCandidates[0] || collection.name || "Untitled";
  const suggestedNotes = buildSuggestedNotes(items.length, hosts, keywords);

  return {
    suggestedTitle,
    suggestedNotes
  };
}

function buildTopHosts(items) {
  const hostCounts = new Map();

  for (const item of items) {
    const host = simplifyHost(getHost(item.url || ""));
    if (!host) {
      continue;
    }

    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
  }

  return sortCounterEntries(hostCounts).slice(0, 4).map(([value]) => value);
}

function buildTopKeywords(items) {
  const keywordCounts = new Map();

  for (const item of items) {
    const text = `${item.title || ""} ${item.url || ""}`;
    const tokens = tokenizeForSummary(text);

    for (const token of tokens) {
      keywordCounts.set(token, (keywordCounts.get(token) || 0) + 1);
    }
  }

  return sortCounterEntries(keywordCounts).slice(0, 6).map(([value]) => value);
}

function sortCounterEntries(counterMap) {
  return Array.from(counterMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }

    return a[0].localeCompare(b[0]);
  });
}

function simplifyHost(host) {
  if (!host) {
    return "";
  }

  const trimmed = host.replace(/^www\./, "").toLowerCase();
  const parts = trimmed.split(".").filter(Boolean);

  if (parts.length < 2) {
    return trimmed;
  }

  return parts.slice(-2).join(".");
}

function tokenizeForSummary(text) {
  const input = (text || "").toLowerCase();
  const english = input.match(/[a-z0-9]{3,}/g) || [];
  const cjk = input.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const merged = [...english, ...cjk];

  return merged.filter((token) => {
    if (TITLE_STOP_WORDS.has(token)) {
      return false;
    }

    if (/^\d+$/.test(token)) {
      return false;
    }

    return true;
  });
}

function titleCaseToken(token) {
  if (/[\u4e00-\u9fff]/.test(token)) {
    return token;
  }

  return token.charAt(0).toUpperCase() + token.slice(1);
}

function buildTitleCandidates(hosts, keywords) {
  const topKeyword = keywords[0] ? titleCaseToken(keywords[0]) : "";
  const secondaryKeyword = keywords[1] ? titleCaseToken(keywords[1]) : "";
  const topHost = hosts[0] ? titleCaseToken(hosts[0]) : "";
  const secondaryHost = hosts[1] ? titleCaseToken(hosts[1]) : "";
  const candidates = [];

  if (topKeyword && secondaryKeyword) {
    candidates.push(`${topKeyword} + ${secondaryKeyword}`);
  }

  if (topKeyword && topHost) {
    candidates.push(`${topKeyword} · ${topHost}`);
  }

  if (topHost && secondaryHost) {
    candidates.push(`${topHost} & ${secondaryHost}`);
  }

  if (topKeyword) {
    candidates.push(`${topKeyword} Collection`);
  }

  if (topHost) {
    candidates.push(`${topHost} Watchlist`);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function buildSuggestedNotes(totalItems, hosts, keywords) {
  const hostText = hosts.length > 0 ? hosts.join(", ") : "mixed sources";
  const keywordText = keywords.length > 0 ? keywords.slice(0, 5).join(", ") : "no dominant keywords";
  return `Auto summary from ${totalItems} saved links.\nTop sources: ${hostText}.\nMain topics: ${keywordText}.`;
}

async function openItem(item) {
  const openedAt = getNowIso();
  touchItemOpened(item, openedAt);
  await chrome.tabs.create({ url: item.url });
  await persistAndRender();
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
    deck = await syncDeckWithCloud();
    elements.cloudPasswordInput.value = "";
    return "Signed in and synced.";
  });
}

async function signUpForCloud() {
  await runCloudAction(async () => {
    const result = await signUpCloud(elements.cloudEmailInput.value.trim(), elements.cloudPasswordInput.value);
    elements.cloudPasswordInput.value = "";

    if (result.session) {
      deck = await syncDeckWithCloud();
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
    deck = await syncDeckWithCloud();
    return "Synced with Supabase.";
  });
}

async function exportDeckBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = serializeDeck(deck);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tab-deck-backup-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showCloudMessage("Backup exported as JSON.");
}

async function importDeckBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  await runCloudAction(async () => {
    const raw = await file.text();
    const payload = parseImportPayload(raw);

    if (payload.source === "tab-deck") {
      deck = payload.deck;
      await saveDeck(deck);
      return "Tab Deck backup imported and saved.";
    }

    const importedSpace = buildSpaceFromTobyImport(payload.tobyImport);
    deck.spaces.unshift(importedSpace);
    deck.activeSpaceId = importedSpace.id;
    deck.updatedAt = new Date().toISOString();
    await saveDeck(deck);
    return `Toby import completed: ${payload.tobyImport.stats.collectionCount} collections, ${payload.tobyImport.stats.itemCount} links.`;
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
    finalMessage = formatCloudError(error);
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

function renderCloudDetails() {
  const status = getStorageStatus();
  const lastSyncedLabel = status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never";
  const backendLabel = status.mode === "cloud" ? "Supabase cloud" : status.mode === "sync" ? "Chrome sync" : "Local only";
  elements.cloudMode.textContent = `Backend: ${backendLabel}`;
  elements.cloudLastSynced.textContent = `Last synced: ${lastSyncedLabel}`;
  elements.cloudPending.textContent = `Pending local changes: ${status.pendingLocalChanges ? "Yes" : "No"}`;
  elements.cloudPending.classList.toggle("warning", status.pendingLocalChanges);

  if (status.lastError) {
    elements.cloudErrorDetails.textContent = `Cloud error details: ${status.lastError}`;
    elements.cloudErrorDetails.classList.remove("hidden");
  } else {
    elements.cloudErrorDetails.textContent = "Cloud error details: None";
    elements.cloudErrorDetails.classList.add("hidden");
  }
}

async function renderAutoSaveControls() {
  const [config, meta] = await Promise.all([getAutoSaveConfig(), getAutoSaveMeta()]);

  elements.autoSaveEnabledToggle.checked = config.enabled;
  elements.autoSaveIntervalSelect.value = String(config.intervalMinutes);
  elements.autoSaveIntervalSelect.disabled = !config.enabled;
  elements.autoSaveLastCaptured.textContent = `Last auto save: ${
    meta.lastCapturedAt ? new Date(meta.lastCapturedAt).toLocaleString() : "Never"
  }`;
}

async function saveAutoSaveControls() {
  const config = normalizeAutoSaveConfig({
    enabled: elements.autoSaveEnabledToggle.checked,
    intervalMinutes: Number(elements.autoSaveIntervalSelect.value)
  });

  await chrome.storage.local.set({
    [AUTO_SAVE_CONFIG_KEY]: config
  });

  await renderAutoSaveControls();
  showCloudMessage(config.enabled ? `Background auto-save is on (${config.intervalMinutes} min).` : "Background auto-save is off.");
}

function clearSearch() {
  query = "";
  elements.searchInput.value = "";
}

function isAutoSavedCollection(collection) {
  return (collection.name || "").trim().toLowerCase() === AUTO_SAVE_COLLECTION_NAME.toLowerCase();
}

function normalizeAutoSaveConfig(rawConfig) {
  const next = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const parsedInterval = Number(next.intervalMinutes);
  const intervalMinutes = AUTO_SAVE_INTERVAL_OPTIONS.includes(parsedInterval)
    ? parsedInterval
    : AUTO_SAVE_DEFAULT_CONFIG.intervalMinutes;

  return {
    enabled: typeof next.enabled === "boolean" ? next.enabled : AUTO_SAVE_DEFAULT_CONFIG.enabled,
    intervalMinutes
  };
}

async function getAutoSaveConfig() {
  const result = await chrome.storage.local.get(AUTO_SAVE_CONFIG_KEY);
  return normalizeAutoSaveConfig(result[AUTO_SAVE_CONFIG_KEY]);
}

async function getAutoSaveMeta() {
  const result = await chrome.storage.local.get(AUTO_SAVE_META_KEY);
  const meta = result[AUTO_SAVE_META_KEY];

  if (!meta || typeof meta !== "object") {
    return {
      lastCapturedAt: ""
    };
  }

  return {
    lastCapturedAt: meta.lastCapturedAt || ""
  };
}

function clearSearchFilters() {
  searchFilters.spaceId = "all";
  searchFilters.collection = "";
  searchFilters.host = "";
  searchFilters.timeSource = "all";
  searchFilters.dateFrom = "";
  searchFilters.dateTo = "";
  searchFilters.sortBy = "recent_activity";
  elements.searchSpaceFilter.value = "all";
  elements.searchCollectionFilter.value = "";
  elements.searchHostFilter.value = "";
  elements.searchTimeSourceFilter.value = "all";
  elements.searchDateFrom.value = "";
  elements.searchDateTo.value = "";
  elements.searchSortSelect.value = "recent_activity";
  renderCollections();
  renderSearchResults();
}

function setCloudBusy(isBusy) {
  for (const button of [
    elements.saveCloudConfigButton,
    elements.signInCloudButton,
    elements.signUpCloudButton,
    elements.signOutCloudButton,
    elements.syncNowButton,
    elements.exportDeckButton,
    elements.importDeckButton
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
