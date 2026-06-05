import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

const ALG = process.env.JWT_ALG || "HS256";        // HS256 or RS256
const SECRET = process.env.JWT_SECRET;             // HS256 shared secret
const PUBLIC_KEY = process.env.JWT_PUBLIC_KEY      // RS256 PEM (\n-escaped)
  ? process.env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n")
  : null;
const ISSUER = process.env.JWT_ISSUER || "rag-api";
const AUDIENCE = process.env.JWT_AUDIENCE || "rag-api";

if (ALG === "HS256" && !SECRET) {
  throw new Error("JWT_SECRET is required (or set JWT_ALG=RS256 + JWT_PUBLIC_KEY)");
}
if (ALG === "RS256" && !PUBLIC_KEY) {
  throw new Error("JWT_PUBLIC_KEY is required for RS256");
}

const verifyKey = ALG === "RS256" ? PUBLIC_KEY : SECRET;

/**
 * Express middleware factory: verifies the Bearer JWT and (optionally)
 * enforces a required scope, e.g. requireAuth("rag:write").
 *
 * Token contract:
 *   header:  { alg: HS256|RS256 }            -- alg is PINNED, no downgrade
 *   payload: { sub, iss, aud, exp, iat, scope: "rag:read rag:write" }
 */
export function requireAuth(requiredScope = null) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res
        .status(401)
        .set("WWW-Authenticate", 'Bearer realm="rag-api"')
        .json({ error: "Missing or malformed Authorization: Bearer <token>" });
    }

    let payload;
    try {
      payload = jwt.verify(token, verifyKey, {
        algorithms: [ALG],          // pin algorithm: blocks alg:none / HS<->RS confusion
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 5,          // seconds of clock skew
      });
    } catch (err) {
      const detail =
        err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
      return res
        .status(401)
        .set("WWW-Authenticate", `Bearer error="invalid_token"`)
        .json({ error: detail });
    }

    if (requiredScope) {
      const scopes = String(payload.scope || "").split(/[\s,]+/).filter(Boolean);
      if (!scopes.includes(requiredScope)) {
        // Authenticated but not authorized -> 403, not 401
        return res
          .status(403)
          .json({ error: `Missing required scope '${requiredScope}'` });
      }
    }

    req.auth = {
      sub: payload.sub,
      scope: payload.scope,
      jti: payload.jti,
      claims: payload,
    };
    next();
  };
}

/** Mint a token (used by scripts/issueToken.js; HS256 only). */
export function issueToken({
  sub = "service",
  scope = "rag:read",
  expiresIn = "1h",
} = {}) {
  if (ALG !== "HS256") {
    throw new Error("issueToken() supports HS256 only; sign RS256 tokens with your private key");
  }
  return jwt.sign(
    { sub, scope, jti: crypto.randomUUID() },
    SECRET,
    { algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, expiresIn }
  );
}
