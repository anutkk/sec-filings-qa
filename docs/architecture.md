# Architecture

SEC Filings QA is a static browser app made of ES modules. It is designed so the retrieval and answer-generation workflow can be replaced without rewriting the layout or SEC access layer.

## Modules

- `js/config.js` contains developer-controlled provider and model configuration.
- `js/sec.js` resolves tickers, fetches SEC submissions, normalizes filing metadata, builds archive URLs, throttles SEC requests, and fetches filing text.
- `js/providers.js` adapts OpenAI-compatible, Gemini, and Claude APIs behind one `callModel` interface.
- `js/qaEngine.js` owns the RAG-like workflow: question rewrite, keyword generation, paragraph extraction, relevance judging, final synthesis, and citation mapping.
- `js/app.js` orchestrates UI events and app state.
- `js/ui.js` renders filings, chat messages, citations, and source excerpts.
- `js/storage.js` stores non-secret preferences and optional session-only API keys.

## Replacing Retrieval

To add embeddings, ranking, or agentic search, keep the public shape of `answerQuestion` in `js/qaEngine.js` and replace the internal paragraph search/evaluation steps. The UI expects a final answer plus a `sources` array whose items include `id`, `label`, `sourceVerbatim`, `matchedKeyword`, and filing metadata.

## Static-App Limits

This app has no backend. Browser JavaScript cannot hide provider API keys, and some browsers may omit the forbidden `User-Agent` header even when the SEC module is configured with an identity. Node/static-test runs can send it; full browser compliance may require a backend or proxy. The app may also run into provider or SEC CORS limits. Those limits are surfaced in the UI and documented in the README.

`js/config.js` includes `sec.secProxyUrl` for deployments that operate a compliant SEC proxy for ticker metadata, submissions metadata, and filing text. The app remains static because the proxy URL is just developer-controlled configuration, but the proxy itself is outside this repository.
