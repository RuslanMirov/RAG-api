import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { listDocuments, deleteDocument } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }
  return NextResponse.json(await listDocuments());
}

export async function DELETE(req) {
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ok = await deleteDocument(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
