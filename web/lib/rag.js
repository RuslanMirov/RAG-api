import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET;
const ISSUER = process.env.JWT_ISSUER || "rag-api";
const AUDIENCE = process.env.JWT_AUDIENCE || "rag-api";

/** Mint a short-lived service token for the backend. Server-side only. */
export function serviceToken(scope) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");
  return jwt.sign(
    { sub: "next-web", scope, jti: crypto.randomUUID() },
    JWT_SECRET,
    { algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, expiresIn: "2m" }
  );
}

/**
 * Timing-safe comparison against ADMIN_SECRET (env-controlled, rotatable).
 * Hash both sides first so lengths always match.
 */
export function checkAdminSecret(provided) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Proxy a JSON request to the backend with a scoped bearer token. */
export async function ragFetch(path, { method = "GET", body, scope } = {}) {
  const res = await fetch(`${RAG_API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceToken(scope)}`,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
