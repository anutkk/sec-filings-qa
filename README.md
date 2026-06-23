# sec-filings-qa

A static HTML/CSS/JavaScript app for asking grounded questions over SEC filings. It is designed for GitHub Pages or any static file server: no build step, backend, or package install is required.

## What It Does

- Lets the user enter an LLM provider, API key, SEC identity, ticker, and filing count.
- Resolves tickers through SEC ticker metadata and fetches recent company submissions.
- Loads recent filings, summarizes the first 1000 characters with the configured cheap model, and shows each filing with a checkbox selected by default.
- Enables chat once selected filings have accessible text.
- Runs a RAG-like workflow in `js/qaEngine.js`: query rewrite, keyword generation, paragraph extraction, relevance judging, final synthesis, and bracket citations.
- Renders citations like `[source1]` as links that open source details and highlighted excerpts in the right pane.

## Run Locally

Serve the repository root with any static server and open the local URL:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Configure Models

Provider and model choices are intentionally developer-controlled, not end-user controlled. Edit `js/config.js`:

```js
providers: {
	gemini: {
		cheapModel: "gemini-2.5-flash",
		expensiveModel: "gemini-3.1-pro-preview"
	}
}
```

The UI lets users choose the provider and enter their API key, but it does not expose model selection.

## API Key Storage

This is a static browser app, so API keys cannot be kept secret from the browser. The safest default available in this architecture is to keep the key in memory. The optional checkbox stores the key in `sessionStorage`, which clears when the browser session ends.

Cookies are not safer here. A regular JavaScript-readable cookie is exposed to the page just like web storage. An `HttpOnly` cookie would be safer, but a static GitHub Pages app cannot set or use one for provider authorization without a backend.

For local Gemini testing, copy `js/env.local.example.js` to `js/env.local.js` and fill in `GEMINI_API_KEY`. The real `js/env.local.js` file is ignored by git:

```js
export const LOCAL_ENV = {
	SEC_IDENTITY: "Your Name your.email@example.com",
	GEMINI_API_KEY: "your-test-key"
};
```

This is only a local convenience. Do not deploy `js/env.local.js` with a real key to GitHub Pages, because every browser user could read it.

## SEC Access Notes

The app uses:

- `https://www.sec.gov/files/company_tickers.json` for ticker-to-CIK lookup.
- `https://data.sec.gov/submissions/CIK##########.json` for recent filings metadata.
- SEC archive text URLs for filing text when browser CORS allows it.

SEC asks automated clients to declare a user agent and stay under the current fair-access request limit of 10 requests per second. This app throttles SEC requests below that limit. Browser JavaScript cannot set the forbidden `User-Agent` header, so full declared-user-agent compliance requires a backend or proxy. The SEC identity field is still collected so the app can preserve the required identity information and be ready for a future proxy.

SEC responses may omit browser CORS headers. Direct SEC links still open in the browser, but JavaScript may be blocked from fetching ticker metadata, submissions metadata, or filing text. If you operate a compliant proxy, configure it in `js/config.js`:

```js
sec: {
	secProxyUrl: "https://your-proxy.example.com/fetch?url="
}
```

The app appends `encodeURIComponent(secUrl)` to `secProxyUrl`. You can also use `{url}` as an encoded URL placeholder or `{rawUrl}` as a raw URL placeholder. Leave `secProxyUrl` blank to attempt direct SEC fetches.

Public demo CORS proxies are often rate-limited, blocked by SEC, or unreliable for large filing payloads. For production, use a proxy you control so it can send the SEC identity header and return CORS-enabled responses.

## Deploy To GitHub Pages

1. Commit the static files.
2. In GitHub, open repository settings.
3. Enable Pages from the `master` branch root or a docs branch, depending on your preference.
4. Open the Pages URL and repeat a smoke test with a ticker such as `AAPL`.

## File Structure

- `index.html` is the static app shell.
- `css/styles.css` contains the three-pane layout and responsive design.
- `js/config.js` contains provider and model configuration.
- `js/sec.js` handles SEC data access.
- `js/providers.js` handles LLM provider API calls.
- `js/qaEngine.js` contains the actual QA algorithm.
- `js/app.js` wires events and app state.
- `js/ui.js` renders filings, chat, citations, and sources.
- `docs/architecture.md` explains module boundaries and replacement points.
