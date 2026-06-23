import { APP_CONFIG } from "./config.js";

const TICKER_CACHE_KEY = "sec-filings-qa-ticker-index";
let lastRequestAt = 0;

export async function resolveTicker(ticker) {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Enter a ticker symbol.");
  }
  const index = await loadTickerIndex();
  const company = index.find((entry) => entry.ticker === normalized);
  if (!company) {
    throw new Error(`Could not resolve ticker ${normalized}.`);
  }
  return company;
}

export async function getCompanyFilings({ ticker, limit, offset = 0 }) {
  const company = await resolveTicker(ticker);
  const submissions = await fetchJson(`${APP_CONFIG.sec.submissionsBaseUrl}/CIK${company.cik}.json`);
  const filings = normalizeRecentFilings(submissions, company).slice(offset, offset + limit);
  return { company, filings, totalRecentFilings: submissions.filings?.recent?.accessionNumber?.length || 0 };
}

export async function fetchFilingText(filing) {
  const url = getFilingTextFetchUrl(filing.textUrl);
  let response;
  try {
    response = await throttledFetch(url, { headers: { Accept: "text/plain,*/*" } });
  } catch (error) {
    throw new Error(`Could not fetch filing text. SEC archive text is often blocked by browser CORS; configure sec.filingTextProxyUrl in js/config.js or open the SEC link directly. ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`Could not fetch filing text (${response.status}). Configure sec.filingTextProxyUrl in js/config.js or open the SEC link directly.`);
  }
  return response.text();
}

function getFilingTextFetchUrl(textUrl) {
  const proxyUrl = APP_CONFIG.sec.filingTextProxyUrl?.trim();
  if (!proxyUrl) {
    return textUrl;
  }
  return `${proxyUrl}${encodeURIComponent(textUrl)}`;
}

async function loadTickerIndex() {
  const cached = readTickerCache();
  if (cached) {
    return cached;
  }
  const payload = await fetchJson(APP_CONFIG.sec.tickerIndexUrl);
  const index = Object.values(payload).map((entry) => ({
    cik: String(entry.cik_str).padStart(10, "0"),
    cikNumber: String(entry.cik_str),
    ticker: String(entry.ticker).toUpperCase(),
    title: entry.title,
  }));
  localStorage.setItem(TICKER_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), index }));
  return index;
}

function readTickerCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(TICKER_CACHE_KEY) || "null");
    if (!cached || Date.now() - cached.savedAt > APP_CONFIG.sec.tickerCacheTtlMs) {
      return null;
    }
    return cached.index;
  } catch {
    return null;
  }
}

function normalizeRecentFilings(submissions, company) {
  const recent = submissions.filings?.recent || {};
  const accessionNumbers = recent.accessionNumber || [];
  return accessionNumbers.map((accessionNumber, index) => {
    const accessionCompact = accessionNumber.replaceAll("-", "");
    const cikPath = String(Number(company.cik));
    const primaryDocument = recent.primaryDocument?.[index] || `${accessionNumber}.txt`;
    const basePath = `${APP_CONFIG.sec.archivesBaseUrl}/${cikPath}/${accessionCompact}`;
    return {
      id: `${company.cik}-${accessionNumber}`,
      companyName: company.title,
      ticker: company.ticker,
      cik: company.cik,
      accessionNumber,
      form: recent.form?.[index] || "Unknown",
      filingDate: recent.filingDate?.[index] || "",
      reportDate: recent.reportDate?.[index] || "",
      description: recent.primaryDocDescription?.[index] || "",
      primaryDocument,
      filingUrl: `${basePath}/${primaryDocument}`,
      indexUrl: `${basePath}/${accessionNumber}-index.html`,
      textUrl: `${basePath}/${accessionNumber}.txt`,
      summary: "",
      summaryError: "",
      text: "",
      textError: "",
      selected: true,
    };
  });
}

async function fetchJson(url) {
  const response = await throttledFetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`SEC request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

async function throttledFetch(url, options = {}) {
  const minDelayMs = 1000 / APP_CONFIG.sec.maxRequestsPerSecond;
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestAt + minDelayMs - now);
  if (waitMs) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAt = Date.now();
  return fetch(url, options);
}