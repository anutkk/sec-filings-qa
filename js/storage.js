const SETTINGS_KEY = "sec-filings-qa-settings";
const SESSION_KEY = "sec-filings-qa-api-key";

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  const safeSettings = { ...settings };
  delete safeSettings.apiKey;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
}

export function loadSessionApiKey() {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

export function saveSessionApiKey(apiKey) {
  if (apiKey) {
    sessionStorage.setItem(SESSION_KEY, apiKey);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}