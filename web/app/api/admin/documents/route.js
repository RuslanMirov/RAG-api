import { NextResponse } from "next/server";
import { checkAdminSecret, ragFetch } from "@/lib/rag";

export async function GET(req) {
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }
  const { status, data } = await ragFetch("/api/documents", {
    scope: "rag:read",
  });
  return NextResponse.json(data, { status });
}

export async function DELETE(req) {
  if (!checkAdminSecret(req.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { status, data } = await ragFetch(`/api/documents/${id}`, {
    method: "DELETE",
    scope: "rag:write",
  });
  return NextResponse.json(data, { status });
}
