import { APP_CONFIG } from "./config.js";

export async function summarizeFiling({ filing, providerClient }) {
  const context = (filing.text || "").slice(0, APP_CONFIG.sec.summaryCharacters);
  if (!context) {
    return "Filing text was not available for summarization.";
  }
  return providerClient.callCheap([
    { role: "system", content: "You summarize SEC filings for a research interface. Be concise and factual." },
    { role: "user", content: `Summarize this filing preview in 2-3 compact sentences. Include form type, dates, and likely contents when visible.\n\nFiling metadata: ${filing.form}, filed ${filing.filingDate}, report date ${filing.reportDate || "unknown"}.\n\nPreview:\n${context}` },
  ]);
}

export async function answerQuestion({ question, chatHistory, selectedFilings, providerClient }) {
  const rephrasedQuery = await rewriteQuestion({ question, chatHistory, providerClient });
  const keywords = await generateKeywords({ rephrasedQuery, providerClient });
  const paragraphs = findMatchingParagraphs({ filings: selectedFilings, keywords });
  const judged = await evaluateParagraphs({ rephrasedQuery, paragraphs, providerClient });
  const relevant = judged.filter((item) => item.relevant).slice(0, APP_CONFIG.qa.maxFinalSources);
  const finalAnswer = await synthesizeAnswer({ rephrasedQuery, relevant, providerClient });
  const sources = buildSourceMap(relevant, selectedFilings);

  return {
    rephrasedQuery,
    keywords,
    finalAnswer,
    sources,
    searchedParagraphs: paragraphs.length,
  };
}

async function rewriteQuestion({ question, chatHistory, providerClient }) {
  const priorContext = chatHistory
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return providerClient.callCheap([
    { role: "system", content: "Rewrite user questions for SEC filing retrieval. Preserve intent, entities, dates, and constraints. Return one explicit concise query." },
    { role: "user", content: `Chat context:\n${priorContext || "No prior context."}\n\nLatest question:\n${question}` },
  ]);
}

async function generateKeywords({ rephrasedQuery, providerClient }) {
  const payload = await providerClient.callExpensiveJson([
    { role: "system", content: "Generate literal search strings for SEC filings. Prefer terms likely to appear verbatim. Return JSON only." },
    { role: "user", content: `For this query, return {"keywords":["..."]} with 6 to 12 precise strings, including synonyms and accounting terms where useful.\n\nQuery: ${rephrasedQuery}` },
  ]);
  const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
  return [...new Set(keywords.map((keyword) => String(keyword).trim()).filter(Boolean))];
}

function findMatchingParagraphs({ filings, keywords }) {
  const results = [];
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean);

  for (const filing of filings) {
    const paragraphs = splitParagraphs(filing.text || "");
    for (const paragraph of paragraphs) {
      const lowerParagraph = paragraph.toLowerCase();
      const matchedKeyword = normalizedKeywords.find((keyword) => paragraphMatchesKeyword(lowerParagraph, keyword));
      if (!matchedKeyword) {
        continue;
      }
      results.push({
        filingId: filing.id,
        form: filing.form,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        filingUrl: filing.filingUrl,
        indexUrl: filing.indexUrl,
        matchedKeyword,
        matchedSentence: findSentenceContaining(paragraph, matchedKeyword),
        paragraph: paragraph.slice(0, APP_CONFIG.qa.maxParagraphCharacters),
      });
      if (results.length >= APP_CONFIG.qa.maxParagraphsToEvaluate) {
        return results;
      }
    }
  }

  return results;
}

function paragraphMatchesKeyword(lowerParagraph, keyword) {
  if (lowerParagraph.includes(keyword)) {
    return true;
  }

  const tokens = keyword
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 3 && !KEYWORD_STOPWORDS.has(token));
  if (!tokens.length) {
    return false;
  }

  const presentTokens = tokens.filter((token) => lowerParagraph.includes(token));
  return presentTokens.length >= Math.min(2, tokens.length);
}

async function evaluateParagraphs({ rephrasedQuery, paragraphs, providerClient }) {
  const relevant = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const payload = await providerClient.callCheapJson([
      { role: "system", content: "Judge whether a filing paragraph answers a query. Return JSON only." },
      { role: "user", content: `Return {"relevant": boolean, "answer": string, "sourceVerbatim": string}. The sourceVerbatim must be copied exactly from the paragraph when relevant.\n\nQuery: ${rephrasedQuery}\n\nFiling: ${paragraph.form}, filed ${paragraph.filingDate}\nMatched keyword: ${paragraph.matchedKeyword}\n\nParagraph:\n${paragraph.paragraph}` },
    ]);
    relevant.push({
      ...paragraph,
      sourceNumber: index + 1,
      relevant: Boolean(payload.relevant),
      answer: String(payload.answer || ""),
      sourceVerbatim: String(payload.sourceVerbatim || paragraph.paragraph).trim(),
    });
  }
  return relevant;
}

async function synthesizeAnswer({ rephrasedQuery, relevant, providerClient }) {
  if (!relevant.length) {
    return "I could not find relevant passages in the selected filings for this question.";
  }

  const numberedSources = relevant
    .map((source, index) => `[source${index + 1}] ${source.form} filed ${source.filingDate}: ${source.answer}\nVerbatim: ${source.sourceVerbatim}`)
    .join("\n\n");

  return providerClient.callExpensive([
    { role: "system", content: "Answer questions using only numbered SEC filing sources. Cite claims with bracket citations such as [source1]. Do not cite unsupported claims." },
    { role: "user", content: `Question: ${rephrasedQuery}\n\nNumbered sources:\n${numberedSources}` },
  ]);
}

function buildSourceMap(relevant, filings) {
  const filingsById = new Map(filings.map((filing) => [filing.id, filing]));
  return relevant.map((source, index) => ({
    id: `source${index + 1}`,
    label: `[source${index + 1}]`,
    ...source,
    filing: filingsById.get(source.filingId),
  }));
}

function splitParagraphs(text) {
  return text
    .replace(/<[^>]+>/g, " ")
    .split(/\n\s*\n|\r\n\s*\r\n/g)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 80);
}

function findSentenceContaining(paragraph, keyword) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
  return sentences.find((sentence) => paragraphMatchesKeyword(sentence.toLowerCase(), keyword))?.trim() || paragraph;
}

const KEYWORD_STOPWORDS = new Set([
  "about",
  "could",
  "from",
  "into",
  "over",
  "such",
  "that",
  "their",
  "these",
  "third",
  "with",
]);
