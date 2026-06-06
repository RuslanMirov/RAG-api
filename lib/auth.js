import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const ALG = process.env.JWT_ALG || "HS256";
const SECRET = process.env.JWT_SECRET;
const PUBLIC_KEY = process.env.JWT_PUBLIC_KEY
  ? process.env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n")
  : null;
const ISSUER = process.env.JWT_ISSUER || "rag-api";
const AUDIENCE = process.env.JWT_AUDIENCE || "rag-api";

const verifyKey = ALG === "RS256" ? PUBLIC_KEY : SECRET;

/**
 * Verify the Bearer JWT on an external API request and enforce a scope.
 * Returns { auth } on success or { error: Response } on failure.
 */
export function requireAuth(req, requiredScope = null) {
  if (!verifyKey) {
    return {
      error: Response.json({ error: "Auth not configured" }, { status: 500 }),
    };
  }

  const header = req.headers.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return {
      error: new Response(
        JSON.stringify({ error: "Missing or malformed Authorization: Bearer <token>" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer realm="rag-api"',
          },
        }
      ),
    };
  }

  let payload;
  try {
    payload = jwt.verify(token, verifyKey, {
      algorithms: [ALG], // pinned: blocks alg:none / HS<->RS confusion
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 5,
    });
  } catch (err) {
    const detail =
      err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return {
      error: new Response(JSON.stringify({ error: detail }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer error="invalid_token"',
        },
      }),
    };
  }

  if (requiredScope) {
    const scopes = String(payload.scope || "").split(/[\s,]+/).filter(Boolean);
    if (!scopes.includes(requiredScope)) {
      return {
        error: Response.json(
          { error: `Missing required scope '${requiredScope}'` },
          { status: 403 }
        ),
      };
    }
  }

  return {
    auth: { sub: payload.sub, scope: payload.scope, jti: payload.jti, claims: payload },
  };
}

/** Timing-safe admin secret check (env ADMIN_SECRET, rotatable). */
export function checkAdminSecret(provided) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Mint a token for external API consumers (HS256 only). */
export function issueToken({ sub = "service", scope = "rag:read", expiresIn = "1h" } = {}) {
  if (ALG !== "HS256") {
    throw new Error("issueToken supports HS256 only; sign RS256 with your private key");
  }
  return jwt.sign({ sub, scope, jti: crypto.randomUUID() }, SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn,
  });
}
