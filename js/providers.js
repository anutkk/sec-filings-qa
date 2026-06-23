import { APP_CONFIG } from "./config.js";

export class ProviderError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProviderError";
    this.details = details;
  }
}

export function getProviderConfig(providerId) {
  const config = APP_CONFIG.providers[providerId];
  if (!config) {
    throw new ProviderError(`Unknown provider: ${providerId}`);
  }
  return config;
}

export function getModelForRole(providerId, role) {
  const config = getProviderConfig(providerId);
  return role === "expensive" ? config.expensiveModel : config.cheapModel;
}

export async function callModel({ providerId, apiKey, model, messages, json = false }) {
  const config = getProviderConfig(providerId);
  if (!apiKey?.trim()) {
    throw new ProviderError("Enter an API key before calling the model.");
  }

  if (config.kind === "openai-compatible") {
    return callOpenAICompatible({ config, apiKey, model, messages, json });
  }
  if (config.kind === "gemini") {
    return callGemini({ config, apiKey, model, messages, json });
  }
  if (config.kind === "claude") {
    return callClaude({ config, apiKey, model, messages, json });
  }
  throw new ProviderError(`Unsupported provider kind: ${config.kind}`);
}

export async function callJsonModel(options) {
  const text = await callModel({ ...options, json: true });
  return parseJsonResponse(text);
}

async function callOpenAICompatible({ config, apiKey, model, messages, json }) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      response_format: json ? { type: "json_object" } : undefined,
    }),
  });
  const payload = await readProviderResponse(response);
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function callGemini({ config, apiKey, model, messages, json }) {
  const system = messages.find((message) => message.role === "system")?.content;
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  if (json) {
    contents.push({ role: "user", parts: [{ text: "Return only valid JSON. Do not wrap it in Markdown." }] });
  }

  const response = await fetch(`${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: json ? "application/json" : "text/plain",
      },
    }),
  });
  const payload = await readProviderResponse(response);
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
}

async function callClaude({ config, apiKey, model, messages, json }) {
  const system = messages.find((message) => message.role === "system")?.content || "";
  const claudeMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));

  if (json) {
    claudeMessages.push({ role: "user", content: "Return only valid JSON. Do not wrap it in Markdown." });
  }

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      temperature: 0.1,
      system,
      messages: claudeMessages,
    }),
  });
  const payload = await readProviderResponse(response);
  return payload.content?.map((part) => part.text || "").join("\n").trim() || "";
}

async function readProviderResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new ProviderError(payload.error?.message || payload.message || `Provider request failed with HTTP ${response.status}`, payload);
  }
  return payload;
}

export function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const start = withoutFence.search(/[\[{]/);
    const end = Math.max(withoutFence.lastIndexOf("}"), withoutFence.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new ProviderError("The model did not return valid JSON.", { text, error: error.message });
  }
}