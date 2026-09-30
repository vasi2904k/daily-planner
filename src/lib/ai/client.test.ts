import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiConfig, probeAi } from "./client";

const { createMock, groqCreateMock } = vi.hoisted(() => ({ createMock: vi.fn(), groqCreateMock: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = { create: createMock };
  },
}));
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: groqCreateMock } };
  },
}));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); createMock.mockReset(); groqCreateMock.mockReset(); });

describe("AI client", () => {
  it("returns Google Gemini config when GEMINI_API_KEY is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    expect(getAiConfig()).toEqual({ provider: "Google Gemini", model: "gemini-3.8-flash" });
  });

  it("uses default model when GEMINI_MODEL is not set", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    delete process.env.GEMINI_MODEL;
    const config = getAiConfig();
    expect(config.model).toBe("gemini-3.8-flash");
    expect(config.provider).toBe("Google Gemini");
  });

  it("selects Groq when AI_PROVIDER is groq", () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    vi.stubEnv("GROQ_MODEL", "llama-3.3-70b-versatile");
    expect(getAiConfig()).toEqual({ provider: "Groq", model: "llama-3.3-70b-versatile" });
  });

  it("throws when GEMINI_API_KEY is missing", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => getAiConfig()).toThrow("not configured");
  });

  it("probes a successful Gemini response without returning secrets", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    createMock.mockResolvedValue({ output_text: '```json\n{"status":"AI_TEST_OK"}\n```' });
    await expect(probeAi()).resolves.toBe(true);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.8-flash",
      input: "Respond with the health-check JSON object.",
      system_instruction: 'Return only JSON: {"status":"AI_TEST_OK"}',
      response_format: { type: "text", mime_type: "application/json" },
    }));
  });

  it("rejects probe when Gemini returns unexpected payload", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    createMock.mockResolvedValue({ output_text: '{"status":"NOT_OK"}' });
    await expect(probeAi()).rejects.toThrow("unexpected payload");
  });

  it("probes Groq with strict JSON schema mode", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
    groqCreateMock.mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] });
    await expect(probeAi()).resolves.toBe(true);
    expect(groqCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "user", content: "Return a JSON object with exactly one boolean property named ok. Set ok to true." },
      ],
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
    }));
  });

  it("rejects malformed or unexpected Groq health responses", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    groqCreateMock.mockResolvedValue({ choices: [{ message: { content: '{"ok":false}' } }] });
    await expect(probeAi()).rejects.toThrow("unexpected payload");

    groqCreateMock.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    await expect(probeAi()).rejects.toThrow("invalid JSON");
  });
});
