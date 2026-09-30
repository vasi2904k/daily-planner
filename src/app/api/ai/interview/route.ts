import { NextResponse } from "next/server";
import { z } from "zod";
import { AiError } from "@/lib/ai/client";
import { interview } from "@/lib/ai/services";

export async function POST(request: Request) {
  try {
    const result = await interview(await request.json());
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid interview request." }, { status: 400 });
    }
    if (error instanceof AiError && error.code === "NOT_CONFIGURED") {
      return NextResponse.json({ error: "AI planning is not configured. Set GEMINI_API_KEY in .env.local." }, { status: 503 });
    }
    return NextResponse.json(
      { error: "AI planning is temporarily unavailable. Please check the AI configuration." },
      { status: 503 },
    );
  }
}
