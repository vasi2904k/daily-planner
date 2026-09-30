import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

export type AiConfig = { provider: string; model: string };

type ChatOptions = { system: string; user: string; temperature?: number; maxTokens?: number };

// ── Gemini error mapping ────────────────────────────────────────────────
class AiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AiError";
  }
}

function mapProviderError(provider: string, status: number | undefined, detail: string, apiKey: string): AiError {
  const safeDetail = detail.replaceAll(apiKey, "[redacted]").slice(0, 300);
  const statusDetail = status ? `${provider} request failed (HTTP ${status}): ${safeDetail}` : `${provider} request failed: ${safeDetail}`;
  switch (true) {
    case status === 401 || status === 403:
      return new AiError("AUTH", `API key or authentication problem. Check ${provider === "Groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"} in .env.local.`);
    case status === 400:
      return new AiError("BAD_REQUEST", `Invalid request or model configuration: ${statusDetail}`);
    case status === 404:
      return new AiError("NOT_FOUND", `Invalid model or endpoint. Verify ${provider === "Groq" ? "GROQ_MODEL" : "GEMINI_MODEL"} in .env.local. ${statusDetail}`);
    case status === 429:
      return new AiError("RATE_LIMIT", `${provider} request failed (HTTP 429): quota or rate limit exceeded. Try again later.`);
    case typeof status === "number" && status >= 500:
      return new AiError("SERVER", statusDetail);
    default:
      return new AiError("UNKNOWN", statusDetail);
  }
}

function getProviderErrorDetails(error: unknown): { status?: number; detail: string } {
  if (!error || typeof error !== "object") return { detail: String(error) };
  const value = error as { status?: unknown; statusCode?: unknown; message?: unknown; error?: { message?: unknown } };
  const status = typeof value.status === "number"
    ? value.status
    : typeof value.statusCode === "number"
      ? value.statusCode
      : undefined;
  const detail = typeof value.error?.message === "string"
    ? value.error.message
    : typeof value.message === "string"
      ? value.message
      : "Unknown Gemini error";
  return { status, detail };
}

// ── Configuration ───────────────────────────────────────────────────────
function getConfig() {
  const selectedProvider = process.env.AI_PROVIDER?.trim().toLowerCase() || "gemini";
  const isGroq = selectedProvider === "groq";
  const provider = isGroq ? "Groq" as const : "Google Gemini" as const;
  const apiKey = (isGroq ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY)?.trim();
  const model = (isGroq ? process.env.GROQ_MODEL : process.env.GEMINI_MODEL)?.trim()
    || (isGroq ? "llama-3.3-70b-versatile" : "gemini-3.8-flash");
  if (!apiKey) {
    throw new AiError("NOT_CONFIGURED", `AI planning is not configured. Set ${isGroq ? "GROQ_API_KEY" : "GEMINI_API_KEY"} in .env.local.`);
  }
  return { apiKey, model, provider, kind: isGroq ? "groq" as const : "gemini" as const };
}

export function getAiConfig(): AiConfig {
  const { provider, model } = getConfig();
  return { provider, model };
}

// ── Core request ────────────────────────────────────────────────────────
export async function chatJson({ system, user, temperature = 0.2, maxTokens = 1800 }: ChatOptions): Promise<unknown> {
  const config = getConfig();

  let text: string | undefined;
  try {
    if (config.kind === "groq") {
      const groq = new Groq({ apiKey: config.apiKey });
      const completion = await groq.chat.completions.create({
        model: config.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      });
      text = completion.choices[0]?.message?.content ?? undefined;
    } else {
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      const generationConfig = { max_output_tokens: maxTokens, temperature };
      const interaction = await ai.interactions.create({
        model: config.model,
        system_instruction: system,
        input: user,
        generation_config: generationConfig,
        response_format: { type: "text", mime_type: "application/json" },
        store: false,
      });
      text = interaction.output_text ?? interaction.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("");
    }
  } catch (error) {
    const details = getProviderErrorDetails(error);
    throw mapProviderError(config.provider, details.status, details.detail, config.apiKey);
  }

  if (!text) throw new AiError("EMPTY", `${config.provider} returned an empty response.`);

  try {
    const fencedJson = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse(fencedJson?.[1] ?? text) as unknown;
  } catch {
    throw new AiError("PARSE", `${config.provider} returned invalid JSON.`);
  }
}

// ── Health probe ────────────────────────────────────────────────────────
export async function probeAi(): Promise<true> {
  const config = getConfig();
  if (config.kind === "groq") {
    let text: string | undefined;
    try {
      const groq = new Groq({ apiKey: config.apiKey });
      const completion = await groq.chat.completions.create({
        model: config.model,
        messages: [{ role: "user", content: "Return a JSON object with exactly one boolean property named ok. Set ok to true." }],
        temperature: 0,
        max_completion_tokens: 64,
        include_reasoning: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "health_check",
            strict: true,
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
      });
      text = completion.choices[0]?.message?.content ?? undefined;
    } catch (error) {
      const details = getProviderErrorDetails(error);
      throw mapProviderError(config.provider, details.status, details.detail, config.apiKey);
    }

    if (!text) throw new AiError("EMPTY", "Groq returned an empty response.");
    let result: unknown;
    try {
      result = JSON.parse(text) as unknown;
    } catch {
      throw new AiError("PARSE", "Groq returned invalid JSON.");
    }
    if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
      throw new AiError("PROBE", "Groq health probe returned unexpected payload.");
    }
    return true;
  }

  const result = await chatJson({
    system: "Return only JSON: {\"status\":\"AI_TEST_OK\"}",
    user: "Respond with the health-check JSON object.",
    maxTokens: 30,
  });
  const parsed = result as { status?: string };
  if (parsed?.status !== "AI_TEST_OK") {
    throw new AiError("PROBE", "AI provider health probe returned unexpected payload.");
  }
  return true;
}

export { AiError };
