import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("AI health route", () => {
  it("returns a safe missing-configuration response", async () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const response = await GET();
    const body = await response.json();
    if (previous) process.env.GEMINI_API_KEY = previous;
    expect(response.status).toBe(503);
    expect(body.configured).toBe(false);
    expect(body.reachable).toBe(false);
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("authorization");
    expect(body.error).toContain("not configured");
  });
});
