import { NextResponse } from "next/server";
import { ragFetch } from "@/lib/rag";

export async function POST(req) {
  const { question, mode = "hybrid", topK } = await req.json().catch(() => ({}));
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const { status, data } = await ragFetch("/api/query", {
    method: "POST",
    scope: "rag:read",
    body: { question: question.trim(), mode, ...(topK && { topK }) },
  });

  return NextResponse.json(data, { status });
}
