import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteDocument } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req, { params }) {
  const { error } = requireAuth(req, "rag:write");
  if (error) return error;

  const ok = await deleteDocument(params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
