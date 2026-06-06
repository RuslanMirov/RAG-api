/**
 * Mint a JWT for external API consumers (HS256).
 *   npm run token -- writer "rag:read rag:write" 24h
 */
import { readFileSync, existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
const { issueToken } = await import("../lib/auth.js");
const [sub = "dev", scope = "rag:read", expiresIn = "1h"] = process.argv.slice(2);
const token = issueToken({ sub, scope, expiresIn });
console.log(`sub=${sub} scope="${scope}" exp=${expiresIn}\n\n${token}\n`);
console.log(`curl -H "Authorization: Bearer ${token}" ...`);
