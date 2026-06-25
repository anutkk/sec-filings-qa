import { APP_CONFIG, DEFAULT_PROVIDER } from "./config.js";
import { callJsonModel, callModel, getModelForRole } from "./providers.js";
import { answerQuestion, summarizeFiling } from "./qaEngine.js";
import { fetchFilingText, getCompanyFilings, setSecIdentity } from "./sec.js";
import { loadSessionApiKey, loadSettings, saveSessionApiKey, saveSettings } from "./storage.js";
import { appendLoadingMessage, appendMessage, renderCompanySummary, renderFilings, renderProviders, renderSource, selectedFilingIds, setStatus } from "./ui.js";

const state = {
  providerId: DEFAULT_PROVIDER,
  apiKey: "",
  localEnv: {},
  secIdentity: "",
  ticker: "",
  filingCount: APP_CONFIG.sec.defaultFilingCount,
  filingsOffset: 0,
  company: null,
  totalRecentFilings: 0,
  filings: [],
  chatHistory: [],
  latestSources: [],
};

const elements = {
  settingsForm: document.querySelector("#settingsForm"),
  providerSelect: document.querySelector("#providerSelect"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  rememberKeyInput: document.querySelector("#rememberKeyInput"),
  secIdentityInput: document.querySelector("#secIdentityInput"),
  tickerInput: document.querySelector("#tickerInput"),
  filingCountInput: document.querySelector("#filingCountInput"),
  filingsList: document.querySelector("#filingsList"),
  companySummary: document.querySelector("#companySummary"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  questionInput: document.querySelector("#questionInput"),
  askButton: document.querySelector("#askButton"),
  sourcePane: document.querySelector("#sourcePane"),
  sourceExternalLink: document.querySelector("#sourceExternalLink"),
};

init();

async function init() {
  const settings = loadSettings();
  state.localEnv = await loadLocalEnv();
  state.providerId = settings.providerId || DEFAULT_PROVIDER;
  state.secIdentity = settings.secIdentity || state.localEnv.SEC_IDENTITY || "";
  setSecIdentity(state.secIdentity);
  state.ticker = settings.ticker || "";
  state.filingCount = Number(settings.filingCount || APP_CONFIG.sec.defaultFilingCount);
  state.apiKey = loadSessionApiKey() || getLocalApiKey(state.providerId);

  renderProviders(elements.providerSelect, APP_CONFIG.providers, state.providerId);
  elements.apiKeyInput.value = state.apiKey;
  elements.rememberKeyInput.checked = Boolean(state.apiKey);
  elements.secIdentityInput.value = state.secIdentity;
  elements.tickerInput.value = state.ticker;
  elements.filingCountInput.value = state.filingCount;

  elements.settingsForm.addEventListener("submit", handleLoadFilings);
  elements.loadMoreButton.addEventListener("click", handleLoadMore);
  elements.chatForm.addEventListener("submit", handleAskQuestion);
  elements.questionInput.addEventListener("keydown", handleQuestionKeydown);
  elements.chatLog.addEventListener("click", handleCitationClick);
  elements.filingsList.addEventListener("change", handleFilingSelection);
  elements.providerSelect.addEventListener("change", handleProviderChange);
}

async function loadLocalEnv() {
  try {
    const module = await import("./env.local.js");
    return module.LOCAL_ENV || {};
  } catch {
    return {};
  }
}

function getLocalApiKey(providerId) {
  if (providerId === "gemini") {
    return state.localEnv.GEMINI_API_KEY || "";
  }
  return "";
}

function handleProviderChange() {
  const localApiKey = getLocalApiKey(elements.providerSelect.value);
  if (!elements.apiKeyInput.value.trim() && localApiKey) {
    elements.apiKeyInput.value = localApiKey;
  }
}

function handleQuestionKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  elements.chatForm.requestSubmit();
}

async function handleLoadFilings(event) {
  event.preventDefault();
  readSettingsFromForm();
  state.filings = [];
  state.filingsOffset = 0;
  state.chatHistory = [];
  state.latestSources = [];
  elements.filingsList.innerHTML = "";
  elements.loadMoreButton.disabled = true;
  renderSource(elements.sourcePane, elements.sourceExternalLink, null);
  await loadNextFilingsPage();
}

async function handleLoadMore() {
  readSettingsFromForm();
  await loadNextFilingsPage();
}

async function loadNextFilingsPage() {
  try {
    setStatus("Loading SEC data");
    const result = await getCompanyFilings({ ticker: state.ticker, limit: state.filingCount, offset: state.filingsOffset });
    state.company = result.company;
    state.totalRecentFilings = result.totalRecentFilings;
    state.filingsOffset += result.filings.length;

    const providerClient = makeProviderClient();
    for (const filing of result.filings) {
      setStatus(`Fetching ${filing.form}`);
      try {
        filing.text = await fetchFilingText(filing);
      } catch (error) {
        filing.textError = error.message;
        filing.selected = false;
        state.filings.push(filing);
        refreshFilings();
        continue;
      }

      setStatus(`Summarizing ${filing.form}`);
      try {
        filing.summary = await summarizeFiling({ filing, providerClient });
      } catch (error) {
        filing.summaryError = `Summary unavailable: ${error.message}`;
      }
      state.filings.push(filing);
      refreshFilings();
    }

    refreshFilings();
    setStatus("Ready");
  } catch (error) {
    appendMessage(elements.chatLog, "system", error.message);
    setStatus("Needs attention", "error");
  }
}

async function handleAskQuestion(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question) {
    return;
  }

  const selectedIds = new Set(selectedFilingIds(elements.filingsList));
  const selectedFilings = state.filings.filter((filing) => selectedIds.has(filing.id) && filing.text);
  if (!selectedFilings.length) {
    appendMessage(elements.chatLog, "system", "Select at least one filing with available text before asking a question.");
    return;
  }

  elements.questionInput.value = "";
  appendMessage(elements.chatLog, "user", question);
  state.chatHistory.push({ role: "user", content: question });
  const loadingMessage = appendLoadingMessage(elements.chatLog);

  try {
    setChatBusy(true);
    setStatus("Running QA workflow");
    const result = await answerQuestion({
      question,
      chatHistory: state.chatHistory,
      selectedFilings,
      providerClient: makeProviderClient(),
    });
    state.latestSources = result.sources;
    loadingMessage.remove();
    appendMessage(elements.chatLog, "assistant", result.finalAnswer, result.sources);
    state.chatHistory.push({ role: "assistant", content: result.finalAnswer });
    setStatus("Ready");
  } catch (error) {
    loadingMessage.remove();
    appendMessage(elements.chatLog, "system", error.message);
    setStatus("Needs attention", "error");
  } finally {
    setChatBusy(false);
  }
}

function handleFilingSelection(event) {
  const checkbox = event.target.closest("input[type='checkbox']");
  if (!checkbox) {
    return;
  }
  const filing = state.filings.find((item) => item.id === checkbox.value);
  if (filing) {
    filing.selected = checkbox.checked;
  }
  updateChatEnabled();
}

function handleCitationClick(event) {
  const button = event.target.closest(".citation-link");
  if (!button) {
    return;
  }
  const source = state.latestSources.find((item) => item.id === button.dataset.sourceId);
  renderSource(elements.sourcePane, elements.sourceExternalLink, source);
}

function readSettingsFromForm() {
  state.providerId = elements.providerSelect.value;
  state.apiKey = elements.apiKeyInput.value.trim();
  state.secIdentity = elements.secIdentityInput.value.trim();
  setSecIdentity(state.secIdentity);
  state.ticker = elements.tickerInput.value.trim().toUpperCase();
  state.filingCount = clamp(Number(elements.filingCountInput.value || APP_CONFIG.sec.defaultFilingCount), 1, 50);

  if (elements.rememberKeyInput.checked) {
    saveSessionApiKey(state.apiKey);
  } else {
    saveSessionApiKey("");
  }
  saveSettings({ providerId: state.providerId, secIdentity: state.secIdentity, ticker: state.ticker, filingCount: state.filingCount });
}

function makeProviderClient() {
  return {
    callCheap: (messages) => callModel({ providerId: state.providerId, apiKey: state.apiKey, model: getModelForRole(state.providerId, "cheap"), messages }),
    callExpensive: (messages) => callModel({ providerId: state.providerId, apiKey: state.apiKey, model: getModelForRole(state.providerId, "expensive"), messages }),
    callCheapJson: (messages) => callJsonModel({ providerId: state.providerId, apiKey: state.apiKey, model: getModelForRole(state.providerId, "cheap"), messages }),
    callExpensiveJson: (messages) => callJsonModel({ providerId: state.providerId, apiKey: state.apiKey, model: getModelForRole(state.providerId, "expensive"), messages }),
  };
}

function refreshFilings() {
  renderFilings(elements.filingsList, state.filings);
  if (state.company) {
    renderCompanySummary(elements.companySummary, state.company, state.filings.length, state.totalRecentFilings);
  }
  elements.loadMoreButton.disabled = state.filingsOffset >= state.totalRecentFilings;
  updateChatEnabled();
}

function updateChatEnabled() {
  const hasSelectedText = selectedFilingIds(elements.filingsList).some((id) => state.filings.find((filing) => filing.id === id && filing.text));
  elements.questionInput.disabled = !hasSelectedText;
  elements.askButton.disabled = !hasSelectedText;
}

function setChatBusy(isBusy) {
  elements.questionInput.disabled = isBusy;
  elements.askButton.disabled = isBusy;
  if (!isBusy) {
    updateChatEnabled();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}