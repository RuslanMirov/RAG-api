import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { question, mode = "hybrid", topK } = await req.json().catch(() => ({}));
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  try {
    const result = await answerQuestion({ question: question.trim(), mode, topK });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json({ error: "Query failed", detail: err.message }, { status: 500 });
  }
}
