import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getStats } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { error } = requireAuth(req, "rag:read");
  if (error) return error;
  return NextResponse.json(await getStats());
}
