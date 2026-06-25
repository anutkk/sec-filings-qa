import { APP_CONFIG } from "./config.js";

const TICKER_CACHE_KEY = "sec-filings-qa-ticker-index";
const OWNERSHIP_FORMS = new Set(["3", "4", "5"]);
let lastRequestAt = 0;
let secIdentity = "";

export function setSecIdentity(identity) {
  secIdentity = identity.trim();
}

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
  const eligibleFilings = normalizeRecentFilings(submissions, company).filter((filing) => !OWNERSHIP_FORMS.has(filing.form));
  const filings = eligibleFilings.slice(offset, offset + limit);
  return { company, filings, totalRecentFilings: eligibleFilings.length };
}

export async function fetchFilingText(filing) {
  let response;
  try {
    response = await throttledFetch(filing.textUrl, { headers: { Accept: "text/plain,*/*" } });
  } catch (error) {
    throw new Error(`Could not fetch filing text. SEC requests are often blocked by browser CORS; configure sec.secProxyUrl in js/config.js or open the SEC link directly. ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`Could not fetch filing text (${response.status}). Configure sec.secProxyUrl in js/config.js or open the SEC link directly.`);
  }
  const rawText = await response.text();
  return normalizeFilingText(rawText);
}

function normalizeFilingText(text) {
  const tagStrippedText = String(text || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  const numericDecodedText = tagStrippedText.replace(/&#(x[\da-f]+|\d+);?/gi, (entity, codePoint) => {
    const value = codePoint.toLowerCase().startsWith("x") ? parseInt(codePoint.slice(1), 16) : Number(codePoint);
    if (!Number.isFinite(value)) {
      return entity;
    }
    try {
      return String.fromCodePoint(value);
    } catch {
      return entity;
    }
  });

  if (typeof document === "undefined") {
    return numericDecodedText
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
  }

  const decoder = document.createElement("textarea");
  decoder.innerHTML = numericDecodedText;
  return decoder.value;
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
    throw new Error(`SEC request failed with HTTP ${response.status} while fetching ${url}${APP_CONFIG.sec.secProxyUrl ? ` through proxy ${APP_CONFIG.sec.secProxyUrl}` : ""}.`);
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
  return fetch(getSecFetchUrl(url), {
    ...options,
    headers: {
      ...(secIdentity ? { "User-Agent": secIdentity } : {}),
      ...options.headers,
    },
  });
}

function getSecFetchUrl(url) {
  const proxyUrl = APP_CONFIG.sec.secProxyUrl?.trim();
  if (!proxyUrl) {
    return url;
  }
  if (proxyUrl.includes("{url}")) {
    return proxyUrl.replace("{url}", encodeURIComponent(url));
  }
  if (proxyUrl.includes("{rawUrl}")) {
    return proxyUrl.replace("{rawUrl}", url);
  }
  return `${proxyUrl}${encodeURIComponent(url)}`;
}