import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { ingestDocument } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }
  const { title, source, text, metadata } = await req.json().catch(() => ({}));
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  try {
    const result = await ingestDocument({
      title: title?.trim() || null,
      source: source?.trim() || null,
      text,
      metadata: metadata || {},
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Admin ingest error:", err);
    return NextResponse.json(
      { error: "Ingest failed", detail: err.message },
      { status: err.status || 500 }
    );
  }
}
