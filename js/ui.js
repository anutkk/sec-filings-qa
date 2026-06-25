export function setStatus(text, tone = "neutral") {
  const status = document.querySelector("#appStatus");
  status.textContent = text;
  status.dataset.tone = tone;
}

export function renderProviders(select, providers, selectedProvider) {
  select.innerHTML = Object.entries(providers)
    .map(([id, config]) => `<option value="${escapeHtml(id)}" ${id === selectedProvider ? "selected" : ""}>${escapeHtml(config.label)}</option>`)
    .join("");
}

export function renderCompanySummary(element, company, filingsLoaded, totalRecentFilings) {
  element.textContent = `${company.title} (${company.ticker}) · CIK ${company.cik} · ${filingsLoaded} of ${totalRecentFilings} recent filings loaded`;
}

export function renderFilings(container, filings) {
  container.innerHTML = filings.map(renderFilingCard).join("");
}

export function selectedFilingIds(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

export function appendMessage(chatLog, role, content, sources = []) {
  const empty = chatLog.querySelector(".empty-state");
  if (empty) {
    empty.remove();
  }
  const message = document.createElement("article");
  message.className = `message ${role}`;
  if (role === "assistant" && sources.length) {
    message.append(...renderAnswerWithCitations(content, sources));
  } else {
    message.textContent = content;
  }
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

export function appendLoadingMessage(chatLog) {
  const message = appendMessage(chatLog, "assistant", "");
  message.classList.add("loading-message");
  message.setAttribute("aria-live", "polite");
  message.innerHTML = `
    <span class="loading-label">Thinking</span>
    <span class="loading-dots" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </span>`;
  return message;
}

export function renderSource(sourcePane, externalLink, source) {
  if (!source) {
    sourcePane.innerHTML = `<div class="empty-state compact"><h2>No source selected</h2><p>Click a bracket citation in an answer to inspect the supporting filing excerpt.</p></div>`;
    externalLink.href = "#";
    return;
  }

  const filing = source.filing || {};
  externalLink.href = filing.filingUrl || source.filingUrl || "#";
  sourcePane.innerHTML = `
    <article class="source-panel">
      <div>
        <p class="eyebrow">${escapeHtml(source.label)}</p>
        <h3>${escapeHtml(filing.companyName || "SEC filing")}</h3>
        <p class="meta-line">${escapeHtml(filing.form || source.form)} · filed ${escapeHtml(filing.filingDate || source.filingDate)} · accession ${escapeHtml(filing.accessionNumber || "")}</p>
      </div>
      <section>
        <h3>Relevant excerpt</h3>
        <p class="source-excerpt">${highlightText(source.sourceVerbatim || source.paragraph, source.matchedSentence || source.matchedKeyword)}</p>
      </section>
      <section>
        <h3>Filing context</h3>
        <div class="source-document">${highlightText(extractWindow(filing.text || source.paragraph, source.sourceVerbatim || source.paragraph), source.matchedSentence || source.matchedKeyword)}</div>
      </section>
    </article>`;
}

function renderFilingCard(filing) {
  const summaryClass = filing.textError || filing.summaryError ? "summary-text error-text" : "summary-text";
  const summary = filing.summary || filing.summaryError || filing.textError || "Loading summary...";
  const checked = filing.text && filing.selected !== false ? "checked" : "";
  return `
    <article class="filing-card">
      <header>
        <input type="checkbox" value="${escapeHtml(filing.id)}" ${checked} ${filing.text ? "" : "disabled"} aria-label="Select filing ${escapeHtml(filing.form)} filed ${escapeHtml(filing.filingDate)}" />
        <div>
          <h3>${escapeHtml(filing.form)} · ${escapeHtml(filing.filingDate)}</h3>
          <p class="meta-line">Report ${escapeHtml(filing.reportDate || "unknown")} · ${escapeHtml(filing.description || filing.primaryDocument)}</p>
          <a class="filing-link" href="${escapeHtml(filing.filingUrl)}" target="_blank" rel="noreferrer">Open filing</a>
        </div>
      </header>
      <p class="${summaryClass}">${escapeHtml(summary)}</p>
    </article>`;
}

function renderAnswerWithCitations(content, sources) {
  const fragment = document.createDocumentFragment();
  const lines = String(content || "").split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    if (isListItem(lines[index])) {
      const list = document.createElement("ul");
      list.className = "answer-list";
      while (index < lines.length && isListItem(lines[index])) {
        const item = document.createElement("li");
        appendInlineMarkdown(item, lines[index].replace(/^\s*[-*]\s+/, ""), sources);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const heading = lines[index].match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (heading) {
      const element = document.createElement("h3");
      element.className = "answer-heading";
      appendInlineMarkdown(element, heading[1], sources);
      fragment.append(element);
      index += 1;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isListItem(lines[index]) && !lines[index].match(/^\s*\*\*(.+?)\*\*\s*$/)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    paragraph.className = "answer-paragraph";
    appendInlineMarkdown(paragraph, paragraphLines.join(" "), sources);
    fragment.append(paragraph);
  }

  return [fragment];
}

function appendInlineMarkdown(parent, text, sources) {
  const inlinePattern = /\[(source\d+)\]|\*\*(.+?)\*\*/gi;
  let lastIndex = 0;
  let match;
  while ((match = inlinePattern.exec(text)) !== null) {
    parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    if (match[1]) {
      parent.append(renderCitationButton(match[1].toLowerCase(), sources));
    } else {
      const strong = document.createElement("strong");
      appendInlineMarkdown(strong, match[2], sources);
      parent.append(strong);
    }
    lastIndex = inlinePattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(lastIndex)));
}

function renderCitationButton(sourceId, sources) {
  const source = sources.find((item) => item.id === sourceId);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "citation-link";
  button.textContent = `[${sourceId}]`;
  button.dataset.sourceId = sourceId;
  button.disabled = !source;
  return button;
}

function isListItem(line) {
  return /^\s*[-*]\s+/.test(line);
}

function extractWindow(text, needle) {
  const haystack = String(text || "");
  const exact = String(needle || "").slice(0, 240);
  const index = exact ? haystack.indexOf(exact) : -1;
  if (index < 0) {
    return haystack.slice(0, 6000);
  }
  return haystack.slice(Math.max(0, index - 2500), Math.min(haystack.length, index + exact.length + 2500));
}

function highlightText(text, keyword) {
  const escaped = escapeHtml(text || "");
  if (!keyword) {
    return escaped;
  }
  const safeKeyword = escapeRegExp(keyword);
  return escaped.replace(new RegExp(`(${safeKeyword})`, "ig"), "<mark>$1</mark>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}