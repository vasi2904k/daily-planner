import { NextResponse } from "next/server";
import { AiError, getAiConfig, probeAi } from "@/lib/ai/client";

export async function GET() {
  try {
    const config = getAiConfig();
    await probeAi();
    return NextResponse.json({
      configured: true,
      provider: config.provider,
      model: config.model,
      reachable: true,
    });
  } catch (error) {
    const isNotConfigured =
      error instanceof AiError && error.code === "NOT_CONFIGURED";

    return NextResponse.json(
      {
        configured: !isNotConfigured,
        provider: isNotConfigured ? null : process.env.AI_PROVIDER?.trim().toLowerCase() === "groq" ? "Groq" : "Google Gemini",
        model: isNotConfigured ? null : process.env.AI_PROVIDER?.trim().toLowerCase() === "groq"
          ? (process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile")
          : (process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash"),
        reachable: false,
        error: isNotConfigured
          ? "AI planning is not configured. Set GEMINI_API_KEY in .env.local."
          : error instanceof Error
            ? error.message
            : "AI planning is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}
