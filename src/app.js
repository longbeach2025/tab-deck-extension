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
  bindMachine,
  ensureCloudEnvironment,
  fetchCloudLinkEmbeddings,
  getCloudConfig,
  getCloudUser,
  importInitBundleToCloud,
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
let smartSearchHints = createEmptySmartSearchHints();
let smartSearchOverrides = createEmptySmartSearchOverrides();
let searchLlmDebounceTimer = null;
let searchLlmRequestId = 0;
let searchLlmMissingConfigNotified = false;
let vectorSearchDebounceTimer = null;
let vectorSearchRequestId = 0;
let vectorSearchState = createDefaultVectorSearchState();
let searchEnhancementIndex = createEmptySearchEnhancementIndex();
let searchEnhancementMeta = createDefaultSearchEnhancementMeta();
let searchEnhancementBusy = false;
let searchEnhancementRunState = null;
let pendingMachineBinding = "";
let searchConfig = {
  autoRelaxSmartFilters: true,
  llmStrictMode: false,
  preprocessFastMode: true
};
const SMART_SEARCH_CACHE_LIMIT = 100;
const SEARCH_LLM_DEBOUNCE_MS = 420;
const VECTOR_SEARCH_DEBOUNCE_MS = 260;
const VECTOR_CANDIDATE_LIMIT = 260;
const VECTOR_TOPK_LIMIT = 80;
const VECTOR_MIX_WEIGHT = 2;
const VECTOR_SEARCH_CACHE_LIMIT = 80;
const VECTOR_EMBEDDING_MODEL_DEFAULT = "text-embedding-3-small";
const VECTOR_SEARCH_DEBUG = false;
const PRIVATE_INIT_OWNER_SALT = "tabdeck-private-init-v1";
const PRIVATE_INIT_ALLOWED_USER_HASHES = new Set(["8d28328b26f7628a2028865501ec928ce01e6a3ffbbb9e8e7a83813763318d56"]);
const SEARCH_ENHANCEMENT_INDEX_KEY = "tabDeckSearchEnhancementIndex";
const SEARCH_ENHANCEMENT_META_KEY = "tabDeckSearchEnhancementMeta";
const SEARCH_ENHANCEMENT_BATCH_SIZE = 200;
const SEARCH_ENHANCEMENT_REQUEST_ITEM_LIMIT = 20;
const SEARCH_ENHANCEMENT_WORKER_COUNT = 2;
const SEARCH_ENHANCEMENT_MAX_RETRIES = 2;
const SEARCH_ENHANCEMENT_RETRY_BASE_MS = 1200;
const SEARCH_ENHANCEMENT_REQUEST_GAP_MS = 80;
const SEARCH_ENHANCEMENT_FAST_REQUEST_ITEM_LIMIT = 30;
const SEARCH_ENHANCEMENT_FAST_WORKER_COUNT = 3;
const SEARCH_ENHANCEMENT_FAST_MAX_RETRIES = 1;
const SEARCH_ENHANCEMENT_FAST_REQUEST_GAP_MS = 40;
const SEARCH_ENHANCEMENT_RATE_LIMIT_COOLDOWN_MS = 6000;
const SEARCH_ENHANCEMENT_MAX_RATE_LIMIT_STREAK = 4;
const SEARCH_ENHANCEMENT_MINIMAX_FAST_REQUEST_ITEM_LIMIT = 12;
const SEARCH_ENHANCEMENT_MINIMAX_FAST_WORKER_COUNT = 2;
const SEARCH_ENHANCEMENT_MINIMAX_FAST_MAX_RETRIES = 1;
const SEARCH_ENHANCEMENT_MINIMAX_FAST_REQUEST_GAP_MS = 90;
const smartSearchCache = new Map();
const smartSearchOverrideCache = new Map();
const smartSearchLlmCache = new Map();
const vectorQueryEmbeddingCache = new Map();
const vectorItemEmbeddingCache = new Map();
const searchFilters = {
  spaceId: "all",
  collection: "",
  host: "",
  dateFrom: "",
  dateTo: "",
  sortBy: "recent_activity"
};
const MAX_RECENTLY_DELETED = 50;
const MAX_TOMBSTONES = 500;
const AUTO_SAVE_COLLECTION_NAME = "Auto Saved";
const AUTO_SAVE_CONFIG_KEY = "tabDeckAutoSaveConfig";
const AUTO_SAVE_META_KEY = "tabDeckAutoSaveMeta";
const AI_CONFIG_KEY = "tabDeckAiConfig";
const SEARCH_CONFIG_KEY = "tabDeckSearchConfig";
const AUTO_SAVE_INTERVAL_OPTIONS = [3, 5, 10, 15];
const AUTO_SAVE_DEFAULT_CONFIG = {
  enabled: true,
  intervalMinutes: 3
};
const DEFAULT_AI_CONFIG = {
  llm: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat"
  },
  embedding: {
    provider: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "BAAI/bge-m3"
  }
};
const AI_PROVIDER_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  minimax: {
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M2.7"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  }
};
const EMBEDDING_PROVIDER_PRESETS = {
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "BAAI/bge-m3"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small"
  }
};
const SEARCH_STOP_WORDS = new Set([
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
const SEARCH_TERM_EXPANSIONS = {
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
const SEARCH_HOST_ALIASES = {
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

const elements = {
  deckStats: document.querySelector("#deckStats"),
  systemActionStatus: document.querySelector("#systemActionStatus"),
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
  machineBindingGate: document.querySelector("#machineBindingGate"),
  machineBindingMessage: document.querySelector("#machineBindingMessage"),
  machineProfilePathInput: document.querySelector("#machineProfilePathInput"),
  machineConfirmBlock: document.querySelector("#machineConfirmBlock"),
  machineConfirmText: document.querySelector("#machineConfirmText"),
  confirmMachineBindingButton: document.querySelector("#confirmMachineBindingButton"),
  saveCloudConfigButton: document.querySelector("#saveCloudConfigButton"),
  signInCloudButton: document.querySelector("#signInCloudButton"),
  signUpCloudButton: document.querySelector("#signUpCloudButton"),
  signOutCloudButton: document.querySelector("#signOutCloudButton"),
  syncNowButton: document.querySelector("#syncNowButton"),
  exportDeckButton: document.querySelector("#exportDeckButton"),
  importDeckButton: document.querySelector("#importDeckButton"),
  importDeckInput: document.querySelector("#importDeckInput"),
  privateInitSection: document.querySelector("#privateInitSection"),
  importPrivateInitButton: document.querySelector("#importPrivateInitButton"),
  importPrivateInitInput: document.querySelector("#importPrivateInitInput"),
  aiProviderSelect: document.querySelector("#aiProviderSelect"),
  aiBaseUrlInput: document.querySelector("#aiBaseUrlInput"),
  aiApiKeyInput: document.querySelector("#aiApiKeyInput"),
  aiModelInput: document.querySelector("#aiModelInput"),
  embeddingProviderSelect: document.querySelector("#embeddingProviderSelect"),
  embeddingBaseUrlInput: document.querySelector("#embeddingBaseUrlInput"),
  embeddingApiKeyInput: document.querySelector("#embeddingApiKeyInput"),
  embeddingModelInput: document.querySelector("#embeddingModelInput"),
  saveAiConfigButton: document.querySelector("#saveAiConfigButton"),
  searchInput: document.querySelector("#searchInput"),
  searchSpaceFilter: document.querySelector("#searchSpaceFilter"),
  searchCollectionFilter: document.querySelector("#searchCollectionFilter"),
  searchHostFilter: document.querySelector("#searchHostFilter"),
  searchDateFrom: document.querySelector("#searchDateFrom"),
  searchDateTo: document.querySelector("#searchDateTo"),
  searchSortSelect: document.querySelector("#searchSortSelect"),
  smartSearchRelaxToggle: document.querySelector("#smartSearchRelaxToggle"),
  llmStrictModeToggle: document.querySelector("#llmStrictModeToggle"),
  preprocessFastModeToggle: document.querySelector("#preprocessFastModeToggle"),
  runPreprocessButton: document.querySelector("#runPreprocessButton"),
  preprocessProgressBar: document.querySelector("#preprocessProgressBar"),
  preprocessProgressText: document.querySelector("#preprocessProgressText"),
  preprocessLastFull: document.querySelector("#preprocessLastFull"),
  smartSearchChips: document.querySelector("#smartSearchChips"),
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
  try {
    await ensureCloudEnvironment();
  } catch (error) {
    showMachineBindingGate(error);
    return;
  }

  deck = await loadDeck();
  await refreshLiveTabs();
  bindEvents();
  bindStorageSyncEvents();
  render();
  await renderCloudControls();
  await renderAiControls();
  await renderAutoSaveControls();
  await renderSearchControls();
  await loadSearchEnhancementIndex();
  await loadSearchEnhancementMeta();
  renderSearchEnhancementProgress();
}

function showMachineBindingGate(error) {
  bindMachineBindingEvents();
  const message = formatCloudError(error);
  elements.machineBindingMessage.textContent = message.includes("machine is not bound")
    ? "Choose the machine for this development Chrome profile. The binding is permanent for this profile."
    : message;
  elements.machineBindingGate.classList.remove("hidden");
}

function bindMachineBindingEvents() {
  for (const button of document.querySelectorAll("[data-machine-choice]")) {
    button.addEventListener("click", () => {
      pendingMachineBinding = button.dataset.machineChoice || "";
      elements.machineConfirmText.textContent = `This machine is ${pendingMachineBinding}. Confirm binding ${pendingMachineBinding}; this Chrome profile cannot be changed later.`;
      elements.confirmMachineBindingButton.textContent = `Confirm ${pendingMachineBinding}`;
      elements.machineConfirmBlock.classList.remove("hidden");
    });
  }

  elements.confirmMachineBindingButton.addEventListener("click", confirmMachineBinding);
}

async function confirmMachineBinding() {
  if (!pendingMachineBinding) {
    return;
  }

  const confirmed = window.confirm(
    `Confirm binding this Chrome profile to ${pendingMachineBinding}?\nThis profile cannot be switched later. Create a new Chrome profile for another machine.`
  );
  if (!confirmed) {
    return;
  }

  try {
    await bindMachine(pendingMachineBinding, elements.machineProfilePathInput.value);
    window.location.reload();
  } catch (error) {
    elements.machineBindingMessage.textContent = formatCloudError(error);
    elements.machineBindingMessage.classList.add("warning");
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    query = event.target.value.trim().toLowerCase();
    recalculateSmartSearchHints();
    renderCollections();
    renderSearchResults();
    renderSmartSearchChips();
    scheduleLlmSmartSearchRefresh();
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
  elements.smartSearchRelaxToggle.addEventListener("change", saveSearchControls);
  elements.llmStrictModeToggle.addEventListener("change", saveSearchControls);
  elements.preprocessFastModeToggle.addEventListener("change", saveSearchControls);
  elements.runPreprocessButton.addEventListener("click", () => runSearchEnhancementProcessing({ force: true }));
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
  elements.importPrivateInitButton.addEventListener("click", () => elements.importPrivateInitInput.click());
  elements.importPrivateInitInput.addEventListener("change", importPrivateInitBundleFromFile);
  elements.aiProviderSelect.addEventListener("change", onAiProviderChanged);
  elements.embeddingProviderSelect.addEventListener("change", onEmbeddingProviderChanged);
  elements.saveAiConfigButton.addEventListener("click", saveAiConfig);
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

    if (areaName === "local" && changes[SEARCH_CONFIG_KEY]) {
      await renderSearchControls();
      renderCollections();
      renderSearchResults();
      renderSmartSearchChips();
    }

    if (areaName === "local" && changes[SEARCH_ENHANCEMENT_INDEX_KEY]) {
      await loadSearchEnhancementIndex();
      renderCollections();
      renderSearchResults();
      renderSearchEnhancementProgress();
    }

    if (areaName === "local" && changes[SEARCH_ENHANCEMENT_META_KEY]) {
      await loadSearchEnhancementMeta();
      renderSearchEnhancementProgress();
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
  renderSmartSearchChips();
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
    elements.cloudStatus.textContent = `Sync status: ${status.message}`;
    elements.cloudStatus.classList.toggle("warning", !status.synced);
  }

  renderCloudDetails();
}

async function renderCloudControls() {
  const config = await getCloudConfig();
  const user = await getCloudUser().catch(() => null);
  const canUsePrivateInit = await isPrivateInitAllowedUser(user);
  elements.cloudUrlInput.value = config.supabaseUrl;
  elements.cloudAnonKeyInput.value = config.anonKey;
  elements.cloudSignedIn.textContent = user ? `Signed in as: ${user.email || user.id}` : "Signed in as: Not signed in";
  elements.signOutCloudButton.disabled = !user;
  elements.syncNowButton.disabled = !user;
  elements.privateInitSection.classList.toggle("hidden", !canUsePrivateInit);
  elements.importPrivateInitButton.disabled = !canUsePrivateInit;
  renderCloudDetails();
}

async function renderAiControls() {
  const config = await getAiConfig();
  elements.aiProviderSelect.value = config.llm.provider;
  elements.aiBaseUrlInput.value = config.llm.baseUrl;
  elements.aiApiKeyInput.value = config.llm.apiKey;
  elements.aiModelInput.value = config.llm.model;
  applyAiProviderUi(config.llm.provider);

  elements.embeddingProviderSelect.value = config.embedding.provider;
  elements.embeddingBaseUrlInput.value = config.embedding.baseUrl;
  elements.embeddingApiKeyInput.value = config.embedding.apiKey;
  elements.embeddingModelInput.value = config.embedding.model;
  applyEmbeddingProviderUi(config.embedding.provider);
}

async function saveAiConfig() {
  const config = normalizeAiConfig({
    llm: {
      provider: elements.aiProviderSelect.value,
      baseUrl: elements.aiBaseUrlInput.value,
      apiKey: elements.aiApiKeyInput.value,
      model: elements.aiModelInput.value
    },
    embedding: {
      provider: elements.embeddingProviderSelect.value,
      baseUrl: elements.embeddingBaseUrlInput.value,
      apiKey: elements.embeddingApiKeyInput.value,
      model: elements.embeddingModelInput.value
    }
  });

  await chrome.storage.local.set({ [AI_CONFIG_KEY]: config });
  smartSearchLlmCache.clear();
  searchLlmMissingConfigNotified = false;
  vectorQueryEmbeddingCache.clear();
  vectorItemEmbeddingCache.clear();
  await renderAiControls();
  showCloudMessage("LLM + embedding config saved.");
  scheduleLlmSmartSearchRefresh(true);
}

function onAiProviderChanged() {
  const provider = elements.aiProviderSelect.value || "openai";
  applyAiProviderUi(provider);

  const preset = AI_PROVIDER_PRESETS[provider];

  if (preset) {
    elements.aiBaseUrlInput.value = preset.baseUrl;
    if (!elements.aiModelInput.value.trim() || provider !== "custom") {
      elements.aiModelInput.value = preset.model;
    }
  }
}

function onEmbeddingProviderChanged() {
  const provider = elements.embeddingProviderSelect.value || "siliconflow";
  applyEmbeddingProviderUi(provider);

  const preset = EMBEDDING_PROVIDER_PRESETS[provider];
  if (preset) {
    elements.embeddingBaseUrlInput.value = preset.baseUrl;
    if (!elements.embeddingModelInput.value.trim() || provider !== "custom") {
      elements.embeddingModelInput.value = preset.model;
    }
  }
}

function applyAiProviderUi(provider) {
  if (provider === "minimax") {
    elements.aiBaseUrlInput.placeholder = "https://api.minimax.io/v1";
    elements.aiModelInput.placeholder = "MiniMax model name (e.g. MiniMax-M2.7)";
    return;
  }

  if (provider === "deepseek") {
    elements.aiBaseUrlInput.placeholder = "https://api.deepseek.com/v1";
    elements.aiModelInput.placeholder = "DeepSeek model name (e.g. deepseek-chat)";
    return;
  }

  if (provider === "custom") {
    elements.aiBaseUrlInput.placeholder = "Custom LLM API Base URL";
    elements.aiModelInput.placeholder = "Custom model name";
    return;
  }

  elements.aiBaseUrlInput.placeholder = "LLM API Base URL (e.g. https://api.openai.com/v1)";
  elements.aiModelInput.placeholder = "Model (e.g. gpt-4.1-mini)";
}

function applyEmbeddingProviderUi(provider) {
  if (provider === "siliconflow") {
    elements.embeddingBaseUrlInput.placeholder = "https://api.siliconflow.cn/v1";
    elements.embeddingModelInput.placeholder = "Embedding model name (e.g. BAAI/bge-m3)";
    return;
  }

  if (provider === "custom") {
    elements.embeddingBaseUrlInput.placeholder = "Custom Embedding API Base URL";
    elements.embeddingModelInput.placeholder = "Custom embedding model name";
    return;
  }

  elements.embeddingBaseUrlInput.placeholder = "Embedding API Base URL (e.g. https://api.openai.com/v1)";
  elements.embeddingModelInput.placeholder = "Embedding model (e.g. text-embedding-3-small)";
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
  elements.searchDateFrom.value = searchFilters.dateFrom;
  elements.searchDateTo.value = searchFilters.dateTo;
  elements.searchSortSelect.value = searchFilters.sortBy;
}

function renderSmartSearchChips() {
  elements.smartSearchChips.replaceChildren();

  if (!query) {
    elements.smartSearchChips.classList.add("hidden");
    return;
  }

  const chips = [];
  if (smartSearchHints.host) {
    chips.push({
      label: `Host: ${smartSearchHints.host}`,
      onRemove: () => {
        updateSmartSearchOverrides((current) => ({ ...current, suppressHost: true }));
      }
    });
  }

  if (smartSearchHints.dateFrom || smartSearchHints.dateTo) {
    chips.push({
      label: `Date: ${smartSearchHints.dateFrom || "?"}..${smartSearchHints.dateTo || "?"}`,
      onRemove: () => {
        updateSmartSearchOverrides((current) => ({ ...current, suppressDate: true }));
      }
    });
  }

  for (const keyword of smartSearchHints.keywords.slice(0, 8)) {
    chips.push({
      label: `Term: ${keyword}`,
      onRemove: () => {
        updateSmartSearchOverrides((current) => ({
          ...current,
          removedKeywords: Array.from(new Set([...current.removedKeywords, keyword]))
        }));
      }
    });
  }

  if (chips.length === 0) {
    elements.smartSearchChips.classList.add("hidden");
    return;
  }

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smart-chip";
    button.title = `Remove ${chip.label}`;
    button.setAttribute("aria-label", `Remove ${chip.label}`);

    const label = document.createElement("span");
    label.textContent = chip.label;
    const close = document.createElement("span");
    close.className = "smart-chip-close";
    close.textContent = "×";
    button.append(label, close);

    button.addEventListener("click", chip.onRemove);
    elements.smartSearchChips.append(button);
  }

  elements.smartSearchChips.classList.remove("hidden");
}

function isSearchActive() {
  return !!(
    query ||
    searchFilters.collection ||
    searchFilters.host ||
    searchFilters.dateFrom ||
    searchFilters.dateTo ||
    searchFilters.spaceId !== "all" ||
    smartSearchHints.host ||
    smartSearchHints.dateFrom ||
    smartSearchHints.dateTo
  );
}

function renderSearchResults() {
  if (!isSearchActive()) {
    elements.searchResults.classList.add("hidden");
    elements.searchResults.replaceChildren();
    return;
  }

  const searchState = buildSearchResults();
  const results = searchState.results;
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

  const smartSearchMeta = getSmartSearchMetaLabel();
  if (smartSearchMeta) {
    const hint = document.createElement("p");
    hint.className = "muted compact";
    hint.textContent = `Smart query: ${smartSearchMeta}`;
    elements.searchResults.append(hint);
  }

  const vectorMeta = getVectorSearchMetaLabel(searchState);
  if (vectorMeta) {
    const hint = document.createElement("p");
    hint.className = "muted compact";
    hint.textContent = vectorMeta;
    elements.searchResults.append(hint);
  }

  if (searchState.fallbackLabel) {
    const fallback = document.createElement("p");
    fallback.className = "muted compact";
    fallback.textContent = searchState.fallbackLabel;
    elements.searchResults.append(fallback);
  }

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted compact";
    empty.textContent = "No matching links.";
    elements.searchResults.append(empty);
    scheduleVectorSearchRerank(searchState);
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
    applyHighlightedText(link, result.item.title || result.item.url, getPrimaryHighlightTerm());

    const info = document.createElement("div");
    info.className = "search-result-meta";
    const activityLabel = formatDateTimeLabel(getItemActivityIso(result.item));
    applyHighlightedText(
      info,
      `${result.spaceName} / ${result.collectionName} · ${getHost(result.item.url)} · Added ${formatDateLabel(
        result.item.addedAt
      )} · Active ${activityLabel}`,
      getPrimaryHighlightTerm()
    );

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
  scheduleVectorSearchRerank(searchState);
}

function buildSearchResults() {
  const baseCriteria = createSearchCriteria();
  const baseResults = collectSearchResults(baseCriteria);

  if (baseResults.length > 0) {
    return finalizeSearchResults(baseResults, baseCriteria, "");
  }

  const fallbackPlans = createFallbackSearchPlans(baseCriteria);
  if (fallbackPlans.length === 0) {
    return {
      results: [],
      fallbackLabel: "",
      criteria: baseCriteria,
      vectorSignature: "",
      vectorApplied: false,
      vectorPending: false
    };
  }

  for (const plan of fallbackPlans) {
    const fallbackResults = collectSearchResults(plan.criteria);
    if (fallbackResults.length > 0) {
      return finalizeSearchResults(fallbackResults, plan.criteria, plan.label);
    }
  }

  return {
    results: [],
    fallbackLabel: "",
    criteria: baseCriteria,
    vectorSignature: "",
    vectorApplied: false,
    vectorPending: false
  };
}

function finalizeSearchResults(rawResults, criteria, fallbackLabel = "") {
  const sorted = sortSearchResults(rawResults, criteria.terms.length > 0);
  const vectorSignature = createVectorSearchSignature(criteria, sorted);
  const vectorReranked = applyVectorSearchScores(sorted, vectorSignature);
  return {
    results: vectorReranked.results,
    fallbackLabel,
    criteria,
    vectorSignature,
    vectorApplied: vectorReranked.applied,
    vectorPending: vectorReranked.pending
  };
}

function createSearchCriteria() {
  return {
    host: getEffectiveHostFilter(),
    dateFrom: getEffectiveDateFromFilter(),
    dateTo: getEffectiveDateToFilter(),
    terms: getActiveSearchTerms()
  };
}

function createFallbackSearchPlans(baseCriteria) {
  const hasSmartHostOnly = !searchFilters.host && !!smartSearchHints.host;
  const hasSmartDateFromOnly = !searchFilters.dateFrom && !!smartSearchHints.dateFrom;
  const hasSmartDateToOnly = !searchFilters.dateTo && !!smartSearchHints.dateTo;
  const hasSmartDateOnly = hasSmartDateFromOnly || hasSmartDateToOnly;
  const plans = [];

  if (!searchConfig.autoRelaxSmartFilters || !query || (!hasSmartHostOnly && !hasSmartDateOnly)) {
    return plans;
  }

  if (hasSmartDateOnly) {
    plans.push({
      criteria: {
        ...baseCriteria,
        dateFrom: searchFilters.dateFrom || "",
        dateTo: searchFilters.dateTo || ""
      },
      label: "No exact match. Showing relaxed results without smart date constraints."
    });
  }

  if (hasSmartHostOnly) {
    plans.push({
      criteria: {
        ...baseCriteria,
        host: searchFilters.host || ""
      },
      label: "No exact match. Showing relaxed results without smart host constraints."
    });
  }

  if (hasSmartDateOnly && hasSmartHostOnly) {
    plans.push({
      criteria: {
        ...baseCriteria,
        host: searchFilters.host || "",
        dateFrom: searchFilters.dateFrom || "",
        dateTo: searchFilters.dateTo || ""
      },
      label: "No exact match. Showing relaxed results without smart host/date constraints."
    });
  }

  return plans;
}

function collectSearchResults(criteria) {
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
        if (isItemMatchFilters(collection, item, space, criteria)) {
          results.push({
            spaceId: space.id,
            spaceName: space.name,
            collectionId: collection.id,
            collectionName: collection.name,
            item,
            score: computeSearchScore(space, collection, item, criteria.terms)
          });
        }
      }
    }
  }

  return results;
}

function sortSearchResults(results, hasSearchTerms) {
  if (searchFilters.sortBy === "recent_added") {
    results.sort((a, b) => toTimestamp(b.item.addedAt) - toTimestamp(a.item.addedAt));
  } else if (searchFilters.sortBy === "oldest_added") {
    results.sort((a, b) => toTimestamp(a.item.addedAt) - toTimestamp(b.item.addedAt));
  } else if (hasSearchTerms) {
    results.sort((a, b) => b.score - a.score || getItemActivityTimestamp(b.item) - getItemActivityTimestamp(a.item));
  } else {
    results.sort((a, b) => getItemActivityTimestamp(b.item) - getItemActivityTimestamp(a.item));
  }

  return results;
}

function createDefaultVectorSearchState() {
  return {
    signature: "",
    status: "idle",
    scoresByItemId: {},
    rankedItemIds: [],
    strategy: "mix",
    appliedCount: 0,
    candidateCount: 0,
    totalResultCount: 0,
    topKCount: 0,
    elapsedMs: 0,
    model: "",
    error: ""
  };
}

function createVectorSearchSignature(criteria, results) {
  if (!shouldRunVectorSearch(criteria, results)) {
    return "";
  }

  const candidateIds = results
    .slice(0, VECTOR_CANDIDATE_LIMIT)
    .map((result) => result?.item?.id)
    .filter(Boolean)
    .join(",");

  return JSON.stringify({
    q: query,
    terms: criteria.terms,
    host: criteria.host || "",
    dateFrom: criteria.dateFrom || "",
    dateTo: criteria.dateTo || "",
    sort: searchFilters.sortBy,
    candidates: candidateIds
  });
}

function shouldRunVectorSearch(criteria, results) {
  if (searchFilters.sortBy !== "recent_activity") {
    return false;
  }
  if (!Array.isArray(results) || results.length === 0) {
    return false;
  }
  if (!String(query || "").trim()) {
    return false;
  }

  const hasTerms = Array.isArray(criteria?.terms) && criteria.terms.length > 0;
  const hasStructuredFilter = Boolean(criteria?.host || criteria?.dateFrom || criteria?.dateTo || searchFilters.collection);
  return hasTerms || hasStructuredFilter;
}

function applyVectorSearchScores(results, signature) {
  if (!signature || searchFilters.sortBy !== "recent_activity") {
    return { results, applied: false, pending: false };
  }

  const sameSignature = vectorSearchState.signature === signature;
  const pending = sameSignature && vectorSearchState.status === "running";
  const canApply = sameSignature && vectorSearchState.status === "ready";

  if (!canApply) {
    return { results, applied: false, pending };
  }

  const rankByItemId = new Map((vectorSearchState.rankedItemIds || []).map((itemId, index) => [itemId, index]));
  const scoresByItemId = vectorSearchState.scoresByItemId || {};
  const strategy = vectorSearchState.strategy || "mix";
  const reranked = [...results];
  reranked.sort((a, b) => {
    const aRank = rankByItemId.has(a.item.id) ? rankByItemId.get(a.item.id) : Number.POSITIVE_INFINITY;
    const bRank = rankByItemId.has(b.item.id) ? rankByItemId.get(b.item.id) : Number.POSITIVE_INFINITY;
    if (strategy === "priority" && aRank !== bRank) {
      return aRank - bRank;
    }

    const aVector = Number(scoresByItemId[a.item.id]);
    const bVector = Number(scoresByItemId[b.item.id]);
    if (Number.isFinite(aVector) || Number.isFinite(bVector)) {
      if (Number.isFinite(aVector) && Number.isFinite(bVector) && aVector !== bVector) {
        return bVector - aVector;
      }
      if (Number.isFinite(aVector) && !Number.isFinite(bVector)) {
        return -1;
      }
      if (!Number.isFinite(aVector) && Number.isFinite(bVector)) {
        return 1;
      }
    }

    return b.score - a.score || getItemActivityTimestamp(b.item) - getItemActivityTimestamp(a.item);
  });
  return {
    results: reranked,
    applied: true,
    pending: false
  };
}

function getVectorSearchMetaLabel(searchState) {
  if (!query || !searchState?.vectorSignature || searchFilters.sortBy !== "recent_activity") {
    return "";
  }

  if (searchState.vectorApplied) {
    const strategyLabel = vectorSearchState.strategy === "priority" ? "priority" : "mix";
    const elapsedLabel = vectorSearchState.elapsedMs ? `, ${vectorSearchState.elapsedMs}ms` : "";
    return `Vector recall: ${strategyLabel} Top ${vectorSearchState.topKCount || 0} (${vectorSearchState.appliedCount}/${
      vectorSearchState.candidateCount || 0
    } scored${elapsedLabel}).`;
  }
  if (searchState.vectorPending) {
    return `Vector recall: computing ${vectorSearchState.candidateCount || 0} candidates...`;
  }
  if (vectorSearchState.signature === searchState.vectorSignature && vectorSearchState.status === "failed") {
    const elapsedLabel = vectorSearchState.elapsedMs ? `, ${vectorSearchState.elapsedMs}ms` : "";
    return `Vector recall: fallback lexical only (${vectorSearchState.error || "embedding unavailable"}${elapsedLabel}).`;
  }
  return "Vector recall: lexical baseline.";
}

function scheduleVectorSearchRerank(searchState) {
  if (vectorSearchDebounceTimer) {
    clearTimeout(vectorSearchDebounceTimer);
    vectorSearchDebounceTimer = null;
  }

  const signature = searchState?.vectorSignature || "";
  if (!signature || searchFilters.sortBy !== "recent_activity") {
    return;
  }

  if (vectorSearchState.signature === signature && (vectorSearchState.status === "running" || vectorSearchState.status === "ready")) {
    return;
  }

  const candidates = (searchState.results || []).slice(0, VECTOR_CANDIDATE_LIMIT);
  if (candidates.length === 0) {
    return;
  }
  const totalResultCount = Array.isArray(searchState.results) ? searchState.results.length : candidates.length;

  vectorSearchDebounceTimer = setTimeout(() => {
    runVectorSearchRerank(signature, searchState.criteria, candidates, totalResultCount).catch(() => {});
  }, VECTOR_SEARCH_DEBOUNCE_MS);
}

async function runVectorSearchRerank(signature, criteria, candidates, totalResultCount = candidates.length) {
  const requestId = ++vectorSearchRequestId;
  const startedAt = Date.now();
  const lexicalTop = candidates.slice(0, 5).map((entry) => ({
    id: entry?.item?.id || "",
    title: String(entry?.item?.title || "").slice(0, 80),
    score: Number(entry?.score || 0).toFixed(2)
  }));
  vectorSearchState = {
    signature,
    status: "running",
    scoresByItemId: {},
    rankedItemIds: [],
    strategy: "mix",
    appliedCount: 0,
    candidateCount: candidates.length,
    totalResultCount,
    topKCount: 0,
    elapsedMs: 0,
    model: "",
    error: ""
  };
  renderSearchResults();

  try {
    const aiConfig = await getAiConfig();
    const embeddingConfig = aiConfig.embedding || {};
    if (!embeddingConfig.apiKey || !embeddingConfig.baseUrl) {
      throw new Error("Embedding config missing.");
    }

    const embeddingModel = resolveVectorEmbeddingModel(embeddingConfig);
    const queryText = buildVectorQueryText(criteria);
    const queryEmbedding = await getQueryEmbeddingVector(queryText, embeddingConfig, embeddingModel);
    const itemEmbeddings = await getCandidateEmbeddings(candidates);

    const scoredCandidates = [];
    for (const candidate of candidates) {
      const embedding = itemEmbeddings.get(candidate.item.id);
      if (!embedding) {
        continue;
      }
      const cosine = cosineSimilarity(queryEmbedding, embedding);
      if (!Number.isFinite(cosine)) {
        continue;
      }

      const normalized = Math.max(0, Math.min(1, (cosine + 1) / 2));
      scoredCandidates.push({
        itemId: candidate.item.id,
        lexicalScore: candidate.score,
        vectorScore: normalized,
        activityTs: getItemActivityTimestamp(candidate.item)
      });
    }

    if (requestId !== vectorSearchRequestId) {
      return;
    }

    if (scoredCandidates.length === 0) {
      vectorSearchState = {
        signature,
        status: "failed",
        scoresByItemId: {},
        rankedItemIds: [],
        strategy: "mix",
        appliedCount: 0,
        candidateCount: candidates.length,
        totalResultCount,
        topKCount: 0,
        elapsedMs: Date.now() - startedAt,
        model: embeddingModel,
        error: "no usable embeddings in candidates"
      };
      renderSearchResults();
      if (VECTOR_SEARCH_DEBUG) {
        console.info("[vector-search] no-usable-embeddings", {
          query,
          signature,
          candidateCount: candidates.length,
          elapsedMs: Date.now() - startedAt
        });
      }
      return;
    }

    scoredCandidates.sort(
      (a, b) => b.vectorScore - a.vectorScore || b.lexicalScore - a.lexicalScore || b.activityTs - a.activityTs
    );
    const strategy = "mix";
    const topK = scoredCandidates.slice(0, VECTOR_TOPK_LIMIT);
    const scoresByItemId = {};
    const rankedItemIds = [];
    for (const entry of topK) {
      scoresByItemId[entry.itemId] =
        strategy === "priority" ? entry.vectorScore : entry.lexicalScore + entry.vectorScore * VECTOR_MIX_WEIGHT;
      rankedItemIds.push(entry.itemId);
    }

    vectorSearchState = {
      signature,
      status: "ready",
      scoresByItemId,
      rankedItemIds,
      strategy,
      appliedCount: scoredCandidates.length,
      candidateCount: candidates.length,
      totalResultCount,
      topKCount: topK.length,
      elapsedMs: Date.now() - startedAt,
      model: embeddingModel,
      error: ""
    };
    if (VECTOR_SEARCH_DEBUG) {
      const rerankedTop = scoredCandidates
        .slice(0, 5)
        .map((entry) => ({
          id: entry.itemId,
          score: Number(entry.vectorScore || 0).toFixed(4)
        }));
      console.info("[vector-search] rerank-applied", {
        query,
        model: embeddingModel,
        strategy,
        totalResultCount,
        candidateCount: candidates.length,
        appliedCount: scoredCandidates.length,
        topKCount: topK.length,
        elapsedMs: Date.now() - startedAt,
        lexicalTop,
        rerankedTop
      });
    }
    renderSearchResults();
  } catch (error) {
    if (requestId !== vectorSearchRequestId) {
      return;
    }
    vectorSearchState = {
      signature,
      status: "failed",
      scoresByItemId: {},
      rankedItemIds: [],
      strategy: "mix",
      appliedCount: 0,
      candidateCount: candidates.length,
      totalResultCount,
      topKCount: 0,
      elapsedMs: Date.now() - startedAt,
      model: "",
      error: formatCloudError(error)
    };
    if (VECTOR_SEARCH_DEBUG) {
      console.warn("[vector-search] rerank-failed", {
        query,
        signature,
        elapsedMs: Date.now() - startedAt,
        error: formatCloudError(error),
        lexicalTop
      });
    }
    renderSearchResults();
  }
}

function resolveVectorEmbeddingModel(embeddingConfig) {
  const configured = String(embeddingConfig?.model || "").trim();
  if (configured) {
    return configured;
  }
  return VECTOR_EMBEDDING_MODEL_DEFAULT;
}

function buildVectorQueryText(criteria) {
  const terms = Array.isArray(criteria?.terms) ? criteria.terms.slice(0, 16) : [];
  const pieces = [query, ...terms];
  if (criteria?.host) {
    pieces.push(`host:${criteria.host}`);
  }
  if (criteria?.dateFrom || criteria?.dateTo) {
    pieces.push(`date:${criteria.dateFrom || "?"}..${criteria.dateTo || "?"}`);
  }
  return pieces.filter(Boolean).join(" | ");
}

async function getQueryEmbeddingVector(queryText, embeddingConfig, model) {
  const cacheKey = `${embeddingConfig.baseUrl}|${model}|${queryText}`;
  const cached = vectorQueryEmbeddingCache.get(cacheKey);
  if (cached) {
    vectorQueryEmbeddingCache.delete(cacheKey);
    vectorQueryEmbeddingCache.set(cacheKey, cached);
    return cached;
  }

  const response = await fetch(`${embeddingConfig.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${embeddingConfig.apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [queryText]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding API returned empty vector.");
  }

  vectorQueryEmbeddingCache.set(cacheKey, embedding);
  if (vectorQueryEmbeddingCache.size > VECTOR_SEARCH_CACHE_LIMIT) {
    const oldest = vectorQueryEmbeddingCache.keys().next().value;
    if (oldest) {
      vectorQueryEmbeddingCache.delete(oldest);
    }
  }

  return embedding;
}

async function getCandidateEmbeddings(candidates) {
  const embeddingById = new Map();
  const missingIds = [];

  for (const candidate of candidates) {
    const itemId = candidate?.item?.id;
    if (!itemId) {
      continue;
    }

    const localEmbedding = extractItemEmbedding(candidate.item);
    if (localEmbedding) {
      rememberVectorItemEmbedding(itemId, localEmbedding);
      embeddingById.set(itemId, localEmbedding);
      continue;
    }

    const cached = vectorItemEmbeddingCache.get(itemId);
    if (cached) {
      vectorItemEmbeddingCache.delete(itemId);
      vectorItemEmbeddingCache.set(itemId, cached);
      embeddingById.set(itemId, cached);
      continue;
    }

    missingIds.push(itemId);
  }

  if (missingIds.length > 0) {
    try {
      const user = await getCloudUser();
      if (user) {
        const fetched = await fetchCloudLinkEmbeddings(missingIds);
        for (const [itemId, embedding] of fetched.entries()) {
          if (Array.isArray(embedding) && embedding.length > 0) {
            rememberVectorItemEmbedding(itemId, embedding);
            embeddingById.set(itemId, embedding);
          }
        }
      }
    } catch {}
  }

  return embeddingById;
}

function extractItemEmbedding(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (Array.isArray(item.embedding) && item.embedding.length > 0) {
    return item.embedding;
  }

  const preprocess = item.preprocess;
  if (preprocess && Array.isArray(preprocess.embedding) && preprocess.embedding.length > 0) {
    return preprocess.embedding;
  }

  return null;
}

function rememberVectorItemEmbedding(itemId, embedding) {
  vectorItemEmbeddingCache.set(itemId, embedding);
  if (vectorItemEmbeddingCache.size > 400) {
    const oldest = vectorItemEmbeddingCache.keys().next().value;
    if (oldest) {
      vectorItemEmbeddingCache.delete(oldest);
    }
  }
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return NaN;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      continue;
    }
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm <= 0 || rightNorm <= 0) {
    return NaN;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
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
  const deleteButton = fragment.querySelector(".delete-collection");
  const dropZone = fragment.querySelector(".drop-zone");
  const linkList = fragment.querySelector(".link-list");

  card.dataset.collectionId = collection.id;
  nameInput.value = collection.name;
  notesInput.value = collection.notes;
  openAllButton.disabled = collection.items.length === 0;

  const collectionMeta = document.createElement("p");
  collectionMeta.className = "collection-meta";
  collectionMeta.textContent = `Created ${formatDateTimeLabel(collection.createdAt)} · ${collection.items.length} links`;
  card.insertBefore(collectionMeta, dropZone);

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
  deleteButton.addEventListener("click", () => deleteCollection(collection.id));

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
  applyHighlightedText(title, item.title || item.url, getPrimaryHighlightTerm());

  const host = document.createElement("span");
  host.className = "tab-host";
  applyHighlightedText(host, getHost(item.url), getPrimaryHighlightTerm());

  text.append(title, host);
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

  const terms = getActiveSearchTerms();
  if (terms.length > 0) {
    return [space.name, collection.name, collection.notes].some((value) => doesValueMatchSearchTerms(value, terms));
  }

  return true;
}

function isItemMatchFilters(collection, item, space = getActiveSpace(deck), criteria = createSearchCriteria()) {
  const host = getHost(item.url || "").toLowerCase();
  const activityTs = getItemActivityTimestamp(item);
  const effectiveHost = criteria.host || "";
  const effectiveHosts = getHostFilterCandidates(effectiveHost);
  const effectiveDateFrom = criteria.dateFrom || "";
  const effectiveDateTo = criteria.dateTo || "";
  const searchDateFromTs = effectiveDateFrom ? Date.parse(`${effectiveDateFrom}T00:00:00`) : 0;
  const searchDateToTs = effectiveDateTo ? Date.parse(`${effectiveDateTo}T23:59:59.999`) : 0;
  const inSelectedSpace = searchFilters.spaceId === "all" || searchFilters.spaceId === space.id;

  if (!inSelectedSpace) {
    return false;
  }

  if (effectiveHosts.length > 0 && !effectiveHosts.some((candidate) => host.includes(candidate))) {
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

  const terms = criteria.terms || [];
  if (terms.length === 0) {
    return true;
  }

  const enhancementTerms = getSearchEnhancementTerms(item);
  return [item.title, item.url, host, collection.name, collection.notes, space.name, ...enhancementTerms].some((value) =>
    doesValueMatchSearchTerms(value, terms)
  );
}

function createEmptySmartSearchHints() {
  return {
    rawInput: "",
    keywords: [],
    expandedTerms: [],
    host: "",
    dateFrom: "",
    dateTo: "",
    hasDerivedFilter: false
  };
}

function createEmptySmartSearchOverrides() {
  return {
    removedKeywords: [],
    suppressHost: false,
    suppressDate: false
  };
}

function normalizeSmartSearchOverrides(rawOverrides) {
  const next = rawOverrides && typeof rawOverrides === "object" ? rawOverrides : {};
  const removedKeywords = Array.isArray(next.removedKeywords)
    ? Array.from(new Set(next.removedKeywords.map((keyword) => String(keyword || "").toLowerCase()).filter(Boolean))).slice(0, 30)
    : [];

  return {
    removedKeywords,
    suppressHost: Boolean(next.suppressHost),
    suppressDate: Boolean(next.suppressDate)
  };
}

function cloneSmartSearchHints(hints) {
  return {
    rawInput: hints.rawInput || "",
    keywords: Array.isArray(hints.keywords) ? [...hints.keywords] : [],
    expandedTerms: Array.isArray(hints.expandedTerms) ? [...hints.expandedTerms] : [],
    host: hints.host || "",
    dateFrom: hints.dateFrom || "",
    dateTo: hints.dateTo || "",
    hasDerivedFilter: Boolean(hints.hasDerivedFilter)
  };
}

function parseSmartSearchQuery(rawInput) {
  const normalizedInput = String(rawInput || "").trim().toLowerCase();
  if (!normalizedInput) {
    return createEmptySmartSearchHints();
  }

  const cached = smartSearchCache.get(normalizedInput);
  if (cached) {
    smartSearchCache.delete(normalizedInput);
    smartSearchCache.set(normalizedInput, cached);
    return cloneSmartSearchHints(cached);
  }

  const dateRange = parseRelativeDateRange(normalizedInput);
  const datePatterns = [
    /今天/g,
    /\btoday\b/g,
    /昨天/g,
    /\byesterday\b/g,
    /本周/g,
    /\bthis week\b/g,
    /上周/g,
    /\blast week\b/g,
    /本月/g,
    /\bthis month\b/g,
    /上个月/g,
    /上月/g,
    /\blast month\b/g,
    /(最近|近)\s*\d{1,2}\s*天/g,
    /\b(last|past)\s+\d{1,2}\s+days?\b/g
  ];
  let normalizedForTerms = normalizedInput;
  for (const pattern of datePatterns) {
    normalizedForTerms = normalizedForTerms.replace(pattern, " ");
  }

  let host = extractHostFilter(normalizedInput);
  if (host) {
    normalizedForTerms = normalizedForTerms.replace(new RegExp(host.replace(/\./g, "\\."), "g"), " ");
  }

  const keywords = tokenizeSearchInput(normalizedForTerms).filter((token) => !SEARCH_STOP_WORDS.has(token));
  const expandedTerms = expandSearchTerms(keywords);
  if (expandedTerms.length === 0) {
    expandedTerms.push(normalizedInput);
  }

  const hints = {
    rawInput: normalizedInput,
    keywords,
    expandedTerms,
    host,
    dateFrom: dateRange?.dateFrom || "",
    dateTo: dateRange?.dateTo || "",
    hasDerivedFilter: Boolean(host || dateRange || keywords.length > 0)
  };
  rememberSmartSearchCache(normalizedInput, hints);
  return cloneSmartSearchHints(hints);
}

function rememberSmartSearchCache(key, hints) {
  smartSearchCache.set(key, cloneSmartSearchHints(hints));
  if (smartSearchCache.size <= SMART_SEARCH_CACHE_LIMIT) {
    return;
  }

  const oldestKey = smartSearchCache.keys().next().value;
  if (oldestKey) {
    smartSearchCache.delete(oldestKey);
  }
}

function getSmartSearchOverrides(rawInput) {
  const normalizedInput = String(rawInput || "").trim().toLowerCase();
  if (!normalizedInput) {
    return createEmptySmartSearchOverrides();
  }

  const cached = smartSearchOverrideCache.get(normalizedInput);
  if (cached) {
    smartSearchOverrideCache.delete(normalizedInput);
    smartSearchOverrideCache.set(normalizedInput, cached);
    return normalizeSmartSearchOverrides(cached);
  }

  return createEmptySmartSearchOverrides();
}

function rememberSmartSearchOverrides(rawInput, overrides) {
  const normalizedInput = String(rawInput || "").trim().toLowerCase();
  if (!normalizedInput) {
    return;
  }

  smartSearchOverrideCache.set(normalizedInput, normalizeSmartSearchOverrides(overrides));
  if (smartSearchOverrideCache.size <= SMART_SEARCH_CACHE_LIMIT) {
    return;
  }

  const oldestKey = smartSearchOverrideCache.keys().next().value;
  if (oldestKey) {
    smartSearchOverrideCache.delete(oldestKey);
  }
}

function applySmartSearchOverrides(hints, overrides) {
  const normalizedOverrides = normalizeSmartSearchOverrides(overrides);
  const next = cloneSmartSearchHints(hints);

  if (normalizedOverrides.suppressHost) {
    next.host = "";
  }

  if (normalizedOverrides.suppressDate) {
    next.dateFrom = "";
    next.dateTo = "";
  }

  if (normalizedOverrides.removedKeywords.length > 0) {
    const removedSet = new Set(normalizedOverrides.removedKeywords);
    next.keywords = next.keywords.filter((keyword) => !removedSet.has(keyword));
    next.expandedTerms = expandSearchTerms(next.keywords);

    if (next.expandedTerms.length === 0 && next.keywords.length > 0) {
      next.expandedTerms = [...next.keywords];
    }
  }

  next.hasDerivedFilter = Boolean(next.host || next.dateFrom || next.dateTo || next.keywords.length > 0);
  return next;
}

function recalculateSmartSearchHints() {
  smartSearchOverrides = getSmartSearchOverrides(query);
  const baseHints = searchConfig.llmStrictMode ? createNeutralSmartSearchHints(query) : parseSmartSearchQuery(query);
  smartSearchHints = applySmartSearchOverrides(baseHints, smartSearchOverrides);
}

function updateSmartSearchOverrides(mutator) {
  if (!query) {
    return;
  }

  const nextOverrides = normalizeSmartSearchOverrides(mutator({ ...smartSearchOverrides }));
  smartSearchOverrides = nextOverrides;
  rememberSmartSearchOverrides(query, nextOverrides);
  smartSearchHints = applySmartSearchOverrides(getPreferredBaseHintsForQuery(query), nextOverrides);
  renderCollections();
  renderSearchResults();
  renderSmartSearchChips();
}

function getPreferredBaseHintsForQuery(input) {
  const cachedLlmHints = getCachedLlmHintsForQuery(input);
  if (cachedLlmHints) {
    return cachedLlmHints;
  }
  return searchConfig.llmStrictMode ? createNeutralSmartSearchHints(input) : parseSmartSearchQuery(input);
}

function tokenizeSearchInput(value) {
  return (value.match(/[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff._-]*/g) || [])
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2);
}

function expandSearchTerms(keywords) {
  const terms = new Set();
  for (const keyword of keywords) {
    terms.add(keyword);

    const mapped = SEARCH_TERM_EXPANSIONS[keyword];
    if (mapped) {
      for (const candidate of mapped) {
        terms.add(candidate.toLowerCase());
      }
    }
  }

  return Array.from(terms);
}

function extractHostFilter(input) {
  const explicitDomainMatch = input.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/);
  if (explicitDomainMatch?.[0]) {
    return explicitDomainMatch[0].toLowerCase();
  }

  const tokens = tokenizeSearchInput(input);
  for (const token of tokens) {
    const mapped = SEARCH_HOST_ALIASES[token];
    if (mapped) {
      return normalizeHostAliasValue(mapped);
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

function parseRelativeDateRange(input) {
  const now = new Date();
  const today = startOfDay(now);

  if (input.includes("today") || input.includes("今天")) {
    return toDateRange(today, today);
  }

  if (input.includes("yesterday") || input.includes("昨天")) {
    const yesterday = shiftDays(today, -1);
    return toDateRange(yesterday, yesterday);
  }

  if (input.includes("this week") || input.includes("本周")) {
    return toDateRange(startOfWeek(today), today);
  }

  if (input.includes("last week") || input.includes("上周")) {
    const thisWeekStart = startOfWeek(today);
    const lastWeekStart = shiftDays(thisWeekStart, -7);
    const lastWeekEnd = shiftDays(lastWeekStart, 6);
    return toDateRange(lastWeekStart, lastWeekEnd);
  }

  if (input.includes("this month") || input.includes("本月")) {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return toDateRange(monthStart, today);
  }

  if (input.includes("last month") || input.includes("上个月") || input.includes("上月")) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return toDateRange(monthStart, monthEnd);
  }

  const englishDaysMatch = input.match(/\b(?:last|past)\s+(\d{1,2})\s+days?\b/);
  if (englishDaysMatch?.[1]) {
    const dayCount = Number(englishDaysMatch[1]);
    if (Number.isFinite(dayCount) && dayCount >= 1 && dayCount <= 30) {
      return toDateRange(shiftDays(today, -(dayCount - 1)), today);
    }
  }

  const chineseDaysMatch = input.match(/(?:最近|近)\s*(\d{1,2})\s*天/);
  if (chineseDaysMatch?.[1]) {
    const dayCount = Number(chineseDaysMatch[1]);
    if (Number.isFinite(dayCount) && dayCount >= 1 && dayCount <= 30) {
      return toDateRange(shiftDays(today, -(dayCount - 1)), today);
    }
  }

  return null;
}

function toDateRange(startDate, endDate) {
  return {
    dateFrom: toDateInputValue(startDate),
    dateTo: toDateInputValue(endDate)
  };
}

function toDateInputValue(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const start = startOfDay(date);
  const weekday = (start.getDay() + 6) % 7;
  return shiftDays(start, -weekday);
}

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getEffectiveHostFilter() {
  return searchFilters.host || smartSearchHints.host || "";
}

function getEffectiveDateFromFilter() {
  return searchFilters.dateFrom || smartSearchHints.dateFrom || "";
}

function getEffectiveDateToFilter() {
  return searchFilters.dateTo || smartSearchHints.dateTo || "";
}

function getActiveSearchTerms() {
  if (!query) {
    return [];
  }

  if (smartSearchHints.expandedTerms.length > 0) {
    return smartSearchHints.expandedTerms;
  }

  if (smartSearchOverrides.removedKeywords.length > 0) {
    return [];
  }

  return [query];
}

function getPrimaryHighlightTerm() {
  if (smartSearchHints.keywords.length > 0) {
    return smartSearchHints.keywords[0];
  }

  return query;
}

function doesValueMatchSearchTerms(value, terms) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return terms.some((term) => doesTermMatchValue(term, normalized));
}

function doesTermMatchValue(term, normalizedValue) {
  const normalizedTerm = String(term || "").toLowerCase();
  if (!normalizedTerm) {
    return false;
  }

  if (/^[a-z0-9][a-z0-9._-]*$/.test(normalizedTerm)) {
    return tokenizeSearchInput(normalizedValue).some((token) => token === normalizedTerm || token.split(/[._-]+/).includes(normalizedTerm));
  }

  return normalizedValue.includes(normalizedTerm);
}

function computeSearchScore(space, collection, item, terms = getActiveSearchTerms()) {
  if (terms.length === 0) {
    return getRecencyScore(item);
  }

  const title = String(item.title || "").toLowerCase();
  const url = String(item.url || "").toLowerCase();
  const host = getHost(item.url || "").toLowerCase();
  const collectionName = String(collection.name || "").toLowerCase();
  const spaceName = String(space.name || "").toLowerCase();
  const collectionNotes = String(collection.notes || "").toLowerCase();
  const enhancementTerms = getSearchEnhancementTerms(item);
  const searchValues = [title, url, host, collectionName, collectionNotes, spaceName, ...enhancementTerms];
  let score = 0;

  for (const term of terms) {
    const termWeight = getSearchTermWeight(term);
    if (doesTermMatchValue(term, title)) {
      score += 8 * termWeight;
    }
    if (doesTermMatchValue(term, url)) {
      score += 5 * termWeight;
    }
    if (doesTermMatchValue(term, host)) {
      score += 4 * termWeight;
    }
    if (doesTermMatchValue(term, collectionName)) {
      score += 3 * termWeight;
    }
    if (doesTermMatchValue(term, collectionNotes)) {
      score += 2 * termWeight;
    }
    if (doesTermMatchValue(term, spaceName)) {
      score += 1 * termWeight;
    }
    for (const enhancementTerm of enhancementTerms) {
      if (doesTermMatchValue(term, enhancementTerm)) {
        score += 4 * termWeight;
      }
    }
  }

  const primaryKeywords = getPrimaryScoringKeywords();
  if (primaryKeywords.length >= 2 && primaryKeywords.every((term) => searchValues.some((value) => doesTermMatchValue(term, value)))) {
    score += 10;
  }

  if (query && query.length >= 4 && (title.includes(query) || url.includes(query))) {
    score += 12;
  }

  score += getRecencyScore(item);
  return score;
}

function getSearchTermWeight(term) {
  const normalizedTerm = String(term || "").toLowerCase();
  const primaryKeywords = getPrimaryScoringKeywords();
  if (primaryKeywords.length === 0 || primaryKeywords.includes(normalizedTerm)) {
    return 1;
  }
  return 0.25;
}

function getPrimaryScoringKeywords() {
  return Array.from(
    new Set((Array.isArray(smartSearchHints.keywords) ? smartSearchHints.keywords : []).map((term) => String(term || "").toLowerCase()).filter(Boolean))
  );
}

function getRecencyScore(item) {
  const activityTs = getItemActivityTimestamp(item);
  if (!activityTs) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - activityTs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 1) {
    return 8;
  }
  if (ageDays <= 7) {
    return 6;
  }
  if (ageDays <= 30) {
    return 4;
  }
  if (ageDays <= 90) {
    return 2;
  }
  return 0;
}

function getSmartSearchMetaLabel() {
  if (!query || !smartSearchHints.hasDerivedFilter) {
    return "";
  }

  const labels = [];
  if (smartSearchHints.host) {
    labels.push(`host=${smartSearchHints.host}`);
  }
  if (smartSearchHints.dateFrom || smartSearchHints.dateTo) {
    labels.push(`date=${smartSearchHints.dateFrom || "?"}..${smartSearchHints.dateTo || "?"}`);
  }
  if (smartSearchHints.keywords.length > 0) {
    labels.push(`terms=${smartSearchHints.keywords.slice(0, 4).join(", ")}`);
  }

  return labels.join(" · ");
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

function parseLlmJson(content) {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const normalizedWhole = normalizeLikelyJsonString(trimmed);
    if (normalizedWhole) {
      try {
        return JSON.parse(normalizedWhole);
      } catch {}
    }

    const fromFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fromFence?.[1]) {
      try {
        return JSON.parse(fromFence[1].trim());
      } catch {}

      const normalizedFence = normalizeLikelyJsonString(fromFence[1].trim());
      if (normalizedFence) {
        try {
          return JSON.parse(normalizedFence);
        } catch {}
      }
    }

    const extracted = extractFirstJsonObject(trimmed);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch {}

      const normalizedExtracted = normalizeLikelyJsonString(extracted);
      if (normalizedExtracted) {
        return JSON.parse(normalizedExtracted);
      }
    }
  }

  throw new Error("无法解析 LLM 返回的 JSON。");
}

function normalizeLikelyJsonString(input) {
  if (!input || typeof input !== "string") {
    return "";
  }

  let text = input.trim();
  if (!text) {
    return "";
  }

  // Normalize smart quotes and trim trailing semicolon noise.
  text = text.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'").replace(/;\s*$/, "");
  // Quote bare object keys: {foo: 1} / ,bar:
  text = text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, "$1\"$2\"$3");
  // Convert single-quoted strings to double-quoted JSON strings.
  text = text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner) => {
    const escaped = String(inner).replace(/"/g, "\\\"");
    return `"${escaped}"`;
  });
  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, "$1");

  return text;
}

function extractFirstJsonObject(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (startIndex < 0) {
      if (char === "{") {
        startIndex = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function scheduleLlmSmartSearchRefresh(force = false) {
  if (searchLlmDebounceTimer) {
    clearTimeout(searchLlmDebounceTimer);
    searchLlmDebounceTimer = null;
  }

  const input = query.trim();
  if (!input) {
    searchLlmRequestId += 1;
    return;
  }

  const run = async () => {
    await refreshSmartSearchHintsWithLlm(input);
  };

  if (force) {
    run().catch(() => {});
    return;
  }

  searchLlmDebounceTimer = setTimeout(() => {
    run().catch(() => {});
  }, SEARCH_LLM_DEBOUNCE_MS);
}

async function refreshSmartSearchHintsWithLlm(input) {
  const requestId = ++searchLlmRequestId;
  const activeQuery = String(input || "").trim().toLowerCase();
  if (!activeQuery) {
    return;
  }

  const aiConfig = await getAiConfig();
  if (!aiConfig.apiKey || !aiConfig.baseUrl || !aiConfig.model) {
    if (searchConfig.llmStrictMode) {
      smartSearchHints = applySmartSearchOverrides(createNeutralSmartSearchHints(activeQuery), smartSearchOverrides);
      renderCollections();
      renderSearchResults();
      renderSmartSearchChips();
    }
    if (!searchLlmMissingConfigNotified) {
      showCloudMessage(
        searchConfig.llmStrictMode
          ? "LLM search needs API Key + Base URL + Model. NL enhancement is paused (strict mode)."
          : "LLM search needs API Key + Base URL + Model. Using local parse fallback.",
        true
      );
      searchLlmMissingConfigNotified = true;
    }
    return;
  }

  searchLlmMissingConfigNotified = false;

  try {
    const llmHints = await parseSmartSearchQueryWithLlm(activeQuery, aiConfig, {
      strictMode: searchConfig.llmStrictMode
    });
    if (requestId !== searchLlmRequestId || activeQuery !== query) {
      return;
    }

    const localHints = parseSmartSearchQuery(activeQuery);
    smartSearchOverrides = getSmartSearchOverrides(activeQuery);
    smartSearchHints = applySmartSearchOverrides(mergeSmartSearchHints(localHints, llmHints), smartSearchOverrides);
    renderCollections();
    renderSearchResults();
    renderSmartSearchChips();
  } catch (error) {
    if (requestId !== searchLlmRequestId || activeQuery !== query) {
      return;
    }
    if (searchConfig.llmStrictMode) {
      smartSearchHints = applySmartSearchOverrides(createNeutralSmartSearchHints(activeQuery), smartSearchOverrides);
      renderCollections();
      renderSearchResults();
      renderSmartSearchChips();
    }
    showCloudMessage(
      searchConfig.llmStrictMode
        ? `LLM parse failed. NL enhancement paused (strict mode): ${formatCloudError(error)}`
        : `LLM parse failed, fallback active: ${formatCloudError(error)}`,
      true
    );
  }
}

function mergeSmartSearchHints(localHints, llmHints) {
  const merged = cloneSmartSearchHints(llmHints);
  if (!merged.host) {
    merged.host = localHints.host;
  }
  if (!merged.dateFrom) {
    merged.dateFrom = localHints.dateFrom;
  }
  if (!merged.dateTo) {
    merged.dateTo = localHints.dateTo;
  }

  if (!Array.isArray(merged.keywords) || merged.keywords.length === 0) {
    merged.keywords = [...localHints.keywords];
  }

  if (!Array.isArray(merged.expandedTerms) || merged.expandedTerms.length === 0) {
    merged.expandedTerms = [...localHints.expandedTerms];
  }

  merged.hasDerivedFilter = Boolean(merged.host || merged.dateFrom || merged.dateTo || merged.keywords.length > 0);
  return merged;
}

async function parseSmartSearchQueryWithLlm(input, aiConfig, options = {}) {
  const strictMode = Boolean(options.strictMode);
  const cacheKey = `${aiConfig.baseUrl}|${aiConfig.model}|${input}`;
  const cached = smartSearchLlmCache.get(cacheKey);
  if (cached) {
    smartSearchLlmCache.delete(cacheKey);
    smartSearchLlmCache.set(cacheKey, cached);
    return cloneSmartSearchHints(cached);
  }

  const today = toDateInputValue(new Date());
  const systemPrompt =
    "You are a search query parser for a browser link manager. Convert user intent into structured filters and keywords.";
  const userPrompt = [
    `Today is ${today}.`,
    "Return strict JSON only with keys:",
    '{"keywords":[],"expanded_terms":[],"host":"","date_from":"","date_to":""}',
    "Rules:",
    "1) keywords: 1-8 concise terms in user language.",
    "2) expanded_terms: optional synonyms/related tokens to improve recall.",
    "3) host: domain only (e.g. github.com), empty if unknown.",
    "4) date_from/date_to: YYYY-MM-DD; resolve relative time like last week/recent 7 days.",
    "5) Never include prose.",
    `Query: ${input}`
  ].join("\n");

  const parsed = await requestLlmJson(aiConfig, systemPrompt, userPrompt);
  const hints = normalizeLlmSmartSearchResult(parsed, input, { strictMode });
  smartSearchLlmCache.set(cacheKey, hints);

  if (smartSearchLlmCache.size > SMART_SEARCH_CACHE_LIMIT) {
    const oldestKey = smartSearchLlmCache.keys().next().value;
    if (oldestKey) {
      smartSearchLlmCache.delete(oldestKey);
    }
  }

  return cloneSmartSearchHints(hints);
}

function getCachedLlmHintsForQuery(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const entries = Array.from(smartSearchLlmCache.entries());
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [key, hints] = entries[index];
    if (key.endsWith(`|${normalized}`)) {
      return cloneSmartSearchHints(hints);
    }
  }

  return null;
}

function normalizeLlmSmartSearchResult(raw, rawInput, options = {}) {
  const strictMode = Boolean(options.strictMode);
  const localFallback = strictMode ? createNeutralSmartSearchHints(rawInput) : parseSmartSearchQuery(rawInput);
  const keywordText = Array.isArray(raw?.keywords) ? raw.keywords.join(" ") : "";
  const normalizedKeywords = tokenizeSearchInput(keywordText).slice(0, 8);

  const extraTerms = Array.isArray(raw?.expanded_terms) ? tokenizeSearchInput(raw.expanded_terms.join(" ")) : [];
  const expandedFromKeywords = expandSearchTerms(normalizedKeywords);
  const expandedTerms = Array.from(new Set([...normalizedKeywords, ...expandedFromKeywords, ...extraTerms])).slice(0, 20);

  const host = normalizeDomain(raw?.host) || "";
  const dateFrom = normalizeDateString(raw?.date_from);
  const dateTo = normalizeDateString(raw?.date_to);

  return {
    rawInput: String(rawInput || "").trim().toLowerCase(),
    keywords: normalizedKeywords.length > 0 ? normalizedKeywords : localFallback.keywords,
    expandedTerms: expandedTerms.length > 0 ? expandedTerms : localFallback.expandedTerms,
    host: host || localFallback.host,
    dateFrom: dateFrom || localFallback.dateFrom,
    dateTo: dateTo || localFallback.dateTo,
    hasDerivedFilter: true
  };
}

function normalizeDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) ? domain : "";
}

function normalizeDateString(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return "";
  }
  const ts = Date.parse(`${text}T00:00:00`);
  return Number.isFinite(ts) ? text : "";
}

function createNeutralSmartSearchHints(rawInput) {
  return {
    rawInput: String(rawInput || "").trim().toLowerCase(),
    keywords: [],
    expandedTerms: [],
    host: "",
    dateFrom: "",
    dateTo: "",
    hasDerivedFilter: false
  };
}

async function requestLlmJson(aiConfig, systemPrompt, userPrompt) {
  const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`
    },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = extractLlmContent(data?.choices?.[0]?.message?.content);

  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty content.");
  }

  return parseLlmJson(content);
}

function extractLlmContent(rawContent) {
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (typeof part.content === "string") {
            return part.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (rawContent && typeof rawContent === "object") {
    if (typeof rawContent.text === "string") {
      return rawContent.text;
    }
    if (typeof rawContent.content === "string") {
      return rawContent.content;
    }
  }

  return "";
}

function createEmptySearchEnhancementIndex() {
  return {
    version: 1,
    items: {}
  };
}

function normalizeSearchEnhancementIndex(rawIndex) {
  if (!rawIndex || typeof rawIndex !== "object") {
    return createEmptySearchEnhancementIndex();
  }

  const rawItems = rawIndex.items && typeof rawIndex.items === "object" ? rawIndex.items : {};
  const normalizedItems = {};

  for (const [url, value] of Object.entries(rawItems)) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      continue;
    }
    normalizedItems[normalizedUrl] = normalizeSearchEnhancementEntry(value);
  }

  return {
    version: 1,
    items: normalizedItems
  };
}

function normalizeSearchEnhancementEntry(rawEntry) {
  const next = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const keywords = Array.isArray(next.keywords) ? tokenizeSearchInput(next.keywords.join(" ")) : [];
  const entities = Array.isArray(next.entities) ? tokenizeSearchInput(next.entities.join(" ")) : [];

  return {
    processedAt: String(next.processedAt || ""),
    model: String(next.model || ""),
    cleanTitle: truncateText(next.cleanTitle, 180),
    summary: truncateText(next.summary, 220),
    keywords: Array.from(new Set(keywords)).slice(0, 16),
    entities: Array.from(new Set(entities)).slice(0, 16),
    intent: truncateText(next.intent, 40).toLowerCase(),
    language: truncateText(next.language, 20).toLowerCase()
  };
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

async function loadSearchEnhancementIndex() {
  const result = await chrome.storage.local.get(SEARCH_ENHANCEMENT_INDEX_KEY);
  searchEnhancementIndex = normalizeSearchEnhancementIndex(result[SEARCH_ENHANCEMENT_INDEX_KEY]);
}

async function saveSearchEnhancementIndex() {
  await chrome.storage.local.set({
    [SEARCH_ENHANCEMENT_INDEX_KEY]: searchEnhancementIndex
  });
}

function getSearchEnhancementEntry(url) {
  return searchEnhancementIndex.items[String(url || "").trim()] || null;
}

function getSearchEnhancementTerms(item) {
  const entry = getSearchEnhancementEntry(item.url);
  if (!entry) {
    return [];
  }

  return [entry.cleanTitle, entry.summary, entry.intent, entry.language, ...(entry.keywords || []), ...(entry.entities || [])]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function getSearchEnhancementStats() {
  const urlsInDeck = new Set();
  for (const space of deck.spaces) {
    for (const collection of space.collections) {
      for (const item of collection.items) {
        if (item?.url) {
          urlsInDeck.add(item.url);
        }
      }
    }
  }

  let processedCount = 0;
  for (const url of urlsInDeck) {
    if (getSearchEnhancementEntry(url)) {
      processedCount += 1;
    }
  }

  return {
    totalCount: urlsInDeck.size,
    processedCount
  };
}

function renderSearchEnhancementProgress() {
  const stats = getSearchEnhancementStats();
  const percent = stats.totalCount > 0 ? Math.round((stats.processedCount / stats.totalCount) * 100) : 0;
  let runtimeSuffix = "";
  if (searchEnhancementRunState?.active) {
    const batchTarget = Math.max(1, Number(searchEnhancementRunState.target) || 1);
    const batchProcessed = Math.max(0, Math.min(batchTarget, Number(searchEnhancementRunState.processed) || 0));
    elements.preprocessProgressBar.max = batchTarget;
    elements.preprocessProgressBar.value = batchProcessed;
    const etaSeconds = estimatePreprocessEtaSeconds(searchEnhancementRunState);
    runtimeSuffix = ` · Batch ${searchEnhancementRunState.processed}/${searchEnhancementRunState.target}`;
    if (searchEnhancementRunState.processed < 20) {
      runtimeSuffix += " · ETA warming up";
    } else if (etaSeconds > 0) {
      runtimeSuffix += ` · ETA ${formatDuration(etaSeconds)}`;
    }
  } else {
    elements.preprocessProgressBar.max = 100;
    elements.preprocessProgressBar.value = percent;
  }
  elements.preprocessProgressText.textContent = `Preprocess progress: ${stats.processedCount}/${stats.totalCount} (${percent}%)${runtimeSuffix}`;
  elements.preprocessLastFull.textContent = `Last full preprocess: ${
    searchEnhancementMeta.lastFullProcessedAt ? new Date(searchEnhancementMeta.lastFullProcessedAt).toLocaleString() : "Never"
  }`;
}

function estimatePreprocessEtaSeconds(runState) {
  const elapsedSeconds = (Date.now() - runState.startedAt) / 1000;
  if (elapsedSeconds <= 0 || runState.processed <= 0) {
    return 0;
  }
  const speed = runState.processed / elapsedSeconds;
  if (speed <= 0) {
    return 0;
  }
  const remaining = Math.max(0, runState.target - runState.processed);
  return Math.round(remaining / speed);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${remainSeconds}s`;
  }
  return `${minutes}m ${remainSeconds}s`;
}

function createDefaultSearchEnhancementMeta() {
  return {
    lastFullProcessedAt: ""
  };
}

function normalizeSearchEnhancementMeta(rawMeta) {
  const next = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const lastFullProcessedAt = String(next.lastFullProcessedAt || "");
  const parsed = Date.parse(lastFullProcessedAt);
  return {
    lastFullProcessedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
  };
}

async function loadSearchEnhancementMeta() {
  const result = await chrome.storage.local.get(SEARCH_ENHANCEMENT_META_KEY);
  searchEnhancementMeta = normalizeSearchEnhancementMeta(result[SEARCH_ENHANCEMENT_META_KEY]);
}

async function saveSearchEnhancementMeta() {
  await chrome.storage.local.set({
    [SEARCH_ENHANCEMENT_META_KEY]: searchEnhancementMeta
  });
}

function isRateLimitedOverloadError(error) {
  const message = String(error?.message || "");
  return message.includes("HTTP 429") || message.includes("HTTP 529") || message.toLowerCase().includes("overload");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSearchEnhancementProcessing(options = {}) {
  if (searchEnhancementBusy) {
    return;
  }

  const force = Boolean(options.force);
  const aiConfig = await getAiConfig();
  if (!aiConfig.apiKey || !aiConfig.baseUrl || !aiConfig.model) {
    if (force) {
      showCloudMessage("Preprocess needs API Key + Base URL + Model.", true);
    }
    return;
  }
  const runtime = getSearchEnhancementRuntimeConfig(searchConfig, aiConfig);

  const candidates = collectSearchEnhancementCandidates(SEARCH_ENHANCEMENT_BATCH_SIZE);
  if (candidates.length === 0) {
    if (force) {
      const stats = getSearchEnhancementStats();
      showCloudMessage(`LLM preprocessing is up to date (${stats.processedCount}/${stats.totalCount}).`);
    }
    return;
  }

  searchEnhancementBusy = true;
  searchEnhancementRunState = {
    active: true,
    startedAt: Date.now(),
    target: candidates.length,
    processed: 0
  };
  elements.runPreprocessButton.disabled = true;
  elements.systemActionStatus.classList.add("loading");
  renderSearchEnhancementProgress();

  let successCount = 0;
  let failedCount = 0;
  let haltedByRateLimit = false;
  const startedAt = Date.now();
  try {
    const batches = chunkArray(candidates, runtime.requestItemLimit);
    let cursor = 0;
    let rateLimitStreak = 0;

    const runWorker = async () => {
      while (true) {
        if (haltedByRateLimit) {
          return;
        }

        const batch = batches[cursor];
        cursor += 1;
        if (!batch) {
          return;
        }

        const result = await processEnhancementBatchWithRetry(batch, aiConfig, runtime);
        successCount += result.successCount;
        failedCount += result.failedCount;
        searchEnhancementRunState.processed += result.attemptedCount;

        if (result.rateLimited) {
          rateLimitStreak += 1;
          await sleep(runtime.rateLimitCooldownMs);
          if (rateLimitStreak >= runtime.maxRateLimitStreak) {
            haltedByRateLimit = true;
          }
        } else {
          rateLimitStreak = 0;
        }

        renderSearchEnhancementProgress();
      }
    };

    const workers = Array.from({ length: Math.min(runtime.workerCount, batches.length) }, () => runWorker());
    await Promise.all(workers);

    if (successCount > 0) {
      pruneSearchEnhancementIndex();
      await saveSearchEnhancementIndex();
    }

    const stats = getSearchEnhancementStats();
    if (stats.totalCount > 0 && stats.processedCount >= stats.totalCount) {
      searchEnhancementMeta.lastFullProcessedAt = new Date().toISOString();
      await saveSearchEnhancementMeta();
    }

    renderCollections();
    renderSearchResults();
    renderSearchEnhancementProgress();

    const spentSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (haltedByRateLimit) {
      showCloudMessage(
        `Preprocess paused after repeated provider rate limits: ${successCount} successes, ${failedCount} failed, ${spentSeconds}s.`,
        true
      );
      return;
    }

    showCloudMessage(
      `Preprocess batch done (${runtime.modeLabel}): +${successCount} indexed, ${failedCount} failed. Progress ${stats.processedCount}/${stats.totalCount}.`
    );
  } catch (error) {
    showCloudMessage(`LLM preprocessing failed: ${formatCloudError(error)}`, true);
  } finally {
    searchEnhancementRunState = null;
    searchEnhancementBusy = false;
    elements.runPreprocessButton.disabled = false;
    elements.systemActionStatus.classList.remove("loading");
    renderSearchEnhancementProgress();
  }
}

function collectSearchEnhancementCandidates(limit = SEARCH_ENHANCEMENT_BATCH_SIZE) {
  const candidates = [];
  const seen = new Set();

  for (const space of deck.spaces) {
    for (const collection of space.collections) {
      for (const item of collection.items) {
        if (!item?.url || seen.has(item.url)) {
          continue;
        }
        seen.add(item.url);

        const entry = getSearchEnhancementEntry(item.url);
        if (entry && entry.processedAt) {
          continue;
        }

        candidates.push(item);
        if (candidates.length >= limit) {
          return candidates;
        }
      }
    }
  }

  return candidates;
}

function pruneSearchEnhancementIndex() {
  const activeUrls = new Set();
  for (const space of deck.spaces) {
    for (const collection of space.collections) {
      for (const item of collection.items) {
        if (item?.url) {
          activeUrls.add(item.url);
        }
      }
    }
  }

  const entries = Object.entries(searchEnhancementIndex.items).filter(([url]) => activeUrls.has(url));
  entries.sort((a, b) => Date.parse(b[1]?.processedAt || "") - Date.parse(a[1]?.processedAt || ""));
  const trimmed = entries.slice(0, 3000);
  searchEnhancementIndex.items = Object.fromEntries(trimmed);
}

async function processEnhancementBatchWithRetry(items, aiConfig, runtime) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= runtime.maxRetries) {
    try {
      const parsedByUrl = await requestSearchEnhancementBatch(items, aiConfig, runtime.fastMode);
      let successCount = 0;
      let failedCount = 0;

      for (const item of items) {
        const parsed = parsedByUrl.get(item.url);
        if (!parsed) {
          failedCount += 1;
          continue;
        }

        searchEnhancementIndex.items[item.url] = normalizeSearchEnhancementEntry({
          ...parsed,
          processedAt: new Date().toISOString(),
          model: aiConfig.model
        });
        successCount += 1;
      }

      if (runtime.requestGapMs > 0) {
        await sleep(runtime.requestGapMs);
      }

      return {
        successCount,
        failedCount,
        rateLimited: false,
        attemptedCount: items.length
      };
    } catch (error) {
      lastError = error;
      if (!isRateLimitedOverloadError(error)) {
        return processEnhancementItemsIndividually(items, aiConfig, runtime);
      }

      if (attempt >= runtime.maxRetries) {
        return {
          successCount: 0,
          failedCount: items.length,
          rateLimited: true,
          attemptedCount: 0
        };
      }

      const backoffMs = SEARCH_ENHANCEMENT_RETRY_BASE_MS * Math.pow(2, attempt);
      await sleep(backoffMs);
    }

    attempt += 1;
  }

  if (lastError && !isRateLimitedOverloadError(lastError)) {
    throw lastError;
  }

  return {
    successCount: 0,
    failedCount: items.length,
    rateLimited: true,
    attemptedCount: 0
  };
}

async function processEnhancementItemsIndividually(items, aiConfig, runtime) {
  let successCount = 0;
  let failedCount = 0;
  let rateLimited = false;
  let attemptedCount = 0;

  for (const item of items) {
    attemptedCount += 1;
    try {
      const parsed = await requestSearchEnhancementForSingle(item, aiConfig, runtime.fastMode);
      searchEnhancementIndex.items[item.url] = normalizeSearchEnhancementEntry({
        ...parsed,
        processedAt: new Date().toISOString(),
        model: aiConfig.model
      });
      successCount += 1;
    } catch (error) {
      failedCount += 1;
      if (isRateLimitedOverloadError(error)) {
        rateLimited = true;
        break;
      }
    }

    if (runtime.requestGapMs > 0) {
      await sleep(runtime.requestGapMs);
    }
  }

  return {
    successCount,
    failedCount,
    rateLimited,
    attemptedCount
  };
}

async function requestSearchEnhancementForSingle(item, aiConfig, fastMode = false) {
  const host = getHost(item.url || "");
  const path = safeUrlPath(item.url);
  const promptDef = getSearchEnhancementPromptDefinition(fastMode);
  const userPrompt = [
    "Return JSON with keys:",
    promptDef.singleSchema,
    "Rules:",
    ...promptDef.singleRules,
    `Title: ${item.title || item.url || ""}`,
    `Host: ${host}`,
    `Path: ${path}`,
    `URL: ${item.url || ""}`
  ].join("\n");

  const parsed = await requestLlmJson(aiConfig, promptDef.systemPrompt, userPrompt);
  return {
    cleanTitle: parsed.clean_title || "",
    summary: fastMode ? "" : parsed.summary || "",
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    entities: fastMode ? [] : Array.isArray(parsed.entities) ? parsed.entities : [],
    intent: fastMode ? "" : parsed.intent || "",
    language: fastMode ? "" : parsed.language || ""
  };
}

async function requestSearchEnhancementBatch(items, aiConfig, fastMode = false) {
  const promptDef = getSearchEnhancementPromptDefinition(fastMode);
  const userPrompt = [
    "Return JSON with one key only: results",
    promptDef.batchSchema,
    "Rules:",
    ...promptDef.batchRules,
    "",
    "Input links:",
    ...items.map((item, index) => {
      const host = getHost(item.url || "");
      const path = safeUrlPath(item.url);
      const title = String(item.title || item.url || "").replace(/\s+/g, " ").trim();
      return `${index + 1}. url=${item.url} | title=${title} | host=${host} | path=${path}`;
    })
  ].join("\n");

  const parsed = await requestLlmJson(aiConfig, promptDef.systemPrompt, userPrompt);
  return normalizeBatchEnhancementResults(parsed, items, fastMode);
}

function normalizeBatchEnhancementResults(raw, items, fastMode = false) {
  const results = extractBatchResultEntries(raw);
  const expectedUrls = new Set(items.map((item) => item.url));
  const byUrl = new Map();
  const itemByCanonicalUrl = new Map(
    items
      .map((item) => [canonicalizeUrl(item.url), item])
      .filter(([canonical]) => Boolean(canonical))
  );

  for (const entry of results) {
    const url = String(entry?.url || "").trim();
    const directMatch = expectedUrls.has(url);
    const canonicalUrl = canonicalizeUrl(url);
    const canonicalMatchItem = canonicalUrl ? itemByCanonicalUrl.get(canonicalUrl) : null;
    const matchedUrl = directMatch ? url : canonicalMatchItem?.url || "";

    if (!matchedUrl) {
      continue;
    }

    byUrl.set(matchedUrl, {
      cleanTitle: entry.clean_title || "",
      summary: fastMode ? "" : entry.summary || "",
      keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
      entities: fastMode ? [] : Array.isArray(entry.entities) ? entry.entities : [],
      intent: fastMode ? "" : entry.intent || "",
      language: fastMode ? "" : entry.language || ""
    });
  }

  return byUrl;
}

function getSearchEnhancementPromptDefinition(fastMode) {
  const systemPrompt =
    "You normalize browser link metadata for high-quality search. Return strict JSON only. Output MUST be machine-readable JSON.";
  if (fastMode) {
    return {
      systemPrompt,
      singleSchema: '{"clean_title":"","keywords":[]}',
      singleRules: [
        "1) clean_title concise canonical title.",
        "2) keywords lowercase compact arrays, no duplicates, up to 10 items.",
        "3) No extra text."
      ],
      batchSchema: '{"results":[{"url":"","clean_title":"","keywords":[]}]}',
      batchRules: [
        "1) Return exactly one result object for each provided URL.",
        "2) Copy URL exactly as input.",
        "3) clean_title concise canonical title.",
        "4) keywords lowercase compact arrays, no duplicates, up to 10 items.",
        "5) No extra text."
      ]
    };
  }

  return {
    systemPrompt,
    singleSchema: '{"clean_title":"","summary":"","keywords":[],"entities":[],"intent":"","language":""}',
    singleRules: [
      "1) clean_title concise canonical title.",
      "2) summary one-line concise topic.",
      "3) keywords/entities lowercase compact arrays, no duplicates.",
      "4) intent from tutorial, bugfix, pricing, docs, news, discussion, tool, repo, other.",
      "5) language as short tag/name.",
      "6) No extra text."
    ],
    batchSchema: '{"results":[{"url":"","clean_title":"","summary":"","keywords":[],"entities":[],"intent":"","language":""}]}',
    batchRules: [
      "1) Return exactly one result object for each provided URL.",
      "2) Copy URL exactly as input.",
      "3) clean_title concise; summary one line; keywords/entities lowercase compact arrays.",
      "4) intent from: tutorial, bugfix, pricing, docs, news, discussion, tool, repo, other.",
      "5) language as short tag/name.",
      "6) No extra text."
    ]
  };
}

function getSearchEnhancementRuntimeConfig(config, aiConfig) {
  const fastMode = Boolean(config?.preprocessFastMode);
  const provider = aiConfig?.provider || "openai";
  if (provider === "minimax" && fastMode) {
    return {
      fastMode: true,
      modeLabel: "fast/minimax-safe",
      requestItemLimit: SEARCH_ENHANCEMENT_MINIMAX_FAST_REQUEST_ITEM_LIMIT,
      workerCount: SEARCH_ENHANCEMENT_MINIMAX_FAST_WORKER_COUNT,
      maxRetries: SEARCH_ENHANCEMENT_MINIMAX_FAST_MAX_RETRIES,
      requestGapMs: SEARCH_ENHANCEMENT_MINIMAX_FAST_REQUEST_GAP_MS,
      rateLimitCooldownMs: SEARCH_ENHANCEMENT_RATE_LIMIT_COOLDOWN_MS,
      maxRateLimitStreak: SEARCH_ENHANCEMENT_MAX_RATE_LIMIT_STREAK
    };
  }

  if (fastMode) {
    return {
      fastMode: true,
      modeLabel: "fast",
      requestItemLimit: SEARCH_ENHANCEMENT_FAST_REQUEST_ITEM_LIMIT,
      workerCount: SEARCH_ENHANCEMENT_FAST_WORKER_COUNT,
      maxRetries: SEARCH_ENHANCEMENT_FAST_MAX_RETRIES,
      requestGapMs: SEARCH_ENHANCEMENT_FAST_REQUEST_GAP_MS,
      rateLimitCooldownMs: SEARCH_ENHANCEMENT_RATE_LIMIT_COOLDOWN_MS,
      maxRateLimitStreak: SEARCH_ENHANCEMENT_MAX_RATE_LIMIT_STREAK
    };
  }
  return {
    fastMode: false,
    modeLabel: "standard",
    requestItemLimit: SEARCH_ENHANCEMENT_REQUEST_ITEM_LIMIT,
    workerCount: SEARCH_ENHANCEMENT_WORKER_COUNT,
    maxRetries: SEARCH_ENHANCEMENT_MAX_RETRIES,
    requestGapMs: SEARCH_ENHANCEMENT_REQUEST_GAP_MS,
    rateLimitCooldownMs: SEARCH_ENHANCEMENT_RATE_LIMIT_COOLDOWN_MS,
    maxRateLimitStreak: SEARCH_ENHANCEMENT_MAX_RATE_LIMIT_STREAK
  };
}

function extractBatchResultEntries(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (!raw || typeof raw !== "object") {
    return [];
  }

  if (Array.isArray(raw.results)) {
    return raw.results;
  }
  if (Array.isArray(raw.items)) {
    return raw.items;
  }
  if (Array.isArray(raw.data)) {
    return raw.data;
  }

  const keyEntries = Object.entries(raw)
    .filter(([key, value]) => /^https?:\/\//i.test(key) && value && typeof value === "object")
    .map(([key, value]) => ({ url: key, ...value }));
  if (keyEntries.length > 0) {
    return keyEntries;
  }

  if (raw.result && typeof raw.result === "object") {
    if (Array.isArray(raw.result.results)) {
      return raw.result.results;
    }
    if (Array.isArray(raw.result.items)) {
      return raw.result.items;
    }
    if (Array.isArray(raw.result.data)) {
      return raw.result.data;
    }
  }

  return [];
}

function canonicalizeUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    parsed.hash = "";
    // Normalize trailing slash for path except root
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function safeUrlPath(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
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

async function importPrivateInitBundleFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  await runCloudAction(async () => {
    const user = await getCloudUser();
    const canUsePrivateInit = await isPrivateInitAllowedUser(user);
    if (!canUsePrivateInit) {
      throw new Error("Private init import is not enabled for this account.");
    }

    const confirmed = window.confirm(
      "Import private init data now?\nThis will upsert spaces/collections/links into your current Supabase account."
    );
    if (!confirmed) {
      return "Private init import canceled.";
    }

    const raw = await readTextFromMaybeGzip(file);
    const bundle = JSON.parse(raw);
    const result = await importInitBundleToCloud(bundle, { setActiveSpace: true });
    deck = await syncDeckWithCloud();
    return `Private init imported: ${result.spaces} spaces, ${result.collections} collections, ${result.links} links.`;
  });
}

async function runCloudAction(action) {
  setCloudBusy(true);
  elements.systemActionStatus.classList.add("loading");
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
    elements.systemActionStatus.classList.remove("loading");
    await renderCloudControls();

    if (finalMessage) {
      showCloudMessage(finalMessage, isWarning);
    }
  }
}

function showCloudMessage(message, isWarning = false) {
  const stamp = new Date().toLocaleTimeString();
  elements.systemActionStatus.textContent = `${message} (${stamp})`;
  elements.systemActionStatus.classList.toggle("warning", isWarning);
  if (!isWarning) {
    elements.systemActionStatus.classList.remove("loading");
  }
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

async function readTextFromMaybeGzip(file) {
  const name = String(file?.name || "").toLowerCase();
  if (!name.endsWith(".gz")) {
    return file.text();
  }

  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support .gz import. Please use a plain .json file.");
  }

  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  const response = new Response(stream);
  return response.text();
}

async function isPrivateInitAllowedUser(user) {
  if (!user?.id) {
    return false;
  }

  const digest = await sha256Hex(`${String(user.id).trim()}|${PRIVATE_INIT_OWNER_SALT}`);
  return PRIVATE_INIT_ALLOWED_USER_HASHES.has(digest);
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function renderSearchControls() {
  searchConfig = await getSearchConfig();
  elements.smartSearchRelaxToggle.checked = searchConfig.autoRelaxSmartFilters;
  elements.llmStrictModeToggle.checked = searchConfig.llmStrictMode;
  elements.preprocessFastModeToggle.checked = searchConfig.preprocessFastMode;
  elements.runPreprocessButton.disabled = searchEnhancementBusy;
  renderSearchEnhancementProgress();
}

async function saveSearchControls() {
  const config = normalizeSearchConfig({
    autoRelaxSmartFilters: elements.smartSearchRelaxToggle.checked,
    llmStrictMode: elements.llmStrictModeToggle.checked,
    preprocessFastMode: elements.preprocessFastModeToggle.checked
  });

  await chrome.storage.local.set({
    [SEARCH_CONFIG_KEY]: config
  });

  searchConfig = config;
  recalculateSmartSearchHints();
  renderCollections();
  renderSearchResults();
  renderSmartSearchChips();
  scheduleLlmSmartSearchRefresh(true);
  showCloudMessage(
    `Smart search updated: auto-relax ${config.autoRelaxSmartFilters ? "on" : "off"}, strict LLM mode ${
      config.llmStrictMode ? "on" : "off"
    }, preprocess mode ${config.preprocessFastMode ? "fast" : "standard"}.`
  );
}

function clearSearch() {
  if (searchLlmDebounceTimer) {
    clearTimeout(searchLlmDebounceTimer);
    searchLlmDebounceTimer = null;
  }
  searchLlmRequestId += 1;
  query = "";
  smartSearchHints = createEmptySmartSearchHints();
  smartSearchOverrides = createEmptySmartSearchOverrides();
  elements.searchInput.value = "";
  renderSmartSearchChips();
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

function normalizeSearchConfig(rawConfig) {
  const next = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    autoRelaxSmartFilters: typeof next.autoRelaxSmartFilters === "boolean" ? next.autoRelaxSmartFilters : true,
    llmStrictMode: typeof next.llmStrictMode === "boolean" ? next.llmStrictMode : false,
    preprocessFastMode: typeof next.preprocessFastMode === "boolean" ? next.preprocessFastMode : true
  };
}

async function getAutoSaveConfig() {
  const result = await chrome.storage.local.get(AUTO_SAVE_CONFIG_KEY);
  return normalizeAutoSaveConfig(result[AUTO_SAVE_CONFIG_KEY]);
}

async function getSearchConfig() {
  const result = await chrome.storage.local.get(SEARCH_CONFIG_KEY);
  return normalizeSearchConfig(result[SEARCH_CONFIG_KEY]);
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

function normalizeAiConfig(rawConfig) {
  const next = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawLlm = next.llm && typeof next.llm === "object" ? next.llm : next;
  const rawEmbedding = next.embedding && typeof next.embedding === "object" ? next.embedding : {};

  const llmProvider =
    rawLlm.provider === "openai" || rawLlm.provider === "minimax" || rawLlm.provider === "deepseek" || rawLlm.provider === "custom"
      ? rawLlm.provider
      : DEFAULT_AI_CONFIG.llm.provider;
  const llmBaseUrl = String(rawLlm.baseUrl || DEFAULT_AI_CONFIG.llm.baseUrl).trim().replace(/\/$/, "");
  const llmApiKey = String(rawLlm.apiKey || "").trim();
  const llmModel = String(rawLlm.model || DEFAULT_AI_CONFIG.llm.model).trim();

  const embeddingProvider =
    rawEmbedding.provider === "siliconflow" || rawEmbedding.provider === "openai" || rawEmbedding.provider === "custom"
      ? rawEmbedding.provider
      : DEFAULT_AI_CONFIG.embedding.provider;
  const embeddingBaseUrl = String(rawEmbedding.baseUrl || DEFAULT_AI_CONFIG.embedding.baseUrl).trim().replace(/\/$/, "");
  const embeddingApiKey = String(rawEmbedding.apiKey || "").trim();
  const embeddingModel = String(rawEmbedding.model || DEFAULT_AI_CONFIG.embedding.model).trim();

  const normalizedLlm = {
    provider: llmProvider,
    baseUrl: llmBaseUrl || DEFAULT_AI_CONFIG.llm.baseUrl,
    apiKey: llmApiKey,
    model: llmModel || DEFAULT_AI_CONFIG.llm.model
  };

  const normalizedEmbedding = {
    provider: embeddingProvider,
    baseUrl: embeddingBaseUrl || DEFAULT_AI_CONFIG.embedding.baseUrl,
    apiKey: embeddingApiKey,
    model: embeddingModel || DEFAULT_AI_CONFIG.embedding.model
  };

  return {
    llm: normalizedLlm,
    embedding: normalizedEmbedding,
    // Compatibility: existing LLM callsites still read top-level fields.
    provider: normalizedLlm.provider,
    baseUrl: normalizedLlm.baseUrl,
    apiKey: normalizedLlm.apiKey,
    model: normalizedLlm.model
  };
}

async function getAiConfig() {
  const result = await chrome.storage.local.get(AI_CONFIG_KEY);
  return normalizeAiConfig(result[AI_CONFIG_KEY]);
}

function clearSearchFilters() {
  searchFilters.spaceId = "all";
  searchFilters.collection = "";
  searchFilters.host = "";
  searchFilters.dateFrom = "";
  searchFilters.dateTo = "";
  searchFilters.sortBy = "recent_activity";
  elements.searchSpaceFilter.value = "all";
  elements.searchCollectionFilter.value = "";
  elements.searchHostFilter.value = "";
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
    elements.importDeckButton,
    elements.saveAiConfigButton
  ]) {
    button.disabled = isBusy;
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
