export const APP_CONFIG = {
  sec: {
    tickerIndexUrl: "https://www.sec.gov/files/company_tickers.json",
    submissionsBaseUrl: "https://data.sec.gov/submissions",
    archivesBaseUrl: "https://www.sec.gov/Archives/edgar/data",
    secProxyUrl: "https://corsproxy.io/?url=",
    tickerCacheTtlMs: 24 * 60 * 60 * 1000,
    maxRequestsPerSecond: 6,
    defaultFilingCount: 8,
    summaryCharacters: 1000,
  },
  providers: {
    openai: {
      label: "OpenAI",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      cheapModel: "gpt-4.1-mini",
      expensiveModel: "gpt-4.1",
    },
    gemini: {
      label: "Gemini",
      kind: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cheapModel: "gemini-2.5-flash",
      expensiveModel: "gemini-3.1-pro-preview",
    },
    claude: {
      label: "Claude",
      kind: "claude",
      baseUrl: "https://api.anthropic.com/v1",
      cheapModel: "claude-3-5-haiku-latest",
      expensiveModel: "claude-opus-4-1",
    },
  },
  qa: {
    maxParagraphsToEvaluate: 18,
    maxParagraphCharacters: 2800,
    maxFinalSources: 10,
  },
};

export const DEFAULT_PROVIDER = "openai";