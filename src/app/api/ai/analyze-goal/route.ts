import { NextResponse } from "next/server";
import { AiError } from "@/lib/ai/client";
import { analyzeGoal } from "@/lib/ai/services";

export async function POST(request: Request) {
  try {
    const result = await analyzeGoal(await request.json());
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiError && error.code === "NOT_CONFIGURED") {
      return NextResponse.json({ error: "AI planning is not configured. Set GEMINI_API_KEY in .env.local." }, { status: 503 });
    }
    const message = error instanceof Error && !error.message.includes("AI") && !error.message.includes("Gemini")
      ? error.message
      : "AI planning is temporarily unavailable. Please check the AI configuration.";
    return NextResponse.json({ error: message }, { status: message.includes("AI planning") ? 503 : 400 });
  }
}
