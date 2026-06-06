import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ingestDocument, listDocuments } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { error } = requireAuth(req, "rag:write");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  if (!body.text || typeof body.text !== "string") {
    return NextResponse.json({ error: "Field 'text' (string) is required" }, { status: 400 });
  }

  try {
    const result = await ingestDocument(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json(
      { error: "Ingest failed", detail: err.message },
      { status: err.status || 500 }
    );
  }
}

export async function GET(req) {
  const { error } = requireAuth(req, "rag:read");
  if (error) return error;
  return NextResponse.json(await listDocuments());
}
