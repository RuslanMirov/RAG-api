import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { error, auth } = requireAuth(req, "rag:read");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const { question, topK, documentId, mode } = body;
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "Field 'question' (string) is required" }, { status: 400 });
  }

  try {
    const result = await answerQuestion({ question, topK, documentId, mode });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Query error:", err);
    return NextResponse.json({ error: "Query failed", detail: err.message }, { status: 500 });
  }
}
