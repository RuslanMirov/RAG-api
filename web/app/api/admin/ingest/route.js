import { NextResponse } from "next/server";
import { checkAdminSecret, ragFetch } from "@/lib/rag";

export async function POST(req) {
  // Secret travels in a header, never in the URL (no log leakage)
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const { title, source, text, metadata } = await req.json().catch(() => ({}));
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const { status, data } = await ragFetch("/api/documents", {
    method: "POST",
    scope: "rag:write",
    body: {
      title: title?.trim() || null,
      source: source?.trim() || null,
      text,
      metadata: metadata || {},
    },
  });

  return NextResponse.json(data, { status });
}
